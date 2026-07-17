const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

export interface WavePcm {
	readonly samples: Uint8Array;
	readonly sampleRate: number;
	readonly channels: number;
	readonly bitsPerSample: number;
}

/** 表示 WAV 文件不是 daemon 支持的 PCM 格式。 */
export class UnsupportedWaveFormatError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UnsupportedWaveFormatError';
	}
}

/** 从 WAV 容器中读取 16 kHz、单声道、16-bit PCM 数据。 */
export function parseWavePcm(input: Uint8Array): WavePcm {
	const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	if (
		buffer.byteLength < RIFF_HEADER_BYTES ||
		buffer.toString('ascii', 0, 4) !== 'RIFF' ||
		buffer.toString('ascii', 8, 12) !== 'WAVE'
	) {
		throw new UnsupportedWaveFormatError('Expected a RIFF/WAVE file');
	}

	let format: { sampleRate: number; channels: number; bitsPerSample: number } | undefined;
	let samples: Uint8Array | undefined;
	let offset = RIFF_HEADER_BYTES;
	while (offset + CHUNK_HEADER_BYTES <= buffer.byteLength) {
		const chunkId = buffer.toString('ascii', offset, offset + 4);
		const chunkLength = buffer.readUInt32LE(offset + 4);
		const chunkStart = offset + CHUNK_HEADER_BYTES;
		const chunkEnd = chunkStart + chunkLength;
		if (chunkEnd > buffer.byteLength) {
			throw new UnsupportedWaveFormatError(`WAV chunk ${chunkId} exceeds the file boundary`);
		}

		if (chunkId === 'fmt ') {
			if (chunkLength < 16)
				throw new UnsupportedWaveFormatError('WAV fmt chunk is too short');
			const audioFormat = buffer.readUInt16LE(chunkStart);
			const channels = buffer.readUInt16LE(chunkStart + 2);
			const sampleRate = buffer.readUInt32LE(chunkStart + 4);
			const blockAlign = buffer.readUInt16LE(chunkStart + 12);
			const bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
			if (audioFormat !== 1)
				throw new UnsupportedWaveFormatError('Only integer PCM WAV is supported');
			if (
				channels !== 1 ||
				sampleRate !== 16_000 ||
				bitsPerSample !== 16 ||
				blockAlign !== 2
			) {
				throw new UnsupportedWaveFormatError('Expected mono 16 kHz 16-bit PCM WAV');
			}
			format = { sampleRate, channels, bitsPerSample };
		} else if (chunkId === 'data') {
			samples = buffer.subarray(chunkStart, chunkEnd);
		}

		offset = chunkEnd + (chunkLength % 2);
	}

	if (!format) throw new UnsupportedWaveFormatError('WAV fmt chunk is missing');
	if (!samples) throw new UnsupportedWaveFormatError('WAV data chunk is missing');
	return { ...format, samples };
}
