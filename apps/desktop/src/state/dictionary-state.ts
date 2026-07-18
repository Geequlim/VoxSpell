import { toJS } from 'mobx';
import { ResponseError } from 'vscode-jsonrpc';

import { normalizeDictionaryKey } from '@voxspell/config/load-dictionary';

import { action, derived, disposeState, effect, state, value } from './index';

import type { VoiceDictionary, VoiceDictionaryEntry } from '@voxspell/config/dictionary-schema';
import type { DictionaryGetResult } from '@voxspell/protocol/dictionary';
import type { ProtocolErrorData } from '@voxspell/protocol/errors';
import type { DaemonState } from './daemon-state';

export type DictionaryOperationPhase = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

export interface DictionaryClient {
	getDictionary(): Promise<DictionaryGetResult>;
	validateDictionary(dictionary: VoiceDictionary): Promise<void>;
	updateDictionary(dictionary: VoiceDictionary): Promise<void>;
	reloadDictionary(): Promise<void>;
}

export interface VisibleDictionaryEntry {
	readonly index: number;
	readonly entry: VoiceDictionaryEntry;
}

/** 管理已生效用户词典、弹窗草稿和自动保存闭环。 */
@state
export class DictionaryState {
	@value dictionary?: VoiceDictionary;
	@value editorEntry?: VoiceDictionaryEntry;
	@value editingIndex?: number;
	@value searchQuery = '';
	@value phase: DictionaryOperationPhase = 'idle';
	@value errorMessage?: string;
	@value editorError?: string;
	@value filePath = '';
	@value savedPromptCharacters = 0;
	readonly #client: DictionaryClient;
	readonly #daemon: DaemonState;
	#loadId = 0;
	#loaded = false;

	constructor(client: DictionaryClient, daemon: DaemonState) {
		this.#client = client;
		this.#daemon = daemon;
	}

	@derived get entries(): readonly VoiceDictionaryEntry[] {
		return this.dictionary?.entries ?? [];
	}

	@derived get visibleEntries(): readonly VisibleDictionaryEntry[] {
		const query = normalizeDictionaryKey(this.searchQuery.trim());
		return this.entries
			.map((entry, index) => ({ entry, index }))
			.filter(({ entry }) => {
				if (!query) return true;
				return [entry.term, ...entry.aliases].some((value) =>
					normalizeDictionaryKey(value).includes(query),
				);
			});
	}

	@derived get enabledCount(): number {
		return this.entries.filter((entry) => entry.enabled).length;
	}

	@derived get isEditable(): boolean {
		return (
			this.#daemon.connectionPhase === 'connected' &&
			this.phase !== 'loading' &&
			this.phase !== 'saving'
		);
	}

	@derived get operationTitle(): string {
		if (this.phase === 'error') return '词典操作失败';
		return '自动保存';
	}

	@derived get operationDescription(): string {
		if (this.phase === 'loading') return '正在读取 daemon 用户词典…';
		if (this.phase === 'saving') return '正在校验并保存用户词典…';
		if (this.phase === 'saved') return '更改已自动保存并应用。';
		if (this.phase === 'error') return this.errorMessage || '用户词典操作失败。';
		return '';
	}

	@effect syncDaemonConnection(): void {
		if (this.#daemon.connectionPhase === 'connected') {
			if (!this.#loaded) void this.load();
			return;
		}
		this.applyDisconnected();
	}

	/** 从 daemon 读取当前生效词典和状态。 */
	@action async load(): Promise<void> {
		if (this.#daemon.connectionPhase !== 'connected') return;
		const loadId = ++this.#loadId;
		this.phase = 'loading';
		this.errorMessage = undefined;
		try {
			const result = await this.#client.getDictionary();
			if (loadId !== this.#loadId) return;
			this.applyLoaded(result);
		} catch (error) {
			if (loadId !== this.#loadId) return;
			this.applyError(error);
		}
	}

	/** 让 daemon 重新读取独立词典文件。 */
	@action async reload(): Promise<void> {
		if (!this.isEditable) return;
		this.phase = 'loading';
		this.errorMessage = undefined;
		try {
			await this.#client.reloadDictionary();
			this.applyLoaded(await this.#client.getDictionary());
		} catch (error) {
			this.applyError(error);
		}
	}

	/** 更新列表搜索条件。 */
	@action updateSearchQuery(query: string): void {
		this.searchQuery = query;
	}

	/** 为新增词条创建不影响已生效词典的弹窗草稿。 */
	@action openNewEntry(): void {
		this.editingIndex = undefined;
		this.editorEntry = {
			term: '',
			aliases: [],
			protect: true,
			boost: 5,
			enabled: true,
		};
		this.editorError = undefined;
	}

	/** 为指定词条创建不影响已生效词典的弹窗草稿。 */
	@action openEntry(index: number): void {
		const entry = this.entries[index];
		if (!entry) return;
		this.editingIndex = index;
		this.editorEntry = structuredClone(toJS(entry));
		this.editorError = undefined;
	}

	/** 放弃弹窗内尚未提交的输入。 */
	@action closeEditor(): void {
		this.editingIndex = undefined;
		this.editorEntry = undefined;
		this.editorError = undefined;
	}

	/** 更新弹窗草稿，尚不修改已生效词典。 */
	@action updateEditor(entry: VoiceDictionaryEntry): void {
		this.editorEntry = entry;
		this.editorError = undefined;
	}

	/** 新增或替换当前弹窗词条，并立即持久化完整词典。 */
	@action async saveEditor(): Promise<boolean> {
		if (!this.isEditable || !this.dictionary || !this.editorEntry) return false;
		const entry = normalizeEntry(this.editorEntry);
		const candidate = structuredClone(toJS(this.dictionary));
		let targetIndex = this.editingIndex;
		if (targetIndex === undefined) {
			targetIndex = candidate.entries.length;
			candidate.entries.push(entry);
		} else {
			candidate.entries[targetIndex] = entry;
		}
		const rowError = validateRows(candidate.entries)[targetIndex];
		if (rowError) {
			this.editorError = rowError;
			return false;
		}
		const saved = await this.persist(candidate);
		if (saved) this.closeEditor();
		return saved;
	}

	/** 删除指定词条，并立即持久化完整词典。 */
	@action async deleteEntry(index: number): Promise<boolean> {
		if (!this.isEditable || !this.dictionary || !this.entries[index]) return false;
		const candidate = structuredClone(toJS(this.dictionary));
		candidate.entries.splice(index, 1);
		return this.persist(candidate);
	}

	/** 切换词条启用状态，并立即持久化完整词典。 */
	@action async setEntryEnabled(index: number, enabled: boolean): Promise<boolean> {
		if (!this.isEditable || !this.dictionary || !this.entries[index]) return false;
		const candidate = structuredClone(toJS(this.dictionary));
		candidate.entries[index]!.enabled = enabled;
		return this.persist(candidate);
	}

	/** 释放与 daemon 连接同步的响应式副作用。 */
	dispose(): void {
		this.#loadId += 1;
		disposeState(this);
	}

	@action private async persist(candidate: VoiceDictionary): Promise<boolean> {
		this.phase = 'saving';
		this.errorMessage = undefined;
		try {
			await this.#client.validateDictionary(candidate);
			await this.#client.updateDictionary(candidate);
			this.applyLoaded(await this.#client.getDictionary(), true);
			return true;
		} catch (error) {
			this.applyError(error);
			return false;
		}
	}

	@action private applyDisconnected(): void {
		this.#loadId += 1;
		this.#loaded = false;
		this.phase = 'idle';
		this.errorMessage = undefined;
	}

	@action private applyLoaded(result: DictionaryGetResult, saved = false): void {
		this.dictionary = result.dictionary;
		this.filePath = result.path;
		this.savedPromptCharacters = result.promptCharacters;
		this.phase = result.lastError ? 'error' : saved ? 'saved' : 'idle';
		this.errorMessage = result.lastError;
		this.#loaded = true;
	}

	@action private applyError(error: unknown): void {
		this.phase = 'error';
		this.errorMessage = describeDictionaryError(error);
	}
}

function normalizeEntry(entry: VoiceDictionaryEntry): VoiceDictionaryEntry {
	return {
		...entry,
		term: entry.term.trim(),
		aliases: entry.aliases.map((alias) => alias.trim()).filter(Boolean),
	};
}

function validateRows(entries: readonly VoiceDictionaryEntry[]): Record<number, string> {
	const errors: Record<number, string> = {};
	const owners = new Map<string, number>();
	entries.forEach((entry, index) => {
		if (!entry.term) errors[index] = '请输入标准写法。';
		for (const spelling of [entry.term, ...entry.aliases]) {
			if (!spelling) continue;
			const key = normalizeDictionaryKey(spelling);
			const owner = owners.get(key);
			if (owner === undefined) {
				owners.set(key, index);
				continue;
			}
			errors[owner] = '标准写法或别名存在重复冲突。';
			errors[index] = '标准写法或别名存在重复冲突。';
		}
	});
	return errors;
}

function describeDictionaryError(error: unknown): string {
	if (error instanceof ResponseError) {
		const data = error.data as ProtocolErrorData | undefined;
		if (data?.code === 'DICTIONARY_INVALID') return 'Daemon 拒绝了无效或冲突的词典。';
		if (data?.code === 'DICTIONARY_APPLY_FAILED') {
			return '词典无法保存或应用，上一份有效词典仍在使用。';
		}
	}
	return '无法完成词典操作，请检查 daemon 连接后重试。';
}
