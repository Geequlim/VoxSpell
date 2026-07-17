import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));

export default {
	context: directory,
	entry: "./src/index.ts",
	target: "node",
	mode: process.env.NODE_ENV === "development" ? "development" : "production",
	devtool: "source-map",
	externalsPresets: { node: true },
	module: {
		rules: [
			{
				test: /\.ts$/,
				exclude: /node_modules/,
				use: [
					{
						loader: "builtin:swc-loader",
						options: {
							jsc: {
								parser: {
									syntax: "typescript",
								},
								target: "es2024",
							},
						},
					},
				],
			},
		],
	},
	resolve: {
		extensions: [".ts", ".js"],
		extensionAlias: {
			".js": [".ts", ".js"],
		},
	},
	output: {
		path: path.join(directory, "dist"),
		filename: "index.cjs",
		clean: true,
		library: {
			type: "commonjs2",
		},
	},
};
