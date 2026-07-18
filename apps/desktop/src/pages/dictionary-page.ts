import { Adw, Gtk, Pango } from '../gtk';
import { gtk } from '../state/gtk';
import { createFormEntryRow } from './form-row';

import type { VoiceDictionaryEntry } from '@voxspell/config/dictionary-schema';
import type { DictionaryState } from '../state/dictionary-state';

const bind = gtk<DictionaryState, DictionaryPageView>();

@bind.view
class DictionaryPageView {
	declare state?: DictionaryState;

	@bind.disposeOnDestroy readonly root: InstanceType<typeof Gtk.Box>;
	@bind.prop('text', (state) => state.searchQuery)
	@bind.listen<InstanceType<typeof Gtk.SearchEntry>>('search-changed', (state, entry) =>
		state.updateSearchQuery(entry.text),
	)
	readonly searchEntry: InstanceType<typeof Gtk.SearchEntry>;
	@bind.sensitive((state) => state.isEditable && !state.editorEntry)
	@bind.click((state, _button, self) => showEntryDialog(self.root, state))
	readonly addButton: InstanceType<typeof Gtk.Button>;
	@bind.render<InstanceType<typeof Gtk.ListBox>>((state, list, self) =>
		renderDictionaryList(list, state, self.root),
	)
	readonly entryList: InstanceType<typeof Gtk.ListBox>;
	@bind.label((state) => state.operationDescription)
	readonly operationLabel: InstanceType<typeof Gtk.Label>;
	@bind.visible((state) => ['loading', 'saving', 'error'].includes(state.phase))
	readonly operationBox: InstanceType<typeof Gtk.Box>;
	@bind.visible((state) => state.phase === 'error')
	readonly operationErrorIcon: InstanceType<typeof Gtk.Image>;
	@bind.visible((state) => state.phase === 'loading' || state.phase === 'saving')
	@bind.prop('spinning', (state) => state.phase === 'loading' || state.phase === 'saving')
	readonly operationSpinner: InstanceType<typeof Gtk.Spinner>;

	constructor(
		root: InstanceType<typeof Gtk.Box>,
		searchEntry: InstanceType<typeof Gtk.SearchEntry>,
		addButton: InstanceType<typeof Gtk.Button>,
		entryList: InstanceType<typeof Gtk.ListBox>,
		operationBox: InstanceType<typeof Gtk.Box>,
		operationLabel: InstanceType<typeof Gtk.Label>,
		operationErrorIcon: InstanceType<typeof Gtk.Image>,
		operationSpinner: InstanceType<typeof Gtk.Spinner>,
	) {
		this.root = root;
		this.searchEntry = searchEntry;
		this.addButton = addButton;
		this.entryList = entryList;
		this.operationBox = operationBox;
		this.operationLabel = operationLabel;
		this.operationErrorIcon = operationErrorIcon;
		this.operationSpinner = operationSpinner;
	}
}

/** 创建独立的表格型用户词典管理页面。 */
export function createDictionaryPage(state: DictionaryState): InstanceType<typeof Gtk.Box> {
	const searchEntry = new Gtk.SearchEntry({
		placeholderText: '搜索标准写法或识别别名',
		hexpand: true,
	});
	const addButton = new Gtk.Button({
		label: '添加词条',
		valign: Gtk.Align.CENTER,
		cssClasses: ['suggested-action'],
	});
	const toolsBox = new Gtk.Box({
		orientation: Gtk.Orientation.HORIZONTAL,
		spacing: 12,
	});
	toolsBox.append(searchEntry);
	toolsBox.append(addButton);

	const operationErrorIcon = new Gtk.Image({
		iconName: 'dialog-error-symbolic',
		cssClasses: ['error'],
	});
	const operationSpinner = new Gtk.Spinner();
	const operationLabel = new Gtk.Label({ label: '', xalign: 0, hexpand: true });
	const operationBox = new Gtk.Box({
		orientation: Gtk.Orientation.HORIZONTAL,
		spacing: 8,
		cssClasses: ['card'],
		marginTop: 2,
		marginBottom: 2,
		marginStart: 8,
		marginEnd: 8,
	});
	operationBox.append(operationErrorIcon);
	operationBox.append(operationSpinner);
	operationBox.append(operationLabel);

	const header = createDictionaryRowGrid();
	attachDictionaryCell(
		header,
		new Gtk.Label({ label: '标准写法', xalign: 0, cssClasses: ['heading'] }),
		0,
		3,
	);
	attachDictionaryCell(
		header,
		new Gtk.Label({ label: '识别别名', xalign: 0, cssClasses: ['heading'] }),
		3,
		7,
	);
	attachDictionaryCell(
		header,
		new Gtk.Label({ label: 'AI 保护', xalign: 0, cssClasses: ['heading'] }),
		10,
		1,
	);
	attachDictionaryCell(
		header,
		new Gtk.Label({ label: '权重', xalign: 0, cssClasses: ['heading'] }),
		11,
		1,
	);
	attachDictionaryCell(header, new Gtk.Box(), 12, 2);

	const entryList = new Gtk.ListBox({
		selectionMode: Gtk.SelectionMode.NONE,
		cssClasses: ['boxed-list'],
	});
	const tableScroll = new Gtk.ScrolledWindow({
		child: entryList,
		hexpand: true,
		vexpand: true,
		hscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
		vscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
	});

	const root = new Gtk.Box({
		orientation: Gtk.Orientation.VERTICAL,
		spacing: 10,
		hexpand: true,
		vexpand: true,
		marginTop: 18,
		marginBottom: 18,
		marginStart: 24,
		marginEnd: 24,
	});
	root.append(toolsBox);
	root.append(operationBox);
	root.append(header);
	root.append(tableScroll);
	const view = new DictionaryPageView(
		root,
		searchEntry,
		addButton,
		entryList,
		operationBox,
		operationLabel,
		operationErrorIcon,
		operationSpinner,
	);
	view.state = state;
	return root;
}

function renderDictionaryList(
	list: InstanceType<typeof Gtk.ListBox>,
	state: DictionaryState,
	parent: InstanceType<typeof Gtk.Widget>,
): void {
	const editable = state.isEditable && !state.editorEntry;
	let child = list.getFirstChild();
	while (child) {
		const next = child.getNextSibling();
		list.remove(child);
		child = next;
	}
	if (state.visibleEntries.length === 0) {
		const emptyLabel = new Gtk.Label({
			label: state.phase === 'loading' ? '正在读取词典…' : '没有匹配的词条',
			xalign: 0,
			cssClasses: ['dim-label'],
			marginTop: 16,
			marginBottom: 16,
			marginStart: 16,
			marginEnd: 16,
		});
		list.append(
			new Gtk.ListBoxRow({ child: emptyLabel, activatable: false, selectable: false }),
		);
		return;
	}
	state.visibleEntries.forEach(({ entry, index }) => {
		const grid = createDictionaryRowGrid();
		const term = new Gtk.Label({
			label: entry.term,
			xalign: 0,
			ellipsize: Pango.EllipsizeMode.END,
			tooltipText: entry.term,
		});
		const aliasesText = entry.aliases.join('、') || '—';
		const aliases = new Gtk.Label({
			label: aliasesText,
			xalign: 0,
			hexpand: true,
			ellipsize: Pango.EllipsizeMode.END,
			tooltipText: aliasesText,
		});
		const protect = new Gtk.Image({
			iconName: entry.protect ? 'object-select-symbolic' : 'action-unavailable-symbolic',
			tooltipText: entry.protect ? 'AI 必须保护' : 'AI 无需保护',
		});
		const boost = new Gtk.Label({ label: String(entry.boost), xalign: 0 });
		const edit = new Gtk.Button({
			iconName: 'document-edit-symbolic',
			valign: Gtk.Align.CENTER,
			sensitive: editable,
			cssClasses: ['flat'],
			tooltipText: `编辑“${entry.term}”`,
		});
		const remove = new Gtk.Button({
			iconName: 'edit-delete-symbolic',
			valign: Gtk.Align.CENTER,
			sensitive: editable,
			cssClasses: ['flat'],
			tooltipText: `删除“${entry.term}”`,
		});
		const actions = new Gtk.Box({
			orientation: Gtk.Orientation.HORIZONTAL,
			halign: Gtk.Align.END,
			opacity: 0,
		});
		actions.append(edit);
		actions.append(remove);
		edit.on('clicked', () => showEntryDialog(parent, state, index));
		remove.on('clicked', () => confirmEntryDeletion(parent, state, index, entry.term));
		attachDictionaryCell(grid, term, 0, 3);
		attachDictionaryCell(grid, aliases, 3, 7);
		attachDictionaryCell(grid, protect, 10, 1);
		attachDictionaryCell(grid, boost, 11, 1);
		attachDictionaryCell(grid, actions, 12, 2);
		if (!entry.enabled) {
			term.addCssClass('dim-label');
			aliases.addCssClass('dim-label');
			boost.addCssClass('dim-label');
			protect.opacity = 0.55;
		}
		const row = new Gtk.ListBoxRow({
			child: grid,
			activatable: false,
			selectable: false,
		});
		let hovered = false;
		let focused = false;
		const updateActions = (): void => {
			actions.opacity = hovered || focused ? 1 : 0;
		};
		const motionController = new Gtk.EventControllerMotion();
		motionController.on('enter', () => {
			hovered = true;
			updateActions();
		});
		motionController.on('leave', () => {
			hovered = false;
			updateActions();
		});
		const focusController = new Gtk.EventControllerFocus();
		focusController.on('enter', () => {
			focused = true;
			updateActions();
		});
		focusController.on('leave', () => {
			focused = false;
			updateActions();
		});
		row.addController(motionController);
		row.addController(focusController);
		list.append(row);
	});
}

function createDictionaryRowGrid(): InstanceType<typeof Gtk.Grid> {
	return new Gtk.Grid({
		columnHomogeneous: true,
		columnSpacing: 12,
		marginTop: 6,
		marginBottom: 6,
		marginStart: 12,
		marginEnd: 12,
		hexpand: true,
	});
}

function attachDictionaryCell(
	grid: InstanceType<typeof Gtk.Grid>,
	child: InstanceType<typeof Gtk.Widget>,
	column: number,
	width: number,
): void {
	grid.attach(child, column, 0, width, 1);
}

function confirmEntryDeletion(
	parent: InstanceType<typeof Gtk.Widget>,
	state: DictionaryState,
	index: number,
	term: string,
): void {
	const confirmation = new Adw.AlertDialog({
		heading: `删除“${term}”？`,
		body: '删除后会立即应用。',
		closeResponse: 'cancel',
		defaultResponse: 'cancel',
	});
	confirmation.addResponse('cancel', '取消');
	confirmation.addResponse('delete', '删除');
	confirmation.setResponseAppearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);
	confirmation.choose(parent, null, (_source, result) => {
		if (confirmation.chooseFinish(result) !== 'delete') return;
		void state.deleteEntry(index);
	});
}

function showEntryDialog(
	parent: InstanceType<typeof Gtk.Widget>,
	state: DictionaryState,
	index?: number,
): void {
	if (index === undefined) state.openNewEntry();
	else state.openEntry(index);
	const entry = state.editorEntry;
	if (!entry) return;

	const termRow = createFormEntryRow('标准写法');
	termRow.text = entry.term;
	const aliasesBuffer = new Gtk.TextBuffer({ text: entry.aliases.join('\n') });
	const aliasesView = new Gtk.TextView({
		buffer: aliasesBuffer,
		wrapMode: Gtk.WrapMode.WORD_CHAR,
		topMargin: 10,
		bottomMargin: 10,
		leftMargin: 10,
		rightMargin: 10,
	});
	const aliasesScroll = new Gtk.ScrolledWindow({
		child: aliasesView,
		heightRequest: 120,
		hscrollbarPolicy: Gtk.PolicyType.NEVER,
		vscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
	});
	const aliasesTitleRow = new Adw.ActionRow({
		title: '识别别名',
		subtitle: '每行填写一个可能的识别结果。',
	});
	const aliasesEditorRow = new Adw.PreferencesRow({ child: aliasesScroll, activatable: false });
	const enabledRow = new Adw.SwitchRow({ title: '启用词条', active: entry.enabled });
	const protectRow = new Adw.SwitchRow({
		title: 'AI 必须保护',
		subtitle: '润色结果删除该标准词时回退到识别结果。',
		active: entry.protect,
	});
	const boostRow = new Adw.SpinRow({
		title: '热词权重',
		adjustment: new Gtk.Adjustment({
			lower: 1,
			upper: 10,
			stepIncrement: 1,
			pageIncrement: 1,
			value: entry.boost,
		}),
		digits: 0,
		numeric: true,
	});
	const editorGroup = new Adw.PreferencesGroup();
	editorGroup.add(termRow);
	editorGroup.add(aliasesTitleRow);
	editorGroup.add(aliasesEditorRow);
	editorGroup.add(enabledRow);
	editorGroup.add(protectRow);
	editorGroup.add(boostRow);

	const errorIcon = new Gtk.Image({ iconName: 'dialog-error-symbolic', cssClasses: ['error'] });
	const errorRow = new Adw.ActionRow({ title: '无法应用', subtitle: '', visible: false });
	errorRow.addPrefix(errorIcon);
	const errorGroup = new Adw.PreferencesGroup();
	errorGroup.add(errorRow);

	const page = new Adw.PreferencesPage();
	page.add(editorGroup);
	page.add(errorGroup);
	const cancelButton = new Gtk.Button({ label: '取消' });
	const applyButton = new Gtk.Button({
		label: index === undefined ? '添加' : '完成',
		cssClasses: ['suggested-action'],
	});
	const title = index === undefined ? '添加词条' : '编辑词条';
	const header = new Adw.HeaderBar({ titleWidget: new Adw.WindowTitle({ title, subtitle: '' }) });
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
	actionBox.append(applyButton);
	const toolbar = new Adw.ToolbarView({ content: page });
	toolbar.addTopBar(header);
	toolbar.addBottomBar(actionBox);
	const dialog = new Adw.Dialog({
		title,
		child: toolbar,
		contentWidth: 560,
		contentHeight: 520,
		defaultWidget: applyButton,
		focusWidget: termRow,
	});
	const setBusy = (busy: boolean): void => {
		dialog.canClose = !busy;
		cancelButton.sensitive = !busy;
		applyButton.sensitive = !busy;
	};
	const showError = (): void => {
		errorRow.subtitle = state.editorError || state.operationDescription;
		errorRow.visible = true;
	};
	const apply = async (): Promise<void> => {
		const candidate: VoiceDictionaryEntry = {
			term: termRow.text,
			aliases: aliasesBuffer.text.split('\n'),
			enabled: enabledRow.active,
			protect: protectRow.active,
			boost: Math.round(boostRow.value),
		};
		state.updateEditor(candidate);
		setBusy(true);
		const saved = await state.saveEditor();
		setBusy(false);
		if (saved) dialog.close();
		else showError();
	};
	cancelButton.on('clicked', () => dialog.close());
	applyButton.on('clicked', () => void apply());
	dialog.on('closed', () => state.closeEditor());

	dialog.present(parent);
}
