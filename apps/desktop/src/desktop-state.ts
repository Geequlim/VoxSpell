import { DaemonState } from './state/daemon-state';
import { action, state, value } from './state/index';

import type { PageId } from './pages/page-definition';
import type { DaemonClient } from './state/daemon-state';

/** 桌面配置应用的顶层界面状态。 */
@state
export class DesktopState {
	readonly daemon: DaemonState;
	@value currentPage: PageId = 'overview';

	constructor(client: DaemonClient) {
		this.daemon = new DaemonState(client);
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
		this.daemon.dispose();
	}
}
