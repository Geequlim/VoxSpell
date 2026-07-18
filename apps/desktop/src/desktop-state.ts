import { DaemonState } from './state/daemon-state';
import { ConfigState } from './state/config-state';
import { InputBehaviorState } from './state/input-behavior-state';
import { action, state, value } from './state/index';

import type { PageId } from './pages/page-definition';
import type { DaemonClient } from './state/daemon-state';
import type { ConfigClient } from './state/config-state';
import type { InputBehaviorClient } from './state/input-behavior-state';

export interface DesktopClient extends DaemonClient, ConfigClient {}

/** 桌面配置应用的顶层界面状态。 */
@state
export class DesktopState {
	readonly daemon: DaemonState;
	readonly config: ConfigState;
	readonly inputBehavior: InputBehaviorState;
	@value currentPage: PageId = 'overview';

	constructor(client: DesktopClient, inputBehaviorClient: InputBehaviorClient) {
		this.daemon = new DaemonState(client);
		this.config = new ConfigState(client, this.daemon);
		this.inputBehavior = new InputBehaviorState(inputBehaviorClient);
	}

	/** 启动需要随窗口存活的后台连接。 */
	start(): void {
		this.daemon.start();
		this.inputBehavior.start();
	}

	/** 切换主内容区页面。 */
	@action selectPage(page: PageId): void {
		this.currentPage = page;
	}

	/** 释放窗口持有的全部后台资源。 */
	dispose(): void {
		this.config.dispose();
		this.daemon.dispose();
	}
}
