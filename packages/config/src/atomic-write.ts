import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

import type { FileHandle } from 'node:fs/promises';

/** 将完整内容写入同目录临时文件，再原子替换目标文件。 */
export async function atomicWriteFile(
	filePath: string,
	content: string,
	mode: number,
): Promise<void> {
	const temporaryPath = path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.${randomUUID()}.tmp`,
	);
	let temporaryFile: FileHandle | undefined;
	try {
		temporaryFile = await open(temporaryPath, 'wx', mode);
		await temporaryFile.writeFile(content, 'utf8');
		await temporaryFile.sync();
		await temporaryFile.close();
		temporaryFile = undefined;
		await rename(temporaryPath, filePath);

		const directory = await open(path.dirname(filePath), 'r');
		try {
			await directory.sync();
		} finally {
			await directory.close();
		}
	} catch (error) {
		await temporaryFile?.close().catch(() => undefined);
		await unlink(temporaryPath).catch(() => undefined);
		throw error;
	}
}
