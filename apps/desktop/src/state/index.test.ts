import { describe, expect, it } from 'vitest';
import { action, derived, disposeState, effect, state, value } from './index';

@state
class CounterState {
	@value count = 1;
	readonly effects: number[] = [];
	cleanupCount = 0;

	@derived get doubled(): number {
		return this.count * 2;
	}

	@action increment(): void {
		this.count++;
	}

	@effect trackCount(): () => void {
		this.effects.push(this.count);
		return () => this.cleanupCount++;
	}
}

describe('desktop state', () => {
	it('tracks values, derived getters, actions and effect cleanup', () => {
		const state = new CounterState();

		expect(state.doubled).toBe(2);
		expect(state.effects).toEqual([1]);

		state.increment();
		expect(state.doubled).toBe(4);
		expect(state.effects).toEqual([1, 2]);
		expect(state.cleanupCount).toBe(1);

		disposeState(state);
		expect(state.cleanupCount).toBe(2);

		state.increment();
		expect(state.effects).toEqual([1, 2]);
	});
});
