/** 将任意 PCM chunk 重组为固定时长的数据包。 */
export class PcmPacketizer {
	readonly #packetBytes: number;
	#buffer = new Uint8Array();

	constructor(packetBytes: number) {
		this.#packetBytes = packetBytes;
	}

	write(chunk: Uint8Array): readonly Uint8Array[] {
		const combined = new Uint8Array(this.#buffer.byteLength + chunk.byteLength);
		combined.set(this.#buffer);
		combined.set(chunk, this.#buffer.byteLength);
		const packets: Uint8Array[] = [];
		let offset = 0;
		while (combined.byteLength - offset >= this.#packetBytes) {
			packets.push(combined.slice(offset, offset + this.#packetBytes));
			offset += this.#packetBytes;
		}
		this.#buffer = combined.slice(offset);
		return packets;
	}

	flush(): Uint8Array | undefined {
		if (this.#buffer.byteLength === 0) return undefined;
		const packet = this.#buffer;
		this.#buffer = new Uint8Array();
		return packet;
	}
}
