import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createEmptyCredentials, saveVoxSpellCredentials } from '@voxspell/config/credentials';
import { loadVoxSpellConfig } from '@voxspell/config/load-config';
import { saveVoxSpellConfig } from '@voxspell/config/save-config';

import { DaemonConfigManager } from '../src/configuration/daemon-config-manager.js';
import { FakeRealtimeAsrProvider } from './fakes/fake-realtime-asr.js';
import { FakeTextPolisher } from './fakes/fake-text-polisher.js';

import type { VoxSpellConfigPaths } from '@voxspell/config/config-paths';
import type { VoxSpellConfig } from '@voxspell/config/config-schema';

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

async function createPaths(): Promise<VoxSpellConfigPaths> {
	const directory = await mkdtemp(path.join(tmpdir(), 'voxspell-daemon-config-'));
	return {
		directory,
		configFile: path.join(directory, 'config.yaml'),
		credentialsFile: path.join(directory, 'credentials.json'),
		dictionaryFile: path.join(directory, 'dictionary.yaml'),
	};
}

describe('DaemonConfigManager', () => {
	it('creates and loads a default config before startup completes', async () => {
		const paths = await createPaths();
		const manager = new DaemonConfigManager({ paths, environment: {} });

		await expect(manager.initialize()).resolves.toBeUndefined();

		expect(manager.getAsrProvider()).toBeUndefined();
		expect(await loadVoxSpellConfig(paths.configFile)).toMatchObject({
			asr: {
				activeProvider: 'openai',
				providers: [{ model: 'whisper-1' }],
			},
		});
		expect(manager.getConfig()).toMatchObject({
			asr: { activeProvider: 'openai' },
		});
		expect(manager.getStatus()).toMatchObject({
			state: 'needs-configuration',
			configPath: paths.configFile,
			missingCredentialNames: ['OPENAI_API_KEY'],
		});
	});

	it('does not overwrite an existing invalid config during startup', async () => {
		const paths = await createPaths();
		const source = 'invalid: [';
		await writeFile(paths.configFile, source, 'utf8');
		const manager = new DaemonConfigManager({ paths, environment: {} });

		await expect(manager.initialize()).resolves.toBeUndefined();

		expect(await readFile(paths.configFile, 'utf8')).toBe(source);
		expect(manager.getStatus().state).toBe('degraded');
	});

	it('loads stored credentials and lets the process environment override them', async () => {
		const paths = await createPaths();
		await saveVoxSpellConfig(paths.directory, paths.configFile, validConfig);
		await saveVoxSpellCredentials(paths.directory, paths.credentialsFile, {
			version: 1,
			values: { OPENROUTER_API_KEY: 'stored-secret' },
		});
		const createProvider = vi.fn(() => new FakeRealtimeAsrProvider());
		const manager = new DaemonConfigManager({
			paths,
			environment: { OPENROUTER_API_KEY: 'environment-secret' },
			createProvider,
		});

		await manager.initialize();

		expect(createProvider).toHaveBeenCalledWith(
			validConfig,
			expect.objectContaining({ OPENROUTER_API_KEY: 'environment-secret' }),
		);
		expect(manager.getStatus()).toMatchObject({
			state: 'ready',
			activeProvider: 'fake-asr',
			missingCredentialNames: [],
		});
	});

	it('provides daemon-owned text processing options for new sessions', async () => {
		const paths = await createPaths();
		const config: VoxSpellConfig = {
			...validConfig,
			textProcessing: { trimTrailingPeriod: true },
		};
		await saveVoxSpellConfig(paths.directory, paths.configFile, config);
		const manager = new DaemonConfigManager({
			paths,
			environment: { OPENROUTER_API_KEY: 'secret' },
		});

		await manager.initialize();

		expect(manager.getTrimTrailingPeriod()).toBe(true);
	});

	it('provides the configured recording limit and defaults to five minutes', async () => {
		const paths = await createPaths();
		await saveVoxSpellConfig(paths.directory, paths.configFile, validConfig);
		const manager = new DaemonConfigManager({
			paths,
			environment: { OPENROUTER_API_KEY: 'secret' },
		});
		await manager.initialize();

		expect(manager.getMaximumRecordingMilliseconds()).toBe(300_000);
		await manager.updateConfig({
			...validConfig,
			session: { maximumRecordingSeconds: 45 },
		});
		expect(manager.getMaximumRecordingMilliseconds()).toBe(45_000);
	});

	it('activates a valid pending config when its missing credentials are supplied', async () => {
		const paths = await createPaths();
		await saveVoxSpellConfig(paths.directory, paths.configFile, validConfig);
		const manager = new DaemonConfigManager({ paths, environment: {} });

		await manager.initialize();

		expect(manager.getStatus()).toMatchObject({
			state: 'degraded',
			activeProvider: 'openrouter',
			missingCredentialNames: ['OPENROUTER_API_KEY'],
		});
		await manager.updateCredentialEntries(
			[{ name: 'OPENROUTER_API_KEY', value: 'secret' }],
			[],
		);
		expect(manager.getStatus()).toMatchObject({
			state: 'ready',
			missingCredentialNames: [],
		});
		expect(manager.getAsrProvider()?.id).toBe('openrouter');
	});

	it('keeps the previous runtime snapshot when reload fails', async () => {
		const paths = await createPaths();
		await saveVoxSpellConfig(paths.directory, paths.configFile, validConfig);
		const previousProvider = new FakeRealtimeAsrProvider();
		const manager = new DaemonConfigManager({
			paths,
			environment: { OPENROUTER_API_KEY: 'secret' },
			createProvider: () => previousProvider,
		});
		await manager.initialize();
		await writeFile(paths.configFile, 'invalid: [', 'utf8');

		await expect(manager.reload()).rejects.toThrow();

		expect(manager.getAsrProvider()).toBe(previousProvider);
		expect(manager.getStatus()).toMatchObject({ state: 'ready' });
		expect(manager.getStatus().lastError).toBeDefined();
	});

	it('saves credentials and rebuilds the active provider', async () => {
		const paths = await createPaths();
		await saveVoxSpellConfig(paths.directory, paths.configFile, validConfig);
		const providers = [new FakeRealtimeAsrProvider(), new FakeRealtimeAsrProvider()];
		const createProvider = vi.fn(() => providers.shift()!);
		const manager = new DaemonConfigManager({ paths, environment: {}, createProvider });
		await saveVoxSpellCredentials(paths.directory, paths.credentialsFile, {
			version: 1,
			values: { OPENROUTER_API_KEY: 'first-secret' },
		});
		await manager.initialize();

		await manager.updateCredentials({
			version: 1,
			values: { OPENROUTER_API_KEY: 'second-secret' },
		});

		expect(createProvider).toHaveBeenCalledTimes(2);
		expect(manager.getCredentials()).toEqual({
			version: 1,
			values: { OPENROUTER_API_KEY: 'second-secret' },
		});
	});

	it('atomically rebuilds the enabled text polisher from updated configuration', async () => {
		const paths = await createPaths();
		const polishingConfig: VoxSpellConfig = {
			...validConfig,
			polishing: {
				enabled: true,
				activeProvider: 'chat',
				systemPrompt: '旧提示词',
				providers: [
					{
						id: 'chat',
						type: 'openai-compatible-chat',
						baseUrl: 'https://openrouter.ai/api/v1',
						apiKeyEnvironment: 'CHAT_API_KEY',
						model: 'example/chat',
					},
				],
			},
		};
		await saveVoxSpellConfig(paths.directory, paths.configFile, polishingConfig);
		const polishers = [new FakeTextPolisher(), new FakeTextPolisher()];
		const createTextPolisher = vi.fn(() => polishers.shift());
		const manager = new DaemonConfigManager({
			paths,
			environment: { OPENROUTER_API_KEY: 'asr-secret', CHAT_API_KEY: 'chat-secret' },
			createProvider: () => new FakeRealtimeAsrProvider(),
			createTextPolisher,
		});
		await manager.initialize();
		const previousPolisher = manager.getTextPolisher();

		const updatedConfig = structuredClone(polishingConfig);
		updatedConfig.polishing!.systemPrompt = '新提示词';
		await manager.updateConfig(updatedConfig);

		expect(createTextPolisher).toHaveBeenCalledTimes(2);
		expect(manager.getTextPolisher()).not.toBe(previousPolisher);
		expect(manager.getConfig()?.polishing?.systemPrompt).toBe('新提示词');
	});

	it('activates the startup default config when its credential is supplied', async () => {
		const paths = await createPaths();
		const manager = new DaemonConfigManager({ paths, environment: {} });
		await manager.initialize();

		await manager.updateCredentials({
			version: 1,
			values: { OPENAI_API_KEY: 'secret' },
		});

		expect(manager.getCredentials()).not.toEqual(createEmptyCredentials());
		expect(manager.getStatus().state).toBe('ready');
	});

	it('tests a selected provider without replacing the active runtime provider', async () => {
		const paths = await createPaths();
		await saveVoxSpellConfig(paths.directory, paths.configFile, validConfig);
		const activeProvider = new FakeRealtimeAsrProvider();
		const testedProvider = new FakeRealtimeAsrProvider();
		const createProvider = vi.fn(
			(_config: VoxSpellConfig, _environment: NodeJS.ProcessEnv, providerId?: string) =>
				providerId ? testedProvider : activeProvider,
		);
		const manager = new DaemonConfigManager({
			paths,
			environment: { OPENROUTER_API_KEY: 'secret' },
			createProvider,
		});
		await manager.initialize();

		await expect(manager.testProvider('openrouter')).resolves.toMatchObject({
			partialResults: true,
		});
		expect(createProvider).toHaveBeenLastCalledWith(
			validConfig,
			expect.objectContaining({ OPENROUTER_API_KEY: 'secret' }),
			'openrouter',
		);
		expect(manager.getAsrProvider()).toBe(activeProvider);
	});

	it('serializes credential patches without losing concurrent updates', async () => {
		const paths = await createPaths();
		const manager = new DaemonConfigManager({
			paths,
			environment: { OPENAI_API_KEY: 'startup-secret' },
		});
		await manager.initialize();

		await Promise.all([
			manager.updateCredentialEntries([{ name: 'FIRST_KEY', value: 'first' }], []),
			manager.updateCredentialEntries([{ name: 'SECOND_KEY', value: 'second' }], []),
		]);

		expect(manager.getCredentials()).toEqual({
			version: 1,
			values: { FIRST_KEY: 'first', SECOND_KEY: 'second' },
		});
	});
});
