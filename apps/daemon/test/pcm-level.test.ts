import { describe, expect, it } from 'vitest';

import { PcmLevelMeter, calculatePcmLevel } from '../src/audio/pcm-level.js';

/** 创建重复固定采样值的 S16LE PCM。 */
function createSamples(value: number, count: number): Buffer {
	const samples = Buffer.alloc(count * 2);
	for (let index = 0; index < count; index += 1) samples.writeInt16LE(value, index * 2);
	return samples;
}

describe('calculatePcmLevel', () => {
	it('reports the floor for silence', () => {
		expect(calculatePcmLevel(createSamples(0, 10))).toEqual({
			rms: 0,
			peak: 0,
			rmsDbfs: -96,
			peakDbfs: -96,
		});
	});

	it('calculates normalized RMS and peak', () => {
		const level = calculatePcmLevel(createSamples(16_384, 10));

		expect(level.rms).toBe(0.5);
		expect(level.peak).toBe(0.5);
		expect(level.rmsDbfs).toBeCloseTo(-6.0206, 4);
		expect(level.peakDbfs).toBeCloseTo(-6.0206, 4);
	});
});

describe('PcmLevelMeter', () => {
	it('preserves odd chunk boundaries until a complete window exists', () => {
		const meter = new PcmLevelMeter(10, 100);
		const sample = createSamples(8_192, 1);

		expect(meter.write(sample.subarray(0, 1))).toEqual([]);
		const levels = meter.write(sample.subarray(1));
		expect(levels).toHaveLength(1);
		expect(levels[0]?.peak).toBe(0.25);
	});
});
