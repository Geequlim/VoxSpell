import type { AsrEvent } from './realtime-asr.js';

type RevisableAsrEvent = Extract<AsrEvent, { type: 'partial' | 'segment-final' }>;

interface TranscriptSegment {
	text: string;
	revision: number;
	final: boolean;
}

/** 将 Provider 的分段修订组装成可供客户端整体替换的文本快照。 */
export class TranscriptAssembler {
	readonly #segments = new Map<string, TranscriptSegment>();

	/** 应用一次分段更新；事件过期或内容未变化时不产生新快照。 */
	update(event: RevisableAsrEvent): string | undefined {
		const current = this.#segments.get(event.segmentId);
		if (event.type === 'partial') {
			if (current?.final || (current && event.revision <= current.revision)) return undefined;
			if (current?.text === event.text) {
				current.revision = event.revision;
				return undefined;
			}
			this.#segments.set(event.segmentId, {
				text: event.text,
				revision: event.revision,
				final: false,
			});
			return this.text;
		}

		if (current?.final) return undefined;
		if (current?.text === event.text) {
			current.final = true;
			return undefined;
		}
		this.#segments.set(event.segmentId, {
			text: event.text,
			revision: current?.revision ?? 0,
			final: true,
		});
		return this.text;
	}

	get text(): string {
		return [...this.#segments.values()].map((segment) => segment.text).join('');
	}
}
