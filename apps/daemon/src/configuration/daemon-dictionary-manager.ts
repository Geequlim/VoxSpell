import { watch } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { createEmptyVoiceDictionary } from '@voxspell/config/dictionary-schema';
import {
	loadVoiceDictionary,
	parseVoiceDictionary,
	VoiceDictionaryNotFoundError,
} from '@voxspell/config/load-dictionary';
import { saveVoiceDictionary } from '@voxspell/config/save-dictionary';
import { CompiledVoiceDictionary } from '@voxspell/text-pipeline/voice-dictionary';
import { composePolishDictionaryPrompt } from '@voxspell/ai-polisher/polish-system-prompt';

import type { FSWatcher } from 'node:fs';
import type { VoiceDictionary } from '@voxspell/config/dictionary-schema';
import type { DictionaryGetResult } from '@voxspell/protocol/dictionary';

const RELOAD_DEBOUNCE_MILLISECONDS = 100;

/** 管理独立语音词典文件、编译快照与文件热加载。 */
export class DaemonDictionaryManager {
	readonly #filePath: string;
	#dictionary: VoiceDictionary = createEmptyVoiceDictionary();
	#compiled = new CompiledVoiceDictionary(this.#dictionary);
	#lastError?: string;
	#watcher?: FSWatcher;
	#reloadTimer?: NodeJS.Timeout;
	#operation = Promise.resolve();

	constructor(filePath: string) {
		this.#filePath = filePath;
	}

	/** 首次加载词典；文件不存在时使用空词典。 */
	async initialize(): Promise<void> {
		try {
			await this.reload();
		} catch (error) {
			if (!(error instanceof VoiceDictionaryNotFoundError)) return;
			this.#lastError = undefined;
		}
	}

	/** 监听词典目录并在文件替换后重新加载。 */
	async startWatching(): Promise<void> {
		if (this.#watcher) return;
		const directory = path.dirname(this.#filePath);
		await mkdir(directory, { recursive: true, mode: 0o700 });
		this.#watcher = watch(directory, (_event, fileName) => {
			if (fileName?.toString() !== path.basename(this.#filePath)) return;
			if (this.#reloadTimer) clearTimeout(this.#reloadTimer);
			this.#reloadTimer = setTimeout(() => {
				this.#reloadTimer = undefined;
				void this.reload().catch(() => undefined);
			}, RELOAD_DEBOUNCE_MILLISECONDS);
		});
	}

	/** 从磁盘加载并仅在校验和编译成功后切换快照。 */
	async reload(): Promise<void> {
		await this.#enqueue(async () => {
			try {
				const dictionary = await loadVoiceDictionary(this.#filePath);
				this.#apply(dictionary, new CompiledVoiceDictionary(dictionary));
			} catch (error) {
				this.#lastError = describeDictionaryError(error);
				throw error;
			}
		});
	}

	/** 校验和编译候选词典，但不保存。 */
	async validate(dictionary: VoiceDictionary): Promise<void> {
		await this.#enqueue(async () => {
			const validated = parseVoiceDictionary(dictionary);
			new CompiledVoiceDictionary(validated);
		});
	}

	/** 原子保存候选词典并切换当前快照。 */
	async update(dictionary: VoiceDictionary): Promise<void> {
		await this.#enqueue(async () => {
			const validated = parseVoiceDictionary(dictionary);
			const compiled = new CompiledVoiceDictionary(validated);
			await saveVoiceDictionary(this.#filePath, validated);
			this.#apply(validated, compiled);
		});
	}

	/** 返回当前生效词典及脱敏加载状态。 */
	getState(): DictionaryGetResult {
		const dictionaryPrompt = composePolishDictionaryPrompt(this.#compiled.entries);
		return {
			dictionary: structuredClone(this.#dictionary),
			path: this.#filePath,
			enabledCount: this.#compiled.entries.length,
			promptCharacters: dictionaryPrompt?.length ?? 0,
			lastError: this.#lastError,
		};
	}

	/** 返回供一次会话固定持有的不可变编译快照。 */
	getSnapshot(): CompiledVoiceDictionary {
		return this.#compiled;
	}

	/** 停止文件监听和待执行的重载。 */
	dispose(): void {
		if (this.#reloadTimer) clearTimeout(this.#reloadTimer);
		this.#reloadTimer = undefined;
		this.#watcher?.close();
		this.#watcher = undefined;
	}

	#apply(dictionary: VoiceDictionary, compiled: CompiledVoiceDictionary): void {
		this.#dictionary = structuredClone(dictionary);
		this.#compiled = compiled;
		this.#lastError = undefined;
	}

	#enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.#operation.then(operation, operation);
		this.#operation = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}

function describeDictionaryError(error: unknown): string {
	return error instanceof Error ? error.message : 'Unknown voice dictionary error';
}
