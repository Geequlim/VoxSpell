import * as mobx from 'mobx';

export type Constructor<T extends object = object> = new (...args: any[]) => T;
export type Cleanup = () => void;

type DecoratorProperty = string | symbol;
type StateMemberKind = 'value' | 'derived' | 'action' | 'effect';

interface StateMember {
	readonly kind: StateMemberKind;
	readonly property: DecoratorProperty;
}

const stateMembers = new WeakMap<object, StateMember[]>();
const stateScopeKey = Symbol('stateScope');

/** 管理一组可重复释放的副作用清理函数。 */
export class StateScope {
	private readonly $cleanups: Cleanup[] = [];

	/** 添加清理函数，并原样返回以便调用方保留引用。 */
	add(cleanup: Cleanup): Cleanup {
		this.$cleanups.push(cleanup);
		return cleanup;
	}

	/** 执行并移除当前全部清理函数。 */
	dispose(): void {
		const cleanups = this.$cleanups.splice(0);
		cleanups.forEach((cleanup) => cleanup());
	}
}

/** 声明由 MobX 驱动的状态类。 */
export function state<T extends Constructor>(target: T): T {
	const OriginalConstructor = target;

	class StateClass extends OriginalConstructor {
		constructor(...args: any[]) {
			super(...args);
			installState(this, OriginalConstructor.prototype);
		}
	}

	Object.setPrototypeOf(StateClass, OriginalConstructor);
	Object.setPrototypeOf(StateClass.prototype, OriginalConstructor.prototype);
	return StateClass;
}

/** 声明可观察的源状态字段。 */
export function value(target: object, property: DecoratorProperty): void {
	addStateMember(target, { kind: 'value', property });
}

/** 声明只从其他状态计算的派生 getter。 */
export function derived(
	target: object,
	property: DecoratorProperty,
	descriptor: PropertyDescriptor,
): void {
	if (typeof descriptor.get !== 'function')
		throw new Error('@derived can only be used on getters');
	addStateMember(target, { kind: 'derived', property });
}

/** 声明会修改状态的方法。 */
export function action(
	target: object,
	property: DecoratorProperty,
	descriptor: PropertyDescriptor,
): void {
	if (typeof descriptor.value !== 'function')
		throw new Error('@action can only be used on methods');
	addStateMember(target, { kind: 'action', property });
}

/** 声明根据读取到的状态自动重新执行的副作用。 */
export function effect(
	target: object,
	property: DecoratorProperty,
	descriptor: PropertyDescriptor,
): void {
	if (typeof descriptor.value !== 'function')
		throw new Error('@effect can only be used on methods');
	addStateMember(target, { kind: 'effect', property });
}

/** 释放状态实例上由 `@effect` 创建的全部副作用。 */
export function disposeState(instance: object): void {
	getStateScope(instance)?.dispose();
}

function installState(instance: object, prototype: object): void {
	const members = getStateMembers(prototype);
	const annotations: mobx.AnnotationsMap<object, DecoratorProperty> = {};

	members.forEach((member) => {
		if (member.kind === 'effect') return;
		annotations[member.property] = getAnnotation(member.kind);
	});

	if (Reflect.ownKeys(annotations).length > 0) mobx.makeObservable(instance, annotations);

	const scope = new StateScope();
	Object.defineProperty(instance, stateScopeKey, { configurable: true, value: scope });
	members
		.filter((member) => member.kind === 'effect')
		.forEach((member) => installEffect(instance, member.property, scope));
}

function installEffect(instance: object, property: DecoratorProperty, scope: StateScope): void {
	let currentCleanup: void | Cleanup;
	const disposeAutorun = mobx.autorun(() => {
		if (currentCleanup) mobx.untracked(currentCleanup);
		const method = (instance as Record<DecoratorProperty, unknown>)[property];
		if (typeof method !== 'function')
			throw new Error(`@effect can only be used on methods: ${String(property)}`);
		currentCleanup = method.call(instance) as void | Cleanup;
	});

	scope.add(() => {
		disposeAutorun();
		if (currentCleanup) mobx.untracked(currentCleanup);
		currentCleanup = undefined;
	});
}

function getAnnotation(kind: Exclude<StateMemberKind, 'effect'>): mobx.AnnotationMapEntry {
	if (kind === 'derived') return mobx.computed;
	if (kind === 'action') return mobx.action;
	return mobx.observable;
}

function addStateMember(target: object, member: StateMember): void {
	const members = stateMembers.get(target) || [];
	members.push(member);
	stateMembers.set(target, members);
}

function getStateMembers(prototype: object): StateMember[] {
	const members: StateMember[] = [];
	let current: object | null = prototype;

	while (current && current !== Object.prototype) {
		const currentMembers = stateMembers.get(current);
		if (currentMembers) members.unshift(...currentMembers);
		current = Object.getPrototypeOf(current);
	}

	return members;
}

function getStateScope(instance: object): StateScope | undefined {
	return (instance as Record<symbol, StateScope | undefined>)[stateScopeKey];
}
