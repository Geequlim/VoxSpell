import type { VoxSpellConfig } from './config-schema.js';

export interface ResolvedOpenAiCompatibleTranscriptionProvider {
	readonly id: string;
	readonly type: 'openai-compatible-transcription';
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly model: string;
}

export interface ResolvedTencentRealtimeProvider {
	readonly id: string;
	readonly type: 'tencent-realtime';
	readonly appId: string;
	readonly secretId: string;
	readonly secretKey: string;
	readonly engineModelType: string;
}

export type ResolvedAsrProvider =
	| ResolvedOpenAiCompatibleTranscriptionProvider
	| ResolvedTencentRealtimeProvider;

export const TENCENT_APP_ID_ENVIRONMENT = 'TENCENT_CLOUD_ASR_APPID';
export const TENCENT_SECRET_ID_ENVIRONMENT = 'TENCENT_CLOUD_ASR_SECRET_ID';
export const TENCENT_SECRET_KEY_ENVIRONMENT = 'TENCENT_CLOUD_ASR_SECRET_KEY';

/** 表示 ASR Provider 配置或密钥引用无法解析。 */
export class AsrProviderConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AsrProviderConfigError';
	}
}

/** 解析选定的 ASR Provider，并仅在该边界读取环境变量密钥。 */
export function resolveAsrProvider(
	config: VoxSpellConfig,
	environment: NodeJS.ProcessEnv,
	providerId = config.asr.activeProvider,
): ResolvedAsrProvider {
	const provider = config.asr.providers.find((candidate) => candidate.id === providerId);
	if (!provider) throw new AsrProviderConfigError(`ASR provider does not exist: ${providerId}`);
	if (provider.type === 'tencent-realtime') {
		const appId = getRequiredEnvironment(environment, TENCENT_APP_ID_ENVIRONMENT, provider.id);
		const secretId = getRequiredEnvironment(
			environment,
			TENCENT_SECRET_ID_ENVIRONMENT,
			provider.id,
		);
		const secretKey = getRequiredEnvironment(
			environment,
			TENCENT_SECRET_KEY_ENVIRONMENT,
			provider.id,
		);
		return {
			id: provider.id,
			type: provider.type,
			appId,
			secretId,
			secretKey,
			engineModelType: provider.engineModelType,
		};
	}

	const apiKey = environment[provider.apiKeyEnvironment];
	if (!apiKey) {
		throw new AsrProviderConfigError(
			`ASR provider ${provider.id} requires environment variable ${provider.apiKeyEnvironment}`,
		);
	}
	return {
		id: provider.id,
		type: provider.type,
		baseUrl: provider.baseUrl,
		apiKey,
		model: provider.model,
	};
}

/** 返回选定 Provider 解析时需要的全部凭据名称。 */
export function getAsrProviderCredentialNames(
	config: VoxSpellConfig,
	providerId = config.asr.activeProvider,
): readonly string[] {
	const provider = config.asr.providers.find((candidate) => candidate.id === providerId);
	if (!provider) throw new AsrProviderConfigError(`ASR provider does not exist: ${providerId}`);
	if (provider.type === 'tencent-realtime') {
		return [
			TENCENT_APP_ID_ENVIRONMENT,
			TENCENT_SECRET_ID_ENVIRONMENT,
			TENCENT_SECRET_KEY_ENVIRONMENT,
		];
	}
	return [provider.apiKeyEnvironment];
}

/** 读取 Provider 必需的环境变量，但不把密钥值写入错误。 */
function getRequiredEnvironment(
	environment: NodeJS.ProcessEnv,
	name: string,
	providerId: string,
): string {
	const value = environment[name];
	if (value) return value;
	throw new AsrProviderConfigError(
		`ASR provider ${providerId} requires environment variable ${name}`,
	);
}
