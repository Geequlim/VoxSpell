import path from 'node:path';

import { getAsrProviderCredentialNames } from '@voxspell/config/asr-provider';
import { DEFAULT_MAXIMUM_RECORDING_SECONDS } from '@voxspell/config/config-schema';
import {
	createEmptyCredentials,
	loadVoxSpellCredentials,
	parseVoxSpellCredentials,
	saveVoxSpellCredentials,
} from '@voxspell/config/credentials';
import {
	loadVoxSpellConfig,
	parseVoxSpellConfig,
	VoxSpellConfigNotFoundError,
} from '@voxspell/config/load-config';
import { saveVoxSpellConfig } from '@voxspell/config/save-config';
import { getTextPolisherCredentialNames } from '@voxspell/config/text-polisher-provider';

import { createTextPolisher } from '../ai/create-configured-text-polisher.js';
import { createAsrProvider } from '../asr/create-configured-asr-provider.js';
import { testAsrProvider } from '../asr/test-asr-provider.js';

import type { TextPolisher } from '@voxspell/ai-polisher/text-polisher';
import type { RealtimeAsrProvider } from '@voxspell/asr-core/realtime-asr';
import type { VoxSpellConfigPaths } from '@voxspell/config/config-paths';
import type { VoxSpellConfig } from '@voxspell/config/config-schema';
import type { VoxSpellCredentials } from '@voxspell/config/credentials';
import type { CredentialValueUpdate } from '@voxspell/protocol/credentials';
import type { ProviderTestResult } from '@voxspell/protocol/provider';

export type DaemonConfigurationState = 'needs-configuration' | 'ready' | 'degraded';

/** 表示 daemon 当前可公开的脱敏配置状态。 */
export interface DaemonConfigurationStatus {
	readonly state: DaemonConfigurationState;
	readonly configPath: string;
	readonly credentialsPath: string;
	readonly activeProvider?: string;
	readonly missingCredentialNames: string[];
	readonly lastError?: string;
}

export interface TextPolishingPolicy {
	readonly defaultEnabled: boolean;
	readonly minimumEffectiveCharacters: number;
}

export interface DaemonConfigManagerOptions {
	readonly paths: VoxSpellConfigPaths;
	readonly environment?: NodeJS.ProcessEnv;
	readonly createProvider?: (
		config: VoxSpellConfig,
		environment: NodeJS.ProcessEnv,
		providerId?: string,
		providerStateFile?: string,
	) => RealtimeAsrProvider;
	readonly createTextPolisher?: (
		config: VoxSpellConfig,
		environment: NodeJS.ProcessEnv,
	) => TextPolisher | undefined;
}

/** 串行管理 daemon 配置、凭据和当前运行时 Provider。 */
export class DaemonConfigManager {
	readonly #paths: VoxSpellConfigPaths;
	readonly #environment: NodeJS.ProcessEnv;
	readonly #createProvider: (
		config: VoxSpellConfig,
		environment: NodeJS.ProcessEnv,
		providerId?: string,
		providerStateFile?: string,
	) => RealtimeAsrProvider;
	readonly #providerStateFile?: string;
	readonly #createTextPolisher: (
		config: VoxSpellConfig,
		environment: NodeJS.ProcessEnv,
	) => TextPolisher | undefined;
	#state: DaemonConfigurationState = 'needs-configuration';
	#config?: VoxSpellConfig;
	#credentials: VoxSpellCredentials = createEmptyCredentials();
	#asrProvider?: RealtimeAsrProvider;
	#textPolisher?: TextPolisher;
	#lastError?: string;
	#operation = Promise.resolve();

	constructor(options: DaemonConfigManagerOptions) {
		this.#paths = options.paths;
		this.#environment = options.environment ?? process.env;
		this.#createProvider = options.createProvider ?? createAsrProvider;
		this.#providerStateFile = options.createProvider
			? undefined
			: path.join(this.#paths.directory, 'asr-provider-state.json');
		this.#createTextPolisher = options.createTextPolisher ?? createTextPolisher;
	}

	/** 首次加载配置，失败时保留可管理的 daemon 状态。 */
	async initialize(): Promise<void> {
		try {
			await this.reload();
		} catch (error) {
			if (!(error instanceof VoxSpellConfigNotFoundError)) return;
			try {
				await saveVoxSpellConfig(
					this.#paths.directory,
					this.#paths.configFile,
					createDefaultConfig(),
				);
				await this.reload();
			} catch (creationError) {
				if (!this.#asrProvider) {
					this.#recordFailure(creationError);
					if (this.#config) this.#state = 'needs-configuration';
				}
			}
		}
	}

	/** 从磁盘重载配置和凭据；运行时不可用时进入 degraded。 */
	async reload(): Promise<void> {
		await this.#enqueue(async () => {
			try {
				const loadedConfig = await loadVoxSpellConfig(this.#paths.configFile);
				const loadedCredentials = await loadVoxSpellCredentials(
					this.#paths.credentialsFile,
				);
				this.#applyConfiguration(loadedConfig, loadedCredentials);
			} catch (error) {
				this.#recordFailure(error);
				throw error;
			}
		});
	}

	/** 校验候选配置是否可以安全存储，不要求当前 Provider 已可运行。 */
	async validate(config: VoxSpellConfig): Promise<void> {
		await this.#enqueue(async () => {
			parseVoxSpellConfig(config);
		});
	}

	/** 保存候选配置；Provider 尚不可运行时保留配置并进入 degraded。 */
	async updateConfig(config: VoxSpellConfig): Promise<void> {
		await this.#enqueue(async () => {
			const validatedConfig = parseVoxSpellConfig(config);
			await saveVoxSpellConfig(
				path.dirname(this.#paths.configFile),
				this.#paths.configFile,
				validatedConfig,
			);
			this.#applyConfiguration(validatedConfig, this.#credentials);
		});
	}

	/** 原子保存候选凭据，并用当前配置重新构造运行时 Provider。 */
	async updateCredentials(credentials: VoxSpellCredentials): Promise<void> {
		await this.#enqueue(async () => {
			const validatedCredentials = parseVoxSpellCredentials(credentials);
			await this.#saveAndApplyCredentials(validatedCredentials);
		});
	}

	/** 返回当前运行时 Provider；没有有效配置时返回 undefined。 */
	getAsrProvider(): RealtimeAsrProvider | undefined {
		return this.#asrProvider;
	}

	/** 返回当前启用的 AI 文本润色器。 */
	getTextPolisher(): TextPolisher | undefined {
		return this.#textPolisher;
	}

	/** 返回新会话使用的 AI 润色默认策略。 */
	getTextPolishingPolicy(): TextPolishingPolicy {
		return {
			defaultEnabled: this.#config?.polishing?.enabled ?? false,
			minimumEffectiveCharacters: this.#config?.polishing?.minimumEffectiveCharacters ?? 0,
		};
	}

	/** 返回新会话使用的确定性文本处理配置。 */
	getTrimTrailingPeriod(): boolean {
		return this.#config?.textProcessing?.trimTrailingPeriod ?? false;
	}

	/** 返回新会话允许的最长录音时长。 */
	getMaximumRecordingMilliseconds(): number {
		const seconds =
			this.#config?.session?.maximumRecordingSeconds ?? DEFAULT_MAXIMUM_RECORDING_SECONDS;
		return seconds * 1_000;
	}

	/** 返回当前生效配置的副本。 */
	getConfig(): VoxSpellConfig | undefined {
		if (!this.#config) return undefined;
		return structuredClone(this.#config);
	}

	/** 返回凭据存储的副本，仅供可信的 daemon 更新流程使用。 */
	getCredentials(): VoxSpellCredentials {
		return structuredClone(this.#credentials);
	}

	/** 返回已持久化的凭据名称，不暴露对应值。 */
	getStoredCredentialNames(): readonly string[] {
		return Object.keys(this.#credentials.values).sort();
	}

	/** 使用配置和凭据快照测试指定 Provider，不切换当前运行时。 */
	async testProvider(providerId: string): Promise<ProviderTestResult> {
		const provider = await this.#enqueue(async () => {
			if (!this.#config) throw new VoxSpellConfigNotFoundError(this.#paths.configFile);
			return this.#createCandidateProvider(this.#config, this.#credentials, providerId);
		});
		return testAsrProvider(provider);
	}

	/** 将协议中的增删操作应用为一份完整候选凭据。 */
	async updateCredentialEntries(
		set: readonly CredentialValueUpdate[],
		deletedNames: readonly string[],
	): Promise<void> {
		await this.#enqueue(async () => {
			const values = { ...this.#credentials.values };
			for (const name of deletedNames) delete values[name];
			for (const entry of set) values[entry.name] = entry.value;
			await this.#saveAndApplyCredentials({ version: 1, values });
		});
	}

	/** 返回不包含任何凭据值的配置状态。 */
	getStatus(): DaemonConfigurationStatus {
		let missingCredentialNames: string[] = [];
		if (this.#config) {
			const effectiveEnvironment = this.#createEffectiveEnvironment(this.#credentials);
			let asrCredentialNames: readonly string[] = [];
			let textPolisherCredentialNames: readonly string[] = [];
			try {
				asrCredentialNames = getAsrProviderCredentialNames(
					this.#config,
					this.#environment.VOXSPELL_ASR_PROVIDER,
				);
			} catch {
				asrCredentialNames = [];
			}
			try {
				textPolisherCredentialNames = getTextPolisherCredentialNames(this.#config);
			} catch {
				textPolisherCredentialNames = [];
			}
			missingCredentialNames = [
				...new Set([...asrCredentialNames, ...textPolisherCredentialNames]),
			]
				.filter((name) => !effectiveEnvironment[name])
				.sort();
		}
		return {
			state: this.#state,
			configPath: this.#paths.configFile,
			credentialsPath: this.#paths.credentialsFile,
			activeProvider: this.#asrProvider?.id ?? this.#config?.asr.activeProvider,
			missingCredentialNames,
			lastError: this.#lastError,
		};
	}

	#createCandidateProvider(
		config: VoxSpellConfig,
		credentials: VoxSpellCredentials,
		providerId?: string,
	): RealtimeAsrProvider {
		return this.#invokeProviderFactory(
			config,
			this.#createEffectiveEnvironment(credentials),
			providerId,
		);
	}

	async #saveAndApplyCredentials(credentials: VoxSpellCredentials): Promise<void> {
		await saveVoxSpellCredentials(
			this.#paths.directory,
			this.#paths.credentialsFile,
			credentials,
		);
		if (this.#config) {
			this.#applyConfiguration(this.#config, credentials);
			return;
		}
		this.#credentials = structuredClone(credentials);
	}

	#createEffectiveEnvironment(credentials: VoxSpellCredentials): NodeJS.ProcessEnv {
		return { ...credentials.values, ...this.#environment };
	}

	#applyConfiguration(config: VoxSpellConfig, credentials: VoxSpellCredentials): void {
		this.#config = structuredClone(config);
		this.#credentials = structuredClone(credentials);
		const environment = this.#createEffectiveEnvironment(credentials);
		let runtimeError: unknown;
		try {
			this.#asrProvider = this.#invokeProviderFactory(config, environment);
		} catch (error) {
			this.#asrProvider = undefined;
			runtimeError = error;
		}
		try {
			this.#textPolisher = this.#createTextPolisher(config, environment);
		} catch (error) {
			this.#textPolisher = undefined;
			runtimeError ??= error;
		}
		if (runtimeError) {
			this.#state = 'degraded';
			this.#lastError =
				runtimeError instanceof Error
					? runtimeError.message
					: 'Unknown configuration error';
			return;
		}
		this.#state = 'ready';
		this.#lastError = undefined;
	}

	#invokeProviderFactory(
		config: VoxSpellConfig,
		environment: NodeJS.ProcessEnv,
		providerId?: string,
	): RealtimeAsrProvider {
		if (this.#providerStateFile) {
			return this.#createProvider(config, environment, providerId, this.#providerStateFile);
		}
		if (providerId === undefined) return this.#createProvider(config, environment);
		return this.#createProvider(config, environment, providerId);
	}

	#recordFailure(error: unknown): void {
		this.#lastError = error instanceof Error ? error.message : 'Unknown configuration error';
		if (this.#asrProvider) return;
		this.#state =
			error instanceof VoxSpellConfigNotFoundError ? 'needs-configuration' : 'degraded';
	}

	#enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.#operation.then(operation, operation);
		this.#operation = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}

/** 创建 daemon 首次启动时写入的最小合法配置。 */
function createDefaultConfig(): VoxSpellConfig {
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
					model: 'whisper-1',
				},
			],
		},
		session: { maximumRecordingSeconds: DEFAULT_MAXIMUM_RECORDING_SECONDS },
		textProcessing: { trimTrailingPeriod: false },
	};
}
