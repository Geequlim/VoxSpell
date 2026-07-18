import { autorun } from 'mobx';
import { StateScope } from './index';
import type { Cleanup, Constructor } from './index';

type DecoratorProperty = string | symbol;

interface GtkSignalTarget {
	on(signal: string, callback: (...args: unknown[]) => unknown): unknown;
	off(signal: string, callback: (...args: unknown[]) => unknown): unknown;
}

interface GtkViewMember {
	readonly property: DecoratorProperty;
	readonly handler: (state: unknown, target: unknown, self: object) => void | Cleanup;
}

export interface GtkViewInstance<TState> {
	state?: TState;
}

export type GtkViewHandler<TState, TTarget, TSelf extends object> = (
	state: TState,
	target: TTarget,
	self: TSelf,
) => void;
export type GtkViewGetter<TState, TTarget, TValue, TSelf extends object> = (
	state: TState,
	target: TTarget,
	self: TSelf,
) => TValue;

export interface GtkBinding<TState, TSelf extends GtkViewInstance<TState>> {
	view<T extends Constructor<TSelf>>(target: T): T;
	mount<TTarget>(
		handler: (state: TState, target: TTarget, self: TSelf) => void | Cleanup,
	): PropertyDecorator;
	render<TTarget>(handler: GtkViewHandler<TState, TTarget, TSelf>): PropertyDecorator;
	prop<TKey extends PropertyKey, TTarget extends Record<TKey, unknown> = Record<TKey, unknown>>(
		key: TKey,
		getter: GtkViewGetter<TState, TTarget, TTarget[TKey], TSelf>,
	): PropertyDecorator;
	label(getter: GtkViewGetter<TState, { label: string }, string, TSelf>): PropertyDecorator;
	sensitive(
		getter: GtkViewGetter<TState, { sensitive: boolean }, boolean, TSelf>,
	): PropertyDecorator;
	visible(getter: GtkViewGetter<TState, { visible: boolean }, boolean, TSelf>): PropertyDecorator;
	listen<TTarget extends GtkSignalTarget>(
		signal: string,
		handler: GtkViewHandler<TState, TTarget, TSelf>,
	): PropertyDecorator;
	click<TTarget extends GtkSignalTarget>(
		handler: GtkViewHandler<TState, TTarget, TSelf>,
	): PropertyDecorator;
	disposeOnDestroy: PropertyDecorator;
}

const gtkViewMembers = new WeakMap<object, GtkViewMember[]>();
const gtkViewScopeKey = Symbol('gtkViewScope');

/** 创建一组与状态和 GTK View 类型绑定的装饰器。 */
export function gtk<
	TState,
	TSelf extends GtkViewInstance<TState> = GtkViewInstance<TState>,
>(): GtkBinding<TState, TSelf> {
	return {
		view: gtkView as GtkBinding<TState, TSelf>['view'],
		mount: <TTarget>(
			handler: (state: TState, target: TTarget, self: TSelf) => void | Cleanup,
		) => mount(handler),
		render: <TTarget>(handler: GtkViewHandler<TState, TTarget, TSelf>) => render(handler),
		prop: <
			TKey extends PropertyKey,
			TTarget extends Record<TKey, unknown> = Record<TKey, unknown>,
		>(
			key: TKey,
			getter: GtkViewGetter<TState, TTarget, TTarget[TKey], TSelf>,
		) => prop(key, getter),
		label: (getter) => prop('label', getter),
		sensitive: (getter) => prop('sensitive', getter),
		visible: (getter) => prop('visible', getter),
		listen: <TTarget extends GtkSignalTarget>(
			signal: string,
			handler: GtkViewHandler<TState, TTarget, TSelf>,
		) => listen(signal, handler),
		click: <TTarget extends GtkSignalTarget>(handler: GtkViewHandler<TState, TTarget, TSelf>) =>
			listen('clicked', handler),
		disposeOnDestroy,
	};
}

/** 释放 GTK View 实例当前的全部响应式绑定和信号监听。 */
export function disposeGtkView(instance: object): void {
	getGtkViewScope(instance)?.dispose();
}

function gtkView<T extends Constructor>(target: T): T {
	const OriginalConstructor = target;

	class GtkViewClass extends OriginalConstructor {
		constructor(...args: any[]) {
			super(...args);
			installGtkView(this, OriginalConstructor.prototype);
		}
	}

	Object.setPrototypeOf(GtkViewClass, OriginalConstructor);
	Object.setPrototypeOf(GtkViewClass.prototype, OriginalConstructor.prototype);
	return GtkViewClass;
}

function mount<TState, TTarget, TSelf extends object>(
	handler: (state: TState, target: TTarget, self: TSelf) => void | Cleanup,
): PropertyDecorator {
	return (target: object, property: DecoratorProperty) => {
		addGtkViewMember(target, {
			property,
			handler: handler as GtkViewMember['handler'],
		});
	};
}

function render<TState, TTarget, TSelf extends object>(
	handler: GtkViewHandler<TState, TTarget, TSelf>,
): PropertyDecorator {
	return mount((state: TState, target: TTarget, self: TSelf) =>
		autorun(() => handler(state, target, self)),
	);
}

function prop<
	TState,
	TKey extends PropertyKey,
	TTarget extends Record<TKey, unknown>,
	TSelf extends object,
>(key: TKey, getter: GtkViewGetter<TState, TTarget, TTarget[TKey], TSelf>): PropertyDecorator {
	return render((state: TState, target: TTarget, self: TSelf) => {
		target[key] = getter(state, target, self);
	});
}

function listen<TState, TTarget extends GtkSignalTarget, TSelf extends object>(
	signal: string,
	handler: GtkViewHandler<TState, TTarget, TSelf>,
): PropertyDecorator {
	return mount((state: TState, target: TTarget, self: TSelf) => {
		const callback = () => handler(state, target, self);
		target.on(signal, callback);
		return () => target.off(signal, callback);
	});
}

function disposeOnDestroy(target: object, property: DecoratorProperty): void {
	addGtkViewMember(target, {
		property,
		handler: (_state, signalTarget, self) => {
			const target = signalTarget as GtkSignalTarget;
			const callback = () => disposeGtkView(self);
			target.on('destroy', callback);
			return () => target.off('destroy', callback);
		},
	});
}

function installGtkView(instance: object, prototype: object): void {
	const members = getGtkViewMembers(prototype);
	let currentState: unknown;

	Object.defineProperty(instance, 'state', {
		configurable: true,
		get() {
			return currentState;
		},
		set(next: unknown) {
			disposeGtkView(instance);
			currentState = next;
			if (next === undefined) return;

			const scope = new StateScope();
			Object.defineProperty(instance, gtkViewScopeKey, { configurable: true, value: scope });
			members.forEach((member) => {
				const target = (instance as Record<DecoratorProperty, unknown>)[member.property];
				const cleanup = member.handler(next, target, instance);
				if (cleanup) scope.add(cleanup);
			});
		},
	});
}

function addGtkViewMember(target: object, member: GtkViewMember): void {
	const members = gtkViewMembers.get(target) || [];
	members.push(member);
	gtkViewMembers.set(target, members);
}

function getGtkViewMembers(prototype: object): GtkViewMember[] {
	const members: GtkViewMember[] = [];
	let current: object | null = prototype;

	while (current && current !== Object.prototype) {
		const currentMembers = gtkViewMembers.get(current);
		if (currentMembers) members.unshift(...currentMembers);
		current = Object.getPrototypeOf(current);
	}

	return members;
}

function getGtkViewScope(instance: object): StateScope | undefined {
	return (instance as Record<symbol, StateScope | undefined>)[gtkViewScopeKey];
}
