import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { OpenAiCompatibleAsrProvider } from '@voxspell/asr-openai-compatible/openai-compatible-asr-provider';
import { InitializeRequest } from '@voxspell/protocol/initialize';
import { SessionCancelRequest } from '@voxspell/protocol/session';
import { SessionCompletedNotification } from '@voxspell/protocol/session';
import { SessionErrorNotification } from '@voxspell/protocol/session';
import { SessionFinishRequest } from '@voxspell/protocol/session';
import { SessionPhaseNotification } from '@voxspell/protocol/session';
import { SessionPreviewNotification } from '@voxspell/protocol/session';
import { SessionResultsNotification } from '@voxspell/protocol/session';
import { SessionStartRequest } from '@voxspell/protocol/session';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StreamMessageReader } from 'vscode-jsonrpc/node';
import { StreamMessageWriter } from 'vscode-jsonrpc/node';
import { createMessageConnection } from 'vscode-jsonrpc/node';

import { WaveFileAudioCaptureBackend } from '../src/audio/wave-file-audio-capture.js';
import { DaemonRuntime } from '../src/runtime/create-daemon.js';

import type { Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { InitializeResult } from '@voxspell/protocol/initialize';
import type {
	SessionCompletedParams,
	SessionErrorParams,
	SessionResultsParams,
} from '@voxspell/protocol/session';
import type { MessageConnection } from 'vscode-jsonrpc/node';

const FIXTURE_PATH = path.resolve('test/fixtures/ascend/ascend_test_00138.wav');

interface FakeTranscriptionResponse {
	readonly status: number;
	readonly body: unknown;
}

interface FakeTranscriptionApi {
	readonly baseUrl: string;
	readonly requestReceived: Promise<void>;
	readonly responseClosed: Promise<void>;
	respond(response: FakeTranscriptionResponse): void;
	dispose(): Promise<void>;
}

interface DaemonTestContext {
	readonly directory: string;
	readonly runtime: DaemonRuntime;
	readonly socket: Socket;
	readonly client: MessageConnection;
	readonly methods: string[];
	readonly completed: SessionCompletedParams[];
	readonly errors: SessionErrorParams[];
	readonly results: SessionResultsParams[];
	readonly initialization: InitializeResult;
}

const apis: FakeTranscriptionApi[] = [];
const contexts: DaemonTestContext[] = [];

/** 启动由测试控制响应时机的本地转写 API。 */
async function createFakeTranscriptionApi(): Promise<FakeTranscriptionApi> {
	const requestReceived = Promise.withResolvers<void>();
	const responseClosed = Promise.withResolvers<void>();
	const pendingResponse = Promise.withResolvers<FakeTranscriptionResponse>();
	const server = createServer(async (request, reply) => {
		for await (const chunk of request) void chunk;
		requestReceived.resolve();
		reply.once('close', () => responseClosed.resolve());
		const response = await pendingResponse.promise;
		if (reply.destroyed) return;
		reply.writeHead(response.status, { 'content-type': 'application/json' });
		reply.end(JSON.stringify(response.body));
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address() as AddressInfo;
	let responded = false;
	const api: FakeTranscriptionApi = {
		baseUrl: `http://127.0.0.1:${address.port}/api/v1`,
		requestReceived: requestReceived.promise,
		responseClosed: responseClosed.promise,
		respond: (response) => {
			if (responded) return;
			responded = true;
			pendingResponse.resolve(response);
		},
		dispose: async () => {
			if (!responded) pendingResponse.resolve({ status: 500, body: {} });
			server.closeAllConnections();
			await closeServer(server);
		},
	};
	apis.push(api);
	return api;
}

/** 关闭本地 HTTP server，并兼容已经关闭的情况。 */
async function closeServer(server: Server): Promise<void> {
	if (!server.listening) return;
	await new Promise<void>((resolve, reject) => {
		server.close((error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

/** 连接 daemon Unix Socket。 */
async function connect(socketPath: string): Promise<Socket> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(socketPath);
		socket.once('connect', () => resolve(socket));
		socket.once('error', reject);
	});
}

/** 创建使用真实 Socket、WAV capture 和 SDK Provider 的 daemon 测试环境。 */
async function createDaemonTestContext(api: FakeTranscriptionApi): Promise<DaemonTestContext> {
	const directory = await mkdtemp(path.join(tmpdir(), 'voxspell-openai-daemon-'));
	const runtime = new DaemonRuntime({
		socketPath: path.join(directory, 'voxspell', 'daemon.sock'),
		captureBackend: new WaveFileAudioCaptureBackend(FIXTURE_PATH),
		asrProvider: new OpenAiCompatibleAsrProvider({
			id: 'compatible-test',
			apiKey: 'test-secret',
			baseUrl: api.baseUrl,
			model: 'test-model',
		}),
	});
	await runtime.start();
	const socket = await connect(runtime.socketPath);
	const client = createMessageConnection(
		new StreamMessageReader(socket),
		new StreamMessageWriter(socket),
	);
	const methods: string[] = [];
	const completed: SessionCompletedParams[] = [];
	const errors: SessionErrorParams[] = [];
	const results: SessionResultsParams[] = [];
	client.onNotification(SessionPhaseNotification, (params) => {
		methods.push(`session.phase:${params.phase}`);
	});
	client.onNotification(SessionPreviewNotification, (params) => {
		void params;
		methods.push('session.preview');
	});
	client.onNotification(SessionResultsNotification, (params) => {
		methods.push('session.results');
		results.push(params);
	});
	client.onNotification(SessionCompletedNotification, (params) => {
		methods.push('session.completed');
		completed.push(params);
	});
	client.onNotification(SessionErrorNotification, (params) => {
		methods.push('session.error');
		errors.push(params);
	});
	client.listen();
	const initialization = await client.sendRequest(InitializeRequest, {
		protocolVersion: 1,
		clientInfo: { name: 'openai-daemon-test', version: '0.0.0' },
	});
	const context = {
		directory,
		runtime,
		socket,
		client,
		methods,
		completed,
		errors,
		results,
		initialization,
	};
	contexts.push(context);
	return context;
}

/** 启动并结束一次录音，使批量 Provider 开始 HTTP 转写。 */
async function finishRecording(context: DaemonTestContext): Promise<string> {
	const { sessionId } = await context.client.sendRequest(SessionStartRequest, {
		inputContextId: 'input-context-1',
	});
	await vi.waitFor(() => expect(context.methods).toContain('session.phase:recording'));
	await expect(
		context.client.sendRequest(SessionFinishRequest, { sessionId }),
	).resolves.toBeNull();
	return sessionId;
}

afterEach(async () => {
	for (const context of contexts.splice(0)) {
		context.client.dispose();
		context.socket.destroy();
		await context.runtime.stop();
		await rm(context.directory, { recursive: true, force: true });
	}
	for (const api of apis.splice(0)) await api.dispose();
});

describe('OpenAI-compatible daemon contract', () => {
	it('publishes one transcript result and completes when polish is disabled', async () => {
		const api = await createFakeTranscriptionApi();
		const context = await createDaemonTestContext(api);

		expect(context.initialization.capabilities.partialTranscript).toBe(false);
		await finishRecording(context);
		await api.requestReceived;
		expect(context.completed).toHaveLength(0);
		expect(context.results).toHaveLength(0);

		api.respond({ status: 200, body: { text: 'daemon 识别完成' } });
		await vi.waitFor(() => expect(context.results).toHaveLength(1));

		expect(context.results[0].transcript.text).toBe('daemon 识别完成');
		await vi.waitFor(() => expect(context.completed).toHaveLength(1));
		expect(context.completed[0].text).toBe('daemon 识别完成');
		expect(context.methods.filter((method) => method === 'session.preview')).toHaveLength(0);
		expect(context.methods.slice(-2)).toEqual(['session.results', 'session.completed']);
	});

	it('cancels an in-flight batch request without publishing a result', async () => {
		const api = await createFakeTranscriptionApi();
		const context = await createDaemonTestContext(api);
		const sessionId = await finishRecording(context);
		await api.requestReceived;

		await expect(
			context.client.sendRequest(SessionCancelRequest, { sessionId, reason: 'user' }),
		).resolves.toBeNull();
		await api.responseClosed;
		api.respond({ status: 200, body: { text: '不应提交' } });
		await delay(25);

		expect(context.results).toHaveLength(0);
		expect(context.completed).toHaveLength(0);
		expect(context.errors).toHaveLength(0);
	});

	it('maps an empty provider result to a stable session error', async () => {
		const api = await createFakeTranscriptionApi();
		const context = await createDaemonTestContext(api);
		await finishRecording(context);
		await api.requestReceived;

		api.respond({ status: 200, body: { text: '' } });
		await vi.waitFor(() => expect(context.errors).toHaveLength(1));

		expect(context.errors[0].error).toEqual({
			code: 'ASR_FAILED',
			stage: 'asr',
			retryable: false,
			providerCode: 'INVALID_RESPONSE',
		});
		expect(context.completed).toHaveLength(0);
	});
});
