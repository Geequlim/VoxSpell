import {
	DASHSCOPE_API_KEY_ENVIRONMENT,
	DASHSCOPE_WORKSPACE_ID_ENVIRONMENT,
} from '@voxspell/config/asr-provider';

import { ALIYUN_ASR_MODEL_PROFILES, getAliyunAsrModelProfile } from './model-profile.js';

import type {
	AsrProviderDefinition,
	AsrProviderFieldDefinition,
} from '@voxspell/config/asr-provider-definition';
import type {
	AliyunRealtimeProviderConfig,
	AsrProviderConfig,
} from '@voxspell/config/config-schema';

const REGION_TITLES = {
	'cn-beijing': '中国内地（北京）',
	'ap-southeast-1': '新加坡',
} as const;

/** 阿里云实时识别实现向配置界面公开的动态定义。 */
export const aliyunRealtimeAsrDefinition: AsrProviderDefinition = {
	type: 'aliyun-realtime',
	title: '阿里云百炼实时识别',
	supportsRealtime: true,
	createDefaultConfig: (providerId) => ({
		id: providerId,
		type: 'aliyun-realtime',
		model: 'fun-asr-realtime',
		region: 'cn-beijing',
		context: '',
	}),
	getFields: (provider) => createFields(getProviderConfig(provider)),
	credentials: [
		{
			id: 'workspaceId',
			title: 'Workspace ID',
			getEnvironmentName: () => DASHSCOPE_WORKSPACE_ID_ENVIRONMENT,
		},
		{
			id: 'apiKey',
			title: 'API Key',
			getEnvironmentName: () => DASHSCOPE_API_KEY_ENVIRONMENT,
		},
	],
};

function createFields(
	provider: AliyunRealtimeProviderConfig,
): readonly AsrProviderFieldDefinition[] {
	const profile = getAliyunAsrModelProfile(provider.model);
	const fields: AsrProviderFieldDefinition[] = [
		{
			id: 'model',
			title: '模型',
			input: 'choice',
			choices: ALIYUN_ASR_MODEL_PROFILES.map((item) => ({
				value: item.id,
				title: item.title,
			})),
			getValue: (value) => getProviderConfig(value).model,
			setValue: (value, model) => {
				const config = getProviderConfig(value);
				const next = getAliyunAsrModelProfile(
					model as AliyunRealtimeProviderConfig['model'],
				);
				config.model = next.id;
				const defaultRegion = next.regions[0];
				if (!defaultRegion)
					throw new Error(`Aliyun model ${next.id} has no available region`);
				if (!next.regions.includes(config.region)) config.region = defaultRegion;
				if (
					config.language &&
					!next.languages.some((item) => item.value === config.language)
				) {
					delete config.language;
				}
			},
		},
		{
			id: 'region',
			title: 'API 地址',
			input: 'choice',
			choices: profile.regions.map((region) => ({
				value: region,
				title: REGION_TITLES[region],
			})),
			getValue: (value) => getProviderConfig(value).region,
			setValue: (value, region) => {
				getProviderConfig(value).region = region as AliyunRealtimeProviderConfig['region'];
			},
		},
		{
			id: 'language',
			title: '语言',
			input: 'choice',
			choices: [{ value: '', title: '自动识别' }, ...profile.languages],
			getValue: (value) => getProviderConfig(value).language ?? '',
			setValue: (value, language) => {
				const config = getProviderConfig(value);
				if (language) config.language = language;
				else delete config.language;
			},
		},
	];
	if (profile.supportsContext) {
		fields.push({
			id: 'context',
			title: '上下文增强',
			input: 'text',
			getValue: (value) => getProviderConfig(value).context,
			setValue: (value, context) => {
				getProviderConfig(value).context = context;
			},
		});
	}
	return fields;
}

function getProviderConfig(provider: AsrProviderConfig): AliyunRealtimeProviderConfig {
	if (provider.type !== 'aliyun-realtime') {
		throw new Error(`Expected Aliyun realtime provider, received ${provider.type}`);
	}
	return provider;
}
