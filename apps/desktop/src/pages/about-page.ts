import { Adw } from '../gtk';

/** 创建产品、作者与许可信息页面。 */
export function createAboutPage(): InstanceType<typeof Adw.StatusPage> {
	const authorRow = new Adw.ActionRow({ title: '作者', subtitle: 'Geequlim' });
	const projectRow = new Adw.ActionRow({ title: '项目性质', subtitle: '源码公开项目' });
	const licenseRow = new Adw.ActionRow({
		title: '软件许可',
		subtitle: 'PolyForm Noncommercial 1.0.0（禁止商业使用）',
	});
	const informationGroup = new Adw.PreferencesGroup({ title: '项目信息' });
	informationGroup.add(authorRow);
	informationGroup.add(projectRow);
	informationGroup.add(licenseRow);

	return new Adw.StatusPage({
		iconName: 'io.github.geequlim.VoxSpell',
		title: '言出法随',
		description: 'VoxSpell',
		child: informationGroup,
	});
}
