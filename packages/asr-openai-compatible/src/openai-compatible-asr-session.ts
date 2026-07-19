import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { toFile } from 'openai';

import { createPcmWave } from './pcm-wave.js';
import { createAsrErrorEvent } from './provider-error.js';

import type OpenAI from 'openai';
import type { AsrEvent } from '@voxspell/asr-core/realtime-asr';
import type { AsrSessionOptions } from '@voxspell/asr-core/realtime-asr';
import type { RealtimeAsrSession } from '@voxspell/asr-core/realtime-asr';

const MAX_TRANSCRIPTION_ATTEMPTS = 2;
const RETRY_DELAY_MILLISECONDS = 400;

const TranscriptionResponseSchema = Type.Object(
	{ text: Type.String({ minLength: 1, pattern: '\\S' }) },
	{ additionalProperties: true },
);

interface Deferred {
	readonly promise: Promise<void>;
	readonly resolve: () => void;
}

interface OpenAiCompatibleAsrSessionOptions {
	readonly client: OpenAI;
	readonly model: string;
	readonly maximumAudioBytes: number;
	readonly session: AsrSessionOptions;
}

/** 创建只完成一次的异步门闩。 */
function createDeferred(): Deferred {
	let resolve = (): void => undefined;
	const promise = new Promise<void>((promiseResolve) => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}

/** 为一次 OpenAI-compatible 批量音频转写维护 PCM 和请求生命周期。 */
export class OpenAiCompatibleAsrSession implements RealtimeAsrSession {
	readonly #client: OpenAI;
	readonly #model: string;
	readonly #maximumAudioBytes: number;
	readonly #session: AsrSessionOptions;
	readonly #started = createDeferred();
	readonly #finished = createDeferred();
	readonly #requestController = new AbortController();
	readonly #chunks: Uint8Array[] = [];
	#audioBytes = 0;
	#cancelled = false;
	#finishRequested = false;
	#signal?: AbortSignal;
	#abortListener?: () => void;

	constructor(options: OpenAiCompatibleAsrSessionOptions) {
		this.#client = options.client;
		this.#model = options.model;
		this.#maximumAudioBytes = options.maximumAudioBytes;
		this.#session = options.session;
	}

	async start(signal: AbortSignal): Promise<void> {
		if (signal.aborted) {
			await this.cancel('aborted');
			return;
		}
		this.#signal = signal;
		this.#abortListener = () => void this.cancel('aborted');
		signal.addEventListener('abort', this.#abortListener, { once: true });
		this.#started.resolve();
	}

	async writeAudio(frame: Uint8Array): Promise<void> {
		if (this.#cancelled) return;
		if (this.#finishRequested) throw new Error('Cannot write audio after finish');
		const nextAudioBytes = this.#audioBytes + frame.byteLength;
		if (nextAudioBytes > this.#maximumAudioBytes) {
			throw new Error('ASR audio exceeds the configured byte limit');
		}
		this.#chunks.push(Uint8Array.from(frame));
		this.#audioBytes = nextAudioBytes;
	}

	async finish(): Promise<void> {
		if (this.#finishRequested || this.#cancelled) return;
		this.#finishRequested = true;
		this.#finished.resolve();
	}

	async cancel(reason?: string): Promise<void> {
		if (this.#cancelled) return;
		this.#cancelled = true;
		this.#requestController.abort(reason);
		this.#started.resolve();
		this.#finished.resolve();
		this.#chunks.length = 0;
		this.#removeAbortListener();
	}

	async *events(): AsyncIterable<AsrEvent> {
		await this.#started.promise;
		if (this.#cancelled) return;
		yield { type: 'ready' };
		await this.#finished.promise;
		if (this.#cancelled) return;

		try {
			const wave = createPcmWave(this.#chunks);
			const file = await toFile(wave, `${this.#session.sessionId}.wav`, {
				type: 'audio/wav',
			});
			let response: unknown;
			for (let attempt = 1; attempt <= MAX_TRANSCRIPTION_ATTEMPTS; attempt += 1) {
				try {
					response = await this.#client.audio.transcriptions.create(
						{
							file,
							model: this.#model,
							response_format: 'json',
							stream: false,
						},
						{ signal: this.#requestController.signal },
					);
					break;
				} catch (error) {
					const errorEvent = createAsrErrorEvent(error);
					if (!errorEvent.retryable || attempt === MAX_TRANSCRIPTION_ATTEMPTS) {
						yield errorEvent;
						return;
					}
					await this.#waitBeforeRetry();
				}
			}
			if (!Value.Check(TranscriptionResponseSchema, response)) {
				yield { type: 'error', code: 'INVALID_RESPONSE', retryable: false };
				return;
			}
			yield { type: 'completed', text: response.text };
		} catch (error) {
			if (!this.#cancelled) yield createAsrErrorEvent(error);
		} finally {
			this.#chunks.length = 0;
			this.#removeAbortListener();
		}
	}

	#removeAbortListener(): void {
		if (this.#signal && this.#abortListener) {
			this.#signal.removeEventListener('abort', this.#abortListener);
		}
	}

	async #waitBeforeRetry(): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.#requestController.signal.removeEventListener('abort', abort);
				resolve();
			}, RETRY_DELAY_MILLISECONDS);
			const abort = (): void => {
				clearTimeout(timeout);
				this.#requestController.signal.removeEventListener('abort', abort);
				reject(this.#requestController.signal.reason);
			};
			if (this.#requestController.signal.aborted) {
				abort();
				return;
			}
			this.#requestController.signal.addEventListener('abort', abort, { once: true });
		});
	}
}
