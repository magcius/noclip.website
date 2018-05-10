
export default class WasmMemoryManager {
    // WebAssembly pages are 64k.
    public PAGE_SIZE = 64 * 1024;

    public mem: WebAssembly.Memory;
    public heap: Uint8Array | null;
    public currentNumPages: number;

    constructor(mem?: WebAssembly.Memory) {
        if (mem !== undefined)
            this.mem = mem;
        else
            this.mem = new WebAssembly.Memory({ initial: 1 });

        this.currentNumPages = this.mem.buffer.byteLength / this.PAGE_SIZE;
        // resize must be called before use.
        this.heap = null;
    }

    public resize(newSize: number): Uint8Array {
        const newNumPages = Math.ceil(newSize / this.PAGE_SIZE);

        if (newNumPages > this.currentNumPages) {
            this.mem.grow(newNumPages - this.currentNumPages);
            this.currentNumPages = newNumPages;
            this.heap = null;
        }

        if (this.heap === null)
            this.heap = new Uint8Array(this.mem.buffer);

        return this.heap;
    }
}
