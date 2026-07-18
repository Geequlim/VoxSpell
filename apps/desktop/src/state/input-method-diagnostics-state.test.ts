import { describe, expect, it, vi } from 'vitest';
import { InputMethodDiagnosticsState } from './input-method-diagnostics-state';

import type { InputMethodDiagnostics } from '../fcitx/input-behavior-client';
import type { InputMethodDiagnosticsClient } from './input-method-diagnostics-state';

class FakeInputMethodDiagnosticsClient implements InputMethodDiagnosticsClient {
	getInputMethodDiagnostics = vi.fn<() => Promise<InputMethodDiagnostics>>();
}

describe('InputMethodDiagnosticsState', () => {
	it('loads diagnostics without a daemon connection', async () => {
		const client = new FakeInputMethodDiagnosticsClient();
		client.getInputMethodDiagnostics.mockResolvedValue({
			currentInputMethod: 'rime',
			rimeStatus: 'active',
			voxspellAddonStatus: 'enabled',
		});
		const state = new InputMethodDiagnosticsState(client);

		state.start();
		await vi.waitFor(() => expect(state.phase).toBe('ready'));
		expect(state.diagnostics).toEqual({
			currentInputMethod: 'rime',
			rimeStatus: 'active',
			voxspellAddonStatus: 'enabled',
		});
		state.dispose();
	});

	it('reports Fcitx as unavailable when the desktop cannot reach D-Bus', async () => {
		const client = new FakeInputMethodDiagnosticsClient();
		client.getInputMethodDiagnostics.mockRejectedValue(new Error('service unknown'));
		const state = new InputMethodDiagnosticsState(client);

		await state.refresh();

		expect(state.phase).toBe('unavailable');
		expect(state.diagnostics).toBeUndefined();
		expect(state.errorMessage).toBe('无法访问 Fcitx 5：service unknown');
	});
});
