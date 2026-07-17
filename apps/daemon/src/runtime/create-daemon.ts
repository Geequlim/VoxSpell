import path from 'node:path';

import {
	StreamMessageReader,
	StreamMessageWriter,
	createMessageConnection,
} from 'vscode-jsonrpc/node';

import { DeterministicAudioCaptureBackend } from '../dev/deterministic-audio-capture.js';
import { DeterministicAsrProvider } from '../dev/deterministic-asr.js';
import { DaemonRpcConnection } from '../rpc/daemon-rpc-connection.js';
import { SessionCoordinator } from '../session-coordinator.js';
import {
	ContentLengthLimitTransform,
	DEFAULT_MAX_CONTENT_LENGTH,
} from '../transport/content-length-limit.js';
import { UnixSocketServer } from '../transport/unix-socket-server.js';

import type { Socket } from 'node:net';
import type { UnixSocketClient } from '../transport/unix-socket-server.js';

export interface DaemonRuntimeOptions {
	readonly socketPath: string;
	readonly fakeText?: string;
	readonly maximumContentLength?: number;
	readonly onError?: (error: Error) => void;
}

/** 表示 daemon 缺少启动所需的本地运行环境。 */
export class DaemonRuntimeConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DaemonRuntimeConfigurationError';
	}
}

/** 根据 XDG 运行目录解析默认 Unix Socket 路径。 */
export function resolveDaemonSocketPath(environment: NodeJS.ProcessEnv = process.env): string {
	const runtimeDirectory = environment.XDG_RUNTIME_DIR;
	if (!runtimeDirectory) {
		throw new DaemonRuntimeConfigurationError('XDG_RUNTIME_DIR is required');
	}
	return path.join(runtimeDirectory, 'voxspell', 'daemon.sock');
}

/** 组合 Unix Socket、JSON-RPC 和 deterministic 后端的可执行 daemon。 */
export class DaemonRuntime {
	readonly #server: UnixSocketServer;

	constructor(options: DaemonRuntimeOptions) {
		const captureBackend = new DeterministicAudioCaptureBackend();
		const asrProvider = new DeterministicAsrProvider(options.fakeText);
		const maximumContentLength = options.maximumContentLength ?? DEFAULT_MAX_CONTENT_LENGTH;
		const onError = options.onError ?? (() => undefined);

		this.#server = new UnixSocketServer({
			socketPath: options.socketPath,
			onError,
			createClient: (socket) =>
				this.#createClient(
					socket,
					captureBackend,
					asrProvider,
					maximumContentLength,
					onError,
				),
		});
	}

	get socketPath(): string {
		return this.#server.socketPath;
	}

	/** 启动 daemon Socket。 */
	async start(): Promise<void> {
		await this.#server.start();
	}

	/** 停止 daemon 并清理 Socket。 */
	async stop(): Promise<void> {
		await this.#server.stop();
	}

	#createClient(
		socket: Socket,
		captureBackend: DeterministicAudioCaptureBackend,
		asrProvider: DeterministicAsrProvider,
		maximumContentLength: number,
		onError: (error: Error) => void,
	): UnixSocketClient {
		const limiter = new ContentLengthLimitTransform(maximumContentLength);
		socket.pipe(limiter);
		const connection = createMessageConnection(
			new StreamMessageReader(limiter),
			new StreamMessageWriter(socket),
		);
		const rpcConnection = new DaemonRpcConnection({
			connection,
			serverInfo: { name: 'voxspell-daemon', version: '0.0.0' },
			capabilities: { partialTranscript: true, polishPreview: false },
			reloadConfig: async () => undefined,
			createSessionCoordinator: (publish) =>
				new SessionCoordinator({
					captureBackend,
					asrProvider,
					publish,
				}),
		});

		limiter.once('error', (error) => {
			onError(error);
			socket.destroy();
		});
		socket.on('error', onError);
		connection.onError(([error]) => onError(error));
		rpcConnection.listen();

		return {
			dispose: async () => {
				socket.off('error', onError);
				socket.unpipe(limiter);
				limiter.destroy();
				await rpcConnection.dispose();
			},
		};
	}
}
