import * as gi from 'node-gtk';
import { DesktopState } from './desktop-state';
import { gtk } from './state/gtk';

const Adw = gi.require('Adw', '1');
const Gio = gi.require('Gio', '2.0');

const bind = gtk<DesktopState, OverviewView>();

@bind.view
class OverviewView {
	declare state?: DesktopState;

	@bind.disposeOnDestroy readonly window: InstanceType<typeof Adw.ApplicationWindow>;
	@bind.prop('title', (state) => state.statusTitle)
	@bind.prop('description', (state) => state.statusDescription)
	readonly statusPage: InstanceType<typeof Adw.StatusPage>;

	constructor(
		window: InstanceType<typeof Adw.ApplicationWindow>,
		statusPage: InstanceType<typeof Adw.StatusPage>,
	) {
		this.window = window;
		this.statusPage = statusPage;
	}
}

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
		title: '',
		description: '',
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
	const state = new DesktopState();
	const view = new OverviewView(window, statusPage);
	view.state = state;
	state.markReady();
	window.present();
});

process.exitCode = application.run([]);
