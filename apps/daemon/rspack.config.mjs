import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NodemonPlugin from 'nodemon-webpack-plugin';
import { TsCheckerRspackPlugin } from 'ts-checker-rspack-plugin';

const directory = path.dirname(fileURLToPath(import.meta.url));

function parseEnvironmentValue(value) {
	if (value === 'true') return true;
	if (value === 'false') return false;
	return value;
}

function mergeEnvironment(target, chunk) {
	for (const pair of chunk.split(/[\s,]+(?=[^=\s,]+=)/).filter(Boolean)) {
		const [key, ...values] = pair.split('=');
		if (!key || values.length === 0) continue;
		target[key] = parseEnvironmentValue(values.join('='));
	}
}

function normalizeEnvironment(environment) {
	const normalized = {};

	if (typeof environment === 'string') {
		mergeEnvironment(normalized, environment);
	} else if (Array.isArray(environment)) {
		for (const chunk of environment) mergeEnvironment(normalized, chunk);
	} else if (environment) {
		Object.assign(normalized, environment);
	}

	for (const argument of process.argv.slice(2)) {
		if (argument.startsWith('-') || !argument.includes('=')) continue;
		mergeEnvironment(normalized, argument);
	}

	return normalized;
}

export default function createRspackConfig(environment = {}) {
	const normalizedEnvironment = normalizeEnvironment(environment);
	const watch = normalizedEnvironment.watch === true;
	const run = normalizedEnvironment.run === true;
	const debug = normalizedEnvironment.debug === true;
	const outputDirectory = path.join(directory, 'dist');
	const plugins = [
		new TsCheckerRspackPlugin({
			async: watch,
			typescript: {
				configFile: path.join(directory, 'tsconfig.json'),
			},
		}),
	];

	if (run) {
		plugins.push(
			new NodemonPlugin({
				cwd: directory,
				script: path.join(outputDirectory, 'index.cjs'),
				watch: path.join(outputDirectory, 'index.cjs'),
				ext: 'cjs',
				delay: '100',
				signal: 'SIGTERM',
				nodeArgs: debug ? ['--inspect=0'] : [],
			}),
		);
	}

	return {
		context: directory,
		entry: {
			index: './src/index.ts',
			'audio-smoke': './src/tools/audio-smoke.ts',
		},
		target: 'node',
		mode: debug ? 'development' : 'production',
		watch,
		devtool: 'source-map',
		externalsPresets: { node: true },
		module: {
			rules: [
				{
					test: /\.ts$/,
					exclude: /node_modules/,
					use: [
						{
							loader: 'builtin:swc-loader',
							options: {
								jsc: {
									parser: {
										syntax: 'typescript',
									},
									target: 'es2024',
								},
							},
						},
					],
				},
			],
		},
		resolve: {
			extensions: ['.ts', '.js'],
			extensionAlias: {
				'.js': ['.ts', '.js'],
			},
		},
		plugins,
		output: {
			path: outputDirectory,
			filename: '[name].cjs',
			clean: true,
			devtoolModuleFilenameTemplate: (info) =>
				path.resolve(directory, info.resourcePath).split(path.sep).join('/'),
			library: {
				type: 'commonjs2',
			},
		},
		watchOptions: {
			ignored: ['**/node_modules/**', '**/dist/**'],
		},
	};
}
