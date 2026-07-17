import type { VoxSpellConfig } from './config-schema.js';

export interface ResolvedOpenAiCompatibleTranscriptionProvider {
	readonly id: string;
	readonly type: 'openai-compatible-transcription';
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly model: string;
}

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
): ResolvedOpenAiCompatibleTranscriptionProvider {
	const provider = config.asr.providers.find((candidate) => candidate.id === providerId);
	if (!provider) throw new AsrProviderConfigError(`ASR provider does not exist: ${providerId}`);
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
