import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'scripts/geodata/.venv'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The simulation is pure TypeScript: no renderer, no UI, no store, no DOM, no wall clock,
    // no unseeded randomness. tests/lint/boundary.test.ts proves these rules fire.
    files: ['src/simulation/**/*.ts'],
    ignores: ['src/simulation/**/__tests__/**'],
    languageOptions: { globals: globals.es2022 },
    rules: {
      'no-restricted-imports': ['error', {
        paths: ['react', 'react-dom', 'three', 'zustand'].map((name) => ({ name, message: 'The simulation must not depend on the renderer, UI or store.' })),
        patterns: [
          { group: ['react/*', 'react-dom/*', 'three/*', '@react-three/*', 'zustand/*'], message: 'The simulation must not depend on the renderer, UI or store.' },
          { regex: '^(\\.\\./)+(game|ui|state|app|data)(/|$)', message: 'The simulation must not import from src/game, src/ui, src/state, src/app or src/data.' },
        ],
      }],
      'no-restricted-globals': ['error',
        ...['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'performance', 'fetch', 'requestAnimationFrame', 'setTimeout', 'setInterval']
          .map((name) => ({ name, message: 'The simulation must not touch the browser or wall-clock time.' })),
      ],
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG in src/simulation/rng.ts.' },
        { object: 'Date', property: 'now', message: 'The simulation must not read the wall clock.' },
        { object: 'performance', property: 'now', message: 'The simulation must not read the wall clock.' },
      ],
      'no-restricted-syntax': ['error',
        { selector: "NewExpression[callee.name='Date']", message: 'The simulation must not read the wall clock.' },
        { selector: "CallExpression[callee.name='Date']", message: 'The simulation must not read the wall clock.' },
      ],
    },
  },
)
