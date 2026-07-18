import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TsCheckerRspackPlugin } from 'ts-checker-rspack-plugin';

const directory = path.dirname(fileURLToPath(import.meta.url));

export default {
	context: directory,
	entry: './src/index.ts',
	target: 'node',
	mode: 'development',
	devtool: 'source-map',
	externalsPresets: { node: true },
	externals: {
		'node-gtk': 'commonjs node-gtk',
	},
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
									decorators: true,
								},
								target: 'es2024',
								transform: {
									legacyDecorator: true,
								},
							},
						},
					},
				],
			},
		],
	},
	resolve: {
		extensions: ['.ts', '.js'],
	},
	plugins: [
		new TsCheckerRspackPlugin({
			typescript: {
				configFile: path.join(directory, 'tsconfig.json'),
			},
		}),
	],
	output: {
		path: path.join(directory, 'dist'),
		filename: 'index.cjs',
		clean: true,
		library: {
			type: 'commonjs2',
		},
	},
};
