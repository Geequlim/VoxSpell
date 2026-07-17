import { describe, expect, it } from 'vitest';

import { ConfigReloadRequest, DaemonPingRequest, DaemonReadyNotification } from '../src/daemon.js';
import { InitializeRequest } from '../src/initialize.js';
import {
	SessionCancelRequest,
	SessionCompletedNotification,
	SessionErrorNotification,
	SessionFinishRequest,
	SessionPhaseNotification,
	SessionPreviewNotification,
	SessionResultsNotification,
	SessionSelectResultRequest,
	SessionStartRequest,
} from '../src/session.js';

describe('JSON-RPC method descriptors', () => {
	it.each([
		[InitializeRequest, 'initialize'],
		[SessionStartRequest, 'session.start'],
		[SessionFinishRequest, 'session.finish'],
		[SessionCancelRequest, 'session.cancel'],
		[SessionSelectResultRequest, 'session.selectResult'],
		[ConfigReloadRequest, 'config.reload'],
		[DaemonPingRequest, 'daemon.ping'],
	])('defines request %s', (descriptor, method) => {
		expect(descriptor.method).toBe(method);
	});

	it.each([
		[DaemonReadyNotification, 'daemon.ready'],
		[SessionPhaseNotification, 'session.phase'],
		[SessionPreviewNotification, 'session.preview'],
		[SessionResultsNotification, 'session.results'],
		[SessionCompletedNotification, 'session.completed'],
		[SessionErrorNotification, 'session.error'],
	])('defines notification %s', (descriptor, method) => {
		expect(descriptor.method).toBe(method);
	});
});
