import { describe, expect, it, vi } from 'vitest';

import { SessionCoordinator, SessionCoordinatorError } from '../src/session-coordinator.js';
import { DaemonSessionGate } from '../src/session-gate.js';
import { FakeAudioCaptureBackend } from './fakes/fake-audio-capture.js';
import { FakeRealtimeAsrProvider } from './fakes/fake-realtime-asr.js';
import { FakeTextPolisher } from './fakes/fake-text-polisher.js';

import type { TextPolisher } from '@voxspell/ai-polisher/text-polisher';
import type { TextPipeline } from '@voxspell/text-pipeline/text-pipeline';
import type { DaemonSessionEvent, SessionCoordinatorOptions } from '../src/session-coordinator.js';

const SESSION_ID = '0190c95b-7f28-7b12-8b6f-a4d3fd239013';
const NEXT_SESSION_ID = '0190c95b-7f28-7b12-8b6f-a4d3fd239014';

interface TestContext {
	readonly captureBackend: FakeAudioCaptureBackend;
	readonly asrProvider: FakeRealtimeAsrProvider;
	readonly events: DaemonSessionEvent[];
	readonly coordinator: SessionCoordinator;
}

interface TestContextOptions {
	readonly sessionIds?: string[];
	readonly textPipeline?: TextPipeline;
	readonly textPolisher?: TextPolisher;
	readonly getTextPolisher?: () => TextPolisher | undefined;
	readonly getPolishDictionary?: SessionCoordinatorOptions['getPolishDictionary'];
	readonly sessionGate?: DaemonSessionGate;
}

/** 创建使用确定性 ID 和测试 fake 的协调器。 */
function createTestContext(options: TestContextOptions = {}): TestContext {
	const sessionIds = options.sessionIds ?? [SESSION_ID];
	const captureBackend = new FakeAudioCaptureBackend();
	const asrProvider = new FakeRealtimeAsrProvider();
	const events: DaemonSessionEvent[] = [];
	const coordinator = new SessionCoordinator({
		captureBackend,
		asrProvider,
		textPipeline: options.textPipeline,
		textPolisher: options.textPolisher,
		getTextPolisher: options.getTextPolisher,
		getPolishDictionary: options.getPolishDictionary,
		sessionGate: options.sessionGate,
		publish: (event) => events.push(event),
		createSessionId: () => {
			const sessionId = sessionIds.shift();
			if (!sessionId) throw new Error('No fake session ID available');
			return sessionId;
		},
	});

	return { captureBackend, asrProvider, events, coordinator };
}

/** 推进 fake 会话到确定性文本处理阶段。 */
async function completeAsr(context: TestContext, text: string): Promise<void> {
	await context.coordinator.finish(SESSION_ID);
	context.asrProvider.sessions[0].emit({ type: 'completed', text });
}

describe('SessionCoordinator', () => {
	it('announces preparing before asynchronous startup and recording only when ready', async () => {
		const context = createTestContext();
		const start = context.coordinator.start('input-context-1');

		expect(context.events).toEqual([
			{ method: 'session.phase', params: { sessionId: SESSION_ID, phase: 'preparing' } },
		]);
		await expect(start).resolves.toEqual({ sessionId: SESSION_ID });
		expect(context.events.at(-1)).toEqual({
			method: 'session.phase',
			params: { sessionId: SESSION_ID, phase: 'recording' },
		});
		await context.coordinator.cancel(SESSION_ID, 'user');
	});

	it('enforces one active session across multiple coordinators', async () => {
		const sessionGate = new DaemonSessionGate();
		const first = createTestContext({ sessionGate });
		const second = createTestContext({ sessionGate });
		await first.coordinator.start('input-context-1');

		await expect(second.coordinator.start('input-context-2')).rejects.toMatchObject({
			data: { code: 'SESSION_BUSY', stage: 'session' },
		});

		await first.coordinator.cancel(SESSION_ID, 'user');
		await expect(second.coordinator.start('input-context-2')).resolves.toEqual({
			sessionId: SESSION_ID,
		});
		await second.coordinator.cancel(SESSION_ID, 'user');
	});

	it('publishes corrected preview snapshots and completes without AI polish', async () => {
		const context = createTestContext();
		const result = await context.coordinator.start('input-context-1');
		const capture = context.captureBackend.sessions[0];
		const asr = context.asrProvider.sessions[0];

		expect(result).toEqual({ sessionId: SESSION_ID });
		asr.emit({
			type: 'partial',
			segmentId: 'segment-1',
			revision: 0,
			text: '今天下午三点开会',
		});
		asr.emit({
			type: 'partial',
			segmentId: 'segment-1',
			revision: 1,
			text: '今天下午三点我们开会',
		});
		asr.emit({
			type: 'partial',
			segmentId: 'segment-1',
			revision: 0,
			text: '过期内容',
		});
		capture.pushFrame(Uint8Array.from([1, 2]));

		await vi.waitFor(() => expect(asr.audioFrames).toHaveLength(1));
		await completeAsr(context, '今天下午三点我们开会');
		await vi.waitFor(() => expect(context.coordinator.state).toBe('idle'));

		expect(
			context.events
				.filter((event) => event.method === 'session.preview')
				.map((event) => event.params.text),
		).toEqual(['今天下午三点开会', '今天下午三点我们开会']);
		expect(context.events.filter((event) => event.method === 'session.phase')).toEqual([
			{ method: 'session.phase', params: { sessionId: SESSION_ID, phase: 'preparing' } },
			{ method: 'session.phase', params: { sessionId: SESSION_ID, phase: 'recording' } },
			{ method: 'session.phase', params: { sessionId: SESSION_ID, phase: 'recognizing' } },
			{ method: 'session.phase', params: { sessionId: SESSION_ID, phase: 'processing' } },
		]);
		expect(context.events.at(-2)).toEqual({
			method: 'session.results',
			params: {
				sessionId: SESSION_ID,
				transcript: { text: '今天下午三点我们开会', status: 'final' },
				recommendedChoiceId: 'transcript',
			},
		});
		expect(context.events.at(-1)).toEqual({
			method: 'session.completed',
			params: {
				sessionId: SESSION_ID,
				selectedChoiceId: 'transcript',
				text: '今天下午三点我们开会',
			},
		});
		expect(context.coordinator.state).toBe('idle');
	});

	it('publishes full polished snapshots and exposes both final results', async () => {
		const polisher = new FakeTextPolisher();
		const dictionary = [{ canonical: 'Codex', aliases: ['扣得克斯'] }];
		const pipeline: TextPipeline = {
			processTranscript: async (text) => `识别:${text}`,
			processPolished: async (request) => {
				expect(request.dictionary).toEqual(dictionary);
				return `润色:${request.polished}`;
			},
		};
		const context = createTestContext({
			textPipeline: pipeline,
			textPolisher: polisher,
			getPolishDictionary: () => dictionary,
		});
		await context.coordinator.start('input-context-1');
		await completeAsr(context, '原始输入');
		await vi.waitFor(() => expect(context.coordinator.state).toBe('polishing'));
		const polishSession = polisher.sessions[0];

		expect(polishSession.request).toEqual({ text: '识别:原始输入', dictionary });
		polishSession.emit({ type: 'delta', text: '更自然' });
		polishSession.emit({ type: 'delta', text: '的表达' });
		polishSession.emit({ type: 'completed' });
		await vi.waitFor(() => expect(context.coordinator.state).toBe('choosing'));

		const results = context.events
			.filter((event) => event.method === 'session.results')
			.map((event) => event.params);
		expect(results).toEqual([
			{
				sessionId: SESSION_ID,
				transcript: { text: '识别:原始输入', status: 'final' },
				recommendedChoiceId: undefined,
			},
			{
				sessionId: SESSION_ID,
				transcript: { text: '识别:原始输入', status: 'final' },
				polished: { text: '更自然', status: 'streaming' },
				recommendedChoiceId: 'polished',
			},
			{
				sessionId: SESSION_ID,
				transcript: { text: '识别:原始输入', status: 'final' },
				polished: { text: '更自然的表达', status: 'streaming' },
				recommendedChoiceId: 'polished',
			},
			{
				sessionId: SESSION_ID,
				transcript: { text: '识别:原始输入', status: 'final' },
				polished: { text: '润色:更自然的表达', status: 'final' },
				recommendedChoiceId: 'polished',
			},
		]);

		await context.coordinator.selectResult(SESSION_ID, 'polished');
		expect(context.events.at(-1)).toMatchObject({
			method: 'session.completed',
			params: { selectedChoiceId: 'polished', text: '润色:更自然的表达' },
		});
	});

	it('lets the client select the transcript while polish is streaming', async () => {
		const polisher = new FakeTextPolisher();
		const context = createTestContext({ textPolisher: polisher });
		await context.coordinator.start('input-context-1');
		await completeAsr(context, '可靠识别结果');
		await vi.waitFor(() => expect(context.coordinator.state).toBe('polishing'));
		polisher.sessions[0].emit({ type: 'delta', text: '尚未完成' });

		await context.coordinator.selectResult(SESSION_ID, 'transcript');

		expect(polisher.sessions[0].aborted).toBe(true);
		expect(context.events.at(-1)).toMatchObject({
			method: 'session.completed',
			params: { selectedChoiceId: 'transcript', text: '可靠识别结果' },
		});
	});

	it('rejects selecting an unfinished polished result', async () => {
		const polisher = new FakeTextPolisher();
		const context = createTestContext({ textPolisher: polisher });
		await context.coordinator.start('input-context-1');
		await completeAsr(context, '识别结果');
		await vi.waitFor(() => expect(context.coordinator.state).toBe('polishing'));

		await expect(
			context.coordinator.selectResult(SESSION_ID, 'polished'),
		).rejects.toMatchObject({
			data: { code: 'INVALID_SESSION_STATE' },
		});
		await context.coordinator.cancel(SESSION_ID, 'user');
	});

	it('can cancel while waiting for the final ASR result', async () => {
		const context = createTestContext();
		await context.coordinator.start('input-context-1');
		await context.coordinator.finish(SESSION_ID);

		expect(context.coordinator.state).toBe('recognizing');
		await context.coordinator.cancel(SESSION_ID, 'user');

		expect(context.coordinator.state).toBe('idle');
		expect(context.captureBackend.sessions[0].cancelCalls).toBe(1);
		expect(context.asrProvider.sessions[0].cancelCalls).toBe(1);
	});

	it('reports Provider failures with a stable protocol error', async () => {
		const context = createTestContext();
		await context.coordinator.start('input-context-1');
		context.asrProvider.sessions[0].emit({
			type: 'error',
			code: 'FAKE_UNAVAILABLE',
			retryable: true,
		});

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
		const context = createTestContext({ sessionIds: [SESSION_ID, NEXT_SESSION_ID] });
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
