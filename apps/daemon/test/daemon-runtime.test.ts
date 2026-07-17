import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DaemonReadyNotification } from '@voxspell/protocol/daemon';
import { InitializeRequest } from '@voxspell/protocol/initialize';
import {
	SessionCompletedNotification,
	SessionFinishRequest,
	SessionRecordingNotification,
	SessionStartRequest,
} from '@voxspell/protocol/session';
import {
	AsrReadyNotification,
	TranscriptFinalNotification,
	TranscriptPartialNotification,
} from '@voxspell/protocol/transcript';
import {
	StreamMessageReader,
	StreamMessageWriter,
	createMessageConnection,
} from 'vscode-jsonrpc/node';

import {
	DaemonRuntime,
	DaemonRuntimeConfigurationError,
	resolveDaemonSocketPath,
} from '../src/runtime/create-daemon.js';
import { MessageTooLargeError } from '../src/transport/content-length-limit.js';

import type { Socket } from 'node:net';

interface TestRuntime {
	readonly directory: string;
	readonly runtime: DaemonRuntime;
}

const testRuntimes: TestRuntime[] = [];

/** 创建使用临时 Unix Socket 的 daemon。 */
async function createTestRuntime(
	options: {
		readonly fakeText?: string;
		readonly maximumContentLength?: number;
		readonly onError?: (error: Error) => void;
	} = {},
): Promise<TestRuntime> {
	const directory = await mkdtemp(path.join(tmpdir(), 'voxspell-runtime-'));
	const runtime = new DaemonRuntime({
		socketPath: path.join(directory, 'voxspell', 'daemon.sock'),
		...options,
	});
	const testRuntime = { directory, runtime };
	testRuntimes.push(testRuntime);
	await runtime.start();
	return testRuntime;
}

/** 连接 daemon Unix Socket。 */
async function connect(socketPath: string): Promise<Socket> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(socketPath);
		socket.once('connect', () => resolve(socket));
		socket.once('error', reject);
	});
}

afterEach(async () => {
	for (const testRuntime of testRuntimes.splice(0)) {
		await testRuntime.runtime.stop();
		await rm(testRuntime.directory, { recursive: true, force: true });
	}
});

describe('DaemonRuntime', () => {
	it('runs a complete deterministic session over a real Unix Socket', async () => {
		const { runtime } = await createTestRuntime({ fakeText: '固定识别结果' });
		const socket = await connect(runtime.socketPath);
		const client = createMessageConnection(
			new StreamMessageReader(socket),
			new StreamMessageWriter(socket),
		);
		const methods: string[] = [];
		let partialText: string | undefined;
		let finalText: string | undefined;
		client.onNotification(DaemonReadyNotification, () => {
			methods.push('daemon.ready');
		});
		client.onNotification(SessionRecordingNotification, () => {
			methods.push('session.recording');
		});
		client.onNotification(AsrReadyNotification, () => {
			methods.push('asr.ready');
		});
		client.onNotification(TranscriptPartialNotification, (params) => {
			methods.push('transcript.partial');
			partialText = params.text;
		});
		client.onNotification(TranscriptFinalNotification, (params) => {
			methods.push('transcript.final');
			finalText = params.text;
		});
		client.onNotification(SessionCompletedNotification, () => {
			methods.push('session.completed');
		});
		client.listen();

		await client.sendRequest(InitializeRequest, {
			protocolVersion: 1,
			clientInfo: { name: 'runtime-test', version: '0.0.0' },
		});
		const { sessionId } = await client.sendRequest(SessionStartRequest, {
			inputContextId: 'input-context-1',
		});
		await vi.waitFor(() => expect(partialText).toBe('固定识别结果'));
		await client.sendRequest(SessionFinishRequest, { sessionId });
		await vi.waitFor(() => expect(finalText).toBe('固定识别结果'));
		await vi.waitFor(() => expect(methods).toContain('session.completed'));

		expect(methods).toEqual([
			'daemon.ready',
			'session.recording',
			'asr.ready',
			'transcript.partial',
			'transcript.final',
			'session.completed',
		]);
		client.dispose();
		socket.destroy();
		await runtime.stop();
		await expect(lstat(runtime.socketPath)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('closes a connection that declares an oversized message', async () => {
		const errors: Error[] = [];
		const { runtime } = await createTestRuntime({
			maximumContentLength: 16,
			onError: (error) => errors.push(error),
		});
		const socket = await connect(runtime.socketPath);
		const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));

		socket.write('Content-Length: 17\r\n\r\n');

		await closed;
		expect(errors.some((error) => error instanceof MessageTooLargeError)).toBe(true);
	});
});

describe('resolveDaemonSocketPath', () => {
	it('uses XDG_RUNTIME_DIR and refuses an unsafe fallback', () => {
		expect(resolveDaemonSocketPath({ XDG_RUNTIME_DIR: '/run/user/1000' })).toBe(
			'/run/user/1000/voxspell/daemon.sock',
		);
		expect(() => resolveDaemonSocketPath({})).toThrow(DaemonRuntimeConfigurationError);
	});
});
