import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { describe, expect, it } from 'vitest';

import {
	ContentLengthLimitTransform,
	MessageTooLargeError,
} from '../src/transport/content-length-limit.js';

/** 编码测试使用的 LSP Content-Length 帧。 */
function createFrame(content: Buffer): Buffer {
	return Buffer.concat([Buffer.from(`Content-Length: ${content.byteLength}\r\n\r\n`), content]);
}

/** 让输入分块通过限制器并返回完整输出。 */
async function transformChunks(chunks: readonly Buffer[], maximumLength: number): Promise<Buffer> {
	const output: Buffer[] = [];
	await pipeline(
		Readable.from(chunks),
		new ContentLengthLimitTransform(maximumLength),
		new Writable({
			write(chunk: Buffer, encoding, callback) {
				output.push(Buffer.from(chunk));
				callback();
			},
		}),
	);
	return Buffer.concat(output);
}

describe('ContentLengthLimitTransform', () => {
	it('preserves a frame whose header and body arrive in fragments', async () => {
		const frame = createFrame(Buffer.from('{"jsonrpc":"2.0"}'));

		await expect(
			transformChunks(
				[
					frame.subarray(0, 5),
					frame.subarray(5, 19),
					frame.subarray(19, 25),
					frame.subarray(25),
				],
				1024,
			),
		).resolves.toEqual(frame);
	});

	it('preserves consecutive frames in one chunk', async () => {
		const frames = Buffer.concat([
			createFrame(Buffer.from('{}')),
			createFrame(Buffer.from('null')),
		]);

		await expect(transformChunks([frames], 1024)).resolves.toEqual(frames);
	});

	it('allows content exactly at the configured limit', async () => {
		const frame = createFrame(Buffer.alloc(1024));

		await expect(transformChunks([frame], 1024)).resolves.toEqual(frame);
	});

	it('rejects a declared content length above the configured limit', async () => {
		const header = Buffer.from('Content-Length: 1025\r\n\r\n');

		await expect(transformChunks([header], 1024)).rejects.toBeInstanceOf(MessageTooLargeError);
	});
});
