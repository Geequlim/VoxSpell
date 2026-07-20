import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { atomicWriteFile } from '@voxspell/config/atomic-write';

import type { AsrVocabularyEntry } from '@voxspell/asr-core/realtime-asr';
import type { AliyunAsrModel } from './model-profile.js';

interface ManagedVocabularyOptions {
	readonly providerId: string;
	readonly apiKey: string;
	readonly workspaceId: string;
	readonly domain: string;
	readonly model: AliyunAsrModel;
	readonly stateFile?: string;
	readonly reportFailure?: () => void;
}

interface VocabularyRecord {
	readonly identity: string;
	readonly vocabularyId: string;
	readonly fingerprint: string;
}

interface VocabularyState {
	readonly version: 1;
	readonly providers: Readonly<Record<string, VocabularyRecord>>;
}

interface VocabularyResponse {
	readonly output?: { readonly vocabulary_id?: string };
}

interface NormalizedVocabularyEntry {
	readonly text: string;
	readonly weight: number;
}

const EMPTY_STATE: VocabularyState = { version: 1, providers: {} };

/** 在后台将 VoxSpell 词典维护为阿里云模型词表，不向配置界面暴露生命周期。 */
export class ManagedAliyunVocabulary {
	readonly #options: ManagedVocabularyOptions;

	constructor(options: ManagedVocabularyOptions) {
		this.#options = options;
	}

	async resolve(entries: readonly AsrVocabularyEntry[]): Promise<string | undefined> {
		const vocabulary = normalizeEntries(entries);
		if (vocabulary.length === 0) return undefined;
		try {
			const state = await this.#loadState();
			const current = state.providers[this.#options.providerId];
			const identity = `${this.#options.domain}:${this.#options.model}`;
			const fingerprint = createFingerprint(vocabulary);
			if (current?.identity === identity && current.fingerprint === fingerprint) {
				return current.vocabularyId;
			}
			const vocabularyId =
				current?.identity === identity
					? await this.#updateVocabulary(current.vocabularyId, vocabulary)
					: await this.#createVocabulary(vocabulary);
			await this.#saveState({
				version: 1,
				providers: {
					...state.providers,
					[this.#options.providerId]: { identity, vocabularyId, fingerprint },
				},
			});
			return vocabularyId;
		} catch {
			this.#options.reportFailure?.();
			return undefined;
		}
	}

	async #createVocabulary(vocabulary: readonly NormalizedVocabularyEntry[]): Promise<string> {
		const response = await this.#request({
			model: 'speech-biasing',
			input: {
				action: 'create_vocabulary',
				target_model: this.#options.model,
				prefix: 'voxspell',
				vocabulary,
			},
		});
		const vocabularyId = response.output?.vocabulary_id;
		if (!vocabularyId) throw new Error('Aliyun vocabulary response is missing an identifier');
		return vocabularyId;
	}

	async #updateVocabulary(
		vocabularyId: string,
		vocabulary: readonly NormalizedVocabularyEntry[],
	): Promise<string> {
		await this.#request({
			model: 'speech-biasing',
			input: {
				action: 'update_vocabulary',
				vocabulary_id: vocabularyId,
				vocabulary,
			},
		});
		return vocabularyId;
	}

	async #request(body: unknown): Promise<VocabularyResponse> {
		const response = await fetch(
			`https://${this.#options.domain}/api/v1/services/audio/asr/customization`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${this.#options.apiKey}`,
					'Content-Type': 'application/json',
					'X-DashScope-WorkSpace': this.#options.workspaceId,
				},
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(3_000),
			},
		);
		if (!response.ok) throw new Error(`Aliyun vocabulary request failed: ${response.status}`);
		return (await response.json()) as VocabularyResponse;
	}

	async #loadState(): Promise<VocabularyState> {
		if (!this.#options.stateFile) return EMPTY_STATE;
		try {
			const value = JSON.parse(
				await readFile(this.#options.stateFile, 'utf8'),
			) as VocabularyState;
			if (value.version === 1 && value.providers) return value;
		} catch {}
		return EMPTY_STATE;
	}

	async #saveState(state: VocabularyState): Promise<void> {
		if (!this.#options.stateFile) return;
		await mkdir(path.dirname(this.#options.stateFile), { recursive: true, mode: 0o700 });
		await atomicWriteFile(
			this.#options.stateFile,
			`${JSON.stringify(state, undefined, 2)}\n`,
			0o600,
		);
	}
}

function normalizeEntries(
	entries: readonly AsrVocabularyEntry[],
): readonly NormalizedVocabularyEntry[] {
	const unique = new Map<string, NormalizedVocabularyEntry>();
	for (const entry of entries) {
		const text = entry.text.normalize('NFKC').trim();
		if (!isSupportedVocabularyText(text)) continue;
		unique.set(text, { text, weight: Math.max(1, Math.min(5, Math.round(entry.weight))) });
		if (unique.size === 500) break;
	}
	return [...unique.values()];
}

function isSupportedVocabularyText(text: string): boolean {
	if (text.length === 0 || /[\u0000-\u001f\u007f]/u.test(text)) return false;
	if (/[^\x00-\x7f]/u.test(text)) return [...text].length <= 15;
	return text.split(/\s+/u).length <= 7;
}

function createFingerprint(vocabulary: readonly NormalizedVocabularyEntry[]): string {
	return createHash('sha256').update(JSON.stringify(vocabulary)).digest('hex');
}
