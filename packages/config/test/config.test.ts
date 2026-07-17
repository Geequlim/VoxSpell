import { describe, expect, it } from 'vitest';

import { AsrProviderConfigError, resolveAsrProvider } from '../src/asr-provider.js';
import { VoxSpellConfigError, parseVoxSpellConfig } from '../src/load-config.js';

const validConfig = {
	version: 1,
	asr: {
		activeProvider: 'openrouter',
		providers: [
			{
				id: 'openrouter',
				type: 'openai-compatible-transcription',
				baseUrl: 'https://openrouter.ai/api/v1',
				apiKeyEnvironment: 'OPENROUTER_API_KEY',
				model: 'example/asr',
			},
		],
	},
} as const;

describe('VoxSpell config', () => {
	it('validates config and resolves the referenced API key', () => {
		const config = parseVoxSpellConfig(validConfig);
		expect(resolveAsrProvider(config, { OPENROUTER_API_KEY: 'secret' })).toEqual({
			id: 'openrouter',
			type: 'openai-compatible-transcription',
			baseUrl: 'https://openrouter.ai/api/v1',
			apiKey: 'secret',
			model: 'example/asr',
		});
	});

	it('rejects an unknown active provider', () => {
		expect(() =>
			parseVoxSpellConfig({
				...validConfig,
				asr: { ...validConfig.asr, activeProvider: 'missing' },
			}),
		).toThrow(VoxSpellConfigError);
	});

	it('rejects duplicate provider ids', () => {
		expect(() =>
			parseVoxSpellConfig({
				...validConfig,
				asr: {
					...validConfig.asr,
					providers: [validConfig.asr.providers[0], validConfig.asr.providers[0]],
				},
			}),
		).toThrow(VoxSpellConfigError);
	});

	it('does not include the secret when a key is missing', () => {
		const config = parseVoxSpellConfig(validConfig);
		expect(() => resolveAsrProvider(config, {})).toThrow(AsrProviderConfigError);
	});

	it('resolves Tencent realtime credentials from the fixed environment variables', () => {
		const config = parseVoxSpellConfig({
			version: 1,
			asr: {
				activeProvider: 'tencent',
				providers: [
					{
						id: 'tencent',
						type: 'tencent-realtime',
						engineModelType: '16k_zh_en',
					},
				],
			},
		});

		expect(
			resolveAsrProvider(config, {
				TENCENT_CLOUD_ASR_APPID: '123456',
				TENCENT_CLOUD_ASR_SECRET_ID: 'secret-id',
				TENCENT_CLOUD_ASR_SECRET_KEY: 'secret-key',
			}),
		).toEqual({
			id: 'tencent',
			type: 'tencent-realtime',
			appId: '123456',
			secretId: 'secret-id',
			secretKey: 'secret-key',
			engineModelType: '16k_zh_en',
		});
	});
});
