interface PendingRead<T> {
	readonly resolve: (result: IteratorResult<T>) => void;
}

/** 为异步识别事件提供单生产者有序队列。 */
export class EventQueue<T> {
	readonly #values: T[] = [];
	readonly #pendingReads: PendingRead<T>[] = [];
	#closed = false;

	push(value: T): void {
		if (this.#closed) return;
		const pendingRead = this.#pendingReads.shift();
		if (pendingRead) pendingRead.resolve({ value, done: false });
		else this.#values.push(value);
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		for (const pendingRead of this.#pendingReads.splice(0)) {
			pendingRead.resolve({ value: undefined, done: true });
		}
	}

	async *values(): AsyncIterable<T> {
		while (true) {
			const result = await this.#read();
			if (result.done) return;
			yield result.value;
		}
	}

	#read(): Promise<IteratorResult<T>> {
		const value = this.#values.shift();
		if (value !== undefined) return Promise.resolve({ value, done: false });
		if (this.#closed) return Promise.resolve({ value: undefined, done: true });
		return new Promise((resolve) => this.#pendingReads.push({ resolve }));
	}
}
