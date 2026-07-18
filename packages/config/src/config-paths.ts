import path from 'node:path';

/** 表示 VoxSpell 在当前用户目录中的持久化配置路径。 */
export interface VoxSpellConfigPaths {
	readonly directory: string;
	readonly configFile: string;
	readonly credentialsFile: string;
}

/** 按 XDG 约定解析主配置和凭据文件路径。 */
export function resolveVoxSpellConfigPaths(
	environment: NodeJS.ProcessEnv,
	userHome: string,
): VoxSpellConfigPaths {
	const configHome = environment.XDG_CONFIG_HOME || path.join(userHome, '.config');
	const directory = path.join(configHome, 'voxspell');
	return {
		directory,
		configFile: environment.VOXSPELL_CONFIG_PATH || path.join(directory, 'config.yaml'),
		credentialsFile: path.join(directory, 'credentials.json'),
	};
}
