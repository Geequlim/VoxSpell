import { describe, expect, it } from 'vitest';
import { DaemonSocketConfigurationError, resolveDaemonSocketPath } from './daemon-socket-path';

describe('resolveDaemonSocketPath', () => {
	it('uses XDG_RUNTIME_DIR without an unsafe fallback', () => {
		expect(resolveDaemonSocketPath({ XDG_RUNTIME_DIR: '/run/user/1000' })).toBe(
			'/run/user/1000/voxspell/daemon.sock',
		);
		expect(() => resolveDaemonSocketPath({})).toThrow(DaemonSocketConfigurationError);
	});
});
