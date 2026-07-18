import { normalizeDictionaryKey } from '@voxspell/config/load-dictionary';

import type { VoiceDictionary, VoiceDictionaryEntry } from '@voxspell/config/dictionary-schema';

interface DictionaryPattern {
	readonly source: string;
	readonly key: string;
	readonly replacement: string;
}

/** 表示已经完成冲突校验并可直接匹配的不可变词典快照。 */
export class CompiledVoiceDictionary {
	readonly entries: readonly VoiceDictionaryEntry[];
	readonly #patternsByFirstCharacter: ReadonlyMap<string, readonly DictionaryPattern[]>;

	constructor(dictionary: VoiceDictionary) {
		this.entries = dictionary.entries
			.filter((entry) => entry.enabled)
			.map((entry) => ({ ...entry, aliases: [...entry.aliases] }));
		const patterns = this.entries.flatMap((entry) => [
			{
				source: entry.term.normalize('NFKC'),
				key: normalizeDictionaryKey(entry.term),
				replacement: entry.term,
			},
			...entry.aliases.map((alias) => ({
				source: alias.normalize('NFKC'),
				key: normalizeDictionaryKey(alias),
				replacement: entry.term,
			})),
		]);
		patterns.sort((left, right) => right.key.length - left.key.length);
		const byFirstCharacter = new Map<string, DictionaryPattern[]>();
		patterns.forEach((pattern) => {
			const firstCharacter = pattern.key[0]!;
			const bucket = byFirstCharacter.get(firstCharacter) ?? [];
			bucket.push(pattern);
			byFirstCharacter.set(firstCharacter, bucket);
		});
		this.#patternsByFirstCharacter = byFirstCharacter;
	}

	/** 单次从左到右执行最长优先、非级联的别名归一。 */
	apply(text: string): string {
		const normalized = text.normalize('NFKC');
		let result = '';
		let index = 0;
		while (index < normalized.length) {
			const firstCharacter = normalizeDictionaryKey(normalized[index]!)[0]!;
			const candidates = this.#patternsByFirstCharacter.get(firstCharacter);
			const pattern = candidates?.find((candidate) =>
				matchesPattern(normalized, index, candidate),
			);
			if (!pattern) {
				result = `${result}${normalized[index]}`;
				index += 1;
				continue;
			}
			result = `${result}${pattern.replacement}`;
			index += pattern.source.length;
		}
		return result;
	}
}

function matchesPattern(text: string, index: number, pattern: DictionaryPattern): boolean {
	const end = index + pattern.source.length;
	if (normalizeDictionaryKey(text.slice(index, end)) !== pattern.key) return false;
	if (isAsciiWordCharacter(pattern.source[0]) && isAsciiWordCharacter(text[index - 1])) {
		return false;
	}
	if (
		isAsciiWordCharacter(pattern.source[pattern.source.length - 1]) &&
		isAsciiWordCharacter(text[end])
	) {
		return false;
	}
	return true;
}

function isAsciiWordCharacter(value?: string): boolean {
	return value !== undefined && /^[A-Za-z0-9_]$/.test(value);
}
