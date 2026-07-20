import { describe, expect, it } from 'vitest';

import { AsrProviderConfigError, resolveAsrProvider } from '../src/asr-provider.js';
import { VoxSpellConfigError, parseVoxSpellConfig } from '../src/load-config.js';
import {
	getTextPolisherCredentialNames,
	resolveTextPolisherProvider,
} from '../src/text-polisher-provider.js';

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

	it('accepts daemon-owned deterministic text processing options', () => {
		const config = parseVoxSpellConfig({
			...validConfig,
			textProcessing: { trimTrailingPeriod: true },
		});

		expect(config.textProcessing?.trimTrailingPeriod).toBe(true);
	});

	it('accepts a bounded maximum recording duration', () => {
		const config = parseVoxSpellConfig({
			...validConfig,
			session: { maximumRecordingSeconds: 300 },
		});

		expect(config.session?.maximumRecordingSeconds).toBe(300);
	});

	it('rejects a maximum recording duration outside the supported range', () => {
		expect(() =>
			parseVoxSpellConfig({
				...validConfig,
				session: { maximumRecordingSeconds: 0 },
			}),
		).toThrow(VoxSpellConfigError);
		expect(() =>
			parseVoxSpellConfig({
				...validConfig,
				session: { maximumRecordingSeconds: 3_601 },
			}),
		).toThrow(VoxSpellConfigError);
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

	it('stores an incomplete provider but rejects it at the runtime boundary', () => {
		const config = parseVoxSpellConfig({
			version: 1,
			asr: {
				activeProvider: 'incomplete',
				providers: [
					{
						id: 'incomplete',
						type: 'openai-compatible-transcription',
						baseUrl: '',
						apiKeyEnvironment: '',
						model: '',
					},
				],
			},
		});

		expect(config.asr.activeProvider).toBe('incomplete');
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

	it('resolves an enabled text polisher and its system prompt', () => {
		const config = parseVoxSpellConfig({
			...validConfig,
			polishing: {
				enabled: true,
				activeProvider: 'openrouter-chat',
				systemPrompt: '只返回润色文本。',
				providers: [
					{
						id: 'openrouter-chat',
						type: 'openai-compatible-chat',
						baseUrl: 'https://openrouter.ai/api/v1',
						apiKeyEnvironment: 'OPENROUTER_API_KEY',
						model: 'example/chat',
						timeoutMilliseconds: 30_000,
					},
				],
			},
		});

		expect(resolveTextPolisherProvider(config, { OPENROUTER_API_KEY: 'secret' })).toEqual({
			id: 'openrouter-chat',
			type: 'openai-compatible-chat',
			baseUrl: 'https://openrouter.ai/api/v1',
			apiKey: 'secret',
			model: 'example/chat',
			systemPrompt: '只返回润色文本。',
			timeoutMilliseconds: 30_000,
		});
		expect(getTextPolisherCredentialNames(config)).toEqual(['OPENROUTER_API_KEY']);
	});

	it('allows a disabled text polisher without providers or credentials', () => {
		const config = parseVoxSpellConfig({
			...validConfig,
			polishing: {
				enabled: false,
				systemPrompt: '只返回润色文本。',
				providers: [],
			},
		});

		expect(resolveTextPolisherProvider(config, {})).toBeUndefined();
		expect(getTextPolisherCredentialNames(config)).toEqual([]);
	});

	it('resolves a configured text polisher while automatic polishing is disabled', () => {
		const config = parseVoxSpellConfig({
			...validConfig,
			polishing: {
				enabled: false,
				minimumEffectiveCharacters: 6,
				activeProvider: 'chat',
				systemPrompt: '只返回润色文本。',
				providers: [
					{
						id: 'chat',
						type: 'openai-compatible-chat',
						baseUrl: 'https://openrouter.ai/api/v1',
						apiKeyEnvironment: 'CHAT_API_KEY',
						model: 'example/chat',
					},
				],
			},
		});

		expect(resolveTextPolisherProvider(config, { CHAT_API_KEY: 'secret' })?.id).toBe('chat');
		expect(getTextPolisherCredentialNames(config)).toEqual(['CHAT_API_KEY']);
	});

	it('rejects enabled polishing without an active provider', () => {
		expect(() =>
			parseVoxSpellConfig({
				...validConfig,
				polishing: {
					enabled: true,
					systemPrompt: '只返回润色文本。',
					providers: [],
				},
			}),
		).toThrow(VoxSpellConfigError);
	});

	it('rejects an empty text polishing system prompt', () => {
		expect(() =>
			parseVoxSpellConfig({
				...validConfig,
				polishing: {
					enabled: false,
					systemPrompt: '   ',
					providers: [],
				},
			}),
		).toThrow(VoxSpellConfigError);
	});
});
