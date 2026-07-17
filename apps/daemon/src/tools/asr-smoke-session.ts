import { randomUUID } from 'node:crypto';

import type { AsrEvent, RealtimeAsrProvider } from '@voxspell/asr-core/realtime-asr';

/** 表示真实 ASR 冒烟会话没有产生可提交的最终文本。 */
export class AsrSmokeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AsrSmokeError';
	}
}

/** 将一组 PCM 帧送入 Provider，并等待最终转写文本。 */
export async function transcribeFrames(
	provider: RealtimeAsrProvider,
	frames: AsyncIterable<Uint8Array>,
	onEvent?: (event: AsrEvent) => void,
): Promise<string> {
	const session = await provider.createSession({ sessionId: randomUUID() });
	const controller = new AbortController();
	const result = (async (): Promise<string> => {
		for await (const event of session.events()) {
			onEvent?.(event);
			const text = getCompletedText(event);
			if (text !== undefined) return text;
		}
		throw new AsrSmokeError('ASR session ended without a final transcript');
	})();

	try {
		await session.start(controller.signal);
		for await (const frame of frames) await session.writeAudio(frame);
		await session.finish();
		return await result;
	} catch (error) {
		controller.abort('smoke-failed');
		await session.cancel('smoke-failed');
		await result.catch(() => undefined);
		throw error;
	}
}

/** 从终止 ASR 事件中提取文本或抛出脱敏错误。 */
function getCompletedText(event: AsrEvent): string | undefined {
	if (event.type === 'completed') return event.text;
	if (event.type === 'error') {
		throw new AsrSmokeError(
			`ASR request failed: ${event.code} (retryable=${String(event.retryable)})`,
		);
	}
	return undefined;
}
