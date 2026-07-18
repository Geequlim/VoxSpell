import type { VoxSpellConfig } from './config-schema.js';

export interface ResolvedOpenAiCompatibleTextPolisher {
	readonly id: string;
	readonly type: 'openai-compatible-chat';
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly model: string;
	readonly systemPrompt: string;
	readonly timeoutMilliseconds?: number;
}

/** 表示 AI 润色 Provider 配置或密钥引用无法解析。 */
export class TextPolisherProviderConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TextPolisherProviderConfigError';
	}
}

/** 解析已配置的 AI 润色 Provider，不读取默认启用策略。 */
export function resolveTextPolisherProvider(
	config: VoxSpellConfig,
	environment: NodeJS.ProcessEnv,
): ResolvedOpenAiCompatibleTextPolisher | undefined {
	const polishing = config.polishing;
	if (!polishing?.activeProvider) return undefined;
	const provider = polishing.providers.find(
		(candidate) => candidate.id === polishing.activeProvider,
	);
	if (!provider) {
		throw new TextPolisherProviderConfigError('Active text polisher provider does not exist');
	}
	const apiKey = environment[provider.apiKeyEnvironment];
	if (!apiKey) {
		throw new TextPolisherProviderConfigError(
			`Text polisher provider ${provider.id} requires environment variable ${provider.apiKeyEnvironment}`,
		);
	}
	return {
		id: provider.id,
		type: provider.type,
		baseUrl: provider.baseUrl,
		apiKey,
		model: provider.model,
		systemPrompt: polishing.systemPrompt,
		timeoutMilliseconds: provider.timeoutMilliseconds,
	};
}

/** 返回当前已配置的 AI 润色 Provider 所需凭据名称。 */
export function getTextPolisherCredentialNames(config: VoxSpellConfig): readonly string[] {
	const polishing = config.polishing;
	if (!polishing?.activeProvider) return [];
	const provider = polishing.providers.find(
		(candidate) => candidate.id === polishing.activeProvider,
	);
	if (!provider) {
		throw new TextPolisherProviderConfigError('Active text polisher provider does not exist');
	}
	return [provider.apiKeyEnvironment];
}
