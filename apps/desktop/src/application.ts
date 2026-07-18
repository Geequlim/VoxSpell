import path from 'node:path';
import { DesktopState } from './desktop-state';
import { FcitxInputBehaviorClient } from './fcitx/input-behavior-client';
import { Adw, Gio, Gtk } from './gtk';
import { resolveDaemonSocketPath } from './rpc/daemon-socket-path';
import { DaemonRpcClient } from './rpc/daemon-rpc-client';
import { createAppWindow } from './views/app-window';

const APPLICATION_ID = 'io.github.geequlim.VoxSpell';

/** 启动 VoxSpell GTK 桌面配置应用。 */
export function runApplication(): number {
	const application = new Adw.Application({
		applicationId: APPLICATION_ID,
		flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
	});

	application.on('activate', () => {
		const activeWindow = application.getActiveWindow();
		if (activeWindow) {
			activeWindow.present();
			return;
		}

		const client = new DaemonRpcClient({ socketPath: resolveDaemonSocketPath() });
		const state = new DesktopState(client, new FcitxInputBehaviorClient());
		const window = createAppWindow(application, state);
		Gtk.IconTheme.getForDisplay(window.getDisplay()).addSearchPath(
			path.join(__dirname, 'icons'),
		);
		window.setIconName(APPLICATION_ID);
		window.once('destroy', () => state.dispose());
		state.start();
		window.present();
	});

	return application.run([]);
}
