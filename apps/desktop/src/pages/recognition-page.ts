import { Adw, Gtk } from '../gtk';
import { gtk } from '../state/gtk';
import { createFormEntryRow, createFormPasswordEntryRow } from './form-row';

import type { ConfigState } from '../state/config-state';

const bind = gtk<ConfigState, RecognitionPageView>();

@bind.view
class RecognitionPageView {
	declare state?: ConfigState;
	private readonly $providerModel: InstanceType<typeof Gtk.StringList>;
	private readonly $credentialModel: InstanceType<typeof Gtk.StringList>;
	private $providerItems: readonly string[] = [];
	private $credentialItems: readonly string[] = [];
	private $updatingProvider = false;
	private $updatingCredential = false;

	@bind.disposeOnDestroy readonly root: InstanceType<typeof Adw.PreferencesPage>;
	@bind.render<InstanceType<typeof Adw.ComboRow>>((state, row, self) => {
		self.$updatingProvider = true;
		if (!hasSameItems(self.$providerItems, state.providerDisplayNames)) {
			self.$providerModel.splice(0, self.$providerItems.length, [
				...state.providerDisplayNames,
			]);
			self.$providerItems = [...state.providerDisplayNames];
		}
		if (row.selected !== state.selectedProviderIndex)
			row.selected = state.selectedProviderIndex;
		self.$updatingProvider = false;
	})
	@bind.listen<InstanceType<typeof Adw.ComboRow>>('notify::selected', (state, row, self) => {
		if (!self.$updatingProvider) state.selectProvider(row.selected);
	})
	@bind.sensitive((state) => state.isEditable)
	readonly providerRow: InstanceType<typeof Adw.ComboRow>;
	@bind.prop('subtitle', (state) => state.providerTypeTitle)
	readonly providerTypeRow: InstanceType<typeof Adw.ActionRow>;
	@bind.prop('text', (state) => state.providerId)
	@bind.prop('title', (state) => getFieldTitle('服务标识', state.fieldErrors.providerId))
	@bind.listen<InstanceType<typeof Adw.EntryRow>>('changed', (state, row) =>
		state.updateProviderId(row.text),
	)
	@bind.sensitive((state) => state.isEditable)
	readonly providerIdRow: InstanceType<typeof Adw.EntryRow>;
	@bind.prop('text', (state) => state.baseUrl)
	@bind.prop('title', (state) => getFieldTitle('API 地址', state.fieldErrors.baseUrl))
	@bind.listen<InstanceType<typeof Adw.EntryRow>>('changed', (state, row) =>
		state.updateBaseUrl(row.text),
	)
	@bind.visible((state) => state.showsOpenAiFields)
	@bind.sensitive((state) => state.isEditable)
	readonly baseUrlRow: InstanceType<typeof Adw.EntryRow>;
	@bind.prop('text', (state) => state.model)
	@bind.prop('title', (state) => getFieldTitle('模型', state.fieldErrors.model))
	@bind.listen<InstanceType<typeof Adw.EntryRow>>('changed', (state, row) =>
		state.updateModel(row.text),
	)
	@bind.visible((state) => state.showsOpenAiFields)
	@bind.sensitive((state) => state.isEditable)
	readonly modelRow: InstanceType<typeof Adw.EntryRow>;
	@bind.prop('text', (state) => state.apiKeyEnvironment)
	@bind.prop('title', (state) => getFieldTitle('凭据名称', state.fieldErrors.apiKeyEnvironment))
	@bind.listen<InstanceType<typeof Adw.EntryRow>>('changed', (state, row) =>
		state.updateApiKeyEnvironment(row.text),
	)
	@bind.visible((state) => state.showsOpenAiFields)
	@bind.sensitive((state) => state.isEditable)
	readonly apiKeyEnvironmentRow: InstanceType<typeof Adw.EntryRow>;
	@bind.prop('text', (state) => state.engineModelType)
	@bind.prop('title', (state) => getFieldTitle('引擎模型', state.fieldErrors.engineModelType))
	@bind.listen<InstanceType<typeof Adw.EntryRow>>('changed', (state, row) =>
		state.updateEngineModelType(row.text),
	)
	@bind.visible((state) => state.showsTencentFields)
	@bind.sensitive((state) => state.isEditable)
	readonly engineModelRow: InstanceType<typeof Adw.EntryRow>;
	@bind.render<InstanceType<typeof Adw.ComboRow>>((state, row, self) => {
		self.$updatingCredential = true;
		if (!hasSameItems(self.$credentialItems, state.requiredCredentialNames)) {
			self.$credentialModel.splice(0, self.$credentialItems.length, [
				...state.requiredCredentialNames,
			]);
			self.$credentialItems = [...state.requiredCredentialNames];
		}
		if (row.selected !== state.selectedCredentialIndex) {
			row.selected = state.selectedCredentialIndex;
		}
		self.$updatingCredential = false;
	})
	@bind.listen<InstanceType<typeof Adw.ComboRow>>('notify::selected', (state, row, self) => {
		if (!self.$updatingCredential) state.selectCredential(row.selected);
	})
	@bind.visible((state) => state.requiredCredentialNames.length > 1)
	@bind.sensitive((state) => state.isEditable)
	readonly credentialNameRow: InstanceType<typeof Adw.ComboRow>;
	@bind.prop('title', (state) => {
		const name = state.selectedCredentialName;
		return name ? `更新凭据 ${name}` : '更新凭据';
	})
	@bind.prop('text', (state) => state.selectedCredentialValue)
	@bind.listen<InstanceType<typeof Adw.PasswordEntryRow>>('changed', (state, row) =>
		state.updateSelectedCredential(row.text),
	)
	@bind.visible((state) => state.requiredCredentialNames.length > 0)
	@bind.sensitive((state) => state.isEditable)
	readonly credentialValueRow: InstanceType<typeof Adw.PasswordEntryRow>;
	@bind.prop('subtitle', (state) => state.selectedCredentialStatus)
	readonly credentialStatusRow: InstanceType<typeof Adw.ActionRow>;
	@bind.sensitive((state) => state.canDeleteCredential)
	@bind.click((state, _button, self) =>
		showDeleteConfirmation(
			self.root,
			'删除应用内凭据？',
			`凭据 ${state.selectedCredentialName ?? ''} 将从本机凭据库移除。`,
			() => void state.deleteSelectedCredential(),
		),
	)
	readonly deleteCredentialButton: InstanceType<typeof Gtk.Button>;
	@bind.prop('text', (state) => state.newProviderId)
	@bind.prop('title', (state) => getFieldTitle('新服务标识', state.fieldErrors.newProviderId))
	@bind.listen<InstanceType<typeof Adw.EntryRow>>('changed', (state, row) =>
		state.updateNewProviderId(row.text),
	)
	@bind.sensitive((state) => state.isEditable)
	readonly newProviderIdRow: InstanceType<typeof Adw.EntryRow>;
	@bind.prop('selected', (state) => state.newProviderTypeIndex)
	@bind.listen<InstanceType<typeof Adw.ComboRow>>('notify::selected', (state, row) =>
		state.selectNewProviderType(row.selected),
	)
	@bind.sensitive((state) => state.isEditable)
	readonly newProviderTypeRow: InstanceType<typeof Adw.ComboRow>;
	@bind.sensitive((state) => state.canAddProvider)
	@bind.click((state) => state.addProvider())
	readonly addProviderButton: InstanceType<typeof Gtk.Button>;
	@bind.prop('subtitle', (state) => state.operationDescription)
	@bind.prop('title', (state) => state.operationTitle)
	@bind.visible((state) => Boolean(state.operationDescription))
	readonly operationRow: InstanceType<typeof Adw.ActionRow>;
	@bind.visible((state) => state.phase === 'error')
	readonly operationErrorIcon: InstanceType<typeof Gtk.Image>;
	@bind.sensitive((state) => state.isEditable && state.isDirty && state.phase !== 'saving')
	@bind.click((state) => state.discard())
	readonly discardButton: InstanceType<typeof Gtk.Button>;
	@bind.sensitive((state) => state.canReload)
	@bind.click((state) => void state.load())
	readonly reloadButton: InstanceType<typeof Gtk.Button>;
	@bind.sensitive((state) => state.canDeleteProvider)
	@bind.click((state, _button, self) =>
		showDeleteConfirmation(
			self.root,
			'删除当前识别服务？',
			`识别服务 ${state.providerDisplayName} 将从配置中移除，已存储凭据会保留。`,
			() => state.deleteActiveProvider(),
		),
	)
	readonly deleteProviderButton: InstanceType<typeof Gtk.Button>;
	@bind.sensitive((state) => state.canTestProvider)
	@bind.click((state) => void state.testProvider())
	readonly testProviderButton: InstanceType<typeof Gtk.Button>;
	@bind.sensitive((state) => state.canSave)
	@bind.click((state) => void state.save())
	readonly saveButton: InstanceType<typeof Gtk.Button>;

	constructor(
		root: InstanceType<typeof Adw.PreferencesPage>,
		providerModel: InstanceType<typeof Gtk.StringList>,
		credentialModel: InstanceType<typeof Gtk.StringList>,
		providerRow: InstanceType<typeof Adw.ComboRow>,
		providerTypeRow: InstanceType<typeof Adw.ActionRow>,
		providerIdRow: InstanceType<typeof Adw.EntryRow>,
		baseUrlRow: InstanceType<typeof Adw.EntryRow>,
		modelRow: InstanceType<typeof Adw.EntryRow>,
		apiKeyEnvironmentRow: InstanceType<typeof Adw.EntryRow>,
		engineModelRow: InstanceType<typeof Adw.EntryRow>,
		credentialNameRow: InstanceType<typeof Adw.ComboRow>,
		credentialValueRow: InstanceType<typeof Adw.PasswordEntryRow>,
		credentialStatusRow: InstanceType<typeof Adw.ActionRow>,
		deleteCredentialButton: InstanceType<typeof Gtk.Button>,
		newProviderIdRow: InstanceType<typeof Adw.EntryRow>,
		newProviderTypeRow: InstanceType<typeof Adw.ComboRow>,
		addProviderButton: InstanceType<typeof Gtk.Button>,
		operationRow: InstanceType<typeof Adw.ActionRow>,
		operationErrorIcon: InstanceType<typeof Gtk.Image>,
		discardButton: InstanceType<typeof Gtk.Button>,
		reloadButton: InstanceType<typeof Gtk.Button>,
		deleteProviderButton: InstanceType<typeof Gtk.Button>,
		testProviderButton: InstanceType<typeof Gtk.Button>,
		saveButton: InstanceType<typeof Gtk.Button>,
	) {
		this.root = root;
		this.$providerModel = providerModel;
		this.$credentialModel = credentialModel;
		this.providerRow = providerRow;
		this.providerTypeRow = providerTypeRow;
		this.providerIdRow = providerIdRow;
		this.baseUrlRow = baseUrlRow;
		this.modelRow = modelRow;
		this.apiKeyEnvironmentRow = apiKeyEnvironmentRow;
		this.engineModelRow = engineModelRow;
		this.credentialNameRow = credentialNameRow;
		this.credentialValueRow = credentialValueRow;
		this.credentialStatusRow = credentialStatusRow;
		this.deleteCredentialButton = deleteCredentialButton;
		this.newProviderIdRow = newProviderIdRow;
		this.newProviderTypeRow = newProviderTypeRow;
		this.addProviderButton = addProviderButton;
		this.operationRow = operationRow;
		this.operationErrorIcon = operationErrorIcon;
		this.discardButton = discardButton;
		this.reloadButton = reloadButton;
		this.deleteProviderButton = deleteProviderButton;
		this.testProviderButton = testProviderButton;
		this.saveButton = saveButton;
	}
}

/** 创建语音识别 Provider 配置页面。 */
export function createRecognitionPage(
	state: ConfigState,
): InstanceType<typeof Adw.PreferencesPage> {
	const providerModel = Gtk.StringList.new([]);
	const providerRow = new Adw.ComboRow({
		title: '识别服务',
		useSubtitle: true,
		model: providerModel,
	});
	const providerTypeRow = new Adw.ActionRow({ title: '接口类型', subtitle: '' });
	const providerIdRow = createFormEntryRow('服务标识');
	const baseUrlRow = createFormEntryRow('API 地址');
	const modelRow = createFormEntryRow('模型');
	const apiKeyEnvironmentRow = createFormEntryRow('凭据名称');
	const engineModelRow = createFormEntryRow('引擎模型');
	const providerGroup = new Adw.PreferencesGroup({
		title: '语音识别服务',
		description: '切换并编辑 daemon 中已有的识别服务配置。',
	});
	providerGroup.add(providerRow);
	providerGroup.add(providerTypeRow);
	providerGroup.add(providerIdRow);
	providerGroup.add(baseUrlRow);
	providerGroup.add(modelRow);
	providerGroup.add(apiKeyEnvironmentRow);
	providerGroup.add(engineModelRow);

	const credentialModel = Gtk.StringList.new([]);
	const credentialNameRow = new Adw.ComboRow({
		title: '凭据名称',
		useSubtitle: true,
		model: credentialModel,
	});
	const credentialValueRow = createFormPasswordEntryRow('更新凭据');
	const credentialStatusRow = new Adw.ActionRow({ title: '凭据状态', subtitle: '' });
	const deleteCredentialButton = new Gtk.Button({
		label: '删除凭据',
		valign: Gtk.Align.CENTER,
		cssClasses: ['destructive-action'],
	});
	credentialStatusRow.addSuffix(deleteCredentialButton);
	const credentialGroup = new Adw.PreferencesGroup({
		title: '凭据',
		description: '已保存的凭据不会回显；留空表示不修改。',
	});
	credentialGroup.add(credentialNameRow);
	credentialGroup.add(credentialValueRow);
	credentialGroup.add(credentialStatusRow);

	const newProviderIdRow = createFormEntryRow('新服务标识');
	const newProviderTypeRow = new Adw.ComboRow({
		title: '服务类型',
		model: Gtk.StringList.new(['OpenAI 兼容转写', '腾讯云实时识别']),
	});
	const addProviderButton = new Gtk.Button({
		label: '添加识别服务',
		valign: Gtk.Align.CENTER,
		cssClasses: ['suggested-action'],
	});
	const addProviderRow = new Adw.ActionRow({ title: '创建新识别服务' });
	addProviderRow.addSuffix(addProviderButton);
	const providerManagementGroup = new Adw.PreferencesGroup({
		title: '新增识别服务',
		description: '识别服务创建后类型固定；详细字段在创建后编辑。',
	});
	providerManagementGroup.add(newProviderIdRow);
	providerManagementGroup.add(newProviderTypeRow);
	providerManagementGroup.add(addProviderRow);

	const operationErrorIcon = new Gtk.Image({
		iconName: 'dialog-error-symbolic',
		cssClasses: ['error'],
	});
	const operationRow = new Adw.ActionRow({ title: '状态', subtitle: '' });
	operationRow.addPrefix(operationErrorIcon);
	const reloadButton = new Gtk.Button({ label: '重新加载', valign: Gtk.Align.CENTER });
	const deleteProviderButton = new Gtk.Button({
		label: '删除识别服务',
		valign: Gtk.Align.CENTER,
		cssClasses: ['destructive-action'],
	});
	const testProviderButton = new Gtk.Button({ label: '测试连接', valign: Gtk.Align.CENTER });
	const discardButton = new Gtk.Button({ label: '撤销', valign: Gtk.Align.CENTER });
	const saveButton = new Gtk.Button({
		label: '保存',
		valign: Gtk.Align.CENTER,
		cssClasses: ['suggested-action'],
	});
	const buttonBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });
	buttonBox.append(reloadButton);
	buttonBox.append(deleteProviderButton);
	buttonBox.append(testProviderButton);
	buttonBox.append(discardButton);
	buttonBox.append(saveButton);
	const actionRow = new Adw.ActionRow({ title: '保存更改' });
	actionRow.addSuffix(buttonBox);
	const actionGroup = new Adw.PreferencesGroup();
	actionGroup.add(operationRow);
	actionGroup.add(actionRow);

	const root = new Adw.PreferencesPage({ title: '语音识别' });
	root.add(providerGroup);
	root.add(credentialGroup);
	root.add(providerManagementGroup);
	root.add(actionGroup);
	const view = new RecognitionPageView(
		root,
		providerModel,
		credentialModel,
		providerRow,
		providerTypeRow,
		providerIdRow,
		baseUrlRow,
		modelRow,
		apiKeyEnvironmentRow,
		engineModelRow,
		credentialNameRow,
		credentialValueRow,
		credentialStatusRow,
		deleteCredentialButton,
		newProviderIdRow,
		newProviderTypeRow,
		addProviderButton,
		operationRow,
		operationErrorIcon,
		discardButton,
		reloadButton,
		deleteProviderButton,
		testProviderButton,
		saveButton,
	);
	view.state = state;
	return root;
}

function getFieldTitle(title: string, error?: string): string {
	return error ? `${title} · ${error}` : title;
}

function hasSameItems(current: readonly string[], next: readonly string[]): boolean {
	return current.length === next.length && current.every((item, index) => item === next[index]);
}

function showDeleteConfirmation(
	parent: InstanceType<typeof Gtk.Widget>,
	heading: string,
	body: string,
	confirm: () => void,
): void {
	const dialog = new Adw.AlertDialog({
		heading,
		body,
		closeResponse: 'cancel',
		defaultResponse: 'cancel',
	});
	dialog.addResponse('cancel', '取消');
	dialog.addResponse('delete', '删除');
	dialog.setResponseAppearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);
	dialog.choose(parent, null, (_source, result) => {
		if (dialog.chooseFinish(result) === 'delete') confirm();
	});
}
