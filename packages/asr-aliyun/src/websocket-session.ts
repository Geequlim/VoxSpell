import WebSocket from 'ws';

import { EventQueue } from './event-queue.js';

import type { AsrEvent, RealtimeAsrSession } from '@voxspell/asr-core/realtime-asr';
import type { RawData } from 'ws';

const HANDSHAKE_TIMEOUT_MILLISECONDS = 8_000;
const FINAL_TIMEOUT_MILLISECONDS = 15_000;

/** 阿里云实时协议共享的连接生命周期。 */
export abstract class AliyunWebSocketSession implements RealtimeAsrSession {
	protected readonly eventQueue = new EventQueue<AsrEvent>();
	protected socket?: WebSocket;
	readonly #url: string;
	readonly #headers: Readonly<Record<string, string>>;
	#handshake?: PromiseWithResolvers<void>;
	#handshakeTimer?: NodeJS.Timeout;
	#finalTimer?: NodeJS.Timeout;
	#abortSignal?: AbortSignal;
	#abortListener?: () => void;
	#started = false;
	#finished = false;
	#cancelled = false;

	protected constructor(url: string, headers: Readonly<Record<string, string>>) {
		this.#url = url;
		this.#headers = headers;
	}

	async start(signal: AbortSignal): Promise<void> {
		if (this.#started) return;
		this.#started = true;
		if (signal.aborted) throw new Error('Aliyun ASR session was cancelled');
		this.#abortSignal = signal;
		this.#abortListener = () => void this.cancel();
		signal.addEventListener('abort', this.#abortListener, { once: true });
		this.#handshake = Promise.withResolvers<void>();
		const socket = new WebSocket(this.#url, { headers: this.#headers });
		this.socket = socket;
		socket.once('open', () => {
			void this.onOpen().catch(() => this.fail('SESSION_START_FAILED', true));
		});
		socket.on('message', (data, isBinary) => this.onMessage(data, isBinary));
		socket.once('error', () => this.fail('CONNECTION_FAILED', true));
		socket.once('close', () => {
			if (!this.#finished && !this.#cancelled) this.fail('CONNECTION_CLOSED', true);
		});
		this.#handshakeTimer = setTimeout(
			() => this.fail('HANDSHAKE_TIMEOUT', true),
			HANDSHAKE_TIMEOUT_MILLISECONDS,
		);
		await this.#handshake.promise;
	}

	abstract writeAudio(frame: Uint8Array): Promise<void>;
	abstract finish(): Promise<void>;
	protected abstract onOpen(): Promise<void>;
	protected abstract onMessage(data: RawData, isBinary: boolean): void;

	async cancel(): Promise<void> {
		if (this.#cancelled) return;
		this.#cancelled = true;
		this.#clearTimers();
		this.#handshake?.reject(new Error('Aliyun ASR session was cancelled'));
		this.#handshake = undefined;
		this.socket?.close();
		this.eventQueue.close();
		this.#removeAbortListener();
	}

	events(): AsyncIterable<AsrEvent> {
		return this.eventQueue.values();
	}

	protected markReady(): void {
		if (!this.#handshake) return;
		clearTimeout(this.#handshakeTimer);
		this.#handshakeTimer = undefined;
		this.eventQueue.push({ type: 'ready' });
		this.#handshake.resolve();
		this.#handshake = undefined;
	}

	protected startFinalTimeout(): void {
		this.#finalTimer = setTimeout(
			() => this.fail('FINAL_TIMEOUT', true),
			FINAL_TIMEOUT_MILLISECONDS,
		);
	}

	protected complete(text: string): void {
		if (this.#finished || this.#cancelled) return;
		this.#finished = true;
		this.#clearTimers();
		this.eventQueue.push({ type: 'completed', text });
		this.eventQueue.close();
		this.socket?.close();
		this.#removeAbortListener();
	}

	protected fail(code: string, retryable: boolean): void {
		if (this.#finished || this.#cancelled) return;
		this.#finished = true;
		this.#clearTimers();
		this.#handshake?.reject(new Error(`Aliyun ASR failed: ${code}`));
		this.#handshake = undefined;
		this.eventQueue.push({ type: 'error', code, retryable });
		this.eventQueue.close();
		this.socket?.close();
		this.#removeAbortListener();
	}

	protected async send(data: string | Uint8Array): Promise<void> {
		const socket = this.socket;
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			throw new Error('Aliyun ASR WebSocket is not open');
		}
		await new Promise<void>((resolve, reject) => {
			socket.send(data, (error) => {
				if (error) reject(error);
				else resolve();
			});
		});
	}

	#clearTimers(): void {
		clearTimeout(this.#handshakeTimer);
		clearTimeout(this.#finalTimer);
		this.#handshakeTimer = undefined;
		this.#finalTimer = undefined;
	}

	#removeAbortListener(): void {
		if (this.#abortSignal && this.#abortListener) {
			this.#abortSignal.removeEventListener('abort', this.#abortListener);
		}
		this.#abortSignal = undefined;
		this.#abortListener = undefined;
	}
}

/** 将 ws RawData 转换为 UTF-8 文本。 */
export function getRawDataText(data: RawData): string {
	if (typeof data === 'string') return data;
	if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
	if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
	return data.toString('utf8');
}
