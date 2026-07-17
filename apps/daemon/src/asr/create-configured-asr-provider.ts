import { OpenAiCompatibleAsrProvider } from '@voxspell/asr-openai-compatible/openai-compatible-asr-provider';
import { resolveAsrProvider } from '@voxspell/config/asr-provider';
import { loadVoxSpellConfig } from '@voxspell/config/load-config';

import type { RealtimeAsrProvider } from '@voxspell/asr-core/realtime-asr';

/** 从已校验配置创建当前选定的 ASR Provider。 */
export async function createConfiguredAsrProvider(
	configPath: string,
	environment: NodeJS.ProcessEnv = process.env,
	providerId = environment.VOXSPELL_ASR_PROVIDER,
): Promise<RealtimeAsrProvider> {
	const config = await loadVoxSpellConfig(configPath);
	const provider = resolveAsrProvider(
		config,
		environment,
		providerId ?? config.asr.activeProvider,
	);
	return new OpenAiCompatibleAsrProvider({
		id: provider.id,
		apiKey: provider.apiKey,
		baseUrl: provider.baseUrl,
		model: provider.model,
	});
}
