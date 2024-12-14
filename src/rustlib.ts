
import init, * as rust from '../rust/pkg/noclip_support';

export { rust };

declare const process: unknown;

export async function loadRustLib() {
    // Work around node.js not supporting fetch on file URIs
    // https://github.com/nodejs/undici/issues/2751
    //
    // TODO(jstpierre): Find a way to make this work where rspack strips it out automatically.
    // For now, we require someone to manually undo this to make the offline tools work.

/*
    if (typeof process !== 'undefined') {
        const fs = await import('fs');
        const path = await import('path');
        const url = await import('url');
        const wasmPath = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '../rust/pkg/noclip_support_bg.wasm');
        const wasm = fs.readFileSync(wasmPath);
        rust.initSync({ module: wasm });
    }
*/

    await init();
}
