import { readFile } from 'node:fs/promises';

import { parseWavePcm } from './wave-pcm.js';

import type { AudioCaptureBackend, AudioCaptureSession } from '../audio-capture.js';

const DEFAULT_FRAME_BYTES = 3_200;

interface Deferred {
	readonly promise: Promise<void>;
	readonly resolve: () => void;
}

/** 从 WAV 测试素材创建音频采集会话。 */
export class WaveFileAudioCaptureBackend implements AudioCaptureBackend {
	readonly #filePath: string;
	readonly #frameBytes: number;

	constructor(filePath: string, frameBytes = DEFAULT_FRAME_BYTES) {
		this.#filePath = filePath;
		this.#frameBytes = frameBytes;
	}

	createSession(): AudioCaptureSession {
		return new WaveFileAudioCaptureSession(this.#filePath, this.#frameBytes);
	}
}

class WaveFileAudioCaptureSession implements AudioCaptureSession {
	readonly #filePath: string;
	readonly #frameBytes: number;
	readonly #stopped: Deferred;
	#samples?: Uint8Array;
	#cancelled = false;
	#signal?: AbortSignal;
	#abortListener?: () => void;

	constructor(filePath: string, frameBytes: number) {
		this.#filePath = filePath;
		this.#frameBytes = frameBytes;
		let resolve = (): void => undefined;
		const promise = new Promise<void>((promiseResolve) => {
			resolve = promiseResolve;
		});
		this.#stopped = { promise, resolve };
	}

	async start(signal: AbortSignal): Promise<void> {
		this.#samples = parseWavePcm(await readFile(this.#filePath)).samples;
		this.#signal = signal;
		this.#abortListener = () => void this.cancel('aborted');
		if (signal.aborted) {
			await this.cancel('aborted');
			return;
		}
		signal.addEventListener('abort', this.#abortListener, { once: true });
	}

	async *frames(): AsyncIterable<Uint8Array> {
		if (!this.#samples) throw new Error('WAV capture was not started');
		for (
			let offset = 0;
			offset < this.#samples.byteLength && !this.#cancelled;
			offset += this.#frameBytes
		) {
			yield this.#samples.subarray(offset, offset + this.#frameBytes);
		}
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
