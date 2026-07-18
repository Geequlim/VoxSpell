import { describe, expect, it } from 'vitest';
import { createFcitxKeyName, formatFcitxKeyName } from './fcitx-key';

describe('Fcitx key names', () => {
	it('creates a key name from a captured shortcut', () => {
		expect(createFcitxKeyName('space', ['Control', 'Shift'])).toBe('Control+Shift+space');
		expect(createFcitxKeyName('A', ['Alt'])).toBe('Alt+a');
	});

	it('ignores a modifier without a trigger key', () => {
		expect(createFcitxKeyName('Control_L', [])).toBeUndefined();
	});

	it('formats a stored key name for display', () => {
		expect(formatFcitxKeyName('Control+Shift+space')).toBe('Ctrl + Shift + Space');
		expect(formatFcitxKeyName('Page_Down')).toBe('Page Down');
	});
});
