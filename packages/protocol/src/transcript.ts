import { Type } from '@sinclair/typebox';
import { NotificationType } from 'vscode-jsonrpc';

import { SessionIdSchema } from './common.js';

import type { Static } from '@sinclair/typebox';

export const AsrReadyParamsSchema = Type.Object(
	{
		sessionId: SessionIdSchema,
		providerId: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);
export type AsrReadyParams = Static<typeof AsrReadyParamsSchema>;

export const AsrReadyNotification = new NotificationType<AsrReadyParams>('asr.ready');

export const TranscriptPartialParamsSchema = Type.Object(
	{
		sessionId: SessionIdSchema,
		segmentId: Type.String({ minLength: 1 }),
		revision: Type.Integer({ minimum: 0 }),
		text: Type.String(),
	},
	{ additionalProperties: false },
);
export type TranscriptPartialParams = Static<typeof TranscriptPartialParamsSchema>;

export const TranscriptPartialNotification = new NotificationType<TranscriptPartialParams>(
	'transcript.partial',
);

export const TranscriptSegmentFinalParamsSchema = Type.Object(
	{
		sessionId: SessionIdSchema,
		segmentId: Type.String({ minLength: 1 }),
		text: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);
export type TranscriptSegmentFinalParams = Static<typeof TranscriptSegmentFinalParamsSchema>;

export const TranscriptSegmentFinalNotification =
	new NotificationType<TranscriptSegmentFinalParams>('transcript.segmentFinal');

export const TranscriptFinalParamsSchema = Type.Object(
	{
		sessionId: SessionIdSchema,
		text: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);
export type TranscriptFinalParams = Static<typeof TranscriptFinalParamsSchema>;

export const TranscriptFinalNotification = new NotificationType<TranscriptFinalParams>(
	'transcript.final',
);
