import path from 'node:path';
import daemonPackage from '../../package.json';

import {
	StreamMessageReader,
	StreamMessageWriter,
	createMessageConnection,
} from 'vscode-jsonrpc/node';

import { DeterministicAudioCaptureBackend } from '../dev/deterministic-audio-capture.js';
import { DeterministicAsrProvider } from '../dev/deterministic-asr.js';
import { DaemonRpcConnection } from '../rpc/daemon-rpc-connection.js';
import { FcitxUnavailableError } from '../fcitx/fcitx-config-client.js';
import { SessionCoordinator } from '../session-coordinator.js';
import { DaemonSessionGate } from '../session-gate.js';
import {
	ContentLengthLimitTransform,
	DEFAULT_MAX_CONTENT_LENGTH,
} from '../transport/content-length-limit.js';
import { UnixSocketServer } from '../transport/unix-socket-server.js';

import type { Socket } from 'node:net';
import type { TextPolisher } from '@voxspell/ai-polisher/text-polisher';
import type { RealtimeAsrProvider } from '@voxspell/asr-core/realtime-asr';
import type { TextPipeline } from '@voxspell/text-pipeline/text-pipeline';
import type { CompiledVoiceDictionary } from '@voxspell/text-pipeline/voice-dictionary';
import type { AudioCaptureBackend } from '../audio-capture.js';
import type { UnixSocketClient } from '../transport/unix-socket-server.js';
import type { DaemonConfigurationRpcService } from '../rpc/daemon-rpc-connection.js';
import type { DaemonDictionaryRpcService } from '../rpc/daemon-rpc-connection.js';
import type { FcitxConfigurationRpcService } from '../rpc/daemon-rpc-connection.js';
import type { SessionFailureDiagnostic, TextPolishingPolicy } from '../session-coordinator.js';

export interface DaemonRuntimeOptions {
	readonly socketPath: string;
	readonly fakeText?: string;
	readonly captureBackend?: AudioCaptureBackend;
	readonly asrProvider?: RealtimeAsrProvider;
	readonly getAsrProvider?: () => RealtimeAsrProvider | undefined;
	readonly reloadConfig?: () => Promise<void>;
	readonly configuration?: DaemonConfigurationRpcService;
	readonly dictionary?: DaemonDictionaryRpcService;
	readonly fcitx?: FcitxConfigurationRpcService;
	readonly textPipeline?: TextPipeline;
	readonly textPolisher?: TextPolisher;
	readonly getTextPolisher?: () => TextPolisher | undefined;
	readonly getTextPolishingPolicy?: () => TextPolishingPolicy;
	readonly getTrimTrailingPeriod?: () => boolean;
	readonly getDictionary?: () => CompiledVoiceDictionary;
	readonly maximumContentLength?: number;
	readonly onError?: (error: Error) => void;
	readonly onSessionFailure?: (diagnostic: SessionFailureDiagnostic) => void;
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

/** 组合 Unix Socket、JSON-RPC 和音频、ASR 后端的可执行 daemon。 */
export class DaemonRuntime {
	readonly #server: UnixSocketServer;
	readonly #sessionGate = new DaemonSessionGate();

	constructor(options: DaemonRuntimeOptions) {
		const captureBackend = options.captureBackend ?? new DeterministicAudioCaptureBackend();
		const fallbackAsrProvider =
			options.asrProvider ?? new DeterministicAsrProvider(options.fakeText);
		const getAsrProvider = options.getAsrProvider ?? (() => fallbackAsrProvider);
		const reloadConfig = options.reloadConfig ?? (async () => undefined);
		const configuration =
			options.configuration ?? this.#createFallbackConfiguration(reloadConfig);
		const dictionary = options.dictionary ?? this.#createFallbackDictionary();
		const fcitx = options.fcitx ?? this.#createFallbackFcitxConfiguration();
		const textPipeline = options.textPipeline;
		const getTextPolisher = options.getTextPolisher ?? (() => options.textPolisher);
		const getTextPolishingPolicy =
			options.getTextPolishingPolicy ??
			(() => ({ defaultEnabled: true, minimumEffectiveCharacters: 0 }));
		const getTrimTrailingPeriod = options.getTrimTrailingPeriod ?? (() => false);
		const getDictionary = options.getDictionary;
		const maximumContentLength = options.maximumContentLength ?? DEFAULT_MAX_CONTENT_LENGTH;
		const onError = options.onError ?? (() => undefined);
		const onSessionFailure = options.onSessionFailure ?? (() => undefined);

		this.#server = new UnixSocketServer({
			socketPath: options.socketPath,
			onError,
			createClient: (socket) =>
				this.#createClient(
					socket,
					captureBackend,
					getAsrProvider,
					textPipeline,
					getTextPolisher,
					getTextPolishingPolicy,
					getTrimTrailingPeriod,
					getDictionary,
					this.#sessionGate,
					maximumContentLength,
					configuration,
					dictionary,
					fcitx,
					onError,
					onSessionFailure,
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
		captureBackend: AudioCaptureBackend,
		getAsrProvider: () => RealtimeAsrProvider | undefined,
		textPipeline: TextPipeline | undefined,
		getTextPolisher: () => TextPolisher | undefined,
		getTextPolishingPolicy: () => TextPolishingPolicy,
		getTrimTrailingPeriod: () => boolean,
		getDictionary: (() => CompiledVoiceDictionary) | undefined,
		sessionGate: DaemonSessionGate,
		maximumContentLength: number,
		configuration: DaemonConfigurationRpcService,
		dictionary: DaemonDictionaryRpcService,
		fcitx: FcitxConfigurationRpcService,
		onError: (error: Error) => void,
		onSessionFailure: (diagnostic: SessionFailureDiagnostic) => void,
	): UnixSocketClient {
		const limiter = new ContentLengthLimitTransform(maximumContentLength);
		socket.pipe(limiter);
		const connection = createMessageConnection(
			new StreamMessageReader(limiter),
			new StreamMessageWriter(socket),
		);
		const rpcConnection = new DaemonRpcConnection({
			connection,
			serverInfo: { name: 'voxspell-daemon', version: daemonPackage.version },
			capabilities: {
				partialTranscript: getAsrProvider()?.capabilities.partialResults ?? false,
				polishPreview: getTextPolisher() !== undefined,
			},
			configuration,
			dictionary,
			fcitx,
			createSessionCoordinator: (publish) =>
				new SessionCoordinator({
					captureBackend,
					getAsrProvider,
					textPipeline,
					getTextPolisher,
					getTextPolishingPolicy,
					getTrimTrailingPeriod,
					getDictionary,
					sessionGate,
					publish,
					onFailure: onSessionFailure,
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

	#createFallbackConfiguration(reload: () => Promise<void>): DaemonConfigurationRpcService {
		return {
			getStatus: () => ({
				state: 'ready',
				configPath: '/dev/null',
				credentialsPath: '/dev/null',
				missingCredentialNames: [],
			}),
			getConfig: () => undefined,
			validate: async () => undefined,
			updateConfig: async () => undefined,
			reload,
			getStoredCredentialNames: () => [],
			updateCredentialEntries: async () => undefined,
			testProvider: async () => ({ latencyMs: 0, partialResults: false }),
		};
	}

	#createFallbackDictionary(): DaemonDictionaryRpcService {
		const dictionary = { version: 1 as const, entries: [] };
		return {
			getState: () => ({
				dictionary,
				path: '/dev/null',
				enabledCount: 0,
				promptCharacters: 0,
			}),
			validate: async () => undefined,
			update: async () => undefined,
			reload: async () => undefined,
		};
	}

	#createFallbackFcitxConfiguration(): FcitxConfigurationRpcService {
		return {
			getConfig: async () => {
				throw new FcitxUnavailableError();
			},
			updateConfig: async () => {
				throw new FcitxUnavailableError();
			},
		};
	}
}
