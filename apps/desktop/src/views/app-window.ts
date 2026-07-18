import type { DesktopState } from '../desktop-state';
import { Adw, Gtk } from '../gtk';
import { createAboutPage } from '../pages/about-page';
import { createAiPolishingPage } from '../pages/ai-polishing-page';
import { createDiagnosticsPage } from '../pages/diagnostics-page';
import { createInputBehaviorPage } from '../pages/input-behavior-page';
import { createDictionaryPage } from '../pages/dictionary-page';
import { createOverviewPage } from '../pages/overview-page';
import { pageDefinitions } from '../pages/page-definition';
import { createRecognitionPage } from '../pages/recognition-page';
import { gtk } from '../state/gtk';

import type { PageId } from '../pages/page-definition';

const bind = gtk<DesktopState, AppWindowView>();

const createPage = {
	overview: (state: DesktopState) => createOverviewPage(state),
	recognition: (state: DesktopState) => createRecognitionPage(state.config),
	'input-behavior': (state: DesktopState) => createInputBehaviorPage(state.inputBehavior),
	dictionary: (state: DesktopState) => createDictionaryPage(state.dictionary),
	'ai-polishing': (state: DesktopState) => createAiPolishingPage(state.config),
	diagnostics: (state: DesktopState) => createDiagnosticsPage(state.daemon),
	about: () => createAboutPage(),
} satisfies Record<PageId, (state: DesktopState) => InstanceType<typeof Gtk.Widget>>;

@bind.view
class AppWindowView {
	declare state?: DesktopState;
	readonly pageByRow = new Map<InstanceType<typeof Gtk.ListBoxRow>, PageId>();

	@bind.disposeOnDestroy readonly window: InstanceType<typeof Adw.ApplicationWindow>;
	@bind.prop('visibleChildName', (state) => state.currentPage)
	readonly stack: InstanceType<typeof Adw.ViewStack>;
	@bind.prop(
		'title',
		(state) => pageDefinitions.find((page) => page.id === state.currentPage)?.title ?? '',
	)
	readonly contentTitle: InstanceType<typeof Adw.WindowTitle>;
	@bind.render<InstanceType<typeof Gtk.ListBox>>((state, list, self) => {
		const selectedRow = list.getSelectedRow();
		if (selectedRow && self.pageByRow.get(selectedRow) === state.currentPage) return;
		const target = [...self.pageByRow].find(([, page]) => page === state.currentPage)?.[0];
		if (target) list.selectRow(target);
	})
	@bind.listen<InstanceType<typeof Gtk.ListBox>>('row-selected', (state, list, self) => {
		const row = list.getSelectedRow();
		const page = row ? self.pageByRow.get(row) : undefined;
		if (page) state.selectPage(page);
	})
	readonly navigationList: InstanceType<typeof Gtk.ListBox>;

	constructor(
		window: InstanceType<typeof Adw.ApplicationWindow>,
		stack: InstanceType<typeof Adw.ViewStack>,
		contentTitle: InstanceType<typeof Adw.WindowTitle>,
		navigationList: InstanceType<typeof Gtk.ListBox>,
	) {
		this.window = window;
		this.stack = stack;
		this.contentTitle = contentTitle;
		this.navigationList = navigationList;
	}
}

/** 创建带固定侧栏导航的应用主窗口。 */
export function createAppWindow(
	application: InstanceType<typeof Adw.Application>,
	state: DesktopState,
): InstanceType<typeof Adw.ApplicationWindow> {
	const navigationList = new Gtk.ListBox({
		selectionMode: Gtk.SelectionMode.SINGLE,
		cssClasses: ['navigation-sidebar'],
	});
	const stack = new Adw.ViewStack({ vexpand: true, hexpand: true });
	const contentTitle = new Adw.WindowTitle({ title: '', subtitle: '' });
	const viewRows: Array<[InstanceType<typeof Gtk.ListBoxRow>, PageId]> = [];

	pageDefinitions.forEach((page) => {
		const row = new Adw.ActionRow({ title: page.title, activatable: true });
		row.addPrefix(new Gtk.Image({ iconName: page.iconName }));
		navigationList.append(row);
		viewRows.push([row, page.id]);
		stack.addNamed(createPage[page.id](state), page.id);
	});

	const sidebarToolbar = new Adw.ToolbarView({
		content: new Gtk.ScrolledWindow({ child: navigationList, vexpand: true }),
	});
	sidebarToolbar.addTopBar(
		new Adw.HeaderBar({
			titleWidget: new Adw.WindowTitle({ title: 'VoxSpell', subtitle: '语音输入配置' }),
		}),
	);
	const contentToolbar = new Adw.ToolbarView({ content: stack });
	contentToolbar.addTopBar(new Adw.HeaderBar({ titleWidget: contentTitle }));

	const splitView = new Adw.NavigationSplitView({
		sidebar: new Adw.NavigationPage({ child: sidebarToolbar, title: 'VoxSpell' }),
		content: new Adw.NavigationPage({ child: contentToolbar, title: '配置' }),
		showContent: true,
		minSidebarWidth: 220,
		maxSidebarWidth: 280,
	});
	const window = new Adw.ApplicationWindow({
		application,
		content: splitView,
		defaultWidth: 960,
		defaultHeight: 640,
		title: 'VoxSpell',
	});
	const view = new AppWindowView(window, stack, contentTitle, navigationList);
	viewRows.forEach(([row, page]) => view.pageByRow.set(row, page));
	view.state = state;
	navigationList.selectRow(viewRows[0]?.[0] ?? null);
	let closingAfterFlush = false;
	window.on('close-request', () => {
		if (closingAfterFlush) return false;
		void state
			.flushPendingChanges()
			.then(() => {
				if (state.config.isDirty || state.inputBehavior.isDirty) return;
				closingAfterFlush = true;
				window.close();
			})
			.catch(() => undefined);
		return true;
	});
	return window;
}
