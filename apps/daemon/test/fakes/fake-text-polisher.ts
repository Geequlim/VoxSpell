import { AsyncQueue } from './async-queue.js';

import type { PolishEvent, PolishRequest, TextPolisher } from '@voxspell/ai-polisher/text-polisher';

export class FakeTextPolisher implements TextPolisher {
	readonly id = 'fake-polisher';
	readonly sessions: FakeTextPolishSession[] = [];

	polish(request: PolishRequest, signal: AbortSignal): AsyncIterable<PolishEvent> {
		const session = new FakeTextPolishSession(request, signal);
		this.sessions.push(session);
		return session.events();
	}
}

export class FakeTextPolishSession {
	readonly request: PolishRequest;
	readonly #events = new AsyncQueue<PolishEvent>();
	aborted = false;

	constructor(request: PolishRequest, signal: AbortSignal) {
		this.request = request;
		if (signal.aborted) {
			this.aborted = true;
			this.#events.close();
			return;
		}
		signal.addEventListener(
			'abort',
			() => {
				this.aborted = true;
				this.#events.close();
			},
			{ once: true },
		);
	}

	events(): AsyncIterable<PolishEvent> {
		return this.#events.values();
	}

	emit(event: PolishEvent): void {
		this.#events.push(event);
	}
}
