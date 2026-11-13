// The envUI rules for the interface's code: the app's window and the diagram viewer. They report
// what envUI already provides but the code builds by hand. TypeScript 7 has no JavaScript API for
// typescript-eslint's parser, so Babel parses the TypeScript and JSX; the rules need no types.
import { defineConfig } from 'eslint/config';
import babelParser from '@babel/eslint-parser';
import envui from '@envsemble/eslint-plugin-envui';

export default defineConfig(
  { ignores: ['**/*.d.ts', '**/node_modules/**', '**/dist/**', '**/out/**', '**/release/**', '**/artifacts/**', 'packages/diagrams/downloads/**', 'packages/diagrams/index.html'] },
  {
    files: ['app/src/**/*.{ts,tsx}', 'packages/diagrams/src/**/*.{js,jsx,ts,tsx}', 'packages/diagrams/development/**/*.{js,jsx}'],
    extends: [envui.configs.recommended],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: { babelrc: false, configFile: false, parserOpts: { plugins: ['jsx', 'typescript'] } },
      },
    },
  },
);
