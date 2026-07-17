import { describe, expect, expectTypeOf, it } from 'vitest';

import { InitializeParamsSchema } from '../src/initialize.js';
import { SessionSelectResultParamsSchema } from '../src/session.js';
import { ProtocolValidationError, validateProtocolValue } from '../src/validation.js';

import type { InitializeParams } from '../src/initialize.js';

const SESSION_ID = '0190c95b-7f28-7b12-8b6f-a4d3fd239013';

describe('validateProtocolValue', () => {
	it('returns a schema-derived type for valid boundary input', () => {
		const params = validateProtocolValue(InitializeParamsSchema, {
			protocolVersion: 1,
			clientInfo: { name: 'protocol-test', version: '1.0.0' },
		});

		expectTypeOf(params).toEqualTypeOf<InitializeParams>();
		expect(params.clientInfo.name).toBe('protocol-test');
	});

	it.each([
		{
			protocolVersion: 2,
			clientInfo: { name: 'protocol-test', version: '1.0.0' },
		},
		{
			protocolVersion: 1,
			clientInfo: { name: 'protocol-test', version: '1.0.0' },
			unexpected: true,
		},
	])('rejects an invalid initialize payload', (value) => {
		expect(() => validateProtocolValue(InitializeParamsSchema, value)).toThrow(
			ProtocolValidationError,
		);
	});

	it('reports the failing schema path', () => {
		expect.hasAssertions();

		try {
			validateProtocolValue(SessionSelectResultParamsSchema, {
				sessionId: SESSION_ID,
				choiceId: 'unknown',
			});
		} catch (error) {
			expect(error).toBeInstanceOf(ProtocolValidationError);
			if (!(error instanceof ProtocolValidationError)) throw error;
			expect(error.issues).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						path: '/choiceId',
					}),
				]),
			);
		}
	});
});
