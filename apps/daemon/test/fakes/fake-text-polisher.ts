import { AsyncQueue } from './async-queue.js';

import type { PolishEvent, TextPolisher } from '@voxspell/ai-polisher/text-polisher';

export class FakeTextPolisher implements TextPolisher {
	readonly id = 'fake-polisher';
	readonly sessions: FakeTextPolishSession[] = [];

	polish(text: string, signal: AbortSignal): AsyncIterable<PolishEvent> {
		const session = new FakeTextPolishSession(text, signal);
		this.sessions.push(session);
		return session.events();
	}
}

export class FakeTextPolishSession {
	readonly input: string;
	readonly #events = new AsyncQueue<PolishEvent>();
	aborted = false;

	constructor(input: string, signal: AbortSignal) {
		this.input = input;
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
