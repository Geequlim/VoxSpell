import { action, derived, state, value } from './index';

import type { DaemonGetStatusResult } from '@voxspell/protocol/daemon';
import type { InitializeResult } from '@voxspell/protocol/initialize';

const RETRY_DELAYS_MS = [500, 1_000, 2_000, 5_000] as const;

export type DaemonConnectionPhase = 'disconnected' | 'connecting' | 'connected' | 'retrying';

export interface DaemonClient {
	connect(): Promise<InitializeResult>;
	getStatus(): Promise<DaemonGetStatusResult>;
	onDidDisconnect(listener: () => void): () => void;
	dispose(): void;
}

/** 同步 daemon 连接与配置状态到 GTK View。 */
@state
export class DaemonState {
	@value connectionPhase: DaemonConnectionPhase = 'disconnected';
	@value initializeResult: InitializeResult | undefined;
	@value status: DaemonGetStatusResult | undefined;
	@value lastError: string | undefined;
	readonly #client: DaemonClient;
	#removeDisconnectListener: (() => void) | undefined;
	#retryTimer: NodeJS.Timeout | undefined;
	#retryIndex = 0;
	#attemptId = 0;
	#started = false;
	#disposed = false;

	constructor(client: DaemonClient) {
		this.#client = client;
	}

	@derived get statusTitle(): string {
		if (this.connectionPhase === 'connecting') return '正在连接 Daemon';
		if (this.connectionPhase !== 'connected') return 'Daemon 未连接';
		if (this.status?.state === 'needs-configuration') return '需要完成配置';
		if (this.status?.state === 'degraded') return 'Daemon 运行异常';
		return 'Daemon 已连接';
	}

	@derived get statusDescription(): string {
		if (this.connectionPhase === 'connecting') return '正在连接本地 VoxSpell 服务。';
		if (this.connectionPhase !== 'connected') {
			return this.lastError ?? '请先在开发终端启动 daemon，桌面端会自动重试。';
		}
		if (this.status?.lastError) return this.status.lastError;
		if (this.status?.state === 'needs-configuration') {
			return 'Daemon 已运行，等待补充识别服务配置。';
		}
		const server = this.initializeResult?.serverInfo;
		return server ? `${server.name} ${server.version}` : '本地服务运行正常。';
	}

	@derived get statusIconName(): string {
		if (this.connectionPhase !== 'connected') return 'network-offline-symbolic';
		if (this.status?.state === 'degraded') return 'dialog-warning-symbolic';
		if (this.status?.state === 'needs-configuration') return 'preferences-system-symbolic';
		return 'emblem-ok-symbolic';
	}

	@derived get retryVisible(): boolean {
		return this.connectionPhase === 'disconnected' || this.connectionPhase === 'retrying';
	}

	/** 开始连接，并订阅后续意外断开。 */
	start(): void {
		if (this.#started || this.#disposed) return;
		this.#started = true;
		this.#removeDisconnectListener = this.#client.onDidDisconnect(() =>
			this.handleDisconnect(),
		);
		void this.connect();
	}

	/** 立即取消等待并重新发起连接。 */
	@action retry(): void {
		if (this.#disposed || this.connectionPhase === 'connecting') return;
		this.#clearRetry();
		this.#retryIndex = 0;
		void this.connect();
	}

	/** 释放重试计时器和 RPC 客户端。 */
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#attemptId += 1;
		this.#clearRetry();
		this.#removeDisconnectListener?.();
		this.#removeDisconnectListener = undefined;
		this.#client.dispose();
	}

	private async connect(): Promise<void> {
		const attemptId = ++this.#attemptId;
		this.markConnecting();
		try {
			const initializeResult = await this.#client.connect();
			const status = await this.#client.getStatus();
			if (this.#disposed || attemptId !== this.#attemptId) return;
			this.markConnected(initializeResult, status);
		} catch (error) {
			if (this.#disposed || attemptId !== this.#attemptId) return;
			this.markFailed(error);
			this.#scheduleRetry();
		}
	}

	@action private markConnecting(): void {
		this.connectionPhase = 'connecting';
		this.lastError = undefined;
	}

	@action private markConnected(
		initializeResult: InitializeResult,
		status: DaemonGetStatusResult,
	): void {
		this.connectionPhase = 'connected';
		this.initializeResult = initializeResult;
		this.status = status;
		this.lastError = undefined;
		this.#retryIndex = 0;
	}

	@action private markFailed(error: unknown): void {
		this.connectionPhase = 'retrying';
		this.initializeResult = undefined;
		this.status = undefined;
		this.lastError = describeConnectionError(error);
	}

	@action private handleDisconnect(): void {
		if (this.#disposed) return;
		this.#attemptId += 1;
		this.connectionPhase = 'retrying';
		this.initializeResult = undefined;
		this.status = undefined;
		this.lastError = '与 daemon 的连接已断开，正在重试。';
		this.#scheduleRetry();
	}

	#scheduleRetry(): void {
		if (this.#disposed || this.#retryTimer) return;
		const delayIndex = Math.min(this.#retryIndex, RETRY_DELAYS_MS.length - 1);
		const delay = RETRY_DELAYS_MS[delayIndex];
		this.#retryIndex += 1;
		this.#retryTimer = setTimeout(() => {
			this.#retryTimer = undefined;
			void this.connect();
		}, delay);
	}

	#clearRetry(): void {
		if (!this.#retryTimer) return;
		clearTimeout(this.#retryTimer);
		this.#retryTimer = undefined;
	}
}

function describeConnectionError(error: unknown): string {
	if (isNodeError(error) && (error.code === 'ENOENT' || error.code === 'ECONNREFUSED')) {
		return 'Daemon 尚未启动，请先运行开发服务。';
	}
	if (error instanceof Error && error.message) return `连接失败：${error.message}`;
	return '无法连接本地 daemon。';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && 'code' in error;
}
