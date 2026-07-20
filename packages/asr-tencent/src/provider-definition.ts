import {
	TENCENT_APP_ID_ENVIRONMENT,
	TENCENT_SECRET_ID_ENVIRONMENT,
	TENCENT_SECRET_KEY_ENVIRONMENT,
} from '@voxspell/config/asr-provider';

import type { AsrProviderDefinition } from '@voxspell/config/asr-provider-definition';
import type {
	AsrProviderConfig,
	TencentRealtimeProviderConfig,
} from '@voxspell/config/config-schema';

/** 腾讯云实时识别实现向配置界面公开的定义。 */
export const tencentRealtimeAsrDefinition: AsrProviderDefinition = {
	type: 'tencent-realtime',
	title: '腾讯云实时识别',
	supportsRealtime: true,
	createDefaultConfig: (providerId) => ({
		id: providerId,
		type: 'tencent-realtime',
		engineModelType: '16k_zh',
	}),
	getFields: () => [
		{
			id: 'engineModelType',
			title: '引擎模型',
			input: 'text',
			getValue: (provider) => getProviderConfig(provider).engineModelType,
			setValue: (provider, value) => {
				getProviderConfig(provider).engineModelType = value;
			},
		},
	],
	credentials: [
		{
			id: 'appId',
			title: 'App ID',
			getEnvironmentName: () => TENCENT_APP_ID_ENVIRONMENT,
		},
		{
			id: 'secretId',
			title: 'Secret ID',
			getEnvironmentName: () => TENCENT_SECRET_ID_ENVIRONMENT,
		},
		{
			id: 'secretKey',
			title: 'Secret Key',
			getEnvironmentName: () => TENCENT_SECRET_KEY_ENVIRONMENT,
		},
	],
};

function getProviderConfig(provider: AsrProviderConfig): TencentRealtimeProviderConfig {
	if (provider.type !== 'tencent-realtime') {
		throw new Error(`Expected Tencent realtime provider, received ${provider.type}`);
	}
	return provider;
}
