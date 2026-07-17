import { defineConfig, type OxlintConfig } from 'oxlint';

const warn = 'warn';
const error = 'error';
const off = 'off';

const rules: NonNullable<OxlintConfig['rules']> = {
	'no-constant-condition': off,
	'no-useless-escape': off,
	'no-ex-assign': warn,
	'consistent-return': error,
	'no-else-return': warn,
	'no-var': warn,
	'prefer-const': [warn, { destructuring: 'all' }],
	'prefer-template': warn,
	'no-useless-return': warn,
	'no-debugger': warn,
	'no-prototype-builtins': off,
	'no-loss-of-precision': warn,
	'no-constant-binary-expression': warn,
	'prefer-rest-params': warn,
	'@typescript-eslint/no-require-imports': off,
	'@typescript-eslint/no-unused-expressions': off,
	'@typescript-eslint/no-unused-vars': [
		warn,
		{
			args: 'none',
			argsIgnorePattern: '.*',
			vars: 'all',
			ignoreRestSiblings: true,
			caughtErrors: 'none',
		},
	],
	'@typescript-eslint/no-explicit-any': [warn, { ignoreRestArgs: true }],
	'@typescript-eslint/class-literal-property-style': off,
	'@typescript-eslint/no-empty-function': off,
	'@typescript-eslint/no-inferrable-types': warn,
	'@typescript-eslint/consistent-indexed-object-style': warn,
	'@typescript-eslint/no-empty-object-type': warn,
	'@typescript-eslint/prefer-for-of': off,
	'@typescript-eslint/no-this-alias': warn,
	'@typescript-eslint/ban-ts-comment': off,
	'@typescript-eslint/consistent-type-definitions': off,
	'@typescript-eslint/no-namespace': off,
	'@typescript-eslint/consistent-type-imports': [
		error,
		{
			prefer: 'type-imports',
			fixStyle: 'separate-type-imports',
			disallowTypeAnnotations: false,
		},
	],
	'typescript/consistent-type-exports': error,
	'@typescript-eslint/no-import-type-side-effects': error,
};

export default defineConfig({
	options: {
		typeAware: true,
	},
	plugins: ['eslint', 'oxc', 'typescript', 'import', 'unicorn', 'jsdoc', 'node', 'promise'],
	categories: {
		correctness: off,
		suspicious: off,
		pedantic: off,
		perf: off,
		style: off,
		restriction: off,
		nursery: off,
	},
	ignorePatterns: ['node_modules/', 'dist/', '**/*.d.ts'],
	rules,
});
