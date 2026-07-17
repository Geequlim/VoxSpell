import { AsyncQueue } from './async-queue.js';

import type { AudioCaptureBackend, AudioCaptureSession } from '../../src/audio-capture.js';

export class FakeAudioCaptureBackend implements AudioCaptureBackend {
	readonly sessions: FakeAudioCaptureSession[] = [];

	createSession(): FakeAudioCaptureSession {
		const session = new FakeAudioCaptureSession();
		this.sessions.push(session);
		return session;
	}
}

export class FakeAudioCaptureSession implements AudioCaptureSession {
	readonly #frames = new AsyncQueue<Uint8Array>();
	startCalls = 0;
	stopCalls = 0;
	cancelCalls = 0;

	async start(): Promise<void> {
		this.startCalls += 1;
	}

	frames(): AsyncIterable<Uint8Array> {
		return this.#frames.values();
	}

	async stop(): Promise<void> {
		this.stopCalls += 1;
		this.#frames.close();
	}

	async cancel(): Promise<void> {
		this.cancelCalls += 1;
		this.#frames.close();
	}

	pushFrame(frame: Uint8Array): void {
		this.#frames.push(frame);
	}

	endUnexpectedly(): void {
		this.#frames.close();
	}
}
