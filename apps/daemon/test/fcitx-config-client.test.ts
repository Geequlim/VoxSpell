import { describe, expect, it, vi } from 'vitest';

import { FcitxConfigClient, FcitxConfigError } from '../src/fcitx/fcitx-config-client.js';

import type { FcitxControllerTransport } from '../src/fcitx/fcitx-config-client.js';

function createRawConfig(
	pttKey = 'space',
	holdThresholdMs = '200',
	autoSelectResult = 'True',
): unknown {
	return [
		[],
		[
			[
				['PTTKey', [[], [pttKey]]],
				['HoldThresholdMs', [[], [holdThresholdMs]]],
				['AutoSelectResult', [[], [autoSelectResult]]],
			],
		],
	];
}

describe('FcitxConfigClient', () => {
	it('maps the Fcitx variant response to a stable config type', async () => {
		const transport: FcitxControllerTransport = {
			getConfig: async () => createRawConfig('Control+space', '350', 'False'),
			setConfig: async () => undefined,
		};
		const client = new FcitxConfigClient(transport);

		await expect(client.getConfig()).resolves.toEqual({
			pttKey: 'Control+space',
			holdThresholdMs: 350,
			autoSelectResult: false,
		});
	});

	it('writes only known addon fields and confirms the applied values', async () => {
		let rawConfig = createRawConfig();
		const setConfig = vi.fn(async (value: unknown) => {
			expect(value).toEqual([
				'a{sv}',
				[
					['PTTKey', ['s', 'Control+space']],
					['HoldThresholdMs', ['s', '350']],
					['AutoSelectResult', ['s', 'False']],
				],
			]);
			rawConfig = createRawConfig('Control+space', '350', 'False');
		});
		const client = new FcitxConfigClient({
			getConfig: async () => rawConfig,
			setConfig,
		});

		await client.updateConfig({
			pttKey: 'Control+space',
			holdThresholdMs: 350,
			autoSelectResult: false,
		});

		expect(setConfig).toHaveBeenCalledOnce();
	});

	it('rejects malformed or out-of-range Fcitx values', async () => {
		const malformed = new FcitxConfigClient({
			getConfig: async () => createRawConfig('space', '99', 'True'),
			setConfig: async () => undefined,
		});

		await expect(malformed.getConfig()).rejects.toBeInstanceOf(FcitxConfigError);
	});
});
