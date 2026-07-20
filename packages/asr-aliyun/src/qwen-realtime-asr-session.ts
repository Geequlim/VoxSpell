import { randomUUID } from 'node:crypto';

import { AliyunWebSocketSession, getRawDataText } from './websocket-session.js';

import type { AsrSessionOptions } from '@voxspell/asr-core/realtime-asr';
import type { RawData } from 'ws';

interface QwenRealtimeAsrSessionOptions {
	readonly session: AsrSessionOptions;
	readonly url: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly language?: string;
}

interface QwenRealtimeMessage {
	readonly type?: string;
	readonly event_id?: string;
	readonly item_id?: string;
	readonly transcript?: string;
	readonly text?: string;
	readonly stash?: string;
	readonly error?: { readonly code?: string };
}

/** Qwen3-ASR Flash Realtime 独立实时协议会话。 */
export class QwenRealtimeAsrSession extends AliyunWebSocketSession {
	readonly #options: QwenRealtimeAsrSessionOptions;
	readonly #segments = new Map<string, string>();
	#activeItemId?: string;
	#activeText = '';
	#previewText = '';
	#finishRequested = false;

	constructor(options: QwenRealtimeAsrSessionOptions) {
		super(options.url, options.headers);
		this.#options = options;
	}

	protected async onOpen(): Promise<void> {}

	async writeAudio(frame: Uint8Array): Promise<void> {
		if (this.#finishRequested) throw new Error('Cannot write audio after finish');
		await this.send(
			JSON.stringify({
				event_id: randomUUID(),
				type: 'input_audio_buffer.append',
				audio: Buffer.from(frame).toString('base64'),
			}),
		);
	}

	async finish(): Promise<void> {
		if (this.#finishRequested) return;
		this.#finishRequested = true;
		await this.send(JSON.stringify({ event_id: randomUUID(), type: 'session.finish' }));
		this.startFinalTimeout();
	}

	protected onMessage(data: RawData, isBinary: boolean): void {
		if (isBinary) return;
		let message: QwenRealtimeMessage;
		try {
			message = JSON.parse(getRawDataText(data)) as QwenRealtimeMessage;
		} catch {
			this.fail('INVALID_RESPONSE', false);
			return;
		}
		switch (message.type) {
			case 'session.created':
				void this.#configureSession().catch(() =>
					this.fail('SESSION_CONFIGURATION_FAILED', true),
				);
				break;
			case 'session.updated':
				this.markReady();
				break;
			case 'conversation.item.input_audio_transcription.text':
				this.#handlePartial(message);
				break;
			case 'conversation.item.input_audio_transcription.completed':
				this.#handleFinal(message);
				break;
			case 'session.finished':
				this.complete([...this.#segments.values()].join(''));
				break;
			case 'error':
				this.fail(message.error?.code ?? 'SESSION_FAILED', false);
		}
	}

	async #configureSession(): Promise<void> {
		const inputAudioTranscription: Record<string, unknown> = {};
		if (this.#options.language) inputAudioTranscription.language = this.#options.language;
		await this.send(
			JSON.stringify({
				event_id: randomUUID(),
				type: 'session.update',
				session: {
					input_audio_format: 'pcm',
					sample_rate: 16_000,
					input_audio_transcription: inputAudioTranscription,
					turn_detection: null,
				},
			}),
		);
	}

	#handlePartial(message: QwenRealtimeMessage): void {
		const id = message.item_id ?? message.event_id;
		if (!id) return;
		this.#activeItemId = id;
		this.#activeText = `${message.text ?? ''}${message.stash ?? ''}`;
		this.#emitPreview();
	}

	#handleFinal(message: QwenRealtimeMessage): void {
		const id = message.item_id ?? message.event_id;
		if (!id) return;
		const text = message.transcript ?? message.text ?? '';
		this.#segments.set(id, text);
		this.#activeItemId = undefined;
		this.#activeText = '';
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
			.filter(([id]) => id !== this.#activeItemId)
			.map(([, text]) => text)
			.join('');
		return `${finalized}${this.#activeText}`;
	}
}
