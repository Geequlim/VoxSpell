import { describe, expect, it } from 'vitest';

import { createTencentAsrUrl } from '../src/tencent-signature.js';

describe('createTencentAsrUrl', () => {
	it('creates the documented sorted HMAC-SHA1 query without exposing the secret key', () => {
		const actual = new URL(
			createTencentAsrUrl({
				appId: '12345',
				secretId: 'secret-id',
				secretKey: 'secret-key',
				engineModelType: '16k_zh_en',
				timestamp: 1_000,
				nonce: 7,
				voiceId: 'voice-id',
			}),
		);

		expect(actual.origin).toBe('wss://asr.cloud.tencent.com');
		expect(actual.pathname).toBe('/asr/v2/12345');
		expect(actual.searchParams.get('expired')).toBe('1300');
		expect(actual.searchParams.get('engine_model_type')).toBe('16k_zh_en');
		expect(actual.searchParams.get('signature')).toBe('xeZoZfQSH/PruEL8n2e46sCQ8hU=');
		expect(actual.href).not.toContain('secret-key');
	});
});
