import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_STATUS_ANIMATION_SOURCE,
	FileStatusAnimationConfigClient,
	validateStatusAnimationSource,
} from './status-animation-config-client';

const originalSource = JSON.stringify([
	{
		id: 'recording',
		frames: ['A'],
		text: '正在录音',
		interval: 100,
	},
]);
const replacementSource = JSON.stringify([
	{
		id: 'recording',
		frames: ['B'],
		text: '请讲话',
		interval: 180,
	},
]);

describe('status animation validation', () => {
	it('accepts the same partial stage overrides as the Fcitx addon', () => {
		expect(validateStatusAnimationSource(originalSource)).toBe(originalSource);
	});

	it('rejects malformed and unsupported animation stages', () => {
		expect(() => validateStatusAnimationSource('{')).toThrow('JSON 解析失败');
		expect(() => validateStatusAnimationSource('{}')).toThrow('最外层必须是动画阶段数组');
		expect(() =>
			validateStatusAnimationSource(
				JSON.stringify([{ id: 'unknown', frames: ['A'], text: '未知', interval: 100 }]),
			),
		).toThrow('未知 id');
		expect(() =>
			validateStatusAnimationSource(
				JSON.stringify([{ id: 'recording', frames: [], text: '录音', interval: 100 }]),
			),
		).toThrow('至少需要一个动画帧');
	});
});

describe('FileStatusAnimationConfigClient', () => {
	it('returns the complete defaults when no custom file exists', async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'voxspell-animation-'));
		const client = new FileStatusAnimationConfigClient(
			path.join(directory, 'missing.json'),
			'/tmp/editor.html',
			async () => undefined,
			async () => undefined,
		);

		await expect(client.getStatusAnimationSource()).resolves.toEqual({
			source: DEFAULT_STATUS_ANIMATION_SOURCE,
			custom: false,
		});
		expect(JSON.parse(DEFAULT_STATUS_ANIMATION_SOURCE)).toHaveLength(8);
	});

	it('atomically writes a valid source and reloads Fcitx', async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'voxspell-animation-'));
		const configFile = path.join(directory, 'voxspell', 'status-animation.json');
		const reloadConfig = vi.fn(async () => undefined);
		const client = new FileStatusAnimationConfigClient(
			configFile,
			'/tmp/editor.html',
			reloadConfig,
			async () => undefined,
		);

		await client.updateStatusAnimation(validateStatusAnimationSource(replacementSource));

		expect(await readFile(configFile, 'utf8')).toBe(replacementSource);
		expect(reloadConfig).toHaveBeenCalledOnce();
	});

	it('restores the previous file when Fcitx cannot reload the candidate', async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'voxspell-animation-'));
		const configDirectory = path.join(directory, 'voxspell');
		const configFile = path.join(configDirectory, 'status-animation.json');
		await mkdir(configDirectory);
		await writeFile(configFile, originalSource);
		const reloadConfig = vi
			.fn<() => Promise<void>>()
			.mockRejectedValueOnce(new Error('Fcitx 不可用'))
			.mockResolvedValueOnce();
		const client = new FileStatusAnimationConfigClient(
			configFile,
			'/tmp/editor.html',
			reloadConfig,
			async () => undefined,
		);

		await expect(
			client.updateStatusAnimation(validateStatusAnimationSource(replacementSource)),
		).rejects.toThrow('Fcitx 不可用');

		expect(await readFile(configFile, 'utf8')).toBe(originalSource);
		expect(reloadConfig).toHaveBeenCalledTimes(2);
	});
});
