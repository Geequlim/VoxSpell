import { Type } from '@sinclair/typebox';

import type { Static } from '@sinclair/typebox';

export const SERVER_ERROR_CODE_MIN = -32099;
export const SERVER_ERROR_CODE_MAX = -32000;

export const ProtocolErrorCodeSchema = Type.Union([
	Type.Literal('MESSAGE_TOO_LARGE'),
	Type.Literal('PROTOCOL_VERSION_UNSUPPORTED'),
	Type.Literal('SESSION_BUSY'),
	Type.Literal('SESSION_NOT_FOUND'),
	Type.Literal('INVALID_SESSION_STATE'),
	Type.Literal('CAPTURE_FAILED'),
	Type.Literal('ASR_FAILED'),
	Type.Literal('PROCESSING_FAILED'),
	Type.Literal('POLISH_FAILED'),
]);
export type ProtocolErrorCode = Static<typeof ProtocolErrorCodeSchema>;

export const ErrorStageSchema = Type.Union([
	Type.Literal('protocol'),
	Type.Literal('session'),
	Type.Literal('capture'),
	Type.Literal('asr'),
	Type.Literal('processing'),
	Type.Literal('polish'),
]);
export type ErrorStage = Static<typeof ErrorStageSchema>;

export const ProtocolErrorDataSchema = Type.Object(
	{
		code: ProtocolErrorCodeSchema,
		stage: ErrorStageSchema,
		retryable: Type.Boolean(),
		providerCode: Type.Optional(Type.String({ minLength: 1 })),
	},
	{ additionalProperties: false },
);
export type ProtocolErrorData = Static<typeof ProtocolErrorDataSchema>;
