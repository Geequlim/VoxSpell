import { describe, expect, it, vi } from 'vitest';
import { InputBehaviorState } from './input-behavior-state';

import type { InputBehaviorConfig } from '../fcitx/input-behavior-client';
import type { InputBehaviorClient } from './input-behavior-state';

const initialConfig: InputBehaviorConfig = {
	pttKey: 'space',
	holdThresholdMs: 200,
	autoSelectResult: true,
};

class FakeInputBehaviorClient implements InputBehaviorClient {
	getInputBehavior = vi.fn<() => Promise<InputBehaviorConfig>>();
	updateInputBehavior = vi.fn<(config: InputBehaviorConfig) => Promise<void>>();
}

describe('InputBehaviorState', () => {
	it('loads, edits and saves the Fcitx input behavior', async () => {
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
		expect(state.canSave).toBe(true);

		await state.save();
		expect(client.updateInputBehavior).toHaveBeenCalledWith({
			pttKey: 'Control+space',
			holdThresholdMs: 350,
			autoSelectResult: false,
		});
		expect(state.phase).toBe('saved');
		expect(state.isDirty).toBe(false);
	});

	it('discards drafts and rejects an empty PTT key', async () => {
		const client = new FakeInputBehaviorClient();
		client.getInputBehavior.mockResolvedValue(initialConfig);
		const state = new InputBehaviorState(client);
		await state.load();

		state.updateHoldThreshold(500);
		state.discard();
		expect(state.holdThresholdMs).toBe(200);
		state.updatePttKey('   ');
		await state.save();
		expect(state.errorMessage).toBe('请设置 PTT 热键。');
		expect(client.updateInputBehavior).not.toHaveBeenCalled();
	});
});
