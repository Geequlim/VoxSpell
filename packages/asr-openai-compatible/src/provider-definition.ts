import type { AsrProviderDefinition } from '@voxspell/config/asr-provider-definition';
import type {
	AsrProviderConfig,
	OpenAiCompatibleTranscriptionProviderConfig,
} from '@voxspell/config/config-schema';

const OPENAI_API_KEY_ENVIRONMENT = 'OPENAI_API_KEY';

/** OpenAI 兼容转写实现向配置界面公开的定义。 */
export const openAiCompatibleAsrDefinition: AsrProviderDefinition = {
	type: 'openai-compatible-transcription',
	title: 'OpenAI 兼容转写',
	supportsRealtime: false,
	createDefaultConfig: (providerId) => ({
		id: providerId,
		type: 'openai-compatible-transcription',
		baseUrl: 'https://api.openai.com/v1',
		apiKeyEnvironment: OPENAI_API_KEY_ENVIRONMENT,
		model: 'whisper-1',
	}),
	fields: [
		{
			id: 'baseUrl',
			title: 'API 地址',
			input: 'url',
			getValue: (provider) => getProviderConfig(provider).baseUrl,
			setValue: (provider, value) => {
				getProviderConfig(provider).baseUrl = value;
			},
		},
		{
			id: 'model',
			title: '模型',
			input: 'text',
			getValue: (provider) => getProviderConfig(provider).model,
			setValue: (provider, value) => {
				getProviderConfig(provider).model = value;
			},
		},
		{
			id: 'apiKeyEnvironment',
			title: 'API 密钥凭据名称',
			input: 'text',
			getValue: (provider) => getProviderConfig(provider).apiKeyEnvironment,
			setValue: (provider, value) => {
				getProviderConfig(provider).apiKeyEnvironment = value;
			},
		},
	],
	credentials: [
		{
			id: 'apiKey',
			title: 'API 密钥',
			getEnvironmentName: (provider) => getProviderConfig(provider).apiKeyEnvironment,
		},
	],
};

function getProviderConfig(
	provider: AsrProviderConfig,
): OpenAiCompatibleTranscriptionProviderConfig {
	if (provider.type !== 'openai-compatible-transcription') {
		throw new Error(`Expected OpenAI compatible provider, received ${provider.type}`);
	}
	return provider;
}
