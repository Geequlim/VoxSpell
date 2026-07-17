const WAVE_HEADER_BYTES = 44;
const PCM_FORMAT = 1;
const CHANNELS = 1;
const SAMPLE_RATE = 16_000;
const BITS_PER_SAMPLE = 16;
const BLOCK_ALIGN = (CHANNELS * BITS_PER_SAMPLE) / 8;
const BYTE_RATE = SAMPLE_RATE * BLOCK_ALIGN;

/** 将连续的 16 kHz 单声道 S16LE PCM 块封装为标准 WAV 文件。 */
export function createPcmWave(chunks: readonly Uint8Array[]): Uint8Array {
	const dataBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
	if (dataBytes % BLOCK_ALIGN !== 0) throw new Error('PCM data is not sample-aligned');
	if (dataBytes > 0xffff_ffff - WAVE_HEADER_BYTES) throw new Error('PCM data is too large');

	const wave = Buffer.allocUnsafe(WAVE_HEADER_BYTES + dataBytes);
	wave.write('RIFF', 0, 'ascii');
	wave.writeUInt32LE(WAVE_HEADER_BYTES - 8 + dataBytes, 4);
	wave.write('WAVE', 8, 'ascii');
	wave.write('fmt ', 12, 'ascii');
	wave.writeUInt32LE(16, 16);
	wave.writeUInt16LE(PCM_FORMAT, 20);
	wave.writeUInt16LE(CHANNELS, 22);
	wave.writeUInt32LE(SAMPLE_RATE, 24);
	wave.writeUInt32LE(BYTE_RATE, 28);
	wave.writeUInt16LE(BLOCK_ALIGN, 32);
	wave.writeUInt16LE(BITS_PER_SAMPLE, 34);
	wave.write('data', 36, 'ascii');
	wave.writeUInt32LE(dataBytes, 40);

	let offset = WAVE_HEADER_BYTES;
	for (const chunk of chunks) {
		wave.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return wave;
}
