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

	@derived get isEditable(): boolean {
		return this.phase !== 'loading' && this.phase !== 'saving' && Boolean(this.draft);
	}

	@derived get isDirty(): boolean {
		return JSON.stringify(this.config) !== JSON.stringify(this.draft);
	}

	@derived get canSave(): boolean {
		return this.isEditable && this.isDirty;
	}

	@derived get operationDescription(): string {
		if (this.phase === 'loading') return '正在读取 Fcitx 输入行为配置…';
		if (this.phase === 'saving') return '正在保存并应用输入行为配置…';
		if (this.phase === 'saved') return '输入行为已保存并应用。';
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
		this.clearOperationResult();
	}

	/** 更新触发语音模式所需的长按时间。 */
	@action updateHoldThreshold(holdThresholdMs: number): void {
		if (!this.draft) return;
		this.draft = { ...this.draft, holdThresholdMs };
		this.clearOperationResult();
	}

	/** 设置是否自动提交推荐结果。 */
	@action updateAutoSelectResult(autoSelectResult: boolean): void {
		if (!this.draft) return;
		this.draft = { ...this.draft, autoSelectResult };
		this.clearOperationResult();
	}

	/** 丢弃当前未保存的输入行为修改。 */
	@action discard(): void {
		if (!this.config) return;
		this.draft = { ...this.config };
		this.clearOperationResult();
	}

	/** 校验、保存并立即应用输入行为配置。 */
	@action async save(): Promise<void> {
		if (!this.canSave || !this.draft) return;
		const pttKey = this.draft.pttKey.trim();
		if (!pttKey) {
			this.phase = 'error';
			this.errorMessage = '请设置 PTT 热键。';
			return;
		}
		const candidate = { ...this.draft, pttKey };
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
		this.draft = { ...config };
		this.phase = 'saved';
	}

	@action private applyError(error: unknown): void {
		this.phase = 'error';
		this.errorMessage = describeError(error);
	}

	private clearOperationResult(): void {
		this.phase = 'idle';
		this.errorMessage = undefined;
	}
}

function describeError(error: unknown): string {
	if (error instanceof Error && error.message) return `Fcitx 配置操作失败：${error.message}`;
	return '无法访问 Fcitx 输入行为配置。';
}
