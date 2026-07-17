import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const executable = process.argv[2];
if (!executable) throw new Error('Missing daemon-client-smoke executable path');

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const mockDaemon = resolve(currentDirectory, 'mock-daemon/mock-daemon.mjs');
const scenarios = [
	{ client: 'realtime', daemon: 'realtime' },
	{ client: 'batch', daemon: 'batch' },
	{ client: 'polish', daemon: 'polish' },
	{ client: 'polish-transcript', daemon: 'polish' },
];

async function runScenario(scenario) {
	const testDirectory = await mkdtemp(`${tmpdir()}/voxspell-daemon-client-`);
	const environment = { ...process.env, XDG_RUNTIME_DIR: testDirectory };
	const daemon = spawn(
		process.execPath,
		[
			mockDaemon,
			`--mode=${scenario.daemon}`,
			'--prepare-delay-ms=100',
			'--first-delay-ms=500',
			'--interval-ms=150',
			'--phase-delay-ms=100',
		],
		{ env: environment, stdio: ['ignore', 'pipe', 'inherit'] },
	);

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

		const exitCode = await new Promise((resolveExit, reject) => {
			const smoke = spawn(executable, [scenario.client], {
				env: environment,
				stdio: 'inherit',
			});
			smoke.once('error', reject);
			smoke.once('exit', resolveExit);
		});
		if (exitCode !== 0) {
			throw new Error(`${scenario.client} smoke exited with ${exitCode}`);
		}
	} finally {
		daemon.kill('SIGTERM');
		await rm(testDirectory, { recursive: true, force: true });
	}
}

for (const scenario of scenarios) await runScenario(scenario);
