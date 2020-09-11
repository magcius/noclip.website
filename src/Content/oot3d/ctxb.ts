
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { assert, readString } from "../../util";
import { parseTexChunk, Texture } from "./cmb";

export interface CTXB {
    textures: Texture[];
}

export function parse(buffer: ArrayBufferSlice): CTXB {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'ctxb');
    const size = view.getUint32(0x04, true);
    assert(view.getUint32(0x08, true) === 0x01);

    const texChunkOffs = view.getUint32(0x10, true);
    const texDataOffs = view.getUint32(0x14, true);
    const textures = parseTexChunk(buffer.slice(texChunkOffs), buffer.slice(texDataOffs), 'ctxb');
    return { textures };
}
