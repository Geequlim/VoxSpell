import type { PolishDictionaryEntry } from './text-polisher.js';

/** 将当前用户词典快照作为数据区块追加到基础系统提示词。 */
export function composePolishSystemPrompt(
	systemPrompt: string,
	dictionary: readonly PolishDictionaryEntry[],
): string {
	if (dictionary.length === 0) return systemPrompt;

	const entries = dictionary
		.map((entry) => ({ canonical: entry.canonical, aliases: [...entry.aliases].sort() }))
		.sort((left, right) => {
			if (left.canonical < right.canonical) return -1;
			if (left.canonical > right.canonical) return 1;
			return 0;
		});
	return `${systemPrompt}\n\n<voice_dictionary>\n${JSON.stringify(entries)}\n</voice_dictionary>`;
}
