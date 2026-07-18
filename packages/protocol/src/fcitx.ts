import { Type } from '@sinclair/typebox';
import { RequestType } from 'vscode-jsonrpc';

import { EmptyParamsSchema, EmptyResultSchema } from './common.js';

import type { Static } from '@sinclair/typebox';
import type { EmptyParams, EmptyResult } from './common.js';
import type { ProtocolErrorData } from './errors.js';

export const VoxSpellFcitxConfigSchema = Type.Object(
	{
		pttKey: Type.String({ minLength: 1 }),
		holdThresholdMs: Type.Integer({ minimum: 100, maximum: 2000 }),
		autoSelectResult: Type.Boolean(),
		polishingToggleKey: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);
export type VoxSpellFcitxConfig = Static<typeof VoxSpellFcitxConfigSchema>;

export const FcitxGetConfigParamsSchema = EmptyParamsSchema;
export const FcitxGetConfigResultSchema = VoxSpellFcitxConfigSchema;
export const FcitxGetConfigRequest = new RequestType<
	EmptyParams,
	VoxSpellFcitxConfig,
	ProtocolErrorData
>('fcitx.getConfig');

export const FcitxUpdateConfigParamsSchema = Type.Object(
	{ config: VoxSpellFcitxConfigSchema },
	{ additionalProperties: false },
);
export type FcitxUpdateConfigParams = Static<typeof FcitxUpdateConfigParamsSchema>;
export const FcitxUpdateConfigResultSchema = EmptyResultSchema;
export const FcitxUpdateConfigRequest = new RequestType<
	FcitxUpdateConfigParams,
	EmptyResult,
	ProtocolErrorData
>('fcitx.updateConfig');
