import { describe, expect, it, vi } from 'vitest';

import { SessionCoordinator, SessionCoordinatorError } from '../src/session-coordinator.js';
import { FakeAudioCaptureBackend } from './fakes/fake-audio-capture.js';
import { FakeRealtimeAsrProvider } from './fakes/fake-realtime-asr.js';

import type { DaemonSessionEvent } from '../src/session-coordinator.js';

const SESSION_ID = '0190c95b-7f28-7b12-8b6f-a4d3fd239013';
const NEXT_SESSION_ID = '0190c95b-7f28-7b12-8b6f-a4d3fd239014';

interface TestContext {
	readonly captureBackend: FakeAudioCaptureBackend;
	readonly asrProvider: FakeRealtimeAsrProvider;
	readonly events: DaemonSessionEvent[];
	readonly coordinator: SessionCoordinator;
}

/** 创建使用确定性 ID 和测试 fake 的协调器。 */
function createTestContext(sessionIds: string[] = [SESSION_ID]): TestContext {
	const captureBackend = new FakeAudioCaptureBackend();
	const asrProvider = new FakeRealtimeAsrProvider();
	const events: DaemonSessionEvent[] = [];
	const coordinator = new SessionCoordinator({
		captureBackend,
		asrProvider,
		publish: (event) => events.push(event),
		createSessionId: () => {
			const sessionId = sessionIds.shift();
			if (!sessionId) throw new Error('No fake session ID available');
			return sessionId;
		},
	});

	return { captureBackend, asrProvider, events, coordinator };
}

describe('SessionCoordinator', () => {
	it('runs audio and ASR events through a completed session', async () => {
		const context = createTestContext();
		const result = await context.coordinator.start('input-context-1');
		const capture = context.captureBackend.sessions[0];
		const asr = context.asrProvider.sessions[0];

		expect(result).toEqual({ sessionId: SESSION_ID });
		expect(context.coordinator.state).toBe('recording');
		asr.emit({ type: 'ready' });
		asr.emit({
			type: 'partial',
			segmentId: 'segment-1',
			revision: 0,
			text: '你好',
		});
		asr.emit({
			type: 'segment-final',
			segmentId: 'segment-1',
			text: '你好',
		});
		capture.pushFrame(Uint8Array.from([1, 2]));
		capture.pushFrame(Uint8Array.from([3]));

		await vi.waitFor(() => {
			expect(asr.audioFrames).toEqual([Uint8Array.from([1, 2]), Uint8Array.from([3])]);
		});

		await context.coordinator.finish(SESSION_ID);
		expect(context.coordinator.state).toBe('post-processing');
		expect(capture.stopCalls).toBe(1);
		expect(asr.finishCalls).toBe(1);

		asr.emit({ type: 'completed', text: '你好，世界。' });
		await vi.waitFor(() => expect(context.coordinator.state).toBe('idle'));
		await context.coordinator.finish(SESSION_ID);

		expect(capture.stopCalls).toBe(1);
		expect(asr.finishCalls).toBe(1);
		expect(context.events.map((event) => event.method)).toEqual([
			'session.recording',
			'asr.ready',
			'transcript.partial',
			'transcript.segmentFinal',
			'transcript.final',
			'session.completed',
		]);
	});

	it('can cancel while waiting for the final ASR result', async () => {
		const context = createTestContext();
		await context.coordinator.start('input-context-1');
		await context.coordinator.finish(SESSION_ID);

		expect(context.coordinator.state).toBe('post-processing');
		await context.coordinator.cancel(SESSION_ID, 'user');

		expect(context.coordinator.state).toBe('idle');
		expect(context.captureBackend.sessions[0].cancelCalls).toBe(1);
		expect(context.asrProvider.sessions[0].cancelCalls).toBe(1);
	});

	it('cancels both backends once', async () => {
		const context = createTestContext();
		await context.coordinator.start('input-context-1');
		const capture = context.captureBackend.sessions[0];
		const asr = context.asrProvider.sessions[0];

		await context.coordinator.cancel(SESSION_ID, 'user');
		await context.coordinator.cancel(SESSION_ID, 'user');

		expect(context.coordinator.state).toBe('idle');
		expect(capture.cancelCalls).toBe(1);
		expect(asr.cancelCalls).toBe(1);
	});

	it('rejects a second active session', async () => {
		const context = createTestContext();
		await context.coordinator.start('input-context-1');

		await expect(context.coordinator.start('input-context-2')).rejects.toMatchObject({
			data: { code: 'SESSION_BUSY' },
		});
		await context.coordinator.cancel(SESSION_ID, 'user');
	});

	it('reports Provider failures with a stable protocol error', async () => {
		const context = createTestContext();
		await context.coordinator.start('input-context-1');
		const asr = context.asrProvider.sessions[0];

		asr.emit({ type: 'error', code: 'FAKE_UNAVAILABLE', retryable: true });

		await vi.waitFor(() => expect(context.coordinator.state).toBe('idle'));
		expect(context.events.at(-1)).toEqual({
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

	it('ignores events from a settled session after a new session starts', async () => {
		const context = createTestContext([SESSION_ID, NEXT_SESSION_ID]);
		await context.coordinator.start('input-context-1');
		const oldAsr = context.asrProvider.sessions[0];
		await context.coordinator.cancel(SESSION_ID, 'replaced');
		await context.coordinator.start('input-context-2');
		const eventCount = context.events.length;

		oldAsr.emit({
			type: 'partial',
			segmentId: 'stale-segment',
			revision: 0,
			text: '过期内容',
		});

		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(context.events).toHaveLength(eventCount);
		expect(context.coordinator.activeSessionId).toBe(NEXT_SESSION_ID);
		await context.coordinator.cancel(NEXT_SESSION_ID, 'user');
	});

	it('fails when audio capture ends unexpectedly', async () => {
		const context = createTestContext();
		await context.coordinator.start('input-context-1');

		context.captureBackend.sessions[0].endUnexpectedly();

		await vi.waitFor(() => expect(context.coordinator.state).toBe('idle'));
		expect(context.events.at(-1)).toMatchObject({
			method: 'session.error',
			params: { error: { code: 'CAPTURE_FAILED', stage: 'capture' } },
		});
	});

	it('returns a typed error for an unknown session', async () => {
		const context = createTestContext();

		await expect(context.coordinator.finish(SESSION_ID)).rejects.toBeInstanceOf(
			SessionCoordinatorError,
		);
	});
});
