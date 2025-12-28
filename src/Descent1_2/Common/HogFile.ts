import ArrayBufferSlice from "../../ArrayBufferSlice";
import { assert } from "../../util";
import { DescentDataReader } from "./DataReader";

export class DescentHogLump {
    constructor(
        public name: string,
        public offset: number,
        public size: number,
    ) {}
}

export class DescentHogFile {
    private lumps: DescentHogLump[] = [];
    private lumpMap: Map<string, DescentHogLump> = new Map();

    constructor(private buffer: ArrayBufferSlice) {
        // Build an index of files in the HOG file.
        const reader = new DescentDataReader(buffer);
        const header = reader.readString(3);
        assert(header === "DHF");

        while (!reader.endOfFile()) {
            const fileName = reader.readString(13).trimEnd().toLowerCase();
            const fileSize = reader.readUint32();
            const lump = new DescentHogLump(fileName, reader.offset, fileSize);

            this.lumps.push(lump);
            this.lumpMap.set(fileName, lump);
            reader.offset += fileSize;
        }
    }

    /** Gets lump data by name. */
    public getLumpDataByName(fileName: string): ArrayBufferSlice | null {
        const lump = this.lumpMap.get(fileName.toLowerCase());
        if (lump == null) return null;
        return this.buffer.slice(lump.offset, lump.offset + lump.size);
    }

    public destroy(): void {}
}
