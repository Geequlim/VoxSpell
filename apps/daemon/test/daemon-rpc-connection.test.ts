import { afterEach, describe, expect, it, vi } from 'vitest';

import { DaemonPingRequest, DaemonReadyNotification } from '@voxspell/protocol/daemon';
import { DAEMON_ERROR_CODE } from '@voxspell/protocol/errors';
import { InitializeRequest } from '@voxspell/protocol/initialize';
import {
	SessionCancelRequest,
	SessionCompletedNotification,
	SessionErrorNotification,
	SessionFinishRequest,
	SessionPhaseNotification,
	SessionPreviewNotification,
	SessionResultsNotification,
	SessionSelectResultRequest,
	SessionStartRequest,
} from '@voxspell/protocol/session';
import { ErrorCodes } from 'vscode-jsonrpc/node';

import { DaemonRpcConnection } from '../src/rpc/daemon-rpc-connection.js';
import { SessionCoordinator } from '../src/session-coordinator.js';
import { FakeAudioCaptureBackend } from './fakes/fake-audio-capture.js';
import { createInMemoryRpcPair } from './fakes/in-memory-rpc.js';
import { FakeRealtimeAsrProvider } from './fakes/fake-realtime-asr.js';
import { FakeTextPolisher } from './fakes/fake-text-polisher.js';

import type { TextPolisher } from '@voxspell/ai-polisher/text-polisher';
import type { DaemonReadyParams } from '@voxspell/protocol/daemon';
import type {
	SessionCompletedParams,
	SessionErrorParams,
	SessionPhaseParams,
	SessionPreviewParams,
	SessionResultsParams,
} from '@voxspell/protocol/session';
import type { InMemoryRpcPair } from './fakes/in-memory-rpc.js';

const SESSION_ID = '0190c95b-7f28-7b12-8b6f-a4d3fd239013';

interface ReceivedNotification {
	readonly method: string;
	readonly params: unknown;
}

interface RpcTestContext {
	readonly pair: InMemoryRpcPair;
	readonly server: DaemonRpcConnection;
	readonly captureBackend: FakeAudioCaptureBackend;
	readonly asrProvider: FakeRealtimeAsrProvider;
	readonly notifications: ReceivedNotification[];
	readonly reloadConfig: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

const contexts: RpcTestContext[] = [];

interface TestContextOptions {
	readonly fragmentSize?: number;
	readonly textPolisher?: TextPolisher;
}

/** 创建已监听但尚未 initialize 的 daemon RPC 测试环境。 */
function createTestContext(options: TestContextOptions = { fragmentSize: 3 }): RpcTestContext {
	const pair = createInMemoryRpcPair(options.fragmentSize);
	const captureBackend = new FakeAudioCaptureBackend();
	const asrProvider = new FakeRealtimeAsrProvider();
	const notifications: ReceivedNotification[] = [];
	const reloadConfig = vi.fn(async () => undefined);
	const server = new DaemonRpcConnection({
		connection: pair.server,
		serverInfo: { name: 'voxspell-daemon', version: '0.0.0' },
		capabilities: { partialTranscript: true, polishPreview: false },
		reloadConfig,
		now: () => 123_456,
		createSessionCoordinator: (publish) =>
			new SessionCoordinator({
				captureBackend,
				asrProvider,
				textPolisher: options.textPolisher,
				publish,
				createSessionId: () => SESSION_ID,
			}),
	});

	pair.client.onNotification(DaemonReadyNotification, (params: DaemonReadyParams) => {
		notifications.push({ method: DaemonReadyNotification.method, params });
	});
	pair.client.onNotification(SessionPhaseNotification, (params: SessionPhaseParams) => {
		notifications.push({ method: SessionPhaseNotification.method, params });
	});
	pair.client.onNotification(SessionPreviewNotification, (params: SessionPreviewParams) => {
		notifications.push({ method: SessionPreviewNotification.method, params });
	});
	pair.client.onNotification(SessionResultsNotification, (params: SessionResultsParams) => {
		notifications.push({ method: SessionResultsNotification.method, params });
	});
	pair.client.onNotification(SessionCompletedNotification, (params: SessionCompletedParams) => {
		notifications.push({ method: SessionCompletedNotification.method, params });
	});
	pair.client.onNotification(SessionErrorNotification, (params: SessionErrorParams) => {
		notifications.push({ method: SessionErrorNotification.method, params });
	});

	server.listen();
	pair.client.listen();
	const context = {
		pair,
		server,
		captureBackend,
		asrProvider,
		notifications,
		reloadConfig,
	};
	contexts.push(context);
	return context;
}

/** 将 JSON-RPC 测试消息编码成 LSP Content-Length 帧。 */
function encodeMessage(message: object): Buffer {
	const content = Buffer.from(JSON.stringify(message));
	return Buffer.concat([Buffer.from(`Content-Length: ${content.byteLength}\r\n\r\n`), content]);
}

/** 完成客户端初始化握手。 */
async function initialize(context: RpcTestContext): Promise<void> {
	await context.pair.client.sendRequest(InitializeRequest, {
		protocolVersion: 1,
		clientInfo: { name: 'fake-client', version: '0.0.0' },
	});
}

afterEach(async () => {
	for (const context of contexts.splice(0)) {
		await context.server.dispose();
		context.pair.dispose();
	}
});

describe('DaemonRpcConnection', () => {
	it('initializes the connection and announces daemon readiness', async () => {
		const context = createTestContext();

		const result = await context.pair.client.sendRequest(InitializeRequest, {
			protocolVersion: 1,
			clientInfo: { name: 'fake-client', version: '0.0.0' },
		});

		expect(result).toEqual({
			protocolVersion: 1,
			serverInfo: { name: 'voxspell-daemon', version: '0.0.0' },
			capabilities: { partialTranscript: true, polishPreview: false },
		});
		await vi.waitFor(() => {
			expect(context.notifications[0]).toEqual({
				method: 'daemon.ready',
				params: {
					serverInfo: { name: 'voxspell-daemon', version: '0.0.0' },
					capabilities: { partialTranscript: true, polishPreview: false },
				},
			});
		});
	});

	it('rejects business requests before initialize', async () => {
		const context = createTestContext();

		await expect(context.pair.client.sendRequest(DaemonPingRequest, {})).rejects.toMatchObject({
			code: ErrorCodes.ServerNotInitialized,
		});
	});

	it('rejects an unsupported protocol version with a stable business error', async () => {
		const context = createTestContext();

		await expect(
			context.pair.client.sendRequest('initialize', {
				protocolVersion: 2,
				clientInfo: { name: 'fake-client', version: '0.0.0' },
			}),
		).rejects.toMatchObject({
			code: DAEMON_ERROR_CODE,
			data: { code: 'PROTOCOL_VERSION_UNSUPPORTED', stage: 'protocol' },
		});
	});

	it('rejects invalid params and a duplicate initialize request', async () => {
		const context = createTestContext();
		await initialize(context);

		await expect(
			context.pair.client.sendRequest('session.start', {
				inputContextId: '',
				unexpected: true,
			}),
		).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
		await expect(
			context.pair.client.sendRequest(InitializeRequest, {
				protocolVersion: 1,
				clientInfo: { name: 'fake-client', version: '0.0.0' },
			}),
		).rejects.toMatchObject({ code: ErrorCodes.InvalidRequest });
	});

	it('handles ping, config reload, and unknown methods', async () => {
		const context = createTestContext();
		await initialize(context);

		await expect(context.pair.client.sendRequest(DaemonPingRequest, {})).resolves.toEqual({
			timestampMs: 123_456,
		});
		await expect(context.pair.client.sendRequest('config.reload', {})).resolves.toBeNull();
		expect(context.reloadConfig).toHaveBeenCalledOnce();
		await expect(context.pair.client.sendRequest('unknown.method', {})).rejects.toMatchObject({
			code: ErrorCodes.MethodNotFound,
		});
	});

	it('accepts consecutive frames delivered in one stream write', async () => {
		const context = createTestContext({});
		await initialize(context);
		context.reloadConfig.mockClear();

		context.pair.clientToServer.write(
			Buffer.concat([
				encodeMessage({
					jsonrpc: '2.0',
					id: 900,
					method: 'config.reload',
					params: {},
				}),
				encodeMessage({
					jsonrpc: '2.0',
					id: 901,
					method: 'config.reload',
					params: {},
				}),
			]),
		);

		await vi.waitFor(() => expect(context.reloadConfig).toHaveBeenCalledTimes(2));
	});

	it('runs a complete fake session over JSON-RPC', async () => {
		const context = createTestContext();
		await initialize(context);

		await expect(
			context.pair.client.sendRequest(SessionStartRequest, {
				inputContextId: 'input-context-1',
			}),
		).resolves.toEqual({ sessionId: SESSION_ID });
		await vi.waitFor(() => {
			expect(context.notifications.map((notification) => notification.method)).toContain(
				'session.phase',
			);
		});

		const capture = context.captureBackend.sessions[0];
		const asr = context.asrProvider.sessions[0];
		capture.pushFrame(Uint8Array.from([1, 2, 3]));
		asr.emit({ type: 'ready' });
		asr.emit({
			type: 'partial',
			segmentId: 'segment-1',
			revision: 0,
			text: '你好',
		});
		asr.emit({ type: 'segment-final', segmentId: 'segment-1', text: '你好' });

		await vi.waitFor(() => expect(asr.audioFrames).toHaveLength(1));
		await expect(
			context.pair.client.sendRequest(SessionFinishRequest, { sessionId: SESSION_ID }),
		).resolves.toBeNull();
		asr.emit({ type: 'completed', text: '你好，世界。' });
		await vi.waitFor(() => {
			expect(context.notifications.map((notification) => notification.method)).toEqual([
				'daemon.ready',
				'session.phase',
				'session.phase',
				'session.preview',
				'session.phase',
				'session.phase',
				'session.results',
				'session.completed',
			]);
		});
	});

	it('publishes polished snapshots and completes the client-selected result', async () => {
		const polisher = new FakeTextPolisher();
		const context = createTestContext({ textPolisher: polisher });
		await initialize(context);
		await context.pair.client.sendRequest(SessionStartRequest, {
			inputContextId: 'input-context-1',
		});
		await context.pair.client.sendRequest(SessionFinishRequest, { sessionId: SESSION_ID });
		context.asrProvider.sessions[0].emit({ type: 'completed', text: '识别结果' });
		await vi.waitFor(() => expect(polisher.sessions).toHaveLength(1));

		polisher.sessions[0].emit({ type: 'delta', text: '润色' });
		polisher.sessions[0].emit({ type: 'delta', text: '结果' });
		polisher.sessions[0].emit({ type: 'completed' });
		await vi.waitFor(() => {
			expect(context.notifications).toContainEqual({
				method: 'session.results',
				params: {
					sessionId: SESSION_ID,
					transcript: { text: '识别结果', status: 'final' },
					polished: { text: '润色结果', status: 'final' },
					recommendedChoiceId: 'polished',
				},
			});
		});

		await context.pair.client.sendRequest(SessionSelectResultRequest, {
			sessionId: SESSION_ID,
			choiceId: 'polished',
		});
		await vi.waitFor(() => {
			expect(context.notifications.at(-1)).toEqual({
				method: 'session.completed',
				params: {
					sessionId: SESSION_ID,
					selectedChoiceId: 'polished',
					text: '润色结果',
				},
			});
		});
	});

	it('maps coordinator errors to the daemon business error code', async () => {
		const context = createTestContext();
		await initialize(context);
		await context.pair.client.sendRequest(SessionStartRequest, {
			inputContextId: 'input-context-1',
		});

		await expect(
			context.pair.client.sendRequest(SessionStartRequest, {
				inputContextId: 'input-context-2',
			}),
		).rejects.toMatchObject({
			code: DAEMON_ERROR_CODE,
			data: { code: 'SESSION_BUSY', stage: 'session' },
		});
		await context.pair.client.sendRequest(SessionCancelRequest, {
			sessionId: SESSION_ID,
			reason: 'user',
		});
	});

	it('forwards stable Provider errors as a session notification', async () => {
		const context = createTestContext();
		await initialize(context);
		await context.pair.client.sendRequest(SessionStartRequest, {
			inputContextId: 'input-context-1',
		});

		context.asrProvider.sessions[0].emit({
			type: 'error',
			code: 'FAKE_UNAVAILABLE',
			retryable: true,
		});

		await vi.waitFor(() => {
			expect(context.notifications.at(-1)).toEqual({
				method: 'session.error',
				params: {
					sessionId: SESSION_ID,
					error: {
						code: 'ASR_FAILED',
						stage: 'asr',
						retryable: true,
						providerCode: 'FAKE_UNAVAILABLE',
					},
				},
			});
		});
	});

	it('cancels the active session when the client stream closes', async () => {
		const context = createTestContext();
		await initialize(context);
		await context.pair.client.sendRequest(SessionStartRequest, {
			inputContextId: 'input-context-1',
		});

		context.pair.clientToServer.end();

		await vi.waitFor(() => {
			expect(context.captureBackend.sessions[0].cancelCalls).toBe(1);
			expect(context.asrProvider.sessions[0].cancelCalls).toBe(1);
		});
	});
});
