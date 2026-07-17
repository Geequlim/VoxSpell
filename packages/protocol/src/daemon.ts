import { Type } from '@sinclair/typebox';
import { NotificationType, RequestType } from 'vscode-jsonrpc';

import { ServerCapabilitiesSchema } from './capabilities.js';
import { EmptyParamsSchema, EmptyResultSchema, ServiceInfoSchema } from './common.js';

import type { Static } from '@sinclair/typebox';
import type { EmptyParams, EmptyResult } from './common.js';
import type { ProtocolErrorData } from './errors.js';

export const DaemonReadyParamsSchema = Type.Object(
	{
		serverInfo: ServiceInfoSchema,
		capabilities: ServerCapabilitiesSchema,
	},
	{ additionalProperties: false },
);
export type DaemonReadyParams = Static<typeof DaemonReadyParamsSchema>;

export const DaemonReadyNotification = new NotificationType<DaemonReadyParams>('daemon.ready');

export const ConfigReloadParamsSchema = EmptyParamsSchema;
export const ConfigReloadResultSchema = EmptyResultSchema;
export const ConfigReloadRequest = new RequestType<EmptyParams, EmptyResult, ProtocolErrorData>(
	'config.reload',
);

export const DaemonPingParamsSchema = EmptyParamsSchema;
export const DaemonPingResultSchema = Type.Object(
	{
		timestampMs: Type.Integer({ minimum: 0 }),
	},
	{ additionalProperties: false },
);
export type DaemonPingResult = Static<typeof DaemonPingResultSchema>;

export const DaemonPingRequest = new RequestType<EmptyParams, DaemonPingResult, ProtocolErrorData>(
	'daemon.ping',
);
