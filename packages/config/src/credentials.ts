import { chmod, mkdir, readFile } from 'node:fs/promises';

import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import { atomicWriteFile } from './atomic-write.js';

import type { Static } from '@sinclair/typebox';

const ENVIRONMENT_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export const VoxSpellCredentialsSchema = Type.Object(
	{
		version: Type.Literal(1),
		values: Type.Record(Type.String(), Type.String({ minLength: 1 })),
	},
	{ additionalProperties: false },
);

export type VoxSpellCredentials = Static<typeof VoxSpellCredentialsSchema>;

/** 表示凭据文件内容无效或无法读取。 */
export class VoxSpellCredentialsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'VoxSpellCredentialsError';
	}
}

/** 创建不包含任何凭据的存储内容。 */
export function createEmptyCredentials(): VoxSpellCredentials {
	return { version: 1, values: {} };
}

/** 校验来自磁盘或 RPC 的凭据存储结构。 */
export function parseVoxSpellCredentials(value: unknown): VoxSpellCredentials {
	if (!Value.Check(VoxSpellCredentialsSchema, value)) {
		throw new VoxSpellCredentialsError('VoxSpell credentials are invalid');
	}
	if (Object.keys(value.values).some((name) => !ENVIRONMENT_NAME_PATTERN.test(name))) {
		throw new VoxSpellCredentialsError('VoxSpell credential name is invalid');
	}
	return value;
}

/** 加载凭据文件；文件不存在时返回空存储。 */
export async function loadVoxSpellCredentials(filePath: string): Promise<VoxSpellCredentials> {
	let source: string;
	try {
		source = await readFile(filePath, 'utf8');
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			return createEmptyCredentials();
		}
		throw new VoxSpellCredentialsError(`Unable to read VoxSpell credentials: ${filePath}`);
	}

	let value: unknown;
	try {
		value = JSON.parse(source);
	} catch (error) {
		throw new VoxSpellCredentialsError(`Unable to parse VoxSpell credentials: ${filePath}`);
	}
	return parseVoxSpellCredentials(value);
}

/** 使用私有目录和文件权限原子保存凭据。 */
export async function saveVoxSpellCredentials(
	directory: string,
	filePath: string,
	credentials: VoxSpellCredentials,
): Promise<void> {
	parseVoxSpellCredentials(credentials);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);
	await atomicWriteFile(filePath, `${JSON.stringify(credentials, undefined, 2)}\n`, 0o600);
}
