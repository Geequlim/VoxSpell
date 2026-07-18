import { randomUUID } from 'node:crypto';

import type { RealtimeAsrProvider, RealtimeAsrSession } from '@voxspell/asr-core/realtime-asr';
import type { ProviderTestResult } from '@voxspell/protocol/provider';

const TEST_TIMEOUT_MS = 15_000;
const SILENCE_FRAME = new Uint8Array(3_200);

/** 表示 Provider 测试以稳定、脱敏的错误码失败。 */
export class AsrProviderTestError extends Error {
	readonly providerCode: string;
	readonly retryable: boolean;

	constructor(providerCode: string, retryable: boolean) {
		super('ASR provider test failed');
		this.name = 'AsrProviderTestError';
		this.providerCode = providerCode;
		this.retryable = retryable;
	}
}

/** 使用独立最小会话测试 Provider，不替换 daemon 当前运行时。 */
export async function testAsrProvider(provider: RealtimeAsrProvider): Promise<ProviderTestResult> {
	const startedAt = performance.now();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort('provider test timeout'), TEST_TIMEOUT_MS);
	let session: RealtimeAsrSession | undefined;
	try {
		session = await provider.createSession({ sessionId: randomUUID() });
		await session.start(controller.signal);
		if (provider.capabilities.partialResults) {
			return createResult(provider, startedAt);
		}

		await session.writeAudio(SILENCE_FRAME);
		await session.finish();
		for await (const event of session.events()) {
			if (
				event.type === 'completed' ||
				(event.type === 'error' && event.code === 'INVALID_RESPONSE')
			) {
				return createResult(provider, startedAt);
			}
			if (event.type === 'error') throw new AsrProviderTestError(event.code, event.retryable);
		}
		throw new AsrProviderTestError('EMPTY_RESPONSE', true);
	} catch (error) {
		if (error instanceof AsrProviderTestError) throw error;
		if (controller.signal.aborted) throw new AsrProviderTestError('TEST_TIMEOUT', true);
		throw new AsrProviderTestError('CONNECTION_FAILED', true);
	} finally {
		clearTimeout(timeout);
		await session?.cancel('provider test completed').catch(() => undefined);
	}
}

function createResult(provider: RealtimeAsrProvider, startedAt: number): ProviderTestResult {
	return {
		latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
		partialResults: provider.capabilities.partialResults,
	};
}
