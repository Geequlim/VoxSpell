import { Transform } from 'node:stream';

import type { TransformCallback } from 'node:stream';

export const DEFAULT_MAX_CONTENT_LENGTH = 1024 * 1024;
export const DEFAULT_MAX_HEADER_LENGTH = 8 * 1024;

const HEADER_DELIMITER = Buffer.from('\r\n\r\n');

/** 描述超过 daemon 单条 JSON-RPC 消息限制的输入。 */
export class MessageTooLargeError extends Error {
	readonly code = 'MESSAGE_TOO_LARGE';
	readonly contentLength: number;
	readonly maximumLength: number;

	constructor(contentLength: number, maximumLength: number) {
		super(`Message content length ${contentLength} exceeds limit ${maximumLength}`);
		this.name = 'MessageTooLargeError';
		this.contentLength = contentLength;
		this.maximumLength = maximumLength;
	}
}

/** 描述无法安全确定消息长度的 LSP header。 */
export class InvalidContentLengthHeaderError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidContentLengthHeaderError';
	}
}

/** 从完整 LSP header 中读取唯一且合法的 Content-Length。 */
function parseContentLength(header: Buffer): number {
	const values = header
		.toString('ascii')
		.split('\r\n')
		.map((line) => /^Content-Length:\s*([0-9]+)\s*$/i.exec(line)?.[1])
		.filter((value): value is string => value !== undefined);

	if (values.length !== 1) {
		throw new InvalidContentLengthHeaderError('Expected exactly one Content-Length header');
	}

	const contentLength = Number(values[0]);
	if (!Number.isSafeInteger(contentLength)) {
		throw new InvalidContentLengthHeaderError('Content-Length is not a safe integer');
	}
	return contentLength;
}

/** 在不解析 JSON 的前提下限制 LSP Content-Length 帧大小。 */
export class ContentLengthLimitTransform extends Transform {
	readonly #maximumContentLength: number;
	readonly #maximumHeaderLength: number;
	#header = Buffer.alloc(0);
	#bodyBytesRemaining = 0;

	constructor(
		maximumContentLength = DEFAULT_MAX_CONTENT_LENGTH,
		maximumHeaderLength = DEFAULT_MAX_HEADER_LENGTH,
	) {
		super();
		this.#maximumContentLength = maximumContentLength;
		this.#maximumHeaderLength = maximumHeaderLength;
	}

	_transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
		try {
			const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
			for (const output of this.#process(input)) this.push(output);
			callback();
		} catch (error) {
			callback(
				error instanceof Error ? error : new Error('Failed to inspect message framing'),
			);
		}
	}

	#process(input: Buffer): Buffer[] {
		const output: Buffer[] = [];
		let remaining = input;

		while (remaining.length > 0) {
			if (this.#bodyBytesRemaining > 0) {
				const bodyLength = Math.min(this.#bodyBytesRemaining, remaining.length);
				output.push(remaining.subarray(0, bodyLength));
				remaining = remaining.subarray(bodyLength);
				this.#bodyBytesRemaining -= bodyLength;
				continue;
			}

			const headerAndRemaining =
				this.#header.length > 0 ? Buffer.concat([this.#header, remaining]) : remaining;
			const delimiterIndex = headerAndRemaining.indexOf(HEADER_DELIMITER);
			if (delimiterIndex < 0) {
				if (headerAndRemaining.length > this.#maximumHeaderLength) {
					throw new MessageTooLargeError(
						headerAndRemaining.length,
						this.#maximumHeaderLength,
					);
				}
				this.#header = Buffer.from(headerAndRemaining);
				break;
			}

			const headerLength = delimiterIndex + HEADER_DELIMITER.length;
			if (headerLength > this.#maximumHeaderLength) {
				throw new MessageTooLargeError(headerLength, this.#maximumHeaderLength);
			}
			const header = headerAndRemaining.subarray(0, headerLength);
			const contentLength = parseContentLength(header);
			if (contentLength > this.#maximumContentLength) {
				throw new MessageTooLargeError(contentLength, this.#maximumContentLength);
			}

			output.push(header);
			this.#header = Buffer.alloc(0);
			this.#bodyBytesRemaining = contentLength;
			remaining = headerAndRemaining.subarray(headerLength);
		}

		return output;
	}
}
