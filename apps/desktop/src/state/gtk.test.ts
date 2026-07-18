import { describe, expect, it } from 'vitest';
import { action, state, value } from './index';
import { gtk } from './gtk';

type SignalCallback = (...args: unknown[]) => unknown;

class SignalTarget {
	private $label = '';
	private $text = '';
	labelWriteCount = 0;
	sensitive = true;
	visible = true;
	private readonly $listeners = new Map<string, Set<SignalCallback>>();

	get label(): string {
		return this.$label;
	}

	set label(label: string) {
		this.labelWriteCount += 1;
		this.$label = label;
	}

	get text(): string {
		return this.$text;
	}

	set text(text: string) {
		this.$text = text;
		this.emit('changed');
	}

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
	@value inputCount = 0;

	constructor(label: string) {
		this.label = label;
	}

	@action updateLabel(label: string): void {
		this.label = label;
	}

	@action updateFromEntry(label: string): void {
		this.inputCount += 1;
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
	@bind.label((state) => {
		void state.enabled;
		return state.label;
	})
	readonly stableLabel = new SignalTarget();
	@bind.prop('text', (state) => state.label)
	@bind.listen<SignalTarget>('changed', (state, target) => state.updateFromEntry(target.text))
	readonly entry = new SignalTarget();
	@bind.click((state) => state.toggle()) readonly button = new SignalTarget();
}

describe('GTK state binding', () => {
	it('renders state, handles signals and releases bindings on destroy', () => {
		const firstState = new ViewState('first');
		const secondState = new ViewState('second');
		const view = new TestView();

		view.state = firstState;
		expect(view.label.label).toBe('first');
		expect(view.entry.text).toBe('first');
		expect(firstState.inputCount).toBe(0);
		expect(view.label.sensitive).toBe(true);
		expect(view.stableLabel.labelWriteCount).toBe(1);

		firstState.updateLabel('updated');
		expect(view.label.label).toBe('updated');
		expect(view.entry.text).toBe('updated');
		expect(firstState.inputCount).toBe(0);
		expect(view.stableLabel.labelWriteCount).toBe(2);

		view.entry.text = 'typed';
		expect(firstState.label).toBe('typed');
		expect(firstState.inputCount).toBe(1);

		view.button.emit('clicked');
		expect(view.label.sensitive).toBe(false);
		expect(view.stableLabel.labelWriteCount).toBe(3);

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
