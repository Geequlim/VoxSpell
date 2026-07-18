import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { saveVoiceDictionary } from '@voxspell/config/save-dictionary';

import { DaemonDictionaryManager } from '../src/configuration/daemon-dictionary-manager.js';

const dictionary = {
	version: 1 as const,
	entries: [
		{
			term: 'Codex',
			aliases: ['扣得克斯'],
			protect: true,
			boost: 10,
			enabled: true,
		},
	],
};

async function createFilePath(): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), 'voxspell-daemon-dictionary-'));
	return path.join(directory, 'dictionary.yaml');
}

describe('DaemonDictionaryManager', () => {
	it('uses an empty snapshot before the first dictionary is created', async () => {
		const filePath = await createFilePath();
		const manager = new DaemonDictionaryManager(filePath);

		await manager.initialize();

		expect(manager.getState()).toEqual({
			dictionary: { version: 1, entries: [] },
			path: filePath,
			enabledCount: 0,
			promptCharacters: 0,
			lastError: undefined,
		});
		expect(manager.getSnapshot().apply('扣得克斯')).toBe('扣得克斯');
	});

	it('atomically saves and activates a valid candidate', async () => {
		const filePath = await createFilePath();
		const manager = new DaemonDictionaryManager(filePath);
		await manager.initialize();

		await manager.update(dictionary);

		expect(manager.getState().dictionary).toEqual(dictionary);
		expect(manager.getSnapshot().apply('扣得克斯')).toBe('Codex');
	});

	it('keeps the previous snapshot when a disk reload is invalid', async () => {
		const filePath = await createFilePath();
		await saveVoiceDictionary(filePath, dictionary);
		const manager = new DaemonDictionaryManager(filePath);
		await manager.initialize();
		const previous = manager.getSnapshot();
		await writeFile(filePath, 'invalid: [', 'utf8');

		await expect(manager.reload()).rejects.toThrow();

		expect(manager.getSnapshot()).toBe(previous);
		expect(manager.getState().lastError).toBeDefined();
	});

	it('hot reloads a valid external file replacement', async () => {
		const filePath = await createFilePath();
		const manager = new DaemonDictionaryManager(filePath);
		await manager.initialize();
		await manager.startWatching();

		await saveVoiceDictionary(filePath, dictionary);

		await vi.waitFor(() => expect(manager.getSnapshot().apply('扣得克斯')).toBe('Codex'));
		manager.dispose();
	});
});
