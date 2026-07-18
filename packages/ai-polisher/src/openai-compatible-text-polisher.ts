import OpenAI from 'openai';

import { composePolishSystemPrompt } from './polish-system-prompt.js';

import type { PolishEvent, PolishRequest, TextPolisher } from './text-polisher.js';

const DEFAULT_TIMEOUT_MILLISECONDS = 60_000;

export interface OpenAiCompatibleTextPolisherOptions {
	readonly id: string;
	readonly apiKey: string;
	readonly baseUrl: string;
	readonly model: string;
	readonly systemPrompt: string;
	readonly timeoutMilliseconds?: number;
}

/** 使用 OpenAI Node SDK 调用兼容的流式 Chat Completions 接口。 */
export class OpenAiCompatibleTextPolisher implements TextPolisher {
	readonly id: string;
	readonly #client: OpenAI;
	readonly #model: string;
	readonly #systemPrompt: string;
	readonly #idleTimeoutMilliseconds: number;

	constructor(options: OpenAiCompatibleTextPolisherOptions) {
		this.id = options.id;
		this.#model = options.model;
		this.#systemPrompt = options.systemPrompt;
		this.#idleTimeoutMilliseconds = options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
		this.#client = new OpenAI({
			apiKey: options.apiKey,
			baseURL: options.baseUrl,
			maxRetries: 0,
			timeout: options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS,
			logLevel: 'off',
		});
	}

	async *polish(request: PolishRequest, signal: AbortSignal): AsyncIterable<PolishEvent> {
		const requestController = new AbortController();
		const requestSignal = AbortSignal.any([signal, requestController.signal]);
		try {
			const stream = await this.#client.chat.completions.create(
				{
					model: this.#model,
					stream: true,
					messages: [
						{
							role: 'system',
							content: composePolishSystemPrompt(
								this.#systemPrompt,
								request.dictionary,
							),
						},
						{ role: 'user', content: request.text },
					],
				},
				{ signal: requestSignal },
			);
			const iterator = stream[Symbol.asyncIterator]();
			let idleDeadline = Date.now() + this.#idleTimeoutMilliseconds;
			while (true) {
				const waitMilliseconds = Math.max(idleDeadline - Date.now(), 0);
				const result = await nextStreamChunk(iterator, waitMilliseconds);
				if (result.done) break;
				const chunk = result.value;
				const text = chunk.choices[0]?.delta.content;
				if (!text) continue;
				idleDeadline = Date.now() + this.#idleTimeoutMilliseconds;
				yield { type: 'delta', text };
			}
			yield { type: 'completed' };
		} catch (error) {
			if (signal.aborted) return;
			if (error instanceof PolishIdleTimeoutError) {
				requestController.abort('polish-idle-timeout');
				yield { type: 'error', code: 'TIMEOUT', retryable: true };
				return;
			}
			yield mapPolishError(error);
		}
	}
}

class PolishIdleTimeoutError extends Error {
	constructor() {
		super('Text polisher stream idle timeout');
		this.name = 'PolishIdleTimeoutError';
	}
}

/** 等待下一段流数据，并让空 chunk 不能无限延长正文 idle timeout。 */
async function nextStreamChunk<T>(
	iterator: AsyncIterator<T>,
	timeoutMilliseconds: number,
): Promise<IteratorResult<T>> {
	const timeout = Promise.withResolvers<never>();
	const timer = setTimeout(
		() => timeout.reject(new PolishIdleTimeoutError()),
		timeoutMilliseconds,
	);
	try {
		return await Promise.race([iterator.next(), timeout.promise]);
	} finally {
		clearTimeout(timer);
	}
}

/** 将 SDK 错误收口为不会泄露响应正文的稳定事件。 */
function mapPolishError(error: unknown): PolishEvent {
	if (error instanceof OpenAI.APIConnectionTimeoutError) {
		return { type: 'error', code: 'TIMEOUT', retryable: true };
	}
	if (error instanceof OpenAI.APIError) {
		if (error.status === 401 || error.status === 403) {
			return { type: 'error', code: 'AUTHENTICATION_FAILED', retryable: false };
		}
		if (error.status === 429) return { type: 'error', code: 'RATE_LIMITED', retryable: true };
		if (error.status && error.status >= 500) {
			return { type: 'error', code: 'PROVIDER_UNAVAILABLE', retryable: true };
		}
		return { type: 'error', code: 'INVALID_RESPONSE', retryable: false };
	}
	return { type: 'error', code: 'PROVIDER_UNAVAILABLE', retryable: true };
}
