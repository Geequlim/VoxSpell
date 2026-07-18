import { homedir } from 'node:os';

import { resolveVoxSpellConfigPaths } from '@voxspell/config/config-paths';

import { PwRecordAudioCaptureBackend } from './audio/pw-record-audio-capture.js';
import { DaemonConfigManager } from './configuration/daemon-config-manager.js';
import { DeterministicAsrProvider } from './dev/deterministic-asr.js';
import { FcitxConfigClient, NativeFcitxControllerTransport } from './fcitx/fcitx-config-client.js';
import { DaemonRuntime, resolveDaemonSocketPath } from './runtime/create-daemon.js';

/** 启动 daemon，并在进程信号到达时完成清理。 */
async function main(): Promise<void> {
	const configManager = new DaemonConfigManager({
		paths: resolveVoxSpellConfigPaths(process.env, homedir()),
	});
	await configManager.initialize();
	const deterministicProvider = new DeterministicAsrProvider();
	const getAsrProvider = (): ReturnType<DaemonConfigManager['getAsrProvider']> => {
		if (process.env.VOXSPELL_DETERMINISTIC === '1') return deterministicProvider;
		return configManager.getAsrProvider();
	};
	const runtime = new DaemonRuntime({
		socketPath: resolveDaemonSocketPath(),
		captureBackend: new PwRecordAudioCaptureBackend(),
		getAsrProvider,
		configuration: configManager,
		fcitx: new FcitxConfigClient(new NativeFcitxControllerTransport()),
		onError: (error) => console.error(`[voxspell] ${error.name}: ${error.message}`),
	});
	let stopping = false;

	const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
		if (stopping) return;
		stopping = true;
		console.log(`[voxspell] received ${signal}, stopping`);
		try {
			await runtime.stop();
		} catch (error) {
			console.error(
				`[voxspell] shutdown failed: ${error instanceof Error ? error.message : 'unknown error'}`,
			);
			process.exitCode = 1;
		}
	};

	process.once('SIGINT', () => void shutdown('SIGINT'));
	process.once('SIGTERM', () => void shutdown('SIGTERM'));
	await runtime.start();
	console.log(
		`[voxspell] daemon listening on ${runtime.socketPath} (capture=pw-record, state=${configManager.getStatus().state})`,
	);
}

void main().catch((error) => {
	console.error(
		`[voxspell] startup failed: ${error instanceof Error ? error.message : 'unknown error'}`,
	);
	process.exitCode = 1;
});
