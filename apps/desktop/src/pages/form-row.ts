import type { Gtk } from '../gtk';
import { Adw } from '../gtk';

/** 创建保留原生紧凑布局但不显示编辑提示图标的输入行。 */
export function createFormEntryRow(title: string): InstanceType<typeof Adw.EntryRow> {
	const row = new Adw.EntryRow({ title });
	hideEditIcon(row);
	return row;
}

/** 创建仅保留密码可见性操作的紧凑密码输入行。 */
export function createFormPasswordEntryRow(
	title: string,
): InstanceType<typeof Adw.PasswordEntryRow> {
	const row = new Adw.PasswordEntryRow({ title });
	hideEditIcon(row);
	return row;
}

function hideEditIcon(widget: InstanceType<typeof Gtk.Widget>): void {
	if (widget.hasCssClass('edit-icon')) {
		widget.visible = false;
		return;
	}

	let child = widget.getFirstChild();
	while (child) {
		hideEditIcon(child);
		child = child.getNextSibling();
	}
}
