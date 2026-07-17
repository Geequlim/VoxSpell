/** 定义识别完成和润色完成后的确定性文本处理边界。 */
export interface TextPipeline {
	/** 生成可回退、可供 AI 使用的识别结果。 */
	processTranscript(text: string, signal: AbortSignal): Promise<string>;

	/** 重新保护和校验 AI 润色结果。 */
	processPolished(text: string, signal: AbortSignal): Promise<string>;
}

/** 在词典和数字规则接入前保持文本不变。 */
export class PassThroughTextPipeline implements TextPipeline {
	async processTranscript(text: string): Promise<string> {
		return text;
	}

	async processPolished(text: string): Promise<string> {
		return text;
	}
}
