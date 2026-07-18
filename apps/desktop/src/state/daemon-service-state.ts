import { action, derived, state, value } from './index';

import type { DaemonServiceClient, DaemonServiceStatus } from '../daemon-service-client';

export type DaemonServicePhase =
	| 'idle'
	| 'loading'
	| 'starting'
	| 'restarting'
	| 'updating-autostart'
	| 'error';

/** 管理 daemon systemd 用户服务的桌面界面状态。 */
@state
export class DaemonServiceState {
	@value status?: DaemonServiceStatus;
	@value phase: DaemonServicePhase = 'idle';
	@value errorMessage?: string;
	readonly #client: DaemonServiceClient;
	#operationId = 0;
	#started = false;
	#disposed = false;

	constructor(client: DaemonServiceClient) {
		this.#client = client;
	}

	@derived get enabled(): boolean {
		return this.status?.enabled ?? false;
	}

	@derived get running(): boolean {
		return this.status?.running ?? false;
	}

	@derived get isBusy(): boolean {
		return this.phase !== 'idle' && this.phase !== 'error';
	}

	@derived get isControllable(): boolean {
		return Boolean(this.status) && !this.isBusy;
	}

	@derived get primaryActionLabel(): string {
		if (this.phase === 'starting') return '正在启动';
		if (this.phase === 'restarting') return '正在重启';
		return this.running ? '重启' : '启动';
	}

	@derived get operationDescription(): string {
		if (this.phase === 'loading') return '正在读取 daemon 服务状态…';
		if (this.phase === 'starting') return '正在启动 daemon…';
		if (this.phase === 'restarting') return '正在重启 daemon…';
		if (this.phase === 'updating-autostart') return '正在更新开机启动设置…';
		if (this.phase === 'error') return this.errorMessage ?? 'Daemon 服务操作失败。';
		return '';
	}

	/** 首次启动桌面窗口时读取 daemon 服务状态。 */
	start(): void {
		if (this.#started || this.#disposed) return;
		this.#started = true;
		void this.refresh();
	}

	/** 重新读取 daemon 服务状态。 */
	async refresh(): Promise<void> {
		if (this.#disposed || this.isBusy) return;
		const operationId = ++this.#operationId;
		this.markOperation('loading');
		try {
			const status = await this.#client.getStatus();
			if (this.#disposed || operationId !== this.#operationId) return;
			this.applyStatus(status);
		} catch (error) {
			if (this.#disposed || operationId !== this.#operationId) return;
			this.applyError(error);
		}
	}

	/** 根据当前状态启动或重启 daemon。 */
	async runPrimaryAction(): Promise<boolean> {
		if (!this.status || this.isBusy || this.#disposed) return false;
		const operationId = ++this.#operationId;
		const wasRunning = this.status.running;
		this.markOperation(wasRunning ? 'restarting' : 'starting');
		try {
			if (wasRunning) await this.#client.restart();
			else await this.#client.start();
			const status = await this.#client.getStatus();
			if (this.#disposed || operationId !== this.#operationId) return false;
			this.applyStatus(status);
			return true;
		} catch (error) {
			if (this.#disposed || operationId !== this.#operationId) return false;
			this.applyError(error);
			return false;
		}
	}

	/** 更新开机启动设置，不停止当前 daemon。 */
	async setEnabled(enabled: boolean): Promise<void> {
		if (!this.status || this.isBusy || this.#disposed || enabled === this.status.enabled)
			return;
		const operationId = ++this.#operationId;
		this.markOperation('updating-autostart');
		try {
			await this.#client.setEnabled(enabled);
			const status = await this.#client.getStatus();
			if (this.#disposed || operationId !== this.#operationId) return;
			this.applyStatus(status);
		} catch (error) {
			if (this.#disposed || operationId !== this.#operationId) return;
			this.applyError(error);
		}
	}

	/** 忽略仍在进行的服务状态操作。 */
	dispose(): void {
		this.#disposed = true;
		this.#operationId += 1;
	}

	@action private markOperation(phase: Exclude<DaemonServicePhase, 'error' | 'idle'>): void {
		this.phase = phase;
		this.errorMessage = undefined;
	}

	@action private applyStatus(status: DaemonServiceStatus): void {
		this.status = status;
		this.phase = 'idle';
		this.errorMessage = undefined;
	}

	@action private applyError(error: unknown): void {
		this.phase = 'error';
		if (error instanceof Error && error.message) {
			this.errorMessage = `Daemon 服务操作失败：${error.message}`;
			return;
		}
		this.errorMessage = '无法访问 daemon 的 systemd 用户服务。';
	}
}
