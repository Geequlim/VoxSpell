import {
	ConfigReloadParamsSchema,
	ConfigReloadRequest,
	ConfigReloadResultSchema,
	DaemonPingParamsSchema,
	DaemonPingRequest,
	DaemonPingResultSchema,
	DaemonReadyNotification,
	DaemonReadyParamsSchema,
} from '@voxspell/protocol/daemon';
import { PROTOCOL_VERSION } from '@voxspell/protocol/common';
import { DAEMON_ERROR_CODE } from '@voxspell/protocol/errors';
import {
	InitializeParamsSchema,
	InitializeRequest,
	InitializeResultSchema,
} from '@voxspell/protocol/initialize';
import {
	SessionCancelParamsSchema,
	SessionCancelRequest,
	SessionCancelResultSchema,
	SessionCompletedNotification,
	SessionCompletedParamsSchema,
	SessionErrorNotification,
	SessionErrorParamsSchema,
	SessionFinishRequest,
	SessionFinishResultSchema,
	SessionParamsSchema,
	SessionRecordingNotification,
	SessionStartParamsSchema,
	SessionStartRequest,
	SessionStartResultSchema,
} from '@voxspell/protocol/session';
import {
	AsrReadyNotification,
	AsrReadyParamsSchema,
	TranscriptFinalNotification,
	TranscriptFinalParamsSchema,
	TranscriptPartialNotification,
	TranscriptPartialParamsSchema,
	TranscriptSegmentFinalNotification,
	TranscriptSegmentFinalParamsSchema,
} from '@voxspell/protocol/transcript';
import { ProtocolValidationError, validateProtocolValue } from '@voxspell/protocol/validation';
import { ErrorCodes, ResponseError } from 'vscode-jsonrpc/node';

import { SessionCoordinatorError } from '../session-coordinator.js';

import type { ServerCapabilities } from '@voxspell/protocol/capabilities';
import type { ServiceInfo } from '@voxspell/protocol/common';
import type { ProtocolErrorData } from '@voxspell/protocol/errors';
import type { DaemonSessionEvent, SessionCoordinator } from '../session-coordinator.js';
import type { MessageConnection } from 'vscode-jsonrpc/node';

export interface DaemonRpcConnectionOptions {
	readonly connection: MessageConnection;
	readonly serverInfo: ServiceInfo;
	readonly capabilities: ServerCapabilities;
	readonly createSessionCoordinator: (
		publish: (event: DaemonSessionEvent) => void,
	) => SessionCoordinator;
	readonly reloadConfig: () => Promise<void>;
	readonly now?: () => number;
}

/** 将 TypeBox 入站校验失败转换为不回显原始参数的 JSON-RPC 错误。 */
function validateInbound<T>(validator: () => T): T {
	try {
		return validator();
	} catch (error) {
		if (error instanceof ProtocolValidationError) {
			throw new ResponseError(ErrorCodes.InvalidParams, 'Invalid params');
		}
		throw error;
	}
}

/** 将 daemon 生成的非法协议数据转换为脱敏的内部错误。 */
function validateOutbound<T>(validator: () => T): T {
	try {
		return validator();
	} catch (error) {
		if (error instanceof ProtocolValidationError) {
			throw new ResponseError(ErrorCodes.InternalError, 'Internal error');
		}
		throw error;
	}
}

/** 判断 initialize 是否携带了结构合法但不受支持的协议版本。 */
function hasUnsupportedProtocolVersion(value: unknown): boolean {
	if (typeof value !== 'object' || value === null) return false;
	if (!('protocolVersion' in value)) return false;
	const protocolVersion = value.protocolVersion;
	return Number.isInteger(protocolVersion) && protocolVersion !== PROTOCOL_VERSION;
}

/** 管理一条客户端连接上的 JSON-RPC 生命周期与请求处理器。 */
export class DaemonRpcConnection {
	readonly #connection: MessageConnection;
	readonly #serverInfo: ServiceInfo;
	readonly #capabilities: ServerCapabilities;
	readonly #coordinator: SessionCoordinator;
	readonly #reloadConfig: () => Promise<void>;
	readonly #now: () => number;
	#initialized = false;
	#closed = false;
	#notificationChain = Promise.resolve();

	constructor(options: DaemonRpcConnectionOptions) {
		this.#connection = options.connection;
		this.#serverInfo = options.serverInfo;
		this.#capabilities = options.capabilities;
		this.#reloadConfig = options.reloadConfig;
		this.#now = options.now ?? Date.now;
		this.#coordinator = options.createSessionCoordinator((event) => {
			this.#enqueueNotification(() => this.#sendSessionEvent(event));
		});

		this.#registerHandlers();
		this.#connection.onClose(() => {
			this.#closed = true;
			void this.#cancelActiveSession();
		});
	}

	/** 开始接收 JSON-RPC 消息。 */
	listen(): void {
		this.#connection.listen();
	}

	/** 取消活动会话并释放底层连接。 */
	async dispose(): Promise<void> {
		this.#closed = true;
		await this.#cancelActiveSession();
		this.#connection.dispose();
	}

	#registerHandlers(): void {
		this.#connection.onRequest(InitializeRequest, async (rawParams) => {
			if (this.#initialized) {
				throw new ResponseError(
					ErrorCodes.InvalidRequest,
					'Connection is already initialized',
				);
			}
			if (hasUnsupportedProtocolVersion(rawParams)) {
				throw this.#createProtocolError(
					'Unsupported protocol version',
					'PROTOCOL_VERSION_UNSUPPORTED',
				);
			}

			validateInbound(() => validateProtocolValue(InitializeParamsSchema, rawParams));
			const result = validateOutbound(() =>
				validateProtocolValue(InitializeResultSchema, {
					protocolVersion: PROTOCOL_VERSION,
					serverInfo: this.#serverInfo,
					capabilities: this.#capabilities,
				}),
			);
			this.#initialized = true;
			const readyParams = validateOutbound(() =>
				validateProtocolValue(DaemonReadyParamsSchema, {
					serverInfo: this.#serverInfo,
					capabilities: this.#capabilities,
				}),
			);
			await this.#connection.sendNotification(DaemonReadyNotification, readyParams);
			return result;
		});

		this.#connection.onRequest(SessionStartRequest, async (rawParams) => {
			this.#ensureInitialized();
			const params = validateInbound(() =>
				validateProtocolValue(SessionStartParamsSchema, rawParams),
			);
			const result = await this.#runSessionOperation(() =>
				this.#coordinator.start(params.inputContextId),
			);
			return validateOutbound(() => validateProtocolValue(SessionStartResultSchema, result));
		});

		this.#connection.onRequest(SessionFinishRequest, async (rawParams) => {
			this.#ensureInitialized();
			const params = validateInbound(() =>
				validateProtocolValue(SessionParamsSchema, rawParams),
			);
			await this.#runSessionOperation(() => this.#coordinator.finish(params.sessionId));
			return validateOutbound(() => validateProtocolValue(SessionFinishResultSchema, null));
		});

		this.#connection.onRequest(SessionCancelRequest, async (rawParams) => {
			this.#ensureInitialized();
			const params = validateInbound(() =>
				validateProtocolValue(SessionCancelParamsSchema, rawParams),
			);
			await this.#runSessionOperation(() =>
				this.#coordinator.cancel(params.sessionId, params.reason),
			);
			return validateOutbound(() => validateProtocolValue(SessionCancelResultSchema, null));
		});

		this.#connection.onRequest(ConfigReloadRequest, async (rawParams) => {
			this.#ensureInitialized();
			validateInbound(() => validateProtocolValue(ConfigReloadParamsSchema, rawParams));
			try {
				await this.#reloadConfig();
			} catch (error) {
				throw new ResponseError(ErrorCodes.InternalError, 'Internal error');
			}
			return validateOutbound(() => validateProtocolValue(ConfigReloadResultSchema, null));
		});

		this.#connection.onRequest(DaemonPingRequest, (rawParams) => {
			this.#ensureInitialized();
			validateInbound(() => validateProtocolValue(DaemonPingParamsSchema, rawParams));
			return validateOutbound(() =>
				validateProtocolValue(DaemonPingResultSchema, { timestampMs: this.#now() }),
			);
		});
	}

	#ensureInitialized(): void {
		if (!this.#initialized) {
			throw new ResponseError(ErrorCodes.ServerNotInitialized, 'Server is not initialized');
		}
	}

	async #runSessionOperation<T>(operation: () => Promise<T>): Promise<T> {
		try {
			return await operation();
		} catch (error) {
			if (error instanceof SessionCoordinatorError) {
				throw new ResponseError(DAEMON_ERROR_CODE, error.message, error.data);
			}
			throw new ResponseError(ErrorCodes.InternalError, 'Internal error');
		}
	}

	#enqueueNotification(send: () => Promise<void>): void {
		if (this.#closed) return;
		this.#notificationChain = this.#notificationChain.then(send).catch(async () => {
			this.#closed = true;
			await this.#cancelActiveSession();
		});
	}

	async #sendSessionEvent(event: DaemonSessionEvent): Promise<void> {
		switch (event.method) {
			case 'session.recording':
				return this.#connection.sendNotification(
					SessionRecordingNotification,
					validateOutbound(() =>
						validateProtocolValue(SessionParamsSchema, event.params),
					),
				);
			case 'asr.ready':
				return this.#connection.sendNotification(
					AsrReadyNotification,
					validateOutbound(() =>
						validateProtocolValue(AsrReadyParamsSchema, event.params),
					),
				);
			case 'transcript.partial':
				return this.#connection.sendNotification(
					TranscriptPartialNotification,
					validateOutbound(() =>
						validateProtocolValue(TranscriptPartialParamsSchema, event.params),
					),
				);
			case 'transcript.segmentFinal':
				return this.#connection.sendNotification(
					TranscriptSegmentFinalNotification,
					validateOutbound(() =>
						validateProtocolValue(TranscriptSegmentFinalParamsSchema, event.params),
					),
				);
			case 'transcript.final':
				return this.#connection.sendNotification(
					TranscriptFinalNotification,
					validateOutbound(() =>
						validateProtocolValue(TranscriptFinalParamsSchema, event.params),
					),
				);
			case 'session.completed':
				return this.#connection.sendNotification(
					SessionCompletedNotification,
					validateOutbound(() =>
						validateProtocolValue(SessionCompletedParamsSchema, event.params),
					),
				);
			case 'session.error':
				return this.#connection.sendNotification(
					SessionErrorNotification,
					validateOutbound(() =>
						validateProtocolValue(SessionErrorParamsSchema, event.params),
					),
				);
		}
	}

	async #cancelActiveSession(): Promise<void> {
		const sessionId = this.#coordinator.activeSessionId;
		if (!sessionId) return;
		try {
			await this.#coordinator.cancel(sessionId, 'client-disconnected');
		} catch {
			this.#closed = true;
		}
	}

	#createProtocolError(
		message: string,
		code: ProtocolErrorData['code'],
	): ResponseError<ProtocolErrorData> {
		return new ResponseError(DAEMON_ERROR_CODE, message, {
			code,
			stage: 'protocol',
			retryable: false,
		});
	}
}
