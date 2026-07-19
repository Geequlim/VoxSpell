import { getAsrProviderCredentialNames } from '@voxspell/config/asr-provider';
import {
	DEFAULT_MAXIMUM_RECORDING_SECONDS,
	MAXIMUM_RECORDING_SECONDS,
	MINIMUM_RECORDING_SECONDS,
} from '@voxspell/config/config-schema';
import { DEFAULT_POLISH_SYSTEM_PROMPT } from '@voxspell/config/text-polishing-defaults';
import { toJS } from 'mobx';
import { ResponseError } from 'vscode-jsonrpc';

import { action, derived, disposeState, effect, state, value } from './index';
import { getProviderDisplayName } from '../provider-display';

import type { AsrProviderConfig, VoxSpellConfig } from '@voxspell/config/config-schema';
import type {
	CredentialsGetStatusResult,
	CredentialsUpdateParams,
} from '@voxspell/protocol/credentials';
import type { ProtocolErrorData } from '@voxspell/protocol/errors';
import type { ProviderTestResult } from '@voxspell/protocol/provider';
import type { DaemonState } from './daemon-state';

export type ConfigOperationPhase = 'idle' | 'loading' | 'saving' | 'testing' | 'saved' | 'error';

export interface ConfigClient {
	getConfig(): Promise<VoxSpellConfig | null>;
	validateConfig(config: VoxSpellConfig): Promise<void>;
	updateConfig(config: VoxSpellConfig): Promise<void>;
	getCredentialsStatus(): Promise<CredentialsGetStatusResult>;
	updateCredentials(params: CredentialsUpdateParams): Promise<void>;
	testProvider(providerId: string): Promise<ProviderTestResult>;
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
	@value selectedProviderIndex = 0;
	@value providerTestResult?: ProviderTestResult;
	private readonly $client: ConfigClient;
	private readonly $daemon: DaemonState;
	private $loadId = 0;
	private $loaded = false;
	private $disposed = false;
	private $saveTimer?: NodeJS.Timeout;
	private $savePromise?: Promise<void>;
	private $savePending = false;
	private $saveRequested = false;
	private readonly $credentialNamesReadyToSave = new Set<string>();

	constructor(client: ConfigClient, daemon: DaemonState) {
		this.$client = client;
		this.$daemon = daemon;
	}

	@derived get providerIds(): readonly string[] {
		return this.draft?.asr.providers.map((provider) => provider.id) ?? [];
	}

	@derived get providerDisplayNames(): readonly string[] {
		return this.providerIds.map((providerId) => getProviderDisplayName(providerId));
	}

	@derived get activeProvider(): AsrProviderConfig | undefined {
		return this.draft?.asr.providers[this.selectedProviderIndex];
	}

	@derived get providerTypeTitle(): string {
		if (this.activeProvider?.type === 'openai-compatible-transcription') {
			return 'OpenAI 兼容转写接口';
		}
		if (this.activeProvider?.type === 'tencent-realtime') return '腾讯云实时语音识别';
		return '';
	}

	@derived get providerId(): string {
		return this.activeProvider?.id ?? '';
	}

	@derived get providerDisplayName(): string {
		return getProviderDisplayName(this.providerId);
	}

	@derived get activeProviderSupportsRealtime(): boolean {
		return this.activeProvider?.type === 'tencent-realtime';
	}

	@derived get baseUrl(): string {
		const provider = this.activeProvider;
		return provider?.type === 'openai-compatible-transcription' ? provider.baseUrl : '';
	}

	@derived get model(): string {
		const provider = this.activeProvider;
		return provider?.type === 'openai-compatible-transcription' ? provider.model : '';
	}

	@derived get apiKeyEnvironment(): string {
		const provider = this.activeProvider;
		return provider?.type === 'openai-compatible-transcription'
			? provider.apiKeyEnvironment
			: '';
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

	@derived get polishingEnabled(): boolean {
		return this.draft?.polishing?.enabled ?? false;
	}

	@derived get polishingMinimumEffectiveCharacters(): number {
		return this.draft?.polishing?.minimumEffectiveCharacters ?? 0;
	}

	@derived get trimTrailingPeriod(): boolean {
		return this.draft?.textProcessing?.trimTrailingPeriod ?? false;
	}

	@derived get maximumRecordingSeconds(): number {
		return this.draft?.session?.maximumRecordingSeconds ?? DEFAULT_MAXIMUM_RECORDING_SECONDS;
	}

	@derived get activeTextPolisher() {
		const polishing = this.draft?.polishing;
		return polishing?.providers.find((provider) => provider.id === polishing.activeProvider);
	}

	@derived get polishingBaseUrl(): string {
		return this.activeTextPolisher?.baseUrl ?? '';
	}

	@derived get polishingModel(): string {
		return this.activeTextPolisher?.model ?? '';
	}

	@derived get polishingApiKeyEnvironment(): string {
		return this.activeTextPolisher?.apiKeyEnvironment ?? '';
	}

	@derived get polishingSystemPrompt(): string {
		return this.draft?.polishing?.systemPrompt ?? DEFAULT_POLISH_SYSTEM_PROMPT;
	}

	@derived get polishingCredentialValue(): string {
		const name = this.polishingApiKeyEnvironment;
		return name ? (this.pendingCredentialValues[name] ?? '') : '';
	}

	@derived get polishingCredentialStatus(): string {
		const name = this.polishingApiKeyEnvironment;
		if (!name) return '尚未配置凭据名称';
		if (this.pendingCredentialValues[name]) return '已输入新值，完成输入后自动保存';
		if (this.storedCredentialNames.includes(name)) return '已安全存储';
		if (!this.$daemon.status?.missingCredentialNames.includes(name)) {
			return '由 daemon 运行环境提供';
		}
		return '尚未存入应用凭据库';
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
		if (!name) return '当前识别服务不需要凭据';
		if (this.pendingCredentialValues[name]) return '已输入新值，完成输入后自动保存';
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
		return (
			this.$daemon.connectionPhase === 'connected' &&
			this.phase !== 'loading' &&
			this.phase !== 'testing'
		);
	}

	@derived get canDeleteProvider(): boolean {
		return this.isEditable && this.providerIds.length > 1;
	}

	@derived get canDeleteCredential(): boolean {
		const name = this.selectedCredentialName;
		return this.isEditable && Boolean(name && this.storedCredentialNames.includes(name));
	}

	@derived get canTestProvider(): boolean {
		return this.isEditable && Boolean(this.config) && !this.isDirty;
	}

	@derived get operationDescription(): string {
		if (this.phase === 'loading') return '正在读取 daemon 配置…';
		if (this.phase === 'saving') return '正在校验并自动保存配置…';
		if (this.phase === 'testing') return '正在测试识别服务连接…';
		if (this.phase === 'saved') return '更改已自动保存并应用。';
		if (this.phase === 'error') {
			const fieldErrorDescription = Object.entries(this.fieldErrors)
				.map(([field, error]) => `${getFieldLabel(field)}：${error}`)
				.join('；');
			return fieldErrorDescription || this.errorMessage || '配置操作失败。';
		}
		if (this.providerTestResult) {
			return `识别服务测试成功，耗时 ${this.providerTestResult.latencyMs} ms。`;
		}
		if (!this.config && this.draft) return '尚无配置，完成必填项后将自动保存。';
		return '';
	}

	@derived get operationTitle(): string {
		if (this.phase !== 'error') return '自动保存';
		const errorCount = Object.keys(this.fieldErrors).length;
		return errorCount > 0 ? `配置有 ${errorCount} 项需要修正` : '配置操作失败';
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
		if (this.$saveTimer) clearTimeout(this.$saveTimer);
		this.$saveTimer = undefined;
		this.$savePending = false;
		this.$saveRequested = false;
		this.$credentialNamesReadyToSave.clear();
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
		const provider = this.draft?.asr.providers[index];
		if (!this.draft || !provider) return;
		this.selectedProviderIndex = index;
		this.draft.asr.activeProvider = provider.id;
		this.selectFirstCredential();
		this.scheduleAutoSave();
	}

	/** 更新当前 Provider 的服务标识，并保持它处于选中状态。 */
	@action updateProviderId(value: string): void {
		const provider = this.activeProvider;
		if (!this.draft || !provider) return;
		provider.id = value;
		this.draft.asr.activeProvider = value;
		this.scheduleAutoSave(500);
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

	/** 将当前识别服务凭据标记为输入完成并立即自动保存。 */
	@action
	commitSelectedCredential(): void {
		if (!this.selectedCredentialName || !this.selectedCredentialValue) return;
		this.$credentialNamesReadyToSave.add(this.selectedCredentialName);
		this.scheduleAutoSave();
	}

	/** 更新当前 OpenAI 兼容 Provider 的 API 地址。 */
	@action updateBaseUrl(value: string): void {
		const provider = this.activeProvider;
		if (provider?.type !== 'openai-compatible-transcription') return;
		provider.baseUrl = value;
		this.scheduleAutoSave(500);
	}

	/** 更新当前 OpenAI 兼容 Provider 的模型名称。 */
	@action updateModel(value: string): void {
		const provider = this.activeProvider;
		if (provider?.type !== 'openai-compatible-transcription') return;
		provider.model = value;
		this.scheduleAutoSave(500);
	}

	/** 更新当前 OpenAI 兼容 Provider 的凭据名称。 */
	@action updateApiKeyEnvironment(value: string): void {
		const provider = this.activeProvider;
		if (provider?.type !== 'openai-compatible-transcription') return;
		provider.apiKeyEnvironment = value;
		this.selectFirstCredential();
		this.scheduleAutoSave(500);
	}

	/** 更新当前腾讯实时 Provider 的引擎模型。 */
	@action updateEngineModelType(value: string): void {
		const provider = this.activeProvider;
		if (provider?.type !== 'tencent-realtime') return;
		provider.engineModelType = value;
		this.scheduleAutoSave(500);
	}

	/** 启用或关闭 AI 文本润色。 */
	@action updatePolishingEnabled(enabled: boolean): void {
		this.getOrCreatePolishing().enabled = enabled;
		this.scheduleAutoSave();
	}

	/** 更新自动润色所需的最少有效字符数。 */
	@action updatePolishingMinimumEffectiveCharacters(minimumEffectiveCharacters: number): void {
		this.getOrCreatePolishing().minimumEffectiveCharacters = minimumEffectiveCharacters;
		this.scheduleAutoSave(300);
	}

	/** 设置是否裁剪最终文本尾部的句号。 */
	@action updateTrimTrailingPeriod(trimTrailingPeriod: boolean): void {
		if (!this.draft) return;
		this.draft.textProcessing = { trimTrailingPeriod };
		this.scheduleAutoSave();
	}

	/** 更新单次会话允许的最长录音时长。 */
	@action updateMaximumRecordingSeconds(maximumRecordingSeconds: number): void {
		if (!this.draft) return;
		this.draft.session = { maximumRecordingSeconds };
		this.scheduleAutoSave(300);
	}

	/** 更新 AI 润色 Provider 的 API 地址。 */
	@action updatePolishingBaseUrl(value: string): void {
		const provider = this.getOrCreateTextPolisher();
		provider.baseUrl = value;
		this.scheduleAutoSave(500);
	}

	/** 更新 AI 润色 Provider 的模型。 */
	@action updatePolishingModel(value: string): void {
		const provider = this.getOrCreateTextPolisher();
		provider.model = value;
		this.scheduleAutoSave(500);
	}

	/** 更新 AI 润色 Provider 的凭据名称。 */
	@action updatePolishingApiKeyEnvironment(value: string): void {
		this.getOrCreateTextPolisher().apiKeyEnvironment = value;
		this.scheduleAutoSave(500);
	}

	/** 更新 AI 润色 Provider 的待保存凭据。 */
	@action updatePolishingCredential(value: string): void {
		const name = this.polishingApiKeyEnvironment;
		if (!name) return;
		this.pendingCredentialValues[name] = value;
		this.clearOperationResult();
	}

	/** 将 AI 润色凭据标记为输入完成并立即自动保存。 */
	@action
	commitPolishingCredential(): void {
		const name = this.polishingApiKeyEnvironment;
		if (!name || !this.polishingCredentialValue) return;
		this.$credentialNamesReadyToSave.add(name);
		this.scheduleAutoSave();
	}

	/** 更新用户维护的基础系统提示词。 */
	@action updatePolishingSystemPrompt(value: string): void {
		this.getOrCreatePolishing().systemPrompt = value;
		this.scheduleAutoSave(800);
	}

	/** 恢复内置的 AI 润色系统提示词。 */
	@action resetPolishingSystemPrompt(): void {
		this.getOrCreatePolishing().systemPrompt = DEFAULT_POLISH_SYSTEM_PROMPT;
		this.scheduleAutoSave();
	}

	/** 校验并保存一份完整的新 Provider 与用户主动填写的凭据。 */
	async createProvider(
		provider: AsrProviderConfig,
		credentialEntries: readonly CredentialsUpdateParams['set'][number][],
	): Promise<boolean> {
		if (!this.draft || !this.isEditable) return false;
		await this.flushPendingChanges();
		if (!this.draft || this.phase === 'error') return false;

		const candidate = structuredClone(toJS(this.draft));
		const normalizedProvider = structuredClone(provider);
		normalizedProvider.id = normalizedProvider.id.trim();
		candidate.asr.providers.push(normalizedProvider);
		candidate.asr.activeProvider = normalizedProvider.id;
		const selectedProviderIndex = candidate.asr.providers.length - 1;
		const fieldErrors = validateConfigCandidate(candidate, selectedProviderIndex);
		if (Object.keys(fieldErrors).length > 0) {
			this.applyValidationErrors(fieldErrors);
			return false;
		}

		this.phase = 'saving';
		this.errorMessage = undefined;
		this.fieldErrors = {};
		try {
			if (credentialEntries.length > 0) {
				await this.$client.updateCredentials({ set: [...credentialEntries], delete: [] });
			}
			await this.$client.validateConfig(candidate);
			await this.$client.updateConfig(candidate);
			this.applyCreatedProvider(candidate, selectedProviderIndex, credentialEntries);
			await this.$daemon.refresh();
			return true;
		} catch (error) {
			this.applyOperationError(error);
			return false;
		}
	}

	/** 删除当前 Provider，并先切换到剩余的第一个 Provider。 */
	@action deleteActiveProvider(): void {
		if (!this.draft || this.draft.asr.providers.length <= 1) return;
		const credentialNames = this.requiredCredentialNames;
		this.draft.asr.providers.splice(this.selectedProviderIndex, 1);
		this.selectedProviderIndex = Math.min(
			this.selectedProviderIndex,
			this.draft.asr.providers.length - 1,
		);
		this.draft.asr.activeProvider = this.activeProvider!.id;
		credentialNames.forEach((name) => {
			delete this.pendingCredentialValues[name];
			this.$credentialNamesReadyToSave.delete(name);
		});
		this.selectFirstCredential();
		this.scheduleAutoSave();
	}

	/** 删除当前凭据在应用私有凭据库中的值。 */
	@action async deleteSelectedCredential(): Promise<void> {
		const name = this.selectedCredentialName;
		if (!name || !this.canDeleteCredential) return;
		this.phase = 'saving';
		this.errorMessage = undefined;
		try {
			await this.$client.updateCredentials({ set: [], delete: [name] });
			this.applyDeletedCredential(name);
			await this.$daemon.refresh();
		} catch (error) {
			this.applyOperationError(error);
		}
	}

	/** 测试当前已保存 Provider 的连接、模型和鉴权。 */
	@action async testProvider(): Promise<void> {
		const providerId = this.config?.asr.activeProvider;
		if (!providerId || !this.canTestProvider) return;
		this.phase = 'testing';
		this.errorMessage = undefined;
		this.providerTestResult = undefined;
		try {
			const result = await this.$client.testProvider(providerId);
			this.applyProviderTestResult(result);
		} catch (error) {
			this.applyOperationError(error);
		}
	}

	/** 立即提交尚未触发的配置和凭据自动保存任务。 */
	async flushPendingChanges(): Promise<void> {
		Object.entries(this.pendingCredentialValues).forEach(([name, value]) => {
			if (!value) return;
			this.$credentialNamesReadyToSave.add(name);
			this.$savePending = true;
		});
		await this.flushAutoSave();
	}

	private async flushAutoSave(): Promise<void> {
		if (this.$saveTimer) {
			clearTimeout(this.$saveTimer);
			this.$saveTimer = undefined;
		}
		if (this.$disposed) return;
		if (this.$savePending) {
			this.$savePending = false;
			if (this.isDirty) this.$saveRequested = true;
		}
		if (this.$savePromise) return this.$savePromise;
		if (!this.$saveRequested) return;
		const savePromise = this.runAutoSaveLoop();
		this.$savePromise = savePromise;
		try {
			await savePromise;
		} finally {
			if (this.$savePromise === savePromise) this.$savePromise = undefined;
		}
	}

	private async runAutoSaveLoop(): Promise<void> {
		while (this.$saveRequested && !this.$disposed) {
			this.$saveRequested = false;
			await this.persistCurrentDraft();
		}
	}

	/** 校验并自动保存当前配置快照，然后刷新 daemon 状态。 */
	@action private async persistCurrentDraft(): Promise<void> {
		if (!this.draft || !this.isDirty) return;
		const draftSnapshot = structuredClone(toJS(this.draft));
		const candidate = structuredClone(draftSnapshot);
		const selectedProvider = candidate.asr.providers[this.selectedProviderIndex];
		if (selectedProvider) {
			selectedProvider.id = selectedProvider.id.trim();
			candidate.asr.activeProvider = selectedProvider.id;
		}
		const fieldErrors = validateConfigCandidate(candidate, this.selectedProviderIndex);
		if (Object.keys(fieldErrors).length > 0) {
			this.applyValidationErrors(fieldErrors);
			return;
		}

		const credentialEntries = Object.entries(this.pendingCredentialValues)
			.filter(
				([name, value]) => value.length > 0 && this.$credentialNamesReadyToSave.has(name),
			)
			.map(([name, value]) => ({ name, value }));
		this.phase = 'saving';
		this.errorMessage = undefined;
		this.fieldErrors = {};
		try {
			if (credentialEntries.length > 0) {
				await this.$client.updateCredentials({ set: credentialEntries, delete: [] });
			}
			await this.$client.validateConfig(candidate);
			await this.$client.updateConfig(candidate);
			this.applyAutoSaved(candidate, credentialEntries, draftSnapshot);
			await this.$daemon.refresh();
		} catch (error) {
			this.applyOperationError(error);
		}
	}

	/** 释放 MobX effect。 */
	dispose(): void {
		this.$disposed = true;
		this.$loadId += 1;
		if (this.$saveTimer) clearTimeout(this.$saveTimer);
		this.$saveTimer = undefined;
		disposeState(this);
	}

	private scheduleAutoSave(delayMilliseconds = 0): void {
		if (this.$disposed) return;
		if (this.$saveTimer) clearTimeout(this.$saveTimer);
		this.clearOperationResult();
		this.$savePending = true;
		this.$saveTimer = setTimeout(() => {
			this.$saveTimer = undefined;
			void this.flushAutoSave();
		}, delayMilliseconds);
	}

	@action private applyLoadedConfig(
		config: VoxSpellConfig | null,
		credentials: CredentialsGetStatusResult,
	): void {
		this.config = config ?? undefined;
		this.draft = structuredClone(config ?? createInitialConfig());
		const selectedProviderIndex = this.draft.asr.providers.findIndex(
			(provider) => provider.id === this.draft?.asr.activeProvider,
		);
		this.selectedProviderIndex = Math.max(selectedProviderIndex, 0);
		this.storedCredentialNames = credentials.storedNames;
		this.pendingCredentialValues = {};
		this.$credentialNamesReadyToSave.clear();
		this.phase = 'idle';
		this.errorMessage = undefined;
		this.fieldErrors = {};
		this.$loaded = true;
		this.selectFirstCredential();
	}

	@action private applyDeletedCredential(name: string): void {
		this.storedCredentialNames = this.storedCredentialNames.filter((item) => item !== name);
		delete this.pendingCredentialValues[name];
		this.$credentialNamesReadyToSave.delete(name);
		this.phase = 'saved';
		this.errorMessage = undefined;
	}

	@action private applyProviderTestResult(result: ProviderTestResult): void {
		this.providerTestResult = result;
		this.phase = 'idle';
		this.errorMessage = undefined;
	}

	@action private applyAutoSaved(
		config: VoxSpellConfig,
		credentialEntries: readonly CredentialsUpdateParams['set'][number][],
		draftSnapshot: VoxSpellConfig = config,
	): void {
		this.config = config;
		if (JSON.stringify(this.draft) === JSON.stringify(draftSnapshot)) {
			this.draft = structuredClone(config);
		}
		const savedNames = credentialEntries.map((entry) => entry.name);
		this.storedCredentialNames = [
			...new Set([...this.storedCredentialNames, ...savedNames]),
		].sort();
		credentialEntries.forEach(({ name, value }) => {
			this.$credentialNamesReadyToSave.delete(name);
			if (this.pendingCredentialValues[name] === value)
				delete this.pendingCredentialValues[name];
		});
		this.phase = this.isDirty ? 'idle' : 'saved';
		this.errorMessage = undefined;
		this.fieldErrors = {};
		this.$loaded = true;
	}

	@action private applyCreatedProvider(
		config: VoxSpellConfig,
		selectedProviderIndex: number,
		credentialEntries: readonly CredentialsUpdateParams['set'][number][],
	): void {
		this.selectedProviderIndex = selectedProviderIndex;
		this.draft = structuredClone(config);
		this.applyAutoSaved(config, credentialEntries);
		this.selectFirstCredential();
	}

	@action private applyValidationErrors(fieldErrors: Record<string, string>): void {
		this.fieldErrors = fieldErrors;
		this.phase = 'error';
		this.errorMessage = '请修正表单中的配置项。';
	}

	@action private applyOperationError(error: unknown): void {
		this.phase = 'error';
		this.errorMessage = describeConfigError(error);
	}

	private selectFirstCredential(): void {
		this.selectedCredentialName = this.requiredCredentialNames[0];
	}

	/** 清除当前表单操作结果，供已关闭的临时编辑界面恢复主页面状态。 */
	@action clearOperationResult(): void {
		if (this.phase !== 'saving') this.phase = 'idle';
		this.errorMessage = undefined;
		this.fieldErrors = {};
		this.providerTestResult = undefined;
	}

	private getOrCreatePolishing(): NonNullable<VoxSpellConfig['polishing']> {
		if (!this.draft) throw new Error('Configuration draft is not available');
		this.draft.polishing ??= {
			enabled: false,
			minimumEffectiveCharacters: 6,
			activeProvider: 'openai',
			systemPrompt: DEFAULT_POLISH_SYSTEM_PROMPT,
			providers: [
				{
					id: 'openai',
					type: 'openai-compatible-chat',
					baseUrl: 'https://api.openai.com/v1',
					apiKeyEnvironment: 'OPENAI_API_KEY',
					model: '',
				},
			],
		};
		return this.draft.polishing;
	}

	private getOrCreateTextPolisher() {
		const polishing = this.getOrCreatePolishing();
		const provider = polishing.providers.find(
			(candidate) => candidate.id === polishing.activeProvider,
		);
		if (!provider) throw new Error('Active text polisher provider is not available');
		return provider;
	}
}

function validateConfigCandidate(
	candidate: VoxSpellConfig,
	selectedProviderIndex: number,
): Record<string, string> {
	const fieldErrors: Record<string, string> = {};
	const maximumRecordingSeconds = candidate.session?.maximumRecordingSeconds;
	if (
		maximumRecordingSeconds !== undefined &&
		(!Number.isInteger(maximumRecordingSeconds) ||
			maximumRecordingSeconds < MINIMUM_RECORDING_SECONDS ||
			maximumRecordingSeconds > MAXIMUM_RECORDING_SECONDS)
	) {
		fieldErrors.maximumRecordingSeconds = `请输入 ${MINIMUM_RECORDING_SECONDS}–${MAXIMUM_RECORDING_SECONDS} 之间的整数秒数。`;
	}
	const providerIds = candidate.asr.providers.map((item) => item.id);
	if (providerIds.some((id) => !id.trim())) fieldErrors.providerId = '请输入服务标识。';
	if (new Set(providerIds).size !== providerIds.length) {
		fieldErrors.providerId = '服务标识不能重复。';
	}
	const provider = candidate.asr.providers[selectedProviderIndex];
	if (!provider) {
		fieldErrors.provider = '请选择有效的识别服务。';
	} else if (provider.type === 'openai-compatible-transcription') {
		provider.baseUrl = provider.baseUrl.trim();
		provider.model = provider.model.trim();
		if (!/^https?:\/\//.test(provider.baseUrl)) fieldErrors.baseUrl = '请输入 HTTP(S) 地址。';
		if (!provider.model) fieldErrors.model = '请输入模型名称。';
		if (!/^[A-Z][A-Z0-9_]*$/.test(provider.apiKeyEnvironment)) {
			fieldErrors.apiKeyEnvironment = '凭据名称必须使用大写字母、数字和下划线。';
		}
	} else {
		provider.engineModelType = provider.engineModelType.trim();
		if (!provider.engineModelType) fieldErrors.engineModelType = '请输入引擎模型。';
	}
	const polishing = candidate.polishing;
	if (polishing) {
		polishing.systemPrompt = polishing.systemPrompt.trim();
		if (!polishing.systemPrompt) fieldErrors.polishingSystemPrompt = '请输入系统提示词。';
		if (polishing.enabled) {
			const textPolisher = polishing.providers.find(
				(item) => item.id === polishing.activeProvider,
			);
			if (!textPolisher) {
				fieldErrors.textPolisher = '请选择有效的润色服务。';
			} else {
				textPolisher.baseUrl = textPolisher.baseUrl.trim();
				textPolisher.model = textPolisher.model.trim();
				if (!/^https?:\/\//.test(textPolisher.baseUrl)) {
					fieldErrors.polishingBaseUrl = '请输入 HTTP(S) 地址。';
				}
				if (!textPolisher.model) fieldErrors.polishingModel = '请输入模型名称。';
				if (!/^[A-Z][A-Z0-9_]*$/.test(textPolisher.apiKeyEnvironment)) {
					fieldErrors.polishingApiKeyEnvironment =
						'凭据名称必须使用大写字母、数字和下划线。';
				}
			}
		}
	}
	return fieldErrors;
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
		session: { maximumRecordingSeconds: DEFAULT_MAXIMUM_RECORDING_SECONDS },
		textProcessing: { trimTrailingPeriod: false },
		polishing: {
			enabled: false,
			minimumEffectiveCharacters: 6,
			activeProvider: 'openai',
			systemPrompt: DEFAULT_POLISH_SYSTEM_PROMPT,
			providers: [
				{
					id: 'openai',
					type: 'openai-compatible-chat',
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
		if (data?.code === 'CREDENTIAL_MISSING') return '识别服务所需凭据尚未配置完整。';
		if (data?.code === 'CONFIG_INVALID') return 'Daemon 拒绝了无效配置。';
		if (data?.code === 'CONFIG_APPLY_FAILED') return '配置无法应用，原配置仍然有效。';
		if (data?.code === 'PROVIDER_TEST_FAILED') {
			return `识别服务测试失败：${data.providerCode ?? 'UNKNOWN_ERROR'}。`;
		}
	}
	return '无法完成配置操作，请检查 daemon 连接后重试。';
}

function getFieldLabel(field: string): string {
	const labels: Readonly<Record<string, string>> = {
		providerId: '服务标识',
		provider: '语音识别服务',
		baseUrl: '语音识别 API 地址',
		model: '语音识别模型',
		apiKeyEnvironment: '语音识别凭据名称',
		engineModelType: '语音识别引擎模型',
		maximumRecordingSeconds: '最长录音时长',
		polishingSystemPrompt: 'AI 润色系统提示词',
		textPolisher: 'AI 润色服务',
		polishingBaseUrl: 'AI 润色 API 地址',
		polishingModel: 'AI 润色模型',
		polishingApiKeyEnvironment: 'AI 润色凭据名称',
	};
	return labels[field] ?? field;
}
