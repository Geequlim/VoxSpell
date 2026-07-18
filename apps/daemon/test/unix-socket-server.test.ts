import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	DaemonAlreadyRunningError,
	UnixSocketServer,
	UnsafeSocketPathError,
} from '../src/transport/unix-socket-server.js';

import type { Socket } from 'node:net';
import type { UnixSocketClient } from '../src/transport/unix-socket-server.js';

const temporaryDirectories: string[] = [];

/** 创建当前测试使用的临时 socket 路径。 */
async function createSocketPath(): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), 'voxspell-socket-'));
	temporaryDirectories.push(directory);
	return path.join(directory, 'runtime', 'voxspell', 'daemon.sock');
}

/** 连接指定 Unix Socket。 */
async function connect(socketPath: string): Promise<Socket> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(socketPath);
		socket.once('connect', () => resolve(socket));
		socket.once('error', reject);
	});
}

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) {
		await rm(directory, { recursive: true, force: true });
	}
});

describe('UnixSocketServer', () => {
	it('creates secure paths, allows multiple clients, and cleans up on stop', async () => {
		const socketPath = await createSocketPath();
		const clients: UnixSocketClient[] = [];
		const dispose = vi.fn(async () => undefined);
		const server = new UnixSocketServer({
			socketPath,
			createClient: () => {
				const client = { dispose };
				clients.push(client);
				return client;
			},
		});

		await server.start();
		const runtimeStats = await lstat(path.dirname(socketPath));
		const socketStats = await lstat(socketPath);
		expect(runtimeStats.mode & 0o777).toBe(0o700);
		expect(socketStats.mode & 0o777).toBe(0o600);

		const firstClient = await connect(socketPath);
		const secondClient = await connect(socketPath);
		await vi.waitFor(() => expect(clients).toHaveLength(2));
		expect(secondClient.destroyed).toBe(false);

		firstClient.destroy();
		await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
		await server.stop();
		expect(dispose).toHaveBeenCalledTimes(2);
		await expect(lstat(socketPath)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('does not replace a non-socket path', async () => {
		const socketPath = await createSocketPath();
		await mkdir(path.dirname(socketPath), { recursive: true });
		await writeFile(socketPath, 'keep-me');
		const server = new UnixSocketServer({
			socketPath,
			createClient: () => ({ dispose: async () => undefined }),
		});

		await expect(server.start()).rejects.toBeInstanceOf(UnsafeSocketPathError);
		await expect(readFile(socketPath, 'utf8')).resolves.toBe('keep-me');
	});

	it('does not replace a socket owned by a running daemon', async () => {
		const socketPath = await createSocketPath();
		const firstServer = new UnixSocketServer({
			socketPath,
			createClient: () => ({ dispose: async () => undefined }),
		});
		const secondServer = new UnixSocketServer({
			socketPath,
			createClient: () => ({ dispose: async () => undefined }),
		});
		await firstServer.start();

		await expect(secondServer.start()).rejects.toBeInstanceOf(DaemonAlreadyRunningError);
		const client = await connect(socketPath);
		client.destroy();
		await firstServer.stop();
	});
});
