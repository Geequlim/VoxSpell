import { PcmLevelMeter } from '../audio/pcm-level.js';
import { PwRecordAudioCaptureBackend } from '../audio/pw-record-audio-capture.js';

import type { PcmLevel } from '../audio/pcm-level.js';

const CAPTURE_MILLISECONDS = 10_000;
const BAR_WIDTH = 30;
const QUIET_THRESHOLD_DBFS = -55;

/** 将一次音量测量渲染为终端文本。 */
function renderLevel(level: PcmLevel): string {
	const normalizedPeak = Math.max(0, Math.min(1, (level.peakDbfs + 60) / 60));
	const active = Math.round(normalizedPeak * BAR_WIDTH);
	const bar = `${'█'.repeat(active)}${'░'.repeat(BAR_WIDTH - active)}`;
	return `麦克风 [${bar}] RMS ${level.rmsDbfs.toFixed(1)} dBFS  Peak ${level.peakDbfs.toFixed(1)} dBFS`;
}

/** 录制短时麦克风 PCM，并实时显示终端音量。 */
async function main(): Promise<void> {
	const session = new PwRecordAudioCaptureBackend().createSession();
	const controller = new AbortController();
	const meter = new PcmLevelMeter();
	let byteCount = 0;
	let maximumPeakDbfs = -96;
	let stopping = false;
	const stop = async (): Promise<void> => {
		if (stopping) return;
		stopping = true;
		await session.stop();
	};
	const handleInterrupt = (): void => void stop();
	process.once('SIGINT', handleInterrupt);

	console.log('开始录音 10 秒，请对着麦克风说话；按 Ctrl+C 可提前结束。');
	try {
		await session.start(controller.signal);
		const timeout = setTimeout(() => void stop(), CAPTURE_MILLISECONDS);
		try {
			for await (const frame of session.frames()) {
				byteCount += frame.byteLength;
				for (const level of meter.write(frame)) {
					maximumPeakDbfs = Math.max(maximumPeakDbfs, level.peakDbfs);
					const output = renderLevel(level);
					process.stdout.write(process.stdout.isTTY ? `\r${output}` : `${output}\n`);
				}
			}
		} finally {
			clearTimeout(timeout);
			await stop();
		}
	} finally {
		process.off('SIGINT', handleInterrupt);
		if (process.stdout.isTTY) process.stdout.write('\n');
	}

	if (byteCount === 0) throw new Error('没有收到麦克风 PCM 数据');
	console.log(`录音完成：收到 ${byteCount} 字节 PCM，峰值 ${maximumPeakDbfs.toFixed(1)} dBFS。`);
	if (maximumPeakDbfs < QUIET_THRESHOLD_DBFS) {
		console.warn('音频接近静音，请检查默认输入设备、麦克风权限或输入增益。');
	}
}

void main().catch((error) => {
	console.error(`[audio-smoke] ${error instanceof Error ? error.message : 'unknown error'}`);
	process.exitCode = 1;
});
