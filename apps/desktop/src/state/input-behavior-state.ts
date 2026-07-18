import { action, derived, state, value } from './index';

import type { InputBehaviorConfig } from '../fcitx/input-behavior-client';

export type InputBehaviorPhase = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

export interface InputBehaviorClient {
	getInputBehavior(): Promise<InputBehaviorConfig>;
	updateInputBehavior(config: InputBehaviorConfig): Promise<void>;
}

/** 管理 Fcitx 插件输入行为配置及其编辑草稿。 */
@state
export class InputBehaviorState {
	@value config?: InputBehaviorConfig;
	@value draft?: InputBehaviorConfig;
	@value phase: InputBehaviorPhase = 'idle';
	@value errorMessage?: string;
	readonly #client: InputBehaviorClient;
	#loadId = 0;
	#started = false;
	#disposed = false;
	#saveTimer?: NodeJS.Timeout;
	#savePromise?: Promise<void>;
	#saveRequested = false;

	constructor(client: InputBehaviorClient) {
		this.#client = client;
	}

	@derived get pttKey(): string {
		return this.draft?.pttKey ?? '';
	}

	@derived get holdThresholdMs(): number {
		return this.draft?.holdThresholdMs ?? 200;
	}

	@derived get autoSelectResult(): boolean {
		return this.draft?.autoSelectResult ?? true;
	}

	@derived get polishingToggleKey(): string {
		return this.draft?.polishingToggleKey ?? '';
	}

	@derived get isEditable(): boolean {
		return this.phase !== 'loading' && Boolean(this.draft);
	}

	@derived get isDirty(): boolean {
		return JSON.stringify(this.config) !== JSON.stringify(this.draft);
	}

	@derived get operationDescription(): string {
		if (this.phase === 'loading') return '正在读取 Fcitx 输入行为配置…';
		if (this.phase === 'saving') return '正在自动保存并应用输入行为配置…';
		if (this.phase === 'saved') return '更改已自动保存并应用。';
		if (this.phase === 'error') return this.errorMessage ?? '输入行为配置操作失败。';
		return '';
	}

	/** 首次启动桌面窗口时读取 Fcitx 配置。 */
	start(): void {
		if (this.#started) return;
		this.#started = true;
		void this.load();
	}

	/** 从 Fcitx 重新读取当前配置。 */
	@action async load(): Promise<void> {
		const loadId = ++this.#loadId;
		this.phase = 'loading';
		this.errorMessage = undefined;
		try {
			const config = await this.#client.getInputBehavior();
			if (loadId !== this.#loadId) return;
			this.applyLoaded(config);
		} catch (error) {
			if (loadId !== this.#loadId) return;
			this.applyError(error);
		}
	}

	/** 更新 PTT 热键的 Fcitx 键名。 */
	@action updatePttKey(pttKey: string): void {
		if (!this.draft) return;
		this.draft = { ...this.draft, pttKey };
		this.scheduleAutoSave();
	}

	/** 更新触发语音模式所需的长按时间。 */
	@action updateHoldThreshold(holdThresholdMs: number): void {
		if (!this.draft) return;
		this.draft = { ...this.draft, holdThresholdMs };
		this.scheduleAutoSave(300);
	}

	/** 设置是否自动提交推荐结果。 */
	@action updateAutoSelectResult(autoSelectResult: boolean): void {
		if (!this.draft) return;
		this.draft = { ...this.draft, autoSelectResult };
		this.scheduleAutoSave();
	}

	/** 更新本轮 AI 润色切换键。 */
	@action updatePolishingToggleKey(polishingToggleKey: string): void {
		if (!this.draft) return;
		this.draft = { ...this.draft, polishingToggleKey };
		this.scheduleAutoSave();
	}

	/** 立即提交尚未触发的自动保存任务。 */
	async flushPendingChanges(): Promise<void> {
		if (this.#saveTimer) {
			clearTimeout(this.#saveTimer);
			this.#saveTimer = undefined;
		}
		if (!this.isDirty || this.#disposed) return;
		this.#saveRequested = true;
		if (this.#savePromise) return this.#savePromise;
		const savePromise = this.runAutoSaveLoop();
		this.#savePromise = savePromise;
		try {
			await savePromise;
		} finally {
			if (this.#savePromise === savePromise) this.#savePromise = undefined;
		}
	}

	/** 停止尚未开始的自动保存任务。 */
	dispose(): void {
		this.#disposed = true;
		this.#loadId += 1;
		if (this.#saveTimer) clearTimeout(this.#saveTimer);
		this.#saveTimer = undefined;
	}

	private scheduleAutoSave(delayMilliseconds = 0): void {
		if (this.#disposed) return;
		if (this.#saveTimer) clearTimeout(this.#saveTimer);
		this.clearOperationResult();
		this.#saveTimer = setTimeout(() => {
			this.#saveTimer = undefined;
			void this.flushPendingChanges();
		}, delayMilliseconds);
	}

	private async runAutoSaveLoop(): Promise<void> {
		while (this.#saveRequested && !this.#disposed) {
			this.#saveRequested = false;
			await this.persistCurrentDraft();
		}
	}

	@action private async persistCurrentDraft(): Promise<void> {
		if (!this.draft || !this.isDirty) return;
		const pttKey = this.draft.pttKey.trim();
		const polishingToggleKey = this.draft.polishingToggleKey.trim();
		if (!pttKey) {
			this.phase = 'error';
			this.errorMessage = '请设置 PTT 热键。';
			return;
		}
		if (!polishingToggleKey) {
			this.phase = 'error';
			this.errorMessage = '请设置润色切换键。';
			return;
		}
		const candidate = { ...this.draft, pttKey, polishingToggleKey };
		this.phase = 'saving';
		this.errorMessage = undefined;
		try {
			await this.#client.updateInputBehavior(candidate);
			this.applySaved(candidate);
		} catch (error) {
			this.applyError(error);
		}
	}

	@action private applyLoaded(config: InputBehaviorConfig): void {
		this.config = { ...config };
		this.draft = { ...config };
		this.phase = 'idle';
		this.errorMessage = undefined;
	}

	@action private applySaved(config: InputBehaviorConfig): void {
		this.config = { ...config };
		if (JSON.stringify(this.draft) === JSON.stringify(config)) this.draft = { ...config };
		this.phase = this.isDirty ? 'idle' : 'saved';
	}

	@action private applyError(error: unknown): void {
		this.phase = 'error';
		this.errorMessage = describeError(error);
	}

	private clearOperationResult(): void {
		if (this.phase !== 'saving') this.phase = 'idle';
		this.errorMessage = undefined;
	}
}

function describeError(error: unknown): string {
	if (error instanceof Error && error.message) return `Fcitx 配置操作失败：${error.message}`;
	return '无法访问 Fcitx 输入行为配置。';
}
