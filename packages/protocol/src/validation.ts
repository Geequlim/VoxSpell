import { Value } from '@sinclair/typebox/value';

import type { Static, TSchema } from '@sinclair/typebox';

export interface ProtocolValidationIssue {
	readonly path: string;
	readonly message: string;
}

/** 描述协议边界处的 TypeBox 校验失败。 */
export class ProtocolValidationError extends Error {
	readonly issues: readonly ProtocolValidationIssue[];

	constructor(issues: readonly ProtocolValidationIssue[]) {
		super('Protocol value validation failed');
		this.name = 'ProtocolValidationError';
		this.issues = issues;
	}
}

/** 校验未知协议输入，并在成功后返回由 schema 推导的类型。 */
export function validateProtocolValue<T extends TSchema>(schema: T, value: unknown): Static<T> {
	const issues = [...Value.Errors(schema, value)].map((issue) => ({
		path: issue.path,
		message: issue.message,
	}));

	if (issues.length > 0) throw new ProtocolValidationError(issues);
	return value as Static<T>;
}
