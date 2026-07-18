import { Type } from '@sinclair/typebox';
import { RequestType } from 'vscode-jsonrpc';

import { VoxSpellConfigSchema } from '@voxspell/config/config-schema';

import { EmptyParamsSchema, EmptyResultSchema } from './common.js';

import type { Static } from '@sinclair/typebox';
import type { VoxSpellConfig } from '@voxspell/config/config-schema';
import type { EmptyParams, EmptyResult } from './common.js';
import type { ProtocolErrorData } from './errors.js';

export const ConfigGetParamsSchema = EmptyParamsSchema;
export const ConfigGetResultSchema = Type.Union([VoxSpellConfigSchema, Type.Null()]);
export type ConfigGetResult = Static<typeof ConfigGetResultSchema>;
export const ConfigGetRequest = new RequestType<EmptyParams, ConfigGetResult, ProtocolErrorData>(
	'config.get',
);

export const ConfigValidateParamsSchema = Type.Object(
	{ config: VoxSpellConfigSchema },
	{ additionalProperties: false },
);
export type ConfigValidateParams = Static<typeof ConfigValidateParamsSchema>;
export const ConfigValidateResultSchema = EmptyResultSchema;
export const ConfigValidateRequest = new RequestType<
	ConfigValidateParams,
	EmptyResult,
	ProtocolErrorData
>('config.validate');

export const ConfigUpdateParamsSchema = Type.Object(
	{ config: VoxSpellConfigSchema },
	{ additionalProperties: false },
);
export interface ConfigUpdateParams {
	readonly config: VoxSpellConfig;
}
export const ConfigUpdateResultSchema = EmptyResultSchema;
export const ConfigUpdateRequest = new RequestType<
	ConfigUpdateParams,
	EmptyResult,
	ProtocolErrorData
>('config.update');
