import esbuild from 'esbuild';
import fs from 'fs-extra';

const outDir = 'dist';

function gitRevision() {
  const rev = fs.readFileSync('.git/HEAD').toString().trim();
  if (rev.indexOf(':') === -1) {
    return rev;
  } else {
    return fs.readFileSync('.git/' + rev.substring(5)).toString().trim();
  }
}
await fs.remove(outDir);
await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outdir: outDir,
  external: ['fs', 'path'],
  loader: {
    '.glsl': 'text',
    '.png': 'dataurl',
  },
  minify: true,
  define: {
    __COMMIT_HASH: JSON.stringify(gitRevision()),
    'process.env.NODE_ENV': 'development', // TODO prod flag?
  },
  treeShaking: true,
  sourcemap: true,
  splitting: true,
  format: 'esm',
}).catch(() => process.exit(1) /* avoid double printing errors */);
await fs.copy('.htaccess', `${outDir}/.htaccess`);
await fs.copy('src/index.html', `${outDir}/index.html`);
await fs.copy('src/index.html', `${outDir}/embed.html`);
await fs.copy('src/assets', `${outDir}/assets`);
await fs.copy('rust/pkg/noclip_support_bg.wasm', `${outDir}/noclip_support_bg.wasm`);
