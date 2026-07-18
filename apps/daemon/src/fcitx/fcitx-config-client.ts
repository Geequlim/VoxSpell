import { sessionBus } from '@homebridge/dbus-native';

import type { MessageBus } from '@homebridge/dbus-native';
import type { VoxSpellFcitxConfig } from '@voxspell/protocol/fcitx';

const FCITX_BUS_NAME = 'org.fcitx.Fcitx5';
const FCITX_CONTROLLER_PATH = '/controller';
const FCITX_CONTROLLER_INTERFACE = 'org.fcitx.Fcitx.Controller1';
const VOXSPELL_CONFIG_URI = 'fcitx://config/addon/voxspell';

interface DbusMessage {
	readonly destination: string;
	readonly path: string;
	readonly interface: string;
	readonly member: string;
	readonly signature: string;
	readonly body: readonly unknown[];
}

/** 隔离 Fcitx DBus 编码细节，便于在无会话总线的测试中替换。 */
export interface FcitxControllerTransport {
	getConfig(): Promise<unknown>;
	setConfig(value: unknown): Promise<void>;
}

/** 表示 Fcitx DBus 服务当前不可连接。 */
export class FcitxUnavailableError extends Error {
	constructor() {
		super('Fcitx DBus service is unavailable');
		this.name = 'FcitxUnavailableError';
	}
}

/** 表示 Fcitx 返回或拒绝了无效的 VoxSpell 配置。 */
export class FcitxConfigError extends Error {
	constructor() {
		super('Unable to read or update the VoxSpell Fcitx config');
		this.name = 'FcitxConfigError';
	}
}

/** 使用 Fcitx Controller1 接口读写 addon 配置。 */
export class NativeFcitxControllerTransport implements FcitxControllerTransport {
	async getConfig(): Promise<unknown> {
		return this.#invoke({
			destination: FCITX_BUS_NAME,
			path: FCITX_CONTROLLER_PATH,
			interface: FCITX_CONTROLLER_INTERFACE,
			member: 'GetConfig',
			signature: 's',
			body: [VOXSPELL_CONFIG_URI],
		});
	}

	async setConfig(value: unknown): Promise<void> {
		await this.#invoke({
			destination: FCITX_BUS_NAME,
			path: FCITX_CONTROLLER_PATH,
			interface: FCITX_CONTROLLER_INTERFACE,
			member: 'SetConfig',
			signature: 'sv',
			body: [VOXSPELL_CONFIG_URI, value],
		});
	}

	#invoke(message: DbusMessage): Promise<unknown> {
		return new Promise((resolve, reject) => {
			let bus: MessageBus;
			try {
				bus = sessionBus();
			} catch {
				reject(new FcitxUnavailableError());
				return;
			}
			let settled = false;
			const settle = (error?: Error, value?: unknown): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				bus.connection.stream.destroy();
				if (error) reject(error);
				else resolve(value);
			};
			const timeout = setTimeout(() => settle(new FcitxUnavailableError()), 3000);
			bus.connection.once('error', () => settle(new FcitxUnavailableError()));
			bus.invoke(message, (error, value) => {
				if (error) {
					const unavailable = [
						'org.freedesktop.DBus.Error.ServiceUnknown',
						'org.freedesktop.DBus.Error.NameHasNoOwner',
						'org.freedesktop.DBus.Error.NoReply',
					].includes(error.name);
					settle(unavailable ? new FcitxUnavailableError() : new FcitxConfigError());
					return;
				}
				settle(undefined, value);
			});
		});
	}
}

/** 将 Fcitx 的 variant 配置映射为 daemon 对外的稳定类型。 */
export class FcitxConfigClient {
	readonly #transport: FcitxControllerTransport;

	constructor(transport: FcitxControllerTransport) {
		this.#transport = transport;
	}

	/** 读取并校验当前 VoxSpell addon 配置。 */
	async getConfig(): Promise<VoxSpellFcitxConfig> {
		const entries = this.#readEntries(await this.#transport.getConfig());
		const pttKey = this.#readString(entries, 'PTTKey');
		const holdThresholdMs = Number(this.#readString(entries, 'HoldThresholdMs'));
		const autoSelectResultSource = this.#readString(entries, 'AutoSelectResult');
		if (!Number.isInteger(holdThresholdMs) || holdThresholdMs < 100 || holdThresholdMs > 2000) {
			throw new FcitxConfigError();
		}
		if (autoSelectResultSource !== 'True' && autoSelectResultSource !== 'False') {
			throw new FcitxConfigError();
		}
		return {
			pttKey,
			holdThresholdMs,
			autoSelectResult: autoSelectResultSource === 'True',
		};
	}

	/** 更新三个 VoxSpell 字段，并通过读取确认 Fcitx 已接受配置。 */
	async updateConfig(config: VoxSpellFcitxConfig): Promise<void> {
		const variant = [
			'a{sv}',
			[
				['PTTKey', ['s', config.pttKey]],
				['HoldThresholdMs', ['s', `${config.holdThresholdMs}`]],
				['AutoSelectResult', ['s', config.autoSelectResult ? 'True' : 'False']],
			],
		];
		await this.#transport.setConfig(variant);
		const applied = await this.getConfig();
		if (
			applied.pttKey !== config.pttKey ||
			applied.holdThresholdMs !== config.holdThresholdMs ||
			applied.autoSelectResult !== config.autoSelectResult
		) {
			throw new FcitxConfigError();
		}
	}

	#readEntries(value: unknown): Map<string, unknown> {
		if (!Array.isArray(value) || !Array.isArray(value[1]) || !Array.isArray(value[1][0])) {
			throw new FcitxConfigError();
		}
		const entries = new Map<string, unknown>();
		for (const entry of value[1][0]) {
			if (!Array.isArray(entry) || typeof entry[0] !== 'string') {
				throw new FcitxConfigError();
			}
			entries.set(entry[0], entry[1]);
		}
		return entries;
	}

	#readString(entries: Map<string, unknown>, name: string): string {
		const variant = entries.get(name);
		if (!Array.isArray(variant) || !Array.isArray(variant[1])) throw new FcitxConfigError();
		const value = variant[1][0];
		if (typeof value !== 'string' || value.length === 0) throw new FcitxConfigError();
		return value;
	}
}
