import { spawn } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { stdin, stdout } from 'node:process';

const ROOT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

interface RunResult {
	readonly stderr: string;
	readonly stdout: string;
}

async function run(
	command: string,
	arguments_: readonly string[],
	capture = false,
): Promise<RunResult> {
	return new Promise<RunResult>((resolve, reject) => {
		const child = spawn(command, arguments_, {
			cwd: ROOT_DIRECTORY,
			stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
		});
		let stdout = '';
		let stderr = '';
		if (capture) {
			child.stdout?.setEncoding('utf8');
			child.stderr?.setEncoding('utf8');
			child.stdout?.on('data', (chunk: string) => {
				stdout += chunk;
			});
			child.stderr?.on('data', (chunk: string) => {
				stderr += chunk;
			});
		}
		child.on('error', reject);
		child.on('exit', (code: number) => {
			if (code === 0) {
				resolve({ stdout, stderr });
				return;
			}
			const detail = capture ? `\n${stderr || stdout}` : '';
			reject(new Error(`${command} ${arguments_.join(' ')} 失败，退出码 ${code}${detail}`));
		});
	});
}

async function commandSucceeds(command: string, arguments_: readonly string[]): Promise<boolean> {
	try {
		await run(command, arguments_, true);
		return true;
	} catch {
		return false;
	}
}

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

async function updateVersion(version: string): Promise<readonly string[]> {
	if (!parseVersion(version)) {
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
	return [...packageFiles, cmakePath];
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

function parseVersion(version: string): readonly [number, number, number] | undefined {
	const match = VERSION_PATTERN.exec(version);
	if (!match) return undefined;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: string, right: string): number {
	const leftParts = parseVersion(left);
	const rightParts = parseVersion(right);
	if (!leftParts || !rightParts) throw new Error('版本号必须是 x.y.z 格式');
	for (let index = 0; index < leftParts.length; index += 1) {
		if (leftParts[index] !== rightParts[index]) {
			return leftParts[index]! > rightParts[index]! ? 1 : -1;
		}
	}
	return 0;
}

async function ensureCleanWorktree(): Promise<void> {
	const { stdout } = await run('git', ['status', '--porcelain'], true);
	if (stdout.trim()) throw new Error('版本操作前工作区必须保持干净，请先提交或处理现有改动');
}

async function ensureTagAvailable(tag: string): Promise<void> {
	if (await commandSucceeds('git', ['rev-parse', '--verify', `refs/tags/${tag}`])) {
		throw new Error(`${tag} 已存在本地，自动流程不会覆盖已有 tag`);
	}
	if (await commandSucceeds('git', ['ls-remote', '--exit-code', 'origin', `refs/tags/${tag}`])) {
		throw new Error(`${tag} 已存在于 origin，自动流程不会覆盖已有 tag`);
	}
}

async function getCurrentBranch(): Promise<string> {
	const { stdout } = await run('git', ['branch', '--show-current'], true);
	const branch = stdout.trim();
	if (!branch) throw new Error('当前处于 detached HEAD，无法自动推送当前分支');
	return branch;
}

const version = (await readVersionArgument())?.trim();
if (!version) {
	console.error('用法：node scripts/update-version.mts <x.y.z>');
	process.exitCode = 2;
} else {
	try {
		const currentVersion = await getCurrentVersion();
		if (compareVersions(version, currentVersion) <= 0) {
			throw new Error(`新版本 ${version} 必须高于当前版本 ${currentVersion}`);
		}
		await ensureCleanWorktree();
		const tag = `v${version}`;
		await ensureTagAvailable(tag);
		const branch = await getCurrentBranch();
		const files = await updateVersion(version);
		const relativeFiles = files.map((filePath) => path.relative(ROOT_DIRECTORY, filePath));
		await run('git', ['add', '--', ...relativeFiles]);
		await run('git', ['commit', '-m', `chore: 更新所有包的版本号至 ${version}`]);
		await run('git', ['tag', tag]);
		await run('git', [
			'push',
			'--atomic',
			'origin',
			`HEAD:refs/heads/${branch}`,
			`refs/tags/${tag}`,
		]);
		console.log(`已提交并推送 ${branch} 与 ${tag}`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
