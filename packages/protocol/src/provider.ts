import { Type } from '@sinclair/typebox';
import { RequestType } from 'vscode-jsonrpc';

import type { Static } from '@sinclair/typebox';
import type { ProtocolErrorData } from './errors.js';

export const ProviderTestParamsSchema = Type.Object(
	{ providerId: Type.String({ minLength: 1 }) },
	{ additionalProperties: false },
);
export type ProviderTestParams = Static<typeof ProviderTestParamsSchema>;

export const ProviderTestResultSchema = Type.Object(
	{
		latencyMs: Type.Integer({ minimum: 0 }),
		partialResults: Type.Boolean(),
	},
	{ additionalProperties: false },
);
export type ProviderTestResult = Static<typeof ProviderTestResultSchema>;

export const ProviderTestRequest = new RequestType<
	ProviderTestParams,
	ProviderTestResult,
	ProtocolErrorData
>('provider.test');
