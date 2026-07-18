import { describe, expect, it, vi } from 'vitest';
import { InputBehaviorState } from './input-behavior-state';

import type { InputBehaviorConfig } from '../fcitx/input-behavior-client';
import type { InputBehaviorClient } from './input-behavior-state';

const initialConfig: InputBehaviorConfig = {
	pttKey: 'space',
	holdThresholdMs: 200,
	autoSelectResult: true,
	polishingToggleKey: 'Shift_L',
};

class FakeInputBehaviorClient implements InputBehaviorClient {
	getInputBehavior = vi.fn<() => Promise<InputBehaviorConfig>>();
	updateInputBehavior = vi.fn<(config: InputBehaviorConfig) => Promise<void>>();
}

describe('InputBehaviorState', () => {
	it('loads, edits and automatically saves the Fcitx input behavior', async () => {
		const client = new FakeInputBehaviorClient();
		client.getInputBehavior.mockResolvedValue(initialConfig);
		client.updateInputBehavior.mockResolvedValue();
		const state = new InputBehaviorState(client);

		state.start();
		await vi.waitFor(() => expect(state.phase).toBe('idle'));
		expect(state.pttKey).toBe('space');
		state.updatePttKey('Control+space');
		state.updateHoldThreshold(350);
		state.updateAutoSelectResult(false);
		state.updatePolishingToggleKey('Shift_R');
		await state.flushPendingChanges();
		expect(client.updateInputBehavior).toHaveBeenCalledWith({
			pttKey: 'Control+space',
			holdThresholdMs: 350,
			autoSelectResult: false,
			polishingToggleKey: 'Shift_R',
		});
		expect(state.phase).toBe('saved');
		expect(state.isDirty).toBe(false);
		state.dispose();
	});

	it('keeps an invalid draft without sending it to Fcitx', async () => {
		const client = new FakeInputBehaviorClient();
		client.getInputBehavior.mockResolvedValue(initialConfig);
		const state = new InputBehaviorState(client);
		await state.load();

		state.updatePttKey('   ');
		await state.flushPendingChanges();
		expect(state.errorMessage).toBe('请设置 PTT 热键。');
		expect(client.updateInputBehavior).not.toHaveBeenCalled();
		expect(state.pttKey).toBe('   ');
		state.dispose();
	});

	it('submits immediate edits without a manual save action', async () => {
		vi.useFakeTimers();
		const client = new FakeInputBehaviorClient();
		client.getInputBehavior.mockResolvedValue(initialConfig);
		client.updateInputBehavior.mockResolvedValue();
		const state = new InputBehaviorState(client);
		await state.load();

		state.updateAutoSelectResult(false);
		await vi.runAllTimersAsync();

		expect(client.updateInputBehavior).toHaveBeenCalledWith({
			...initialConfig,
			autoSelectResult: false,
		});
		state.dispose();
		vi.useRealTimers();
	});
});
