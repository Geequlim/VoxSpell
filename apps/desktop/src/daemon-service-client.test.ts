import { describe, expect, it, vi } from 'vitest';
import { SystemdDaemonServiceClient } from './daemon-service-client';

describe('SystemdDaemonServiceClient', () => {
	it('reads running and enabled state from systemd', async () => {
		const runCommand = vi.fn().mockResolvedValue({
			exitCode: 0,
			stderr: '',
			stdout: 'ActiveState=active\nUnitFileState=enabled\n',
		});
		const client = new SystemdDaemonServiceClient(runCommand);

		await expect(client.getStatus()).resolves.toEqual({ enabled: true, running: true });
		expect(runCommand).toHaveBeenCalledWith('systemctl', [
			'--user',
			'show',
			'voxspell.service',
			'--property=ActiveState',
			'--property=UnitFileState',
		]);
	});

	it('reloads systemd before starting and restarting the daemon', async () => {
		const runCommand = vi.fn().mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });
		const client = new SystemdDaemonServiceClient(runCommand);

		await client.start();
		await client.restart();

		expect(runCommand.mock.calls).toEqual([
			['systemctl', ['--user', 'daemon-reload']],
			['systemctl', ['--user', 'start', 'voxspell.service']],
			['systemctl', ['--user', 'daemon-reload']],
			['systemctl', ['--user', 'restart', 'voxspell.service']],
		]);
	});

	it('enables and disables autostart without changing the running state', async () => {
		const runCommand = vi.fn().mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });
		const client = new SystemdDaemonServiceClient(runCommand);

		await client.setEnabled(true);
		await client.setEnabled(false);

		expect(runCommand.mock.calls).toEqual([
			['systemctl', ['--user', 'enable', 'voxspell.service']],
			['systemctl', ['--user', 'disable', 'voxspell.service']],
		]);
	});

	it('surfaces systemctl failures without using a shell', async () => {
		const runCommand = vi.fn().mockResolvedValue({
			exitCode: 1,
			stderr: 'Unit voxspell.service not found.',
			stdout: '',
		});
		const client = new SystemdDaemonServiceClient(runCommand);

		await expect(client.start()).rejects.toThrow('Unit voxspell.service not found.');
	});
});
