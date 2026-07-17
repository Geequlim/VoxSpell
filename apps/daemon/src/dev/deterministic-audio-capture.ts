import type { AudioCaptureBackend, AudioCaptureSession } from '../audio-capture.js';

const SILENT_FRAME_BYTES = 640;

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

/** 创建一块静音 PCM 的开发期确定性采集后端。 */
export class DeterministicAudioCaptureBackend implements AudioCaptureBackend {
	createSession(): AudioCaptureSession {
		return new DeterministicAudioCaptureSession();
	}
}

class DeterministicAudioCaptureSession implements AudioCaptureSession {
	readonly #stopped = createDeferred();
	#started = false;
	#cancelled = false;
	#signal?: AbortSignal;
	#abortListener?: () => void;

	async start(signal: AbortSignal): Promise<void> {
		this.#started = true;
		this.#signal = signal;
		this.#abortListener = () => void this.cancel('aborted');
		if (signal.aborted) {
			await this.cancel('aborted');
			return;
		}
		signal.addEventListener('abort', this.#abortListener, { once: true });
	}

	async *frames(): AsyncIterable<Uint8Array> {
		if (!this.#started) throw new Error('Deterministic capture was not started');
		if (!this.#cancelled) yield new Uint8Array(SILENT_FRAME_BYTES);
		await this.#stopped.promise;
	}

	async stop(): Promise<void> {
		this.#settle();
	}

	async cancel(reason?: string): Promise<void> {
		this.#cancelled = true;
		this.#settle();
	}

	#settle(): void {
		if (this.#signal && this.#abortListener) {
			this.#signal.removeEventListener('abort', this.#abortListener);
		}
		this.#stopped.resolve();
	}
}
