import { describe, expect, it } from 'vitest';

import { tencentRealtimeAsrDefinition } from '../src/provider-definition.js';

describe('tencentRealtimeAsrDefinition', () => {
	it('provides defaults and preserves the existing Tencent credential names', () => {
		const provider = tencentRealtimeAsrDefinition.createDefaultConfig('tencent');

		expect(provider).toEqual({
			id: 'tencent',
			type: 'tencent-realtime',
			engineModelType: '16k_zh',
		});
		expect(tencentRealtimeAsrDefinition.fields.map((field) => field.id)).toEqual([
			'engineModelType',
		]);
		expect(
			tencentRealtimeAsrDefinition.credentials.map((item) =>
				item.getEnvironmentName(provider),
			),
		).toEqual([
			'TENCENT_CLOUD_ASR_APPID',
			'TENCENT_CLOUD_ASR_SECRET_ID',
			'TENCENT_CLOUD_ASR_SECRET_KEY',
		]);
	});
});
