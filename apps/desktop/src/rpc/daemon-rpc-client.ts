import { createConnection } from 'node:net';

import { PROTOCOL_VERSION } from '@voxspell/protocol/common';
import {
	DaemonGetStatusRequest,
	DaemonGetStatusResultSchema,
	DaemonPingRequest,
	DaemonPingResultSchema,
} from '@voxspell/protocol/daemon';
import { InitializeRequest, InitializeResultSchema } from '@voxspell/protocol/initialize';
import { validateProtocolValue } from '@voxspell/protocol/validation';
import {
	StreamMessageReader,
	StreamMessageWriter,
	createMessageConnection,
} from 'vscode-jsonrpc/node';

import type { Socket } from 'node:net';
import type { DaemonGetStatusResult, DaemonPingResult } from '@voxspell/protocol/daemon';
import type { InitializeResult } from '@voxspell/protocol/initialize';
import type { MessageConnection } from 'vscode-jsonrpc/node';

const DEFAULT_CONNECT_TIMEOUT_MS = 2_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 3_000;

export interface DaemonRpcClientOptions {
	readonly socketPath: string;
	readonly connectTimeoutMs?: number;
	readonly requestTimeoutMs?: number;
}

/** 表示 daemon RPC 操作超过桌面端允许的等待时间。 */
export class DaemonRpcTimeoutError extends Error {
	constructor(operation: string) {
		super(`${operation} timed out`);
		this.name = 'DaemonRpcTimeoutError';
	}
}

/** 管理桌面进程到 daemon 的单条 JSON-RPC 连接。 */
export class DaemonRpcClient {
	readonly #socketPath: string;
	readonly #connectTimeoutMs: number;
	readonly #requestTimeoutMs: number;
	readonly #disconnectListeners = new Set<() => void>();
	#socket: Socket | undefined;
	#connection: MessageConnection | undefined;
	#initializeResult: InitializeResult | undefined;
	#connectPromise: Promise<InitializeResult> | undefined;
	#disposed = false;

	constructor(options: DaemonRpcClientOptions) {
		this.#socketPath = options.socketPath;
		this.#connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
		this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
	}

	/** 连接 daemon 并完成协议握手。 */
	async connect(): Promise<InitializeResult> {
		if (this.#disposed) throw new Error('DaemonRpcClient has been disposed');
		if (this.#initializeResult) return this.#initializeResult;
		if (this.#connectPromise) return this.#connectPromise;

		this.#connectPromise = this.#connectAndInitialize();
		try {
			return await this.#connectPromise;
		} finally {
			this.#connectPromise = undefined;
		}
	}

	/** 请求 daemon 健康探针。 */
	async ping(): Promise<DaemonPingResult> {
		const connection = this.#requireConnection();
		try {
			const result = await this.#requestWithTimeout(
				connection.sendRequest(DaemonPingRequest, {}),
				'daemon.ping',
			);
			return validateProtocolValue(DaemonPingResultSchema, result);
		} catch (error) {
			this.#resetConnection(true);
			throw error;
		}
	}

	/** 获取 daemon 当前配置状态。 */
	async getStatus(): Promise<DaemonGetStatusResult> {
		const connection = this.#requireConnection();
		try {
			const result = await this.#requestWithTimeout(
				connection.sendRequest(DaemonGetStatusRequest, {}),
				'daemon.getStatus',
			);
			return validateProtocolValue(DaemonGetStatusResultSchema, result);
		} catch (error) {
			this.#resetConnection(true);
			throw error;
		}
	}

	/** 监听已建立连接的意外断开。 */
	onDidDisconnect(listener: () => void): () => void {
		this.#disconnectListeners.add(listener);
		return () => this.#disconnectListeners.delete(listener);
	}

	/** 关闭连接并禁止后续请求。 */
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#disconnectListeners.clear();
		this.#resetConnection(false);
	}

	async #connectAndInitialize(): Promise<InitializeResult> {
		const socket = await this.#openSocket();
		if (this.#disposed) {
			socket.destroy();
			throw new Error('DaemonRpcClient has been disposed');
		}

		const connection = createMessageConnection(
			new StreamMessageReader(socket),
			new StreamMessageWriter(socket),
		);
		this.#socket = socket;
		this.#connection = connection;
		socket.on('error', () => undefined);
		socket.once('close', () => {
			if (this.#socket !== socket) return;
			this.#socket = undefined;
			this.#connection = undefined;
			this.#initializeResult = undefined;
			connection.dispose();
			if (!this.#disposed) this.#disconnectListeners.forEach((listener) => listener());
		});
		connection.listen();

		try {
			const result = await this.#requestWithTimeout(
				connection.sendRequest(InitializeRequest, {
					protocolVersion: PROTOCOL_VERSION,
					clientInfo: { name: 'voxspell-desktop', version: '0.0.0' },
				}),
				'initialize',
			);
			this.#initializeResult = validateProtocolValue(InitializeResultSchema, result);
			return this.#initializeResult;
		} catch (error) {
			this.#resetConnection(false);
			throw error;
		}
	}

	#openSocket(): Promise<Socket> {
		return new Promise((resolve, reject) => {
			const socket = createConnection(this.#socketPath);
			const timeout = setTimeout(() => {
				cleanup();
				socket.destroy();
				reject(new DaemonRpcTimeoutError('connect'));
			}, this.#connectTimeoutMs);
			const onConnect = () => {
				cleanup();
				resolve(socket);
			};
			const onError = (error: Error) => {
				cleanup();
				socket.destroy();
				reject(error);
			};
			const cleanup = () => {
				clearTimeout(timeout);
				socket.off('connect', onConnect);
				socket.off('error', onError);
			};
			socket.once('connect', onConnect);
			socket.once('error', onError);
		});
	}

	#requireConnection(): MessageConnection {
		if (!this.#connection || !this.#initializeResult) {
			throw new Error('Daemon RPC is not connected');
		}
		return this.#connection;
	}

	#requestWithTimeout<T>(request: Promise<T>, operation: string): Promise<T> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new DaemonRpcTimeoutError(operation)),
				this.#requestTimeoutMs,
			);
			request.then(
				(result) => {
					clearTimeout(timeout);
					resolve(result);
				},
				(error: unknown) => {
					clearTimeout(timeout);
					reject(error);
				},
			);
		});
	}

	#resetConnection(notify: boolean): void {
		const socket = this.#socket;
		const connection = this.#connection;
		const wasConnected = this.#initializeResult !== undefined;
		this.#socket = undefined;
		this.#connection = undefined;
		this.#initializeResult = undefined;
		connection?.dispose();
		socket?.destroy();
		if (notify && wasConnected) this.#disconnectListeners.forEach((listener) => listener());
	}
}
