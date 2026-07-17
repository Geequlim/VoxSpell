import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AudioCaptureBackend, AudioCaptureSession } from '../audio-capture.js';

const PW_RECORD_ARGUMENTS = ['--raw', '--rate', '16000', '--channels', '1', '--format', 's16', '-'];
const MAXIMUM_STDERR_BYTES = 4_096;
const STOP_GRACE_MILLISECONDS = 1_000;
const CANCEL_GRACE_MILLISECONDS = 250;

type SpawnRecorder = typeof spawn;

/** 表示 pw-record 无法提供有效的麦克风 PCM 流。 */
export class PwRecordCaptureError extends Error {
	constructor(message: string, cause?: unknown) {
		super(message, { cause });
		this.name = 'PwRecordCaptureError';
	}
}

/** 使用 PipeWire pw-record 采集 16 kHz 单声道 S16LE PCM。 */
export class PwRecordAudioCaptureBackend implements AudioCaptureBackend {
	readonly #spawnRecorder: SpawnRecorder;

	constructor(spawnRecorder: SpawnRecorder = spawn) {
		this.#spawnRecorder = spawnRecorder;
	}

	createSession(): AudioCaptureSession {
		return new PwRecordAudioCaptureSession(this.#spawnRecorder);
	}
}

class PwRecordAudioCaptureSession implements AudioCaptureSession {
	readonly #spawnRecorder: SpawnRecorder;
	#process?: ChildProcessWithoutNullStreams;
	#exit?: Promise<void>;
	#exitCode?: number;
	#exitSignal?: NodeJS.Signals;
	#processError?: Error;
	#stderr = '';
	#stopping?: Promise<void>;
	#requestedStop = false;
	#signal?: AbortSignal;
	#abortListener?: () => void;

	constructor(spawnRecorder: SpawnRecorder) {
		this.#spawnRecorder = spawnRecorder;
	}

	async start(signal: AbortSignal): Promise<void> {
		if (signal.aborted)
			throw new PwRecordCaptureError('Audio capture was aborted before start');
		const recorder = this.#spawnRecorder('pw-record', PW_RECORD_ARGUMENTS);
		this.#process = recorder;
		let resolveExit = (): void => undefined;
		this.#exit = new Promise<void>((resolve) => {
			resolveExit = resolve;
		});
		let exitSettled = false;
		const settleExit = (): void => {
			if (exitSettled) return;
			exitSettled = true;
			resolveExit();
		};
		recorder.stderr.on('data', (chunk: Buffer) => {
			this.#stderr = `${this.#stderr}${chunk.toString('utf8')}`.slice(-MAXIMUM_STDERR_BYTES);
		});
		recorder.once('close', (code, processSignal) => {
			if (code !== null) this.#exitCode = code;
			if (processSignal !== null) this.#exitSignal = processSignal;
			settleExit();
		});

		await new Promise<void>((resolve, reject) => {
			const handleSpawn = (): void => {
				recorder.off('error', handleError);
				recorder.once('error', (error) => {
					this.#processError = error;
					settleExit();
				});
				resolve();
			};
			const handleError = (error: Error): void => {
				recorder.off('spawn', handleSpawn);
				this.#processError = error;
				settleExit();
				reject(new PwRecordCaptureError('Unable to start pw-record', error));
			};
			recorder.once('spawn', handleSpawn);
			recorder.once('error', handleError);
		});

		this.#signal = signal;
		this.#abortListener = () => void this.cancel('aborted');
		signal.addEventListener('abort', this.#abortListener, { once: true });
	}

	async *frames(): AsyncIterable<Uint8Array> {
		if (!this.#process || !this.#exit) throw new Error('pw-record capture was not started');
		for await (const chunk of this.#process.stdout) {
			yield chunk;
		}
		await this.#exit;
		if (!this.#requestedStop) throw this.#createExitError();
	}

	async stop(): Promise<void> {
		await this.#terminate('SIGINT', STOP_GRACE_MILLISECONDS);
	}

	async cancel(reason?: string): Promise<void> {
		await this.#terminate('SIGTERM', CANCEL_GRACE_MILLISECONDS);
	}

	async #terminate(signal: NodeJS.Signals, graceMilliseconds: number): Promise<void> {
		if (this.#stopping) return this.#stopping;
		this.#requestedStop = true;
		this.#removeAbortListener();
		if (!this.#process || !this.#exit) return;
		this.#stopping = (async () => {
			this.#process?.kill(signal);
			const exited = await Promise.race([
				this.#exit?.then(() => true),
				delay(graceMilliseconds).then(() => false),
			]);
			if (exited) return;
			this.#process?.kill('SIGKILL');
			await this.#exit;
		})();
		await this.#stopping;
	}

	#createExitError(): PwRecordCaptureError {
		if (this.#processError)
			return new PwRecordCaptureError('pw-record process failed', this.#processError);
		const status = this.#exitSignal ?? this.#exitCode ?? 'unknown';
		const details = this.#stderr.trim();
		const suffix = details ? `: ${details}` : '';
		return new PwRecordCaptureError(`pw-record exited unexpectedly (${status})${suffix}`);
	}

	#removeAbortListener(): void {
		if (this.#signal && this.#abortListener) {
			this.#signal.removeEventListener('abort', this.#abortListener);
		}
	}
}
