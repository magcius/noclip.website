// worker.ts

import "./wasm_exec.js";

addEventListener("message", async (e: MessageEvent) => {
  const { trackBuffer, globalBuffer, wasmUrl } = e.data;

  try {
    // 1. Initialize Go and WASM instance
    // @ts-ignore
    const go = new Go();
    const result = await WebAssembly.instantiateStreaming(
      fetch(wasmUrl),
      go.importObject,
    );
    go.run(result.instance);

    // 2. Parse the files using your WASM-bound functions
    // @ts-ignore
    const trackDataRaw = parseTrackFile(new Uint8Array(trackBuffer), false);
    // @ts-ignore
    const globalDataRaw = parseTrackFile(new Uint8Array(globalBuffer), true);

    // 3. Parse strings into JSON objects inside the worker to save main-thread parsing time
    const trackData = JSON.parse(trackDataRaw);
    const globalData = JSON.parse(globalDataRaw);

    // 4. Send the parsed data back to the main thread
    postMessage({ success: true, trackData, globalData });
  } catch (error: any) {
    postMessage({ success: false, error: error.message });
  }
});
