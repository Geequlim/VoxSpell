import type { CompiledVoiceDictionary } from './voice-dictionary.js';

export interface ProcessTranscriptRequest {
	readonly text: string;
	readonly dictionary: CompiledVoiceDictionary;
	readonly trimTrailingPeriod: boolean;
}

/** 描述 AI 输出校验所需的原文、候选文本和词典快照。 */
export interface ProcessPolishedRequest {
	readonly transcript: string;
	readonly polished: string;
	readonly dictionary: CompiledVoiceDictionary;
	readonly trimTrailingPeriod: boolean;
}

/** 统计用于判断 AI 润色条件的 Unicode 字母、数字和符号数量。 */
export function countEffectiveCharacters(text: string): number {
	return [...text.matchAll(/[\p{Letter}\p{Number}\p{Symbol}]/gu)].length;
}

/** 按输入行为配置裁剪末尾中文句号或单个英文句号。 */
export function trimTrailingPeriod(text: string): string {
	const trimmed = text.trimEnd();
	let result = trimmed.replace(/。+$/u, '');
	if (result.endsWith('.') && !result.endsWith('..')) result = result.slice(0, -1);
	return result.trim().length > 0 ? result : trimmed;
}

/** 定义识别完成和润色完成后的确定性文本处理边界。 */
export interface TextPipeline {
	/** 生成可回退、可供 AI 使用的识别结果。 */
	processTranscript(request: ProcessTranscriptRequest, signal: AbortSignal): Promise<string>;

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
	async processTranscript(request: ProcessTranscriptRequest): Promise<string> {
		return request.text;
	}

	async processPolished(request: ProcessPolishedRequest): Promise<string> {
		return request.polished;
	}
}

/** 在确定性规则完整接入前执行基础清理和 AI 输出安全校验。 */
export class DefaultTextPipeline implements TextPipeline {
	async processTranscript(request: ProcessTranscriptRequest): Promise<string> {
		const transcript = request.dictionary.apply(request.text);
		return request.trimTrailingPeriod ? trimTrailingPeriod(transcript) : transcript;
	}

	async processPolished(request: ProcessPolishedRequest): Promise<string> {
		const polished = request.dictionary.apply(request.polished.trim());
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
		for (const entry of request.dictionary.entries) {
			if (
				entry.protect &&
				request.transcript.includes(entry.term) &&
				!polished.includes(entry.term)
			) {
				throw new PolishedTextValidationError(
					`Polished text did not preserve dictionary term ${entry.term}`,
				);
			}
		}
		return request.trimTrailingPeriod ? trimTrailingPeriod(polished) : polished;
	}
}
