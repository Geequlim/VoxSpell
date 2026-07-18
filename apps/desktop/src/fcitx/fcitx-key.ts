export type FcitxModifier = 'Control' | 'Alt' | 'Shift' | 'Super' | 'Hyper' | 'Meta';

const modifierKeyNames = new Set([
	'Shift_L',
	'Shift_R',
	'Control_L',
	'Control_R',
	'Alt_L',
	'Alt_R',
	'Super_L',
	'Super_R',
	'Hyper_L',
	'Hyper_R',
	'Meta_L',
	'Meta_R',
	'ISO_Level3_Shift',
]);

const modifierLabels: Readonly<Record<string, string>> = {
	Control: 'Ctrl',
	Alt: 'Alt',
	Shift: 'Shift',
	Super: 'Super',
	Hyper: 'Hyper',
	Meta: 'Meta',
};

/** 将 GDK 键名和修饰键组合为 Fcitx 可识别的键名。 */
export function createFcitxKeyName(
	keyName: string,
	modifiers: readonly FcitxModifier[],
): string | undefined {
	if (!keyName || modifierKeyNames.has(keyName)) return undefined;
	const normalizedKeyName = /^[A-Z]$/.test(keyName) ? keyName.toLowerCase() : keyName;
	return [...modifiers, normalizedKeyName].join('+');
}

/** 将 Fcitx 键名格式化为适合在配置界面展示的快捷键。 */
export function formatFcitxKeyName(keyName: string): string {
	if (!keyName) return '未设置';
	return keyName
		.split('+')
		.map((part) => modifierLabels[part] ?? formatKeyPart(part))
		.join(' + ');
}

function formatKeyPart(keyName: string): string {
	if (keyName === 'space') return 'Space';
	if (keyName.length === 1) return keyName.toUpperCase();
	return keyName.replaceAll('_', ' ');
}
