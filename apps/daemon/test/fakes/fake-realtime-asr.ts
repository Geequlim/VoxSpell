import { AsyncQueue } from './async-queue.js';

import type {
	AsrEvent,
	AsrSessionOptions,
	RealtimeAsrProvider,
	RealtimeAsrSession,
} from '@voxspell/asr-core/realtime-asr';

export class FakeRealtimeAsrProvider implements RealtimeAsrProvider {
	readonly id = 'fake-asr';
	readonly capabilities = { partialResults: true };
	readonly sessions: FakeRealtimeAsrSession[] = [];

	async createSession(options: AsrSessionOptions): Promise<FakeRealtimeAsrSession> {
		const session = new FakeRealtimeAsrSession(options);
		this.sessions.push(session);
		return session;
	}
}

export class FakeRealtimeAsrSession implements RealtimeAsrSession {
	readonly options: AsrSessionOptions;
	readonly audioFrames: Uint8Array[] = [];
	readonly #events = new AsyncQueue<AsrEvent>();
	startCalls = 0;
	finishCalls = 0;
	cancelCalls = 0;

	constructor(options: AsrSessionOptions) {
		this.options = options;
	}

	async start(): Promise<void> {
		this.startCalls += 1;
	}

	async writeAudio(frame: Uint8Array): Promise<void> {
		this.audioFrames.push(frame);
	}

	async finish(): Promise<void> {
		this.finishCalls += 1;
	}

	async cancel(): Promise<void> {
		this.cancelCalls += 1;
	}

	events(): AsyncIterable<AsrEvent> {
		return this.#events.values();
	}

	emit(event: AsrEvent): void {
		this.#events.push(event);
	}

	endUnexpectedly(): void {
		this.#events.close();
	}
}
