import { describe, expect, it } from 'vitest';

import { DefaultTextPipeline, PolishedTextValidationError } from '../src/text-pipeline.js';

const pipeline = new DefaultTextPipeline();
const signal = new AbortController().signal;

describe('DefaultTextPipeline', () => {
	it('trims and accepts a plain polished result', async () => {
		await expect(
			pipeline.processPolished(
				{
					transcript: '今天下午三点开会',
					polished: ' 今天下午三点，我们开会。 ',
					dictionary: [],
				},
				signal,
			),
		).resolves.toBe('今天下午三点，我们开会。');
	});

	it.each([
		'',
		'<think>先分析一下</think>润色文本',
		'```text\n润色文本\n```',
		'润色结果如下：润色文本',
	])('rejects output wrapper %j', async (polished) => {
		await expect(
			pipeline.processPolished({ transcript: '原始文本', polished, dictionary: [] }, signal),
		).rejects.toBeInstanceOf(PolishedTextValidationError);
	});

	it('requires canonical terms already present in the transcript to be preserved', async () => {
		await expect(
			pipeline.processPolished(
				{
					transcript: '使用 Codex 修改代码',
					polished: '使用扣得克斯修改代码',
					dictionary: [{ canonical: 'Codex', aliases: ['扣得克斯'] }],
				},
				signal,
			),
		).rejects.toBeInstanceOf(PolishedTextValidationError);
	});
});
