import { Adw, Gtk } from '../gtk';
import { gtk } from '../state/gtk';
import { createFormEntryRow, createFormPasswordEntryRow } from './form-row';

import type { ConfigState } from '../state/config-state';

const bind = gtk<ConfigState, AiPolishingPageView>();

@bind.view
class AiPolishingPageView {
	declare state?: ConfigState;
	private $updatingPrompt = false;

	@bind.disposeOnDestroy readonly root: InstanceType<typeof Adw.PreferencesPage>;
	@bind.prop('active', (state) => state.polishingEnabled)
	@bind.prop('title', (state) => getFieldTitle('启用 AI 润色', state.fieldErrors.textPolisher))
	@bind.listen<InstanceType<typeof Adw.SwitchRow>>('notify::active', (state, row) =>
		state.updatePolishingEnabled(row.active),
	)
	@bind.sensitive((state) => state.isEditable)
	readonly enabledRow: InstanceType<typeof Adw.SwitchRow>;
	@bind.prop('value', (state) => state.polishingMinimumEffectiveCharacters)
	@bind.listen<InstanceType<typeof Adw.SpinRow>>('notify::value', (state, row) =>
		state.updatePolishingMinimumEffectiveCharacters(Math.round(row.value)),
	)
	@bind.sensitive((state) => state.isEditable)
	readonly minimumCharactersRow: InstanceType<typeof Adw.SpinRow>;
	@bind.prop('text', (state) => state.polishingBaseUrl)
	@bind.prop('title', (state) => getFieldTitle('API 地址', state.fieldErrors.polishingBaseUrl))
	@bind.listen<InstanceType<typeof Adw.EntryRow>>('changed', (state, row) =>
		state.updatePolishingBaseUrl(row.text),
	)
	@bind.sensitive((state) => state.isEditable)
	readonly baseUrlRow: InstanceType<typeof Adw.EntryRow>;
	@bind.prop('text', (state) => state.polishingModel)
	@bind.prop('title', (state) => getFieldTitle('模型', state.fieldErrors.polishingModel))
	@bind.listen<InstanceType<typeof Adw.EntryRow>>('changed', (state, row) =>
		state.updatePolishingModel(row.text),
	)
	@bind.sensitive((state) => state.isEditable)
	readonly modelRow: InstanceType<typeof Adw.EntryRow>;
	@bind.prop('text', (state) => state.polishingApiKeyEnvironment)
	@bind.prop('title', (state) =>
		getFieldTitle('凭据名称', state.fieldErrors.polishingApiKeyEnvironment),
	)
	@bind.listen<InstanceType<typeof Adw.EntryRow>>('changed', (state, row) =>
		state.updatePolishingApiKeyEnvironment(row.text),
	)
	@bind.sensitive((state) => state.isEditable)
	readonly apiKeyEnvironmentRow: InstanceType<typeof Adw.EntryRow>;
	@bind.prop('text', (state) => state.polishingCredentialValue)
	@bind.listen<InstanceType<typeof Adw.PasswordEntryRow>>('changed', (state, row) =>
		state.updatePolishingCredential(row.text),
	)
	@bind.listen<InstanceType<typeof Adw.PasswordEntryRow>>('entry-activated', (state) =>
		state.commitPolishingCredential(),
	)
	@bind.sensitive((state) => state.isEditable)
	readonly credentialRow: InstanceType<typeof Adw.PasswordEntryRow>;
	@bind.listen<InstanceType<typeof Gtk.EventControllerFocus>>('leave', (state) =>
		state.commitPolishingCredential(),
	)
	readonly credentialFocusController: InstanceType<typeof Gtk.EventControllerFocus>;
	@bind.prop('subtitle', (state) => state.polishingCredentialStatus)
	readonly credentialStatusRow: InstanceType<typeof Adw.ActionRow>;
	@bind.render<InstanceType<typeof Gtk.TextBuffer>>((state, buffer, self) => {
		if (buffer.text === state.polishingSystemPrompt) return;
		self.$updatingPrompt = true;
		buffer.text = state.polishingSystemPrompt;
		self.$updatingPrompt = false;
	})
	@bind.listen<InstanceType<typeof Gtk.TextBuffer>>('changed', (state, buffer, self) => {
		if (!self.$updatingPrompt) state.updatePolishingSystemPrompt(buffer.text);
	})
	readonly promptBuffer: InstanceType<typeof Gtk.TextBuffer>;
	@bind.prop('title', (state) =>
		getFieldTitle('系统提示词', state.fieldErrors.polishingSystemPrompt),
	)
	readonly promptActionRow: InstanceType<typeof Adw.ActionRow>;
	@bind.sensitive((state) => state.isEditable)
	@bind.click((state) => state.resetPolishingSystemPrompt())
	readonly resetPromptButton: InstanceType<typeof Gtk.Button>;
	@bind.prop('subtitle', (state) => state.operationDescription)
	@bind.prop('title', (state) => state.operationTitle)
	readonly operationRow: InstanceType<typeof Adw.ActionRow>;
	@bind.visible((state) => state.phase === 'error')
	readonly operationErrorIcon: InstanceType<typeof Gtk.Image>;
	@bind.visible((state) => Boolean(state.operationDescription))
	readonly actionGroup: InstanceType<typeof Adw.PreferencesGroup>;

	constructor(
		root: InstanceType<typeof Adw.PreferencesPage>,
		enabledRow: InstanceType<typeof Adw.SwitchRow>,
		minimumCharactersRow: InstanceType<typeof Adw.SpinRow>,
		baseUrlRow: InstanceType<typeof Adw.EntryRow>,
		modelRow: InstanceType<typeof Adw.EntryRow>,
		apiKeyEnvironmentRow: InstanceType<typeof Adw.EntryRow>,
		credentialRow: InstanceType<typeof Adw.PasswordEntryRow>,
		credentialFocusController: InstanceType<typeof Gtk.EventControllerFocus>,
		credentialStatusRow: InstanceType<typeof Adw.ActionRow>,
		promptBuffer: InstanceType<typeof Gtk.TextBuffer>,
		promptActionRow: InstanceType<typeof Adw.ActionRow>,
		resetPromptButton: InstanceType<typeof Gtk.Button>,
		operationRow: InstanceType<typeof Adw.ActionRow>,
		operationErrorIcon: InstanceType<typeof Gtk.Image>,
		actionGroup: InstanceType<typeof Adw.PreferencesGroup>,
	) {
		this.root = root;
		this.enabledRow = enabledRow;
		this.minimumCharactersRow = minimumCharactersRow;
		this.baseUrlRow = baseUrlRow;
		this.modelRow = modelRow;
		this.apiKeyEnvironmentRow = apiKeyEnvironmentRow;
		this.credentialRow = credentialRow;
		this.credentialFocusController = credentialFocusController;
		this.credentialStatusRow = credentialStatusRow;
		this.promptBuffer = promptBuffer;
		this.promptActionRow = promptActionRow;
		this.resetPromptButton = resetPromptButton;
		this.operationRow = operationRow;
		this.operationErrorIcon = operationErrorIcon;
		this.actionGroup = actionGroup;
	}
}

/** 创建 AI 润色配置页面。 */
export function createAiPolishingPage(
	state: ConfigState,
): InstanceType<typeof Adw.PreferencesPage> {
	const enabledRow = new Adw.SwitchRow({
		title: '默认启用 AI 润色',
		subtitle: '识别完成后生成一份可回退的流式润色结果。',
	});
	const minimumCharactersRow = new Adw.SpinRow({
		title: '最少润色字符数',
		subtitle: '少于该数量时自动跳过；0 表示不限制。',
		adjustment: new Gtk.Adjustment({
			lower: 0,
			upper: 200,
			stepIncrement: 1,
			pageIncrement: 10,
			value: 0,
		}),
		digits: 0,
		numeric: true,
	});
	const baseUrlRow = createFormEntryRow('API 地址');
	const modelRow = createFormEntryRow('模型');
	const apiKeyEnvironmentRow = createFormEntryRow('凭据名称');
	const providerGroup = new Adw.PreferencesGroup({
		title: 'AI 润色服务',
		description: '首期使用 OpenAI-compatible Chat Completions 流式接口。',
	});
	providerGroup.add(enabledRow);
	providerGroup.add(minimumCharactersRow);
	providerGroup.add(baseUrlRow);
	providerGroup.add(modelRow);
	providerGroup.add(apiKeyEnvironmentRow);

	const credentialRow = createFormPasswordEntryRow('更新凭据');
	const credentialFocusController = new Gtk.EventControllerFocus();
	credentialRow.addController(credentialFocusController);
	const credentialStatusRow = new Adw.ActionRow({ title: '凭据状态', subtitle: '' });
	const credentialGroup = new Adw.PreferencesGroup({
		title: '凭据',
		description: '已保存的凭据不会回显；留空表示不修改。',
	});
	credentialGroup.add(credentialRow);
	credentialGroup.add(credentialStatusRow);

	const promptBuffer = new Gtk.TextBuffer();
	const promptView = new Gtk.TextView({
		buffer: promptBuffer,
		cssClasses: ['inline'],
		wrapMode: Gtk.WrapMode.WORD_CHAR,
		topMargin: 12,
		bottomMargin: 12,
		leftMargin: 12,
		rightMargin: 12,
	});
	const promptScroll = new Gtk.ScrolledWindow({
		child: promptView,
		heightRequest: 220,
		hscrollbarPolicy: Gtk.PolicyType.NEVER,
		vscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
	});
	const promptEditorRow = new Adw.PreferencesRow({
		child: promptScroll,
		activatable: false,
		selectable: false,
	});
	const resetPromptButton = new Gtk.Button({
		label: '恢复默认',
		valign: Gtk.Align.CENTER,
	});
	const promptActionRow = new Adw.ActionRow({
		title: '系统提示词',
		subtitle: '用户词典由程序自动追加，不需要插入占位符。',
	});
	promptActionRow.addSuffix(resetPromptButton);
	const promptGroup = new Adw.PreferencesGroup({
		title: '润色规则',
		description: '识别结果会原样作为 user 消息发送，模型应只返回润色后的正文。',
	});
	promptGroup.add(promptActionRow);
	promptGroup.add(promptEditorRow);

	const operationErrorIcon = new Gtk.Image({
		iconName: 'dialog-error-symbolic',
		cssClasses: ['error'],
	});
	const operationRow = new Adw.ActionRow({ title: '自动保存', subtitle: '' });
	operationRow.addPrefix(operationErrorIcon);
	const actionGroup = new Adw.PreferencesGroup();
	actionGroup.add(operationRow);

	const root = new Adw.PreferencesPage({ title: 'AI 润色' });
	root.add(providerGroup);
	root.add(credentialGroup);
	root.add(promptGroup);
	root.add(actionGroup);
	const view = new AiPolishingPageView(
		root,
		enabledRow,
		minimumCharactersRow,
		baseUrlRow,
		modelRow,
		apiKeyEnvironmentRow,
		credentialRow,
		credentialFocusController,
		credentialStatusRow,
		promptBuffer,
		promptActionRow,
		resetPromptButton,
		operationRow,
		operationErrorIcon,
		actionGroup,
	);
	view.state = state;
	return root;
}

function getFieldTitle(title: string, error?: string): string {
	return error ? `${title} · ${error}` : title;
}
