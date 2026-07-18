import { describe, expect, it } from 'vitest';

import {
	countEffectiveCharacters,
	DefaultTextPipeline,
	PolishedTextValidationError,
} from '../src/text-pipeline.js';
import { CompiledVoiceDictionary } from '../src/voice-dictionary.js';

import type { VoiceDictionaryEntry } from '@voxspell/config/dictionary-schema';

const pipeline = new DefaultTextPipeline();
const signal = new AbortController().signal;

function compile(entries: readonly VoiceDictionaryEntry[] = []): CompiledVoiceDictionary {
	return new CompiledVoiceDictionary({ version: 1, entries: [...entries] });
}

describe('DefaultTextPipeline', () => {
	it('counts effective characters without whitespace or punctuation', () => {
		expect(countEffectiveCharacters('你好， C++！')).toBe(5);
	});

	it('trims configured terminal periods from transcript and polished text', async () => {
		const dictionary = compile();
		await expect(
			pipeline.processTranscript(
				{ text: '你好。', dictionary, trimTrailingPeriod: true },
				signal,
			),
		).resolves.toBe('你好');
		await expect(
			pipeline.processPolished(
				{
					transcript: 'Hello.',
					polished: 'Hello.',
					dictionary,
					trimTrailingPeriod: true,
				},
				signal,
			),
		).resolves.toBe('Hello');
		await expect(
			pipeline.processTranscript(
				{ text: '等等...', dictionary, trimTrailingPeriod: true },
				signal,
			),
		).resolves.toBe('等等...');
	});
	it('normalizes aliases with longest matching and remains idempotent', async () => {
		const dictionary = compile([
			{ term: 'Codex', aliases: ['扣得克斯'], protect: true, boost: 10, enabled: true },
			{ term: 'VoxSpell', aliases: ['voice spell'], protect: true, boost: 8, enabled: true },
		]);
		const normalized = await pipeline.processTranscript(
			{ text: '用扣得克斯开发 voice spell', dictionary, trimTrailingPeriod: false },
			signal,
		);

		expect(normalized).toBe('用Codex开发 VoxSpell');
		await expect(
			pipeline.processTranscript(
				{ text: normalized, dictionary, trimTrailingPeriod: false },
				signal,
			),
		).resolves.toBe(normalized);
	});

	it('does not replace an ASCII alias inside another word', async () => {
		const dictionary = compile([
			{ term: 'Go', aliases: ['go'], protect: true, boost: 5, enabled: true },
		]);
		await expect(
			pipeline.processTranscript(
				{ text: 'go with google', dictionary, trimTrailingPeriod: false },
				signal,
			),
		).resolves.toBe('Go with google');
	});

	it('trims, renormalizes and accepts a plain polished result', async () => {
		const dictionary = compile([
			{ term: 'Codex', aliases: ['扣得克斯'], protect: true, boost: 10, enabled: true },
		]);
		await expect(
			pipeline.processPolished(
				{
					transcript: '今天使用 Codex',
					polished: ' 今天使用扣得克斯。 ',
					dictionary,
					trimTrailingPeriod: false,
				},
				signal,
			),
		).resolves.toBe('今天使用Codex。');
	});

	it.each([
		'',
		'<think>先分析一下</think>润色文本',
		'```text\n润色文本\n```',
		'润色结果如下：润色文本',
	])('rejects output wrapper %j', async (polished) => {
		await expect(
			pipeline.processPolished(
				{
					transcript: '原始文本',
					polished,
					dictionary: compile(),
					trimTrailingPeriod: false,
				},
				signal,
			),
		).rejects.toBeInstanceOf(PolishedTextValidationError);
	});

	it('requires protected terms present in the transcript to be preserved', async () => {
		const dictionary = compile([
			{ term: 'Codex', aliases: ['扣得克斯'], protect: true, boost: 10, enabled: true },
		]);
		await expect(
			pipeline.processPolished(
				{
					transcript: '使用 Codex 修改代码',
					polished: '使用工具修改代码',
					dictionary,
					trimTrailingPeriod: false,
				},
				signal,
			),
		).rejects.toBeInstanceOf(PolishedTextValidationError);
	});
});
