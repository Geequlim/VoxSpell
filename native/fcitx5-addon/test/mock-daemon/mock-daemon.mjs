import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';

const protocolVersion = 1;
const defaultFirstPartialDelayMs = 1500;
const defaultPartialIntervalMs = 350;
const chunks = ['你好，', '这是来自', '测试 daemon ', '的实时识别', '结果', '。'];

function readNumberOption(name, fallback) {
	const argumentPrefix = `--${name}=`;
	const argument = process.argv.find((value) => value.startsWith(argumentPrefix));
	const rawValue = argument?.slice(argumentPrefix.length);
	if (rawValue === undefined) return fallback;
	const value = Number(rawValue);
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`${name} must be a non-negative integer`);
	}
	return value;
}

const firstPartialDelayMs = readNumberOption(
	'first-partial-delay-ms',
	defaultFirstPartialDelayMs,
);
const partialIntervalMs = readNumberOption('partial-interval-ms', defaultPartialIntervalMs);
const runtimeDirectory = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid()}`;
const socketPath = process.env.VOXSPELL_SOCKET_PATH ?? join(runtimeDirectory, 'voxspell', 'daemon.sock');

function frame(message) {
	const content = JSON.stringify(message);
	return `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n${content}`;
}

function createParser(onMessage) {
	let buffer = Buffer.alloc(0);
	let contentLength;

	return (chunk) => {
		buffer = Buffer.concat([buffer, chunk]);
		while (true) {
			if (contentLength === undefined) {
				const separator = buffer.indexOf('\r\n\r\n');
				if (separator < 0) return;
				const headers = buffer.subarray(0, separator).toString('ascii');
				const match = /^Content-Length:\s*(\d+)$/im.exec(headers);
				if (!match) throw new Error('Missing Content-Length header');
				contentLength = Number(match[1]);
				buffer = buffer.subarray(separator + 4);
			}
			if (buffer.length < contentLength) return;
			const content = buffer.subarray(0, contentLength).toString('utf8');
			buffer = buffer.subarray(contentLength);
			contentLength = undefined;
			onMessage(JSON.parse(content));
		}
	};
}

function createConnection(socket) {
	let initialized = false;
	let session;

	function send(message) {
		if (!socket.destroyed) socket.write(frame(message));
	}

	function respond(request, result) {
		send({ jsonrpc: '2.0', result, id: request.id });
	}

	function notify(method, params) {
		send({ jsonrpc: '2.0', method, params });
	}

	function clearSessionTimer() {
		if (!session?.timer) return;
		clearTimeout(session.timer);
		session.timer = undefined;
	}

	function emitPartial() {
		if (!session || session.finishing || session.chunkIndex >= chunks.length) return;
		session.text += chunks[session.chunkIndex];
		session.chunkIndex += 1;
		notify('transcript.partial', {
			sessionId: session.id,
			segmentId: 'mock-segment-1',
			revision: session.chunkIndex,
			text: session.text,
		});
		if (session.chunkIndex < chunks.length) {
			session.timer = setTimeout(emitPartial, partialIntervalMs);
		}
	}

	function completeSession() {
		if (!session) return;
		const completedSession = session;
		session = undefined;
		const text = chunks.join('');
		notify('transcript.final', { sessionId: completedSession.id, text });
		setTimeout(() => {
			notify('session.completed', { sessionId: completedSession.id, text });
		}, 250);
	}

	function handleMessage(request) {
		switch (request.method) {
			case 'initialize': {
				if (request.params?.protocolVersion !== protocolVersion) {
					send({
						jsonrpc: '2.0',
						error: { code: -32602, message: 'Unsupported protocol version' },
						id: request.id,
					});
					return;
				}
				initialized = true;
				const serverInfo = { name: 'voxspell-mock-daemon', version: '0.1.0' };
				const capabilities = { partialTranscript: true, polishPreview: false };
				respond(request, { protocolVersion, serverInfo, capabilities });
				notify('daemon.ready', { serverInfo, capabilities });
				return;
			}
			case 'session.start': {
				if (!initialized || session) {
					send({
						jsonrpc: '2.0',
						error: { code: -32600, message: 'Session cannot be started' },
						id: request.id,
					});
					return;
				}
				const id = randomUUID();
				session = {
					id,
					text: '',
					chunkIndex: 0,
					finishing: false,
					firstPartialAt: Date.now() + firstPartialDelayMs,
					timer: setTimeout(emitPartial, firstPartialDelayMs),
				};
				respond(request, { sessionId: id });
				notify('session.recording', { sessionId: id });
				return;
			}
			case 'session.finish': {
				respond(request, null);
				if (!session || request.params?.sessionId !== session.id || session.finishing) return;
				session.finishing = true;
				clearSessionTimer();
				const delay =
					session.chunkIndex === 0
						? Math.max(0, session.firstPartialAt - Date.now())
						: Math.min(250, partialIntervalMs);
				session.timer = setTimeout(completeSession, delay);
				return;
			}
			case 'session.cancel': {
				respond(request, null);
				if (session && request.params?.sessionId === session.id) {
					clearSessionTimer();
					session = undefined;
				}
				return;
			}
			default:
				send({
					jsonrpc: '2.0',
					error: { code: -32601, message: 'Method not found' },
					id: request.id,
				});
		}
	}

	socket.on('data', createParser(handleMessage));
	socket.on('close', clearSessionTimer);
	socket.on('error', () => {});
}

await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });

const server = createServer(createConnection);
server.on('error', (error) => {
	console.error(`[voxspell-mock] ${error.message}`);
	process.exitCode = 1;
});
server.listen(socketPath, () => {
	console.log(`[voxspell-mock] listening on ${socketPath}`);
	console.log(
		`[voxspell-mock] first partial delay=${firstPartialDelayMs}ms, interval=${partialIntervalMs}ms`,
	);
});

async function shutdown() {
	server.close();
	await rm(socketPath, { force: true });
}

process.once('SIGINT', async () => {
	await shutdown();
	process.exit(0);
});
process.once('SIGTERM', async () => {
	await shutdown();
	process.exit(0);
});
