import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { stdin, stdout } from 'node:process';

const ROOT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

async function getPackageFiles(): Promise<string[]> {
	const files = [path.join(ROOT_DIRECTORY, 'package.json')];
	for (const workspaceDirectory of ['apps', 'packages']) {
		const entries = await readdir(path.join(ROOT_DIRECTORY, workspaceDirectory), {
			withFileTypes: true,
		});
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			files.push(path.join(ROOT_DIRECTORY, workspaceDirectory, entry.name, 'package.json'));
		}
	}
	return files;
}

function replacePackageVersion(source: string, version: string, filePath: string): string {
	const pattern = /^(\s*"version"\s*:\s*")[^"]+("\s*,?\s*)$/m;
	if (!pattern.test(source)) throw new Error(`无法在 ${filePath} 找到 package.json 版本字段`);
	return source.replace(pattern, `$1${version}$2`);
}

async function updateVersion(version: string): Promise<void> {
	if (!VERSION_PATTERN.test(version)) {
		throw new Error(`版本号必须是 x.y.z 格式，例如 0.2.0：${version}`);
	}

	const packageFiles = await getPackageFiles();
	const changes = await Promise.all(
		packageFiles.map(async (filePath) => {
			const source = await readFile(filePath, 'utf8');
			return { filePath, source: replacePackageVersion(source, version, filePath) };
		}),
	);
	const cmakePath = path.join(ROOT_DIRECTORY, 'native/fcitx5-addon/CMakeLists.txt');
	const cmakeSource = await readFile(cmakePath, 'utf8');
	const cmakePattern = /(project\(voxspell-fcitx5-addon VERSION )\d+\.\d+\.\d+( LANGUAGES CXX\))/;
	if (!cmakePattern.test(cmakeSource)) {
		throw new Error(`无法在 ${cmakePath} 找到 Fcitx addon 版本字段`);
	}
	const cmakeUpdated = cmakeSource.replace(cmakePattern, `$1${version}$2`);

	await Promise.all(changes.map(({ filePath, source }) => writeFile(filePath, source)));
	await writeFile(cmakePath, cmakeUpdated);
	console.log(`已将 ${changes.length + 1} 个版本字段更新为 ${version}`);
	console.log(`建议提交版本修改后创建 Git tag：v${version}`);
	console.log(`git tag v${version}`);
	console.log(`git push origin v${version}`);
}

async function getCurrentVersion(): Promise<string> {
	const source = await readFile(path.join(ROOT_DIRECTORY, 'package.json'), 'utf8');
	const match = source.match(/^\s*"version"\s*:\s*"([^"]+)"\s*,?\s*$/m);
	if (!match) throw new Error('无法读取根 package.json 的当前版本');
	return match[1]!;
}

async function readVersionArgument(): Promise<string | undefined> {
	const argument = process.argv[2];
	if (argument) return argument;
	if (!stdin.isTTY || !stdout.isTTY) return undefined;

	const currentVersion = await getCurrentVersion();
	console.log(`当前版本：${currentVersion}`);
	const readline = createInterface({ input: stdin, output: stdout });
	try {
		return (await readline.question('请输入新版本号（x.y.z）：')).trim();
	} finally {
		readline.close();
	}
}

const version = await readVersionArgument();
if (!version) {
	console.error('用法：node scripts/update-version.mts <x.y.z>');
	process.exitCode = 2;
} else {
	await updateVersion(version).catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
