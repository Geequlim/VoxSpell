import { afterEach, describe, expect, it, vi } from 'vitest';
import { DaemonState } from './daemon-state';

import type { DaemonGetStatusResult } from '@voxspell/protocol/daemon';
import type { InitializeResult } from '@voxspell/protocol/initialize';
import type { DaemonClient } from './daemon-state';

const initializeResult: InitializeResult = {
	protocolVersion: 1,
	serverInfo: { name: 'test-daemon', version: '0.0.0' },
	capabilities: { partialTranscript: false, polishPreview: false },
};
const daemonStatus: DaemonGetStatusResult = {
	state: 'ready',
	configPath: '/tmp/config.yaml',
	credentialsPath: '/tmp/credentials',
	missingCredentialNames: [],
};

class FakeDaemonClient implements DaemonClient {
	connect = vi.fn<() => Promise<InitializeResult>>();
	getStatus = vi.fn<() => Promise<DaemonGetStatusResult>>();
	dispose = vi.fn();
	disconnectListener: (() => void) | undefined;

	onDidDisconnect(listener: () => void): () => void {
		this.disconnectListener = listener;
		return () => {
			this.disconnectListener = undefined;
		};
	}
}

afterEach(() => {
	vi.useRealTimers();
});

describe('DaemonState', () => {
	it('retries with backoff and publishes a successful status', async () => {
		vi.useFakeTimers();
		const client = new FakeDaemonClient();
		client.connect
			.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
			.mockResolvedValue(initializeResult);
		client.getStatus.mockResolvedValue(daemonStatus);
		const state = new DaemonState(client);

		state.start();
		await vi.waitFor(() => expect(state.connectionPhase).toBe('retrying'));
		expect(state.lastError).toContain('尚未启动');
		await vi.advanceTimersByTimeAsync(500);
		await vi.waitFor(() => expect(state.connectionPhase).toBe('connected'));
		expect(state.statusTitle).toBe('Daemon 已连接');
		expect(state.statusIconName).toBe('process-completed-symbolic');
		expect(client.connect).toHaveBeenCalledTimes(2);
		state.dispose();
	});

	it('cancels pending retries when disposed', async () => {
		vi.useFakeTimers();
		const client = new FakeDaemonClient();
		client.connect.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
		const state = new DaemonState(client);

		state.start();
		await vi.waitFor(() => expect(state.connectionPhase).toBe('retrying'));
		state.dispose();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(client.connect).toHaveBeenCalledTimes(1);
		expect(client.dispose).toHaveBeenCalledOnce();
	});

	it('describes missing configuration as a normal first-run state', async () => {
		const client = new FakeDaemonClient();
		client.connect.mockResolvedValue(initializeResult);
		client.getStatus.mockResolvedValue({
			...daemonStatus,
			state: 'needs-configuration',
			lastError: 'VoxSpell config does not exist: /tmp/config.yaml',
		});
		const state = new DaemonState(client);

		state.start();
		await vi.waitFor(() => expect(state.connectionPhase).toBe('connected'));
		expect(state.statusTitle).toBe('需要完成配置');
		expect(state.statusDescription).toBe('Daemon 已运行，等待补充识别服务配置。');
		state.dispose();
	});
});
