import path from 'node:path';

/** 表示桌面端缺少连接 daemon 所需的运行环境。 */
export class DaemonSocketConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DaemonSocketConfigurationError';
	}
}

/** 根据 XDG 运行目录解析 daemon Unix Socket 路径。 */
export function resolveDaemonSocketPath(environment: NodeJS.ProcessEnv = process.env): string {
	const runtimeDirectory = environment.XDG_RUNTIME_DIR;
	if (!runtimeDirectory) {
		throw new DaemonSocketConfigurationError('XDG_RUNTIME_DIR is required');
	}
	return path.join(runtimeDirectory, 'voxspell', 'daemon.sock');
}
