import { describe, expect, it } from 'vitest';

import { composePolishSystemPrompt } from '../src/polish-system-prompt.js';

describe('composePolishSystemPrompt', () => {
	it('keeps the configured prompt unchanged when the dictionary is empty', () => {
		expect(composePolishSystemPrompt('只返回正文。', [])).toBe('只返回正文。');
	});

	it('appends a stable JSON dictionary block', () => {
		expect(
			composePolishSystemPrompt('只返回正文。', [
				{ canonical: 'SDK', aliases: ['开发者工具包'] },
				{ canonical: 'Codex', aliases: ['扣得克斯', '口袋克斯'] },
			]),
		).toBe(
			'只返回正文。\n\n<voice_dictionary>\n' +
				'[{"canonical":"Codex","aliases":["口袋克斯","扣得克斯"]},{"canonical":"SDK","aliases":["开发者工具包"]}]\n' +
				'</voice_dictionary>',
		);
	});
});
