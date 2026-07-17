import { Type } from '@sinclair/typebox';
import { NotificationType, RequestType } from 'vscode-jsonrpc';

import { EmptyResultSchema, SessionIdSchema } from './common.js';
import { ProtocolErrorDataSchema } from './errors.js';

import type { Static } from '@sinclair/typebox';
import type { EmptyResult } from './common.js';
import type { ProtocolErrorData } from './errors.js';

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

export const SessionRecordingNotification = new NotificationType<SessionParams>(
	'session.recording',
);

export const SessionCompletedParamsSchema = Type.Object(
	{
		sessionId: SessionIdSchema,
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
