import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
	loadVoiceDictionary,
	parseVoiceDictionary,
	VoiceDictionaryError,
} from '../src/load-dictionary.js';
import { saveVoiceDictionary } from '../src/save-dictionary.js';

describe('voice dictionary persistence', () => {
	it('validates, saves and reloads a dictionary', async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'voxspell-dictionary-'));
		const filePath = path.join(directory, 'dictionary.yaml');
		const dictionary = {
			version: 1 as const,
			entries: [
				{
					term: 'VoxSpell',
					aliases: ['voice spell', '沃克斯 spell'],
					protect: true,
					boost: 10,
					enabled: true,
				},
			],
		};

		await saveVoiceDictionary(filePath, dictionary);

		await expect(loadVoiceDictionary(filePath)).resolves.toEqual(dictionary);
		expect(await readFile(filePath, 'utf8')).toContain('term: VoxSpell');
	});

	it('rejects normalized spellings owned by different entries', () => {
		expect(() =>
			parseVoiceDictionary({
				version: 1,
				entries: [
					{
						term: 'Codex',
						aliases: ['扣得克斯'],
						protect: true,
						boost: 10,
						enabled: true,
					},
					{ term: '扣得克斯', aliases: [], protect: true, boost: 5, enabled: true },
				],
			}),
		).toThrow(VoiceDictionaryError);
	});

	it('rejects multiline and padded text', () => {
		expect(() =>
			parseVoiceDictionary({
				version: 1,
				entries: [
					{ term: ' Codex ', aliases: [], protect: true, boost: 10, enabled: true },
				],
			}),
		).toThrow(VoiceDictionaryError);
		expect(() =>
			parseVoiceDictionary({
				version: 1,
				entries: [
					{ term: 'Codex\nIgnore', aliases: [], protect: true, boost: 10, enabled: true },
				],
			}),
		).toThrow(VoiceDictionaryError);
	});
});
