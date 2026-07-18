import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import { createServer, createConnection } from 'node:net';
import path from 'node:path';

import type { Server, Socket } from 'node:net';

export interface UnixSocketClient {
	dispose(): Promise<void>;
}

export interface UnixSocketServerOptions {
	readonly socketPath: string;
	readonly createClient: (socket: Socket) => UnixSocketClient;
	readonly onError?: (error: Error) => void;
}

interface SocketIdentity {
	readonly device: number;
	readonly inode: number;
}

interface ActiveClient {
	readonly socket: Socket;
	readonly client: UnixSocketClient;
	disposeOperation?: Promise<void>;
}

/** 表示目标 socket 已由另一个 daemon 监听。 */
export class DaemonAlreadyRunningError extends Error {
	constructor(socketPath: string) {
		super(`A daemon is already listening on ${socketPath}`);
		this.name = 'DaemonAlreadyRunningError';
	}
}

/** 表示 socket 路径被普通文件或其他不安全节点占用。 */
export class UnsafeSocketPathError extends Error {
	constructor(socketPath: string) {
		super(`Refusing to replace non-socket path ${socketPath}`);
		this.name = 'UnsafeSocketPathError';
	}
}

/** 判断文件系统错误是否携带指定错误码。 */
function hasErrorCode(error: unknown, code: string): error is NodeJS.ErrnoException {
	return error instanceof Error && 'code' in error && error.code === code;
}

/** 探测 Unix Socket 路径是否仍有进程监听。 */
async function isSocketAlive(socketPath: string): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(socketPath);
		let settled = false;

		const settle = (result: boolean, error?: Error): void => {
			if (settled) return;
			settled = true;
			socket.destroy();
			if (error) reject(error);
			else resolve(result);
		};

		socket.once('connect', () => settle(true));
		socket.once('error', (error) => {
			if (hasErrorCode(error, 'ECONNREFUSED') || hasErrorCode(error, 'ENOENT')) {
				settle(false);
				return;
			}
			settle(false, error);
		});
		socket.setTimeout(500, () => settle(true));
	});
}

/** 管理安全目录、单客户端和生命周期清理的 Unix Socket 服务。 */
export class UnixSocketServer {
	readonly #socketPath: string;
	readonly #createClient: (socket: Socket) => UnixSocketClient;
	readonly #onError: (error: Error) => void;
	#server?: Server;
	readonly #activeClients = new Set<ActiveClient>();
	#socketIdentity?: SocketIdentity;
	#stopOperation?: Promise<void>;

	constructor(options: UnixSocketServerOptions) {
		this.#socketPath = options.socketPath;
		this.#createClient = options.createClient;
		this.#onError = options.onError ?? (() => undefined);
	}

	get socketPath(): string {
		return this.#socketPath;
	}

	/** 创建运行目录并开始监听。 */
	async start(): Promise<void> {
		if (this.#server) return;
		this.#stopOperation = undefined;
		await this.#prepareSocketPath();

		const server = createServer((socket) => this.#accept(socket));
		this.#server = server;
		try {
			await new Promise<void>((resolve, reject) => {
				const handleStartupError = (error: Error): void => reject(error);
				server.once('error', handleStartupError);
				server.listen(this.#socketPath, () => {
					server.off('error', handleStartupError);
					resolve();
				});
			});
			server.on('error', this.#onError);
			await chmod(this.#socketPath, 0o600);
			const socketStats = await lstat(this.#socketPath);
			this.#socketIdentity = {
				device: socketStats.dev,
				inode: socketStats.ino,
			};
		} catch (error) {
			this.#server = undefined;
			if (server.listening) {
				await new Promise<void>((resolve) => server.close(() => resolve()));
			}
			await this.#removeOwnedSocket();
			throw error;
		}
	}

	/** 停止监听、释放客户端并清理由本实例创建的 socket。 */
	async stop(): Promise<void> {
		this.#stopOperation ??= this.#stop();
		await this.#stopOperation;
	}

	async #prepareSocketPath(): Promise<void> {
		const runtimeDirectory = path.dirname(this.#socketPath);
		await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
		await chmod(runtimeDirectory, 0o700);

		try {
			const socketStats = await lstat(this.#socketPath);
			if (!socketStats.isSocket()) throw new UnsafeSocketPathError(this.#socketPath);
			if (await isSocketAlive(this.#socketPath)) {
				throw new DaemonAlreadyRunningError(this.#socketPath);
			}
			await unlink(this.#socketPath);
		} catch (error) {
			if (!hasErrorCode(error, 'ENOENT')) throw error;
		}
	}

	#accept(socket: Socket): void {
		try {
			const activeClient: ActiveClient = {
				socket,
				client: this.#createClient(socket),
			};
			this.#activeClients.add(activeClient);
			socket.once('close', () => {
				this.#activeClients.delete(activeClient);
				void this.#disposeClient(activeClient);
			});
		} catch (error) {
			socket.destroy();
			this.#onError(error instanceof Error ? error : new Error('Failed to create client'));
		}
	}

	async #disposeClient(activeClient: ActiveClient): Promise<void> {
		activeClient.disposeOperation ??= activeClient.client.dispose().catch(this.#onError);
		await activeClient.disposeOperation;
	}

	async #stop(): Promise<void> {
		const activeClients = [...this.#activeClients];
		this.#activeClients.clear();
		for (const activeClient of activeClients) activeClient.socket.destroy();
		await Promise.all(activeClients.map((activeClient) => this.#disposeClient(activeClient)));

		const server = this.#server;
		this.#server = undefined;
		if (server) {
			server.off('error', this.#onError);
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
		await this.#removeOwnedSocket();
	}

	async #removeOwnedSocket(): Promise<void> {
		const identity = this.#socketIdentity;
		this.#socketIdentity = undefined;
		if (!identity) return;

		try {
			const socketStats = await lstat(this.#socketPath);
			if (
				socketStats.isSocket() &&
				socketStats.dev === identity.device &&
				socketStats.ino === identity.inode
			) {
				await unlink(this.#socketPath);
			}
		} catch (error) {
			if (!hasErrorCode(error, 'ENOENT')) throw error;
		}
	}
}
