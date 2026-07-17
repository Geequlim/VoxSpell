import { describe, expect, it } from 'vitest';

import { InvalidSessionTransitionError, transitionSessionState } from '../src/session-state.js';

import type { SessionState } from '../src/session-state.js';

describe('transitionSessionState', () => {
	it.each<[SessionState, SessionState]>([
		['idle', 'starting'],
		['starting', 'recording'],
		['recording', 'finishing'],
		['finishing', 'recognizing'],
		['recognizing', 'processing'],
		['processing', 'polishing'],
		['processing', 'completed'],
		['polishing', 'choosing'],
		['polishing', 'completed'],
		['choosing', 'completed'],
		['recording', 'cancelling'],
		['cancelling', 'cancelled'],
		['cancelled', 'idle'],
		['starting', 'failed'],
		['failed', 'idle'],
	])('allows %s -> %s', (from, to) => {
		expect(transitionSessionState(from, to)).toBe(to);
	});

	it.each<[SessionState, SessionState]>([
		['idle', 'recording'],
		['recording', 'completed'],
		['completed', 'recording'],
		['cancelled', 'completed'],
	])('rejects %s -> %s', (from, to) => {
		expect(() => transitionSessionState(from, to)).toThrow(InvalidSessionTransitionError);
	});
});
