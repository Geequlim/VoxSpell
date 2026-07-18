export type PolishEvent =
	| { readonly type: 'delta'; readonly text: string }
	| { readonly type: 'completed' }
	| { readonly type: 'error'; readonly code: string; readonly retryable: boolean };

/** 描述一次 AI 润色所需的会话文本快照。 */
export interface PolishRequest {
	readonly text: string;
	readonly dictionary: readonly VoiceDictionaryEntry[];
}

/** 定义可由不同 AI 服务实现的流式文本润色边界。 */
export interface TextPolisher {
	readonly id: string;

	/** 将识别结果转换为有序的流式润色事件。 */
	polish(request: PolishRequest, signal: AbortSignal): AsyncIterable<PolishEvent>;
}
import type { VoiceDictionaryEntry } from '@voxspell/config/dictionary-schema';
