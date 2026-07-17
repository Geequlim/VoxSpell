import { Type } from '@sinclair/typebox';
import { NotificationType } from 'vscode-jsonrpc';

import { SessionIdSchema } from './common.js';

import type { Static } from '@sinclair/typebox';

export const PolishStartedParamsSchema = Type.Object(
	{
		sessionId: SessionIdSchema,
	},
	{ additionalProperties: false },
);
export type PolishStartedParams = Static<typeof PolishStartedParamsSchema>;

export const PolishStartedNotification = new NotificationType<PolishStartedParams>(
	'polish.started',
);

export const PolishDeltaParamsSchema = Type.Object(
	{
		sessionId: SessionIdSchema,
		text: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);
export type PolishDeltaParams = Static<typeof PolishDeltaParamsSchema>;

export const PolishDeltaNotification = new NotificationType<PolishDeltaParams>('polish.delta');

export const PolishFinalParamsSchema = Type.Object(
	{
		sessionId: SessionIdSchema,
		text: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);
export type PolishFinalParams = Static<typeof PolishFinalParamsSchema>;

export const PolishFinalNotification = new NotificationType<PolishFinalParams>('polish.final');
