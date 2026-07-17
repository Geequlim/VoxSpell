import type { SessionId } from '@voxspell/protocol/common';

export interface AsrCapabilities {
	readonly partialResults: boolean;
}

export interface AsrSessionOptions {
	readonly sessionId: SessionId;
}

export type AsrEvent =
	| { readonly type: 'ready' }
	| {
			readonly type: 'partial';
			readonly segmentId: string;
			readonly revision: number;
			readonly text: string;
	  }
	| {
			readonly type: 'segment-final';
			readonly segmentId: string;
			readonly text: string;
	  }
	| { readonly type: 'completed'; readonly text: string }
	| {
			readonly type: 'error';
			readonly code: string;
			readonly retryable: boolean;
	  };

export interface RealtimeAsrProvider {
	readonly id: string;
	readonly capabilities: AsrCapabilities;

	/** 创建一次独立的识别会话。 */
	createSession(options: AsrSessionOptions): Promise<RealtimeAsrSession>;
}

export interface RealtimeAsrSession {
	/** 启动 Provider 会话。 */
	start(signal: AbortSignal): Promise<void>;

	/** 写入一块连续音频字节。 */
	writeAudio(frame: Uint8Array): Promise<void>;

	/** 通知 Provider 音频已经发送完毕。 */
	finish(): Promise<void>;

	/** 立即取消 Provider 会话。 */
	cancel(reason?: string): Promise<void>;

	/** 返回 Provider 产生的有序事件流。 */
	events(): AsyncIterable<AsrEvent>;
}
