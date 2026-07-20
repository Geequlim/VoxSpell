import { Gio, GLib } from '../gtk';

const FCITX_BUS_NAME = 'org.fcitx.Fcitx5';
const FCITX_CONTROLLER_PATH = '/controller';
const FCITX_CONTROLLER_INTERFACE = 'org.fcitx.Fcitx.Controller1';
const VOXSPELL_CONFIG_URI = 'fcitx://config/addon/voxspell';
const CALL_TIMEOUT_MS = 5_000;
const STRING_TYPE = GLib.VariantType.new('s');
const DICTIONARY_ENTRY_TYPE = GLib.VariantType.new('{sv}');

export interface InputBehaviorConfig {
	readonly pttKey: string;
	readonly holdThresholdMs: number;
	readonly autoSelectResult: boolean;
	readonly polishingToggleKey: string;
}

export type RimeStatus =
	| 'active'
	| 'enabled'
	| 'available'
	| 'disabled'
	| 'unavailable'
	| 'unknown';
export type FcitxAddonStatus = 'enabled' | 'disabled' | 'unavailable' | 'unknown';

export interface InputMethodDiagnostics {
	readonly currentInputMethod: string;
	readonly rimeStatus: RimeStatus;
	readonly voxspellAddonStatus: FcitxAddonStatus;
}

interface FcitxAddon {
	readonly name: string;
	readonly enabled: boolean;
}

/** 通过 Fcitx Controller D-Bus 读取和更新 VoxSpell addon 配置。 */
export class FcitxInputBehaviorClient {
	#proxy?: InstanceType<typeof Gio.DBusProxy>;

	/** 读取插件当前实际生效的输入行为配置。 */
	async getInputBehavior(): Promise<InputBehaviorConfig> {
		const result = await this.#call(
			'GetConfig',
			GLib.Variant.newTuple([GLib.Variant.newString(VOXSPELL_CONFIG_URI)]),
		);
		const values = result.getChildValue(0).getVariant();
		return parseInputBehavior(values);
	}

	/** 通过 Fcitx 配置接口保存并立即应用输入行为。 */
	async updateInputBehavior(config: InputBehaviorConfig): Promise<void> {
		const values = createStringDictionary({
			PTTKey: config.pttKey,
			HoldThresholdMs: String(config.holdThresholdMs),
			AutoSelectResult: config.autoSelectResult ? 'True' : 'False',
			PolishingToggleKey: config.polishingToggleKey,
		});
		await this.#call(
			'SetConfig',
			GLib.Variant.newTuple([
				GLib.Variant.newString(VOXSPELL_CONFIG_URI),
				GLib.Variant.newVariant(values),
			]),
		);
	}

	/** 要求 Fcitx 重新读取全部配置，包括插件的状态动画文件。 */
	async reloadConfig(): Promise<void> {
		await this.#call('ReloadConfig', GLib.Variant.newTuple([]));
	}

	/** 直接通过 Fcitx Controller 检查输入法与 addon 能力。 */
	async getInputMethodDiagnostics(): Promise<InputMethodDiagnostics> {
		const emptyParameters = GLib.Variant.newTuple([]);
		const currentResult = await this.#call('CurrentInputMethod', emptyParameters);
		const currentInputMethod = currentResult.getChildValue(0).getString()[0];
		const [availableResult, groupResult, addonsResult] = await Promise.allSettled([
			this.#call('AvailableInputMethods', emptyParameters),
			this.#call(
				'FullInputMethodGroupInfo',
				GLib.Variant.newTuple([GLib.Variant.newString('')]),
			),
			this.#call('GetAddons', emptyParameters),
		]);
		const availableInputMethods =
			availableResult.status === 'fulfilled'
				? readStructNames(availableResult.value.getChildValue(0))
				: undefined;
		const enabledInputMethods =
			groupResult.status === 'fulfilled'
				? readStructNames(groupResult.value.getChildValue(4))
				: undefined;
		const addons =
			addonsResult.status === 'fulfilled'
				? readAddons(addonsResult.value.getChildValue(0))
				: undefined;
		return {
			currentInputMethod,
			rimeStatus: getRimeStatus(
				currentInputMethod,
				availableInputMethods,
				enabledInputMethods,
				addons,
			),
			voxspellAddonStatus: getAddonStatus(addons, 'voxspell'),
		};
	}

	#getProxy(): InstanceType<typeof Gio.DBusProxy> {
		this.#proxy ??= Gio.DBusProxy.newForBusSync(
			Gio.BusType.SESSION,
			Gio.DBusProxyFlags.NONE,
			null,
			FCITX_BUS_NAME,
			FCITX_CONTROLLER_PATH,
			FCITX_CONTROLLER_INTERFACE,
			null,
		);
		return this.#proxy;
	}

	#call(
		method: string,
		parameters: InstanceType<typeof GLib.Variant>,
	): Promise<InstanceType<typeof GLib.Variant>> {
		const proxy = this.#getProxy();
		return new Promise((resolve, reject) => {
			proxy.call(
				method,
				parameters,
				Gio.DBusCallFlags.NONE,
				CALL_TIMEOUT_MS,
				null,
				(_source, result) => {
					try {
						resolve(proxy.callFinish(result));
					} catch (error) {
						reject(error);
					}
				},
			);
		});
	}
}

function readStructNames(values: InstanceType<typeof GLib.Variant>): ReadonlySet<string> {
	const names = new Set<string>();
	for (let index = 0; index < values.nChildren(); index += 1) {
		names.add(values.getChildValue(index).getChildValue(0).getString()[0]);
	}
	return names;
}

function readAddons(values: InstanceType<typeof GLib.Variant>): readonly FcitxAddon[] {
	const addons: FcitxAddon[] = [];
	for (let index = 0; index < values.nChildren(); index += 1) {
		const addon = values.getChildValue(index);
		addons.push({
			name: addon.getChildValue(0).getString()[0],
			enabled: addon.getChildValue(5).getBoolean(),
		});
	}
	return addons;
}

function getAddonStatus(addons: readonly FcitxAddon[] | undefined, name: string): FcitxAddonStatus {
	if (!addons) return 'unknown';
	const addon = addons.find((candidate) => candidate.name === name);
	if (!addon) return 'unavailable';
	return addon.enabled ? 'enabled' : 'disabled';
}

function getRimeStatus(
	currentInputMethod: string,
	availableInputMethods?: ReadonlySet<string>,
	enabledInputMethods?: ReadonlySet<string>,
	addons?: readonly FcitxAddon[],
): RimeStatus {
	if (currentInputMethod === 'rime') return 'active';
	const addonStatus = getAddonStatus(addons, 'rime');
	if (addonStatus === 'disabled') return 'disabled';
	if (addonStatus === 'unavailable') return 'unavailable';
	if (enabledInputMethods?.has('rime')) return 'enabled';
	if (availableInputMethods?.has('rime')) return 'available';
	if (addonStatus === 'enabled' && availableInputMethods) return 'unavailable';
	return 'unknown';
}

function parseInputBehavior(values: InstanceType<typeof GLib.Variant>): InputBehaviorConfig {
	const pttKey = readString(values, 'PTTKey');
	const holdThresholdMs = Number(readString(values, 'HoldThresholdMs'));
	const autoSelectResult = readString(values, 'AutoSelectResult');
	const polishingToggleKey = readString(values, 'PolishingToggleKey');
	if (!Number.isInteger(holdThresholdMs) || holdThresholdMs < 100 || holdThresholdMs > 2_000) {
		throw new Error('Fcitx 返回了无效的长按阈值');
	}
	if (autoSelectResult !== 'True' && autoSelectResult !== 'False') {
		throw new Error('Fcitx 返回了无效的结果选择模式');
	}
	return {
		pttKey,
		holdThresholdMs,
		autoSelectResult: autoSelectResult === 'True',
		polishingToggleKey,
	};
}

function readString(values: InstanceType<typeof GLib.Variant>, key: string): string {
	const value = values.lookupValue(key, STRING_TYPE);
	if (!value) throw new Error(`Fcitx 配置缺少 ${key}`);
	return value.getString()[0];
}

function createStringDictionary(
	values: Readonly<Record<string, string>>,
): InstanceType<typeof GLib.Variant> {
	const entries = Object.entries(values).map(([key, value]) =>
		GLib.Variant.newDictEntry(
			GLib.Variant.newString(key),
			GLib.Variant.newVariant(GLib.Variant.newString(value)),
		),
	);
	return GLib.Variant.newArray(DICTIONARY_ENTRY_TYPE, entries);
}
