import { getAsrProviderCredentialNames } from '@voxspell/config/asr-provider';
import { toJS } from 'mobx';
import { ResponseError } from 'vscode-jsonrpc';

import { action, derived, disposeState, effect, state, value } from './index';

import type { AsrProviderConfig, VoxSpellConfig } from '@voxspell/config/config-schema';
import type {
	CredentialsGetStatusResult,
	CredentialsUpdateParams,
} from '@voxspell/protocol/credentials';
import type { ProtocolErrorData } from '@voxspell/protocol/errors';
import type { DaemonState } from './daemon-state';

export type ConfigOperationPhase = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

export interface ConfigClient {
	getConfig(): Promise<VoxSpellConfig | null>;
	validateConfig(config: VoxSpellConfig): Promise<void>;
	updateConfig(config: VoxSpellConfig): Promise<void>;
	getCredentialsStatus(): Promise<CredentialsGetStatusResult>;
	updateCredentials(params: CredentialsUpdateParams): Promise<void>;
}

/** 管理配置草稿、凭据更新及 daemon 配置保存闭环。 */
@state
export class ConfigState {
	@value config?: VoxSpellConfig;
	@value draft?: VoxSpellConfig;
	@value storedCredentialNames: readonly string[] = [];
	@value pendingCredentialValues: Record<string, string> = {};
	@value selectedCredentialName?: string;
	@value phase: ConfigOperationPhase = 'idle';
	@value errorMessage?: string;
	@value fieldErrors: Record<string, string> = {};
	private readonly $client: ConfigClient;
	private readonly $daemon: DaemonState;
	private $loadId = 0;
	private $loaded = false;

	constructor(client: ConfigClient, daemon: DaemonState) {
		this.$client = client;
		this.$daemon = daemon;
	}

	@derived get providerIds(): readonly string[] {
		return this.draft?.asr.providers.map((provider) => provider.id) ?? [];
	}

	@derived get activeProvider(): AsrProviderConfig | undefined {
		return this.draft?.asr.providers.find(
			(provider) => provider.id === this.draft?.asr.activeProvider,
		);
	}

	@derived get selectedProviderIndex(): number {
		const activeProviderId = this.draft?.asr.activeProvider;
		const index = this.providerIds.findIndex((providerId) => providerId === activeProviderId);
		return Math.max(index, 0);
	}

	@derived get providerTypeTitle(): string {
		if (this.activeProvider?.type === 'openai-compatible-transcription') {
			return 'OpenAI 兼容转写接口';
		}
		if (this.activeProvider?.type === 'tencent-realtime') return '腾讯云实时语音识别';
		return '';
	}

	@derived get baseUrl(): string {
		const provider = this.activeProvider;
		return provider?.type === 'openai-compatible-transcription' ? provider.baseUrl : '';
	}

	@derived get model(): string {
		const provider = this.activeProvider;
		return provider?.type === 'openai-compatible-transcription' ? provider.model : '';
	}

	@derived get engineModelType(): string {
		const provider = this.activeProvider;
		return provider?.type === 'tencent-realtime' ? provider.engineModelType : '';
	}

	@derived get showsOpenAiFields(): boolean {
		return this.activeProvider?.type === 'openai-compatible-transcription';
	}

	@derived get showsTencentFields(): boolean {
		return this.activeProvider?.type === 'tencent-realtime';
	}

	@derived get requiredCredentialNames(): readonly string[] {
		if (!this.draft) return [];
		return getAsrProviderCredentialNames(this.draft);
	}

	@derived get selectedCredentialIndex(): number {
		const index = this.requiredCredentialNames.findIndex(
			(name) => name === this.selectedCredentialName,
		);
		return Math.max(index, 0);
	}

	@derived get selectedCredentialValue(): string {
		if (!this.selectedCredentialName) return '';
		return this.pendingCredentialValues[this.selectedCredentialName] ?? '';
	}

	@derived get selectedCredentialStatus(): string {
		const name = this.selectedCredentialName;
		if (!name) return '当前 Provider 不需要凭据';
		if (this.pendingCredentialValues[name]) return '已输入新值，保存后生效';
		if (this.storedCredentialNames.includes(name)) return '已安全存储';
		const activeProviderId = this.draft?.asr.activeProvider;
		const status = this.$daemon.status;
		if (
			status &&
			status.activeProvider === activeProviderId &&
			!status.missingCredentialNames.includes(name)
		) {
			return '由 daemon 运行环境提供';
		}
		return '尚未存入应用凭据库';
	}

	@derived get isDirty(): boolean {
		if (!this.draft) return false;
		const configChanged = JSON.stringify(this.config) !== JSON.stringify(this.draft);
		const credentialsChanged = Object.values(this.pendingCredentialValues).some(Boolean);
		return configChanged || credentialsChanged;
	}

	@derived get isEditable(): boolean {
		return this.$daemon.connectionPhase === 'connected' && this.phase !== 'loading';
	}

	@derived get canSave(): boolean {
		return this.isEditable && this.phase !== 'saving' && this.isDirty;
	}

	@derived get canReload(): boolean {
		return (
			this.$daemon.connectionPhase === 'connected' &&
			this.phase !== 'loading' &&
			this.phase !== 'saving'
		);
	}

	@derived get operationDescription(): string {
		if (this.phase === 'loading') return '正在读取 daemon 配置…';
		if (this.phase === 'saving') return '正在校验并保存配置…';
		if (this.phase === 'saved') return '配置已保存并应用。';
		if (this.phase === 'error') return this.errorMessage ?? '配置操作失败。';
		if (!this.config && this.draft) return '尚无配置，请填写后保存第一份配置。';
		return '';
	}

	/** 根据 daemon 连接状态加载配置或停止当前加载。 */
	@effect syncDaemonConnection(): void {
		if (this.$daemon.connectionPhase === 'connected') {
			if (!this.$loaded) void this.load();
			return;
		}
		this.applyDisconnected();
	}

	@action private applyDisconnected(): void {
		this.$loadId += 1;
		this.$loaded = false;
		this.phase = 'idle';
		this.errorMessage = undefined;
	}

	/** 从 daemon 重新读取配置与凭据状态。 */
	@action async load(): Promise<void> {
		if (this.$daemon.connectionPhase !== 'connected') return;
		const loadId = ++this.$loadId;
		this.phase = 'loading';
		this.errorMessage = undefined;
		try {
			const [config, credentials] = await Promise.all([
				this.$client.getConfig(),
				this.$client.getCredentialsStatus(),
			]);
			if (loadId !== this.$loadId) return;
			this.applyLoadedConfig(config, credentials);
		} catch (error) {
			if (loadId !== this.$loadId) return;
			this.applyOperationError(error);
		}
	}

	/** 切换当前编辑的既有 Provider。 */
	@action selectProvider(index: number): void {
		const providerId = this.providerIds[index];
		if (!this.draft || !providerId) return;
		this.draft.asr.activeProvider = providerId;
		this.selectFirstCredential();
		this.clearOperationResult();
	}

	/** 选择当前准备更新的凭据名称。 */
	@action selectCredential(index: number): void {
		this.selectedCredentialName = this.requiredCredentialNames[index];
	}

	/** 更新当前凭据的内存草稿，绝不回填已存储值。 */
	@action updateSelectedCredential(value: string): void {
		if (!this.selectedCredentialName) return;
		this.pendingCredentialValues[this.selectedCredentialName] = value;
		this.clearOperationResult();
	}

	/** 更新当前 OpenAI 兼容 Provider 的 API 地址。 */
	@action updateBaseUrl(value: string): void {
		const provider = this.activeProvider;
		if (provider?.type !== 'openai-compatible-transcription') return;
		provider.baseUrl = value;
		this.clearOperationResult();
	}

	/** 更新当前 OpenAI 兼容 Provider 的模型名称。 */
	@action updateModel(value: string): void {
		const provider = this.activeProvider;
		if (provider?.type !== 'openai-compatible-transcription') return;
		provider.model = value;
		this.clearOperationResult();
	}

	/** 更新当前腾讯实时 Provider 的引擎模型。 */
	@action updateEngineModelType(value: string): void {
		const provider = this.activeProvider;
		if (provider?.type !== 'tencent-realtime') return;
		provider.engineModelType = value;
		this.clearOperationResult();
	}

	/** 丢弃未保存的配置和凭据草稿。 */
	@action discard(): void {
		this.draft = structuredClone(toJS(this.config ?? createInitialConfig()));
		this.pendingCredentialValues = {};
		this.selectFirstCredential();
		this.clearOperationResult();
	}

	/** 校验并保存凭据与候选配置，然后刷新 daemon 状态。 */
	@action async save(): Promise<void> {
		if (!this.canSave || !this.draft) return;
		const candidate = structuredClone(toJS(this.draft));
		const provider = candidate.asr.providers.find(
			(item) => item.id === candidate.asr.activeProvider,
		);
		const fieldErrors: Record<string, string> = {};
		if (!provider) {
			fieldErrors.provider = '请选择有效的 Provider。';
		} else if (provider.type === 'openai-compatible-transcription') {
			provider.baseUrl = provider.baseUrl.trim();
			provider.model = provider.model.trim();
			if (!/^https?:\/\//.test(provider.baseUrl))
				fieldErrors.baseUrl = '请输入 HTTP(S) 地址。';
			if (!provider.model) fieldErrors.model = '请输入模型名称。';
		} else {
			provider.engineModelType = provider.engineModelType.trim();
			if (!provider.engineModelType) fieldErrors.engineModelType = '请输入引擎模型。';
		}
		if (Object.keys(fieldErrors).length > 0) {
			this.fieldErrors = fieldErrors;
			this.phase = 'error';
			this.errorMessage = '请修正表单中的配置项。';
			return;
		}

		const credentialEntries = Object.entries(this.pendingCredentialValues)
			.filter(([, value]) => value.length > 0)
			.map(([name, value]) => ({ name, value }));
		this.phase = 'saving';
		this.errorMessage = undefined;
		this.fieldErrors = {};
		try {
			if (credentialEntries.length > 0) {
				await this.$client.updateCredentials({ set: credentialEntries, delete: [] });
				this.applyStoredCredentials(credentialEntries.map((entry) => entry.name));
			}
			await this.$client.validateConfig(candidate);
			await this.$client.updateConfig(candidate);
			const [config, credentials] = await Promise.all([
				this.$client.getConfig(),
				this.$client.getCredentialsStatus(),
			]);
			this.applySavedConfig(config, credentials);
			await this.$daemon.refresh();
		} catch (error) {
			this.applyOperationError(error);
		}
	}

	/** 释放 MobX effect。 */
	dispose(): void {
		this.$loadId += 1;
		disposeState(this);
	}

	@action private applyLoadedConfig(
		config: VoxSpellConfig | null,
		credentials: CredentialsGetStatusResult,
	): void {
		this.config = config ?? undefined;
		this.draft = structuredClone(config ?? createInitialConfig());
		this.storedCredentialNames = credentials.storedNames;
		this.pendingCredentialValues = {};
		this.phase = 'idle';
		this.errorMessage = undefined;
		this.fieldErrors = {};
		this.$loaded = true;
		this.selectFirstCredential();
	}

	@action private applyStoredCredentials(names: readonly string[]): void {
		this.storedCredentialNames = [...new Set([...this.storedCredentialNames, ...names])].sort();
		this.pendingCredentialValues = {};
	}

	@action private applySavedConfig(
		config: VoxSpellConfig | null,
		credentials: CredentialsGetStatusResult,
	): void {
		if (!config) throw new Error('Daemon returned an empty configuration after update');
		this.config = config;
		this.draft = structuredClone(config);
		this.storedCredentialNames = credentials.storedNames;
		this.pendingCredentialValues = {};
		this.phase = 'saved';
		this.errorMessage = undefined;
		this.fieldErrors = {};
		this.$loaded = true;
		this.selectFirstCredential();
	}

	@action private applyOperationError(error: unknown): void {
		this.phase = 'error';
		this.errorMessage = describeConfigError(error);
	}

	private selectFirstCredential(): void {
		this.selectedCredentialName = this.requiredCredentialNames[0];
	}

	private clearOperationResult(): void {
		this.phase = 'idle';
		this.errorMessage = undefined;
		this.fieldErrors = {};
	}
}

/** 创建首次配置所需的最小 OpenAI 兼容 Provider 草稿。 */
function createInitialConfig(): VoxSpellConfig {
	return {
		version: 1,
		asr: {
			activeProvider: 'openai',
			providers: [
				{
					id: 'openai',
					type: 'openai-compatible-transcription',
					baseUrl: 'https://api.openai.com/v1',
					apiKeyEnvironment: 'OPENAI_API_KEY',
					model: '',
				},
			],
		},
	};
}

function describeConfigError(error: unknown): string {
	if (error instanceof ResponseError) {
		const data = error.data as ProtocolErrorData | undefined;
		if (data?.code === 'CREDENTIAL_MISSING') return 'Provider 所需凭据尚未配置完整。';
		if (data?.code === 'CONFIG_INVALID') return 'Daemon 拒绝了无效配置。';
		if (data?.code === 'CONFIG_APPLY_FAILED') return '配置无法应用，原配置仍然有效。';
	}
	return '无法完成配置操作，请检查 daemon 连接后重试。';
}
