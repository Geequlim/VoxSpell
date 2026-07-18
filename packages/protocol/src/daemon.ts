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

export const DaemonConfigurationStateSchema = Type.Union([
	Type.Literal('needs-configuration'),
	Type.Literal('ready'),
	Type.Literal('degraded'),
]);
export const DaemonGetStatusParamsSchema = EmptyParamsSchema;
export const DaemonGetStatusResultSchema = Type.Object(
	{
		state: DaemonConfigurationStateSchema,
		configPath: Type.String({ minLength: 1 }),
		credentialsPath: Type.String({ minLength: 1 }),
		activeProvider: Type.Optional(Type.String({ minLength: 1 })),
		missingCredentialNames: Type.Array(Type.String({ pattern: '^[A-Z][A-Z0-9_]*$' })),
		lastError: Type.Optional(Type.String({ minLength: 1 })),
	},
	{ additionalProperties: false },
);
export type DaemonGetStatusResult = Static<typeof DaemonGetStatusResultSchema>;
export const DaemonGetStatusRequest = new RequestType<
	EmptyParams,
	DaemonGetStatusResult,
	ProtocolErrorData
>('daemon.getStatus');
