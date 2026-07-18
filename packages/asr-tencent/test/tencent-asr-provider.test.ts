import { once } from 'node:events';

import type WebSocket from 'ws';
import { WebSocketServer } from 'ws';
import { describe, expect, it } from 'vitest';

import { TencentRealtimeAsrProvider } from '../src/tencent-asr-provider.js';

import type { AddressInfo } from 'node:net';
import type { AsrEvent, RealtimeAsrSession } from '@voxspell/asr-core/realtime-asr';
import type { RawData } from 'ws';

const SESSION_ID = '0198a791-f212-7d8b-a856-63eea0720d4c';

describe('TencentRealtimeAsrProvider', () => {
	it('streams paced PCM and maps Tencent revisions into ordered ASR events', async () => {
		const receivedPacketSizes: number[] = [];
		const server = await createServer((socket) => {
			socket.send(JSON.stringify({ code: 0, message: 'success', voice_id: 'voice-1' }));
			socket.on('message', (data, isBinary) => {
				if (isBinary) {
					receivedPacketSizes.push(getRawDataLength(data));
					return;
				}
				if (JSON.parse(data.toString()).type !== 'end') return;
				socket.send(createResultMessage(0, 0, '你号'));
				socket.send(createResultMessage(0, 1, '你好'));
				socket.send(createResultMessage(0, 2, '你好'));
				socket.send(
					JSON.stringify({ code: 0, message: 'success', voice_id: 'voice-1', final: 1 }),
				);
			});
		});

		try {
			const session = await createSession(server);
			await session.start(new AbortController().signal);
			const events = collectEvents(session);
			await session.writeAudio(new Uint8Array(7_000));
			await session.finish();

			expect(await events).toEqual([
				{ type: 'ready' },
				{ type: 'partial', segmentId: 'tencent:0', revision: 0, text: '你号' },
				{ type: 'partial', segmentId: 'tencent:0', revision: 1, text: '你好' },
				{ type: 'segment-final', segmentId: 'tencent:0', text: '你好' },
				{ type: 'completed', text: '你好' },
			]);
			expect(receivedPacketSizes).toEqual([6_400, 600]);
		} finally {
			await closeServer(server);
		}
	});

	it('maps provider authentication errors without leaking credentials', async () => {
		const server = await createServer((socket) => {
			socket.send(JSON.stringify({ code: 0, message: 'success', voice_id: 'voice-2' }));
			queueMicrotask(() => {
				socket.send(
					JSON.stringify({ code: 4002, message: 'bad secret', voice_id: 'voice-2' }),
				);
			});
		});

		try {
			const session = await createSession(server);
			await session.start(new AbortController().signal);
			expect(await collectEvents(session)).toEqual([
				{ type: 'ready' },
				{ type: 'error', code: 'AUTHENTICATION_FAILED', retryable: false },
			]);
		} finally {
			await closeServer(server);
		}
	});

	it('fails predictably when Tencent does not send its final marker', async () => {
		const server = await createServer((socket) => {
			socket.send(JSON.stringify({ code: 0, message: 'success', voice_id: 'voice-3' }));
		});

		try {
			const session = await createSession(server, 20);
			await session.start(new AbortController().signal);
			const events = collectEvents(session);
			await session.finish();
			expect(await events).toEqual([
				{ type: 'ready' },
				{ type: 'error', code: 'FINAL_TIMEOUT', retryable: true },
			]);
		} finally {
			await closeServer(server);
		}
	});

	it('distinguishes an empty final transcript from a malformed response', async () => {
		const server = await createServer((socket) => {
			socket.send(JSON.stringify({ code: 0, message: 'success', voice_id: 'voice-4' }));
			socket.on('message', (data, isBinary) => {
				if (isBinary || JSON.parse(data.toString()).type !== 'end') return;
				socket.send(
					JSON.stringify({ code: 0, message: 'success', voice_id: 'voice-4', final: 1 }),
				);
			});
		});

		try {
			const session = await createSession(server);
			await session.start(new AbortController().signal);
			const events = collectEvents(session);
			await session.finish();
			expect(await events).toEqual([
				{ type: 'ready' },
				{ type: 'error', code: 'EMPTY_TRANSCRIPT', retryable: false },
			]);
		} finally {
			await closeServer(server);
		}
	});
});

async function createServer(onConnection: (socket: WebSocket) => void): Promise<WebSocketServer> {
	const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
	server.on('connection', onConnection);
	await once(server, 'listening');
	return server;
}

async function createSession(
	server: WebSocketServer,
	finalTimeoutMilliseconds = 500,
): Promise<RealtimeAsrSession> {
	const address = server.address() as AddressInfo;
	const provider = new TencentRealtimeAsrProvider({
		id: 'tencent',
		appId: '12345',
		secretId: 'secret-id',
		secretKey: 'secret-key',
		engineModelType: '16k_zh_en',
		endpoint: `ws://127.0.0.1:${address.port}/asr/v2`,
		packetIntervalMilliseconds: 0,
		finalTimeoutMilliseconds,
	});
	return provider.createSession({ sessionId: SESSION_ID });
}

async function collectEvents(session: RealtimeAsrSession): Promise<AsrEvent[]> {
	const events: AsrEvent[] = [];
	for await (const event of session.events()) events.push(event);
	return events;
}

function createResultMessage(index: number, sliceType: 0 | 1 | 2, text: string): string {
	return JSON.stringify({
		code: 0,
		message: 'success',
		voice_id: 'voice-1',
		result: { index, slice_type: sliceType, voice_text_str: text },
	});
}

function getRawDataLength(data: RawData): number {
	if (Array.isArray(data)) return data.reduce((total, chunk) => total + chunk.byteLength, 0);
	return data.byteLength;
}

async function closeServer(server: WebSocketServer): Promise<void> {
	for (const client of server.clients) client.terminate();
	await new Promise<void>((resolve, reject) => {
		server.close((error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}
