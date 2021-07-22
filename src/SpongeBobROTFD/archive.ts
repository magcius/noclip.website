import ArrayBufferSlice from "../ArrayBufferSlice";
import { DataFetcher } from "../DataFetcher";
import { DataStream } from "./util";

const dataBasePath = "rotfd";

export class TotemFile {
    constructor(public readonly data: ArrayBufferSlice, public readonly typeHash: number, public readonly flags: number) { }
}

export class TotemArchive {
    data: { [key: number]: TotemFile } = {};
}

export async function loadArchive(dataFetcher: DataFetcher, path: string): Promise<TotemArchive> {
    const dgc = await dataFetcher.fetchData(`${dataBasePath}/${path}.DGC`);
    // const ngc = await dataFetcher.fetchData(`${path}.NGC`);
    const dstream = new DataStream(dgc, dgc.createDataView(), 256, false);
    const chunkSize = dstream.readUint32();
    dstream.offs = 2048;
    let archive = new TotemArchive();
    while (dstream.offs < dstream.buffer.byteLength) {
        const nextpos = dstream.offs + chunkSize;
        const numFiles = dstream.readUint32();
        // console.log("CHUNK");
        for (let i = 0; i < numFiles; i++) {
            const fileSize = dstream.readUint32();
            const fileTypeHash = dstream.readUint32();
            const fileNameHash = dstream.readUint32();
            const fileFlags = dstream.readUint32();
            const data = dstream.readSlice(fileSize - 16);
            // console.log(`Loading: ${fileNameHash} ${fileSize}`);
            archive.data[fileNameHash] = new TotemFile(data, fileTypeHash, fileFlags);
        }
        dstream.offs = nextpos;
    }
    return archive;
}