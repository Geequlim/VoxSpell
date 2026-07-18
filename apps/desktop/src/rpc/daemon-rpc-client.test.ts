import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
	StreamMessageReader,
	StreamMessageWriter,
	createMessageConnection,
} from 'vscode-jsonrpc/node';

import { DaemonRpcClient, DaemonRpcTimeoutError } from './daemon-rpc-client';

import type { Server, Socket } from 'node:net';
import type { MessageConnection } from 'vscode-jsonrpc/node';

interface TestServer {
	readonly directory: string;
	readonly socketPath: string;
	readonly server: Server;
	readonly sockets: Socket[];
	readonly connections: MessageConnection[];
}

const testServers: TestServer[] = [];

async function createTestServer(
	register: (connection: MessageConnection) => void,
): Promise<TestServer> {
	const directory = await mkdtemp(path.join(tmpdir(), 'voxspell-desktop-'));
	const socketPath = path.join(directory, 'daemon.sock');
	const sockets: Socket[] = [];
	const connections: MessageConnection[] = [];
	const server = createServer((socket) => {
		sockets.push(socket);
		const connection = createMessageConnection(
			new StreamMessageReader(socket),
			new StreamMessageWriter(socket),
		);
		connections.push(connection);
		register(connection);
		connection.listen();
	});
	const testServer = { directory, socketPath, server, sockets, connections };
	testServers.push(testServer);
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(socketPath, resolve);
	});
	return testServer;
}

afterEach(async () => {
	for (const testServer of testServers.splice(0)) {
		testServer.connections.forEach((connection) => connection.dispose());
		testServer.sockets.forEach((socket) => socket.destroy());
		await new Promise<void>((resolve) => testServer.server.close(() => resolve()));
		await rm(testServer.directory, { recursive: true, force: true });
	}
});

describe('DaemonRpcClient', () => {
	it('initializes and reads health and configuration status', async () => {
		const testServer = await createTestServer((connection) => {
			connection.onRequest('initialize', () => ({
				protocolVersion: 1,
				serverInfo: { name: 'test-daemon', version: '1.2.3' },
				capabilities: { partialTranscript: true, polishPreview: false },
			}));
			connection.onRequest('daemon.ping', () => ({ timestampMs: 42 }));
			connection.onRequest('daemon.getStatus', () => ({
				state: 'ready',
				configPath: '/tmp/config.yaml',
				credentialsPath: '/tmp/credentials',
				missingCredentialNames: [],
			}));
		});
		const client = new DaemonRpcClient({ socketPath: testServer.socketPath });

		await expect(client.connect()).resolves.toMatchObject({
			serverInfo: { name: 'test-daemon' },
		});
		await expect(client.ping()).resolves.toEqual({ timestampMs: 42 });
		await expect(client.getStatus()).resolves.toMatchObject({ state: 'ready' });
		client.dispose();
	});

	it('rejects an incompatible initialize response at the protocol boundary', async () => {
		const testServer = await createTestServer((connection) => {
			connection.onRequest('initialize', () => ({
				protocolVersion: 2,
				serverInfo: { name: 'future-daemon', version: '2.0.0' },
				capabilities: { partialTranscript: true, polishPreview: true },
			}));
		});
		const client = new DaemonRpcClient({ socketPath: testServer.socketPath });

		await expect(client.connect()).rejects.toMatchObject({
			name: 'ProtocolValidationError',
		});
		client.dispose();
	});

	it('times out an initialize request that never completes', async () => {
		const testServer = await createTestServer((connection) => {
			connection.onRequest('initialize', () => new Promise(() => undefined));
		});
		const client = new DaemonRpcClient({
			socketPath: testServer.socketPath,
			requestTimeoutMs: 20,
		});

		await expect(client.connect()).rejects.toBeInstanceOf(DaemonRpcTimeoutError);
		client.dispose();
	});
});
