import OpenAI from 'openai';

import { OpenAiCompatibleAsrSession } from './openai-compatible-asr-session.js';

import type {
	AsrSessionOptions,
	RealtimeAsrProvider,
	RealtimeAsrSession,
} from '@voxspell/asr-core/realtime-asr';

const DEFAULT_TIMEOUT_MILLISECONDS = 60_000;
const DEFAULT_MAXIMUM_AUDIO_BYTES = 16_000 * 2 * 60 * 5;

export interface OpenAiCompatibleAsrProviderOptions {
	readonly id: string;
	readonly apiKey: string;
	readonly baseUrl: string;
	readonly model: string;
	readonly timeoutMilliseconds?: number;
	readonly maximumAudioBytes?: number;
}

/** 使用 OpenAI Node SDK 调用兼容的批量音频转写接口。 */
export class OpenAiCompatibleAsrProvider implements RealtimeAsrProvider {
	readonly id: string;
	readonly capabilities = { partialResults: false };
	readonly #client: OpenAI;
	readonly #model: string;
	readonly #maximumAudioBytes: number;

	constructor(options: OpenAiCompatibleAsrProviderOptions) {
		this.id = options.id;
		this.#model = options.model;
		this.#maximumAudioBytes = options.maximumAudioBytes ?? DEFAULT_MAXIMUM_AUDIO_BYTES;
		this.#client = new OpenAI({
			apiKey: options.apiKey,
			baseURL: options.baseUrl,
			maxRetries: 0,
			timeout: options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS,
			logLevel: 'off',
		});
	}

	async createSession(options: AsrSessionOptions): Promise<RealtimeAsrSession> {
		return new OpenAiCompatibleAsrSession({
			client: this.#client,
			model: this.#model,
			maximumAudioBytes: this.#maximumAudioBytes,
			session: options,
		});
	}
}
