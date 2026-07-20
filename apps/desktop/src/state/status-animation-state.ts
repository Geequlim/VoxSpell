import { validateStatusAnimationSource } from '../status-animation-config-client';
import { action, derived, state, value } from './index';

import type { StatusAnimationConfigClient } from '../status-animation-config-client';

export type StatusAnimationPhase = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

/** 管理状态动画 JSON 草稿及自动保存。 */
@state
export class StatusAnimationState {
	@value source = '';
	@value draft = '';
	@value hasCustomConfig = false;
	@value phase: StatusAnimationPhase = 'idle';
	@value errorMessage?: string;
	readonly #client: StatusAnimationConfigClient;
	#loadId = 0;
	#started = false;
	#disposed = false;
	#saveTimer?: NodeJS.Timeout;
	#savePromise?: Promise<void>;
	#saveRequested = false;

	constructor(client: StatusAnimationConfigClient) {
		this.#client = client;
	}

	@derived get isEditable(): boolean {
		return this.phase !== 'loading';
	}

	@derived get isDirty(): boolean {
		return this.source !== this.draft;
	}

	@derived get operationDescription(): string {
		if (this.phase === 'loading') return '正在读取状态动画配置…';
		if (this.phase === 'saving') return '配置有效，正在自动保存并应用…';
		if (this.phase === 'saved') return '配置已自动保存并应用。';
		if (this.phase === 'error') return this.errorMessage ?? '状态动画配置操作失败。';
		if (!this.hasCustomConfig) return '当前使用内置默认动画。';
		return '';
	}

	/** 首次启动桌面窗口时读取状态动画配置。 */
	start(): void {
		if (this.#started) return;
		this.#started = true;
		void this.load();
	}

	/** 从用户配置目录重新读取状态动画 JSON。 */
	@action async load(): Promise<void> {
		const loadId = ++this.#loadId;
		this.phase = 'loading';
		this.errorMessage = undefined;
		try {
			const snapshot = await this.#client.getStatusAnimationSource();
			if (loadId !== this.#loadId) return;
			this.source = snapshot.source;
			this.draft = snapshot.source;
			this.hasCustomConfig = snapshot.custom;
			validateStatusAnimationSource(snapshot.source);
			this.phase = 'idle';
		} catch (error) {
			if (loadId !== this.#loadId) return;
			this.applyError(error);
		}
	}

	/** 更新 JSON 草稿，并在停止输入后自动校验和保存。 */
	@action updateDraft(source: string): void {
		this.draft = source;
		this.scheduleAutoSave();
	}

	/** 使用系统默认浏览器打开状态动画编辑器。 */
	@action async openEditor(): Promise<void> {
		try {
			await this.#client.openStatusAnimationEditor();
		} catch (error) {
			this.applyError(error, '无法打开状态动画编辑器');
		}
	}

	/** 删除自定义配置并恢复内置默认动画。 */
	@action async reset(): Promise<void> {
		if (!this.hasCustomConfig || this.phase === 'saving') return;
		this.cancelScheduledSave();
		this.phase = 'saving';
		this.errorMessage = undefined;
		try {
			const snapshot = await this.#client.resetStatusAnimation();
			this.source = snapshot.source;
			this.draft = snapshot.source;
			this.hasCustomConfig = snapshot.custom;
			this.phase = 'saved';
		} catch (error) {
			this.applyError(error);
		}
	}

	/** 立即提交尚未触发的自动保存任务。 */
	async flushPendingChanges(): Promise<void> {
		this.cancelScheduledSave();
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
		this.cancelScheduledSave();
	}

	private scheduleAutoSave(): void {
		if (this.#disposed) return;
		this.cancelScheduledSave();
		if (this.phase !== 'saving') this.phase = 'idle';
		this.errorMessage = undefined;
		this.#saveTimer = setTimeout(() => {
			this.#saveTimer = undefined;
			void this.flushPendingChanges();
		}, 500);
	}

	private cancelScheduledSave(): void {
		if (this.#saveTimer) clearTimeout(this.#saveTimer);
		this.#saveTimer = undefined;
	}

	private async runAutoSaveLoop(): Promise<void> {
		while (this.#saveRequested && !this.#disposed) {
			this.#saveRequested = false;
			await this.persistCurrentDraft();
		}
	}

	@action private async persistCurrentDraft(): Promise<void> {
		if (!this.isDirty) return;
		let source;
		try {
			source = validateStatusAnimationSource(this.draft);
		} catch (error) {
			this.applyError(error, '配置未保存');
			return;
		}
		this.phase = 'saving';
		this.errorMessage = undefined;
		try {
			await this.#client.updateStatusAnimation(source);
			this.source = source;
			this.hasCustomConfig = true;
			this.phase = this.isDirty ? 'idle' : 'saved';
		} catch (error) {
			this.applyError(error);
		}
	}

	@action private applyError(error: unknown, prefix = '状态动画配置操作失败'): void {
		this.phase = 'error';
		if (error instanceof Error && error.message) {
			this.errorMessage = `${prefix}：${error.message}`;
			return;
		}
		this.errorMessage = `${prefix}。`;
	}
}
