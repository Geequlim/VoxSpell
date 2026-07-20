import type { AsrProviderConfig } from './config-schema.js';

export type AsrProviderFieldInput = 'text' | 'url';

/** 描述一个由 Provider 实现公开、可由通用界面编辑的配置字段。 */
export interface AsrProviderFieldDefinition {
	readonly id: string;
	readonly title: string;
	readonly input: AsrProviderFieldInput;
	getValue(provider: AsrProviderConfig): string;
	setValue(provider: AsrProviderConfig, value: string): void;
}

/** 描述一个由 Provider 实现公开的凭据槽位。 */
export interface AsrProviderCredentialDefinition {
	readonly id: string;
	readonly title: string;
	getEnvironmentName(provider: AsrProviderConfig): string;
}

/** 描述 Provider 实现向配置界面公开的完整能力。 */
export interface AsrProviderDefinition {
	readonly type: AsrProviderConfig['type'];
	readonly title: string;
	readonly supportsRealtime: boolean;
	readonly fields: readonly AsrProviderFieldDefinition[];
	readonly credentials: readonly AsrProviderCredentialDefinition[];
	createDefaultConfig(providerId: string): AsrProviderConfig;
}
