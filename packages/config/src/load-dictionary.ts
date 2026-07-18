import { readFile } from 'node:fs/promises';

import { Value } from '@sinclair/typebox/value';
import { parse } from 'yaml';

import { VoiceDictionarySchema } from './dictionary-schema.js';

import type { VoiceDictionary } from './dictionary-schema.js';

export interface DictionaryValidationIssue {
	readonly path: string;
	readonly message: string;
}

/** 表示语音词典无法解析或存在冲突。 */
export class VoiceDictionaryError extends Error {
	readonly issues: readonly DictionaryValidationIssue[];

	constructor(message: string, issues: readonly DictionaryValidationIssue[] = []) {
		super(message);
		this.name = 'VoiceDictionaryError';
		this.issues = issues;
	}
}

/** 表示默认语音词典尚未创建。 */
export class VoiceDictionaryNotFoundError extends VoiceDictionaryError {
	constructor(filePath: string) {
		super(`Voice dictionary does not exist: ${filePath}`);
		this.name = 'VoiceDictionaryNotFoundError';
	}
}

/** 解析未知值并校验语音词典的字段与跨条目冲突。 */
export function parseVoiceDictionary(value: unknown): VoiceDictionary {
	const issues = [...Value.Errors(VoiceDictionarySchema, value)].map((issue) => ({
		path: issue.path,
		message: issue.message,
	}));
	if (issues.length > 0) throw new VoiceDictionaryError('Voice dictionary is invalid', issues);

	const dictionary = value as VoiceDictionary;
	const owners = new Map<string, string>();
	dictionary.entries.forEach((entry, entryIndex) => {
		validateText(entry.term, `/entries/${entryIndex}/term`);
		const termKey = normalizeDictionaryKey(entry.term);
		const existingTerm = owners.get(termKey);
		if (existingTerm) {
			throw new VoiceDictionaryError(
				`Dictionary spelling is shared by ${existingTerm} and ${entry.term}`,
			);
		}
		owners.set(termKey, entry.term);

		const aliases = new Set<string>();
		entry.aliases.forEach((alias, aliasIndex) => {
			validateText(alias, `/entries/${entryIndex}/aliases/${aliasIndex}`);
			const aliasKey = normalizeDictionaryKey(alias);
			if (aliasKey === termKey) {
				throw new VoiceDictionaryError(`Dictionary alias repeats its term: ${entry.term}`);
			}
			if (aliases.has(aliasKey)) {
				throw new VoiceDictionaryError(`Dictionary alias is duplicated: ${alias}`);
			}
			aliases.add(aliasKey);
			const existingOwner = owners.get(aliasKey);
			if (existingOwner) {
				throw new VoiceDictionaryError(
					`Dictionary spelling is shared by ${existingOwner} and ${entry.term}`,
				);
			}
			owners.set(aliasKey, entry.term);
		});
	});
	return dictionary;
}

/** 从 YAML 文件加载并校验语音词典。 */
export async function loadVoiceDictionary(filePath: string): Promise<VoiceDictionary> {
	let source: string;
	try {
		source = await readFile(filePath, 'utf8');
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			throw new VoiceDictionaryNotFoundError(filePath);
		}
		throw new VoiceDictionaryError(`Unable to read voice dictionary: ${filePath}`);
	}

	let value: unknown;
	try {
		value = parse(source);
	} catch {
		throw new VoiceDictionaryError(`Unable to parse voice dictionary: ${filePath}`);
	}
	return parseVoiceDictionary(value);
}

/** 生成词典冲突检测和匹配共用的稳定键。 */
export function normalizeDictionaryKey(value: string): string {
	return value.normalize('NFKC').toLowerCase();
}

function validateText(value: string, path: string): void {
	if (value !== value.trim()) {
		throw new VoiceDictionaryError('Dictionary text must not have surrounding whitespace', [
			{ path, message: 'Must not have surrounding whitespace' },
		]);
	}
}
