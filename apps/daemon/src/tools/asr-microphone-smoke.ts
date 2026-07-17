import { createConfiguredAsrProvider } from '../asr/create-configured-asr-provider.js';
import { PcmLevelMeter } from '../audio/pcm-level.js';
import { PwRecordAudioCaptureBackend } from '../audio/pw-record-audio-capture.js';
import { transcribeFrames } from './asr-smoke-session.js';

const CAPTURE_MILLISECONDS = 10_000;
const BAR_WIDTH = 30;

/** 将音频峰值渲染为终端音量条。 */
function renderPeak(peakDbfs: number): string {
	const normalizedPeak = Math.max(0, Math.min(1, (peakDbfs + 60) / 60));
	const active = Math.round(normalizedPeak * BAR_WIDTH);
	return `${'█'.repeat(active)}${'░'.repeat(BAR_WIDTH - active)}`;
}

/** 采集一段麦克风 PCM，并在采集期间显示音量变化。 */
async function* captureMicrophone(): AsyncIterable<Uint8Array> {
	const session = new PwRecordAudioCaptureBackend().createSession();
	const controller = new AbortController();
	const meter = new PcmLevelMeter();
	let stopping = false;
	const stop = async (): Promise<void> => {
		if (stopping) return;
		stopping = true;
		await session.stop();
	};
	const handleInterrupt = (): void => void stop();
	process.once('SIGINT', handleInterrupt);

	await session.start(controller.signal);
	const timeout = setTimeout(() => void stop(), CAPTURE_MILLISECONDS);
	try {
		for await (const frame of session.frames()) {
			for (const level of meter.write(frame)) {
				const output = `麦克风 [${renderPeak(level.peakDbfs)}] Peak ${level.peakDbfs.toFixed(1)} dBFS`;
				process.stdout.write(process.stdout.isTTY ? `\r${output}` : `${output}\n`);
			}
			yield frame;
		}
	} finally {
		clearTimeout(timeout);
		await stop();
		process.off('SIGINT', handleInterrupt);
		if (process.stdout.isTTY) process.stdout.write('\n');
	}
}

/** 录制麦克风后请求当前配置的真实 ASR Provider。 */
async function main(): Promise<void> {
	const configPath = process.env.VOXSPELL_CONFIG_PATH;
	if (!configPath) throw new Error('VOXSPELL_CONFIG_PATH is required');
	const provider = await createConfiguredAsrProvider(configPath);
	console.log(`开始录音 10 秒，结束后请求 ${provider.id}；按 Ctrl+C 可提前结束录音。`);
	const startedAt = performance.now();
	const text = await transcribeFrames(provider, captureMicrophone());
	const elapsedMilliseconds = Math.round(performance.now() - startedAt);
	console.log(`识别完成 (${elapsedMilliseconds}ms): ${text}`);
}

void main().catch((error) => {
	console.error(
		`[asr-microphone-smoke] ${error instanceof Error ? error.message : 'unknown error'}`,
	);
	process.exitCode = 1;
});
