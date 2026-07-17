import { Type } from '@sinclair/typebox';

import type { Static } from '@sinclair/typebox';

export const ServerCapabilitiesSchema = Type.Object(
	{
		partialTranscript: Type.Boolean(),
		polishPreview: Type.Boolean(),
	},
	{ additionalProperties: false },
);
export type ServerCapabilities = Static<typeof ServerCapabilitiesSchema>;
