import { describe, expect, it } from 'vitest';

import { PcmPacketizer } from '../src/pcm-packetizer.js';

describe('PcmPacketizer', () => {
	it('preserves bytes while combining arbitrary chunks into fixed packets', () => {
		const packetizer = new PcmPacketizer(4);

		expect(packetizer.write(Uint8Array.from([1, 2, 3]))).toEqual([]);
		expect(packetizer.write(Uint8Array.from([4, 5, 6, 7, 8, 9]))).toEqual([
			Uint8Array.from([1, 2, 3, 4]),
			Uint8Array.from([5, 6, 7, 8]),
		]);
		expect(packetizer.flush()).toEqual(Uint8Array.from([9]));
		expect(packetizer.flush()).toBeUndefined();
	});
});
