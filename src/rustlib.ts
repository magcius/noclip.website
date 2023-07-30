
export let rust: typeof import('../rust/pkg/index.js') = null!;

export async function loadRustLib() {
    if (rust === null) {
        rust = await import('../rust/pkg/index.js');
    }
}
