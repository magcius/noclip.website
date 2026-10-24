import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig({
  files: ['src/PerfectDark64/**/*.{js,ts}'],
  extends: [js.configs.recommended, tseslint.configs.recommended],
});
