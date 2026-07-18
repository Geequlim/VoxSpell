import { Type } from '@sinclair/typebox';
import { RequestType } from 'vscode-jsonrpc';

import { EmptyParamsSchema, EmptyResultSchema } from './common.js';

import type { Static } from '@sinclair/typebox';
import type { EmptyParams, EmptyResult } from './common.js';
import type { ProtocolErrorData } from './errors.js';

const CredentialNameSchema = Type.String({ pattern: '^[A-Z][A-Z0-9_]*$' });

export const CredentialsGetStatusParamsSchema = EmptyParamsSchema;
export const CredentialsGetStatusResultSchema = Type.Object(
	{ storedNames: Type.Array(CredentialNameSchema) },
	{ additionalProperties: false },
);
export type CredentialsGetStatusResult = Static<typeof CredentialsGetStatusResultSchema>;
export const CredentialsGetStatusRequest = new RequestType<
	EmptyParams,
	CredentialsGetStatusResult,
	ProtocolErrorData
>('credentials.getStatus');

export const CredentialValueUpdateSchema = Type.Object(
	{
		name: CredentialNameSchema,
		value: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);
export type CredentialValueUpdate = Static<typeof CredentialValueUpdateSchema>;

export const CredentialsUpdateParamsSchema = Type.Object(
	{
		set: Type.Array(CredentialValueUpdateSchema),
		delete: Type.Array(CredentialNameSchema),
	},
	{ additionalProperties: false },
);
export type CredentialsUpdateParams = Static<typeof CredentialsUpdateParamsSchema>;
export const CredentialsUpdateResultSchema = EmptyResultSchema;
export const CredentialsUpdateRequest = new RequestType<
	CredentialsUpdateParams,
	EmptyResult,
	ProtocolErrorData
>('credentials.update');
