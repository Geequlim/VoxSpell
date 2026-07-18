import {
	ConfigReloadParamsSchema,
	ConfigReloadRequest,
	ConfigReloadResultSchema,
	DaemonGetStatusParamsSchema,
	DaemonGetStatusRequest,
	DaemonGetStatusResultSchema,
	DaemonPingParamsSchema,
	DaemonPingRequest,
	DaemonPingResultSchema,
	DaemonReadyNotification,
	DaemonReadyParamsSchema,
} from '@voxspell/protocol/daemon';
import {
	ConfigGetParamsSchema,
	ConfigGetRequest,
	ConfigGetResultSchema,
	ConfigUpdateParamsSchema,
	ConfigUpdateRequest,
	ConfigUpdateResultSchema,
	ConfigValidateParamsSchema,
	ConfigValidateRequest,
	ConfigValidateResultSchema,
} from '@voxspell/protocol/config';
import {
	CredentialsGetStatusParamsSchema,
	CredentialsGetStatusRequest,
	CredentialsGetStatusResultSchema,
	CredentialsUpdateParamsSchema,
	CredentialsUpdateRequest,
	CredentialsUpdateResultSchema,
} from '@voxspell/protocol/credentials';
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
	SessionPhaseNotification,
	SessionPhaseParamsSchema,
	SessionPreviewNotification,
	SessionPreviewParamsSchema,
	SessionResultsNotification,
	SessionResultsParamsSchema,
	SessionSelectResultParamsSchema,
	SessionSelectResultRequest,
	SessionSelectResultResultSchema,
	SessionStartParamsSchema,
	SessionStartRequest,
	SessionStartResultSchema,
} from '@voxspell/protocol/session';
import { ProtocolValidationError, validateProtocolValue } from '@voxspell/protocol/validation';
import {
	ProviderTestParamsSchema,
	ProviderTestRequest,
	ProviderTestResultSchema,
} from '@voxspell/protocol/provider';
import { ErrorCodes, ResponseError } from 'vscode-jsonrpc/node';
import {
	FcitxGetConfigParamsSchema,
	FcitxGetConfigRequest,
	FcitxGetConfigResultSchema,
	FcitxUpdateConfigParamsSchema,
	FcitxUpdateConfigRequest,
	FcitxUpdateConfigResultSchema,
} from '@voxspell/protocol/fcitx';

import { SessionCoordinatorError } from '../session-coordinator.js';
import { AsrProviderConfigError } from '@voxspell/config/asr-provider';
import { VoxSpellCredentialsError } from '@voxspell/config/credentials';
import { VoxSpellConfigError, VoxSpellConfigNotFoundError } from '@voxspell/config/load-config';
import { FcitxUnavailableError } from '../fcitx/fcitx-config-client.js';
import { AsrProviderTestError } from '../asr/test-asr-provider.js';

import type { ServerCapabilities } from '@voxspell/protocol/capabilities';
import type { ServiceInfo } from '@voxspell/protocol/common';
import type { ProtocolErrorData } from '@voxspell/protocol/errors';
import type { VoxSpellConfig } from '@voxspell/config/config-schema';
import type { CredentialValueUpdate } from '@voxspell/protocol/credentials';
import type { DaemonGetStatusResult } from '@voxspell/protocol/daemon';
import type { VoxSpellFcitxConfig } from '@voxspell/protocol/fcitx';
import type { DaemonSessionEvent, SessionCoordinator } from '../session-coordinator.js';
import type { MessageConnection } from 'vscode-jsonrpc/node';
import type { ProviderTestResult } from '@voxspell/protocol/provider';

export interface DaemonRpcConnectionOptions {
	readonly connection: MessageConnection;
	readonly serverInfo: ServiceInfo;
	readonly capabilities: ServerCapabilities;
	readonly createSessionCoordinator: (
		publish: (event: DaemonSessionEvent) => void,
	) => SessionCoordinator;
	readonly configuration: DaemonConfigurationRpcService;
	readonly fcitx: FcitxConfigurationRpcService;
	readonly now?: () => number;
}

/** 描述 Fcitx 配置 RPC 所需的最小能力。 */
export interface FcitxConfigurationRpcService {
	getConfig(): Promise<VoxSpellFcitxConfig>;
	updateConfig(config: VoxSpellFcitxConfig): Promise<void>;
}

/** 描述配置 RPC 对 daemon 运行时所需的最小能力。 */
export interface DaemonConfigurationRpcService {
	getStatus(): DaemonGetStatusResult;
	getConfig(): VoxSpellConfig | undefined;
	validate(config: VoxSpellConfig): Promise<void>;
	updateConfig(config: VoxSpellConfig): Promise<void>;
	reload(): Promise<void>;
	getStoredCredentialNames(): readonly string[];
	updateCredentialEntries(
		set: readonly CredentialValueUpdate[],
		deletedNames: readonly string[],
	): Promise<void>;
	testProvider(providerId: string): Promise<ProviderTestResult>;
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
	readonly #configuration: DaemonConfigurationRpcService;
	readonly #fcitx: FcitxConfigurationRpcService;
	readonly #now: () => number;
	#initialized = false;
	#closed = false;
	#notificationChain = Promise.resolve();

	constructor(options: DaemonRpcConnectionOptions) {
		this.#connection = options.connection;
		this.#serverInfo = options.serverInfo;
		this.#capabilities = options.capabilities;
		this.#configuration = options.configuration;
		this.#fcitx = options.fcitx;
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

		this.#connection.onRequest(SessionSelectResultRequest, async (rawParams) => {
			this.#ensureInitialized();
			const params = validateInbound(() =>
				validateProtocolValue(SessionSelectResultParamsSchema, rawParams),
			);
			await this.#runSessionOperation(() =>
				this.#coordinator.selectResult(params.sessionId, params.choiceId),
			);
			return validateOutbound(() =>
				validateProtocolValue(SessionSelectResultResultSchema, null),
			);
		});

		this.#connection.onRequest(ConfigReloadRequest, async (rawParams) => {
			this.#ensureInitialized();
			validateInbound(() => validateProtocolValue(ConfigReloadParamsSchema, rawParams));
			try {
				await this.#configuration.reload();
			} catch (error) {
				throw this.#createConfigurationError(error);
			}
			return validateOutbound(() => validateProtocolValue(ConfigReloadResultSchema, null));
		});

		this.#connection.onRequest(ConfigGetRequest, (rawParams) => {
			this.#ensureInitialized();
			validateInbound(() => validateProtocolValue(ConfigGetParamsSchema, rawParams));
			const config = this.#configuration.getConfig() ?? null;
			return validateOutbound(() => validateProtocolValue(ConfigGetResultSchema, config));
		});

		this.#connection.onRequest(ConfigValidateRequest, async (rawParams) => {
			this.#ensureInitialized();
			const params = validateInbound(() =>
				validateProtocolValue(ConfigValidateParamsSchema, rawParams),
			);
			try {
				await this.#configuration.validate(params.config);
			} catch (error) {
				throw this.#createConfigurationError(error);
			}
			return validateOutbound(() => validateProtocolValue(ConfigValidateResultSchema, null));
		});

		this.#connection.onRequest(ConfigUpdateRequest, async (rawParams) => {
			this.#ensureInitialized();
			const params = validateInbound(() =>
				validateProtocolValue(ConfigUpdateParamsSchema, rawParams),
			);
			try {
				await this.#configuration.updateConfig(params.config);
			} catch (error) {
				throw this.#createConfigurationError(error);
			}
			return validateOutbound(() => validateProtocolValue(ConfigUpdateResultSchema, null));
		});

		this.#connection.onRequest(CredentialsGetStatusRequest, (rawParams) => {
			this.#ensureInitialized();
			validateInbound(() =>
				validateProtocolValue(CredentialsGetStatusParamsSchema, rawParams),
			);
			return validateOutbound(() =>
				validateProtocolValue(CredentialsGetStatusResultSchema, {
					storedNames: this.#configuration.getStoredCredentialNames(),
				}),
			);
		});

		this.#connection.onRequest(CredentialsUpdateRequest, async (rawParams) => {
			this.#ensureInitialized();
			const params = validateInbound(() =>
				validateProtocolValue(CredentialsUpdateParamsSchema, rawParams),
			);
			const setNames = new Set(params.set.map((entry) => entry.name));
			if (
				setNames.size !== params.set.length ||
				new Set(params.delete).size !== params.delete.length ||
				params.delete.some((name) => setNames.has(name))
			) {
				throw new ResponseError(ErrorCodes.InvalidParams, 'Invalid params');
			}
			try {
				await this.#configuration.updateCredentialEntries(params.set, params.delete);
			} catch (error) {
				throw this.#createConfigurationError(error);
			}
			return validateOutbound(() =>
				validateProtocolValue(CredentialsUpdateResultSchema, null),
			);
		});

		this.#connection.onRequest(ProviderTestRequest, async (rawParams) => {
			this.#ensureInitialized();
			const params = validateInbound(() =>
				validateProtocolValue(ProviderTestParamsSchema, rawParams),
			);
			try {
				const result = await this.#configuration.testProvider(params.providerId);
				return validateOutbound(() =>
					validateProtocolValue(ProviderTestResultSchema, result),
				);
			} catch (error) {
				if (error instanceof AsrProviderTestError) {
					throw new ResponseError(DAEMON_ERROR_CODE, 'Provider test failed', {
						code: 'PROVIDER_TEST_FAILED',
						stage: 'asr',
						retryable: error.retryable,
						providerCode: error.providerCode,
					});
				}
				throw this.#createConfigurationError(error);
			}
		});

		this.#connection.onRequest(DaemonGetStatusRequest, (rawParams) => {
			this.#ensureInitialized();
			validateInbound(() => validateProtocolValue(DaemonGetStatusParamsSchema, rawParams));
			return validateOutbound(() =>
				validateProtocolValue(DaemonGetStatusResultSchema, this.#configuration.getStatus()),
			);
		});

		this.#connection.onRequest(FcitxGetConfigRequest, async (rawParams) => {
			this.#ensureInitialized();
			validateInbound(() => validateProtocolValue(FcitxGetConfigParamsSchema, rawParams));
			try {
				const config = await this.#fcitx.getConfig();
				return validateOutbound(() =>
					validateProtocolValue(FcitxGetConfigResultSchema, config),
				);
			} catch (error) {
				throw this.#createFcitxError(error);
			}
		});

		this.#connection.onRequest(FcitxUpdateConfigRequest, async (rawParams) => {
			this.#ensureInitialized();
			const params = validateInbound(() =>
				validateProtocolValue(FcitxUpdateConfigParamsSchema, rawParams),
			);
			try {
				await this.#fcitx.updateConfig(params.config);
			} catch (error) {
				throw this.#createFcitxError(error);
			}
			return validateOutbound(() =>
				validateProtocolValue(FcitxUpdateConfigResultSchema, null),
			);
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

	#createConfigurationError(error: unknown): ResponseError<ProtocolErrorData> {
		let code: ProtocolErrorData['code'] = 'CONFIG_APPLY_FAILED';
		let stage: ProtocolErrorData['stage'] = 'config';
		if (error instanceof VoxSpellConfigNotFoundError) {
			code = 'CONFIG_NOT_FOUND';
		} else if (error instanceof VoxSpellConfigError) {
			code = 'CONFIG_INVALID';
		} else if (error instanceof VoxSpellCredentialsError) {
			code = 'CREDENTIAL_STORE_INVALID';
			stage = 'credential';
		} else if (error instanceof AsrProviderConfigError) {
			code = 'CREDENTIAL_MISSING';
			stage = 'credential';
		}
		return new ResponseError(DAEMON_ERROR_CODE, 'Configuration operation failed', {
			code,
			stage,
			retryable: false,
		});
	}

	#createFcitxError(error: unknown): ResponseError<ProtocolErrorData> {
		const code =
			error instanceof FcitxUnavailableError ? 'FCITX_UNAVAILABLE' : 'FCITX_CONFIG_FAILED';
		return new ResponseError(DAEMON_ERROR_CODE, 'Fcitx configuration operation failed', {
			code,
			stage: 'fcitx',
			retryable: error instanceof FcitxUnavailableError,
		});
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
			case 'session.phase':
				return this.#connection.sendNotification(
					SessionPhaseNotification,
					validateOutbound(() =>
						validateProtocolValue(SessionPhaseParamsSchema, event.params),
					),
				);
			case 'session.preview':
				return this.#connection.sendNotification(
					SessionPreviewNotification,
					validateOutbound(() =>
						validateProtocolValue(SessionPreviewParamsSchema, event.params),
					),
				);
			case 'session.results':
				return this.#connection.sendNotification(
					SessionResultsNotification,
					validateOutbound(() =>
						validateProtocolValue(SessionResultsParamsSchema, event.params),
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
