import { describe, expect, it, vi } from 'vitest';
import { StatusAnimationState } from './status-animation-state';
import { DEFAULT_STATUS_ANIMATION_SOURCE } from '../status-animation-config-client';

import type {
	StatusAnimationConfigClient,
	StatusAnimationSourceSnapshot,
	ValidatedStatusAnimationSource,
} from '../status-animation-config-client';

const validSource = JSON.stringify([
	{
		id: 'recording',
		frames: ['🎙️', '🔴'],
		text: '请讲话',
		interval: 180,
	},
]);

class FakeStatusAnimationConfigClient implements StatusAnimationConfigClient {
	getStatusAnimationSource = vi.fn<() => Promise<StatusAnimationSourceSnapshot>>();
	updateStatusAnimation = vi.fn<(source: ValidatedStatusAnimationSource) => Promise<void>>();
	resetStatusAnimation = vi.fn<() => Promise<StatusAnimationSourceSnapshot>>();
	openStatusAnimationEditor = vi.fn<() => Promise<void>>();
}

describe('StatusAnimationState', () => {
	it('automatically saves and applies a valid configuration', async () => {
		const client = new FakeStatusAnimationConfigClient();
		client.getStatusAnimationSource.mockResolvedValue({
			source: DEFAULT_STATUS_ANIMATION_SOURCE,
			custom: false,
		});
		client.updateStatusAnimation.mockResolvedValue();
		const state = new StatusAnimationState(client);
		await state.load();

		state.updateDraft(validSource);
		await state.flushPendingChanges();

		expect(client.updateStatusAnimation).toHaveBeenCalledWith(validSource);
		expect(state.source).toBe(validSource);
		expect(state.phase).toBe('saved');
		state.dispose();
	});

	it('keeps invalid JSON as a draft without touching the persisted configuration', async () => {
		const client = new FakeStatusAnimationConfigClient();
		client.getStatusAnimationSource.mockResolvedValue({ source: validSource, custom: true });
		const state = new StatusAnimationState(client);
		await state.load();

		state.updateDraft('{');
		await state.flushPendingChanges();

		expect(client.updateStatusAnimation).not.toHaveBeenCalled();
		expect(state.source).toBe(validSource);
		expect(state.draft).toBe('{');
		expect(state.errorMessage).toContain('配置未保存：JSON 解析失败');
		state.dispose();
	});

	it('does not accept a write failure as the current configuration', async () => {
		const client = new FakeStatusAnimationConfigClient();
		client.getStatusAnimationSource.mockResolvedValue({
			source: DEFAULT_STATUS_ANIMATION_SOURCE,
			custom: false,
		});
		client.updateStatusAnimation.mockRejectedValue(new Error('Fcitx 不可用'));
		const state = new StatusAnimationState(client);
		await state.load();

		state.updateDraft(validSource);
		await state.flushPendingChanges();

		expect(state.source).toBe(DEFAULT_STATUS_ANIMATION_SOURCE);
		expect(state.draft).toBe(validSource);
		expect(state.errorMessage).toBe('状态动画配置操作失败：Fcitx 不可用');
		state.dispose();
	});

	it('shows defaults without treating an absent custom file as an edit', async () => {
		const client = new FakeStatusAnimationConfigClient();
		client.getStatusAnimationSource.mockResolvedValue({
			source: DEFAULT_STATUS_ANIMATION_SOURCE,
			custom: false,
		});
		const state = new StatusAnimationState(client);

		await state.load();
		await state.flushPendingChanges();

		expect(state.draft).toBe(DEFAULT_STATUS_ANIMATION_SOURCE);
		expect(state.isDirty).toBe(false);
		expect(state.hasCustomConfig).toBe(false);
		expect(client.updateStatusAnimation).not.toHaveBeenCalled();
		state.dispose();
	});
});
