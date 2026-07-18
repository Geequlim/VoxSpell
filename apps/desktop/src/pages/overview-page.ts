import { Adw, Gtk } from '../gtk';
import { gtk } from '../state/gtk';

import type { DaemonState } from '../state/daemon-state';

const bind = gtk<DaemonState, OverviewPageView>();

@bind.view
class OverviewPageView {
	declare state?: DaemonState;

	@bind.disposeOnDestroy readonly root: InstanceType<typeof Gtk.Box>;
	@bind.prop('title', (state) => state.statusTitle)
	@bind.prop('description', (state) => state.statusDescription)
	@bind.prop('iconName', (state) => state.statusIconName)
	readonly statusPage: InstanceType<typeof Adw.StatusPage>;
	@bind.visible((state) => state.retryVisible)
	@bind.click((state) => state.retry())
	readonly retryButton: InstanceType<typeof Gtk.Button>;

	constructor(
		root: InstanceType<typeof Gtk.Box>,
		statusPage: InstanceType<typeof Adw.StatusPage>,
		retryButton: InstanceType<typeof Gtk.Button>,
	) {
		this.root = root;
		this.statusPage = statusPage;
		this.retryButton = retryButton;
	}
}

/** 创建与 DaemonState 响应式绑定的概览页。 */
export function createOverviewPage(state: DaemonState): InstanceType<typeof Gtk.Box> {
	const root = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, vexpand: true });
	const retryButton = new Gtk.Button({ label: '立即重试', halign: Gtk.Align.CENTER });
	const statusPage = new Adw.StatusPage({
		title: '',
		description: '',
		iconName: 'network-offline-symbolic',
		child: retryButton,
		vexpand: true,
	});
	root.append(statusPage);
	const view = new OverviewPageView(root, statusPage, retryButton);
	view.state = state;
	return root;
}
