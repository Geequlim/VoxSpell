import { describe, expect, it } from 'vitest';

import { createPcmWave } from '../src/pcm-wave.js';

describe('createPcmWave', () => {
	it('writes a mono 16 kHz S16LE WAV file', () => {
		const wave = Buffer.from(createPcmWave([Uint8Array.from([1, 2]), Uint8Array.from([3, 4])]));

		expect(wave.toString('ascii', 0, 4)).toBe('RIFF');
		expect(wave.toString('ascii', 8, 12)).toBe('WAVE');
		expect(wave.readUInt16LE(22)).toBe(1);
		expect(wave.readUInt32LE(24)).toBe(16_000);
		expect(wave.readUInt16LE(34)).toBe(16);
		expect(wave.readUInt32LE(40)).toBe(4);
		expect([...wave.subarray(44)]).toEqual([1, 2, 3, 4]);
	});

	it('rejects a partial PCM sample', () => {
		expect(() => createPcmWave([Uint8Array.from([1])])).toThrow('sample-aligned');
	});
});
