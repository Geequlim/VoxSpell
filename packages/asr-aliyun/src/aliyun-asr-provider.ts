import { AliyunDuplexAsrSession } from './duplex-asr-session.js';
import { ManagedAliyunVocabulary } from './managed-vocabulary.js';
import { getAliyunAsrModelProfile, getAliyunDomain } from './model-profile.js';
import { QwenRealtimeAsrSession } from './qwen-realtime-asr-session.js';

import type {
	AsrSessionOptions,
	RealtimeAsrProvider,
	RealtimeAsrSession,
} from '@voxspell/asr-core/realtime-asr';
import type { AliyunAsrModel, AliyunRegion } from './model-profile.js';

export interface AliyunRealtimeAsrProviderOptions {
	readonly id: string;
	readonly apiKey: string;
	readonly workspaceId: string;
	readonly model: AliyunAsrModel;
	readonly region: AliyunRegion;
	readonly language?: string;
	readonly context?: string;
	readonly stateFile?: string;
	readonly reportVocabularyFailure?: () => void;
}

/** 使用阿里云百炼 WebSocket 协议的统一实时 ASR Provider。 */
export class AliyunRealtimeAsrProvider implements RealtimeAsrProvider {
	readonly id: string;
	readonly capabilities = { partialResults: true };
	readonly #options: AliyunRealtimeAsrProviderOptions;
	readonly #vocabulary?: ManagedAliyunVocabulary;

	constructor(options: AliyunRealtimeAsrProviderOptions) {
		this.id = options.id;
		this.#options = options;
		const profile = getAliyunAsrModelProfile(options.model);
		if (profile.supportsVocabulary) {
			this.#vocabulary = new ManagedAliyunVocabulary({
				providerId: options.id,
				apiKey: options.apiKey,
				workspaceId: options.workspaceId,
				domain: getAliyunDomain(options.region, options.workspaceId),
				model: options.model,
				stateFile: options.stateFile,
				reportFailure: options.reportVocabularyFailure,
			});
		}
	}

	async createSession(session: AsrSessionOptions): Promise<RealtimeAsrSession> {
		const profile = getAliyunAsrModelProfile(this.#options.model);
		const domain = getAliyunDomain(this.#options.region, this.#options.workspaceId);
		const headers = {
			Authorization: `Bearer ${this.#options.apiKey}`,
			'X-DashScope-WorkSpace': this.#options.workspaceId,
		};
		if (this.#options.model === 'qwen3-asr-flash-realtime') {
			return new QwenRealtimeAsrSession({
				session,
				url: `wss://${domain}/api-ws/v1/realtime?model=${this.#options.model}`,
				headers,
				language: this.#options.language,
			});
		}
		const vocabularyId = await this.#vocabulary?.resolve(session.vocabulary ?? []);
		return new AliyunDuplexAsrSession({
			session,
			url: `wss://${domain}/api-ws/v1/inference`,
			headers,
			model: this.#options.model,
			language: this.#options.language,
			context: profile.supportsContext ? this.#options.context : undefined,
			vocabularyId,
		});
	}
}
