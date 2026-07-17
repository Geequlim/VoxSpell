import { Type } from '@sinclair/typebox';
import { RequestType } from 'vscode-jsonrpc';

import { ServerCapabilitiesSchema } from './capabilities.js';
import { ProtocolVersionSchema, ServiceInfoSchema } from './common.js';

import type { Static } from '@sinclair/typebox';
import type { ProtocolErrorData } from './errors.js';

export const InitializeParamsSchema = Type.Object(
	{
		protocolVersion: ProtocolVersionSchema,
		clientInfo: ServiceInfoSchema,
	},
	{ additionalProperties: false },
);
export type InitializeParams = Static<typeof InitializeParamsSchema>;

export const InitializeResultSchema = Type.Object(
	{
		protocolVersion: ProtocolVersionSchema,
		serverInfo: ServiceInfoSchema,
		capabilities: ServerCapabilitiesSchema,
	},
	{ additionalProperties: false },
);
export type InitializeResult = Static<typeof InitializeResultSchema>;

export const InitializeRequest = new RequestType<
	InitializeParams,
	InitializeResult,
	ProtocolErrorData
>('initialize');
