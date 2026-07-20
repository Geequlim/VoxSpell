import {
	MAXIMUM_RECORDING_SECONDS,
	MINIMUM_RECORDING_SECONDS,
} from '@voxspell/config/config-schema';
import { Adw, Gtk } from '../gtk';
import { gtk } from '../state/gtk';
import { asrProviderDefinitions } from '../asr-provider-registry';
import { createFormEntryRow, createFormPasswordEntryRow } from './form-row';

import type { ConfigState } from '../state/config-state';

interface CredentialRowBinding {
	readonly name: string;
	readonly row: InstanceType<typeof Adw.PasswordEntryRow>;
}

type ProviderFieldRowBinding =
	| {
			readonly id: string;
			readonly input: 'entry';
			readonly row: InstanceType<typeof Adw.EntryRow>;
	  }
	| {
			readonly id: string;
			readonly input: 'choice';
			readonly row: InstanceType<typeof Adw.ComboRow>;
	  };

const bind = gtk<ConfigState, RecognitionPageView>();

@bind.view
class RecognitionPageView {
	declare state?: ConfigState;
	private readonly $providerModel: InstanceType<typeof Gtk.StringList>;
	private $providerItems: readonly string[] = [];
	private $credentialItems: readonly string[] = [];
	private $providerFieldKey?: string;
	private $providerFieldRows: readonly ProviderFieldRowBinding[] = [];
	private $credentialRows: readonly CredentialRowBinding[] = [];
	private $updatingProvider = false;
	private $updatingProviderFields = false;
	private $updatingCredentials = false;

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
	@bind.render<InstanceType<typeof Adw.PreferencesGroup>>((state, group, self) => {
		const provider = state.activeProvider;
		const definition = state.activeProviderDefinition;
		if (!provider || !definition) return;
		const fields = definition.getFields(provider);
		const fieldKey = `${definition.type}:${fields
			.map(
				(field) =>
					`${field.id}:${field.input}:${field.choices?.map((item) => item.value).join(',') ?? ''}`,
			)
			.join('|')}`;
		if (self.$providerFieldKey !== fieldKey) {
			self.$providerFieldRows.forEach(({ row }) => group.remove(row));
			self.$providerFieldRows = fields.map((field) => {
				if (field.input === 'choice') {
					const choices = field.choices ?? [];
					const row = new Adw.ComboRow({
						title: field.title,
						model: Gtk.StringList.new(choices.map((item) => item.title)),
					});
					row.on('notify::selected', () => {
						if (self.$updatingProviderFields) return;
						const value = choices[row.selected]?.value;
						if (value !== undefined) state.updateProviderField(field.id, value);
					});
					group.add(row);
					return { id: field.id, input: 'choice' as const, row };
				}
				const row = createFormEntryRow(field.title);
				if (field.input === 'url') row.inputPurpose = Gtk.InputPurpose.URL;
				row.on('changed', () => {
					if (self.$updatingProviderFields) return;
					state.updateProviderField(field.id, row.getText() ?? '');
				});
				group.add(row);
				return { id: field.id, input: 'entry' as const, row };
			});
			self.$providerFieldKey = fieldKey;
		}
		self.$updatingProviderFields = true;
		fields.forEach((field) => {
			const binding = self.$providerFieldRows.find((item) => item.id === field.id);
			if (!binding) return;
			const value = field.getValue(provider);
			if (binding.input === 'choice') {
				const selected = field.choices?.findIndex((item) => item.value === value) ?? -1;
				if (selected >= 0 && binding.row.selected !== selected) {
					binding.row.selected = selected;
				}
			} else if (binding.row.text !== value) binding.row.text = value;
			binding.row.sensitive = state.isEditable;
		});
		self.$updatingProviderFields = false;
	})
	readonly providerFieldsGroup: InstanceType<typeof Adw.PreferencesGroup>;
	@bind.prop('value', (state) => state.maximumRecordingSeconds)
	@bind.prop('title', (state) =>
		getFieldTitle('最长录音时长（秒）', state.fieldErrors.maximumRecordingSeconds),
	)
	@bind.listen<InstanceType<typeof Adw.SpinRow>>('notify::value', (state, row) =>
		state.updateMaximumRecordingSeconds(Math.round(row.value)),
	)
	@bind.sensitive((state) => state.isEditable)
	readonly maximumRecordingSecondsRow: InstanceType<typeof Adw.SpinRow>;
	@bind.prop('active', (state) => state.trimTrailingPeriod)
	@bind.listen<InstanceType<typeof Adw.SwitchRow>>('notify::active', (state, row) =>
		state.updateTrimTrailingPeriod(row.active),
	)
	@bind.sensitive((state) => state.isEditable)
	readonly trimTrailingPeriodRow: InstanceType<typeof Adw.SwitchRow>;
	@bind.render<InstanceType<typeof Adw.PreferencesGroup>>((state, group, self) => {
		const provider = state.activeProvider;
		const definitions = state.activeCredentialDefinitions;
		const credentialItems = provider
			? definitions.map((item) => `${item.id}:${item.getEnvironmentName(provider)}`)
			: [];
		if (!hasSameItems(self.$credentialItems, credentialItems)) {
			self.$credentialRows.forEach((item) => group.remove(item.row));
			self.$credentialRows = provider
				? definitions.map((definition) => {
						const name = definition.getEnvironmentName(provider);
						const row = createFormPasswordEntryRow(`${definition.title} · ${name}`);
						const focusController = new Gtk.EventControllerFocus();
						row.addController(focusController);
						row.on('changed', () => {
							if (!self.$updatingCredentials) state.updateCredential(name, row.text);
						});
						row.on('entry-activated', () => state.commitCredential(name));
						focusController.on('leave', () => state.commitCredential(name));
						group.add(row);
						return { name, row };
					})
				: [];
			self.$credentialItems = credentialItems;
		}
		self.$updatingCredentials = true;
		self.$credentialRows.forEach((item) => {
			const value = state.getCredentialValue(item.name);
			if (item.row.text !== value) item.row.text = value;
			item.row.sensitive = state.isEditable;
		});
		self.$updatingCredentials = false;
	})
	@bind.visible((state) => state.requiredCredentialNames.length > 0)
	readonly credentialGroup: InstanceType<typeof Adw.PreferencesGroup>;
	@bind.sensitive((state) => state.isEditable)
	@bind.click((state, _button, self) => showCreateProviderDialog(self.root, state))
	readonly newProviderButton: InstanceType<typeof Gtk.Button>;
	@bind.prop('subtitle', (state) => state.operationDescription)
	@bind.prop('title', (state) => state.operationTitle)
	@bind.visible((state) => Boolean(state.operationDescription))
	readonly operationRow: InstanceType<typeof Adw.ActionRow>;
	@bind.visible((state) => state.phase === 'error')
	readonly operationErrorIcon: InstanceType<typeof Gtk.Image>;
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

	constructor(
		root: InstanceType<typeof Adw.PreferencesPage>,
		providerModel: InstanceType<typeof Gtk.StringList>,
		providerRow: InstanceType<typeof Adw.ComboRow>,
		providerTypeRow: InstanceType<typeof Adw.ActionRow>,
		providerIdRow: InstanceType<typeof Adw.EntryRow>,
		providerFieldsGroup: InstanceType<typeof Adw.PreferencesGroup>,
		maximumRecordingSecondsRow: InstanceType<typeof Adw.SpinRow>,
		trimTrailingPeriodRow: InstanceType<typeof Adw.SwitchRow>,
		credentialGroup: InstanceType<typeof Adw.PreferencesGroup>,
		newProviderButton: InstanceType<typeof Gtk.Button>,
		operationRow: InstanceType<typeof Adw.ActionRow>,
		operationErrorIcon: InstanceType<typeof Gtk.Image>,
		deleteProviderButton: InstanceType<typeof Gtk.Button>,
		testProviderButton: InstanceType<typeof Gtk.Button>,
	) {
		this.root = root;
		this.$providerModel = providerModel;
		this.providerRow = providerRow;
		this.providerTypeRow = providerTypeRow;
		this.providerIdRow = providerIdRow;
		this.providerFieldsGroup = providerFieldsGroup;
		this.maximumRecordingSecondsRow = maximumRecordingSecondsRow;
		this.trimTrailingPeriodRow = trimTrailingPeriodRow;
		this.credentialGroup = credentialGroup;
		this.newProviderButton = newProviderButton;
		this.operationRow = operationRow;
		this.operationErrorIcon = operationErrorIcon;
		this.deleteProviderButton = deleteProviderButton;
		this.testProviderButton = testProviderButton;
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
	const newProviderButton = new Gtk.Button({
		label: '新建',
		valign: Gtk.Align.CENTER,
		cssClasses: ['flat'],
	});
	const providerGroup = new Adw.PreferencesGroup({
		title: '语音识别服务',
		description: '切换并编辑 daemon 中已有的识别服务配置。',
		headerSuffix: newProviderButton,
	});
	providerGroup.add(providerRow);
	providerGroup.add(providerTypeRow);
	providerGroup.add(providerIdRow);
	const maximumRecordingSecondsRow = new Adw.SpinRow({
		title: '最长录音时长（秒）',
		subtitle: '达到时限后自动结束并关闭实时识别连接。',
		adjustment: new Gtk.Adjustment({
			lower: MINIMUM_RECORDING_SECONDS,
			upper: MAXIMUM_RECORDING_SECONDS,
			stepIncrement: 1,
			pageIncrement: 30,
			value: 300,
		}),
		digits: 0,
		numeric: true,
	});
	const recordingGroup = new Adw.PreferencesGroup({ title: '录音' });
	recordingGroup.add(maximumRecordingSecondsRow);
	const trimTrailingPeriodRow = new Adw.SwitchRow({
		title: '裁剪尾部句号',
		subtitle: '提交前移除末尾的中文句号或单个英文句号。',
	});
	const textProcessingGroup = new Adw.PreferencesGroup({ title: '文本处理' });
	textProcessingGroup.add(trimTrailingPeriodRow);

	const credentialGroup = new Adw.PreferencesGroup({
		title: '凭据',
		description: '已保存的凭据不会回显；输入新值后自动保存。',
	});

	const operationErrorIcon = new Gtk.Image({
		iconName: 'dialog-error-symbolic',
		cssClasses: ['error'],
	});
	const operationRow = new Adw.ActionRow({ title: '自动保存', subtitle: '' });
	operationRow.addPrefix(operationErrorIcon);
	const deleteProviderButton = new Gtk.Button({
		label: '删除识别服务',
		valign: Gtk.Align.CENTER,
		cssClasses: ['destructive-action'],
	});
	const testProviderButton = new Gtk.Button({ label: '测试连接', valign: Gtk.Align.CENTER });
	const buttonBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });
	buttonBox.append(deleteProviderButton);
	buttonBox.append(testProviderButton);
	const actionRow = new Adw.ActionRow({ title: '识别服务操作' });
	actionRow.addSuffix(buttonBox);
	const actionGroup = new Adw.PreferencesGroup();
	actionGroup.add(operationRow);
	actionGroup.add(actionRow);

	const root = new Adw.PreferencesPage({ title: '语音识别' });
	root.add(recordingGroup);
	root.add(textProcessingGroup);
	root.add(providerGroup);
	root.add(credentialGroup);
	root.add(actionGroup);
	const view = new RecognitionPageView(
		root,
		providerModel,
		providerRow,
		providerTypeRow,
		providerIdRow,
		providerGroup,
		maximumRecordingSecondsRow,
		trimTrailingPeriodRow,
		credentialGroup,
		newProviderButton,
		operationRow,
		operationErrorIcon,
		deleteProviderButton,
		testProviderButton,
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

function showCreateProviderDialog(
	parent: InstanceType<typeof Gtk.Widget>,
	state: ConfigState,
): void {
	const providerIdRow = createFormEntryRow('服务标识');
	const providerTypeRow = new Adw.ComboRow({
		title: '服务类型',
		model: Gtk.StringList.new(asrProviderDefinitions.map((item) => item.title)),
	});
	const providerGroup = new Adw.PreferencesGroup({
		title: '新服务',
		description: '创建后自动选中；详细配置和凭据可在当前页面继续填写。',
	});
	providerGroup.add(providerIdRow);
	providerGroup.add(providerTypeRow);

	const errorIcon = new Gtk.Image({ iconName: 'dialog-error-symbolic', cssClasses: ['error'] });
	const errorRow = new Adw.ActionRow({ title: '无法创建识别服务', subtitle: '' });
	errorRow.addPrefix(errorIcon);
	const errorGroup = new Adw.PreferencesGroup({ visible: false });
	errorGroup.add(errorRow);

	const page = new Adw.PreferencesPage({ vexpand: true });
	page.add(providerGroup);
	const cancelButton = new Gtk.Button({ label: '取消' });
	const createButton = new Gtk.Button({ label: '创建', cssClasses: ['suggested-action'] });
	const header = new Adw.HeaderBar({
		titleWidget: new Adw.WindowTitle({ title: '新建识别服务', subtitle: '' }),
	});
	const actionBox = new Gtk.Box({
		orientation: Gtk.Orientation.HORIZONTAL,
		spacing: 8,
		halign: Gtk.Align.END,
		hexpand: true,
		marginTop: 10,
		marginBottom: 10,
		marginStart: 12,
		marginEnd: 12,
	});
	actionBox.append(cancelButton);
	actionBox.append(createButton);
	errorGroup.marginTop = 10;
	errorGroup.marginStart = 12;
	errorGroup.marginEnd = 12;
	const contentBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
	contentBox.append(page);
	contentBox.append(errorGroup);
	contentBox.append(actionBox);
	const toolbar = new Adw.ToolbarView({ content: contentBox });
	toolbar.addTopBar(header);
	const dialog = new Adw.Dialog({
		title: '新建识别服务',
		child: toolbar,
		contentWidth: 560,
		contentHeight: 360,
		defaultWidget: createButton,
		focusWidget: providerIdRow,
	});

	providerIdRow.on('changed', () => {
		providerIdRow.title = '服务标识';
		errorGroup.visible = false;
		state.clearOperationResult();
	});
	providerTypeRow.on('notify::selected', () => {
		errorGroup.visible = false;
		state.clearOperationResult();
	});

	const setBusy = (busy: boolean): void => {
		dialog.canClose = !busy;
		page.sensitive = !busy;
		cancelButton.sensitive = !busy;
		createButton.sensitive = !busy;
	};
	const showError = (): void => {
		providerIdRow.title = getFieldTitle('服务标识', state.fieldErrors.providerId);
		errorRow.subtitle = state.operationDescription;
		errorGroup.visible = true;
	};
	let created = false;
	const create = async (): Promise<void> => {
		const definition = asrProviderDefinitions[providerTypeRow.selected];
		if (!definition) return;
		const provider = definition.createDefaultConfig((providerIdRow.getText() ?? '').trim());
		setBusy(true);
		created = await state.createProvider(provider);
		setBusy(false);
		if (created) dialog.close();
		else showError();
	};
	cancelButton.on('clicked', () => dialog.close());
	createButton.on('clicked', () => void create());
	dialog.on('closed', () => {
		if (!created) state.clearOperationResult();
	});
	dialog.present(parent);
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
