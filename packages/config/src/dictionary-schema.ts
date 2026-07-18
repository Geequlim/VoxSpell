import { Type } from '@sinclair/typebox';

import type { Static } from '@sinclair/typebox';

const DictionaryTextSchema = Type.String({
	minLength: 1,
	maxLength: 200,
	pattern: '^[^\\u0000-\\u001f\\u007f]+$',
});

export const VoiceDictionaryEntrySchema = Type.Object(
	{
		term: DictionaryTextSchema,
		aliases: Type.Array(DictionaryTextSchema, { maxItems: 50 }),
		protect: Type.Boolean(),
		boost: Type.Integer({ minimum: 1, maximum: 10 }),
		enabled: Type.Boolean(),
	},
	{ additionalProperties: false },
);
export type VoiceDictionaryEntry = Static<typeof VoiceDictionaryEntrySchema>;

export const VoiceDictionarySchema = Type.Object(
	{
		version: Type.Literal(1),
		entries: Type.Array(VoiceDictionaryEntrySchema, { maxItems: 10_000 }),
	},
	{ additionalProperties: false },
);
export type VoiceDictionary = Static<typeof VoiceDictionarySchema>;

/** 创建尚无用户词条时使用的空词典。 */
export function createEmptyVoiceDictionary(): VoiceDictionary {
	return { version: 1, entries: [] };
}
