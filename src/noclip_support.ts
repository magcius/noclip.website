import init, * as module from '../rust/pkg/noclip_support';
export type Module = typeof module;

let promise: Promise<void> | null = null;
let initialized = false;
export default async function wasmInit() {
  if (!initialized) {
    if (promise === null) {
      promise = init().then(() => {
        initialized = true;
        promise = null;
      });
    }
    await promise;
  }
  return module;
}
