
import init, * as rust from '../rust/pkg/noclip_support';

export { rust };

declare const process: unknown;

export async function loadRustLib() {
    if (typeof process !== 'undefined') {
        // XXX(jstpierre): This terrible set of workarounds is required on node because fetch doesn't support file URLs.
        // We can't use normal require() because rspack is "smart" and will try to bundle it for web, when I really only
        // want this code to run in tools mode on node.js.
        // https://github.com/nodejs/undici/issues/2751

        const requireX: any = (globalThis as any)['require']; 
        const fs = requireX('fs');
        const path = requireX('path');
        const url = requireX('url');
        const wasmPath = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '../rust/pkg/noclip_support_bg.wasm');
        const wasm = fs.readFileSync(wasmPath);
        rust.initSync(wasm);
    }

    await init();
}
