import { Type } from '@sinclair/typebox';
import { NotificationType, RequestType } from 'vscode-jsonrpc';

import { EmptyResultSchema, SessionIdSchema } from './common.js';
import { ProtocolErrorDataSchema } from './errors.js';

import type { Static } from '@sinclair/typebox';
import type { EmptyResult } from './common.js';
import type { ProtocolErrorData } from './errors.js';

export const SessionPhaseSchema = Type.Union([
	Type.Literal('preparing'),
	Type.Literal('recording'),
	Type.Literal('recognizing'),
	Type.Literal('processing'),
	Type.Literal('polishing'),
	Type.Literal('choosing'),
]);
export type SessionPhase = Static<typeof SessionPhaseSchema>;

export const SessionChoiceIdSchema = Type.Union([
	Type.Literal('transcript'),
	Type.Literal('polished'),
]);
export type SessionChoiceId = Static<typeof SessionChoiceIdSchema>;

export const SessionStartParamsSchema = Type.Object(
	{
		inputContextId: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);
export type SessionStartParams = Static<typeof SessionStartParamsSchema>;

export const SessionStartResultSchema = Type.Object(
	{
		sessionId: SessionIdSchema,
	},
	{ additionalProperties: false },
);
export type SessionStartResult = Static<typeof SessionStartResultSchema>;

export const SessionStartRequest = new RequestType<
	SessionStartParams,
	SessionStartResult,
	ProtocolErrorData
>('session.start');

export const SessionParamsSchema = Type.Object(
	{
		sessionId: SessionIdSchema,
	},
	{ additionalProperties: false },
);
export type SessionParams = Static<typeof SessionParamsSchema>;

export const SessionFinishResultSchema = EmptyResultSchema;
export const SessionFinishRequest = new RequestType<SessionParams, EmptyResult, ProtocolErrorData>(
	'session.finish',
);

export const SessionSetPolishingEnabledParamsSchema = Type.Object(
	{
		sessionId: SessionIdSchema,
		enabled: Type.Boolean(),
	},
	{ additionalProperties: false },
);
export type SessionSetPolishingEnabledParams = Static<
	typeof SessionSetPolishingEnabledParamsSchema
>;

export const SessionSetPolishingEnabledRequest = new RequestType<
	SessionSetPolishingEnabledParams,
	EmptyResult,
	ProtocolErrorData
>('session.setPolishingEnabled');

export const SessionCancelReasonSchema = Type.Union([
	Type.Literal('user'),
	Type.Literal('focus-lost'),
	Type.Literal('replaced'),
	Type.Literal('client-disconnected'),
]);
export type SessionCancelReason = Static<typeof SessionCancelReasonSchema>;

export const SessionCancelParamsSchema = Type.Object(
	{
		sessionId: SessionIdSchema,
		reason: SessionCancelReasonSchema,
	},
	{ additionalProperties: false },
);
export type SessionCancelParams = Static<typeof SessionCancelParamsSchema>;

export const SessionCancelResultSchema = EmptyResultSchema;
export const SessionCancelRequest = new RequestType<
	SessionCancelParams,
	EmptyResult,
	ProtocolErrorData
>('session.cancel');

export const SessionSelectResultParamsSchema = Type.Object(
	{
		sessionId: SessionIdSchema,
		choiceId: SessionChoiceIdSchema,
	},
	{ additionalProperties: false },
);
export type SessionSelectResultParams = Static<typeof SessionSelectResultParamsSchema>;

export const SessionSelectResultResultSchema = EmptyResultSchema;
export const SessionSelectResultRequest = new RequestType<
	SessionSelectResultParams,
	EmptyResult,
	ProtocolErrorData
>('session.selectResult');

export const SessionPhaseParamsSchema = Type.Object(
	{
		sessionId: SessionIdSchema,
		phase: SessionPhaseSchema,
	},
	{ additionalProperties: false },
);
export type SessionPhaseParams = Static<typeof SessionPhaseParamsSchema>;

export const SessionPhaseNotification = new NotificationType<SessionPhaseParams>('session.phase');

export const SessionPreviewParamsSchema = Type.Object(
	{
		sessionId: SessionIdSchema,
		text: Type.String(),
	},
	{ additionalProperties: false },
);
export type SessionPreviewParams = Static<typeof SessionPreviewParamsSchema>;

export const SessionPreviewNotification = new NotificationType<SessionPreviewParams>(
	'session.preview',
);

export const SessionPolishingStateParamsSchema = Type.Object(
	{
		sessionId: SessionIdSchema,
		enabled: Type.Boolean(),
	},
	{ additionalProperties: false },
);
export type SessionPolishingStateParams = Static<typeof SessionPolishingStateParamsSchema>;

export const SessionPolishingStateNotification = new NotificationType<SessionPolishingStateParams>(
	'session.polishingState',
);

export const TranscriptResultSchema = Type.Object(
	{
		text: Type.String({ minLength: 1 }),
		status: Type.Literal('final'),
	},
	{ additionalProperties: false },
);
export type TranscriptResult = Static<typeof TranscriptResultSchema>;

export const PolishedResultSchema = Type.Union([
	Type.Object(
		{
			text: Type.String(),
			status: Type.Literal('streaming'),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			text: Type.String({ minLength: 1 }),
			status: Type.Literal('final'),
		},
		{ additionalProperties: false },
	),
]);
export type PolishedResult = Static<typeof PolishedResultSchema>;

export const SessionResultsParamsSchema = Type.Object(
	{
		sessionId: SessionIdSchema,
		transcript: TranscriptResultSchema,
		polished: Type.Optional(PolishedResultSchema),
		recommendedChoiceId: Type.Optional(SessionChoiceIdSchema),
	},
	{ additionalProperties: false },
);
export type SessionResultsParams = Static<typeof SessionResultsParamsSchema>;

export const SessionResultsNotification = new NotificationType<SessionResultsParams>(
	'session.results',
);

export const SessionCompletedParamsSchema = Type.Object(
	{
		sessionId: SessionIdSchema,
		selectedChoiceId: SessionChoiceIdSchema,
		text: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);
export type SessionCompletedParams = Static<typeof SessionCompletedParamsSchema>;

export const SessionCompletedNotification = new NotificationType<SessionCompletedParams>(
	'session.completed',
);

export const SessionErrorParamsSchema = Type.Object(
	{
		sessionId: SessionIdSchema,
		error: ProtocolErrorDataSchema,
	},
	{ additionalProperties: false },
);
export type SessionErrorParams = Static<typeof SessionErrorParamsSchema>;

export const SessionErrorNotification = new NotificationType<SessionErrorParams>('session.error');
