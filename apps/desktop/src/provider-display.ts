const providerDisplayNames: Readonly<Record<string, string>> = {
	tencent: '腾讯云',
	glm: '智谱 AI',
	openrouter: 'OpenRouter',
	openai: 'OpenAI',
};

/** 返回适合桌面界面展示的识别服务名称，未知服务保留其配置标识。 */
export function getProviderDisplayName(providerId: string): string {
	return providerDisplayNames[providerId] ?? providerId;
}
