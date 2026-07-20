import { access, chmod, mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '@voxspell/config/atomic-write';

const STATUS_ANIMATION_STAGE_IDS = new Set([
	'connecting',
	'preparing',
	'recording',
	'recognizing',
	'processing',
	'polishing',
	'choosing',
	'submitting',
]);
const STATUS_ANIMATION_STAGE_KEYS = new Set(['id', 'name', 'frames', 'text', 'hint', 'interval']);
const MINIMUM_INTERVAL_MS = 80;
const MAXIMUM_INTERVAL_MS = 2_000;
const MAXIMUM_FRAME_COUNT = 256;

export const DEFAULT_STATUS_ANIMATION_SOURCE = `${JSON.stringify(
	[
		{
			id: 'connecting',
			name: '连接服务',
			frames: ['📡', '🌐', '🔗', '🌐'],
			text: '连接语音服务',
			hint: '请稍候',
			interval: 520,
		},
		{
			id: 'preparing',
			name: '准备中',
			frames: ['⏳', '⌛', '⏳', '⌛'],
			text: '准备中',
			hint: '请稍候',
			interval: 420,
		},
		{
			id: 'recording',
			name: '录音',
			frames: ['🔈', '🔉', '🔊', '🔉'],
			text: '请开始讲话',
			hint: '松开热键完成，Esc 取消',
			interval: 240,
		},
		{
			id: 'recognizing',
			name: '识别中',
			frames: ['💭', '💬', '💭', '💬'],
			text: '正在识别',
			hint: '请稍候',
			interval: 520,
		},
		{
			id: 'processing',
			name: '处理中',
			frames: ['🧠', '💭'],
			text: '正在处理',
			hint: '请稍候',
			interval: 420,
		},
		{
			id: 'polishing',
			name: '润色中',
			frames: ['✨', '🌟', '💫', '🌟', '✨'],
			text: '正在润色',
			hint: '请稍候',
			interval: 420,
		},
		{
			id: 'choosing',
			name: '选择结果',
			frames: ['👇'],
			text: '请选择结果',
			hint: '1 润色结果 · 2 识别结果 · Enter 确认',
			interval: 500,
		},
		{
			id: 'submitting',
			name: '提交中',
			frames: ['📤', '⏳', '⌛', '⏳', '📤'],
			text: '正在提交',
			hint: '请稍候',
			interval: 320,
		},
	],
	undefined,
	'\t',
)}\n`;

declare const validatedStatusAnimationSource: unique symbol;

export type ValidatedStatusAnimationSource = string & {
	readonly [validatedStatusAnimationSource]: true;
};

export interface StatusAnimationSourceSnapshot {
	readonly source: string;
	readonly custom: boolean;
}

export interface StatusAnimationConfigClient {
	getStatusAnimationSource(): Promise<StatusAnimationSourceSnapshot>;
	updateStatusAnimation(source: ValidatedStatusAnimationSource): Promise<void>;
	resetStatusAnimation(): Promise<StatusAnimationSourceSnapshot>;
	openStatusAnimationEditor(): Promise<void>;
}

/** 校验来自多行编辑器的状态动画 JSON。 */
export function validateStatusAnimationSource(source: string): ValidatedStatusAnimationSource {
	let value: unknown;
	try {
		value = JSON.parse(source);
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error(`JSON 解析失败：${error.message}`);
		throw error;
	}
	if (!Array.isArray(value)) throw new Error('配置最外层必须是动画阶段数组。');

	const stageIds = new Set<string>();
	value.forEach((stage, index) => {
		validateStage(stage, index, stageIds);
	});
	return source as ValidatedStatusAnimationSource;
}

/** 使用事务式文件替换维护状态动画配置。 */
export class FileStatusAnimationConfigClient implements StatusAnimationConfigClient {
	readonly #configFile: string;
	readonly #editorFile: string;
	readonly #reloadConfig: () => Promise<void>;
	readonly #openEditor: (filePath: string) => Promise<void>;

	constructor(
		configFile: string,
		editorFile: string,
		reloadConfig: () => Promise<void>,
		openEditor: (filePath: string) => Promise<void>,
	) {
		this.#configFile = configFile;
		this.#editorFile = editorFile;
		this.#reloadConfig = reloadConfig;
		this.#openEditor = openEditor;
	}

	/** 读取当前自定义配置；文件不存在表示使用内置默认值。 */
	async getStatusAnimationSource(): Promise<StatusAnimationSourceSnapshot> {
		const source = await readOptionalFile(this.#configFile);
		if (source === undefined) return { source: DEFAULT_STATUS_ANIMATION_SOURCE, custom: false };
		return { source, custom: true };
	}

	/** 写入已校验配置，并在 Fcitx 重载失败时恢复旧文件。 */
	async updateStatusAnimation(source: ValidatedStatusAnimationSource): Promise<void> {
		await this.#replaceConfig(source);
	}

	/** 移除自定义配置并恢复插件内置动画。 */
	async resetStatusAnimation(): Promise<StatusAnimationSourceSnapshot> {
		await this.#replaceConfig();
		return { source: DEFAULT_STATUS_ANIMATION_SOURCE, custom: false };
	}

	/** 通过系统默认应用打开随桌面程序发布的动画编辑器。 */
	async openStatusAnimationEditor(): Promise<void> {
		await access(this.#editorFile);
		await this.#openEditor(this.#editorFile);
	}

	async #replaceConfig(source?: string): Promise<void> {
		const previousSource = await readOptionalFile(this.#configFile);
		await writeOptionalFile(this.#configFile, source);
		try {
			await this.#reloadConfig();
		} catch (error) {
			try {
				await writeOptionalFile(this.#configFile, previousSource);
				await this.#reloadConfig();
			} catch (rollbackError) {
				throw new Error(
					`Fcitx 重载失败，且旧配置恢复失败：${describeError(rollbackError)}`,
					{ cause: error },
				);
			}
			throw error;
		}
	}
}

function validateStage(stage: unknown, index: number, stageIds: Set<string>): void {
	const label = `第 ${index + 1} 个动画阶段`;
	if (!stage || typeof stage !== 'object' || Array.isArray(stage)) {
		throw new Error(`${label}必须是对象。`);
	}
	const values = stage as Record<string, unknown>;
	const unknownKey = Object.keys(values).find((key) => !STATUS_ANIMATION_STAGE_KEYS.has(key));
	if (unknownKey) throw new Error(`${label}包含未知字段“${unknownKey}”。`);
	if (typeof values.id !== 'string' || !values.id) throw new Error(`${label}缺少有效的 id。`);
	if (!STATUS_ANIMATION_STAGE_IDS.has(values.id)) {
		throw new Error(`${label}使用了未知 id“${values.id}”。`);
	}
	if (stageIds.has(values.id)) throw new Error(`动画阶段“${values.id}”重复。`);
	stageIds.add(values.id);
	if (values.name !== undefined && typeof values.name !== 'string') {
		throw new Error(`${label}的 name 必须是字符串。`);
	}
	if (!Array.isArray(values.frames) || values.frames.length === 0) {
		throw new Error(`${label}至少需要一个动画帧。`);
	}
	if (values.frames.length > MAXIMUM_FRAME_COUNT) {
		throw new Error(`${label}最多允许 ${MAXIMUM_FRAME_COUNT} 个动画帧。`);
	}
	if (values.frames.some((frame) => typeof frame !== 'string' || !frame)) {
		throw new Error(`${label}的动画帧必须是非空字符串。`);
	}
	if (typeof values.text !== 'string' || !values.text) {
		throw new Error(`${label}缺少非空的 text。`);
	}
	if (values.hint !== undefined && typeof values.hint !== 'string') {
		throw new Error(`${label}的 hint 必须是字符串。`);
	}
	if (
		typeof values.interval !== 'number' ||
		!Number.isInteger(values.interval) ||
		values.interval < MINIMUM_INTERVAL_MS ||
		values.interval > MAXIMUM_INTERVAL_MS
	) {
		throw new Error(
			`${label}的 interval 必须是 ${MINIMUM_INTERVAL_MS} 到 ${MAXIMUM_INTERVAL_MS} 之间的整数。`,
		);
	}
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
	try {
		return await readFile(filePath, 'utf8');
	} catch (error) {
		if (isFileNotFoundError(error)) return undefined;
		throw error;
	}
}

async function writeOptionalFile(filePath: string, source?: string): Promise<void> {
	if (source === undefined) {
		await unlink(filePath).catch((error: unknown) => {
			if (!isFileNotFoundError(error)) throw error;
		});
		return;
	}
	const directory = path.dirname(filePath);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);
	await atomicWriteFile(filePath, source, 0o600);
}

function isFileNotFoundError(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function describeError(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	return '未知错误';
}
