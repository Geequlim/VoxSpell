import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { OpenAiCompatibleTextPolisher } from '../src/openai-compatible-text-polisher.js';

import type { AddressInfo } from 'node:net';
import type { PolishEvent } from '../src/text-polisher.js';

interface ReceivedRequest {
	count: number;
	body?: unknown;
}

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
	await Promise.all(
		servers
			.splice(0)
			.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
	);
});

async function startStreamServer(
	status: number,
	chunks: readonly string[],
): Promise<{ baseUrl: string; received: ReceivedRequest }> {
	const received: ReceivedRequest = { count: 0 };
	const server = createServer(async (request, reply) => {
		received.count += 1;
		const body: Buffer[] = [];
		for await (const chunk of request) body.push(Buffer.from(chunk));
		received.body = JSON.parse(Buffer.concat(body).toString('utf8'));
		if (status !== 200) {
			reply.writeHead(status, { 'content-type': 'application/json' });
			reply.end(JSON.stringify({ error: { message: 'provider secret' } }));
			return;
		}
		reply.writeHead(200, { 'content-type': 'text/event-stream' });
		for (const chunk of chunks) reply.write(`data: ${chunk}\n\n`);
		reply.end('data: [DONE]\n\n');
	});
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address() as AddressInfo;
	return { baseUrl: `http://127.0.0.1:${address.port}/api/v1`, received };
}

async function polish(baseUrl: string): Promise<PolishEvent[]> {
	const polisher = new OpenAiCompatibleTextPolisher({
		id: 'test',
		apiKey: 'test-secret',
		baseUrl,
		model: 'test-model',
		systemPrompt: '只返回正文。',
	});
	const events: PolishEvent[] = [];
	for await (const event of polisher.polish(
		{
			text: '扣得克斯很好用',
			dictionary: [{ canonical: 'Codex', aliases: ['扣得克斯'] }],
		},
		new AbortController().signal,
	)) {
		events.push(event);
	}
	return events;
}

describe('OpenAiCompatibleTextPolisher', () => {
	it('sends system and user messages and streams content only', async () => {
		const { baseUrl, received } = await startStreamServer(200, [
			JSON.stringify({ choices: [{ delta: { reasoning: '思考内容' } }] }),
			JSON.stringify({ choices: [{ delta: { content: 'Codex' } }] }),
			JSON.stringify({ choices: [{ delta: { content: ' 很好用。' } }] }),
		]);

		await expect(polish(baseUrl)).resolves.toEqual([
			{ type: 'delta', text: 'Codex' },
			{ type: 'delta', text: ' 很好用。' },
			{ type: 'completed' },
		]);
		expect(received.body).toMatchObject({
			model: 'test-model',
			stream: true,
			messages: [
				{
					role: 'system',
					content:
						'只返回正文。\n\n<voice_dictionary>\n' +
						'[{"canonical":"Codex","aliases":["扣得克斯"]}]\n' +
						'</voice_dictionary>',
				},
				{ role: 'user', content: '扣得克斯很好用' },
			],
		});
		expect(received.count).toBe(1);
	});

	it.each([
		[401, 'AUTHENTICATION_FAILED', false],
		[429, 'RATE_LIMITED', true],
		[500, 'PROVIDER_UNAVAILABLE', true],
	] as const)('maps HTTP %s without exposing its response', async (status, code, retryable) => {
		const { baseUrl } = await startStreamServer(status, []);
		await expect(polish(baseUrl)).resolves.toEqual([{ type: 'error', code, retryable }]);
	});

	it('stops an in-flight stream after cancellation', async () => {
		const requestStarted = Promise.withResolvers<void>();
		const server = createServer(async (request, reply) => {
			for await (const chunk of request) void chunk;
			reply.writeHead(200, { 'content-type': 'text/event-stream' });
			requestStarted.resolve();
		});
		servers.push(server);
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const address = server.address() as AddressInfo;
		const polisher = new OpenAiCompatibleTextPolisher({
			id: 'test',
			apiKey: 'test-secret',
			baseUrl: `http://127.0.0.1:${address.port}/api/v1`,
			model: 'test-model',
			systemPrompt: '只返回正文。',
		});
		const controller = new AbortController();
		const eventsPromise = (async (): Promise<PolishEvent[]> => {
			const events: PolishEvent[] = [];
			for await (const event of polisher.polish(
				{ text: '原文', dictionary: [] },
				controller.signal,
			)) {
				events.push(event);
			}
			return events;
		})();
		await requestStarted.promise;
		controller.abort('test-cancel');

		await expect(eventsPromise).resolves.toEqual([]);
	});

	it('reports an idle timeout when no content delta arrives', async () => {
		const server = createServer(async (request, reply) => {
			for await (const chunk of request) void chunk;
			reply.writeHead(200, { 'content-type': 'text/event-stream' });
			reply.write(
				`data: ${JSON.stringify({ choices: [{ delta: { reasoning: '思考' } }] })}\n\n`,
			);
		});
		servers.push(server);
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const address = server.address() as AddressInfo;
		const polisher = new OpenAiCompatibleTextPolisher({
			id: 'test',
			apiKey: 'test-secret',
			baseUrl: `http://127.0.0.1:${address.port}/api/v1`,
			model: 'test-model',
			systemPrompt: '只返回正文。',
			timeoutMilliseconds: 1_000,
		});
		const events: PolishEvent[] = [];
		for await (const event of polisher.polish(
			{ text: '原文', dictionary: [] },
			new AbortController().signal,
		)) {
			events.push(event);
		}

		expect(events).toEqual([{ type: 'error', code: 'TIMEOUT', retryable: true }]);
	});
});
