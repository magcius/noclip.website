export let rust: typeof import('../rust/pkg/index') | null = null;

export async function loadRustLib() {
    if (rust === null) {
        rust = await import('../rust/pkg/index');
    }
}
