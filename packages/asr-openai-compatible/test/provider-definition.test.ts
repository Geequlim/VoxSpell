import { describe, expect, it } from 'vitest';

import { openAiCompatibleAsrDefinition } from '../src/provider-definition.js';

describe('openAiCompatibleAsrDefinition', () => {
	it('provides default configuration, editable fields, and the existing credential name', () => {
		const provider = openAiCompatibleAsrDefinition.createDefaultConfig('openai');

		expect(provider).toEqual({
			id: 'openai',
			type: 'openai-compatible-transcription',
			baseUrl: 'https://api.openai.com/v1',
			apiKeyEnvironment: 'OPENAI_API_KEY',
			model: 'whisper-1',
		});
		expect(openAiCompatibleAsrDefinition.fields.map((field) => field.id)).toEqual([
			'baseUrl',
			'model',
			'apiKeyEnvironment',
		]);
		expect(openAiCompatibleAsrDefinition.fields.map((field) => field.title)).toEqual([
			'API 地址',
			'模型',
			'API 密钥凭据名称',
		]);
		expect(
			openAiCompatibleAsrDefinition.credentials.map((item) =>
				item.getEnvironmentName(provider),
			),
		).toEqual(['OPENAI_API_KEY']);
	});
});
