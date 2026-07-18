import { action, derived, state, value } from './state/index';

/** 桌面配置应用的顶层界面状态。 */
@state
export class DesktopState {
	@value private $ready = false;

	/** 概览页当前的主标题。 */
	@derived get statusTitle(): string {
		return this.$ready ? 'VoxSpell 已准备就绪' : '正在启动 VoxSpell';
	}

	/** 概览页当前的说明文本。 */
	@derived get statusDescription(): string {
		return this.$ready
			? 'GTK 配置应用已成功启动。Daemon 连接将在后续阶段接入。'
			: '正在初始化 GTK 界面。';
	}

	/** 标记桌面窗口已完成构建。 */
	@action markReady(): void {
		this.$ready = true;
	}
}
