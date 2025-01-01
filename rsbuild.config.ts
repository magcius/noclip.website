import { defineConfig } from '@rsbuild/core';
import { pluginTypeCheck } from '@rsbuild/plugin-type-check';
import { execSync } from 'node:child_process';

let gitCommit = '(unknown)';
try {
  gitCommit = execSync('git rev-parse --short HEAD').toString().trim();
} catch (e) {
  console.warn('Failed to fetch Git commit hash', e);
}

export default defineConfig({
  server: {
    htmlFallback: false,
  },
  source: {
    entry: {
      index: './src/main.ts',
      embed: './src/main.ts',
    },
    // Legacy decorators are used with `reflect-metadata`.
    // TODO: Migrate to TypeScript 5.0 / TC39 decorators.
    decorators: {
      version: 'legacy',
    },
    define: {
      __COMMIT_HASH: JSON.stringify(gitCommit),
    },
  },
  html: {
    template: './src/index.html',
  },
  output: {
    target: 'web',
    // Mark Node.js built-in modules as external.
    externals: ['fs', 'path', 'url'],
    // TODO: These should be converted to use `new URL('./file.wasm', import.meta.url)`
    // so that the bundler can resolve them. In the meantime, they're expected to be
    // at the root.
    copy: [
      { from: 'src/**/*.wasm', to: '[name][ext]' },
      { from: 'node_modules/librw/lib/librw.wasm' },
    ],
  },
  // Enable async TypeScript type checking.
  plugins: [pluginTypeCheck()],
  tools: {
    // Add a rule to treat .glsl files as source assets.
    rspack(_config, { addRules }) {
      addRules([
        {
          test: /\.glsl$/,
          type: 'asset/source',
        },
      ]);
    },
    // Disable standards-compliant class field transforms.
    swc: {
      jsc: {
        transform: {
          useDefineForClassFields: false,
        },
      },
    },
  },
});
