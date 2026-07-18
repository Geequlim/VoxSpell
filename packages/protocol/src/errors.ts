import { Type } from '@sinclair/typebox';

import type { Static } from '@sinclair/typebox';

export const DAEMON_ERROR_CODE = -33000;

export const ProtocolErrorCodeSchema = Type.Union([
	Type.Literal('MESSAGE_TOO_LARGE'),
	Type.Literal('PROTOCOL_VERSION_UNSUPPORTED'),
	Type.Literal('SESSION_BUSY'),
	Type.Literal('SESSION_NOT_FOUND'),
	Type.Literal('INVALID_SESSION_STATE'),
	Type.Literal('SESSION_TIMEOUT'),
	Type.Literal('CAPTURE_FAILED'),
	Type.Literal('ASR_FAILED'),
	Type.Literal('PROCESSING_FAILED'),
	Type.Literal('POLISH_FAILED'),
	Type.Literal('NOT_CONFIGURED'),
	Type.Literal('CONFIG_NOT_FOUND'),
	Type.Literal('CONFIG_INVALID'),
	Type.Literal('CONFIG_APPLY_FAILED'),
	Type.Literal('DICTIONARY_INVALID'),
	Type.Literal('DICTIONARY_APPLY_FAILED'),
	Type.Literal('CREDENTIAL_MISSING'),
	Type.Literal('CREDENTIAL_STORE_INVALID'),
	Type.Literal('PROVIDER_TEST_FAILED'),
	Type.Literal('FCITX_UNAVAILABLE'),
	Type.Literal('FCITX_CONFIG_FAILED'),
]);
export type ProtocolErrorCode = Static<typeof ProtocolErrorCodeSchema>;

export const ErrorStageSchema = Type.Union([
	Type.Literal('protocol'),
	Type.Literal('session'),
	Type.Literal('capture'),
	Type.Literal('asr'),
	Type.Literal('processing'),
	Type.Literal('polish'),
	Type.Literal('config'),
	Type.Literal('dictionary'),
	Type.Literal('credential'),
	Type.Literal('fcitx'),
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
