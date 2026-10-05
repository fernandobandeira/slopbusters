import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import hooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.data', '.reference'] },
  js.configs.recommended,
  { files: ['**/*.{js,cjs,mjs}'], languageOptions: { globals: globals.node } },
  ...tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: ['**/*.{ts,tsx}'] })),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { 'react-hooks': hooks },
    rules: {
      ...hooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
      complexity: ['error', 15],
      'max-depth': ['error', 3],
      'max-params': ['error', 4],
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/vendor/t3/**'],
              message: 'Import vendor components through the ~ alias.',
            },
          ],
        },
      ],
    },
  },
)
