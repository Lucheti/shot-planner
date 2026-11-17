import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const webBoundary = {
  patterns: [
    {
      group: ['**/agent/*', '**/providers/*', '**/generation/*', '**/server/*'],
      message: 'The web app may only depend on src/domain and src/protocol.',
    },
  ],
};

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        { accessibility: 'explicit', overrides: { constructors: 'no-public' } },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "ThrowStatement > NewExpression[callee.name='NotImplementedError']",
          message: 'Subclasses must be substitutable; do not throw NotImplemented.',
        },
      ],
    },
  },
  {
    files: ['src/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': ['error', webBoundary],
    },
  },
  {
    files: ['src/server/**/*.ts', 'src/agent/**/*.ts', 'src/providers/**/*.ts', 'src/generation/**/*.ts', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },
);
