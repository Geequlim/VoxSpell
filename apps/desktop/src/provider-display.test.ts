import { describe, expect, it } from 'vitest';
import { getProviderDisplayName } from './provider-display';

describe('Provider display names', () => {
	it('localizes known provider identifiers', () => {
		expect(getProviderDisplayName('tencent')).toBe('腾讯云');
		expect(getProviderDisplayName('glm')).toBe('智谱 AI');
	});

	it('preserves a custom provider identifier', () => {
		expect(getProviderDisplayName('company-asr')).toBe('company-asr');
	});
});
