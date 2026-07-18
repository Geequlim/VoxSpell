import { Adw, Gtk } from '../gtk';
import { getProviderDisplayName } from '../provider-display';
import { gtk } from '../state/gtk';

import type { DesktopState } from '../desktop-state';

const bind = gtk<DesktopState, OverviewPageView>();

@bind.view
class OverviewPageView {
	declare state?: DesktopState;

	@bind.disposeOnDestroy readonly root: InstanceType<typeof Adw.PreferencesPage>;
	@bind.prop('iconName', (state) => state.daemon.statusIconName)
	readonly statusIcon: InstanceType<typeof Gtk.Image>;
	@bind.prop('title', (state) => state.daemon.statusTitle)
	@bind.prop('subtitle', (state) => state.daemon.statusDescription)
	readonly statusRow: InstanceType<typeof Adw.ActionRow>;
	@bind.label((state) => state.daemonService.primaryActionLabel)
	@bind.sensitive((state) => state.daemonService.isControllable)
	@bind.click((state) => void state.runDaemonServiceAction())
	readonly serviceButton: InstanceType<typeof Gtk.Button>;
	@bind.prop('active', (state) => state.daemonService.enabled)
	@bind.listen<InstanceType<typeof Adw.SwitchRow>>(
		'notify::active',
		(state, row) => void state.daemonService.setEnabled(row.active),
	)
	@bind.sensitive((state) => state.daemonService.isControllable)
	readonly autostartRow: InstanceType<typeof Adw.SwitchRow>;
	@bind.prop('subtitle', (state) => state.daemonService.operationDescription)
	@bind.visible((state) => Boolean(state.daemonService.operationDescription))
	readonly serviceOperationRow: InstanceType<typeof Adw.ActionRow>;
	@bind.prop('subtitle', (state) => getActiveProviderDescription(state))
	readonly providerRow: InstanceType<typeof Adw.ActionRow>;
	@bind.visible(
		(state) =>
			state.daemon.connectionPhase === 'connected' &&
			state.config.activeProviderSupportsRealtime,
	)
	readonly realtimeBadge: InstanceType<typeof Gtk.Label>;
	@bind.prop('subtitle', (state) => getPolishingDescription(state))
	readonly polishingRow: InstanceType<typeof Adw.ActionRow>;
	@bind.prop('subtitle', (state) => getServerDescription(state))
	readonly serverRow: InstanceType<typeof Adw.ActionRow>;
	@bind.click((state) => state.selectPage('recognition'))
	readonly recognitionButton: InstanceType<typeof Gtk.Button>;
	@bind.click((state) => state.selectPage('diagnostics'))
	readonly diagnosticsButton: InstanceType<typeof Gtk.Button>;

	constructor(
		root: InstanceType<typeof Adw.PreferencesPage>,
		statusIcon: InstanceType<typeof Gtk.Image>,
		statusRow: InstanceType<typeof Adw.ActionRow>,
		serviceButton: InstanceType<typeof Gtk.Button>,
		autostartRow: InstanceType<typeof Adw.SwitchRow>,
		serviceOperationRow: InstanceType<typeof Adw.ActionRow>,
		providerRow: InstanceType<typeof Adw.ActionRow>,
		realtimeBadge: InstanceType<typeof Gtk.Label>,
		polishingRow: InstanceType<typeof Adw.ActionRow>,
		serverRow: InstanceType<typeof Adw.ActionRow>,
		recognitionButton: InstanceType<typeof Gtk.Button>,
		diagnosticsButton: InstanceType<typeof Gtk.Button>,
	) {
		this.root = root;
		this.statusIcon = statusIcon;
		this.statusRow = statusRow;
		this.serviceButton = serviceButton;
		this.autostartRow = autostartRow;
		this.serviceOperationRow = serviceOperationRow;
		this.providerRow = providerRow;
		this.realtimeBadge = realtimeBadge;
		this.polishingRow = polishingRow;
		this.serverRow = serverRow;
		this.recognitionButton = recognitionButton;
		this.diagnosticsButton = diagnosticsButton;
	}
}

/** 创建桌面端运行状态与主要配置摘要页面。 */
export function createOverviewPage(state: DesktopState): InstanceType<typeof Adw.PreferencesPage> {
	const statusIcon = new Gtk.Image({ iconName: 'network-offline-symbolic' });
	const serviceButton = new Gtk.Button({ label: '启动', valign: Gtk.Align.CENTER });
	const statusRow = new Adw.ActionRow({ title: '', subtitle: '' });
	statusRow.addPrefix(statusIcon);
	statusRow.addSuffix(serviceButton);
	const autostartRow = new Adw.SwitchRow({
		title: '开机启动',
		subtitle: '开机后自动启动 VoxSpell 后台服务。',
	});
	const serviceOperationRow = new Adw.ActionRow({ title: '后台服务', subtitle: '' });
	const statusGroup = new Adw.PreferencesGroup({
		title: '运行状态',
		description: '桌面端会自动连接本地 VoxSpell 服务。',
	});
	statusGroup.add(statusRow);
	statusGroup.add(autostartRow);
	statusGroup.add(serviceOperationRow);

	const providerRow = new Adw.ActionRow({ title: '当前识别服务', subtitle: '' });
	const realtimeBadge = new Gtk.Label({
		label: '实时',
		valign: Gtk.Align.CENTER,
		cssClasses: ['caption', 'accent'],
	});
	providerRow.addSuffix(realtimeBadge);
	const polishingRow = new Adw.ActionRow({ title: 'AI 润色', subtitle: '' });
	const serverRow = new Adw.ActionRow({ title: '服务版本', subtitle: '' });
	const configurationGroup = new Adw.PreferencesGroup({ title: '当前配置' });
	configurationGroup.add(providerRow);
	configurationGroup.add(polishingRow);
	configurationGroup.add(serverRow);

	const recognitionButton = new Gtk.Button({
		label: '管理识别服务',
		valign: Gtk.Align.CENTER,
	});
	const diagnosticsButton = new Gtk.Button({ label: '查看诊断', valign: Gtk.Align.CENTER });
	const buttonBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });
	buttonBox.append(recognitionButton);
	buttonBox.append(diagnosticsButton);
	const shortcutRow = new Adw.ActionRow({
		title: '常用操作',
		subtitle: '快速进入配置与故障排查页面。',
	});
	shortcutRow.addSuffix(buttonBox);
	const shortcutGroup = new Adw.PreferencesGroup();
	shortcutGroup.add(shortcutRow);

	const root = new Adw.PreferencesPage({ title: '概览' });
	root.add(statusGroup);
	root.add(configurationGroup);
	root.add(shortcutGroup);
	const view = new OverviewPageView(
		root,
		statusIcon,
		statusRow,
		serviceButton,
		autostartRow,
		serviceOperationRow,
		providerRow,
		realtimeBadge,
		polishingRow,
		serverRow,
		recognitionButton,
		diagnosticsButton,
	);
	view.state = state;
	return root;
}

function getActiveProviderDescription(state: DesktopState): string {
	if (state.daemon.connectionPhase !== 'connected') return '等待连接 daemon';
	if (state.config.providerId) return state.config.providerDisplayName;
	const providerId = state.daemon.status?.activeProvider;
	return providerId ? getProviderDisplayName(providerId) : '尚未配置';
}

function getPolishingDescription(state: DesktopState): string {
	if (!state.config.draft) return '尚未配置';
	const status = state.config.polishingEnabled ? '已启用' : '未启用';
	const model = state.config.polishingModel || '未配置模型';
	return `${status} · ${model}`;
}

function getServerDescription(state: DesktopState): string {
	const server = state.daemon.initializeResult?.serverInfo;
	return server ? `${server.name} ${server.version}` : '—';
}
