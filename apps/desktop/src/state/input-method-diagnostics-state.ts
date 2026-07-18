import { action, state, value } from './index';

import type { InputMethodDiagnostics } from '../fcitx/input-behavior-client';

export type InputMethodDiagnosticsPhase = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface InputMethodDiagnosticsClient {
	getInputMethodDiagnostics(): Promise<InputMethodDiagnostics>;
}

/** 管理不依赖 daemon 的桌面输入法环境诊断。 */
@state
export class InputMethodDiagnosticsState {
	@value phase: InputMethodDiagnosticsPhase = 'idle';
	@value diagnostics?: InputMethodDiagnostics;
	@value errorMessage?: string;
	readonly #client: InputMethodDiagnosticsClient;
	#refreshId = 0;
	#started = false;
	#disposed = false;

	constructor(client: InputMethodDiagnosticsClient) {
		this.#client = client;
	}

	/** 首次启动桌面窗口时检查输入法环境。 */
	start(): void {
		if (this.#started || this.#disposed) return;
		this.#started = true;
		void this.refresh();
	}

	/** 重新从 Fcitx D-Bus 读取当前能力状态。 */
	@action async refresh(): Promise<void> {
		if (this.#disposed) return;
		const refreshId = ++this.#refreshId;
		this.phase = 'loading';
		this.errorMessage = undefined;
		try {
			const diagnostics = await this.#client.getInputMethodDiagnostics();
			if (this.#disposed || refreshId !== this.#refreshId) return;
			this.applyDiagnostics(diagnostics);
		} catch (error) {
			if (this.#disposed || refreshId !== this.#refreshId) return;
			this.applyUnavailable(error);
		}
	}

	/** 忽略尚未返回的诊断结果。 */
	dispose(): void {
		this.#disposed = true;
		this.#refreshId += 1;
	}

	@action private applyDiagnostics(diagnostics: InputMethodDiagnostics): void {
		this.diagnostics = diagnostics;
		this.phase = 'ready';
		this.errorMessage = undefined;
	}

	@action private applyUnavailable(error: unknown): void {
		this.diagnostics = undefined;
		this.phase = 'unavailable';
		if (error instanceof Error && error.message) {
			this.errorMessage = `无法访问 Fcitx 5：${error.message}`;
			return;
		}
		this.errorMessage = '无法访问 Fcitx 5。';
	}
}
