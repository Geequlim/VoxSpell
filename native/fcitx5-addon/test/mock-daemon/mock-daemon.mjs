import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';

const protocolVersion = 1;
const previewSnapshots = [
	'今天下午三点开会',
	'今天下午三点我们开会',
	'今天下午三点我们开会讨论方案',
];
const transcriptText = '今天下午三点我们开会讨论方案。';
const polishedSnapshots = [
	'今天下午三点，',
	'今天下午三点，我们将召开会议，',
	'今天下午三点，我们将召开会议讨论方案。',
];

function readOption(name, fallback) {
	const prefix = `--${name}=`;
	const argument = process.argv.find((value) => value.startsWith(prefix));
	return argument?.slice(prefix.length) ?? fallback;
}

function readNumberOption(name, fallback) {
	const value = Number(readOption(name, fallback));
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`${name} must be a non-negative integer`);
	}
	return value;
}

const mode = readOption('mode', 'realtime');
if (!['realtime', 'batch', 'polish'].includes(mode)) {
	throw new Error('mode must be realtime, batch, or polish');
}
const firstDelayMs = readNumberOption('first-delay-ms', 2000);
const intervalMs = readNumberOption('interval-ms', 2000);
const phaseDelayMs = readNumberOption('phase-delay-ms', 2000);
const prepareDelayMs = readNumberOption('prepare-delay-ms', 2000);
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

	function reject(request, message) {
		send({
			jsonrpc: '2.0',
			error: { code: -32600, message },
			id: request.id,
		});
	}

	function notify(method, params) {
		send({ jsonrpc: '2.0', method, params });
	}

	function schedule(callback, delay) {
		const timer = setTimeout(() => {
			session?.timers.delete(timer);
			callback();
		}, delay);
		session?.timers.add(timer);
	}

	function clearTimers() {
		for (const timer of session?.timers ?? []) clearTimeout(timer);
		session?.timers.clear();
	}

	function emitPreview(index = 0) {
		if (!session || session.finishing || index >= previewSnapshots.length) return;
		notify('session.preview', {
			sessionId: session.id,
			text: previewSnapshots[index],
		});
		schedule(() => emitPreview(index + 1), intervalMs);
	}

	function complete(choiceId, text) {
		if (!session) return;
		const sessionId = session.id;
		clearTimers();
		session = undefined;
		notify('session.completed', {
			sessionId,
			selectedChoiceId: choiceId,
			text,
		});
	}

	function publishTranscriptAndComplete() {
		if (!session) return;
		notify('session.phase', { sessionId: session.id, phase: 'processing' });
		notify('session.results', {
			sessionId: session.id,
			transcript: { text: transcriptText, status: 'final' },
			recommendedChoiceId: 'transcript',
		});
		schedule(() => complete('transcript', transcriptText), phaseDelayMs);
	}

	function emitPolished(index = 0) {
		if (!session || index >= polishedSnapshots.length) return;
		const final = index === polishedSnapshots.length - 1;
		notify('session.results', {
			sessionId: session.id,
			transcript: { text: transcriptText, status: 'final' },
			polished: {
				text: polishedSnapshots[index],
				status: final ? 'final' : 'streaming',
			},
			...(final ? { recommendedChoiceId: 'polished' } : {}),
		});
		if (final) {
			session.choosingAt = Date.now();
			notify('session.phase', { sessionId: session.id, phase: 'choosing' });
		} else {
			schedule(() => emitPolished(index + 1), intervalMs);
		}
	}

	function publishTranscriptAndPolish() {
		if (!session) return;
		notify('session.phase', { sessionId: session.id, phase: 'processing' });
		notify('session.results', {
			sessionId: session.id,
			transcript: { text: transcriptText, status: 'final' },
		});
		schedule(() => {
			if (!session) return;
			notify('session.phase', { sessionId: session.id, phase: 'polishing' });
			schedule(emitPolished, phaseDelayMs);
		}, phaseDelayMs);
	}

	function finishSession() {
		if (!session || session.finishing) return;
		session.finishing = true;
		clearTimers();
		const delay = Math.max(0, session.recordingAt + phaseDelayMs - Date.now());
		schedule(() => {
			if (!session) return;
			notify('session.phase', { sessionId: session.id, phase: 'recognizing' });
			if (mode === 'polish') {
				schedule(publishTranscriptAndPolish, phaseDelayMs);
				return;
			}
			schedule(publishTranscriptAndComplete, phaseDelayMs);
		}, delay);
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
				const capabilities = {
					partialTranscript: mode !== 'batch',
					polishPreview: mode === 'polish',
				};
				respond(request, { protocolVersion, serverInfo, capabilities });
				notify('daemon.ready', { serverInfo, capabilities });
				return;
			}
			case 'session.start': {
				if (!initialized || session) {
					reject(request, 'Session cannot be started');
					return;
				}
				const id = randomUUID();
				session = {
					id,
					finishing: false,
					started: false,
					startRequest: request,
					timers: new Set(),
				};
				notify('session.phase', { sessionId: id, phase: 'preparing' });
				schedule(() => {
					if (!session || session.id !== id) return;
					session.started = true;
					session.recordingAt = Date.now();
					respond(request, { sessionId: id });
					notify('session.phase', { sessionId: id, phase: 'recording' });
					if (mode !== 'batch') {
						schedule(emitPreview, firstDelayMs);
					}
				}, prepareDelayMs);
				return;
			}
			case 'session.finish':
				respond(request, null);
				if (request.params?.sessionId === session?.id) finishSession();
				return;
			case 'session.selectResult': {
				respond(request, null);
				if (request.params?.sessionId !== session?.id) return;
				const choiceId = request.params.choiceId;
				const text = choiceId === 'polished' ? polishedSnapshots.at(-1) : transcriptText;
				const delay = session.choosingAt
					? Math.max(0, session.choosingAt + phaseDelayMs - Date.now())
					: 100;
				clearTimers();
				schedule(() => complete(choiceId, text), delay);
				return;
			}
			case 'session.cancel':
				respond(request, null);
				if (request.params?.sessionId === session?.id) {
					if (!session.started) {
						reject(session.startRequest, 'Session was cancelled while preparing');
					}
					clearTimers();
					session = undefined;
				}
				return;
			default:
				send({
					jsonrpc: '2.0',
					error: { code: -32601, message: 'Method not found' },
					id: request.id,
				});
		}
	}

	socket.on('data', createParser(handleMessage));
	socket.on('close', clearTimers);
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
		`[voxspell-mock] mode=${mode}, prepare delay=${prepareDelayMs}ms, phase delay=${phaseDelayMs}ms, first delay=${firstDelayMs}ms, interval=${intervalMs}ms`,
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
