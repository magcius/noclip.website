
export default class WasmMemoryManager {
    // WebAssembly pages are 64k.
    public PAGE_SIZE = 64 * 1024;

    public mem: WebAssembly.Memory;
    public heap: Uint8Array;
    public currentNumPages: number;

    constructor() {
        this.mem = new WebAssembly.Memory({ initial: 1 });
        this.currentNumPages = 1;
        // resize must be called before use.
        this.heap = null;
    }

    public resize(newSize: number): void {
        const newNumPages = Math.ceil(newSize / this.PAGE_SIZE);

        if (newNumPages > this.currentNumPages) {
            this.mem.grow(newNumPages - this.currentNumPages);
            this.currentNumPages = newNumPages;
            this.heap = null;
        }

        if (this.heap === null)
            this.heap = new Uint8Array(this.mem.buffer);
    }
}
