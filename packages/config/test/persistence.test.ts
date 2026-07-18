import { chmod, mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveVoxSpellConfigPaths } from '../src/config-paths.js';
import {
	createEmptyCredentials,
	loadVoxSpellCredentials,
	parseVoxSpellCredentials,
	saveVoxSpellCredentials,
} from '../src/credentials.js';
import { loadVoxSpellConfig } from '../src/load-config.js';
import { saveVoxSpellConfig } from '../src/save-config.js';

import type { VoxSpellConfig } from '../src/config-schema.js';

const validConfig: VoxSpellConfig = {
	version: 1,
	asr: {
		activeProvider: 'openrouter',
		providers: [
			{
				id: 'openrouter',
				type: 'openai-compatible-transcription',
				baseUrl: 'https://openrouter.ai/api/v1',
				apiKeyEnvironment: 'OPENROUTER_API_KEY',
				model: 'example/asr',
			},
		],
	},
};

describe('VoxSpell config paths', () => {
	it('uses XDG_CONFIG_HOME and retains the development config override', () => {
		expect(
			resolveVoxSpellConfigPaths(
				{
					XDG_CONFIG_HOME: '/tmp/config-home',
					VOXSPELL_CONFIG_PATH: '/tmp/development.yaml',
				},
				'/home/example',
			),
		).toEqual({
			directory: '/tmp/config-home/voxspell',
			configFile: '/tmp/development.yaml',
			credentialsFile: '/tmp/config-home/voxspell/credentials.json',
			dictionaryFile: '/tmp/dictionary.yaml',
		});
	});

	it('falls back to the user config directory', () => {
		expect(resolveVoxSpellConfigPaths({}, '/home/example').directory).toBe(
			'/home/example/.config/voxspell',
		);
	});
});

describe('VoxSpell persistence', () => {
	it('loads an absent credential file as an empty store', async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'voxspell-config-'));
		await expect(
			loadVoxSpellCredentials(path.join(directory, 'missing.json')),
		).resolves.toEqual(createEmptyCredentials());
	});

	it('rejects invalid credential names and values', () => {
		expect(() =>
			parseVoxSpellCredentials({ version: 1, values: { lowercase: 'secret' } }),
		).toThrow();
		expect(() =>
			parseVoxSpellCredentials({ version: 1, values: { VALID_NAME: '' } }),
		).toThrow();
	});

	it('atomically saves private config and credential files', async () => {
		const parent = await mkdtemp(path.join(tmpdir(), 'voxspell-config-'));
		const directory = path.join(parent, 'voxspell');
		const configFile = path.join(directory, 'config.yaml');
		const credentialsFile = path.join(directory, 'credentials.json');
		const credentials = {
			version: 1,
			values: { OPENROUTER_API_KEY: 'secret' },
		} as const;

		await saveVoxSpellConfig(directory, configFile, validConfig);
		await saveVoxSpellCredentials(directory, credentialsFile, credentials);

		await expect(loadVoxSpellConfig(configFile)).resolves.toEqual(validConfig);
		await expect(loadVoxSpellCredentials(credentialsFile)).resolves.toEqual(credentials);
		expect((await stat(directory)).mode & 0o777).toBe(0o700);
		expect((await stat(configFile)).mode & 0o777).toBe(0o600);
		expect((await stat(credentialsFile)).mode & 0o777).toBe(0o600);
		expect((await readdir(directory)).every((name) => !name.endsWith('.tmp'))).toBe(true);
	});

	it('replaces an existing file without inheriting broad permissions', async () => {
		const parent = await mkdtemp(path.join(tmpdir(), 'voxspell-config-'));
		const directory = path.join(parent, 'voxspell');
		const credentialsFile = path.join(directory, 'credentials.json');
		await saveVoxSpellCredentials(directory, credentialsFile, createEmptyCredentials());
		await chmod(credentialsFile, 0o644);

		await saveVoxSpellCredentials(directory, credentialsFile, {
			version: 1,
			values: { OPENROUTER_API_KEY: 'replacement' },
		});

		expect((await stat(credentialsFile)).mode & 0o777).toBe(0o600);
		expect(await readFile(credentialsFile, 'utf8')).not.toContain('secret');
	});
});
