export const pageDefinitions = [
	{ id: 'overview', title: '概览', iconName: 'view-grid-symbolic' },
	{ id: 'recognition', title: '语音识别', iconName: 'audio-input-microphone-symbolic' },
	{ id: 'input-behavior', title: '输入行为', iconName: 'input-keyboard-symbolic' },
	{ id: 'dictionary', title: '用户词典', iconName: 'accessories-dictionary-symbolic' },
	{ id: 'ai-polishing', title: 'AI 润色', iconName: 'tool-magic-symbolic' },
	{ id: 'diagnostics', title: '诊断', iconName: 'utilities-system-monitor-symbolic' },
	{ id: 'about', title: '关于', iconName: 'help-about-symbolic' },
] as const;

export type PageId = (typeof pageDefinitions)[number]['id'];
