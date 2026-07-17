import type {
	AsrEvent,
	AsrSessionOptions,
	RealtimeAsrProvider,
	RealtimeAsrSession,
} from '@voxspell/asr-core/realtime-asr';

interface Deferred {
	readonly promise: Promise<void>;
	readonly resolve: () => void;
}

/** 创建只需完成一次的 Promise 门闩。 */
function createDeferred(): Deferred {
	let resolve = (): void => undefined;
	const promise = new Promise<void>((promiseResolve) => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}

/** 返回固定识别文本的开发期确定性 ASR Provider。 */
export class DeterministicAsrProvider implements RealtimeAsrProvider {
	readonly id = 'deterministic';
	readonly capabilities = { partialResults: true };
	readonly #text: string;
	readonly #partialTexts: readonly string[];

	constructor(text = 'VoxSpell 测试成功', partialTexts: readonly string[] = [text]) {
		this.#text = text;
		this.#partialTexts = partialTexts;
	}

	async createSession(options: AsrSessionOptions): Promise<RealtimeAsrSession> {
		return new DeterministicAsrSession(options, this.#text, this.#partialTexts);
	}
}

class DeterministicAsrSession implements RealtimeAsrSession {
	readonly #options: AsrSessionOptions;
	readonly #text: string;
	readonly #partialTexts: readonly string[];
	readonly #firstAudio = createDeferred();
	readonly #finished = createDeferred();
	#cancelled = false;
	#signal?: AbortSignal;
	#abortListener?: () => void;

	constructor(options: AsrSessionOptions, text: string, partialTexts: readonly string[]) {
		this.#options = options;
		this.#text = text;
		this.#partialTexts = partialTexts;
	}

	async start(signal: AbortSignal): Promise<void> {
		this.#signal = signal;
		this.#abortListener = () => void this.cancel('aborted');
		if (signal.aborted) {
			await this.cancel('aborted');
			return;
		}
		signal.addEventListener('abort', this.#abortListener, { once: true });
	}

	async writeAudio(): Promise<void> {
		this.#firstAudio.resolve();
	}

	async finish(): Promise<void> {
		this.#firstAudio.resolve();
		this.#finished.resolve();
	}

	async cancel(reason?: string): Promise<void> {
		this.#cancelled = true;
		this.#firstAudio.resolve();
		this.#finished.resolve();
		this.#removeAbortListener();
	}

	async *events(): AsyncIterable<AsrEvent> {
		await this.#firstAudio.promise;
		if (this.#cancelled) return;
		yield { type: 'ready' };
		for (const [revision, text] of this.#partialTexts.entries()) {
			yield {
				type: 'partial',
				segmentId: `${this.#options.sessionId}:0`,
				revision,
				text,
			};
		}
		await this.#finished.promise;
		if (this.#cancelled) return;
		yield { type: 'completed', text: this.#text };
		this.#removeAbortListener();
	}

	#removeAbortListener(): void {
		if (this.#signal && this.#abortListener) {
			this.#signal.removeEventListener('abort', this.#abortListener);
		}
	}
}
