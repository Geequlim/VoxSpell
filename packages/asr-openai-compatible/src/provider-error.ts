import OpenAI from 'openai';

import type { AsrEvent } from '@voxspell/asr-core/realtime-asr';

export type AsrErrorEvent = Extract<AsrEvent, { readonly type: 'error' }>;

/** 将 OpenAI SDK 错误映射为稳定且脱敏的 ASR 错误。 */
export function createAsrErrorEvent(error: unknown): AsrErrorEvent {
	if (error instanceof OpenAI.APIConnectionTimeoutError) {
		return { type: 'error', code: 'REQUEST_TIMEOUT', retryable: true };
	}
	if (!(error instanceof OpenAI.APIError)) {
		return { type: 'error', code: 'NETWORK_ERROR', retryable: true };
	}

	const status = error.status;
	if (status === 401 || status === 403) {
		return { type: 'error', code: 'AUTHENTICATION_FAILED', retryable: false };
	}
	if (status === 408) return { type: 'error', code: 'REQUEST_TIMEOUT', retryable: true };
	if (status === 429) return { type: 'error', code: 'RATE_LIMITED', retryable: true };
	if (status !== undefined && status >= 500) {
		return { type: 'error', code: 'PROVIDER_UNAVAILABLE', retryable: true };
	}
	if (status === undefined) return { type: 'error', code: 'NETWORK_ERROR', retryable: true };
	return { type: 'error', code: 'INVALID_REQUEST', retryable: false };
}
