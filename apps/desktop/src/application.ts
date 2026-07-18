import { DesktopState } from './desktop-state';
import { Adw, Gio } from './gtk';
import { resolveDaemonSocketPath } from './rpc/daemon-socket-path';
import { DaemonRpcClient } from './rpc/daemon-rpc-client';
import { createAppWindow } from './views/app-window';

/** 启动 VoxSpell GTK 桌面配置应用。 */
export function runApplication(): number {
	const application = new Adw.Application({
		applicationId: 'io.github.geequlim.VoxSpell',
		flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
	});

	application.on('activate', () => {
		const activeWindow = application.getActiveWindow();
		if (activeWindow) {
			activeWindow.present();
			return;
		}

		const client = new DaemonRpcClient({ socketPath: resolveDaemonSocketPath() });
		const state = new DesktopState(client);
		const window = createAppWindow(application, state);
		window.once('destroy', () => state.dispose());
		state.start();
		window.present();
	});

	return application.run([]);
}
