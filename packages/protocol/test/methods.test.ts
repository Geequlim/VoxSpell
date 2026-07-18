import { describe, expect, it } from 'vitest';

import {
	ConfigReloadRequest,
	DaemonGetStatusRequest,
	DaemonPingRequest,
	DaemonReadyNotification,
} from '../src/daemon.js';
import { ConfigGetRequest, ConfigUpdateRequest, ConfigValidateRequest } from '../src/config.js';
import { CredentialsGetStatusRequest, CredentialsUpdateRequest } from '../src/credentials.js';
import {
	DictionaryGetRequest,
	DictionaryReloadRequest,
	DictionaryUpdateRequest,
	DictionaryValidateRequest,
} from '../src/dictionary.js';
import { FcitxGetConfigRequest, FcitxUpdateConfigRequest } from '../src/fcitx.js';
import { InitializeRequest } from '../src/initialize.js';
import { ProviderTestRequest } from '../src/provider.js';
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
		[ConfigGetRequest, 'config.get'],
		[ConfigValidateRequest, 'config.validate'],
		[ConfigUpdateRequest, 'config.update'],
		[CredentialsGetStatusRequest, 'credentials.getStatus'],
		[CredentialsUpdateRequest, 'credentials.update'],
		[DictionaryGetRequest, 'dictionary.get'],
		[DictionaryValidateRequest, 'dictionary.validate'],
		[DictionaryUpdateRequest, 'dictionary.update'],
		[DictionaryReloadRequest, 'dictionary.reload'],
		[ProviderTestRequest, 'provider.test'],
		[FcitxGetConfigRequest, 'fcitx.getConfig'],
		[FcitxUpdateConfigRequest, 'fcitx.updateConfig'],
		[DaemonGetStatusRequest, 'daemon.getStatus'],
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
