import { afterEach, describe, expect, it, vi } from 'vitest';

import { ManagedAliyunVocabulary } from '../src/managed-vocabulary.js';

describe('ManagedAliyunVocabulary', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('creates an internal vocabulary from valid VoxSpell terms', async () => {
		const request = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ output: { vocabulary_id: 'vocab-1' } }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		);
		vi.stubGlobal('fetch', request);
		const vocabulary = createVocabulary();

		await expect(
			vocabulary.resolve([
				{ text: 'VoxSpell', weight: 5 },
				{ text: '超过十五个中文字符的词条不会被发送给阿里云服务', weight: 5 },
			]),
		).resolves.toBe('vocab-1');
		expect(JSON.parse(request.mock.calls[0]?.[1]?.body as string)).toMatchObject({
			model: 'speech-biasing',
			input: {
				action: 'create_vocabulary',
				target_model: 'fun-asr-realtime',
				vocabulary: [{ text: 'VoxSpell', weight: 5 }],
			},
		});
	});

	it('silently degrades when Alibaba vocabulary maintenance fails', async () => {
		const reportFailure = vi.fn();
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failure')));
		const vocabulary = createVocabulary(reportFailure);

		await expect(
			vocabulary.resolve([{ text: 'VoxSpell', weight: 4 }]),
		).resolves.toBeUndefined();
		expect(reportFailure).toHaveBeenCalledOnce();
	});
});

function createVocabulary(reportFailure?: () => void): ManagedAliyunVocabulary {
	return new ManagedAliyunVocabulary({
		providerId: 'aliyun',
		apiKey: 'secret',
		workspaceId: 'workspace',
		domain: 'workspace.cn-beijing.maas.aliyuncs.com',
		model: 'fun-asr-realtime',
		reportFailure,
	});
}
