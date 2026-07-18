import { Adw } from '../gtk';
import desktopPackage from '../../package.json';

/** 创建产品、作者与许可信息页面。 */
export function createAboutPage(): InstanceType<typeof Adw.StatusPage> {
	const authorRow = new Adw.ActionRow({ title: '作者', subtitle: 'Geequlim' });
	const versionRow = new Adw.ActionRow({ title: '版本', subtitle: desktopPackage.version });
	const projectRow = new Adw.ActionRow({ title: '项目性质', subtitle: '源码公开项目' });
	const licenseRow = new Adw.ActionRow({
		title: '软件许可',
		subtitle: 'PolyForm Noncommercial 1.0.0（禁止商业使用）',
	});
	const informationGroup = new Adw.PreferencesGroup({ title: '项目信息' });
	informationGroup.add(versionRow);
	informationGroup.add(authorRow);
	informationGroup.add(projectRow);
	informationGroup.add(licenseRow);
	const informationClamp = new Adw.Clamp({
		child: informationGroup,
		maximumSize: 600,
		tighteningThreshold: 400,
	});

	return new Adw.StatusPage({
		iconName: 'io.github.geequlim.VoxSpell',
		title: '言出法随',
		description: 'VoxSpell',
		child: informationClamp,
	});
}
