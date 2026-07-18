import { Type } from '@sinclair/typebox';
import { RequestType } from 'vscode-jsonrpc';

import { VoiceDictionarySchema } from '@voxspell/config/dictionary-schema';

import { EmptyParamsSchema, EmptyResultSchema } from './common.js';

import type { Static } from '@sinclair/typebox';
import type { VoiceDictionary } from '@voxspell/config/dictionary-schema';
import type { EmptyParams, EmptyResult } from './common.js';
import type { ProtocolErrorData } from './errors.js';

export const DictionaryGetParamsSchema = EmptyParamsSchema;
export const DictionaryGetResultSchema = Type.Object(
	{
		dictionary: VoiceDictionarySchema,
		path: Type.String({ minLength: 1 }),
		enabledCount: Type.Integer({ minimum: 0 }),
		promptCharacters: Type.Integer({ minimum: 0 }),
		lastError: Type.Optional(Type.String({ minLength: 1 })),
	},
	{ additionalProperties: false },
);
export type DictionaryGetResult = Static<typeof DictionaryGetResultSchema>;
export const DictionaryGetRequest = new RequestType<
	EmptyParams,
	DictionaryGetResult,
	ProtocolErrorData
>('dictionary.get');

export const DictionaryValidateParamsSchema = Type.Object(
	{ dictionary: VoiceDictionarySchema },
	{ additionalProperties: false },
);
export interface DictionaryValidateParams {
	readonly dictionary: VoiceDictionary;
}
export const DictionaryValidateResultSchema = EmptyResultSchema;
export const DictionaryValidateRequest = new RequestType<
	DictionaryValidateParams,
	EmptyResult,
	ProtocolErrorData
>('dictionary.validate');

export const DictionaryUpdateParamsSchema = DictionaryValidateParamsSchema;
export type DictionaryUpdateParams = DictionaryValidateParams;
export const DictionaryUpdateResultSchema = EmptyResultSchema;
export const DictionaryUpdateRequest = new RequestType<
	DictionaryUpdateParams,
	EmptyResult,
	ProtocolErrorData
>('dictionary.update');

export const DictionaryReloadParamsSchema = EmptyParamsSchema;
export const DictionaryReloadResultSchema = EmptyResultSchema;
export const DictionaryReloadRequest = new RequestType<EmptyParams, EmptyResult, ProtocolErrorData>(
	'dictionary.reload',
);
