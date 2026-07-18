import { DaemonState } from './state/daemon-state';
import { ConfigState } from './state/config-state';
import { action, state, value } from './state/index';

import type { PageId } from './pages/page-definition';
import type { DaemonClient } from './state/daemon-state';
import type { ConfigClient } from './state/config-state';

export interface DesktopClient extends DaemonClient, ConfigClient {}

/** 桌面配置应用的顶层界面状态。 */
@state
export class DesktopState {
	readonly daemon: DaemonState;
	readonly config: ConfigState;
	@value currentPage: PageId = 'overview';

	constructor(client: DesktopClient) {
		this.daemon = new DaemonState(client);
		this.config = new ConfigState(client, this.daemon);
	}

	/** 启动需要随窗口存活的后台连接。 */
	start(): void {
		this.daemon.start();
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
