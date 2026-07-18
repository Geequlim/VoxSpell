import { readFile } from 'node:fs/promises';

import { Value } from '@sinclair/typebox/value';
import { parse } from 'yaml';

import { VoxSpellConfigSchema } from './config-schema.js';

import type { VoxSpellConfig } from './config-schema.js';

export interface ConfigValidationIssue {
	readonly path: string;
	readonly message: string;
}

/** 表示配置文件无法被解析为有效的 VoxSpell 配置。 */
export class VoxSpellConfigError extends Error {
	readonly issues: readonly ConfigValidationIssue[];

	constructor(message: string, issues: readonly ConfigValidationIssue[] = []) {
		super(message);
		this.name = 'VoxSpellConfigError';
		this.issues = issues;
	}
}

/** 表示默认主配置尚未创建。 */
export class VoxSpellConfigNotFoundError extends VoxSpellConfigError {
	constructor(filePath: string) {
		super(`VoxSpell config does not exist: ${filePath}`);
		this.name = 'VoxSpellConfigNotFoundError';
	}
}

/** 解析未知配置值并完成跨字段约束校验。 */
export function parseVoxSpellConfig(value: unknown): VoxSpellConfig {
	const issues = [...Value.Errors(VoxSpellConfigSchema, value)].map((issue) => ({
		path: issue.path,
		message: issue.message,
	}));
	if (issues.length > 0) throw new VoxSpellConfigError('VoxSpell config is invalid', issues);

	const config = value as VoxSpellConfig;
	const providerIds = new Set<string>();
	for (const provider of config.asr.providers) {
		if (providerIds.has(provider.id)) {
			throw new VoxSpellConfigError(`ASR provider id is duplicated: ${provider.id}`);
		}
		providerIds.add(provider.id);
	}
	if (!providerIds.has(config.asr.activeProvider)) {
		throw new VoxSpellConfigError(
			`Active ASR provider does not exist: ${config.asr.activeProvider}`,
		);
	}
	if (config.polishing) validatePolishingConfig(config.polishing);
	return config;
}

/** 校验润色配置中无法由 TypeBox 单独表达的引用关系。 */
function validatePolishingConfig(config: NonNullable<VoxSpellConfig['polishing']>): void {
	if (config.systemPrompt.trim().length === 0) {
		throw new VoxSpellConfigError('Text polishing system prompt is empty');
	}
	const providerIds = new Set<string>();
	for (const provider of config.providers) {
		if (providerIds.has(provider.id)) {
			throw new VoxSpellConfigError(
				`Text polisher provider id is duplicated: ${provider.id}`,
			);
		}
		providerIds.add(provider.id);
	}
	if (config.activeProvider && !providerIds.has(config.activeProvider)) {
		throw new VoxSpellConfigError('Active text polisher provider does not exist');
	}
	if (config.enabled && !config.activeProvider) {
		throw new VoxSpellConfigError('Active text polisher provider does not exist');
	}
}

/** 从 YAML 文件加载并校验 VoxSpell 配置。 */
export async function loadVoxSpellConfig(filePath: string): Promise<VoxSpellConfig> {
	let source: string;
	try {
		source = await readFile(filePath, 'utf8');
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			throw new VoxSpellConfigNotFoundError(filePath);
		}
		throw new VoxSpellConfigError(`Unable to read VoxSpell config: ${filePath}`);
	}

	let value: unknown;
	try {
		value = parse(source);
	} catch (error) {
		throw new VoxSpellConfigError(`Unable to parse VoxSpell config: ${filePath}`);
	}
	return parseVoxSpellConfig(value);
}
