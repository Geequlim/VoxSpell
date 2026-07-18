import { homedir } from 'node:os';

import { resolveVoxSpellConfigPaths } from '@voxspell/config/config-paths';

import { PwRecordAudioCaptureBackend } from './audio/pw-record-audio-capture.js';
import { DaemonConfigManager } from './configuration/daemon-config-manager.js';
import { DaemonDictionaryManager } from './configuration/daemon-dictionary-manager.js';
import { DeterministicAsrProvider } from './dev/deterministic-asr.js';
import { FcitxConfigClient, NativeFcitxControllerTransport } from './fcitx/fcitx-config-client.js';
import { DaemonRuntime, resolveDaemonSocketPath } from './runtime/create-daemon.js';

/** 启动 daemon，并在进程信号到达时完成清理。 */
async function main(): Promise<void> {
	const paths = resolveVoxSpellConfigPaths(process.env, homedir());
	const configManager = new DaemonConfigManager({ paths });
	const dictionaryManager = new DaemonDictionaryManager(paths.dictionaryFile);
	await configManager.initialize();
	await dictionaryManager.initialize();
	await dictionaryManager.startWatching();
	const deterministicProvider = new DeterministicAsrProvider();
	const getAsrProvider = (): ReturnType<DaemonConfigManager['getAsrProvider']> => {
		if (process.env.VOXSPELL_DETERMINISTIC === '1') return deterministicProvider;
		return configManager.getAsrProvider();
	};
	const getTextPolisher = (): ReturnType<DaemonConfigManager['getTextPolisher']> =>
		configManager.getTextPolisher();
	const runtime = new DaemonRuntime({
		socketPath: resolveDaemonSocketPath(),
		captureBackend: new PwRecordAudioCaptureBackend(),
		getAsrProvider,
		getTextPolisher,
		getTextPolishingPolicy: () => configManager.getTextPolishingPolicy(),
		getTrimTrailingPeriod: () => configManager.getTrimTrailingPeriod(),
		getMaximumRecordingMilliseconds: () => configManager.getMaximumRecordingMilliseconds(),
		getDictionary: () => dictionaryManager.getSnapshot(),
		configuration: configManager,
		dictionary: dictionaryManager,
		fcitx: new FcitxConfigClient(new NativeFcitxControllerTransport()),
		onError: (error) => console.error(`[voxspell] ${error.name}: ${error.message}`),
		onSessionFailure: ({ sessionId, phase, error }) => {
			let message =
				`[voxspell] session.error session=${sessionId ?? 'pending'}` +
				` phase=${phase} code=${error.code} stage=${error.stage}` +
				` retryable=${error.retryable}`;
			if (error.providerCode) message += ` provider=${error.providerCode}`;
			console.error(message);
		},
		onSessionSettled: ({
			sessionId,
			outcome,
			asrDurationMilliseconds,
			durationMilliseconds,
		}) => {
			console.log(
				`[voxspell] session.closed session=${sessionId}` +
					` outcome=${outcome} asr_duration_ms=${asrDurationMilliseconds}` +
					` duration_ms=${durationMilliseconds}`,
			);
		},
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
		} finally {
			dictionaryManager.dispose();
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
