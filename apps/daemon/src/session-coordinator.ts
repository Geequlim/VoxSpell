import { randomUUID } from 'node:crypto';

import { TranscriptAssembler } from '@voxspell/asr-core/transcript-assembler';
import { DEFAULT_MAXIMUM_RECORDING_SECONDS } from '@voxspell/config/config-schema';
import {
	countEffectiveCharacters,
	DefaultTextPipeline,
} from '@voxspell/text-pipeline/text-pipeline';
import { CompiledVoiceDictionary } from '@voxspell/text-pipeline/voice-dictionary';

import { transitionSessionState } from './session-state.js';

import type { TextPolisher } from '@voxspell/ai-polisher/text-polisher';
import type {
	AsrEvent,
	RealtimeAsrProvider,
	RealtimeAsrSession,
} from '@voxspell/asr-core/realtime-asr';
import type { SessionId } from '@voxspell/protocol/common';
import type { ProtocolErrorCode, ProtocolErrorData } from '@voxspell/protocol/errors';
import type {
	SessionChoiceId,
	SessionCompletedParams,
	SessionErrorParams,
	SessionPhase,
	SessionPhaseParams,
	SessionPolishingStateParams,
	SessionPreviewParams,
	SessionResultsParams,
	SessionStartResult,
} from '@voxspell/protocol/session';
import type { TextPipeline } from '@voxspell/text-pipeline/text-pipeline';
import type { AudioCaptureBackend, AudioCaptureSession } from './audio-capture.js';
import type { SessionState } from './session-state.js';
import type { DaemonSessionGate } from './session-gate.js';

const DEFAULT_MAXIMUM_RECORDING_MILLISECONDS = DEFAULT_MAXIMUM_RECORDING_SECONDS * 1_000;

export type DaemonSessionEvent =
	| { readonly method: 'session.phase'; readonly params: SessionPhaseParams }
	| { readonly method: 'session.preview'; readonly params: SessionPreviewParams }
	| { readonly method: 'session.polishingState'; readonly params: SessionPolishingStateParams }
	| { readonly method: 'session.results'; readonly params: SessionResultsParams }
	| { readonly method: 'session.completed'; readonly params: SessionCompletedParams }
	| { readonly method: 'session.error'; readonly params: SessionErrorParams };

export interface SessionCoordinatorOptions {
	readonly captureBackend: AudioCaptureBackend;
	readonly asrProvider?: RealtimeAsrProvider;
	readonly getAsrProvider?: () => RealtimeAsrProvider | undefined;
	readonly textPipeline?: TextPipeline;
	readonly textPolisher?: TextPolisher;
	readonly getTextPolisher?: () => TextPolisher | undefined;
	readonly getTextPolishingPolicy?: () => TextPolishingPolicy;
	readonly getTrimTrailingPeriod?: () => boolean;
	readonly getDictionary?: () => CompiledVoiceDictionary;
	readonly publish?: (event: DaemonSessionEvent) => void;
	readonly createSessionId?: () => SessionId;
	readonly sessionGate?: DaemonSessionGate;
	readonly onFailure?: (diagnostic: SessionFailureDiagnostic) => void;
	readonly onSettled?: (diagnostic: SessionSettlementDiagnostic) => void;
	readonly maximumRecordingMilliseconds?: number;
	readonly getMaximumRecordingMilliseconds?: () => number;
	readonly now?: () => number;
}

export interface SessionFailureDiagnostic {
	readonly sessionId?: SessionId;
	readonly phase: SessionPhase | SessionState;
	readonly error: ProtocolErrorData;
}

export interface SessionSettlementDiagnostic {
	readonly sessionId: SessionId;
	readonly outcome: 'completed' | 'cancelled' | 'failed';
	readonly asrDurationMilliseconds: number;
	readonly durationMilliseconds: number;
}

export interface TextPolishingPolicy {
	readonly defaultEnabled: boolean;
	readonly minimumEffectiveCharacters: number;
}

type SessionPolishingMode = 'auto' | 'forceOn' | 'forceOff';

interface ActiveSession {
	readonly id: SessionId;
	readonly inputContextId: string;
	readonly abortController: AbortController;
	readonly transcriptAssembler: TranscriptAssembler;
	readonly dictionary: CompiledVoiceDictionary;
	readonly textPolisher?: TextPolisher;
	readonly polishingPolicy: TextPolishingPolicy;
	readonly trimTrailingPeriod: boolean;
	readonly startedAt: number;
	polishingMode: SessionPolishingMode;
	polishingEnabled?: boolean;
	capture?: AudioCaptureSession;
	asr?: RealtimeAsrSession;
	phase?: SessionPhase;
	transcript?: string;
	polished?: string;
	polishAbortController?: AbortController;
	audioPump?: Promise<void>;
	eventPump?: Promise<void>;
	finishOperation?: Promise<void>;
	cancelOperation?: Promise<void>;
	failure?: ProtocolErrorData;
	recordingTimer?: NodeJS.Timeout;
	asrSettledAt?: number;
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

/** 管理 daemon 中唯一的录音、识别、处理、润色与结果选择会话。 */
export class SessionCoordinator {
	readonly #captureBackend: AudioCaptureBackend;
	readonly #getAsrProvider: () => RealtimeAsrProvider | undefined;
	readonly #textPipeline: TextPipeline;
	readonly #getTextPolisher: () => TextPolisher | undefined;
	readonly #getTextPolishingPolicy: () => TextPolishingPolicy;
	readonly #getTrimTrailingPeriod: () => boolean;
	readonly #getDictionary: () => CompiledVoiceDictionary;
	readonly #publish: (event: DaemonSessionEvent) => void;
	readonly #createSessionId: () => SessionId;
	readonly #sessionGate?: DaemonSessionGate;
	readonly #onFailure: (diagnostic: SessionFailureDiagnostic) => void;
	readonly #onSettled: (diagnostic: SessionSettlementDiagnostic) => void;
	readonly #getMaximumRecordingMilliseconds: () => number;
	readonly #now: () => number;
	readonly #sessionOwner = {};
	#state: SessionState = 'idle';
	#active?: ActiveSession;
	#lastSettledSessionId?: SessionId;

	constructor(options: SessionCoordinatorOptions) {
		this.#captureBackend = options.captureBackend;
		this.#getAsrProvider = options.getAsrProvider ?? (() => options.asrProvider);
		this.#textPipeline = options.textPipeline ?? new DefaultTextPipeline();
		this.#getTextPolisher = options.getTextPolisher ?? (() => options.textPolisher);
		this.#getTextPolishingPolicy =
			options.getTextPolishingPolicy ??
			(() => ({ defaultEnabled: true, minimumEffectiveCharacters: 0 }));
		this.#getTrimTrailingPeriod = options.getTrimTrailingPeriod ?? (() => false);
		const emptyDictionary = new CompiledVoiceDictionary({ version: 1, entries: [] });
		this.#getDictionary = options.getDictionary ?? (() => emptyDictionary);
		this.#publish = options.publish ?? (() => undefined);
		this.#createSessionId = options.createSessionId ?? randomUUID;
		this.#sessionGate = options.sessionGate;
		this.#onFailure = options.onFailure ?? (() => undefined);
		this.#onSettled = options.onSettled ?? (() => undefined);
		this.#getMaximumRecordingMilliseconds =
			options.getMaximumRecordingMilliseconds ??
			(() => options.maximumRecordingMilliseconds ?? DEFAULT_MAXIMUM_RECORDING_MILLISECONDS);
		this.#now = options.now ?? Date.now;
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
			const error = this.#createError(
				'A recording session is already active',
				'SESSION_BUSY',
				'session',
			);
			this.#reportFailure(error.data, this.#active.id, this.#active.phase ?? this.#state);
			throw error;
		}
		const asrProvider = this.#getAsrProvider();
		if (!asrProvider) {
			const error = this.#createError(
				'VoxSpell is not configured',
				'NOT_CONFIGURED',
				'config',
			);
			this.#reportFailure(error.data, undefined, this.#state);
			throw error;
		}
		if (this.#sessionGate && !this.#sessionGate.acquire(this.#sessionOwner)) {
			const error = this.#createError(
				'A recording session is already active',
				'SESSION_BUSY',
				'session',
			);
			this.#reportFailure(error.data, undefined, this.#state);
			throw error;
		}

		this.#state = transitionSessionState(this.#state, 'starting');
		const active: ActiveSession = {
			id: this.#createSessionId(),
			inputContextId,
			abortController: new AbortController(),
			transcriptAssembler: new TranscriptAssembler(),
			dictionary: this.#getDictionary(),
			textPolisher: this.#getTextPolisher(),
			polishingPolicy: this.#getTextPolishingPolicy(),
			trimTrailingPeriod: this.#getTrimTrailingPeriod(),
			startedAt: this.#now(),
			polishingMode: 'auto',
		};
		this.#active = active;
		this.#announcePhase(active, 'preparing');
		this.#updatePolishingState(active);

		try {
			active.asr = await asrProvider.createSession({ sessionId: active.id });
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
		this.#announcePhase(active, 'recording');
		active.recordingTimer = setTimeout(() => {
			void this.#fail(active, {
				code: 'SESSION_TIMEOUT',
				stage: 'session',
				retryable: false,
			});
		}, this.#getMaximumRecordingMilliseconds());
		active.audioPump = this.#pumpAudio(active);

		return { sessionId: active.id };
	}

	/** 强制设置本轮语音是否使用 AI 润色。 */
	setPolishingEnabled(sessionId: SessionId, enabled: boolean): void {
		const active = this.#active;
		if (!active || active.id !== sessionId) {
			throw this.#createError('Session was not found', 'SESSION_NOT_FOUND', 'session');
		}
		if (this.#state !== 'recording') {
			throw this.#createError(
				'Polishing can only be changed while recording',
				'INVALID_SESSION_STATE',
				'session',
			);
		}
		active.polishingMode = enabled ? 'forceOn' : 'forceOff';
		this.#updatePolishingState(active);
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

	/** 选择一份已经可用的结果，并产生唯一一次完成通知。 */
	async selectResult(sessionId: SessionId, choiceId: SessionChoiceId): Promise<void> {
		const active = this.#active;
		if (!active || active.id !== sessionId) {
			if (this.#lastSettledSessionId === sessionId) return;
			throw this.#createError('Session was not found', 'SESSION_NOT_FOUND', 'session');
		}

		let text = active.transcript;
		if (choiceId === 'polished') text = active.polished;
		if (!text || (this.#state !== 'polishing' && this.#state !== 'choosing')) {
			throw this.#createError(
				'The selected result is not available',
				'INVALID_SESSION_STATE',
				'session',
			);
		}

		active.polishAbortController?.abort('result-selected');
		this.#completeResult(active, choiceId, text);
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
		if (this.#state !== 'recording') {
			if (
				['finishing', 'recognizing', 'processing', 'polishing', 'choosing'].includes(
					this.#state,
				)
			) {
				return;
			}
			throw this.#createError(
				`Cannot finish a session in state ${this.#state}`,
				'INVALID_SESSION_STATE',
				'session',
			);
		}

		this.#transition(active, 'finishing');
		this.#clearRecordingTimer(active);

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

		this.#transition(active, 'recognizing');
		this.#announcePhase(active, 'recognizing');
		try {
			await active.asr?.finish();
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
		active.polishAbortController?.abort(reason);

		await Promise.allSettled([active.capture?.cancel(reason), active.asr?.cancel(reason)]);
		active.asrSettledAt = this.#now();
		if (!this.#isCurrent(active)) return;
		this.#transition(active, 'cancelled');
		this.#settle(active, 'cancelled');
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
				return false;
			case 'partial':
			case 'segment-final': {
				const text = active.transcriptAssembler.update(event);
				if (text === undefined) return false;
				this.#publish({
					method: 'session.preview',
					params: { sessionId: active.id, text },
				});
				return false;
			}
			case 'completed':
				active.asrSettledAt = this.#now();
				return this.#processTranscript(active, event.text);
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

	async #processTranscript(active: ActiveSession, text: string): Promise<boolean> {
		if (this.#state !== 'recognizing') {
			await this.#fail(active, {
				code: 'INVALID_SESSION_STATE',
				stage: 'session',
				retryable: false,
			});
			return true;
		}

		this.#transition(active, 'processing');
		this.#announcePhase(active, 'processing');
		try {
			active.transcript = await this.#textPipeline.processTranscript(
				{
					text,
					dictionary: active.dictionary,
					trimTrailingPeriod: active.trimTrailingPeriod,
				},
				active.abortController.signal,
			);
			if (!active.transcript) throw new Error('Text pipeline returned an empty transcript');
		} catch (error) {
			if (!this.#isCurrent(active)) return true;
			await this.#fail(active, {
				code: 'PROCESSING_FAILED',
				stage: 'processing',
				retryable: false,
			});
			return true;
		}

		if (!active.textPolisher || !this.#shouldPolish(active, active.transcript)) {
			this.#publishResults(active, 'transcript');
			this.#completeResult(active, 'transcript', active.transcript);
			return true;
		}

		this.#publishResults(active);
		this.#transition(active, 'polishing');
		this.#announcePhase(active, 'polishing');
		await this.#runPolisher(active, active.textPolisher);
		return true;
	}

	async #runPolisher(active: ActiveSession, textPolisher: TextPolisher): Promise<void> {
		const controller = new AbortController();
		active.polishAbortController = controller;
		let polished = '';

		try {
			for await (const event of textPolisher.polish(
				{ text: active.transcript!, dictionary: active.dictionary.entries },
				controller.signal,
			)) {
				if (!this.#isCurrent(active) || this.#state !== 'polishing') return;
				if (event.type === 'delta') {
					polished = `${polished}${event.text}`;
					this.#publishResults(active, 'polished', polished);
					continue;
				}
				if (event.type === 'error') {
					this.#finishPolishFallback(active);
					return;
				}
				if (!polished) {
					this.#finishPolishFallback(active);
					return;
				}
				active.polished = await this.#textPipeline.processPolished(
					{
						transcript: active.transcript!,
						polished,
						dictionary: active.dictionary,
						trimTrailingPeriod: active.trimTrailingPeriod,
					},
					controller.signal,
				);
				if (!this.#isCurrent(active) || this.#state !== 'polishing') return;
				if (!active.polished) {
					this.#finishPolishFallback(active);
					return;
				}
				this.#publishResults(active, 'polished', active.polished, true);
				this.#transition(active, 'choosing');
				this.#announcePhase(active, 'choosing');
				return;
			}
			if (this.#isCurrent(active)) this.#finishPolishFallback(active);
		} catch (error) {
			if (this.#isCurrent(active) && !controller.signal.aborted) {
				this.#finishPolishFallback(active);
			}
		}
	}

	#finishPolishFallback(active: ActiveSession): void {
		if (!this.#isCurrent(active) || this.#state !== 'polishing') return;
		active.polished = undefined;
		this.#publishResults(active, 'transcript');
		this.#transition(active, 'choosing');
		this.#announcePhase(active, 'choosing');
	}

	#publishResults(
		active: ActiveSession,
		recommendedChoiceId?: SessionChoiceId,
		polishedText?: string,
		polishedFinal = false,
	): void {
		if (!this.#isCurrent(active) || !active.transcript) return;
		const params: SessionResultsParams = {
			sessionId: active.id,
			transcript: { text: active.transcript, status: 'final' },
			recommendedChoiceId,
		};
		if (polishedText !== undefined) {
			params.polished = {
				text: polishedText,
				status: polishedFinal ? 'final' : 'streaming',
			};
		}
		this.#publish({ method: 'session.results', params });
	}

	#announcePhase(active: ActiveSession, phase: SessionPhase): void {
		if (!this.#isCurrent(active) || active.phase === phase) return;
		active.phase = phase;
		this.#publish({ method: 'session.phase', params: { sessionId: active.id, phase } });
	}

	#updatePolishingState(active: ActiveSession): void {
		let enabled = false;
		if (active.textPolisher) {
			if (active.polishingMode === 'forceOn') {
				enabled = true;
			} else if (active.polishingMode === 'auto') {
				enabled = active.polishingPolicy.defaultEnabled;
			}
		}
		if (active.polishingEnabled === enabled) return;
		active.polishingEnabled = enabled;
		this.#publish({
			method: 'session.polishingState',
			params: { sessionId: active.id, enabled },
		});
	}

	#shouldPolish(active: ActiveSession, text: string): boolean {
		if (active.polishingMode === 'forceOn') return true;
		if (active.polishingMode === 'forceOff') return false;
		return (
			active.polishingPolicy.defaultEnabled &&
			countEffectiveCharacters(text) >= active.polishingPolicy.minimumEffectiveCharacters
		);
	}

	#completeResult(active: ActiveSession, choiceId: SessionChoiceId, text: string): void {
		if (!this.#isCurrent(active)) return;
		this.#transition(active, 'completed');
		this.#publish({
			method: 'session.completed',
			params: { sessionId: active.id, selectedChoiceId: choiceId, text },
		});
		this.#settle(active, 'completed');
	}

	async #fail(active: ActiveSession, data: ProtocolErrorData): Promise<void> {
		if (
			!this.#isCurrent(active) ||
			active.failure ||
			this.#state === 'failed' ||
			this.#state === 'cancelling'
		) {
			return;
		}
		active.failure = data;
		this.#reportFailure(data, active.id, active.phase ?? this.#state);
		active.abortController.abort(data.code);
		active.polishAbortController?.abort(data.code);
		await Promise.allSettled([
			active.capture?.cancel(data.code),
			active.asr?.cancel(data.code),
		]);
		active.asrSettledAt = this.#now();
		if (!this.#isCurrent(active)) return;
		this.#transition(active, 'failed');
		this.#publish({
			method: 'session.error',
			params: { sessionId: active.id, error: data },
		});
		this.#settle(active, 'failed');
	}

	#settle(active: ActiveSession, outcome: SessionSettlementDiagnostic['outcome']): void {
		if (!this.#isCurrent(active)) return;
		this.#clearRecordingTimer(active);
		this.#lastSettledSessionId = active.id;
		this.#active = undefined;
		this.#state = transitionSessionState(this.#state, 'idle');
		this.#sessionGate?.release(this.#sessionOwner);
		this.#onSettled({
			sessionId: active.id,
			outcome,
			asrDurationMilliseconds: Math.max(
				0,
				(active.asrSettledAt ?? this.#now()) - active.startedAt,
			),
			durationMilliseconds: Math.max(0, this.#now() - active.startedAt),
		});
	}

	#clearRecordingTimer(active: ActiveSession): void {
		clearTimeout(active.recordingTimer);
		active.recordingTimer = undefined;
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

	#reportFailure(
		error: ProtocolErrorData,
		sessionId: SessionId | undefined,
		phase: SessionPhase | SessionState,
	): void {
		this.#onFailure({ sessionId, phase, error });
	}
}
