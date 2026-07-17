import { describe, expect, it } from 'vitest';

import { createTencentAsrErrorEvent } from '../src/tencent-message.js';

describe('createTencentAsrErrorEvent', () => {
	it.each([
		[4001, 'INVALID_REQUEST', false],
		[4002, 'AUTHENTICATION_FAILED', false],
		[4003, 'SERVICE_NOT_ENABLED', false],
		[4004, 'QUOTA_EXHAUSTED', false],
		[4005, 'ACCOUNT_SUSPENDED', false],
		[4006, 'CONCURRENCY_LIMIT', true],
		[4007, 'INVALID_AUDIO', false],
		[4008, 'AUDIO_TIMEOUT', true],
		[4009, 'CONNECTION_CLOSED', true],
		[4010, 'INVALID_CLIENT_MESSAGE', false],
		[5000, 'PROVIDER_UNAVAILABLE', true],
		[6001, 'REGION_RESTRICTED', false],
	] as const)('maps Tencent code %i to %s', (providerCode, code, retryable) => {
		expect(createTencentAsrErrorEvent(providerCode)).toEqual({
			type: 'error',
			code,
			retryable,
		});
	});
});
