import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { createConfiguredAsrProvider } from '../asr/create-configured-asr-provider.js';
import { parseWavePcm } from '../audio/wave-pcm.js';
import { transcribeFrames } from './asr-smoke-session.js';

const FIXTURE_FILES = [
	'ascend_test_00138.wav',
	'ascend_test_00938.wav',
	'ascend_test_01278.wav',
] as const;

/** 将一个 PCM 缓冲作为单帧异步音频源。 */
async function* createFrames(samples: Uint8Array): AsyncIterable<Uint8Array> {
	yield samples;
}

/** 使用一组固定 fixtures 执行显式真实 ASR 请求。 */
async function main(): Promise<void> {
	const configPath = process.env.VOXSPELL_CONFIG_PATH;
	if (!configPath) throw new Error('VOXSPELL_CONFIG_PATH is required');
	const provider = await createConfiguredAsrProvider(configPath);
	const fixtureDirectory = path.resolve('test/fixtures/ascend');
	console.log(
		`开始 fixtures ASR 冒烟测试：provider=${provider.id}，样本=${FIXTURE_FILES.length}`,
	);

	let passed = 0;
	for (const fileName of FIXTURE_FILES) {
		const filePath = path.join(fixtureDirectory, fileName);
		const source = await readFile(filePath);
		const expected = (await readFile(`${filePath}.txt`, 'utf8')).trim();
		const samples = parseWavePcm(source).samples;
		const startedAt = performance.now();
		const actual = await transcribeFrames(provider, createFrames(samples));
		const elapsedMilliseconds = Math.round(performance.now() - startedAt);
		passed += 1;
		console.log(`\n[${passed}/${FIXTURE_FILES.length}] ${fileName} (${elapsedMilliseconds}ms)`);
		console.log(`预期: ${expected}`);
		console.log(`识别: ${actual}`);
	}

	console.log(`\nfixtures ASR 冒烟完成：${passed}/${FIXTURE_FILES.length}`);
}

void main().catch((error) => {
	console.error(
		`[asr-fixtures-smoke] ${error instanceof Error ? error.message : 'unknown error'}`,
	);
	process.exitCode = 1;
});
