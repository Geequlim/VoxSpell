import { createFcitxKeyName, formatFcitxKeyName } from '../fcitx/fcitx-key';
import { Adw, Gdk, Gtk } from '../gtk';
import { gtk } from '../state/gtk';

import type { InputBehaviorState } from '../state/input-behavior-state';
import type { FcitxModifier } from '../fcitx/fcitx-key';

const bind = gtk<InputBehaviorState, InputBehaviorPageView>();

@bind.view
class InputBehaviorPageView {
	declare state?: InputBehaviorState;

	@bind.disposeOnDestroy readonly root: InstanceType<typeof Adw.PreferencesPage>;
	@bind.prop('subtitle', (state) => formatFcitxKeyName(state.pttKey))
	readonly pttKeyRow: InstanceType<typeof Adw.ActionRow>;
	@bind.sensitive((state) => state.isEditable)
	@bind.click((state, _button, self) => showShortcutRecorder(self.root, state))
	readonly recordShortcutButton: InstanceType<typeof Gtk.Button>;
	@bind.sensitive((state) => state.isEditable && state.pttKey !== 'space')
	@bind.click((state) => state.updatePttKey('space'))
	readonly resetShortcutButton: InstanceType<typeof Gtk.Button>;
	@bind.prop('value', (state) => state.holdThresholdMs)
	@bind.listen<InstanceType<typeof Adw.SpinRow>>('notify::value', (state, row) =>
		state.updateHoldThreshold(Math.round(row.value)),
	)
	@bind.sensitive((state) => state.isEditable)
	readonly holdThresholdRow: InstanceType<typeof Adw.SpinRow>;
	@bind.prop('active', (state) => state.autoSelectResult)
	@bind.listen<InstanceType<typeof Adw.SwitchRow>>('notify::active', (state, row) =>
		state.updateAutoSelectResult(row.active),
	)
	@bind.sensitive((state) => state.isEditable)
	readonly autoSelectRow: InstanceType<typeof Adw.SwitchRow>;
	@bind.prop('subtitle', (state) => state.operationDescription)
	@bind.visible((state) => Boolean(state.operationDescription))
	readonly operationRow: InstanceType<typeof Adw.ActionRow>;
	@bind.sensitive((state) => state.phase !== 'loading' && state.phase !== 'saving')
	@bind.click((state) => void state.load())
	readonly reloadButton: InstanceType<typeof Gtk.Button>;
	@bind.sensitive((state) => state.isEditable && state.isDirty)
	@bind.click((state) => state.discard())
	readonly discardButton: InstanceType<typeof Gtk.Button>;
	@bind.sensitive((state) => state.canSave)
	@bind.click((state) => void state.save())
	readonly saveButton: InstanceType<typeof Gtk.Button>;

	constructor(
		root: InstanceType<typeof Adw.PreferencesPage>,
		pttKeyRow: InstanceType<typeof Adw.ActionRow>,
		recordShortcutButton: InstanceType<typeof Gtk.Button>,
		resetShortcutButton: InstanceType<typeof Gtk.Button>,
		holdThresholdRow: InstanceType<typeof Adw.SpinRow>,
		autoSelectRow: InstanceType<typeof Adw.SwitchRow>,
		operationRow: InstanceType<typeof Adw.ActionRow>,
		reloadButton: InstanceType<typeof Gtk.Button>,
		discardButton: InstanceType<typeof Gtk.Button>,
		saveButton: InstanceType<typeof Gtk.Button>,
	) {
		this.root = root;
		this.pttKeyRow = pttKeyRow;
		this.recordShortcutButton = recordShortcutButton;
		this.resetShortcutButton = resetShortcutButton;
		this.holdThresholdRow = holdThresholdRow;
		this.autoSelectRow = autoSelectRow;
		this.operationRow = operationRow;
		this.reloadButton = reloadButton;
		this.discardButton = discardButton;
		this.saveButton = saveButton;
	}
}

/** 创建 Fcitx 插件输入行为配置页面。 */
export function createInputBehaviorPage(
	state: InputBehaviorState,
): InstanceType<typeof Adw.PreferencesPage> {
	const pttKeyRow = new Adw.ActionRow({ title: 'PTT 热键' });
	const resetShortcutButton = new Gtk.Button({
		label: '恢复默认',
		valign: Gtk.Align.CENTER,
	});
	const recordShortcutButton = new Gtk.Button({
		label: '设置快捷键',
		valign: Gtk.Align.CENTER,
		cssClasses: ['suggested-action'],
	});
	const shortcutButtonBox = new Gtk.Box({
		orientation: Gtk.Orientation.HORIZONTAL,
		spacing: 8,
	});
	shortcutButtonBox.append(resetShortcutButton);
	shortcutButtonBox.append(recordShortcutButton);
	pttKeyRow.addSuffix(shortcutButtonBox);
	const holdThresholdRow = new Adw.SpinRow({
		title: '长按触发时间（毫秒）',
		subtitle: '达到该时长后进入语音模式；短按仍按原按键处理。',
		adjustment: new Gtk.Adjustment({
			lower: 100,
			upper: 2_000,
			stepIncrement: 50,
			pageIncrement: 100,
			value: 200,
		}),
		digits: 0,
		numeric: true,
		snapToTicks: true,
	});
	const triggerGroup = new Adw.PreferencesGroup({
		title: '按住说话',
		description: '点击设置快捷键，然后按下一个按键或组合键。',
	});
	triggerGroup.add(pttKeyRow);
	triggerGroup.add(holdThresholdRow);

	const autoSelectRow = new Adw.SwitchRow({
		title: '自动选择推荐结果',
		subtitle: '润色可用时自动提交润色结果，否则提交原始识别结果。',
	});
	const resultGroup = new Adw.PreferencesGroup({ title: '结果选择' });
	resultGroup.add(autoSelectRow);

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

	const root = new Adw.PreferencesPage({ title: '输入行为' });
	root.add(triggerGroup);
	root.add(resultGroup);
	root.add(actionGroup);
	const view = new InputBehaviorPageView(
		root,
		pttKeyRow,
		recordShortcutButton,
		resetShortcutButton,
		holdThresholdRow,
		autoSelectRow,
		operationRow,
		reloadButton,
		discardButton,
		saveButton,
	);
	view.state = state;
	return root;
}

function showShortcutRecorder(
	parent: InstanceType<typeof Gtk.Widget>,
	state: InputBehaviorState,
): void {
	const hint = new Gtk.Label({
		label: '等待按键…',
		cssClasses: ['title-2'],
		marginTop: 12,
		marginBottom: 12,
	});
	const dialog = new Adw.AlertDialog({
		heading: '设置 PTT 快捷键',
		body: '按下一个按键或组合键。修饰键需要与其他按键组合，按 Escape 取消。',
		extraChild: hint,
		closeResponse: 'cancel',
	});
	dialog.addResponse('cancel', '取消');
	const keyController = new Gtk.EventControllerKey({
		propagationPhase: Gtk.PropagationPhase.CAPTURE,
	});
	keyController.on('key-pressed', (keyval: number, _keycode: number, modifierState: number) => {
		if (keyval === Gdk.KEY_Escape) {
			dialog.close();
			return true;
		}
		const keyName = Gdk.keyvalName(keyval);
		if (!keyName) return true;
		const shortcut = createFcitxKeyName(keyName, getFcitxModifiers(modifierState));
		if (!shortcut) return true;
		state.updatePttKey(shortcut);
		dialog.close();
		return true;
	});
	dialog.addController(keyController);
	dialog.present(parent);
}

function getFcitxModifiers(modifierState: number): FcitxModifier[] {
	const modifiers: FcitxModifier[] = [];
	if (modifierState & Gdk.ModifierType.CONTROL_MASK) modifiers.push('Control');
	if (modifierState & Gdk.ModifierType.ALT_MASK) modifiers.push('Alt');
	if (modifierState & Gdk.ModifierType.SHIFT_MASK) modifiers.push('Shift');
	if (modifierState & Gdk.ModifierType.SUPER_MASK) modifiers.push('Super');
	if (modifierState & Gdk.ModifierType.HYPER_MASK) modifiers.push('Hyper');
	if (modifierState & Gdk.ModifierType.META_MASK) modifiers.push('Meta');
	return modifiers;
}
