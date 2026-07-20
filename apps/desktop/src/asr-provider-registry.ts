import { openAiCompatibleAsrDefinition } from '@voxspell/asr-openai-compatible/provider-definition';
import { tencentRealtimeAsrDefinition } from '@voxspell/asr-tencent/provider-definition';

import type { AsrProviderDefinition } from '@voxspell/config/asr-provider-definition';
import type { AsrProviderConfig } from '@voxspell/config/config-schema';

export const asrProviderDefinitions: readonly AsrProviderDefinition[] = [
	openAiCompatibleAsrDefinition,
	tencentRealtimeAsrDefinition,
];

/** 返回指定配置对应的 Provider 公共定义。 */
export function getAsrProviderDefinition(provider: AsrProviderConfig): AsrProviderDefinition {
	const definition = asrProviderDefinitions.find((item) => item.type === provider.type);
	if (!definition) throw new Error(`Unsupported ASR provider type: ${provider.type}`);
	return definition;
}
