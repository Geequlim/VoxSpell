import { describe, expect, it, vi } from 'vitest';
import { DaemonServiceState } from './daemon-service-state';

import type { DaemonServiceClient, DaemonServiceStatus } from '../daemon-service-client';

class FakeDaemonServiceClient implements DaemonServiceClient {
	getStatus = vi.fn<() => Promise<DaemonServiceStatus>>();
	start = vi.fn<() => Promise<void>>();
	restart = vi.fn<() => Promise<void>>();
	setEnabled = vi.fn<(enabled: boolean) => Promise<void>>();
}

describe('DaemonServiceState', () => {
	it('starts an inactive daemon and publishes its refreshed state', async () => {
		const client = new FakeDaemonServiceClient();
		client.getStatus
			.mockResolvedValueOnce({ enabled: false, running: false })
			.mockResolvedValueOnce({ enabled: false, running: true });
		client.start.mockResolvedValue();
		const state = new DaemonServiceState(client);
		await state.refresh();

		await expect(state.runPrimaryAction()).resolves.toBe(true);
		expect(client.start).toHaveBeenCalledOnce();
		expect(client.restart).not.toHaveBeenCalled();
		expect(state.running).toBe(true);
		expect(state.primaryActionLabel).toBe('重启');
	});

	it('restarts an active daemon', async () => {
		const client = new FakeDaemonServiceClient();
		client.getStatus.mockResolvedValue({ enabled: true, running: true });
		client.restart.mockResolvedValue();
		const state = new DaemonServiceState(client);
		await state.refresh();

		await state.runPrimaryAction();

		expect(client.restart).toHaveBeenCalledOnce();
		expect(client.start).not.toHaveBeenCalled();
	});

	it('updates autostart without stopping the running daemon', async () => {
		const client = new FakeDaemonServiceClient();
		client.getStatus
			.mockResolvedValueOnce({ enabled: false, running: true })
			.mockResolvedValueOnce({ enabled: true, running: true });
		client.setEnabled.mockResolvedValue();
		const state = new DaemonServiceState(client);
		await state.refresh();

		await state.setEnabled(true);

		expect(client.setEnabled).toHaveBeenCalledWith(true);
		expect(client.start).not.toHaveBeenCalled();
		expect(state.enabled).toBe(true);
		expect(state.running).toBe(true);
	});

	it('keeps the previous state and reports command failures', async () => {
		const client = new FakeDaemonServiceClient();
		client.getStatus.mockResolvedValue({ enabled: false, running: false });
		client.start.mockRejectedValue(new Error('unit not found'));
		const state = new DaemonServiceState(client);
		await state.refresh();

		await expect(state.runPrimaryAction()).resolves.toBe(false);
		expect(state.running).toBe(false);
		expect(state.errorMessage).toContain('unit not found');
	});
});
