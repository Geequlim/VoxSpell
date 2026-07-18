import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { access, chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_DIRECTORY = path.join(ROOT_DIRECTORY, 'dist/release');
const STAGING_DIRECTORY = path.join(RELEASE_DIRECTORY, 'root');
const GENERATED_AUR_DIRECTORY = path.join(RELEASE_DIRECTORY, 'aur');
const AUR_PACKAGE_NAME = 'voxspell-bin';
const AUR_REPOSITORY = `ssh://aur@aur.archlinux.org/${AUR_PACKAGE_NAME}.git`;
const GITHUB_REPOSITORY = 'Geequlim/VoxSpell';
const NODE_VERSION = '24.16.0';
const NODE_ARCHIVE_SHA256 = 'd804845d34eddc21dc1092b519d643ef40b1f58ec5dec5c22b1f4bd8fabde6c9';

async function run(command, arguments_, options = {}) {
	const capture = options.capture === true;
	return new Promise((resolve, reject) => {
		const child = spawn(command, arguments_, {
			cwd: options.cwd ?? ROOT_DIRECTORY,
			env: options.env ?? process.env,
			stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
		});
		let stdout = '';
		let stderr = '';
		if (capture) {
			child.stdout.setEncoding('utf8');
			child.stderr.setEncoding('utf8');
			child.stdout.on('data', (chunk) => {
				stdout += chunk;
			});
			child.stderr.on('data', (chunk) => {
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

async function commandSucceeds(command, arguments_, options = {}) {
	try {
		await run(command, arguments_, { ...options, capture: true });
		return true;
	} catch {
		return false;
	}
}

async function readPackageVersion() {
	const source = await readFile(path.join(ROOT_DIRECTORY, 'package.json'), 'utf8');
	return JSON.parse(source).version;
}

async function validateVersions(version) {
	const packageFiles = ['package.json'];
	for (const workspaceDirectory of ['apps', 'packages']) {
		const entries = await readdir(path.join(ROOT_DIRECTORY, workspaceDirectory), {
			withFileTypes: true,
		});
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const packageFile = path.join(workspaceDirectory, entry.name, 'package.json');
			if (existsSync(path.join(ROOT_DIRECTORY, packageFile))) packageFiles.push(packageFile);
		}
	}
	for (const packageFile of packageFiles) {
		const source = await readFile(path.join(ROOT_DIRECTORY, packageFile), 'utf8');
		const packageVersion = JSON.parse(source).version;
		if (packageVersion !== version) {
			throw new Error(`${packageFile} 的版本 ${packageVersion} 与根版本 ${version} 不一致`);
		}
	}
	const cmakeSource = await readFile(
		path.join(ROOT_DIRECTORY, 'native/fcitx5-addon/CMakeLists.txt'),
		'utf8',
	);
	if (!cmakeSource.includes(`project(voxspell-fcitx5-addon VERSION ${version} `)) {
		throw new Error(`Fcitx addon 的 CMake 版本与 ${version} 不一致`);
	}
}

async function ensureArchBuildEnvironment() {
	if (process.platform !== 'linux' || process.arch !== 'x64') {
		throw new Error('AUR 二进制发布当前只支持 Linux x86_64');
	}
	await access('/etc/arch-release');
	for (const [command, arguments_] of [
		['cmake', ['--version']],
		['curl', ['--version']],
		['git', ['--version']],
		['makepkg', ['--version']],
		['tar', ['--version']],
		['yarn', ['--version']],
	]) {
		if (!(await commandSucceeds(command, arguments_))) throw new Error(`缺少发布命令：${command}`);
	}
	if (process.versions.modules !== '137') {
		throw new Error(`发布构建需要 Node.js 24 ABI 137，当前 ABI 为 ${process.versions.modules}`);
	}
}

async function installNodeRuntime() {
	const archiveName = `node-v${NODE_VERSION}-linux-x64.tar.xz`;
	const archiveDirectory = path.join(ROOT_DIRECTORY, 'dist/cache/node');
	const archivePath = path.join(archiveDirectory, archiveName);
	const archiveUrl = `https://nodejs.org/dist/v${NODE_VERSION}/${archiveName}`;
	await mkdir(archiveDirectory, { recursive: true });
	if (existsSync(archivePath)) {
		const digest = createHash('sha256').update(await readFile(archivePath)).digest('hex');
		if (digest !== NODE_ARCHIVE_SHA256) await rm(archivePath);
	}
	if (!existsSync(archivePath)) {
		await run('curl', ['--fail', '--location', '--output', archivePath, archiveUrl]);
	}
	const digest = createHash('sha256').update(await readFile(archivePath)).digest('hex');
	if (digest !== NODE_ARCHIVE_SHA256) {
		throw new Error(`Node.js ${NODE_VERSION} 归档校验失败`);
	}
	const runtimeDirectory = path.join(STAGING_DIRECTORY, 'usr/lib/voxspell/runtime');
	await mkdir(runtimeDirectory, { recursive: true });
	await run('tar', [
		'--extract',
		'--xz',
		'--file',
		archivePath,
		'--directory',
		runtimeDirectory,
		'--strip-components=1',
		`node-v${NODE_VERSION}-linux-x64/bin/node`,
	]);
	const { stdout: nodeLicense } = await run(
		'tar',
		['--extract', '--to-stdout', '--xz', '--file', archivePath, `node-v${NODE_VERSION}-linux-x64/LICENSE`],
		{ capture: true },
	);
	await writeFile(
		path.join(STAGING_DIRECTORY, 'usr/share/licenses/voxspell-bin/LICENSE.nodejs'),
		nodeLicense,
	);
	await chmod(path.join(runtimeDirectory, 'bin/node'), 0o755);
}

async function installRuntimeDependencies() {
	const sourceNodeModules = path.join(ROOT_DIRECTORY, 'node_modules');
	const targetNodeModules = path.join(STAGING_DIRECTORY, 'usr/lib/voxspell/node_modules');
	const copiedPackages = new Set();
	const findPackageDirectory = (packageName, parentDirectory) => {
		let currentDirectory = parentDirectory;
		while (currentDirectory.startsWith(ROOT_DIRECTORY)) {
			const packageDirectory = path.join(currentDirectory, 'node_modules', packageName);
			if (existsSync(path.join(packageDirectory, 'package.json'))) return packageDirectory;
			const nextDirectory = path.dirname(currentDirectory);
			if (nextDirectory === currentDirectory) break;
			currentDirectory = nextDirectory;
		}
		throw new Error(`无法解析运行依赖：${packageName}`);
	};
	const copyPackage = async (packageName, parentDirectory = ROOT_DIRECTORY) => {
		const packageDirectory = findPackageDirectory(packageName, parentDirectory);
		if (copiedPackages.has(packageDirectory)) return;
		copiedPackages.add(packageDirectory);
		const relativeDirectory = path.relative(sourceNodeModules, packageDirectory);
		if (relativeDirectory.startsWith('..')) {
			throw new Error(`${packageName} 未解析到根 node_modules`);
		}
		const packageSource = await readFile(path.join(packageDirectory, 'package.json'), 'utf8');
		const packageManifest = JSON.parse(packageSource);
		const dependencyNames = Object.keys({
			...packageManifest.dependencies,
			...packageManifest.optionalDependencies,
		});
		for (const dependencyName of dependencyNames) {
			if (
				packageName === 'node-gtk' &&
				(dependencyName === '@mapbox/node-pre-gyp' ||
					dependencyName === 'nan' ||
					dependencyName === 'node-gyp')
			) {
				continue;
			}
			await copyPackage(dependencyName, packageDirectory);
		}
		await cp(packageDirectory, path.join(targetNodeModules, relativeDirectory), {
			recursive: true,
			dereference: true,
		});
	};
	await copyPackage('node-gtk');
	await copyPackage('@homebridge/dbus-native');
	for (const packageDirectory of copiedPackages) {
		const relativeDirectory = path.relative(sourceNodeModules, packageDirectory);
		await rm(path.join(targetNodeModules, relativeDirectory, 'bin'), {
			recursive: true,
			force: true,
		});
	}
	for (const entry of [
		'binding.gyp',
		'build',
		'node_modules',
		'README.md',
		'scripts',
		'src',
		'tools',
	]) {
		await rm(path.join(targetNodeModules, 'node-gtk', entry), {
			recursive: true,
			force: true,
		});
	}
}

async function stageReleaseFiles() {
	await rm(RELEASE_DIRECTORY, { recursive: true, force: true });
	await mkdir(path.join(STAGING_DIRECTORY, 'usr/lib/voxspell/desktop'), { recursive: true });
	await mkdir(path.join(STAGING_DIRECTORY, 'usr/lib/voxspell/daemon'), { recursive: true });
	await mkdir(path.join(STAGING_DIRECTORY, 'usr/share/licenses/voxspell-bin'), {
		recursive: true,
	});
	await cp(
		path.join(ROOT_DIRECTORY, 'apps/desktop/dist/index.cjs'),
		path.join(STAGING_DIRECTORY, 'usr/lib/voxspell/desktop/index.cjs'),
	);
	await cp(
		path.join(ROOT_DIRECTORY, 'apps/daemon/dist/index.cjs'),
		path.join(STAGING_DIRECTORY, 'usr/lib/voxspell/daemon/index.cjs'),
	);
	await cp(
		path.join(ROOT_DIRECTORY, 'packaging/arch/root'),
		STAGING_DIRECTORY,
		{ recursive: true },
	);
	await cp(
		path.join(ROOT_DIRECTORY, 'apps/desktop/icons/hicolor'),
		path.join(STAGING_DIRECTORY, 'usr/share/icons/hicolor'),
		{ recursive: true },
	);
	await rm(path.join(STAGING_DIRECTORY, 'usr/share/icons/hicolor/index.theme'));
	await cp(
		path.join(ROOT_DIRECTORY, 'LICENSE'),
		path.join(STAGING_DIRECTORY, 'usr/share/licenses/voxspell-bin/LICENSE'),
	);
	await cp(
		path.join(ROOT_DIRECTORY, 'NOTICE'),
		path.join(STAGING_DIRECTORY, 'usr/share/licenses/voxspell-bin/NOTICE'),
	);
	await chmod(path.join(STAGING_DIRECTORY, 'usr/bin/voxspell'), 0o755);
	await chmod(path.join(STAGING_DIRECTORY, 'usr/bin/voxspell-daemon'), 0o755);
}

async function createBinaryArchive(version) {
	const assetName = `voxspell-${version}-linux-x86_64.tar.zst`;
	const assetPath = path.join(RELEASE_DIRECTORY, assetName);
	const { stdout } = await run('git', ['log', '-1', '--format=%ct'], { capture: true });
	await run('tar', [
		'--create',
		'--zstd',
		'--sort=name',
		'--owner=0',
		'--group=0',
		'--numeric-owner',
		`--mtime=@${stdout.trim()}`,
		'--file',
		assetPath,
		'--directory',
		STAGING_DIRECTORY,
		'.',
	]);
	const digest = createHash('sha256').update(await readFile(assetPath)).digest('hex');
	const checksumPath = path.join(RELEASE_DIRECTORY, 'SHA256SUMS');
	await writeFile(checksumPath, `${digest}  ${assetName}\n`);
	return { assetName, assetPath, checksumPath, digest };
}

async function generateAurFiles(version, digest) {
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
}

async function buildRelease() {
	const version = await readPackageVersion();
	await ensureArchBuildEnvironment();
	await validateVersions(version);
	await run('yarn', ['install', '--immutable']);
	await run('yarn', ['tiny', 'build']);
	await run('yarn', ['tiny', 'build/desktop']);
	await run('yarn', ['tiny', 'build/fcitx5-addon']);
	await stageReleaseFiles();
	await installNodeRuntime();
	await installRuntimeDependencies();
	await run('cmake', ['--install', 'dist/native/fcitx5-addon', '--prefix', '/usr'], {
		env: { ...process.env, DESTDIR: STAGING_DIRECTORY },
	});
	const asset = await createBinaryArchive(version);
	await generateAurFiles(version, asset.digest);
	console.log(`\n已生成 ${path.relative(ROOT_DIRECTORY, asset.assetPath)}`);
	console.log(`已生成 ${path.relative(ROOT_DIRECTORY, GENERATED_AUR_DIRECTORY)}/`);
	return { version, ...asset };
}

async function ensurePublishState(version) {
	const tag = `v${version}`;
	const { stdout: status } = await run('git', ['status', '--porcelain'], { capture: true });
	if (status) throw new Error('发布前工作区必须保持干净');
	const { stdout: head } = await run('git', ['rev-parse', 'HEAD'], { capture: true });
	const { stdout: tagCommit } = await run('git', ['rev-list', '-n', '1', tag], { capture: true });
	if (head.trim() !== tagCommit.trim()) throw new Error(`${tag} 必须指向当前提交`);
	if (!(await commandSucceeds('git', ['ls-remote', '--exit-code', 'origin', `refs/tags/${tag}`]))) {
		throw new Error(`${tag} 尚未推送到 origin`);
	}
	if (!(await commandSucceeds('gh', ['auth', 'status']))) throw new Error('GitHub CLI 尚未登录');
	return tag;
}

async function publishGithubRelease(tag, assetPaths) {
	if (await commandSucceeds('gh', ['release', 'view', tag, '--repo', GITHUB_REPOSITORY])) {
		await run('gh', [
			'release',
			'upload',
			tag,
			...assetPaths,
			'--clobber',
			'--repo',
			GITHUB_REPOSITORY,
		]);
		return;
	}
	await run('gh', [
		'release',
		'create',
		tag,
		...assetPaths,
		'--verify-tag',
		'--generate-notes',
		'--title',
		`VoxSpell ${tag.slice(1)}`,
		'--repo',
		GITHUB_REPOSITORY,
	]);
}

async function publishAur(version) {
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
			await cp(path.join(GENERATED_AUR_DIRECTORY, file), path.join(repositoryDirectory, file));
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
		await run('git', ['commit', '-m', `更新至 ${version}`], { cwd: repositoryDirectory });
		await run('git', ['push', 'origin', 'HEAD:master'], { cwd: repositoryDirectory });
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

async function publishRelease() {
	const version = await readPackageVersion();
	const tag = await ensurePublishState(version);
	await run('yarn', ['tiny', 'typecheck']);
	await run('yarn', ['tiny', 'test']);
	await run('yarn', ['tiny', 'test/fcitx5-addon']);
	const release = await buildRelease();
	await publishGithubRelease(tag, [release.assetPath, release.checksumPath]);
	await publishAur(version);
}

const command = process.argv[2] ?? 'publish';
if (command !== 'build' && command !== 'publish') {
	console.error('用法：node scripts/release-aur.mjs [build|publish]');
	process.exitCode = 2;
} else {
	const task = command === 'build' ? buildRelease() : publishRelease();
	await task.catch((error) => {
		console.error(`\nAUR 发布失败：${error instanceof Error ? error.message : error}`);
		process.exitCode = 1;
	});
}
