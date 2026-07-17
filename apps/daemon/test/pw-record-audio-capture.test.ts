import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
	PwRecordAudioCaptureBackend,
	PwRecordCaptureError,
} from '../src/audio/pw-record-audio-capture.js';

import type { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';

class FakeRecorderProcess extends EventEmitter {
	readonly stdin = new PassThrough();
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	readonly kill = vi.fn((signal: NodeJS.Signals | number = 'SIGTERM') => {
		this.stdout.end();
		queueMicrotask(() => this.emit('close', null, signal));
		return true;
	});
}

/** 将 fake process 适配到 Node spawn 边界。 */
function createSpawnRecorder(process: FakeRecorderProcess): typeof spawn {
	return vi.fn(
		() => process as unknown as ChildProcessWithoutNullStreams,
	) as unknown as typeof spawn;
}

describe('PwRecordAudioCaptureBackend', () => {
	it('spawns pw-record with the required raw PCM format and streams stdout only', async () => {
		const process = new FakeRecorderProcess();
		const spawnRecorder = createSpawnRecorder(process);
		const session = new PwRecordAudioCaptureBackend(spawnRecorder).createSession();
		const started = session.start(new AbortController().signal);
		process.emit('spawn');
		await started;
		const frames = session.frames()[Symbol.asyncIterator]();
		process.stderr.write('diagnostic output');
		process.stdout.write(Buffer.from([1, 2, 3]));

		await expect(frames.next()).resolves.toMatchObject({
			done: false,
			value: Buffer.from([1, 2, 3]),
		});
		await session.stop();
		await expect(frames.next()).resolves.toEqual({ done: true, value: undefined });
		expect(spawnRecorder).toHaveBeenCalledWith('pw-record', [
			'--raw',
			'--rate',
			'16000',
			'--channels',
			'1',
			'--format',
			's16',
			'-',
		]);
		expect(process.kill).toHaveBeenCalledWith('SIGINT');
	});

	it('reports startup errors with a stable capture error', async () => {
		const process = new FakeRecorderProcess();
		const session = new PwRecordAudioCaptureBackend(
			createSpawnRecorder(process),
		).createSession();
		const started = session.start(new AbortController().signal);
		process.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' }));

		await expect(started).rejects.toBeInstanceOf(PwRecordCaptureError);
	});

	it('reports an unexpected process exit and keeps stderr out of audio frames', async () => {
		const process = new FakeRecorderProcess();
		const session = new PwRecordAudioCaptureBackend(
			createSpawnRecorder(process),
		).createSession();
		const started = session.start(new AbortController().signal);
		process.emit('spawn');
		await started;
		const frames = session.frames()[Symbol.asyncIterator]();
		process.stderr.end('device unavailable');
		process.stdout.end();
		process.emit('close', 1, null);

		await expect(frames.next()).rejects.toThrow('device unavailable');
	});

	it('cancels capture when its AbortSignal fires', async () => {
		const process = new FakeRecorderProcess();
		const controller = new AbortController();
		const session = new PwRecordAudioCaptureBackend(
			createSpawnRecorder(process),
		).createSession();
		const started = session.start(controller.signal);
		process.emit('spawn');
		await started;

		controller.abort();
		await vi.waitFor(() => expect(process.kill).toHaveBeenCalledWith('SIGTERM'));
	});
});
