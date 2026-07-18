import { Gtk } from '../gtk';

/** 创建尚未实现业务内容的页面占位容器。 */
export function createPlaceholderPage(): InstanceType<typeof Gtk.Box> {
	return new Gtk.Box({
		orientation: Gtk.Orientation.VERTICAL,
		vexpand: true,
	});
}
