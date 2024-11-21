
import init, * as rust from '../rust/pkg/noclip_support';
import { createRequire } from 'node:module';

export { rust };

declare const process: unknown;

const require = createRequire(import.meta.url);

export async function loadRustLib() {
    if (typeof process !== 'undefined') {
        // XXX(jstpierre): This terrible set of workarounds is required on node because fetch doesn't support file URLs.
        // We can't use normal require() because rspack is "smart" and will try to bundle it for web, when I really only
        // want this code to run in tools mode on node.js.
        // https://github.com/nodejs/undici/issues/2751

        const fs = require('fs');
        const path = require('path');
        const url = require('url');
        const wasmPath = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '../rust/pkg/noclip_support_bg.wasm');
        const wasm = fs.readFileSync(wasmPath);
        rust.initSync(wasm);
    }

    await init();
}
