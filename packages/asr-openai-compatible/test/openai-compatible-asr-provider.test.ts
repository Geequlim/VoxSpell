import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { OpenAiCompatibleAsrProvider } from '../src/openai-compatible-asr-provider.js';

import type { AddressInfo } from 'node:net';
import type { AsrEvent } from '@voxspell/asr-core/realtime-asr';

const SESSION_ID = '123e4567-e89b-42d3-a456-426614174000';

interface ReceivedRequest {
	count: number;
	method?: string;
	url?: string;
	authorization?: string;
	body?: Buffer;
}

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
	await Promise.all(
		servers
			.splice(0)
			.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
	);
});

/** 启动一次只处理转写请求的本地兼容 API。 */
async function startServer(
	status: number,
	response: unknown,
): Promise<{ baseUrl: string; received: ReceivedRequest }> {
	const received: ReceivedRequest = { count: 0 };
	const server = createServer(async (request, reply) => {
		received.count += 1;
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.from(chunk));
		received.method = request.method;
		received.url = request.url;
		received.authorization = request.headers.authorization;
		received.body = Buffer.concat(chunks);
		reply.writeHead(status, { 'content-type': 'application/json' });
		reply.end(JSON.stringify(response));
	});
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address() as AddressInfo;
	return { baseUrl: `http://127.0.0.1:${address.port}/api/v1`, received };
}

/** 运行一个完整的批量转写会话并收集事件。 */
async function transcribe(baseUrl: string): Promise<AsrEvent[]> {
	const provider = new OpenAiCompatibleAsrProvider({
		id: 'test',
		apiKey: 'test-secret',
		baseUrl,
		model: 'test-model',
	});
	const session = await provider.createSession({ sessionId: SESSION_ID });
	const eventsPromise = (async (): Promise<AsrEvent[]> => {
		const events: AsrEvent[] = [];
		for await (const event of session.events()) events.push(event);
		return events;
	})();
	await session.start(new AbortController().signal);
	await session.writeAudio(Uint8Array.from([1, 2, 3, 4]));
	await session.finish();
	await session.finish();
	return eventsPromise;
}

describe('OpenAiCompatibleAsrProvider', () => {
	it('uses the SDK multipart upload and returns completed text', async () => {
		const { baseUrl, received } = await startServer(200, { text: '识别成功' });
		const events = await transcribe(baseUrl);

		expect(events).toEqual([{ type: 'ready' }, { type: 'completed', text: '识别成功' }]);
		expect(received.method).toBe('POST');
		expect(received.url).toBe('/api/v1/audio/transcriptions');
		expect(received.authorization).toBe('Bearer test-secret');
		expect(received.body?.includes(Buffer.from('test-model'))).toBe(true);
		expect(received.body?.includes(Buffer.from('RIFF'))).toBe(true);
		expect(received.count).toBe(1);
	});

	it.each([
		[401, 'AUTHENTICATION_FAILED', false],
		[429, 'RATE_LIMITED', true],
		[500, 'PROVIDER_UNAVAILABLE', true],
	] as const)('maps HTTP %s without exposing its response', async (status, code, retryable) => {
		const { baseUrl } = await startServer(status, { error: { message: 'provider secret' } });
		await expect(transcribe(baseUrl)).resolves.toEqual([
			{ type: 'ready' },
			{ type: 'error', code, retryable },
		]);
	});

	it.each([{ result: 'missing text' }, { text: '' }, { text: '   ' }])(
		'rejects an invalid transcription response: %j',
		async (response) => {
			const { baseUrl } = await startServer(200, response);
			await expect(transcribe(baseUrl)).resolves.toEqual([
				{ type: 'ready' },
				{ type: 'error', code: 'INVALID_RESPONSE', retryable: false },
			]);
		},
	);

	it('cancels an in-flight SDK request without publishing an error', async () => {
		const requestStarted = Promise.withResolvers<void>();
		const server = createServer(async (request) => {
			for await (const chunk of request) void chunk;
			requestStarted.resolve();
		});
		servers.push(server);
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const address = server.address() as AddressInfo;
		const provider = new OpenAiCompatibleAsrProvider({
			id: 'test',
			apiKey: 'test-secret',
			baseUrl: `http://127.0.0.1:${address.port}/api/v1`,
			model: 'test-model',
		});
		const session = await provider.createSession({ sessionId: SESSION_ID });
		const eventsPromise = (async (): Promise<AsrEvent[]> => {
			const events: AsrEvent[] = [];
			for await (const event of session.events()) events.push(event);
			return events;
		})();
		await session.start(new AbortController().signal);
		await session.writeAudio(Uint8Array.from([1, 2]));
		await session.finish();
		await requestStarted.promise;
		await session.cancel('test-cancel');

		await expect(eventsPromise).resolves.toEqual([{ type: 'ready' }]);
	});
});
