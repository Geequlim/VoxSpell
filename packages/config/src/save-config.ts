import { chmod, mkdir } from 'node:fs/promises';

import { stringify } from 'yaml';

import { atomicWriteFile } from './atomic-write.js';
import { parseVoxSpellConfig } from './load-config.js';

import type { VoxSpellConfig } from './config-schema.js';

/** 使用私有目录和原子替换保存经过校验的主配置。 */
export async function saveVoxSpellConfig(
	directory: string,
	filePath: string,
	config: VoxSpellConfig,
): Promise<void> {
	parseVoxSpellConfig(config);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);
	await atomicWriteFile(filePath, stringify(config), 0o600);
}
