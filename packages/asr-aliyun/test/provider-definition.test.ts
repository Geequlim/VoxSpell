import { describe, expect, it } from 'vitest';

import { aliyunRealtimeAsrDefinition } from '../src/provider-definition.js';

describe('aliyunRealtimeAsrDefinition', () => {
	it('uses controlled model, region, and language choices', () => {
		const provider = aliyunRealtimeAsrDefinition.createDefaultConfig('aliyun');
		const fields = aliyunRealtimeAsrDefinition.getFields(provider);

		expect(provider).toEqual({
			id: 'aliyun',
			type: 'aliyun-realtime',
			model: 'fun-asr-realtime',
			region: 'cn-beijing',
			context: '',
		});
		expect(fields.map((field) => [field.id, field.input])).toEqual([
			['model', 'choice'],
			['region', 'choice'],
			['language', 'choice'],
			['context', 'text'],
		]);
		expect(fields.find((field) => field.id === 'language')?.choices?.[0]).toEqual({
			value: '',
			title: '自动识别',
		});
		expect(
			aliyunRealtimeAsrDefinition.credentials.map((item) =>
				item.getEnvironmentName(provider),
			),
		).toEqual(['DASHSCOPE_WORKSPACE_ID', 'DASHSCOPE_API_KEY']);
	});

	it('normalizes incompatible region and language when switching models', () => {
		const provider = aliyunRealtimeAsrDefinition.createDefaultConfig('aliyun');
		if (provider.type !== 'aliyun-realtime') throw new Error('Unexpected provider type');
		provider.region = 'ap-southeast-1';
		provider.language = 'th';
		const model = aliyunRealtimeAsrDefinition
			.getFields(provider)
			.find((field) => field.id === 'model');

		model?.setValue(provider, 'paraformer-realtime-v2');

		expect(provider.region).toBe('cn-beijing');
		expect(provider.language).toBeUndefined();
	});
});
