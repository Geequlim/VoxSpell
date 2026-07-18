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
