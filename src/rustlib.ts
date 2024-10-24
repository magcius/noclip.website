
import init, * as rust from '../rust/pkg/noclip_support';

export { rust };

export async function loadRustLib() {
    await init();
}
