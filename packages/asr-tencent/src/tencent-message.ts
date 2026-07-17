import { Type } from '@sinclair/typebox';

import type { Static } from '@sinclair/typebox';
import type { AsrEvent } from '@voxspell/asr-core/realtime-asr';

export const TencentAsrResultSchema = Type.Object(
	{
		slice_type: Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)]),
		index: Type.Integer({ minimum: 0 }),
		voice_text_str: Type.String(),
	},
	{ additionalProperties: true },
);
export type TencentAsrResult = Static<typeof TencentAsrResultSchema>;

export const TencentAsrMessageSchema = Type.Object(
	{
		code: Type.Integer(),
		message: Type.String(),
		voice_id: Type.String(),
		result: Type.Optional(TencentAsrResultSchema),
		final: Type.Optional(Type.Literal(1)),
	},
	{ additionalProperties: true },
);
export type TencentAsrMessage = Static<typeof TencentAsrMessageSchema>;

export type TencentAsrErrorEvent = Extract<AsrEvent, { readonly type: 'error' }>;

/** 将腾讯云错误码映射为稳定、脱敏的 Provider 错误。 */
export function createTencentAsrErrorEvent(code: number): TencentAsrErrorEvent {
	if (code === 4000) return { type: 'error', code: 'AUDIO_RATE_EXCEEDED', retryable: false };
	if (code === 4001) return { type: 'error', code: 'INVALID_REQUEST', retryable: false };
	if (code === 4002) return { type: 'error', code: 'AUTHENTICATION_FAILED', retryable: false };
	if (code === 4003) return { type: 'error', code: 'SERVICE_NOT_ENABLED', retryable: false };
	if (code === 4004) return { type: 'error', code: 'QUOTA_EXHAUSTED', retryable: false };
	if (code === 4005) return { type: 'error', code: 'ACCOUNT_SUSPENDED', retryable: false };
	if (code === 4006) return { type: 'error', code: 'CONCURRENCY_LIMIT', retryable: true };
	if (code === 4007) return { type: 'error', code: 'INVALID_AUDIO', retryable: false };
	if (code === 4008) return { type: 'error', code: 'AUDIO_TIMEOUT', retryable: true };
	if (code === 4009) return { type: 'error', code: 'CONNECTION_CLOSED', retryable: true };
	if (code === 4010) return { type: 'error', code: 'INVALID_CLIENT_MESSAGE', retryable: false };
	if (code === 6001) return { type: 'error', code: 'REGION_RESTRICTED', retryable: false };
	if (code >= 5000) return { type: 'error', code: 'PROVIDER_UNAVAILABLE', retryable: true };
	return { type: 'error', code: 'INVALID_REQUEST', retryable: false };
}
