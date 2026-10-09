const js = require('@eslint/js');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const prettier = require('eslint-config-prettier');

const SOURCE_FILES = ['server/src/**/*.ts', 'cli/src/**/*.ts'];

// Plain JS at the repo root (this config, config.js, scripts/) runs on Node
const NODE_GLOBALS = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  __dirname: 'readonly',
  __filename: 'readonly',
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
};

module.exports = [
  { ignores: ['dist/', 'node_modules/', 'coverage/', '__tests__/e2e/strapi-app/'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: NODE_GLOBALS },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: NODE_GLOBALS },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2020, sourceType: 'module' },
      globals: { strapi: 'readonly' },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      // TypeScript owns undefined-name and unused-symbol checks for .ts files
      ...tsPlugin.configs['eslint-recommended'].overrides[0].rules,
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'as' }],
    },
  },
  {
    // Plugin source must not paper over nullability; tests may reach into
    // fixtures with `!`
    files: SOURCE_FILES,
    rules: { '@typescript-eslint/no-non-null-assertion': 'error' },
  },
  prettier,
];
