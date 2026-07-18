import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface RunOptions {
	readonly capture?: boolean;
	readonly cwd?: string;
	readonly env?: NodeJS.ProcessEnv;
}

interface RunResult {
	readonly stderr: string;
	readonly stdout: string;
}

const ROOT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_DIRECTORY = path.join(ROOT_DIRECTORY, 'dist/release');
const GENERATED_AUR_DIRECTORY = path.join(RELEASE_DIRECTORY, 'aur');
const AUR_PACKAGE_NAME = 'voxspell-bin';
const AUR_REPOSITORY = `ssh://aur@aur.archlinux.org/${AUR_PACKAGE_NAME}.git`;

async function run(
	command: string,
	arguments_: readonly string[],
	options: RunOptions = {},
): Promise<RunResult> {
	const capture = options.capture === true;
	return new Promise<RunResult>((resolve, reject) => {
		const child = spawn(command, arguments_, {
			cwd: options.cwd ?? ROOT_DIRECTORY,
			env: options.env ?? process.env,
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
		child.once('error', reject);
		child.once('exit', (code) => {
			if (code === 0) {
				resolve({ stdout, stderr });
				return;
			}
			const detail = capture ? `\n${stderr || stdout}` : '';
			reject(new Error(`${command} ${arguments_.join(' ')} 失败，退出码 ${code}${detail}`));
		});
	});
}

async function readPackageVersion(): Promise<string> {
	const source = await readFile(path.join(ROOT_DIRECTORY, 'package.json'), 'utf8');
	return (JSON.parse(source) as { readonly version: string }).version;
}

async function ensureAurEnvironment(): Promise<void> {
	if (process.platform !== 'linux' || process.arch !== 'x64') {
		throw new Error('AUR 打包当前只支持 Linux x86_64');
	}
	await access('/etc/arch-release');
	const requiredCommands: ReadonlyArray<readonly [string, readonly string[]]> = [
		['git', ['--version']],
		['makepkg', ['--version']],
	];
	for (const [command, arguments_] of requiredCommands) {
		await run(command, arguments_, { capture: true });
	}
}

async function prepareAurFiles() {
	await ensureAurEnvironment();
	const version = await readPackageVersion();
	const assetName = `voxspell-${version}-linux-x86_64.tar.zst`;
	const assetPath = path.join(RELEASE_DIRECTORY, assetName);
	const digest = createHash('sha256')
		.update(await readFile(assetPath))
		.digest('hex');
	await rm(GENERATED_AUR_DIRECTORY, { recursive: true, force: true });
	await mkdir(GENERATED_AUR_DIRECTORY, { recursive: true });
	const template = await readFile(
		path.join(ROOT_DIRECTORY, 'packaging/aur/PKGBUILD.template'),
		'utf8',
	);
	const pkgbuild = template.replaceAll('@VERSION@', version).replaceAll('@SHA256@', digest);
	await writeFile(path.join(GENERATED_AUR_DIRECTORY, 'PKGBUILD'), pkgbuild);
	await cp(
		path.join(ROOT_DIRECTORY, 'packaging/aur/voxspell-bin.install'),
		path.join(GENERATED_AUR_DIRECTORY, 'voxspell-bin.install'),
	);
	await cp(path.join(ROOT_DIRECTORY, 'LICENSE'), path.join(GENERATED_AUR_DIRECTORY, 'LICENSE'));
	const { stdout } = await run('makepkg', ['--printsrcinfo'], {
		cwd: GENERATED_AUR_DIRECTORY,
		capture: true,
	});
	await writeFile(path.join(GENERATED_AUR_DIRECTORY, '.SRCINFO'), stdout);
	return { assetName, assetPath, version };
}

async function buildAurPackage(): Promise<void> {
	const release = await prepareAurFiles();
	await cp(release.assetPath, path.join(GENERATED_AUR_DIRECTORY, release.assetName));
	const { stdout: packageList } = await run('makepkg', ['--packagelist'], {
		cwd: GENERATED_AUR_DIRECTORY,
		capture: true,
	});
	await run('makepkg', ['--nodeps', '--cleanbuild', '--force'], {
		cwd: GENERATED_AUR_DIRECTORY,
	});
	console.log(`\n已生成 ${path.relative(ROOT_DIRECTORY, packageList.trim())}`);
}

async function publishAur(): Promise<void> {
	const release = await prepareAurFiles();
	const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'voxspell-aur-'));
	const repositoryDirectory = path.join(temporaryDirectory, AUR_PACKAGE_NAME);
	try {
		await run('git', [
			'-c',
			'init.defaultBranch=master',
			'clone',
			AUR_REPOSITORY,
			repositoryDirectory,
		]);
		for (const file of ['PKGBUILD', '.SRCINFO', 'voxspell-bin.install', 'LICENSE']) {
			await cp(
				path.join(GENERATED_AUR_DIRECTORY, file),
				path.join(repositoryDirectory, file),
			);
		}
		await run('makepkg', ['--verifysource'], { cwd: repositoryDirectory });
		await run('git', ['add', 'PKGBUILD', '.SRCINFO', 'voxspell-bin.install', 'LICENSE'], {
			cwd: repositoryDirectory,
		});
		const { stdout: changes } = await run('git', ['status', '--porcelain'], {
			cwd: repositoryDirectory,
			capture: true,
		});
		if (!changes) {
			console.log('AUR 已是当前版本，无需提交');
			return;
		}
		await run('git', ['commit', '-m', `更新至 ${release.version}`], {
			cwd: repositoryDirectory,
		});
		await run('git', ['push', 'origin', 'HEAD:master'], { cwd: repositoryDirectory });
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

const command = process.argv[2] ?? 'publish';
if (command !== 'build' && command !== 'publish') {
	console.error('用法：node scripts/release-aur.mts [build|publish]');
	process.exitCode = 2;
} else {
	const task = command === 'build' ? buildAurPackage() : publishAur();
	await task.catch((error) => {
		console.error(`\nAUR 发布失败：${error instanceof Error ? error.message : error}`);
		process.exitCode = 1;
	});
}
