import { Adw, Gtk } from '../gtk';
import { gtk } from '../state/gtk';

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
		if (!hasSameItems(self.$providerItems, state.providerIds)) {
			self.$providerModel.splice(0, self.$providerItems.length, [...state.providerIds]);
			self.$providerItems = [...state.providerIds];
		}
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
		row.selected = state.selectedCredentialIndex;
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
	@bind.prop('subtitle', (state) => state.operationDescription)
	@bind.visible((state) => Boolean(state.operationDescription))
	readonly operationRow: InstanceType<typeof Adw.ActionRow>;
	@bind.sensitive((state) => state.isEditable && state.isDirty && state.phase !== 'saving')
	@bind.click((state) => state.discard())
	readonly discardButton: InstanceType<typeof Gtk.Button>;
	@bind.sensitive((state) => state.canReload)
	@bind.click((state) => void state.load())
	readonly reloadButton: InstanceType<typeof Gtk.Button>;
	@bind.sensitive((state) => state.canSave)
	@bind.click((state) => void state.save())
	readonly saveButton: InstanceType<typeof Gtk.Button>;

	constructor(
		root: InstanceType<typeof Adw.PreferencesPage>,
		providerModel: InstanceType<typeof Gtk.StringList>,
		credentialModel: InstanceType<typeof Gtk.StringList>,
		providerRow: InstanceType<typeof Adw.ComboRow>,
		providerTypeRow: InstanceType<typeof Adw.ActionRow>,
		baseUrlRow: InstanceType<typeof Adw.EntryRow>,
		modelRow: InstanceType<typeof Adw.EntryRow>,
		engineModelRow: InstanceType<typeof Adw.EntryRow>,
		credentialNameRow: InstanceType<typeof Adw.ComboRow>,
		credentialValueRow: InstanceType<typeof Adw.PasswordEntryRow>,
		credentialStatusRow: InstanceType<typeof Adw.ActionRow>,
		operationRow: InstanceType<typeof Adw.ActionRow>,
		discardButton: InstanceType<typeof Gtk.Button>,
		reloadButton: InstanceType<typeof Gtk.Button>,
		saveButton: InstanceType<typeof Gtk.Button>,
	) {
		this.root = root;
		this.$providerModel = providerModel;
		this.$credentialModel = credentialModel;
		this.providerRow = providerRow;
		this.providerTypeRow = providerTypeRow;
		this.baseUrlRow = baseUrlRow;
		this.modelRow = modelRow;
		this.engineModelRow = engineModelRow;
		this.credentialNameRow = credentialNameRow;
		this.credentialValueRow = credentialValueRow;
		this.credentialStatusRow = credentialStatusRow;
		this.operationRow = operationRow;
		this.discardButton = discardButton;
		this.reloadButton = reloadButton;
		this.saveButton = saveButton;
	}
}

/** 创建语音识别 Provider 配置页面。 */
export function createRecognitionPage(
	state: ConfigState,
): InstanceType<typeof Adw.PreferencesPage> {
	const providerModel = Gtk.StringList.new([]);
	const providerRow = new Adw.ComboRow({
		title: 'Provider',
		useSubtitle: true,
		model: providerModel,
	});
	const providerTypeRow = new Adw.ActionRow({ title: '接口类型', subtitle: '' });
	const baseUrlRow = new Adw.EntryRow({ title: 'API 地址' });
	const modelRow = new Adw.EntryRow({ title: '模型' });
	const engineModelRow = new Adw.EntryRow({ title: '引擎模型' });
	const providerGroup = new Adw.PreferencesGroup({
		title: '语音识别 Provider',
		description: '切换并编辑 daemon 中已有的识别服务配置。',
	});
	providerGroup.add(providerRow);
	providerGroup.add(providerTypeRow);
	providerGroup.add(baseUrlRow);
	providerGroup.add(modelRow);
	providerGroup.add(engineModelRow);

	const credentialModel = Gtk.StringList.new([]);
	const credentialNameRow = new Adw.ComboRow({
		title: '凭据名称',
		useSubtitle: true,
		model: credentialModel,
	});
	const credentialValueRow = new Adw.PasswordEntryRow({ title: '更新凭据' });
	const credentialStatusRow = new Adw.ActionRow({ title: '凭据状态', subtitle: '' });
	const credentialGroup = new Adw.PreferencesGroup({
		title: '凭据',
		description: '已保存的凭据不会回显；留空表示不修改。',
	});
	credentialGroup.add(credentialNameRow);
	credentialGroup.add(credentialValueRow);
	credentialGroup.add(credentialStatusRow);

	const operationRow = new Adw.ActionRow({ title: '状态', subtitle: '' });
	const reloadButton = new Gtk.Button({ label: '重新加载', valign: Gtk.Align.CENTER });
	const discardButton = new Gtk.Button({ label: '撤销', valign: Gtk.Align.CENTER });
	const saveButton = new Gtk.Button({
		label: '保存',
		valign: Gtk.Align.CENTER,
		cssClasses: ['suggested-action'],
	});
	const buttonBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });
	buttonBox.append(reloadButton);
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
	root.add(actionGroup);
	const view = new RecognitionPageView(
		root,
		providerModel,
		credentialModel,
		providerRow,
		providerTypeRow,
		baseUrlRow,
		modelRow,
		engineModelRow,
		credentialNameRow,
		credentialValueRow,
		credentialStatusRow,
		operationRow,
		discardButton,
		reloadButton,
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
