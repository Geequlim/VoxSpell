import { describe, expect, it } from 'vitest';

import { TranscriptAssembler } from '../src/transcript-assembler.js';

describe('TranscriptAssembler', () => {
	it('replaces a segment when ASR publishes a newer correction', () => {
		const assembler = new TranscriptAssembler();

		expect(
			assembler.update({
				type: 'partial',
				segmentId: 'segment-1',
				revision: 0,
				text: '今天下午三点开会',
			}),
		).toBe('今天下午三点开会');
		expect(
			assembler.update({
				type: 'partial',
				segmentId: 'segment-1',
				revision: 1,
				text: '今天下午三点我们开会',
			}),
		).toBe('今天下午三点我们开会');
	});

	it('ignores stale revisions and combines segments in arrival order', () => {
		const assembler = new TranscriptAssembler();
		assembler.update({
			type: 'partial',
			segmentId: 'segment-1',
			revision: 2,
			text: '第一句。',
		});

		expect(
			assembler.update({
				type: 'partial',
				segmentId: 'segment-1',
				revision: 1,
				text: '过期内容',
			}),
		).toBeUndefined();
		expect(
			assembler.update({
				type: 'segment-final',
				segmentId: 'segment-2',
				text: '第二句。',
			}),
		).toBe('第一句。第二句。');
	});

	it('does not let a partial overwrite a finalized segment', () => {
		const assembler = new TranscriptAssembler();
		assembler.update({ type: 'segment-final', segmentId: 'segment-1', text: '最终结果' });

		expect(
			assembler.update({
				type: 'partial',
				segmentId: 'segment-1',
				revision: 9,
				text: '迟到内容',
			}),
		).toBeUndefined();
		expect(assembler.text).toBe('最终结果');
	});
});
