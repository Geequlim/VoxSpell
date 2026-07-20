import { once } from 'node:events';

import type WebSocket from 'ws';
import { WebSocketServer } from 'ws';
import { describe, expect, it } from 'vitest';

import { AliyunDuplexAsrSession } from '../src/duplex-asr-session.js';
import { QwenRealtimeAsrSession } from '../src/qwen-realtime-asr-session.js';

import type { AddressInfo } from 'node:net';
import type { AsrEvent, RealtimeAsrSession } from '@voxspell/asr-core/realtime-asr';

const SESSION_ID = '0198a791-f212-7d8b-a856-63eea0720d4c';

describe('Aliyun realtime sessions', () => {
	it('publishes duplicate-free duplex previews when sentence ids change', async () => {
		let runTask: Record<string, unknown> | undefined;
		const server = await createServer((socket) => {
			socket.on('message', (data, isBinary) => {
				if (isBinary) return;
				const message = JSON.parse(data.toString()) as {
					header: { action: string };
				};
				if (message.header.action === 'run-task') {
					runTask = message;
					socket.send(JSON.stringify({ header: { event: 'task-started' }, payload: {} }));
					return;
				}
				socket.send(createDuplexResult(1, false, '你号'));
				socket.send(createDuplexResult(2, false, '你好'));
				socket.send(createDuplexResult(2, true, '你好'));
				socket.send(JSON.stringify({ header: { event: 'task-finished' }, payload: {} }));
			});
		});

		try {
			const session = new AliyunDuplexAsrSession({
				session: { sessionId: SESSION_ID },
				url: getServerUrl(server),
				headers: {},
				model: 'fun-asr-realtime',
				language: 'zh',
				context: 'VoxSpell',
				vocabularyId: 'vocab-1',
			});
			const events = collectEvents(session);
			await session.start(new AbortController().signal);
			await session.writeAudio(new Uint8Array([1, 2]));
			await session.finish();

			expect(await events).toEqual([
				{ type: 'ready' },
				{ type: 'preview', text: '你号' },
				{ type: 'preview', text: '你好' },
				{ type: 'completed', text: '你好' },
			]);
			expect(runTask).toMatchObject({
				payload: {
					parameters: {
						language_hints: ['zh'],
						vocabulary_id: 'vocab-1',
					},
					input: {
						context: [
							{ role: 'user', content: [{ type: 'input_text', text: 'VoxSpell' }] },
						],
					},
				},
			});
		} finally {
			await closeServer(server);
		}
	});

	it('publishes duplicate-free Qwen previews when item ids change', async () => {
		const clientEvents: string[] = [];
		const server = await createServer((socket) => {
			socket.send(JSON.stringify({ type: 'session.created', event_id: 'created' }));
			socket.on('message', (data) => {
				const message = JSON.parse(data.toString()) as { type: string };
				clientEvents.push(message.type);
				if (message.type === 'session.update') {
					socket.send(JSON.stringify({ type: 'session.updated', event_id: 'updated' }));
					return;
				}
				if (message.type !== 'session.finish') return;
				socket.send(
					JSON.stringify({
						type: 'conversation.item.input_audio_transcription.text',
						item_id: 'item-1',
						text: '',
						stash: '你好',
					}),
				);
				socket.send(
					JSON.stringify({
						type: 'conversation.item.input_audio_transcription.text',
						item_id: 'item-2',
						text: '你好',
						stash: '世界',
					}),
				);
				socket.send(
					JSON.stringify({
						type: 'conversation.item.input_audio_transcription.completed',
						item_id: 'item-2',
						transcript: '你好世界',
					}),
				);
				socket.send(JSON.stringify({ type: 'session.finished', event_id: 'finished' }));
			});
		});

		try {
			const session = new QwenRealtimeAsrSession({
				session: { sessionId: SESSION_ID },
				url: getServerUrl(server),
				headers: {},
				language: 'zh',
			});
			const events = collectEvents(session);
			await session.start(new AbortController().signal);
			await session.writeAudio(new Uint8Array([1, 2]));
			await session.finish();

			expect(await events).toEqual([
				{ type: 'ready' },
				{ type: 'preview', text: '你好' },
				{ type: 'preview', text: '你好世界' },
				{ type: 'completed', text: '你好世界' },
			]);
			expect(clientEvents).toEqual([
				'session.update',
				'input_audio_buffer.append',
				'session.finish',
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

function getServerUrl(server: WebSocketServer): string {
	return `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function collectEvents(session: RealtimeAsrSession): Promise<AsrEvent[]> {
	const events: AsrEvent[] = [];
	for await (const event of session.events()) events.push(event);
	return events;
}

function createDuplexResult(sentenceId: number, sentenceEnd: boolean, text: string): string {
	return JSON.stringify({
		header: { event: 'result-generated' },
		payload: {
			output: {
				sentence: {
					sentence_id: sentenceId,
					text,
					sentence_end: sentenceEnd,
					begin_time: 10,
					end_time: sentenceEnd ? 30 : 20,
				},
			},
		},
	});
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
