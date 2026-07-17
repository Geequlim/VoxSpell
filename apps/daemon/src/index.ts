import { DaemonRuntime, resolveDaemonSocketPath } from './runtime/create-daemon.js';

/** 启动 daemon，并在进程信号到达时完成清理。 */
async function main(): Promise<void> {
	const runtime = new DaemonRuntime({
		socketPath: resolveDaemonSocketPath(),
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
	console.log(`[voxspell] daemon listening on ${runtime.socketPath} (provider=deterministic)`);
}

void main().catch((error) => {
	console.error(
		`[voxspell] startup failed: ${error instanceof Error ? error.message : 'unknown error'}`,
	);
	process.exitCode = 1;
});
