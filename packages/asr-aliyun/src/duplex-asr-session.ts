import { randomUUID } from 'node:crypto';

import { AliyunWebSocketSession, getRawDataText } from './websocket-session.js';

import type { AsrSessionOptions } from '@voxspell/asr-core/realtime-asr';
import type { AliyunAsrModel } from './model-profile.js';
import type { RawData } from 'ws';

interface DuplexAsrSessionOptions {
	readonly session: AsrSessionOptions;
	readonly url: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly model: Exclude<AliyunAsrModel, 'qwen3-asr-flash-realtime'>;
	readonly language?: string;
	readonly context?: string;
	readonly vocabularyId?: string;
}

interface DashScopeMessage {
	readonly header?: {
		readonly event?: string;
		readonly error_code?: string;
	};
	readonly payload?: {
		readonly output?: {
			readonly sentence?: {
				readonly sentence_id?: number | string;
				readonly text?: string;
				readonly sentence_end?: boolean;
				readonly begin_time?: number;
				readonly end_time?: number;
			};
		};
	};
}

/** Fun-ASR 与 Paraformer 共用的 DashScope 双工协议会话。 */
export class AliyunDuplexAsrSession extends AliyunWebSocketSession {
	readonly #options: DuplexAsrSessionOptions;
	readonly #taskId = randomUUID();
	readonly #segments = new Map<string, string>();
	#activeSegmentId?: string;
	#activeText = '';
	#previewText = '';
	#finishRequested = false;

	constructor(options: DuplexAsrSessionOptions) {
		super(options.url, options.headers);
		this.#options = options;
	}

	protected async onOpen(): Promise<void> {
		const parameters: Record<string, unknown> = {
			format: 'pcm',
			sample_rate: 16_000,
			semantic_punctuation_enabled: true,
		};
		if (this.#options.model === 'paraformer-realtime-v2') {
			parameters.disfluency_removal_enabled = false;
			parameters.punctuation_prediction_enabled = true;
		}
		if (this.#options.language) parameters.language_hints = [this.#options.language];
		if (this.#options.vocabularyId) parameters.vocabulary_id = this.#options.vocabularyId;
		const input = this.#options.context
			? {
					context: [
						{
							role: 'user',
							content: [
								{ type: 'input_text', text: this.#options.context.slice(0, 400) },
							],
						},
					],
				}
			: {};
		await this.send(
			JSON.stringify({
				header: {
					action: 'run-task',
					task_id: this.#taskId,
					streaming: 'duplex',
				},
				payload: {
					task_group: 'audio',
					task: 'asr',
					function: 'recognition',
					model: this.#options.model,
					parameters,
					input,
				},
			}),
		);
	}

	async writeAudio(frame: Uint8Array): Promise<void> {
		if (this.#finishRequested) throw new Error('Cannot write audio after finish');
		await this.send(frame);
	}

	async finish(): Promise<void> {
		if (this.#finishRequested) return;
		this.#finishRequested = true;
		await this.send(
			JSON.stringify({
				header: {
					action: 'finish-task',
					task_id: this.#taskId,
					streaming: 'duplex',
				},
				payload: { input: {} },
			}),
		);
		this.startFinalTimeout();
	}

	protected onMessage(data: RawData, isBinary: boolean): void {
		if (isBinary) return;
		let message: DashScopeMessage;
		try {
			message = JSON.parse(getRawDataText(data)) as DashScopeMessage;
		} catch {
			this.fail('INVALID_RESPONSE', false);
			return;
		}
		const event = message.header?.event;
		if (event === 'task-started') {
			this.markReady();
			return;
		}
		if (event === 'result-generated') {
			this.#handleResult(message);
			return;
		}
		if (event === 'task-finished') {
			this.complete(this.#getPreviewText());
			return;
		}
		if (event === 'task-failed') {
			this.fail(message.header?.error_code ?? 'TASK_FAILED', false);
		}
	}

	#handleResult(message: DashScopeMessage): void {
		const sentence = message.payload?.output?.sentence;
		if (!sentence || sentence.sentence_id === undefined || sentence.text === undefined) return;
		const id = String(sentence.sentence_id);
		if (sentence.sentence_end) {
			this.#segments.set(id, sentence.text);
			this.#activeSegmentId = undefined;
			this.#activeText = '';
		} else {
			this.#activeSegmentId = id;
			this.#activeText = sentence.text;
		}
		this.#emitPreview();
	}

	#emitPreview(): void {
		const text = this.#getPreviewText();
		if (text === this.#previewText) return;
		this.#previewText = text;
		this.eventQueue.push({ type: 'preview', text });
	}

	#getPreviewText(): string {
		const finalized = [...this.#segments.entries()]
			.filter(([id]) => id !== this.#activeSegmentId)
			.map(([, text]) => text)
			.join('');
		return `${finalized}${this.#activeText}`;
	}
}
