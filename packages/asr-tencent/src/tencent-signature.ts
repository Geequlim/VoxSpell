import { createHmac, randomInt, randomUUID } from 'node:crypto';

const DEFAULT_ENDPOINT = 'wss://asr.cloud.tencent.com/asr/v2';

export interface TencentAsrUrlOptions {
	readonly appId: string;
	readonly secretId: string;
	readonly secretKey: string;
	readonly engineModelType: string;
	readonly endpoint?: string;
	readonly timestamp?: number;
	readonly nonce?: number;
	readonly voiceId?: string;
}

/** 生成一次性腾讯云实时 ASR 鉴权 URL。 */
export function createTencentAsrUrl(options: TencentAsrUrlOptions): string {
	const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
	const nonce = options.nonce ?? randomInt(1, 1_000_000_000);
	const voiceId = options.voiceId ?? randomUUID();
	const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
	const url = new URL(`${endpoint}/${encodeURIComponent(options.appId)}`);
	const parameters = new Map<string, string>([
		['convert_num_mode', '1'],
		['engine_model_type', options.engineModelType],
		['expired', String(timestamp + 300)],
		['filter_empty_result', '1'],
		['filter_modal', '0'],
		['filter_punc', '0'],
		['needvad', '1'],
		['nonce', String(nonce)],
		['secretid', options.secretId],
		['timestamp', String(timestamp)],
		['voice_format', '1'],
		['voice_id', voiceId],
		['word_info', '0'],
	]);
	const query = [...parameters.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
		.join('&');
	const signatureSource = `${url.host}${url.pathname}?${query}`;
	const signature = createHmac('sha1', options.secretKey)
		.update(signatureSource)
		.digest('base64');
	url.search = `${query}&signature=${encodeURIComponent(signature)}`;
	return url.toString();
}
