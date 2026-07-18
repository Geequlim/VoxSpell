import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { stringify } from 'yaml';

import { atomicWriteFile } from './atomic-write.js';
import { parseVoiceDictionary } from './load-dictionary.js';

import type { VoiceDictionary } from './dictionary-schema.js';

/** 使用私有目录和原子替换保存经过校验的语音词典。 */
export async function saveVoiceDictionary(
	filePath: string,
	dictionary: VoiceDictionary,
): Promise<void> {
	parseVoiceDictionary(dictionary);
	const directory = path.dirname(filePath);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);
	await atomicWriteFile(filePath, stringify(dictionary), 0o600);
}
