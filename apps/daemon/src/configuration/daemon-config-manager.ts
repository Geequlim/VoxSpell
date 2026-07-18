import path from 'node:path';

import { getAsrProviderCredentialNames } from '@voxspell/config/asr-provider';
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

import { createAsrProvider } from '../asr/create-configured-asr-provider.js';

import type { RealtimeAsrProvider } from '@voxspell/asr-core/realtime-asr';
import type { VoxSpellConfigPaths } from '@voxspell/config/config-paths';
import type { VoxSpellConfig } from '@voxspell/config/config-schema';
import type { VoxSpellCredentials } from '@voxspell/config/credentials';
import type { CredentialValueUpdate } from '@voxspell/protocol/credentials';

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

export interface DaemonConfigManagerOptions {
	readonly paths: VoxSpellConfigPaths;
	readonly environment?: NodeJS.ProcessEnv;
	readonly createProvider?: (
		config: VoxSpellConfig,
		environment: NodeJS.ProcessEnv,
	) => RealtimeAsrProvider;
}

/** 串行管理 daemon 配置、凭据和当前运行时 Provider。 */
export class DaemonConfigManager {
	readonly #paths: VoxSpellConfigPaths;
	readonly #environment: NodeJS.ProcessEnv;
	readonly #createProvider: (
		config: VoxSpellConfig,
		environment: NodeJS.ProcessEnv,
	) => RealtimeAsrProvider;
	#state: DaemonConfigurationState = 'needs-configuration';
	#config?: VoxSpellConfig;
	#credentials: VoxSpellCredentials = createEmptyCredentials();
	#asrProvider?: RealtimeAsrProvider;
	#lastError?: string;
	#operation = Promise.resolve();

	constructor(options: DaemonConfigManagerOptions) {
		this.#paths = options.paths;
		this.#environment = options.environment ?? process.env;
		this.#createProvider = options.createProvider ?? createAsrProvider;
	}

	/** 首次加载配置，失败时保留可管理的 daemon 状态。 */
	async initialize(): Promise<void> {
		try {
			await this.reload();
		} catch (error) {
			if (this.#asrProvider) return;
			this.#state =
				error instanceof VoxSpellConfigNotFoundError ? 'needs-configuration' : 'degraded';
		}
	}

	/** 从磁盘重载配置和凭据，并仅在全部成功后替换运行时快照。 */
	async reload(): Promise<void> {
		await this.#enqueue(async () => {
			let loadedConfig: VoxSpellConfig | undefined;
			let loadedCredentials: VoxSpellCredentials | undefined;
			try {
				loadedConfig = await loadVoxSpellConfig(this.#paths.configFile);
				loadedCredentials = await loadVoxSpellCredentials(this.#paths.credentialsFile);
				const asrProvider = this.#createCandidateProvider(loadedConfig, loadedCredentials);
				this.#apply(loadedConfig, loadedCredentials, asrProvider);
			} catch (error) {
				if (!this.#asrProvider && loadedConfig) {
					this.#config = structuredClone(loadedConfig);
					if (loadedCredentials) {
						this.#credentials = structuredClone(loadedCredentials);
					}
				}
				this.#recordFailure(error);
				throw error;
			}
		});
	}

	/** 校验候选配置和当前凭据，但不保存或切换运行时。 */
	async validate(config: VoxSpellConfig): Promise<void> {
		await this.#enqueue(async () => {
			const validatedConfig = parseVoxSpellConfig(config);
			this.#createCandidateProvider(validatedConfig, this.#credentials);
		});
	}

	/** 原子保存候选配置，并在成功后切换运行时 Provider。 */
	async updateConfig(config: VoxSpellConfig): Promise<void> {
		await this.#enqueue(async () => {
			const validatedConfig = parseVoxSpellConfig(config);
			const asrProvider = this.#createCandidateProvider(validatedConfig, this.#credentials);
			await saveVoxSpellConfig(
				path.dirname(this.#paths.configFile),
				this.#paths.configFile,
				validatedConfig,
			);
			this.#apply(validatedConfig, this.#credentials, asrProvider);
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
			missingCredentialNames = getAsrProviderCredentialNames(
				this.#config,
				this.#environment.VOXSPELL_ASR_PROVIDER,
			).filter((name) => !effectiveEnvironment[name]);
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
	): RealtimeAsrProvider {
		return this.#createProvider(config, this.#createEffectiveEnvironment(credentials));
	}

	async #saveAndApplyCredentials(credentials: VoxSpellCredentials): Promise<void> {
		let asrProvider = this.#asrProvider;
		if (this.#config) {
			asrProvider = this.#createCandidateProvider(this.#config, credentials);
		}
		await saveVoxSpellCredentials(
			this.#paths.directory,
			this.#paths.credentialsFile,
			credentials,
		);
		this.#credentials = structuredClone(credentials);
		this.#asrProvider = asrProvider;
		this.#lastError = undefined;
		if (this.#config && asrProvider) this.#state = 'ready';
	}

	#createEffectiveEnvironment(credentials: VoxSpellCredentials): NodeJS.ProcessEnv {
		return { ...credentials.values, ...this.#environment };
	}

	#apply(
		config: VoxSpellConfig,
		credentials: VoxSpellCredentials,
		asrProvider: RealtimeAsrProvider,
	): void {
		this.#config = structuredClone(config);
		this.#credentials = structuredClone(credentials);
		this.#asrProvider = asrProvider;
		this.#state = 'ready';
		this.#lastError = undefined;
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
