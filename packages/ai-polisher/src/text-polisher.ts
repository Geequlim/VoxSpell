export type PolishEvent =
	| { readonly type: 'delta'; readonly text: string }
	| { readonly type: 'completed' }
	| { readonly type: 'error'; readonly code: string; readonly retryable: boolean };

/** 定义可由不同 AI 服务实现的流式文本润色边界。 */
export interface TextPolisher {
	readonly id: string;

	/** 将识别结果转换为有序的流式润色事件。 */
	polish(text: string, signal: AbortSignal): AsyncIterable<PolishEvent>;
}
