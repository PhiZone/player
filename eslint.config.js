import typescriptEslint from '@typescript-eslint/eslint-plugin';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import parser from 'svelte-eslint-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [
  {
    ignores: [
      '**/*.cjs',
      '**/.DS_Store',
      '**/node_modules',
      'android/app/build',
      'android/app/debug',
      'android/app/release',
      'android/app/src/androidTest',
      'android/app/src/main/assets',
      'android/app/src/main/res',
      'android/build',
      'ios/App/App/public',
      'ios/App/App/capacitor.config.json',
      'ios/App/App/config.xml',
      'ios/App/Podfile.lock',
      '**/capacitor-*-plugins',
      'static',
      'build',
      'src-tauri/target',
      'src-tauri/gen/schemas',
      '.svelte-kit',
      '**/.env',
      '**/.env.*',
      '!**/.env.example',
      '**/pnpm-lock.yaml',
      '**/package-lock.json',
      '**/yarn.lock',
      '**/.yarn',
    ],
  },
  ...compat.extends(
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:svelte/recommended',
    'plugin:prettier/recommended',
  ),
  {
    plugins: {
      '@typescript-eslint': typescriptEslint,
    },

    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        NodeJS: true,
      },
      parser: tsParser,
      ecmaVersion: 2020,
      sourceType: 'module',
      parserOptions: {
        extraFileExtensions: ['.svelte'],
      },
    },

    rules: {
      semi: ['error', 'always'],
      quotes: [
        'error',
        'single',
        {
          avoidEscape: true,
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^(\\$\\$|_)',
        },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'svelte/no-at-html-tags': 'off',
    },
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: parser,
      ecmaVersion: 5,
      sourceType: 'script',
      parserOptions: {
        parser: '@typescript-eslint/parser',
      },
    },
  },
];
