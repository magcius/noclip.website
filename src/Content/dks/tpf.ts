
import ArrayBufferSlice from "../../ArrayBufferSlice";
import * as DDS from "./dds";
import { readString, assert } from "../../util";

export interface TPF {
    textures: DDS.DDS[];
}

export function parse(buffer: ArrayBufferSlice): TPF {
    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x04, false) == 'TPF\0');

    const count = view.getUint32(0x08, true);

    let textureIdx = 0x10;
    const textures: DDS.DDS[] = [];
    for (var i = 0; i < count; i++) {
        const dataOffs = view.getUint32(textureIdx, true);
        textureIdx += 0x04;
        const size = view.getUint32(textureIdx, true);
        textureIdx += 0x04;
        const flags = view.getUint32(textureIdx, true);
        textureIdx += 0x04;
        const nameOffs = view.getUint32(textureIdx, true);
        textureIdx += 0x04;
        // Unk.
        textureIdx += 0x04;

        const name = readString(buffer, nameOffs, -1, true);
        const data = buffer.slice(dataOffs, dataOffs + size);

        const dds = DDS.parse(data, name);
        textures.push(dds);
    }

    return { textures };
}
