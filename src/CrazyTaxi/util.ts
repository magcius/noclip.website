import { CTFileStore, CTFileLoc } from "../../rust/pkg/noclip_support";
import * as GXTexture from '../gx/gx_texture.js';
import ArrayBufferSlice from "../ArrayBufferSlice";
import { NamedArrayBufferSlice, DataFetcher } from "../DataFetcher";
import { rust } from "../rustlib";

export interface FriendlyLoc {
    filename: string,
    offset: number,
    length: number,
}

export class FileManager {
    public fileStore: CTFileStore;
    private fileData: NamedArrayBufferSlice[] = [];

    constructor(public dataFetcher: DataFetcher, public fileNames: string[]) {
        this.fileStore = rust.CTFileStore.new();
    }

    public createTexture(name: string): GXTexture.TextureInputGX {
        const texture = this.fileStore.get_texture(name)!;
        const data = this.getData(texture.data_loc());
        return {
            name,
            width: texture.width(),
            height: texture.height(),
            mipCount: 1, // ???
            format: texture.format(),
            data,
        };
    }

    public getLoc(loc: CTFileLoc): FriendlyLoc {
        return {
            filename: this.fileNames[loc.file_id],
            offset: loc.offset,
            length: loc.length,
        }
    }

    public getData(loc: CTFileLoc): ArrayBufferSlice {
        const data = this.fileData[loc.file_id];
        return data.slice(loc.offset, loc.offset + loc.length);
    }

    async fetch() {
        const basePath = "CrazyTaxi/files/ct";
        for (const fileName of this.fileNames) {
            const data = await this.dataFetcher.fetchData(`${basePath}/${fileName}`);
            if (fileName.endsWith('.all')) {
                this.fileStore.append_archive(fileName, data.createTypedArray(Uint8Array));
            } else {
                this.fileStore.append_file(fileName, data.createTypedArray(Uint8Array));
            }
            this.fileData.push(data);
        }
    }
}
