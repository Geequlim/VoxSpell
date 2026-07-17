import { createConfiguredAsrProvider } from './asr/create-configured-asr-provider.js';
import { PwRecordAudioCaptureBackend } from './audio/pw-record-audio-capture.js';
import { DaemonRuntime, resolveDaemonSocketPath } from './runtime/create-daemon.js';

/** 启动 daemon，并在进程信号到达时完成清理。 */
async function main(): Promise<void> {
	const asrProvider = process.env.VOXSPELL_CONFIG_PATH
		? await createConfiguredAsrProvider(process.env.VOXSPELL_CONFIG_PATH)
		: undefined;
	const runtime = new DaemonRuntime({
		socketPath: resolveDaemonSocketPath(),
		captureBackend: new PwRecordAudioCaptureBackend(),
		asrProvider,
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
		`[voxspell] daemon listening on ${runtime.socketPath} (capture=pw-record, provider=${asrProvider?.id ?? 'deterministic'})`,
	);
}

void main().catch((error) => {
	console.error(
		`[voxspell] startup failed: ${error instanceof Error ? error.message : 'unknown error'}`,
	);
	process.exitCode = 1;
});
