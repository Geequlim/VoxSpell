import * as gi from 'node-gtk';

const Adw = gi.require('Adw', '1');
const Gio = gi.require('Gio', '2.0');

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

	const headerBar = new Adw.HeaderBar({
		titleWidget: new Adw.WindowTitle({
			title: 'VoxSpell',
			subtitle: '语音输入配置',
		}),
	});
	const statusPage = new Adw.StatusPage({
		title: 'VoxSpell 已准备就绪',
		description: 'GTK 配置应用已成功启动。Daemon 连接将在后续阶段接入。',
		iconName: 'audio-input-microphone-symbolic',
		vexpand: true,
	});
	const toolbarView = new Adw.ToolbarView({
		content: statusPage,
	});
	toolbarView.addTopBar(headerBar);

	const window = new Adw.ApplicationWindow({
		application,
		content: toolbarView,
		defaultWidth: 720,
		defaultHeight: 520,
		title: 'VoxSpell',
	});
	window.present();
});

process.exitCode = application.run([]);
