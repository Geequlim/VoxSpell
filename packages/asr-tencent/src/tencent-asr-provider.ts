import { TencentRealtimeAsrSession } from './tencent-asr-session.js';

import type {
	AsrSessionOptions,
	RealtimeAsrProvider,
	RealtimeAsrSession,
} from '@voxspell/asr-core/realtime-asr';

export interface TencentRealtimeAsrProviderOptions {
	readonly id: string;
	readonly appId: string;
	readonly secretId: string;
	readonly secretKey: string;
	readonly engineModelType: string;
	readonly endpoint?: string;
	readonly packetIntervalMilliseconds?: number;
	readonly handshakeTimeoutMilliseconds?: number;
	readonly finalTimeoutMilliseconds?: number;
	readonly closeGraceMilliseconds?: number;
}

/** 使用腾讯云 WebSocket API 的实时 ASR Provider。 */
export class TencentRealtimeAsrProvider implements RealtimeAsrProvider {
	readonly id: string;
	readonly capabilities = { partialResults: true };
	readonly #options: TencentRealtimeAsrProviderOptions;

	constructor(options: TencentRealtimeAsrProviderOptions) {
		this.id = options.id;
		this.#options = options;
	}

	async createSession(session: AsrSessionOptions): Promise<RealtimeAsrSession> {
		return new TencentRealtimeAsrSession({ ...this.#options, session });
	}
}
