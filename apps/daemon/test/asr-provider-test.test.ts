import { describe, expect, it, vi } from 'vitest';

import { AsrProviderTestError, testAsrProvider } from '../src/asr/test-asr-provider.js';

import type {
	AsrEvent,
	RealtimeAsrProvider,
	RealtimeAsrSession,
} from '@voxspell/asr-core/realtime-asr';

function createProvider(partialResults: boolean, event?: AsrEvent): RealtimeAsrProvider {
	const session: RealtimeAsrSession = {
		start: vi.fn(async () => undefined),
		writeAudio: vi.fn(async () => undefined),
		finish: vi.fn(async () => undefined),
		cancel: vi.fn(async () => undefined),
		events: async function* () {
			if (event) yield event;
		},
	};
	return {
		id: 'test-provider',
		capabilities: { partialResults },
		createSession: vi.fn(async () => session),
	};
}

describe('testAsrProvider', () => {
	it('accepts a successful realtime handshake without replacing runtime state', async () => {
		const provider = createProvider(true);

		await expect(testAsrProvider(provider)).resolves.toMatchObject({ partialResults: true });
	});

	it('accepts an empty transcription response after a successful batch request', async () => {
		const provider = createProvider(false, {
			type: 'error',
			code: 'INVALID_RESPONSE',
			retryable: false,
		});

		await expect(testAsrProvider(provider)).resolves.toMatchObject({ partialResults: false });
	});

	it('preserves a stable provider error code', async () => {
		const provider = createProvider(false, {
			type: 'error',
			code: 'AUTHENTICATION_FAILED',
			retryable: false,
		});

		await expect(testAsrProvider(provider)).rejects.toMatchObject({
			name: 'AsrProviderTestError',
			providerCode: 'AUTHENTICATION_FAILED',
			retryable: false,
		});
		await expect(testAsrProvider(provider)).rejects.toBeInstanceOf(AsrProviderTestError);
	});
});
