import { OpenAiCompatibleTextPolisher } from '@voxspell/ai-polisher/openai-compatible-text-polisher';
import {
	resolveTextPolisherProvider,
	TextPolisherProviderConfigError,
} from '@voxspell/config/text-polisher-provider';

import type { TextPolisher } from '@voxspell/ai-polisher/text-polisher';
import type { VoxSpellConfig } from '@voxspell/config/config-schema';

/** 根据已校验配置创建当前启用的 AI 文本润色器。 */
export function createTextPolisher(
	config: VoxSpellConfig,
	environment: NodeJS.ProcessEnv,
): TextPolisher | undefined {
	let provider: ReturnType<typeof resolveTextPolisherProvider>;
	try {
		provider = resolveTextPolisherProvider(config, environment);
	} catch (error) {
		if (!config.polishing?.enabled && error instanceof TextPolisherProviderConfigError) {
			return undefined;
		}
		throw error;
	}
	if (!provider) return undefined;
	return new OpenAiCompatibleTextPolisher({
		id: provider.id,
		apiKey: provider.apiKey,
		baseUrl: provider.baseUrl,
		model: provider.model,
		systemPrompt: provider.systemPrompt,
		timeoutMilliseconds: provider.timeoutMilliseconds,
	});
}
