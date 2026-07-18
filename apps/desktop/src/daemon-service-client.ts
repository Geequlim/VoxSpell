import { spawn } from 'node:child_process';

const DAEMON_SERVICE_NAME = 'voxspell.service';

export interface DaemonServiceStatus {
	readonly enabled: boolean;
	readonly running: boolean;
}

export interface DaemonServiceClient {
	getStatus(): Promise<DaemonServiceStatus>;
	start(): Promise<void>;
	restart(): Promise<void>;
	setEnabled(enabled: boolean): Promise<void>;
}

interface SystemCommandResult {
	readonly exitCode: number;
	readonly stderr: string;
	readonly stdout: string;
}

type SystemCommandRunner = (
	command: string,
	arguments_: readonly string[],
) => Promise<SystemCommandResult>;

/** 通过 systemd 用户服务管理 VoxSpell daemon。 */
export class SystemdDaemonServiceClient implements DaemonServiceClient {
	readonly #runCommand: SystemCommandRunner;

	constructor(runCommand: SystemCommandRunner = runSystemCommand) {
		this.#runCommand = runCommand;
	}

	/** 读取 daemon 当前运行状态与开机启动设置。 */
	async getStatus(): Promise<DaemonServiceStatus> {
		const output = await this.#runSystemctl([
			'show',
			DAEMON_SERVICE_NAME,
			'--property=ActiveState',
			'--property=UnitFileState',
		]);
		const properties = new Map<string, string>();
		output.split('\n').forEach((line) => {
			const separatorIndex = line.indexOf('=');
			if (separatorIndex < 1) return;
			properties.set(line.slice(0, separatorIndex), line.slice(separatorIndex + 1));
		});
		const activeState = properties.get('ActiveState');
		const unitFileState = properties.get('UnitFileState');
		if (!activeState || !unitFileState) throw new Error('systemd 返回的服务状态不完整。');
		return {
			enabled: unitFileState === 'enabled',
			running: activeState === 'active',
		};
	}

	/** 启动 daemon 服务。 */
	async start(): Promise<void> {
		await this.#reloadAndRun('start');
	}

	/** 重启 daemon 服务。 */
	async restart(): Promise<void> {
		await this.#reloadAndRun('restart');
	}

	/** 设置 daemon 是否开机启动，不改变当前运行状态。 */
	async setEnabled(enabled: boolean): Promise<void> {
		await this.#runSystemctl([enabled ? 'enable' : 'disable', DAEMON_SERVICE_NAME]);
	}

	async #reloadAndRun(action: 'restart' | 'start'): Promise<void> {
		await this.#runSystemctl(['daemon-reload']);
		await this.#runSystemctl([action, DAEMON_SERVICE_NAME]);
	}

	async #runSystemctl(arguments_: readonly string[]): Promise<string> {
		const result = await this.#runCommand('systemctl', ['--user', ...arguments_]);
		if (result.exitCode === 0) return result.stdout;
		const detail = result.stderr.trim() || result.stdout.trim();
		if (detail) throw new Error(`systemctl 操作失败：${detail}`);
		throw new Error(`systemctl 操作失败，退出码 ${result.exitCode}。`);
	}
}

function runSystemCommand(
	command: string,
	arguments_: readonly string[],
): Promise<SystemCommandResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, arguments_, { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk: string) => {
			stderr += chunk;
		});
		child.once('error', reject);
		child.once('close', (exitCode) => resolve({ exitCode: exitCode ?? -1, stderr, stdout }));
	});
}
