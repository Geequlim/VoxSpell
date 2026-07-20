import path from 'node:path';

import { AliyunRealtimeAsrProvider } from '@voxspell/asr-aliyun/aliyun-asr-provider';
import { OpenAiCompatibleAsrProvider } from '@voxspell/asr-openai-compatible/openai-compatible-asr-provider';
import { TencentRealtimeAsrProvider } from '@voxspell/asr-tencent/tencent-asr-provider';
import { resolveAsrProvider } from '@voxspell/config/asr-provider';
import { loadVoxSpellConfig } from '@voxspell/config/load-config';

import type { RealtimeAsrProvider } from '@voxspell/asr-core/realtime-asr';
import type { VoxSpellConfig } from '@voxspell/config/config-schema';

/** 根据已校验配置和凭据环境创建当前选定的 ASR Provider。 */
export function createAsrProvider(
	config: VoxSpellConfig,
	environment: NodeJS.ProcessEnv,
	providerId = environment.VOXSPELL_ASR_PROVIDER,
	providerStateFile?: string,
): RealtimeAsrProvider {
	const provider = resolveAsrProvider(
		config,
		environment,
		providerId ?? config.asr.activeProvider,
	);
	if (provider.type === 'tencent-realtime') {
		return new TencentRealtimeAsrProvider({
			id: provider.id,
			appId: provider.appId,
			secretId: provider.secretId,
			secretKey: provider.secretKey,
			engineModelType: provider.engineModelType,
		});
	}
	if (provider.type === 'aliyun-realtime') {
		return new AliyunRealtimeAsrProvider({
			id: provider.id,
			apiKey: provider.apiKey,
			workspaceId: provider.workspaceId,
			model: provider.model,
			region: provider.region,
			language: provider.language,
			context: provider.context,
			stateFile: providerStateFile,
			reportVocabularyFailure: () =>
				console.warn('Aliyun vocabulary maintenance failed; continuing without vocabulary'),
		});
	}
	return new OpenAiCompatibleAsrProvider({
		id: provider.id,
		apiKey: provider.apiKey,
		baseUrl: provider.baseUrl,
		model: provider.model,
	});
}

/** 从已校验配置创建当前选定的 ASR Provider。 */
export async function createConfiguredAsrProvider(
	configPath: string,
	environment: NodeJS.ProcessEnv = process.env,
	providerId = environment.VOXSPELL_ASR_PROVIDER,
): Promise<RealtimeAsrProvider> {
	const config = await loadVoxSpellConfig(configPath);
	return createAsrProvider(
		config,
		environment,
		providerId,
		path.join(path.dirname(configPath), 'asr-provider-state.json'),
	);
}
