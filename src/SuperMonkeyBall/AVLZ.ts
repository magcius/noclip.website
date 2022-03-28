/*
 * Credits to chmcl for initial GMA/TPL support (https://github.com/ch-mcl/)
 */

import ArrayBufferSlice from "../ArrayBufferSlice";
import * as LZSS from "../Common/Compression/LZSS";

export enum AVLZ_Type{
    NONE,   // 
    SMB,    // Super Monkey Ball
    SMB2,   // Super Monkey Ball 2, F-ZERO AX
    FZGX    // F-ZERO GX
}

export function decompressLZSS(buffer: ArrayBufferSlice, avlzType: AVLZ_Type){
    const srcView = buffer.createDataView();
    let uncompressedSize = srcView.getUint32(0x04, true);
    if (avlzType === AVLZ_Type.SMB){
        uncompressedSize -= 0x04;
    }
    return LZSS.decompress(buffer.slice(8).createDataView(), uncompressedSize);
}
