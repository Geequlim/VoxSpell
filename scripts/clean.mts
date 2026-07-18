import { readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_PARENT_DIRECTORIES = ['apps', 'packages'];
const USER_INSTALL_FILES = [
	path.join(homedir(), '.local/lib/fcitx5/voxspell.so'),
	path.join(homedir(), '.local/share/fcitx5/addon/voxspell.conf'),
];

const workspaceDistDirectories = (
	await Promise.all(
		WORKSPACE_PARENT_DIRECTORIES.map(async (parentDirectory) => {
			const directory = path.join(ROOT_DIRECTORY, parentDirectory);
			const entries = await readdir(directory, { withFileTypes: true });
			return entries
				.filter((entry) => entry.isDirectory())
				.map((entry) => path.join(directory, entry.name, 'dist'));
		}),
	)
).flat();
const distDirectories = [path.join(ROOT_DIRECTORY, 'dist'), ...workspaceDistDirectories];

await Promise.all([
	...distDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
	...USER_INSTALL_FILES.map((file) => rm(file, { force: true })),
]);

console.log('已清理项目 dist 目录和用户目录中的 VoxSpell Fcitx C++ 扩展。');
