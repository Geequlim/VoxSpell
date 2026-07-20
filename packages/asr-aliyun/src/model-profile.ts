export type AliyunAsrModel =
	| 'fun-asr-realtime'
	| 'paraformer-realtime-v2'
	| 'qwen3-asr-flash-realtime';

export type AliyunRegion = 'cn-beijing' | 'ap-southeast-1';
export type AliyunProtocol = 'dashscope-duplex' | 'qwen-realtime';

export interface AliyunLanguage {
	readonly value: string;
	readonly title: string;
}

export interface AliyunAsrModelProfile {
	readonly id: AliyunAsrModel;
	readonly title: string;
	readonly protocol: AliyunProtocol;
	readonly regions: readonly AliyunRegion[];
	readonly languages: readonly AliyunLanguage[];
	readonly supportsVocabulary: boolean;
	readonly supportsContext: boolean;
	readonly supportsTimestamps: boolean;
}

const QWEN_LANGUAGES: readonly AliyunLanguage[] = [
	{ value: 'zh', title: '中文（普通话及方言）' },
	{ value: 'yue', title: '粤语' },
	{ value: 'en', title: '英语' },
	{ value: 'ja', title: '日语' },
	{ value: 'de', title: '德语' },
	{ value: 'ko', title: '韩语' },
	{ value: 'ru', title: '俄语' },
	{ value: 'fr', title: '法语' },
	{ value: 'pt', title: '葡萄牙语' },
	{ value: 'ar', title: '阿拉伯语' },
	{ value: 'it', title: '意大利语' },
	{ value: 'es', title: '西班牙语' },
	{ value: 'hi', title: '印地语' },
	{ value: 'id', title: '印尼语' },
	{ value: 'th', title: '泰语' },
	{ value: 'tr', title: '土耳其语' },
	{ value: 'uk', title: '乌克兰语' },
	{ value: 'vi', title: '越南语' },
	{ value: 'cs', title: '捷克语' },
	{ value: 'da', title: '丹麦语' },
	{ value: 'fil', title: '菲律宾语' },
	{ value: 'fi', title: '芬兰语' },
	{ value: 'is', title: '冰岛语' },
	{ value: 'ms', title: '马来语' },
	{ value: 'no', title: '挪威语' },
	{ value: 'pl', title: '波兰语' },
	{ value: 'sv', title: '瑞典语' },
];

const FUN_LANGUAGES: readonly AliyunLanguage[] = [
	{ value: 'zh', title: '中文（普通话及方言）' },
	{ value: 'en', title: '英语' },
	{ value: 'ja', title: '日语' },
	{ value: 'ko', title: '韩语' },
	{ value: 'vi', title: '越南语' },
	{ value: 'th', title: '泰语' },
	{ value: 'id', title: '印尼语' },
	{ value: 'ms', title: '马来语' },
	{ value: 'hi', title: '印地语' },
	{ value: 'ar', title: '阿拉伯语' },
	{ value: 'fr', title: '法语' },
	{ value: 'de', title: '德语' },
	{ value: 'es', title: '西班牙语' },
	{ value: 'pt', title: '葡萄牙语' },
	{ value: 'ru', title: '俄语' },
	{ value: 'it', title: '意大利语' },
	{ value: 'tl', title: '菲律宾语' },
	{ value: 'nl', title: '荷兰语' },
	{ value: 'sv', title: '瑞典语' },
	{ value: 'da', title: '丹麦语' },
	{ value: 'fi', title: '芬兰语' },
	{ value: 'no', title: '挪威语' },
	{ value: 'el', title: '希腊语' },
	{ value: 'pl', title: '波兰语' },
	{ value: 'cs', title: '捷克语' },
	{ value: 'hu', title: '匈牙利语' },
	{ value: 'ro', title: '罗马尼亚语' },
	{ value: 'bg', title: '保加利亚语' },
	{ value: 'hr', title: '克罗地亚语' },
	{ value: 'sk', title: '斯洛伐克语' },
];

const PARAFORMER_LANGUAGES: readonly AliyunLanguage[] = [
	{ value: 'zh', title: '中文' },
	{ value: 'yue', title: '粤语' },
	{ value: 'en', title: '英语' },
	{ value: 'ja', title: '日语' },
	{ value: 'ko', title: '韩语' },
	{ value: 'de', title: '德语' },
	{ value: 'fr', title: '法语' },
	{ value: 'ru', title: '俄语' },
];

export const ALIYUN_ASR_MODEL_PROFILES: readonly AliyunAsrModelProfile[] = [
	{
		id: 'fun-asr-realtime',
		title: 'Fun-ASR 实时识别',
		protocol: 'dashscope-duplex',
		regions: ['cn-beijing', 'ap-southeast-1'],
		languages: FUN_LANGUAGES,
		supportsVocabulary: true,
		supportsContext: true,
		supportsTimestamps: true,
	},
	{
		id: 'paraformer-realtime-v2',
		title: 'Paraformer 实时识别 V2',
		protocol: 'dashscope-duplex',
		regions: ['cn-beijing'],
		languages: PARAFORMER_LANGUAGES,
		supportsVocabulary: true,
		supportsContext: false,
		supportsTimestamps: true,
	},
	{
		id: 'qwen3-asr-flash-realtime',
		title: 'Qwen3-ASR Flash 实时识别',
		protocol: 'qwen-realtime',
		regions: ['cn-beijing', 'ap-southeast-1'],
		languages: QWEN_LANGUAGES,
		supportsVocabulary: false,
		supportsContext: false,
		supportsTimestamps: false,
	},
];

/** 返回已登记模型的协议和能力。 */
export function getAliyunAsrModelProfile(model: AliyunAsrModel): AliyunAsrModelProfile {
	const profile = ALIYUN_ASR_MODEL_PROFILES.find((item) => item.id === model);
	if (!profile) throw new Error(`Unsupported Aliyun ASR model: ${model}`);
	return profile;
}

/** 返回地域对应的百炼专属域名。 */
export function getAliyunDomain(region: AliyunRegion, workspaceId: string): string {
	return `${workspaceId}.${region}.maas.aliyuncs.com`;
}
