import { setTimeout as delay } from 'node:timers/promises';

import { Value } from '@sinclair/typebox/value';
import WebSocket from 'ws';

import { PcmPacketizer } from './pcm-packetizer.js';
import { TencentAsrMessageSchema, createTencentAsrErrorEvent } from './tencent-message.js';
import { createTencentAsrUrl } from './tencent-signature.js';

import type {
	AsrEvent,
	AsrSessionOptions,
	RealtimeAsrSession,
} from '@voxspell/asr-core/realtime-asr';
import type { RawData } from 'ws';

const PCM_PACKET_BYTES = 6_400;
const DEFAULT_PACKET_INTERVAL_MILLISECONDS = 200;
const DEFAULT_HANDSHAKE_TIMEOUT_MILLISECONDS = 5_000;
const DEFAULT_FINAL_TIMEOUT_MILLISECONDS = 10_000;

interface PendingRead<T> {
	readonly resolve: (result: IteratorResult<T>) => void;
}

interface TencentRealtimeAsrSessionOptions {
	readonly session: AsrSessionOptions;
	readonly appId: string;
	readonly secretId: string;
	readonly secretKey: string;
	readonly engineModelType: string;
	readonly endpoint?: string;
	readonly packetIntervalMilliseconds?: number;
	readonly handshakeTimeoutMilliseconds?: number;
	readonly finalTimeoutMilliseconds?: number;
}

/** 为 Provider 事件提供可在生产者启动前订阅的有序异步队列。 */
class EventQueue<T> {
	readonly #values: T[] = [];
	readonly #pendingReads: PendingRead<T>[] = [];
	#closed = false;

	push(value: T): void {
		if (this.#closed) return;
		const pendingRead = this.#pendingReads.shift();
		if (pendingRead) {
			pendingRead.resolve({ value, done: false });
			return;
		}
		this.#values.push(value);
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

/** 管理一次腾讯云实时识别连接、音频节拍和结果修订。 */
export class TencentRealtimeAsrSession implements RealtimeAsrSession {
	readonly #options: TencentRealtimeAsrSessionOptions;
	readonly #packetizer = new PcmPacketizer(PCM_PACKET_BYTES);
	readonly #events = new EventQueue<AsrEvent>();
	readonly #revisions = new Map<number, number>();
	readonly #segments = new Map<number, string>();
	readonly #abortController = new AbortController();
	#socket?: WebSocket;
	#handshake?: PromiseWithResolvers<void>;
	#handshakeTimer?: NodeJS.Timeout;
	#finalTimer?: NodeJS.Timeout;
	#externalSignal?: AbortSignal;
	#externalAbortListener?: () => void;
	#nextSendAt = 0;
	#started = false;
	#finishRequested = false;
	#completed = false;
	#failed = false;
	#cancelled = false;

	constructor(options: TencentRealtimeAsrSessionOptions) {
		this.#options = options;
	}

	async start(signal: AbortSignal): Promise<void> {
		if (this.#started) return;
		this.#started = true;
		if (signal.aborted) {
			await this.cancel('aborted');
			throw new Error('Tencent ASR session was cancelled');
		}
		this.#externalSignal = signal;
		this.#externalAbortListener = () => void this.cancel('aborted');
		signal.addEventListener('abort', this.#externalAbortListener, { once: true });

		const url = createTencentAsrUrl(this.#options);
		const socket = new WebSocket(url);
		this.#socket = socket;
		this.#handshake = Promise.withResolvers<void>();
		socket.on('message', (data, isBinary) => this.#handleMessage(data, isBinary));
		socket.once('error', () => this.#handleSocketFailure());
		socket.once('close', () => this.#handleSocketClose());
		const handshakeTimeout =
			this.#options.handshakeTimeoutMilliseconds ?? DEFAULT_HANDSHAKE_TIMEOUT_MILLISECONDS;
		this.#handshakeTimer = setTimeout(
			() => this.#failHandshake('Tencent ASR handshake timed out'),
			handshakeTimeout,
		);
		await this.#handshake.promise;
	}

	async writeAudio(frame: Uint8Array): Promise<void> {
		if (this.#finishRequested) throw new Error('Cannot write audio after finish');
		if (this.#cancelled) return;
		for (const packet of this.#packetizer.write(frame)) await this.#sendPacket(packet);
	}

	async finish(): Promise<void> {
		if (this.#finishRequested || this.#cancelled) return;
		this.#finishRequested = true;
		const remaining = this.#packetizer.flush();
		if (remaining) await this.#sendPacket(remaining);
		await this.#sendText(JSON.stringify({ type: 'end' }));
		const finalTimeout =
			this.#options.finalTimeoutMilliseconds ?? DEFAULT_FINAL_TIMEOUT_MILLISECONDS;
		this.#finalTimer = setTimeout(() => {
			this.#emitError({ type: 'error', code: 'FINAL_TIMEOUT', retryable: true });
		}, finalTimeout);
	}

	async cancel(reason?: string): Promise<void> {
		if (this.#cancelled || this.#completed) return;
		this.#cancelled = true;
		this.#abortController.abort(reason);
		this.#clearTimers();
		this.#handshake?.reject(new Error('Tencent ASR session was cancelled'));
		this.#closeSocket();
		this.#events.close();
		this.#removeAbortListener();
	}

	events(): AsyncIterable<AsrEvent> {
		return this.#events.values();
	}

	async #sendPacket(packet: Uint8Array): Promise<void> {
		const interval =
			this.#options.packetIntervalMilliseconds ?? DEFAULT_PACKET_INTERVAL_MILLISECONDS;
		const waitMilliseconds = this.#nextSendAt - performance.now();
		if (waitMilliseconds > 0) {
			await delay(waitMilliseconds, undefined, { signal: this.#abortController.signal });
		}
		if (this.#cancelled) return;
		await this.#send(packet);
		this.#nextSendAt = performance.now() + interval;
	}

	async #sendText(text: string): Promise<void> {
		await this.#send(text);
	}

	async #send(data: Uint8Array | string): Promise<void> {
		const socket = this.#socket;
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			throw new Error('Tencent ASR WebSocket is not open');
		}
		await new Promise<void>((resolve, reject) => {
			socket.send(data, (error) => {
				if (error) reject(error);
				else resolve();
			});
		});
	}

	#handleMessage(data: RawData, isBinary: boolean): void {
		if (isBinary || this.#cancelled || this.#completed || this.#failed) return;
		let value: unknown;
		try {
			value = JSON.parse(getRawDataText(data));
		} catch {
			this.#handleInvalidResponse();
			return;
		}
		if (!Value.Check(TencentAsrMessageSchema, value)) {
			this.#handleInvalidResponse();
			return;
		}
		if (value.code !== 0) {
			const event = createTencentAsrErrorEvent(value.code);
			if (this.#handshake) this.#failHandshake(`Tencent ASR handshake failed: ${event.code}`);
			else this.#emitError(event);
			return;
		}

		if (this.#handshake) {
			this.#completeHandshake();
		}
		if (value.result) this.#handleResult(value.result);
		if (value.final === 1) this.#handleCompleted();
	}

	#handleResult(result: {
		readonly slice_type: 0 | 1 | 2;
		readonly index: number;
		readonly voice_text_str: string;
	}): void {
		this.#segments.set(result.index, result.voice_text_str);
		const segmentId = `tencent:${result.index}`;
		if (result.slice_type === 2) {
			this.#events.push({ type: 'segment-final', segmentId, text: result.voice_text_str });
			return;
		}
		const revision = this.#revisions.get(result.index) ?? 0;
		this.#revisions.set(result.index, revision + 1);
		this.#events.push({
			type: 'partial',
			segmentId,
			revision,
			text: result.voice_text_str,
		});
	}

	#handleCompleted(): void {
		const text = [...this.#segments.entries()]
			.sort(([left], [right]) => left - right)
			.map(([, segment]) => segment)
			.join('');
		if (!text) {
			this.#emitError({ type: 'error', code: 'EMPTY_TRANSCRIPT', retryable: false });
			return;
		}
		this.#completed = true;
		this.#clearTimers();
		this.#events.push({ type: 'completed', text });
		this.#events.close();
		this.#closeSocket();
		this.#removeAbortListener();
	}

	#completeHandshake(): void {
		clearTimeout(this.#handshakeTimer);
		this.#handshakeTimer = undefined;
		const handshake = this.#handshake;
		this.#handshake = undefined;
		handshake?.resolve();
		this.#events.push({ type: 'ready' });
	}

	#handleInvalidResponse(): void {
		if (this.#handshake) {
			this.#failHandshake('Tencent ASR returned an invalid handshake response');
			return;
		}
		this.#emitError({ type: 'error', code: 'INVALID_RESPONSE', retryable: false });
	}

	#handleSocketFailure(): void {
		if (this.#cancelled || this.#completed || this.#failed) return;
		if (this.#handshake) {
			this.#failHandshake('Tencent ASR connection failed');
			return;
		}
		this.#emitError({ type: 'error', code: 'NETWORK_ERROR', retryable: true });
	}

	#handleSocketClose(): void {
		if (this.#cancelled || this.#completed || this.#failed) return;
		if (this.#handshake) {
			this.#failHandshake('Tencent ASR connection closed during handshake');
			return;
		}
		this.#emitError({ type: 'error', code: 'CONNECTION_CLOSED', retryable: true });
	}

	#failHandshake(message: string): void {
		if (!this.#handshake || this.#failed) return;
		this.#failed = true;
		this.#clearTimers();
		const handshake = this.#handshake;
		this.#handshake = undefined;
		handshake.reject(new Error(message));
		this.#events.close();
		this.#closeSocket();
		this.#removeAbortListener();
	}

	#emitError(event: Extract<AsrEvent, { readonly type: 'error' }>): void {
		if (this.#failed || this.#cancelled || this.#completed) return;
		this.#failed = true;
		this.#clearTimers();
		this.#events.push(event);
		this.#events.close();
		this.#closeSocket();
		this.#removeAbortListener();
	}

	#clearTimers(): void {
		clearTimeout(this.#handshakeTimer);
		clearTimeout(this.#finalTimer);
		this.#handshakeTimer = undefined;
		this.#finalTimer = undefined;
	}

	#closeSocket(): void {
		const socket = this.#socket;
		if (!socket) return;
		if (socket.readyState === WebSocket.OPEN) socket.close();
		else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
	}

	#removeAbortListener(): void {
		if (this.#externalSignal && this.#externalAbortListener) {
			this.#externalSignal.removeEventListener('abort', this.#externalAbortListener);
		}
	}
}

/** 将 ws RawData 统一转换为 UTF-8 文本。 */
function getRawDataText(data: RawData): string {
	if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
	if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
	return Buffer.from(data).toString('utf8');
}
