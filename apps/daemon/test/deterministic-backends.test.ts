import { describe, expect, it } from 'vitest';

import { DeterministicAudioCaptureBackend } from '../src/dev/deterministic-audio-capture.js';
import { DeterministicAsrProvider } from '../src/dev/deterministic-asr.js';

const SESSION_ID = '0190c95b-7f28-7b12-8b6f-a4d3fd239013';

describe('deterministic runtime backends', () => {
	it('produces one silent frame and stops cleanly', async () => {
		const session = new DeterministicAudioCaptureBackend().createSession();
		const controller = new AbortController();
		await session.start(controller.signal);
		const frames = session.frames()[Symbol.asyncIterator]();

		await expect(frames.next()).resolves.toMatchObject({ done: false });
		await session.stop();
		await expect(frames.next()).resolves.toEqual({ done: true, value: undefined });
	});

	it('emits ready, partial, and completed around audio and finish', async () => {
		const session = await new DeterministicAsrProvider('固定文本').createSession({
			sessionId: SESSION_ID,
		});
		const controller = new AbortController();
		await session.start(controller.signal);
		const events = session.events()[Symbol.asyncIterator]();

		await session.writeAudio(new Uint8Array([0, 0]));
		await expect(events.next()).resolves.toEqual({ done: false, value: { type: 'ready' } });
		await expect(events.next()).resolves.toEqual({
			done: false,
			value: {
				type: 'partial',
				segmentId: `${SESSION_ID}:0`,
				revision: 0,
				text: '固定文本',
			},
		});
		await session.finish();
		await expect(events.next()).resolves.toEqual({
			done: false,
			value: { type: 'completed', text: '固定文本' },
		});
		await expect(events.next()).resolves.toEqual({ done: true, value: undefined });
	});
});
