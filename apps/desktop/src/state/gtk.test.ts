import { describe, expect, it } from 'vitest';
import { action, state, value } from './index';
import { gtk } from './gtk';

type SignalCallback = (...args: unknown[]) => unknown;

class SignalTarget {
	label = '';
	sensitive = true;
	visible = true;
	private readonly $listeners = new Map<string, Set<SignalCallback>>();

	on(signal: string, callback: SignalCallback): this {
		const listeners = this.$listeners.get(signal) || new Set();
		listeners.add(callback);
		this.$listeners.set(signal, listeners);
		return this;
	}

	off(signal: string, callback: SignalCallback): this {
		this.$listeners.get(signal)?.delete(callback);
		return this;
	}

	emit(signal: string): void {
		this.$listeners.get(signal)?.forEach((listener) => listener());
	}
}

@state
class ViewState {
	@value label: string;
	@value enabled = true;

	constructor(label: string) {
		this.label = label;
	}

	@action updateLabel(label: string): void {
		this.label = label;
	}

	@action toggle(): void {
		this.enabled = !this.enabled;
	}
}

const bind = gtk<ViewState, TestView>();

@bind.view
class TestView {
	declare state?: ViewState;

	@bind.disposeOnDestroy readonly root = new SignalTarget();
	@bind.label((state) => state.label)
	@bind.sensitive((state) => state.enabled)
	readonly label = new SignalTarget();
	@bind.click((state) => state.toggle()) readonly button = new SignalTarget();
}

describe('GTK state binding', () => {
	it('renders state, handles signals and releases bindings on destroy', () => {
		const firstState = new ViewState('first');
		const secondState = new ViewState('second');
		const view = new TestView();

		view.state = firstState;
		expect(view.label.label).toBe('first');
		expect(view.label.sensitive).toBe(true);

		firstState.updateLabel('updated');
		expect(view.label.label).toBe('updated');

		view.button.emit('clicked');
		expect(view.label.sensitive).toBe(false);

		view.state = secondState;
		expect(view.label.label).toBe('second');
		firstState.updateLabel('stale');
		expect(view.label.label).toBe('second');

		view.root.emit('destroy');
		secondState.updateLabel('destroyed');
		view.button.emit('clicked');
		expect(view.label.label).toBe('second');
		expect(secondState.enabled).toBe(true);
	});
});
