import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { WaveFileAudioCaptureBackend } from '../src/audio/wave-file-audio-capture.js';
import { UnsupportedWaveFormatError, parseWavePcm } from '../src/audio/wave-pcm.js';

const temporaryDirectories: string[] = [];

/** 创建包含可选奇数字节附加块的 PCM WAV。 */
function createWave(samples: Buffer, sampleRate = 16_000, includeOddChunk = false): Buffer {
	const format = Buffer.alloc(24);
	format.write('fmt ', 0, 'ascii');
	format.writeUInt32LE(16, 4);
	format.writeUInt16LE(1, 8);
	format.writeUInt16LE(1, 10);
	format.writeUInt32LE(sampleRate, 12);
	format.writeUInt32LE(sampleRate * 2, 16);
	format.writeUInt16LE(2, 20);
	format.writeUInt16LE(16, 22);
	const metadata = includeOddChunk
		? Buffer.from([0x4a, 0x55, 0x4e, 0x4b, 0x01, 0x00, 0x00, 0x00, 0x2a, 0x00])
		: Buffer.alloc(0);
	const dataHeader = Buffer.alloc(8);
	dataHeader.write('data', 0, 'ascii');
	dataHeader.writeUInt32LE(samples.byteLength, 4);
	const body = Buffer.concat([format, metadata, dataHeader, samples]);
	const header = Buffer.alloc(12);
	header.write('RIFF', 0, 'ascii');
	header.writeUInt32LE(body.byteLength + 4, 4);
	header.write('WAVE', 8, 'ascii');
	return Buffer.concat([header, body]);
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
	);
});

describe('parseWavePcm', () => {
	it('finds PCM data across padded WAV chunks', () => {
		const samples = Buffer.from([0x01, 0x02, 0x03, 0x04]);

		expect(parseWavePcm(createWave(samples, 16_000, true))).toEqual({
			samples,
			sampleRate: 16_000,
			channels: 1,
			bitsPerSample: 16,
		});
	});

	it('rejects an unsupported sample rate', () => {
		expect(() => parseWavePcm(createWave(Buffer.alloc(2), 44_100))).toThrow(
			UnsupportedWaveFormatError,
		);
	});
});

describe('WaveFileAudioCaptureBackend', () => {
	it('streams WAV samples in fixed-size frames until stopped', async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'voxspell-wave-'));
		temporaryDirectories.push(directory);
		const filePath = path.join(directory, 'fixture.wav');
		await writeFile(filePath, createWave(Buffer.from([1, 2, 3, 4, 5, 6])));
		const session = new WaveFileAudioCaptureBackend(filePath, 4).createSession();
		await session.start(new AbortController().signal);
		const frames = session.frames()[Symbol.asyncIterator]();

		await expect(frames.next()).resolves.toMatchObject({
			done: false,
			value: Buffer.from([1, 2, 3, 4]),
		});
		await expect(frames.next()).resolves.toMatchObject({
			done: false,
			value: Buffer.from([5, 6]),
		});
		await session.stop();
		await expect(frames.next()).resolves.toEqual({ done: true, value: undefined });
	});
});
