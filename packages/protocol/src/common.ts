import { Type } from '@sinclair/typebox';

import type { Static } from '@sinclair/typebox';

export const PROTOCOL_VERSION = 1;

export const ProtocolVersionSchema = Type.Literal(PROTOCOL_VERSION);
export type ProtocolVersion = Static<typeof ProtocolVersionSchema>;

export const ServiceInfoSchema = Type.Object(
	{
		name: Type.String({ minLength: 1 }),
		version: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);
export type ServiceInfo = Static<typeof ServiceInfoSchema>;

export const SessionIdSchema = Type.String({
	pattern:
		'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
});
export type SessionId = Static<typeof SessionIdSchema>;

export const EmptyParamsSchema = Type.Object({}, { additionalProperties: false });
export type EmptyParams = Static<typeof EmptyParamsSchema>;

export const EmptyResultSchema = Type.Null();
export type EmptyResult = Static<typeof EmptyResultSchema>;
