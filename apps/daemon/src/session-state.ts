export type SessionState =
	| 'idle'
	| 'starting'
	| 'recording'
	| 'finishing'
	| 'post-processing'
	| 'polishing'
	| 'completed'
	| 'cancelling'
	| 'cancelled'
	| 'failed';

const ALLOWED_TRANSITIONS: Readonly<Record<SessionState, readonly SessionState[]>> = {
	idle: ['starting'],
	starting: ['recording', 'cancelling', 'failed'],
	recording: ['finishing', 'cancelling', 'failed'],
	finishing: ['post-processing', 'cancelling', 'failed'],
	'post-processing': ['polishing', 'completed', 'cancelling', 'failed'],
	polishing: ['completed', 'cancelling', 'failed'],
	completed: ['idle'],
	cancelling: ['cancelled', 'failed'],
	cancelled: ['idle'],
	failed: ['idle'],
};

/** 描述一次不符合 daemon 会话生命周期的状态迁移。 */
export class InvalidSessionTransitionError extends Error {
	readonly from: SessionState;
	readonly to: SessionState;

	constructor(from: SessionState, to: SessionState) {
		super(`Invalid session transition: ${from} -> ${to}`);
		this.name = 'InvalidSessionTransitionError';
		this.from = from;
		this.to = to;
	}
}

/** 校验并返回下一个会话状态。 */
export function transitionSessionState(from: SessionState, to: SessionState): SessionState {
	if (!ALLOWED_TRANSITIONS[from].includes(to)) {
		throw new InvalidSessionTransitionError(from, to);
	}

	return to;
}
