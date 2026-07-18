import '@homebridge/dbus-native';

declare module '@homebridge/dbus-native' {
	/** 连接当前用户的会话总线。 */
	export function sessionBus(): MessageBus;
}
