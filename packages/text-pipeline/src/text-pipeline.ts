import type { PolishDictionaryEntry } from '@voxspell/ai-polisher/text-polisher';

/** 描述 AI 输出校验所需的原文、候选文本和词典快照。 */
export interface ProcessPolishedRequest {
	readonly transcript: string;
	readonly polished: string;
	readonly dictionary: readonly PolishDictionaryEntry[];
}

/** 定义识别完成和润色完成后的确定性文本处理边界。 */
export interface TextPipeline {
	/** 生成可回退、可供 AI 使用的识别结果。 */
	processTranscript(text: string, signal: AbortSignal): Promise<string>;

	/** 重新保护和校验 AI 润色结果。 */
	processPolished(request: ProcessPolishedRequest, signal: AbortSignal): Promise<string>;
}

/** 表示 AI 润色结果没有满足纯文本输出约束。 */
export class PolishedTextValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PolishedTextValidationError';
	}
}

/** 在词典和数字规则接入前保持文本不变。 */
export class PassThroughTextPipeline implements TextPipeline {
	async processTranscript(text: string): Promise<string> {
		return text;
	}

	async processPolished(request: ProcessPolishedRequest): Promise<string> {
		return request.polished;
	}
}

/** 在确定性规则完整接入前执行基础清理和 AI 输出安全校验。 */
export class DefaultTextPipeline implements TextPipeline {
	async processTranscript(text: string): Promise<string> {
		return text;
	}

	async processPolished(request: ProcessPolishedRequest): Promise<string> {
		const polished = request.polished.trim();
		if (!polished) throw new PolishedTextValidationError('Polished text is empty');
		if (/<\/?think\b/i.test(polished)) {
			throw new PolishedTextValidationError('Polished text contains thinking markup');
		}
		if (!request.transcript.includes('```') && polished.includes('```')) {
			throw new PolishedTextValidationError('Polished text added a Markdown code fence');
		}
		if (
			/^(?:润色(?:后的)?(?:结果|文本)?(?:如下)?|修改后的文本|以下(?:是|为)(?:润色后的)?(?:结果|文本))[:：]/.test(
				polished,
			)
		) {
			throw new PolishedTextValidationError('Polished text contains an explanatory prefix');
		}
		const maximumLength = Math.max(
			request.transcript.length * 3,
			request.transcript.length + 100,
		);
		if (polished.length > maximumLength) {
			throw new PolishedTextValidationError('Polished text changed length excessively');
		}
		for (const entry of request.dictionary) {
			if (
				request.transcript.includes(entry.canonical) &&
				!polished.includes(entry.canonical)
			) {
				throw new PolishedTextValidationError(
					`Polished text did not preserve dictionary term ${entry.canonical}`,
				);
			}
		}
		return polished;
	}
}
