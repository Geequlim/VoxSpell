import { Adw, Gtk } from '../gtk';
import { getProviderDisplayName } from '../provider-display';
import { gtk } from '../state/gtk';

import type { DaemonState } from '../state/daemon-state';

const bind = gtk<DaemonState, DiagnosticsPageView>();

@bind.view
class DiagnosticsPageView {
	declare state?: DaemonState;

	@bind.disposeOnDestroy readonly root: InstanceType<typeof Adw.PreferencesPage>;
	@bind.prop('iconName', (state) => state.statusIconName)
	readonly statusIcon: InstanceType<typeof Gtk.Image>;
	@bind.prop('title', (state) => state.statusTitle)
	@bind.prop('subtitle', (state) => state.statusDescription)
	readonly connectionRow: InstanceType<typeof Adw.ActionRow>;
	@bind.prop('subtitle', (state) => getServerDescription(state))
	readonly serverRow: InstanceType<typeof Adw.ActionRow>;
	@bind.prop('subtitle', (state) => getProtocolDescription(state))
	readonly protocolRow: InstanceType<typeof Adw.ActionRow>;
	@bind.prop('subtitle', (state) => getCapabilityDescription(state))
	readonly capabilityRow: InstanceType<typeof Adw.ActionRow>;
	@bind.prop('subtitle', (state) => getConfigurationDescription(state))
	readonly configurationRow: InstanceType<typeof Adw.ActionRow>;
	@bind.prop('subtitle', (state) => getActiveProviderDescription(state))
	readonly providerRow: InstanceType<typeof Adw.ActionRow>;
	@bind.prop('subtitle', (state) => getMissingCredentialDescription(state))
	readonly credentialRow: InstanceType<typeof Adw.ActionRow>;
	@bind.prop('subtitle', (state) => state.status?.configPath ?? '—')
	readonly configPathRow: InstanceType<typeof Adw.ActionRow>;
	@bind.prop('subtitle', (state) => state.status?.credentialsPath ?? '—')
	readonly credentialsPathRow: InstanceType<typeof Adw.ActionRow>;
	@bind.prop('subtitle', (state) => state.status?.lastError ?? state.lastError ?? '')
	@bind.visible((state) => Boolean(state.status?.lastError ?? state.lastError))
	readonly errorRow: InstanceType<typeof Adw.ActionRow>;
	@bind.sensitive((state) => state.connectionPhase === 'connected')
	@bind.click((state) => void state.refresh())
	readonly refreshButton: InstanceType<typeof Gtk.Button>;
	@bind.visible((state) => state.retryVisible)
	@bind.click((state) => state.retry())
	readonly retryButton: InstanceType<typeof Gtk.Button>;

	constructor(
		root: InstanceType<typeof Adw.PreferencesPage>,
		statusIcon: InstanceType<typeof Gtk.Image>,
		connectionRow: InstanceType<typeof Adw.ActionRow>,
		serverRow: InstanceType<typeof Adw.ActionRow>,
		protocolRow: InstanceType<typeof Adw.ActionRow>,
		capabilityRow: InstanceType<typeof Adw.ActionRow>,
		configurationRow: InstanceType<typeof Adw.ActionRow>,
		providerRow: InstanceType<typeof Adw.ActionRow>,
		credentialRow: InstanceType<typeof Adw.ActionRow>,
		configPathRow: InstanceType<typeof Adw.ActionRow>,
		credentialsPathRow: InstanceType<typeof Adw.ActionRow>,
		errorRow: InstanceType<typeof Adw.ActionRow>,
		refreshButton: InstanceType<typeof Gtk.Button>,
		retryButton: InstanceType<typeof Gtk.Button>,
	) {
		this.root = root;
		this.statusIcon = statusIcon;
		this.connectionRow = connectionRow;
		this.serverRow = serverRow;
		this.protocolRow = protocolRow;
		this.capabilityRow = capabilityRow;
		this.configurationRow = configurationRow;
		this.providerRow = providerRow;
		this.credentialRow = credentialRow;
		this.configPathRow = configPathRow;
		this.credentialsPathRow = credentialsPathRow;
		this.errorRow = errorRow;
		this.refreshButton = refreshButton;
		this.retryButton = retryButton;
	}
}

/** 创建仅依赖现有 daemon 状态的诊断页面。 */
export function createDiagnosticsPage(
	state: DaemonState,
): InstanceType<typeof Adw.PreferencesPage> {
	const statusIcon = new Gtk.Image({ iconName: 'network-offline-symbolic' });
	const connectionRow = new Adw.ActionRow({ title: '', subtitle: '' });
	connectionRow.addPrefix(statusIcon);
	const serverRow = new Adw.ActionRow({ title: '服务端', subtitle: '' });
	const protocolRow = new Adw.ActionRow({ title: '协议版本', subtitle: '' });
	const capabilityRow = new Adw.ActionRow({ title: '服务能力', subtitle: '' });
	const connectionGroup = new Adw.PreferencesGroup({ title: '连接' });
	connectionGroup.add(connectionRow);
	connectionGroup.add(serverRow);
	connectionGroup.add(protocolRow);
	connectionGroup.add(capabilityRow);

	const configurationRow = new Adw.ActionRow({ title: '配置状态', subtitle: '' });
	const providerRow = new Adw.ActionRow({ title: '当前识别服务', subtitle: '' });
	const credentialRow = new Adw.ActionRow({ title: '缺失凭据', subtitle: '' });
	const configPathRow = new Adw.ActionRow({ title: '配置文件', subtitle: '' });
	const credentialsPathRow = new Adw.ActionRow({ title: '凭据存储', subtitle: '' });
	const configurationGroup = new Adw.PreferencesGroup({ title: '配置诊断' });
	configurationGroup.add(configurationRow);
	configurationGroup.add(providerRow);
	configurationGroup.add(credentialRow);
	configurationGroup.add(configPathRow);
	configurationGroup.add(credentialsPathRow);

	const errorRow = new Adw.ActionRow({ title: '最近错误', subtitle: '' });
	const refreshButton = new Gtk.Button({ label: '刷新状态', valign: Gtk.Align.CENTER });
	const retryButton = new Gtk.Button({ label: '重新连接', valign: Gtk.Align.CENTER });
	const buttonBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });
	buttonBox.append(retryButton);
	buttonBox.append(refreshButton);
	const actionRow = new Adw.ActionRow({ title: '诊断操作' });
	actionRow.addSuffix(buttonBox);
	const actionGroup = new Adw.PreferencesGroup();
	actionGroup.add(errorRow);
	actionGroup.add(actionRow);

	const root = new Adw.PreferencesPage({ title: '诊断' });
	root.add(connectionGroup);
	root.add(configurationGroup);
	root.add(actionGroup);
	const view = new DiagnosticsPageView(
		root,
		statusIcon,
		connectionRow,
		serverRow,
		protocolRow,
		capabilityRow,
		configurationRow,
		providerRow,
		credentialRow,
		configPathRow,
		credentialsPathRow,
		errorRow,
		refreshButton,
		retryButton,
	);
	view.state = state;
	return root;
}

function getServerDescription(state: DaemonState): string {
	const server = state.initializeResult?.serverInfo;
	return server ? `${server.name} ${server.version}` : '—';
}

function getProtocolDescription(state: DaemonState): string {
	const version = state.initializeResult?.protocolVersion;
	return version === undefined ? '—' : `v${version}`;
}

function getCapabilityDescription(state: DaemonState): string {
	const capabilities = state.initializeResult?.capabilities;
	if (!capabilities) return '—';
	const partial = capabilities.partialTranscript ? '实时识别' : '批量识别';
	const polishing = capabilities.polishPreview ? '润色预览' : '无润色预览';
	return `${partial} · ${polishing}`;
}

function getConfigurationDescription(state: DaemonState): string {
	if (state.status?.state === 'ready') return '正常';
	if (state.status?.state === 'needs-configuration') return '需要配置';
	if (state.status?.state === 'degraded') return '运行异常';
	return '—';
}

function getMissingCredentialDescription(state: DaemonState): string {
	const names = state.status?.missingCredentialNames;
	if (!names) return '—';
	return names.length > 0 ? names.join('、') : '无';
}

function getActiveProviderDescription(state: DaemonState): string {
	const providerId = state.status?.activeProvider;
	return providerId ? getProviderDisplayName(providerId) : '—';
}
