import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const executable = process.argv[2];
if (!executable) throw new Error('Missing daemon-client-smoke executable path');

const testDirectory = await mkdtemp(`${tmpdir()}/voxspell-daemon-client-`);
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const mockDaemon = resolve(currentDirectory, 'mock-daemon/mock-daemon.mjs');
const environment = { ...process.env, XDG_RUNTIME_DIR: testDirectory };
const daemon = spawn(process.execPath, [mockDaemon, '--first-partial-delay-ms=700'], {
	env: environment,
	stdio: ['ignore', 'pipe', 'inherit'],
});

try {
	await new Promise((resolveReady, reject) => {
		const timeout = setTimeout(() => reject(new Error('mock daemon did not start')), 3000);
		daemon.once('error', reject);
		daemon.once('exit', (code) => reject(new Error(`mock daemon exited with ${code}`)));
		daemon.stdout.on('data', (chunk) => {
			if (!chunk.toString().includes('listening on')) return;
			clearTimeout(timeout);
			resolveReady();
		});
	});

	for (const arguments_ of [[], ['streaming']]) {
		const exitCode = await new Promise((resolveExit, reject) => {
			const smoke = spawn(executable, arguments_, { env: environment, stdio: 'inherit' });
			smoke.once('error', reject);
			smoke.once('exit', resolveExit);
		});
		if (exitCode !== 0) throw new Error(`daemon client smoke exited with ${exitCode}`);
	}
} finally {
	daemon.kill('SIGTERM');
	await rm(testDirectory, { recursive: true, force: true });
}
