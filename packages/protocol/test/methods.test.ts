import { describe, expect, it } from 'vitest';

import { ConfigReloadRequest, DaemonPingRequest, DaemonReadyNotification } from '../src/daemon.js';
import { InitializeRequest } from '../src/initialize.js';
import {
	PolishDeltaNotification,
	PolishFinalNotification,
	PolishStartedNotification,
} from '../src/polish.js';
import {
	SessionCancelRequest,
	SessionCompletedNotification,
	SessionErrorNotification,
	SessionFinishRequest,
	SessionRecordingNotification,
	SessionStartRequest,
} from '../src/session.js';
import {
	AsrReadyNotification,
	TranscriptFinalNotification,
	TranscriptPartialNotification,
	TranscriptSegmentFinalNotification,
} from '../src/transcript.js';

describe('JSON-RPC method descriptors', () => {
	it.each([
		[InitializeRequest, 'initialize'],
		[SessionStartRequest, 'session.start'],
		[SessionFinishRequest, 'session.finish'],
		[SessionCancelRequest, 'session.cancel'],
		[ConfigReloadRequest, 'config.reload'],
		[DaemonPingRequest, 'daemon.ping'],
	])('defines request %s', (descriptor, method) => {
		expect(descriptor.method).toBe(method);
	});

	it.each([
		[DaemonReadyNotification, 'daemon.ready'],
		[SessionRecordingNotification, 'session.recording'],
		[SessionCompletedNotification, 'session.completed'],
		[SessionErrorNotification, 'session.error'],
		[AsrReadyNotification, 'asr.ready'],
		[TranscriptPartialNotification, 'transcript.partial'],
		[TranscriptSegmentFinalNotification, 'transcript.segmentFinal'],
		[TranscriptFinalNotification, 'transcript.final'],
		[PolishStartedNotification, 'polish.started'],
		[PolishDeltaNotification, 'polish.delta'],
		[PolishFinalNotification, 'polish.final'],
	])('defines notification %s', (descriptor, method) => {
		expect(descriptor.method).toBe(method);
	});
});
