import { randomUUID } from 'node:crypto';

import { transitionSessionState } from './session-state.js';

import type {
	AsrEvent,
	RealtimeAsrProvider,
	RealtimeAsrSession,
} from '@voxspell/asr-core/realtime-asr';
import type { SessionId } from '@voxspell/protocol/common';
import type { ProtocolErrorCode, ProtocolErrorData } from '@voxspell/protocol/errors';
import type {
	SessionCompletedParams,
	SessionErrorParams,
	SessionParams,
	SessionStartResult,
} from '@voxspell/protocol/session';
import type {
	AsrReadyParams,
	TranscriptFinalParams,
	TranscriptPartialParams,
	TranscriptSegmentFinalParams,
} from '@voxspell/protocol/transcript';
import type { AudioCaptureBackend, AudioCaptureSession } from './audio-capture.js';
import type { SessionState } from './session-state.js';

export type DaemonSessionEvent =
	| { readonly method: 'session.recording'; readonly params: SessionParams }
	| { readonly method: 'asr.ready'; readonly params: AsrReadyParams }
	| { readonly method: 'transcript.partial'; readonly params: TranscriptPartialParams }
	| {
			readonly method: 'transcript.segmentFinal';
			readonly params: TranscriptSegmentFinalParams;
	  }
	| { readonly method: 'transcript.final'; readonly params: TranscriptFinalParams }
	| { readonly method: 'session.completed'; readonly params: SessionCompletedParams }
	| { readonly method: 'session.error'; readonly params: SessionErrorParams };

export interface SessionCoordinatorOptions {
	readonly captureBackend: AudioCaptureBackend;
	readonly asrProvider: RealtimeAsrProvider;
	readonly publish?: (event: DaemonSessionEvent) => void;
	readonly createSessionId?: () => SessionId;
}

interface ActiveSession {
	readonly id: SessionId;
	readonly inputContextId: string;
	readonly abortController: AbortController;
	capture?: AudioCaptureSession;
	asr?: RealtimeAsrSession;
	audioPump?: Promise<void>;
	eventPump?: Promise<void>;
	finishOperation?: Promise<void>;
	cancelOperation?: Promise<void>;
	failure?: ProtocolErrorData;
}

/** 表示可安全映射到 JSON-RPC error.data 的会话操作错误。 */
export class SessionCoordinatorError extends Error {
	readonly data: ProtocolErrorData;

	constructor(message: string, data: ProtocolErrorData) {
		super(message);
		this.name = 'SessionCoordinatorError';
		this.data = data;
	}
}

/** 管理 daemon 中唯一的活动录音与实时识别会话。 */
export class SessionCoordinator {
	readonly #captureBackend: AudioCaptureBackend;
	readonly #asrProvider: RealtimeAsrProvider;
	readonly #publish: (event: DaemonSessionEvent) => void;
	readonly #createSessionId: () => SessionId;
	#state: SessionState = 'idle';
	#active?: ActiveSession;
	#lastSettledSessionId?: SessionId;

	constructor(options: SessionCoordinatorOptions) {
		this.#captureBackend = options.captureBackend;
		this.#asrProvider = options.asrProvider;
		this.#publish = options.publish ?? (() => undefined);
		this.#createSessionId = options.createSessionId ?? randomUUID;
	}

	get state(): SessionState {
		return this.#state;
	}

	get activeSessionId(): SessionId | undefined {
		return this.#active?.id;
	}

	/** 创建并启动一次录音识别会话。 */
	async start(inputContextId: string): Promise<SessionStartResult> {
		if (this.#active) {
			throw this.#createError(
				'A recording session is already active',
				'SESSION_BUSY',
				'session',
			);
		}

		this.#state = transitionSessionState(this.#state, 'starting');
		const active: ActiveSession = {
			id: this.#createSessionId(),
			inputContextId,
			abortController: new AbortController(),
		};
		this.#active = active;

		try {
			active.asr = await this.#asrProvider.createSession({ sessionId: active.id });
			await active.asr.start(active.abortController.signal);
			active.eventPump = this.#consumeAsrEvents(active);
		} catch (error) {
			const coordinatorError = this.#createError(
				'Failed to start ASR session',
				'ASR_FAILED',
				'asr',
			);
			await this.#fail(active, coordinatorError.data);
			throw coordinatorError;
		}

		try {
			active.capture = this.#captureBackend.createSession();
			await active.capture.start(active.abortController.signal);
		} catch (error) {
			const coordinatorError = this.#createError(
				'Failed to start audio capture',
				'CAPTURE_FAILED',
				'capture',
			);
			await this.#fail(active, coordinatorError.data);
			throw coordinatorError;
		}
		if (active.failure) {
			await active.capture.cancel(active.failure.code);
			throw new SessionCoordinatorError('Session failed while starting', active.failure);
		}

		this.#transition(active, 'recording');
		this.#publish({ method: 'session.recording', params: { sessionId: active.id } });
		active.audioPump = this.#pumpAudio(active);

		return { sessionId: active.id };
	}

	/** 正常结束指定会话；重复调用不会重复关闭后端。 */
	async finish(sessionId: SessionId): Promise<void> {
		const active = this.#active;
		if (!active || active.id !== sessionId) {
			if (this.#lastSettledSessionId === sessionId) return;
			throw this.#createError('Session was not found', 'SESSION_NOT_FOUND', 'session');
		}

		active.finishOperation ??= this.#finishActive(active);
		await active.finishOperation;
	}

	/** 取消指定会话，并中断所有关联后端。 */
	async cancel(sessionId: SessionId, reason: string): Promise<void> {
		const active = this.#active;
		if (!active || active.id !== sessionId) {
			if (this.#lastSettledSessionId === sessionId) return;
			throw this.#createError('Session was not found', 'SESSION_NOT_FOUND', 'session');
		}

		active.cancelOperation ??= this.#cancelActive(active, reason);
		await active.cancelOperation;
	}

	async #finishActive(active: ActiveSession): Promise<void> {
		if (this.#state === 'finishing' || this.#state === 'post-processing') return;
		if (this.#state !== 'recording') {
			throw this.#createError(
				`Cannot finish a session in state ${this.#state}`,
				'INVALID_SESSION_STATE',
				'session',
			);
		}

		this.#transition(active, 'finishing');

		try {
			await active.capture?.stop();
		} catch (error) {
			const coordinatorError = this.#createError(
				'Failed to stop audio capture',
				'CAPTURE_FAILED',
				'capture',
			);
			await this.#fail(active, coordinatorError.data);
			throw coordinatorError;
		}

		await active.audioPump;
		if (active.failure) {
			throw new SessionCoordinatorError('Session failed while finishing', active.failure);
		}
		if (!this.#isCurrent(active) || !this.#hasState('finishing')) return;

		try {
			await active.asr?.finish();
			this.#transition(active, 'post-processing');
		} catch (error) {
			if (!this.#isCurrent(active) || this.#hasState('cancelling')) return;
			const coordinatorError = this.#createError(
				'Failed to finish ASR session',
				'ASR_FAILED',
				'asr',
			);
			await this.#fail(active, coordinatorError.data);
			throw coordinatorError;
		}
	}

	async #cancelActive(active: ActiveSession, reason: string): Promise<void> {
		if (!this.#isCurrent(active)) return;
		if (this.#state !== 'cancelling') this.#transition(active, 'cancelling');
		active.abortController.abort(reason);

		await Promise.allSettled([active.capture?.cancel(reason), active.asr?.cancel(reason)]);
		if (!this.#isCurrent(active)) return;
		this.#transition(active, 'cancelled');
		this.#settle(active);
	}

	async #pumpAudio(active: ActiveSession): Promise<void> {
		try {
			for await (const frame of active.capture?.frames() ?? []) {
				if (!this.#isCurrent(active)) return;
				try {
					await active.asr?.writeAudio(frame);
				} catch (error) {
					await this.#fail(active, {
						code: 'ASR_FAILED',
						stage: 'asr',
						retryable: false,
					});
					return;
				}
			}

			if (this.#isCurrent(active) && this.#state === 'recording') {
				await this.#fail(active, {
					code: 'CAPTURE_FAILED',
					stage: 'capture',
					retryable: false,
				});
			}
		} catch (error) {
			await this.#fail(active, {
				code: 'CAPTURE_FAILED',
				stage: 'capture',
				retryable: false,
			});
		}
	}

	async #consumeAsrEvents(active: ActiveSession): Promise<void> {
		try {
			for await (const event of active.asr?.events() ?? []) {
				if (!this.#isCurrent(active)) return;
				if (await this.#handleAsrEvent(active, event)) return;
			}

			if (this.#isCurrent(active) && this.#state !== 'cancelling') {
				await this.#fail(active, {
					code: 'ASR_FAILED',
					stage: 'asr',
					retryable: false,
				});
			}
		} catch (error) {
			await this.#fail(active, {
				code: 'ASR_FAILED',
				stage: 'asr',
				retryable: false,
			});
		}
	}

	async #handleAsrEvent(active: ActiveSession, event: AsrEvent): Promise<boolean> {
		switch (event.type) {
			case 'ready':
				this.#publish({
					method: 'asr.ready',
					params: { sessionId: active.id, providerId: this.#asrProvider.id },
				});
				return false;
			case 'partial':
				this.#publish({
					method: 'transcript.partial',
					params: {
						sessionId: active.id,
						segmentId: event.segmentId,
						revision: event.revision,
						text: event.text,
					},
				});
				return false;
			case 'segment-final':
				this.#publish({
					method: 'transcript.segmentFinal',
					params: {
						sessionId: active.id,
						segmentId: event.segmentId,
						text: event.text,
					},
				});
				return false;
			case 'completed':
				if (this.#state !== 'post-processing') {
					await this.#fail(active, {
						code: 'INVALID_SESSION_STATE',
						stage: 'session',
						retryable: false,
					});
					return true;
				}
				this.#publish({
					method: 'transcript.final',
					params: { sessionId: active.id, text: event.text },
				});
				this.#transition(active, 'completed');
				this.#publish({
					method: 'session.completed',
					params: { sessionId: active.id, text: event.text },
				});
				this.#settle(active);
				return true;
			case 'error':
				await this.#fail(active, {
					code: 'ASR_FAILED',
					stage: 'asr',
					retryable: event.retryable,
					providerCode: event.code,
				});
				return true;
		}

		return false;
	}

	async #fail(active: ActiveSession, data: ProtocolErrorData): Promise<void> {
		if (!this.#isCurrent(active) || this.#state === 'failed' || this.#state === 'cancelling') {
			return;
		}
		active.failure = data;
		active.abortController.abort(data.code);
		await Promise.allSettled([
			active.capture?.cancel(data.code),
			active.asr?.cancel(data.code),
		]);
		if (!this.#isCurrent(active)) return;
		this.#transition(active, 'failed');
		this.#publish({
			method: 'session.error',
			params: { sessionId: active.id, error: data },
		});
		this.#settle(active);
	}

	#settle(active: ActiveSession): void {
		if (!this.#isCurrent(active)) return;
		this.#lastSettledSessionId = active.id;
		this.#active = undefined;
		this.#state = transitionSessionState(this.#state, 'idle');
	}

	#transition(active: ActiveSession, state: SessionState): void {
		if (!this.#isCurrent(active)) return;
		this.#state = transitionSessionState(this.#state, state);
	}

	#isCurrent(active: ActiveSession): boolean {
		return this.#active === active;
	}

	#hasState(state: SessionState): boolean {
		return this.#state === state;
	}

	#createError(
		message: string,
		code: ProtocolErrorCode,
		stage: ProtocolErrorData['stage'],
	): SessionCoordinatorError {
		return new SessionCoordinatorError(message, { code, stage, retryable: false });
	}
}
