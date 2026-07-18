import { describe, expect, it, vi } from 'vitest';

import { DictionaryState } from './dictionary-state';
import { DaemonState } from './daemon-state';

import type { VoiceDictionary } from '@voxspell/config/dictionary-schema';
import type { DaemonGetStatusResult } from '@voxspell/protocol/daemon';
import type { DictionaryGetResult } from '@voxspell/protocol/dictionary';
import type { InitializeResult } from '@voxspell/protocol/initialize';
import type { DaemonClient } from './daemon-state';
import type { DictionaryClient } from './dictionary-state';

const initializeResult: InitializeResult = {
	protocolVersion: 1,
	serverInfo: { name: 'test-daemon', version: '0.0.0' },
	capabilities: { partialTranscript: false, polishPreview: true },
};
const daemonStatus: DaemonGetStatusResult = {
	state: 'ready',
	configPath: '/tmp/config.yaml',
	credentialsPath: '/tmp/credentials.json',
	activeProvider: 'openrouter',
	missingCredentialNames: [],
};

class FakeDictionaryClient implements DaemonClient, DictionaryClient {
	dictionary: VoiceDictionary = { version: 1, entries: [] };
	lastError?: string;
	connect = vi.fn(async () => initializeResult);
	getStatus = vi.fn(async () => daemonStatus);
	validateDictionary = vi.fn(async () => undefined);
	updateDictionary = vi.fn(async (dictionary: VoiceDictionary) => {
		this.dictionary = structuredClone(dictionary);
	});
	reloadDictionary = vi.fn(async () => undefined);
	dispose = vi.fn();
	disconnectListener?: () => void;

	async getDictionary(): Promise<DictionaryGetResult> {
		return {
			dictionary: structuredClone(this.dictionary),
			path: '/tmp/dictionary.yaml',
			enabledCount: this.dictionary.entries.filter((entry) => entry.enabled).length,
			promptCharacters: this.dictionary.entries.length * 20,
			lastError: this.lastError,
		};
	}

	onDidDisconnect(listener: () => void): () => void {
		this.disconnectListener = listener;
		return () => {
			this.disconnectListener = undefined;
		};
	}
}

interface TestState {
	readonly client: FakeDictionaryClient;
	readonly daemon: DaemonState;
	readonly dictionary: DictionaryState;
}

function createTestState(): TestState {
	const client = new FakeDictionaryClient();
	const daemon = new DaemonState(client);
	const dictionary = new DictionaryState(client, daemon);
	daemon.start();
	return { client, daemon, dictionary };
}

function disposeTestState(state: TestState): void {
	state.dictionary.dispose();
	state.daemon.dispose();
}

describe('DictionaryState', () => {
	it('saves a dialog entry immediately and closes the editor', async () => {
		const state = createTestState();
		await vi.waitFor(() => expect(state.dictionary.dictionary).toBeDefined());

		state.dictionary.openNewEntry();
		state.dictionary.updateEditor({
			term: ' Codex ',
			aliases: ['扣得克斯', ' code x '],
			protect: true,
			boost: 10,
			enabled: true,
		});
		await expect(state.dictionary.saveEditor()).resolves.toBe(true);

		expect(state.client.validateDictionary).toHaveBeenCalledOnce();
		expect(state.client.updateDictionary).toHaveBeenCalledWith({
			version: 1,
			entries: [
				{
					term: 'Codex',
					aliases: ['扣得克斯', 'code x'],
					protect: true,
					boost: 10,
					enabled: true,
				},
			],
		});
		expect(state.dictionary.phase).toBe('saved');
		expect(state.dictionary.editorEntry).toBeUndefined();
		disposeTestState(state);
	});

	it('keeps the dialog open and reports a conflicting entry locally', async () => {
		const state = createTestState();
		await vi.waitFor(() => expect(state.dictionary.dictionary).toBeDefined());
		state.client.dictionary.entries.push({
			term: 'Codex',
			aliases: ['扣得克斯'],
			protect: true,
			boost: 10,
			enabled: true,
		});
		await state.dictionary.load();
		state.dictionary.openNewEntry();
		state.dictionary.updateEditor({
			term: '扣得克斯',
			aliases: [],
			protect: true,
			boost: 5,
			enabled: true,
		});

		await expect(state.dictionary.saveEditor()).resolves.toBe(false);

		expect(state.dictionary.editorError).toBe('标准写法或别名存在重复冲突。');
		expect(state.dictionary.editorEntry?.term).toBe('扣得克斯');
		expect(state.client.validateDictionary).not.toHaveBeenCalled();
		disposeTestState(state);
	});

	it('filters terms and aliases without changing the draft', async () => {
		const state = createTestState();
		state.client.dictionary.entries.push(
			{ term: 'Codex', aliases: ['扣得克斯'], protect: true, boost: 10, enabled: true },
			{ term: 'VoxSpell', aliases: ['voice spell'], protect: true, boost: 8, enabled: true },
		);
		await vi.waitFor(() => expect(state.dictionary.entries).toHaveLength(2));

		state.dictionary.updateSearchQuery('voice');

		expect(state.dictionary.visibleEntries.map(({ entry }) => entry.term)).toEqual([
			'VoxSpell',
		]);
		expect(state.dictionary.entries).toHaveLength(2);
		disposeTestState(state);
	});

	it('automatically saves an enabled toggle without mutating the old snapshot first', async () => {
		const state = createTestState();
		state.client.dictionary.entries.push({
			term: 'VoxSpell',
			aliases: ['voice spell'],
			protect: true,
			boost: 8,
			enabled: true,
		});
		await vi.waitFor(() => expect(state.dictionary.entries).toHaveLength(1));

		const saving = state.dictionary.setEntryEnabled(0, false);
		expect(state.dictionary.entries[0]?.enabled).toBe(true);
		await expect(saving).resolves.toBe(true);

		expect(state.client.updateDictionary).toHaveBeenCalledWith({
			version: 1,
			entries: [
				{
					term: 'VoxSpell',
					aliases: ['voice spell'],
					protect: true,
					boost: 8,
					enabled: false,
				},
			],
		});
		expect(state.dictionary.entries[0]?.enabled).toBe(false);
		disposeTestState(state);
	});

	it('deletes a list entry and saves immediately', async () => {
		const state = createTestState();
		state.client.dictionary.entries.push({
			term: 'VoxSpell',
			aliases: ['voice spell'],
			protect: true,
			boost: 8,
			enabled: true,
		});
		await vi.waitFor(() => expect(state.dictionary.entries).toHaveLength(1));

		await expect(state.dictionary.deleteEntry(0)).resolves.toBe(true);

		expect(state.client.updateDictionary).toHaveBeenCalledWith({ version: 1, entries: [] });
		expect(state.dictionary.entries).toHaveLength(0);
		disposeTestState(state);
	});

	it('shows a hot reload error next to save actions while retaining the valid snapshot', async () => {
		const state = createTestState();
		await vi.waitFor(() => expect(state.dictionary.dictionary).toBeDefined());
		state.client.lastError = 'Voice dictionary is invalid';

		await state.dictionary.load();

		expect(state.dictionary.phase).toBe('error');
		expect(state.dictionary.operationDescription).toBe('Voice dictionary is invalid');
		expect(state.dictionary.dictionary).toEqual({ version: 1, entries: [] });
		disposeTestState(state);
	});
});
