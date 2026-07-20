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

export interface ResolvedAliyunRealtimeProvider {
	readonly id: string;
	readonly type: 'aliyun-realtime';
	readonly apiKey: string;
	readonly model: 'fun-asr-realtime' | 'paraformer-realtime-v2' | 'qwen3-asr-flash-realtime';
	readonly region: 'cn-beijing' | 'ap-southeast-1';
	readonly workspaceId: string;
	readonly language?: string;
	readonly context: string;
}

export type ResolvedAsrProvider =
	| ResolvedOpenAiCompatibleTranscriptionProvider
	| ResolvedTencentRealtimeProvider
	| ResolvedAliyunRealtimeProvider;

export const TENCENT_APP_ID_ENVIRONMENT = 'TENCENT_CLOUD_ASR_APPID';
export const TENCENT_SECRET_ID_ENVIRONMENT = 'TENCENT_CLOUD_ASR_SECRET_ID';
export const TENCENT_SECRET_KEY_ENVIRONMENT = 'TENCENT_CLOUD_ASR_SECRET_KEY';
export const DASHSCOPE_WORKSPACE_ID_ENVIRONMENT = 'DASHSCOPE_WORKSPACE_ID';
export const DASHSCOPE_API_KEY_ENVIRONMENT = 'DASHSCOPE_API_KEY';

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
		const engineModelType = getRequiredProviderSetting(
			provider.engineModelType,
			'engineModelType',
			provider.id,
		);
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
			engineModelType,
		};
	}
	if (provider.type === 'aliyun-realtime') {
		const workspaceId = getRequiredEnvironment(
			environment,
			DASHSCOPE_WORKSPACE_ID_ENVIRONMENT,
			provider.id,
		);
		const apiKey = getRequiredEnvironment(
			environment,
			DASHSCOPE_API_KEY_ENVIRONMENT,
			provider.id,
		);
		return {
			id: provider.id,
			type: provider.type,
			apiKey,
			model: provider.model,
			region: provider.region,
			workspaceId,
			language: provider.language,
			context: provider.context,
		};
	}

	const baseUrl = getRequiredProviderSetting(provider.baseUrl, 'baseUrl', provider.id);
	const model = getRequiredProviderSetting(provider.model, 'model', provider.id);
	const apiKeyEnvironment = getRequiredProviderSetting(
		provider.apiKeyEnvironment,
		'apiKeyEnvironment',
		provider.id,
	);
	const apiKey = environment[apiKeyEnvironment];
	if (!apiKey) {
		throw new AsrProviderConfigError(
			`ASR provider ${provider.id} requires environment variable ${apiKeyEnvironment}`,
		);
	}
	return {
		id: provider.id,
		type: provider.type,
		baseUrl,
		apiKey,
		model,
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
	if (provider.type === 'aliyun-realtime') {
		return [DASHSCOPE_WORKSPACE_ID_ENVIRONMENT, DASHSCOPE_API_KEY_ENVIRONMENT];
	}
	return provider.apiKeyEnvironment ? [provider.apiKeyEnvironment] : [];
}

function getRequiredProviderSetting(value: string, name: string, providerId: string): string {
	if (value) return value;
	throw new AsrProviderConfigError(`ASR provider ${providerId} requires setting ${name}`);
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
