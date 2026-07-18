import { describe, expect, it, vi } from 'vitest';

import { ConfigState } from './config-state';
import { DaemonState } from './daemon-state';

import type { VoxSpellConfig } from '@voxspell/config/config-schema';
import type {
	CredentialsGetStatusResult,
	CredentialsUpdateParams,
} from '@voxspell/protocol/credentials';
import type { DaemonGetStatusResult } from '@voxspell/protocol/daemon';
import type { InitializeResult } from '@voxspell/protocol/initialize';
import type { ConfigClient } from './config-state';
import type { DaemonClient } from './daemon-state';

const initializeResult: InitializeResult = {
	protocolVersion: 1,
	serverInfo: { name: 'test-daemon', version: '0.0.0' },
	capabilities: { partialTranscript: false, polishPreview: false },
};
const daemonStatus: DaemonGetStatusResult = {
	state: 'ready',
	configPath: '/tmp/config.yaml',
	credentialsPath: '/tmp/credentials.json',
	activeProvider: 'openrouter',
	missingCredentialNames: [],
};
const initialConfig: VoxSpellConfig = {
	version: 1,
	asr: {
		activeProvider: 'openrouter',
		providers: [
			{
				id: 'openrouter',
				type: 'openai-compatible-transcription',
				baseUrl: 'https://openrouter.ai/api/v1',
				apiKeyEnvironment: 'OPENROUTER_API_KEY',
				model: 'old-model',
			},
		],
	},
};

class FakeDesktopClient implements DaemonClient, ConfigClient {
	config: VoxSpellConfig | null = structuredClone(initialConfig);
	storedNames: string[] = [];
	connect = vi.fn(async () => initializeResult);
	getStatus = vi.fn(async () => daemonStatus);
	validateConfig = vi.fn(async () => undefined);
	updateConfig = vi.fn(async (config: VoxSpellConfig) => {
		this.config = structuredClone(config);
	});
	updateCredentials = vi.fn(async (params: CredentialsUpdateParams) => {
		this.storedNames.push(...params.set.map((entry) => entry.name));
	});
	dispose = vi.fn();
	disconnectListener?: () => void;

	async getConfig(): Promise<VoxSpellConfig | null> {
		return structuredClone(this.config);
	}

	async getCredentialsStatus(): Promise<CredentialsGetStatusResult> {
		return { storedNames: [...this.storedNames] };
	}

	onDidDisconnect(listener: () => void): () => void {
		this.disconnectListener = listener;
		return () => {
			this.disconnectListener = undefined;
		};
	}
}

interface TestState {
	readonly client: FakeDesktopClient;
	readonly daemon: DaemonState;
	readonly config: ConfigState;
}

function createTestState(): TestState {
	const client = new FakeDesktopClient();
	const daemon = new DaemonState(client);
	const config = new ConfigState(client, daemon);
	daemon.start();
	return { client, daemon, config };
}

function disposeTestState(state: TestState): void {
	state.config.dispose();
	state.daemon.dispose();
}

describe('ConfigState', () => {
	it('loads, edits and saves configuration and credentials in order', async () => {
		const state = createTestState();
		await vi.waitFor(() => expect(state.config.draft).toBeDefined());
		expect(state.config.model).toBe('old-model');
		expect(state.config.selectedCredentialName).toBe('OPENROUTER_API_KEY');
		expect(state.config.selectedCredentialStatus).toBe('由 daemon 运行环境提供');

		state.config.updateModel('new-model');
		state.config.updateSelectedCredential('new-secret');
		expect(state.config.isDirty).toBe(true);
		await state.config.save();

		expect(state.client.updateCredentials).toHaveBeenCalledWith({
			set: [{ name: 'OPENROUTER_API_KEY', value: 'new-secret' }],
			delete: [],
		});
		expect(state.client.validateConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				asr: expect.objectContaining({ activeProvider: 'openrouter' }),
			}),
		);
		expect(state.client.updateConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				asr: expect.objectContaining({
					providers: [expect.objectContaining({ model: 'new-model' })],
				}),
			}),
		);
		expect(state.client.updateCredentials.mock.invocationCallOrder[0]).toBeLessThan(
			state.client.validateConfig.mock.invocationCallOrder[0]!,
		);
		expect(state.config.phase).toBe('saved');
		expect(state.config.isDirty).toBe(false);
		expect(state.config.selectedCredentialValue).toBe('');
		disposeTestState(state);
	});

	it('rejects invalid form fields before calling daemon validation', async () => {
		const state = createTestState();
		await vi.waitFor(() => expect(state.config.draft).toBeDefined());
		state.config.updateBaseUrl('not-a-url');

		await state.config.save();

		expect(state.config.phase).toBe('error');
		expect(state.config.fieldErrors.baseUrl).toContain('HTTP');
		expect(state.client.validateConfig).not.toHaveBeenCalled();
		expect(state.client.updateConfig).not.toHaveBeenCalled();
		disposeTestState(state);
	});

	it('creates an editable first-run draft when daemon has no configuration', async () => {
		const state = createTestState();
		await vi.waitFor(() => expect(state.config.draft).toBeDefined());
		state.client.config = null;
		await state.config.load();

		expect(state.config.config).toBeUndefined();
		expect(state.config.draft).toMatchObject({
			asr: { activeProvider: 'openai' },
		});
		expect(state.config.requiredCredentialNames).toEqual(['OPENAI_API_KEY']);
		expect(state.config.isDirty).toBe(true);
		disposeTestState(state);
	});
});
