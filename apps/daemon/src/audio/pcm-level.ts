const PCM_MAXIMUM = 32_768;
const MINIMUM_DBFS = -96;

export interface PcmLevel {
	readonly rms: number;
	readonly peak: number;
	readonly rmsDbfs: number;
	readonly peakDbfs: number;
}

/** 按固定采样窗口计算 little-endian PCM S16LE 音量。 */
export class PcmLevelMeter {
	readonly #windowBytes: number;
	#pending = Buffer.alloc(0);

	constructor(sampleRate = 16_000, windowMilliseconds = 100) {
		this.#windowBytes = Math.floor((sampleRate * windowMilliseconds) / 1_000) * 2;
	}

	write(chunk: Uint8Array): readonly PcmLevel[] {
		this.#pending = Buffer.concat([this.#pending, Buffer.from(chunk)]);
		const levels: PcmLevel[] = [];
		while (this.#pending.byteLength >= this.#windowBytes) {
			levels.push(calculatePcmLevel(this.#pending.subarray(0, this.#windowBytes)));
			this.#pending = this.#pending.subarray(this.#windowBytes);
		}
		return levels;
	}
}

/** 计算一段完整 S16LE PCM 的 RMS 与峰值。 */
export function calculatePcmLevel(samples: Uint8Array): PcmLevel {
	if (samples.byteLength === 0 || samples.byteLength % 2 !== 0) {
		throw new Error('PCM S16LE samples must contain complete 16-bit values');
	}
	const buffer = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
	let squareSum = 0;
	let peakValue = 0;
	for (let offset = 0; offset < buffer.byteLength; offset += 2) {
		const value = buffer.readInt16LE(offset);
		const magnitude = Math.abs(value);
		squareSum += value * value;
		peakValue = Math.max(peakValue, magnitude);
	}
	const sampleCount = buffer.byteLength / 2;
	const rms = Math.sqrt(squareSum / sampleCount) / PCM_MAXIMUM;
	const peak = peakValue / PCM_MAXIMUM;
	const toDbfs = (value: number): number => {
		if (value === 0) return MINIMUM_DBFS;
		return Math.max(MINIMUM_DBFS, 20 * Math.log10(value));
	};
	return { rms, peak, rmsDbfs: toDbfs(rms), peakDbfs: toDbfs(peak) };
}
