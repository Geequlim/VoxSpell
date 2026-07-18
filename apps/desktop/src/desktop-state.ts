import { DaemonState } from './state/daemon-state';
import { DaemonServiceState } from './state/daemon-service-state';
import { ConfigState } from './state/config-state';
import { InputBehaviorState } from './state/input-behavior-state';
import { InputMethodDiagnosticsState } from './state/input-method-diagnostics-state';
import { DictionaryState } from './state/dictionary-state';
import { action, state, value } from './state/index';

import type { PageId } from './pages/page-definition';
import type { DaemonServiceClient } from './daemon-service-client';
import type { DaemonClient } from './state/daemon-state';
import type { ConfigClient } from './state/config-state';
import type { InputBehaviorClient } from './state/input-behavior-state';
import type { InputMethodDiagnosticsClient } from './state/input-method-diagnostics-state';
import type { DictionaryClient } from './state/dictionary-state';

export interface DesktopClient extends DaemonClient, ConfigClient, DictionaryClient {}

/** 桌面配置应用的顶层界面状态。 */
@state
export class DesktopState {
	readonly daemon: DaemonState;
	readonly daemonService: DaemonServiceState;
	readonly config: ConfigState;
	readonly inputBehavior: InputBehaviorState;
	readonly inputMethodDiagnostics: InputMethodDiagnosticsState;
	readonly dictionary: DictionaryState;
	@value currentPage: PageId = 'overview';

	constructor(
		client: DesktopClient,
		daemonServiceClient: DaemonServiceClient,
		inputBehaviorClient: InputBehaviorClient,
		inputMethodDiagnosticsClient: InputMethodDiagnosticsClient,
	) {
		this.daemon = new DaemonState(client);
		this.daemonService = new DaemonServiceState(daemonServiceClient);
		this.config = new ConfigState(client, this.daemon);
		this.inputBehavior = new InputBehaviorState(inputBehaviorClient);
		this.inputMethodDiagnostics = new InputMethodDiagnosticsState(inputMethodDiagnosticsClient);
		this.dictionary = new DictionaryState(client, this.daemon);
	}

	/** 启动需要随窗口存活的后台连接。 */
	start(): void {
		this.daemon.start();
		this.daemonService.start();
		this.inputBehavior.start();
		this.inputMethodDiagnostics.start();
	}

	/** 同时刷新 daemon、服务与桌面端输入法诊断。 */
	async refreshDiagnostics(): Promise<void> {
		await Promise.all([
			this.daemon.refresh(),
			this.daemonService.refresh(),
			this.inputMethodDiagnostics.refresh(),
		]);
	}

	/** 启动或重启 daemon，并在需要时立即重试 RPC 连接。 */
	async runDaemonServiceAction(): Promise<void> {
		const succeeded = await this.daemonService.runPrimaryAction();
		if (succeeded && this.daemon.connectionPhase !== 'connected') this.daemon.retry();
	}

	/** 切换主内容区页面。 */
	@action selectPage(page: PageId): void {
		void this.flushPendingChanges();
		this.currentPage = page;
	}

	/** 立即提交桌面端尚未触发的自动保存任务。 */
	async flushPendingChanges(): Promise<void> {
		await Promise.all([
			this.config.flushPendingChanges(),
			this.inputBehavior.flushPendingChanges(),
		]);
	}

	/** 释放窗口持有的全部后台资源。 */
	dispose(): void {
		this.config.dispose();
		this.inputBehavior.dispose();
		this.inputMethodDiagnostics.dispose();
		this.dictionary.dispose();
		this.daemonService.dispose();
		this.daemon.dispose();
	}
}
