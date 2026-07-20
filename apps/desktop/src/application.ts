import path from 'node:path';
import { homedir } from 'node:os';
import { resolveVoxSpellConfigPaths } from '@voxspell/config/config-paths';
import { DesktopState } from './desktop-state';
import { SystemdDaemonServiceClient } from './daemon-service-client';
import { FcitxInputBehaviorClient } from './fcitx/input-behavior-client';
import { Adw, Gio, Gtk } from './gtk';
import { resolveDaemonSocketPath } from './rpc/daemon-socket-path';
import { DaemonRpcClient } from './rpc/daemon-rpc-client';
import { createAppWindow } from './views/app-window';
import { FileStatusAnimationConfigClient } from './status-animation-config-client';

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
		const fcitxClient = new FcitxInputBehaviorClient();
		const configPaths = resolveVoxSpellConfigPaths(process.env, homedir());
		const statusAnimationClient = new FileStatusAnimationConfigClient(
			configPaths.statusAnimationFile,
			path.join(__dirname, 'tools/status-animation-preview.html'),
			() => fcitxClient.reloadConfig(),
			async (filePath) => {
				const uri = Gio.File.newForPath(filePath).getUri();
				if (!Gio.AppInfo.launchDefaultForUri(uri, null)) {
					throw new Error('系统没有可用于打开 HTML 文件的默认应用');
				}
			},
		);
		const state = new DesktopState(
			client,
			new SystemdDaemonServiceClient(),
			fcitxClient,
			fcitxClient,
			statusAnimationClient,
		);
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
