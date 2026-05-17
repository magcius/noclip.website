import { IS_DEVELOPMENT } from "../BuildVersion";
import { GsPrimitiveType } from "../Common/PS2/GS";
import { DataViewExt } from "./DataViewExt";
import { assert } from "../util";
import { getBits, ImaginaryGsCommand, ImaginaryGsCommandBuffer, truncateTrailing0xFF } from "./utils";
import { readVifCommandList, VifUnpackFormat, VifUnpackReader } from "./vif";

export interface GsRamTableEntry {
    psm: number,
    width: number,
    height: number,
    address: number,
    offset: number,
}
export const SIZEOF_GS_RAM_TABLE_ENTRY = 0x10;
export function readGsRamTableEntry(view: DataViewExt) {
    /*    
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/wrenchbuild/level/level_textures.h#L29
    */
    return {
        psm: view.getInt32(0x0),
        width: view.getInt16(0x4),
        height: view.getInt16(0x6),
        address: view.getInt32(0x8),
        offset: view.getInt32(0xc),
    }
}

export interface TieClass {
    normalsData: { x: number, y: number, z: number }[],
    nearDist: number,
    midDist: number,
    farDist: number,
    bsphere: { x: number, y: number, z: number, w: number },
    scale: number,
    packets: TiePacket[][], // [lod][packet]
    adGifs: TieGifAds[],
};
export interface TiePacket {
    header: TiePacketHeader,
    body: TiePacketBody,
};
export function readTieClass(view: DataViewExt, oClass: number): TieClass {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/tie.h#L37
    */

    // `packetOffsets[i]` points to `TiePacketHeader headers[packetCount[i]]`
    // (relative to this struct)
    const packetOffsets = view.getArrayOfNumbers(0x0, 3, Uint32Array);
    const packetCounts = view.getArrayOfNumbers(0x20, 3, Uint8Array);

    const packets: TiePacket[][] = [];

    const textureCount = view.getUint8(0x23);
    const adGifsOffset = view.getUint32(0x2c);
    const adGifs = view.subdivide(adGifsOffset, textureCount, SIZEOF_TIE_AD_GIFS).map(readTieAdGifs);

    const normalsOffset = view.getUint32(0xc);
    const normalsData = view.subdivide(normalsOffset, 64, 8).map(view => view.getInt16_Xyzw(0));

    // there are always 3 lods
    for (let i = 0; i < 3; i++) {
        const packetOffset = packetOffsets[i];
        const packetCount = packetCounts[i];
        const packetHeaders = view.subdivide(packetOffset, packetCount, SIZEOF_TIE_PACKET_HEADER).map(readTiePacketHeader);

        const packetsInThisLod: TiePacket[] = [];
        for (let j = 0; j < packetCount; j++) {
            const packetDataOffset = packetOffset + packetHeaders[j].data;
            const packetBody = readTiePacketBody(view.subview(packetDataOffset), packetHeaders[j], adGifs, oClass, i, j);
            packetsInThisLod.push({
                header: packetHeaders[j],
                body: packetBody,
            })
        }

        packets.push(packetsInThisLod);
    }

    return {
        normalsData,
        nearDist: view.getFloat32(0x10),
        midDist: view.getFloat32(0x14),
        farDist: view.getFloat32(0x18),
        bsphere: view.getFloat32_Xyzw(0x30),
        scale: view.getFloat32(0x40),
        packets,
        adGifs,
    };
}

export interface TiePacketHeader {
    data: number,
    shaderCount: number,
    bfcDistance: number,
    controlCount: number,
    controlSize: number,
    vertOffset: number,
    vertSize: number,
    rgbaCount: number,
    multipassOffset: number,
    scissorOffset: number,
    scissorSize: number,
    multipassType: number,
    multipassUvSize: number,
}
export const SIZEOF_TIE_PACKET_HEADER = 0x10;
export function readTiePacketHeader(view: DataViewExt): TiePacketHeader {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/tie.h#L92
    */

    return {
        data: view.getInt32(0x0),
        shaderCount: view.getUint8(0x4),
        bfcDistance: view.getUint8(0x5),
        controlCount: view.getUint8(0x6),
        controlSize: view.getUint8(0x7),
        vertOffset: view.getUint8(0x8),
        vertSize: view.getUint8(0x9),
        rgbaCount: view.getUint8(0xa),
        multipassOffset: view.getUint8(0xb),
        scissorOffset: view.getUint8(0xc),
        scissorSize: view.getUint8(0xd),
        multipassType: view.getUint8(0xe),
        multipassUvSize: view.getUint8(0xf),
    };
}

export interface TieVertexWithNormalAndRgba { vertex: TieVertex, normalIndex: number, rgbaIndex: number };
export type TieImaginaryGsCommand = ImaginaryGsCommand<TieStrip, { material: number, clamp: number }, TieVertexWithNormalAndRgba>;

const tieCommandSizes = {
    primitiveReset: 1,
    setMaterial: 6,
    vertex: 3,
};

export type TiePacketBody = ReturnType<typeof readTiePacketBody>;
export function readTiePacketBody(view: DataViewExt, tiePacketHeader: TiePacketHeader, adGifs: TieGifAds[], oClass: number, lod: number, packetIndex: number) {
    /*
    struct TiePacketBody {
        // 0x0
        int32 adGifDestOffsets[4];
        // 0x10
        int32 adGifSrcOffsets[4];
        // 0x20
        TieVuHeader tieVuHeader;
        // 0x2c
        TieStrip tieStrips[tieVuHeader.stripCount];
        // align 0x10
        TieRegularVertex regularVerts[tieVuHeader.regularVertexCount];
        TieMorphingVertex morphingVerts[tieVuHeader.morphingVertexCount];
        // align 0x10
        uint8 regularNormalIndices[tieVuHeader.regularVertexCount];
        // align 0x4
        uint8vec4 morphingNormalIndices[tieVuHeader.morphingVertexCount];
        // align 0x10
        uint8 regularRgbaIndices[tieVuHeader.regularVertexCount];
        // align 0x4
        uint8vec4 morphingRgbaIndices[tieVuHeader.morphingVertexCount];
        // align 0x10
        uint8 unknown[?];
    }
    */

    let ptr = 0;
    function alignTo(size: number) {
        if (ptr % size !== 0) {
            ptr += size - (ptr % size);
        }
    }

    const AD_GIFS = 4;
    const adGifDestOffsets = view.getArrayOfNumbers(ptr, AD_GIFS, Int32Array);
    ptr += AD_GIFS * 0x4;
    const adGifSrcOffsets = view.getArrayOfNumbers(ptr, AD_GIFS, Int32Array)
    ptr += AD_GIFS * 0x4;

    const tieVuHeader = readTieVuHeader(view.subview(ptr));
    ptr += SIZEOF_TIE_VU_HEADER;

    const tieStrips = view.subdivide(ptr, tieVuHeader.stripCount, SIZEOF_TIE_STRIP).map(readTieStrip);
    ptr += tieVuHeader.stripCount * SIZEOF_TIE_STRIP;

    // regular verts
    alignTo(0x10);
    const regularVertexCount = tieVuHeader.regularVertexCount;
    const regularVerts = view.subdivide(ptr, regularVertexCount, SIZEOF_TIE_REGULAR_VERTEX).map(readTieRegularVertex);
    ptr += regularVertexCount * SIZEOF_TIE_REGULAR_VERTEX;

    // morphing verts
    const morphingVertexCount = tieVuHeader.morphingVertexCount;
    const morphingVerts = view.subdivide(ptr, morphingVertexCount, SIZEOF_TIE_MORPHING_VERTEX).map(readTieMorphingVertex);
    ptr += morphingVertexCount * SIZEOF_TIE_MORPHING_VERTEX;

    // indices into the tie's normal array
    alignTo(0x10);
    const regularNormalIndices = view.subdivide(ptr, tieVuHeader.regularVertexCount, 0x1).map(view => view.getUint8(0));
    ptr += tieVuHeader.regularVertexCount * 0x1;
    alignTo(0x4);
    const morphingNormalIndices = view.subdivide(ptr, tieVuHeader.morphingVertexCount, 0x4).map(view => view.getUint8_Xyz(0));
    ptr += tieVuHeader.morphingVertexCount * 0x4;

    // indices into the instance's rgba array
    alignTo(0x10);
    const regularRgbaIndices = view.subdivide(ptr, tieVuHeader.regularVertexCount, 0x1).map(view => view.getUint8(0));
    ptr += tieVuHeader.regularVertexCount * 0x1;
    alignTo(0x4);
    const morphingRgbaIndices = view.subdivide(ptr, tieVuHeader.morphingVertexCount, 0x4).map(view => view.getUint8_Xyzw(0));
    ptr += tieVuHeader.morphingVertexCount * 0x4;

    // there's one more array of bytes after this but not sure what it is or what its length is (usually 50-60 bytes)
    alignTo(0x10);

    const imaginaryGsBuffer = new ImaginaryGsCommandBuffer<TieStrip, { material: number, clamp: number }, TieVertexWithNormalAndRgba>();

    // first command always sets the material to the first material
    const firstMaterialId = adGifSrcOffsets[0] / SIZEOF_TIE_AD_GIFS;
    const firstAdGif = adGifs[firstMaterialId];
    const firstClamp = firstAdGif.clamp.low + (firstAdGif.clamp.high << 2);
    imaginaryGsBuffer.writeSetMaterial(0, tieCommandSizes.setMaterial, { material: firstMaterialId, clamp: firstClamp });

    // Write verts into command buffer
    // Some are written twice.
    for (let i = 0; i < regularVerts.length; i++) {
        const vertex = regularVerts[i];
        const normalIndex = regularNormalIndices[i];
        const rgbaIndex = regularRgbaIndices[i] - 64;
        imaginaryGsBuffer.writeVertex(vertex.gsPacketWriteOffset, tieCommandSizes.vertex, { vertex, normalIndex, rgbaIndex }, true);
        if (vertex.gsPacketWriteOffset2 !== 0 && vertex.gsPacketWriteOffset !== vertex.gsPacketWriteOffset2) {
            imaginaryGsBuffer.writeVertex(vertex.gsPacketWriteOffset2, tieCommandSizes.vertex, { vertex, normalIndex, rgbaIndex }, true);
        }
    }
    for (let i = 0; i < morphingVerts.length; i++) {
        const vertex = morphingVerts[i];
        const normalIndex = morphingNormalIndices[i].x; // all 3 components are normal indices, not sure why there are 3, maybe to do with lod morphing
        const rgbaIndex = morphingRgbaIndices[i].x - 64;
        imaginaryGsBuffer.writeVertex(vertex.gsPacketWriteOffset, tieCommandSizes.vertex, { vertex, normalIndex, rgbaIndex }, true);
        if (vertex.gsPacketWriteOffset2 !== 0 && vertex.gsPacketWriteOffset !== vertex.gsPacketWriteOffset2) {
            imaginaryGsBuffer.writeVertex(vertex.gsPacketWriteOffset2, tieCommandSizes.vertex, { vertex, normalIndex, rgbaIndex }, true);
        }
    }

    // Write primitive reset commands
    for (const strip of tieStrips) {
        imaginaryGsBuffer.writePrimitiveReset(strip.gifTagOffset, tieCommandSizes.primitiveReset, strip);
    }

    // Write material change commands
    for (let i = 0; i < AD_GIFS - 1; i++) {
        const destAddr = adGifDestOffsets[i];
        if (destAddr === 0) continue; // unused slot
        // destOffset[i] corresponds to srcOffset[i+1] because the first destOffset is for the first material which is implicit
        const materialId = adGifSrcOffsets[i + 1] / SIZEOF_TIE_AD_GIFS;
        const nextAdGif = adGifs[materialId];
        const clamp = nextAdGif.clamp.low + (nextAdGif.clamp.high << 2);
        imaginaryGsBuffer.writeSetMaterial(destAddr, tieCommandSizes.setMaterial, { material: materialId, clamp });
    }

    return {
        adGifDestOffsets,
        adGifSrcOffsets,
        tieVuHeader,
        tieStrips,
        regularVertexCount,
        regularVerts,
        morphingVerts,
        regularNormalIndices,
        morphingNormalIndices,
        regularRgbaIndices,
        morphingRgbaIndices,
        commandBuffer: imaginaryGsBuffer.finish(),
    }
}

export interface TieVuHeader {
    stripCount: number,
    regularVerticesSizePlusFourOverTwo: number,
    morphingVerticesSizePlusFourOverTwo: number,
    regularVertexCount: number,
    morphingVertexCount: number,
}
export const SIZEOF_TIE_VU_HEADER = 0xc;
export function readTieVuHeader(view: DataViewExt) {
    /*
    struct TieVuHeader {
        uint8 unknown0;
        uint8 unknown1;
        uint8 unknown2;
        uint8 stripCount;
        uint8 unknown4;
        uint8 unknown5;
        uint8 unknown6;
        uint8 unknown7;
        uint8 regularVerticesSizePlusFourOverTwo;
        uint8 morphingVerticesSizePlusFourOverTwo;
        uint8 regularVertexCount;
        uint8 morphingVertexCount;
    }
    */

    return {
        unknown0: view.getUint8(0x0),
        unknown1: view.getUint8(0x1),
        unknown2: view.getUint8(0x2),
        stripCount: view.getUint8(0x3),
        unknown4: view.getUint8(0x4),
        unknown5: view.getUint8(0x5),
        unknown6: view.getUint8(0x6),
        unknown7: view.getUint8(0x7),
        regularVerticesSizePlusFourOverTwo: view.getUint8(0x8),
        morphingVerticesSizePlusFourOverTwo: view.getUint8(0x9),
        regularVertexCount: view.getUint8(0xa),
        morphingVertexCount: view.getUint8(0xb),
    };
}

export interface TieStrip {
    vertexCount: number,
    gifTagOffset: number,
    windingOrder: number,
};
export const SIZEOF_TIE_STRIP = 0x4;
export function readTieStrip(view: DataViewExt) {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/tie.h#L124
    */

    return {
        vertexCount: view.getUint8(0x0),
        gifTagOffset: view.getUint8(0x2),
        windingOrder: view.getUint8(0x1), // rac3+ only
    };
}

export interface TieVertex {
    gsPacketWriteOffset: number,
    gsPacketWriteOffset2: number,
    x: number,
    y: number,
    z: number,
    s: number,
    t: number,
    q: number,
    lodMorphOffsetX: number,
    lodMorphOffsetY: number,
    lodMorphOffsetZ: number,
}

export const SIZEOF_TIE_REGULAR_VERTEX = 0x10;
export function readTieRegularVertex(view: DataViewExt): TieVertex {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/tie.h#L132
    */

    return {
        gsPacketWriteOffset: view.getUint16(0x6), // fields out of order for consistency with other vertex type
        gsPacketWriteOffset2: view.getUint16(0xe),
        x: view.getInt16(0x0),
        y: view.getInt16(0x2),
        z: view.getInt16(0x4),
        s: view.getUint16(0x8),
        t: view.getUint16(0xa),
        q: view.getUint16(0xc),
        lodMorphOffsetX: 0,
        lodMorphOffsetY: 0,
        lodMorphOffsetZ: 0,
    };
}

export const SIZEOF_TIE_MORPHING_VERTEX = 0x18;
export function readTieMorphingVertex(view: DataViewExt): TieVertex {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/tie.h#L144
    */

    return {
        gsPacketWriteOffset: view.getUint16(0x6), // fields out of order for consistency with other vertex type
        gsPacketWriteOffset2: view.getUint16(0x16),
        x: view.getInt16(0x8),
        y: view.getInt16(0xa),
        z: view.getInt16(0xc),
        s: view.getUint16(0x10),
        t: view.getUint16(0x12),
        q: view.getUint16(0x14),
        lodMorphOffsetX: view.getInt16(0x0),
        lodMorphOffsetY: view.getInt16(0x2),
        lodMorphOffsetZ: view.getInt16(0x4),
    };
}

export interface GifAd {
    low: number,
    high: number,
    address: number,
};
export function readGifAdData(view: DataViewExt): GifAd {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/gif.h#L113
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/gif.h#L121
    struct GifAd {
        int32 low;
        int32 high;
        uint8 address;
    }
    */
    return {
        low: view.getInt32(0x0),
        high: view.getInt32(0x4),
        address: view.getUint8(0x8),
    };
}

export interface TieGifAds {
    tex0: GifAd,
    tex1: GifAd,
    miptbp1: GifAd,
    clamp: GifAd,
    miptbp2: GifAd,
};
export const SIZEOF_TIE_AD_GIFS = 0x50;
export function readTieAdGifs(view: DataViewExt) {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/tie.h#L179
    Each padded to 16 bytes
    */
    return {
        tex0: readGifAdData(view.subview(0x0)),
        tex1: readGifAdData(view.subview(0x10)),
        miptbp1: readGifAdData(view.subview(0x20)),
        clamp: readGifAdData(view.subview(0x30)),
        miptbp2: readGifAdData(view.subview(0x40)),
    }
}

export const SIZEOF_TFRAG_BLOCK_HEADER = 0x10;
export type TfragBlockHeader = ReturnType<typeof readTfragBlockHeader>;
export function readTfragBlockHeader(view: DataViewExt) {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/tfrag_low.h#L29
    */

    return {
        tableOffset: view.getInt32(0x0),
        tfragCount: view.getInt32(0x4),
    }
}

export const SIZEOF_TFRAG_HEADER = 0x40;
export type TfragHeader = ReturnType<typeof readTfragHeader>;
export function readTfragHeader(view: DataViewExt) {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/tfrag_low.h#L36
    */

    return {
        bsphere: view.getFloat32_Xyzw(0x0),
        data: view.getInt32(0x10),
        lod2Offset: view.getUint16(0x14),
        sharedOffset: view.getUint16(0x16),
        lod1Offset: view.getUint16(0x18),
        lod0Offset: view.getUint16(0x1a),
        texOffset: view.getUint16(0x1c),
        rgbaOffset: view.getUint16(0x1e),
        commonSize: view.getUint8(0x20),
        lod2Size: view.getUint8(0x21),
        lod1Size: view.getUint8(0x22),
        lod0Size: view.getUint8(0x23),
        lod2RgbaCount: view.getUint8(0x24),
        lod1RgbaCount: view.getUint8(0x25),
        lod0RgbaCount: view.getUint8(0x26),
        baseOnly: view.getUint8(0x27),
        textureCount: view.getUint8(0x28),
        rgbaSize: view.getUint8(0x29),
        rgbaVertsLoc: view.getUint8(0x2a),
        occlIndexStash: view.getUint8(0x2b),
        msphereCount: view.getUint8(0x2c),
        flags: view.getUint8(0x2d),
        msphereOfs: view.getUint16(0x2e),
        lightOfs: view.getUint16(0x30),
        lightEndOffset: view.getUint16(0x32), // different in rac4
        dirLightsOne: view.getUint8(0x34),
        dirLightsUpd: view.getUint8(0x35),
        pointLights: view.getUint16(0x36),
        cubeOffset: view.getUint16(0x38),
        occlIndex: view.getUint16(0x3a),
        vertCount: view.getUint8(0x3c),
        triCount: view.getUint8(0x3d),
        mipDist: view.getUint16(0x3e),
    }
}

export interface TfragLight {
    unknown0: number,
    azimuth: number,
    elevation: number,
    brightness: number,
    directionalLights: number[],
};
export const SIZEOF_TFRAG_LIGHT = 0x8;
export function readTfragLight(view: DataViewExt): TfragLight {
    /*
    struct TfragLight {
        uint16 unknown0; // looks like a write address. Between 300 and 1400, always increases, usually by 6 at a time, always divisible by 2.
        int8 azimuth;
        int8 elevation;
        uint16 brightness; // this looks like light intensity but I don't know why I'd need it
        uint16 directionalLights; // nibble[4], list of indices into the directional light array
    }
    */

    return {
        unknown0: view.getUint16(0x0),
        azimuth: view.getInt8(0x2),
        elevation: view.getInt8(0x3),
        brightness: view.getUint16(0x4),
        directionalLights: view.getNibbleArray(0x6, 2),
    }
}

export interface TfragLod {
    indices: Uint8Array,
    strips: TfragStrip[],
};

export interface Tfrag {
    header: TfragHeader,
    rgbas: { r: number, g: number, b: number, a: number }[],
    lights: TfragLight[],
    dataGroup1: {
        lod2: TfragLod,
    },
    dataGroup2: {
        vuHeader: TfragVuHeader,
        basePosition: Int32Array,
        textures: TfragAdGifs[],
        vertexInfoPart1: TfragVertexInfo[],
        vertexPositionsPart1: { x: number, y: number, z: number }[],
    },
    dataGroup3: {
        lod1: TfragLod,
    },
    dataGroup4: {
        vertexInfoPart2: TfragVertexInfo[],
        vertexPositionsPart2: { x: number, y: number, z: number }[],
    },
    dataGroup5: {
        vertexInfoPart3: TfragVertexInfo[],
        vertexPositionsPart3: { x: number, y: number, z: number }[],
        lod0: TfragLod,
    },
}

export function readTfrag(view: DataViewExt, header: TfragHeader) {
    const rgbas = view.subdivide(header.rgbaOffset, header.rgbaSize * 4, 0x4).map(view => view.getUint8_Rgba(0));
    const lights = view.subdivide(header.lightOfs + 0x10, header.vertCount, SIZEOF_TFRAG_LIGHT).map(readTfragLight); // why plus 0x10?

    /*
    There are 5 VIF buffers concatted together

    LOD2 - buffers 1 to 2
    LOD1 - buffers 2 to 4
    LOD0 - buffers 4 to 5

    There are 4 offset/size pairs, but they overlap.
    lod2Offset/lod2Size cover buffers 1-2
    sharedOffset/commonSize covers buffer 2
    lod1Offset/lod1Size cover buffers 2-4
    lod0Offset/lod0Size cover buffers 4-5

    | Buffers |---------------|---------------|---------------|---------------|---------------|
    |     LOD2|<----------------------------->|
    |                  Shared |<------------->|
    |                    LOD1 |<--------------------------------------------->|
    |                                                    LOD0 |<----------------------------->|

    So we have pointers to the start of buffers 1, 2, and 4.
    For 3, we need to use the end of the shared buffer
    For 5, we need to use the end of the lod1 buffer

    NOP padding is included, we can assume the start of one buffer is the end of the previous buffer.
    
    */
    const vifBufferPointers = [
        header.lod2Offset,
        header.sharedOffset,
        header.sharedOffset + header.commonSize * 0x10,
        header.lod0Offset,
        header.sharedOffset + header.lod1Size * 0x10,
        header.lod0Offset + header.lod0Size * 0x10,
    ];

    const vifBuffers = [];
    for (let i = 0; i < vifBufferPointers.length - 1; i++) {
        const size = vifBufferPointers[i + 1] - vifBufferPointers[i];
        assert(size > 0);
        const buf = view.subview(vifBufferPointers[i], size);
        vifBuffers.push(buf);
    }

    const [vifBuffer1, vifBuffer2, vifBuffer3, vifBuffer4, vifBuffer5] = vifBuffers;

    /*
    VIF buffer 1
    */
    let dataGroup1: Tfrag["dataGroup1"];
    {
        const vifCommands = readVifCommandList(vifBuffer1);
        const unpackReader = new VifUnpackReader(vifCommands);
        const lod2Indices = unpackReader.next().getTypedArrayView(Uint8Array);
        const lod2Strips = unpackReader.next().subdivide(0, 0xFFFF, SIZEOF_TFRAG_STRIP).map(readTfragStrip);
        dataGroup1 = {
            lod2: {
                indices: lod2Indices,
                strips: lod2Strips,
            },
        };
    }


    /*
    VIF buffer 2
    */
    let dataGroup2: Tfrag["dataGroup2"];
    let vuHeader: TfragVuHeader;
    {
        const vifCommands = readVifCommandList(vifBuffer2);
        const unpackReader = new VifUnpackReader(vifCommands);

        assert(vifCommands.length >= 6);
        const basePosition = vifCommands[5].readStrowData();

        vuHeader = readTfragVuHeader(unpackReader.next());
        const textures = unpackReader.next().subdivide(0, 0xFFFF, SIZEOF_TFRAG_AD_GIFS).map(readTfragAdGifs);
        const vertexInfoPart1 = unpackReader.next().subdivide(0, 0xFFFF, SIZEOF_TFRAG_VERTEX_INFO).map(readTfragVertexInfo);
        const vertexPositionsPart1 = unpackReader.next().subdivide(0, 0xFFFF, 0x6).map(view => view.getInt16_Xyz(0));
        assert(vertexPositionsPart1.length === vuHeader.positionsCommonCount);

        dataGroup2 = {
            vuHeader,
            basePosition,
            textures,
            vertexInfoPart1,
            vertexPositionsPart1,
        };

        if (IS_DEVELOPMENT) {
            validateTfrag(
                dataGroup1.lod2.indices,
                dataGroup1.lod2.strips,
                dataGroup2.vertexInfoPart1,
                dataGroup2.vertexPositionsPart1,
            );
        }
    }

    /*
    VIF buffer 3
    */
    let dataGroup3: Tfrag["dataGroup3"];
    {
        const vifCommands = readVifCommandList(vifBuffer3);
        const unpackReader = new VifUnpackReader(vifCommands);
        const lod1Strips = unpackReader.next().subdivide(0, 0xFFFF, SIZEOF_TFRAG_STRIP).map(readTfragStrip)
        const lod1Indices = unpackReader.next().getTypedArrayView(Uint8Array);
        dataGroup3 = {
            lod1: {
                strips: lod1Strips,
                indices: lod1Indices,
            },
        };
    }

    /*
    VIF buffer 4
    */
    let dataGroup4: Tfrag["dataGroup4"];
    {
        const vifCommands = readVifCommandList(vifBuffer4);
        const unpackReader = new VifUnpackReader(vifCommands);

        if (vuHeader.positionsLod01Count > 0) {
            assert(unpackReader.peekNextVnvl() === VifUnpackFormat.V4_8);
            unpackReader.next(); // ignore it
        }

        if (unpackReader.hasNext() && unpackReader.peekNextVnvl() === VifUnpackFormat.V4_8 && unpackReader.peekNextAddr() !== 0) {
            unpackReader.next(); // ignore it
        }

        let vertexInfoPart2: TfragVertexInfo[] | null = null;
        if (unpackReader.hasNext() && unpackReader.peekNextVnvl() === VifUnpackFormat.V4_16) {
            vertexInfoPart2 = unpackReader.next().subdivide(0, 0xFFFF, SIZEOF_TFRAG_VERTEX_INFO).map(readTfragVertexInfo);
        }

        let vertexPositionsPart2: { x: number, y: number, z: number }[] | null = null;
        if (unpackReader.hasNext() && unpackReader.peekNextVnvl() === VifUnpackFormat.V3_16) {
            vertexPositionsPart2 = unpackReader.next().subdivide(0, 0xFFFF, 0x6).map(view => view.getInt16_Xyz(0));
            assert(vertexPositionsPart2.length === vuHeader.positionsLod01Count);
        }

        dataGroup4 = {
            vertexInfoPart2: vertexInfoPart2 ?? [],
            vertexPositionsPart2: vertexPositionsPart2 ?? [],
        };

        if (IS_DEVELOPMENT) {
            validateTfrag(
                dataGroup3.lod1.indices,
                dataGroup3.lod1.strips,
                [...dataGroup2.vertexInfoPart1, ...dataGroup4.vertexInfoPart2],
                [...dataGroup2.vertexPositionsPart1, ...dataGroup4.vertexPositionsPart2],
            );
        }
    }

    /*
    VIF buffer 5
    */
    let dataGroup5: Tfrag["dataGroup5"];
    {
        const vifCommands = readVifCommandList(vifBuffer5);
        const unpackReader = new VifUnpackReader(vifCommands);

        let vertexPositionsPart3: { x: number, y: number, z: number }[] | null = null;
        if (vuHeader.positionsLod0Count > 0) {
            assert(unpackReader.peekNextVnvl() === VifUnpackFormat.V3_16);
            const unpack = unpackReader.next();
            vertexPositionsPart3 = unpack.subdivide(0, 0xFFFF, 0x6).map(view => view.getInt16_Xyz(0));
            assert(vertexPositionsPart3.length === vuHeader.positionsLod0Count);
        }

        const strips = unpackReader.next().subdivide(0, 0xFFFF, SIZEOF_TFRAG_STRIP).map(readTfragStrip)
        const indices = unpackReader.next().getTypedArrayView(Uint8Array);

        if (vuHeader.positionsLod0Count > 0) {
            assert(unpackReader.peekNextVnvl() === VifUnpackFormat.V4_8);
            unpackReader.next(); // ignore it
        }

        if (unpackReader.hasNext() && unpackReader.peekNextVnvl() === VifUnpackFormat.V4_8) {
            unpackReader.next(); // ignore it
        }

        let vertexInfoPart3: TfragVertexInfo[] | null = null;
        if (vuHeader.positionsLod0Count > 0) {
            assert(unpackReader.peekNextVnvl() === VifUnpackFormat.V4_16);
            vertexInfoPart3 = unpackReader.next().subdivide(0, 0xFFFF, SIZEOF_TFRAG_VERTEX_INFO).map(readTfragVertexInfo);
        }

        dataGroup5 = {
            vertexInfoPart3: vertexInfoPart3 ?? [],
            vertexPositionsPart3: vertexPositionsPart3 ?? [],
            lod0: {
                strips: strips,
                indices: indices,
            },
        }

        if (IS_DEVELOPMENT) {
            validateTfrag(
                dataGroup5.lod0.indices,
                dataGroup5.lod0.strips,
                [...dataGroup2.vertexInfoPart1, ...dataGroup4.vertexInfoPart2, ...dataGroup5.vertexInfoPart3],
                [...dataGroup2.vertexPositionsPart1, ...dataGroup4.vertexPositionsPart2, ...dataGroup5.vertexPositionsPart3],
            );
        }
    }

    return {
        header,
        lights,
        rgbas,
        dataGroup1,
        dataGroup2,
        dataGroup3,
        dataGroup4,
        dataGroup5,
    };
}

function validateTfrag(indices: Uint8Array, strips: TfragStrip[], vertexInfo: TfragVertexInfo[], positions: { x: number, y: number, z: number }[]) {
    let stripPtr = 0;
    let vertexPtr = 0;

    outer: while (true) {
        const strip = strips[stripPtr];
        assert(strip !== undefined);

        switch (strip.endOfPacketFlag) {
            case 0: break; // normal strip
            case 0x80: break; // end of packet but not end of this tfrag
            case 0xFF: break outer; // end
            default: throw new Error(`Unknown strip flag`);
        }

        const vertexCount = strip.vertexCount;
        if (vertexCount) {
            for (let i = 0; i < vertexCount; i++) {
                const index = indices[vertexPtr];
                const info = vertexInfo[index];
                assert(info !== undefined);
                assert(info.vertex % 2 === 0);
                assert(info.parent % 2 === 0);
                const position = positions[info.vertex / 2];
                assert(position !== undefined);
                if (info.parent !== 4096) { // 4096 means null
                    const parent = positions[info.parent / 2];
                    assert(parent !== undefined);
                }
                vertexPtr++;
            }
        }

        stripPtr++;
    }
}

export interface TfragVuHeader {
    positionsCommonCount: number,
    positionsLod01Count: number,
    positionsLod0Count: number,
    positionsCommonAddr: number,
    vertexInfoCommonAddr: number,
    vertexInfoLod01Addr: number,
    vertexInfoLod0Addr: number,
    indicesAddr: number,
    parentIndicesLod01Addr: number,
    parentIndicesLod0Addr: number,
    stripsAddr: number,
    textureAdGifsAddr: number,
}
export const SIZEOF_TFRAG_VU_HEADER = 0x28;
export function readTfragVuHeader(view: DataViewExt) {
    /* 
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/tfrag_low.h#L110
    */

    return {
        positionsCommonCount: view.getUint16(0x0),
        positionsLod01Count: view.getUint16(0x4),
        positionsLod0Count: view.getUint16(0x8),
        positionsCommonAddr: view.getUint16(0xc),
        vertexInfoCommonAddr: view.getUint16(0xe),
        vertexInfoLod01Addr: view.getUint16(0x12),
        vertexInfoLod0Addr: view.getUint16(0x16),
        indicesAddr: view.getUint16(0x1a),
        parentIndicesLod01Addr: view.getUint16(0x1c),
        parentIndicesLod0Addr: view.getUint16(0x20),
        stripsAddr: view.getUint16(0x24),
        textureAdGifsAddr: view.getUint16(0x26),
    }
}

export interface TfragAdGifs {
    tex0: GifAd,
    tex1: GifAd,
    clamp: GifAd,
    miptbp1: GifAd,
    miptbp2: GifAd,
};
export const SIZEOF_TFRAG_AD_GIFS = 0x50;
export function readTfragAdGifs(view: DataViewExt): TfragAdGifs {
    /*
    // this is the same as the TieAdGifs version, except the order of the fields is different
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/tfrag_low.h#L75
    */
    return {
        tex0: readGifAdData(view.subview(0x0)),
        tex1: readGifAdData(view.subview(0x10)),
        clamp: readGifAdData(view.subview(0x20)),
        miptbp1: readGifAdData(view.subview(0x30)),
        miptbp2: readGifAdData(view.subview(0x40)),
    }
}

export type TfragVertexInfo = ReturnType<typeof readTfragVertexInfo>;
export const SIZEOF_TFRAG_VERTEX_INFO = 0x8;
export function readTfragVertexInfo(view: DataViewExt) {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/tfrag_low.h#L141
    */

    return {
        s: view.getInt16(0x0),
        t: view.getInt16(0x2),
        parent: view.getInt16(0x4),
        vertex: view.getInt16(0x6),
    };
}

export interface TfragStrip {
    vertexCount: number,
    hasAdGifFlag: number,
    endOfPacketFlag: number,
    adGifOffset: number,
};
export const SIZEOF_TFRAG_STRIP = 0x4;
export function readTfragStrip(view: DataViewExt): TfragStrip {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/tfrag_low.h#L149

    struct TfragStrip {
        uint8 vertexCount : 7;
        uint8 flag : 1;
        uint8 endFlag; // 0x80 = last strip of packet, 0xFF = end
        int8 adGifOffset; // -1 means ignore, not sure why the game would set the flag and then ignore the adGif but it does
    }
    */
    return {
        vertexCount: view.getInt8(0x0) & 0x7f,
        hasAdGifFlag: (view.getInt8(0x0) & 0x80) >> 7,
        endOfPacketFlag: view.getUint8(0x1),
        adGifOffset: view.getInt8(0x2),
    }
}

export const SIZEOF_SHRUB_CLASS_HEADER = 0x40;
export function readShrubClassHeader(view: DataViewExt) {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/shrub.h#L55
    */
    return {
        boundingSphere: view.getFloat32_Xyzw(0x0),
        mipDistance: view.getFloat32(0x10),
        modeBits: view.getUint16(0x14),
        instanceCount: view.getInt16(0x16),
        instancesPointer: view.getInt32(0x18),
        billboardOffset: view.getInt32(0x1c),
        scale: view.getFloat32(0x20),
        oClass: view.getInt16(0x24),
        sClass: view.getInt16(0x26),
        packetCount: view.getInt16(0x28),
        normalsOffset: view.getInt32(0x2c),
        drawnCount: view.getInt16(0x34),
        scisCount: view.getInt16(0x36),
        billboardCount: view.getInt16(0x38),
    }
}

export const SIZEOF_SHRUB_VERTEX_PART1 = 0x8;
export type ShrubVertexPart1 = ReturnType<typeof readShrubVertexPart1>;
export function readShrubVertexPart1(view: DataViewExt) {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/shrub.h#L75
    */
    return {
        x: view.getInt16(0x0),
        y: view.getInt16(0x2),
        z: view.getInt16(0x4),
        gsPacketOffset: view.getInt16(0x6),
    };
}

export const SIZEOF_SHRUB_VERTEX_PART2 = 0x8;
export type ShrubVertexPart2 = ReturnType<typeof readShrubVertexPart2>;
export function readShrubVertexPart2(view: DataViewExt) {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/shrub.h#L82
    */
    return {
        s: view.getInt16(0x0),
        t: view.getInt16(0x2),
        h: view.getInt16(0x4),
        nAndStopCond: view.getInt16(0x6),
    };
}

export interface ShrubPacketHeader {
    textureCount: number,
    gifTagCount: number,
    vertexCount: number,
    vertexOffset: number,
};
export function readShrubPacketHeader(view: DataViewExt): ShrubPacketHeader {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/shrub.h#L89
    */
    return {
        textureCount: view.getInt32(0x0),
        gifTagCount: view.getInt32(0x4),
        vertexCount: view.getInt32(0x8),
        vertexOffset: view.getInt32(0xc),
    }
}

export function readShrubVertexGifTag(view: DataViewExt) {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/shrub.h#L96
    */
    return {
        tag: readShrubGifTag12(view.subview(0x0)),
        gsPacketOffset: view.getInt32(0xc),
    }
}

export function readShrubGifTag12(view: DataViewExt) {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/gif.h#L84
    */
    return {
        low: view.getUint32(0x0),
        high: view.getUint32(0x4),
        regs: view.getUint32(0x8),
    }
}

export interface ShrubTexturePrimitive {
    tex1: GifAd,
    gsPacketOffset: number,
    clamp: GifAd,
    miptbp1: GifAd,
    tex0: GifAd,
}
export const SIZEOF_SHRUB_TEXTURE_PRIMITIVE = 0x40;
export function readShrubTexturePrimitive(view: DataViewExt) {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/shrub.h#L101
    */
    return {
        tex1: readGifAdData(view.subview(0x0)),
        gsPacketOffset: view.getInt32(0xc),
        clamp: readGifAdData(view.subview(0x10)),
        miptbp1: readGifAdData(view.subview(0x20)),
        tex0: readGifAdData(view.subview(0x30)),
    }
}

export interface ShrubVertex {
    x: number;
    y: number;
    z: number;
    s: number;
    t: number;
    h: number; // not sure what h is
    n: number;
    stop: number;
}

export type ShrubImaginaryGsCommand = ImaginaryGsCommand<{ type: GsPrimitiveType }, { adGif: ShrubTexturePrimitive }, ShrubVertex>;

const shrubCommandSize = {
    primitiveReset: 1,
    setMaterial: 5,
    vertex: 3,
}

export function readShrubPacket(view: DataViewExt): ShrubImaginaryGsCommand[] {
    const vifCommands = readVifCommandList(view);
    const unpackReader = new VifUnpackReader(vifCommands);

    // unpack 1 is a header followed by primitives and adgifs
    const unpack1 = unpackReader.next();
    const packetHeader = readShrubPacketHeader(unpack1);
    const gifTags = unpack1.subdivide(0x10, packetHeader.gifTagCount, 0x10).map(readShrubVertexGifTag);
    const adGifs = unpack1.subdivide(0x10 + packetHeader.gifTagCount * 0x10, packetHeader.textureCount, SIZEOF_SHRUB_TEXTURE_PRIMITIVE).map(readShrubTexturePrimitive);

    // unpack 2 is position and write destination
    // unpack 3 is texcoord, normal pointer, and flags
    const part1 = unpackReader.next().subdivide(0, 0xFFFF, SIZEOF_SHRUB_VERTEX_PART1).map(readShrubVertexPart1);
    const part2 = unpackReader.next().subdivide(0, 0xFFFF, SIZEOF_SHRUB_VERTEX_PART2).map(readShrubVertexPart2);
    assert(part1.length === part2.length);

    const imaginaryGsBuffer = new ImaginaryGsCommandBuffer<{ type: GsPrimitiveType }, { adGif: ShrubTexturePrimitive }, ShrubVertex>();

    for (const gifTag of gifTags) {
        const primRegister = getBits(gifTag.tag.high, 15, 25);
        const primitiveType = getBits(primRegister, 0, 2);
        assert(primitiveType === GsPrimitiveType.TRIANGLE || primitiveType === GsPrimitiveType.TRIANGLE_STRIP);
        imaginaryGsBuffer.writePrimitiveReset(gifTag.gsPacketOffset, shrubCommandSize.primitiveReset, { type: primitiveType });
    }

    for (const adGif of adGifs) {
        imaginaryGsBuffer.writeSetMaterial(adGif.gsPacketOffset, shrubCommandSize.setMaterial, { adGif });
    }

    for (let i = 0; i < part1.length; i++) {
        const vertex: ShrubVertex = {
            x: part1[i].x,
            y: part1[i].y,
            z: part1[i].z,
            s: part2[i].s,
            t: part2[i].t,
            h: part2[i].h,
            n: part2[i].nAndStopCond & 0x7fff,
            stop: part2[i].nAndStopCond & 0x8000 ? 1 : 0,
        };
        imaginaryGsBuffer.writeVertex(part1[i].gsPacketOffset, shrubCommandSize.vertex, vertex, true);
    }

    return imaginaryGsBuffer.finish();
}

export interface ShrubClass {
    header: ReturnType<typeof readShrubClassHeader>,
    body: {
        packets: ShrubImaginaryGsCommand[][],
        normals: { x: number, y: number, z: number }[],
    },
};
export function readShrubClass(view: DataViewExt) {
    const header = readShrubClassHeader(view);

    const packetEntries = view.subdivide(SIZEOF_SHRUB_CLASS_HEADER, header.packetCount, 0x8).map(view => view.getInt32PairAs(0, "offset", "size"));
    const packets = packetEntries.map(entry => view.subview(entry.offset, entry.size)).map(readShrubPacket);
    const normals = view.subdivide(header.normalsOffset, 24, 0x8).map(view => view.getInt16_Xyz(0));

    return {
        header,
        body: {
            packets,
            normals,
        },
    }
}

export interface Sky {
    header: SkyHeader,
    textureEntries: SkyTextureEntry[],
    shells: SkyShell[],
}
export function readSky(skyView: DataViewExt): Sky {
    const header = readSkyHeader(skyView);
    const textureEntries = skyView.subdivide(header.textureDefs, header.textureCount, SIZEOF_SKY_TEXTURE_ENTRY).map(readSkyTextureEntry);
    const shells = header.shells.slice(0, header.shellCount).map(offset => readSkyShell(skyView, skyView.subview(offset)));
    return {
        header,
        textureEntries,
        shells,
    }
}

export interface SkyShell {
    header: SkyShellHeader,
    clusters: {
        vertices: SkyVertex[],
        texcoords: SkyTexcoord[],
        rgbas: SkyRgba[],
        triangles: SkyFace[],
    }[],
};
export function readSkyShell(skyView: DataViewExt, skyShellView: DataViewExt): SkyShell {
    const shellHeader = readSkyShellHeader(skyShellView);
    const skyShells: SkyShell = {
        header: shellHeader,
        clusters: [],
    };

    // skip to 0x10
    const clusterHeaders = skyShellView.subdivide(0x10, shellHeader.clusterCount, SIZEOF_SKY_CLUSTER_HEADER).map(readSkyClusterHeader);
    for (const clusterHeader of clusterHeaders) {
        const dataView = skyView.subview(clusterHeader.data);
        const vertexBuffer = dataView.subview(clusterHeader.vertexOffset);
        const vertices = vertexBuffer.subdivide(0, clusterHeader.vertexCount, SIZEOF_SKY_VERTEX).map(readSkyVertex);
        const texcoordsOrRgbaBuffer = dataView.subview(clusterHeader.texcoordsOrRgbasOffset);
        let texcoords: SkyTexcoord[] = [];
        let rgbas: SkyRgba[] = [];
        if (shellHeader.flags.textured) {
            texcoords = texcoordsOrRgbaBuffer.subdivide(0, clusterHeader.vertexCount, SIZEOF_SKY_TEXCOORD).map(readSkyTexcoord);
        } else {
            rgbas = texcoordsOrRgbaBuffer.subdivide(0, clusterHeader.vertexCount, 4).map(view => view.getUint8_Rgba(0));
        }
        const indicesBuffer = dataView.subview(clusterHeader.triOffset);
        const triangles = indicesBuffer.subdivide(0, clusterHeader.triCount, SIZEOF_SKY_FACE).map(readSkyFace);

        for (const triangle of triangles) {
            // make sure it's not mixing texcoords and rgbas
            const expectedTexture = shellHeader.flags.textured ? triangle.texture : 0xFF;
            assert(triangle.texture === expectedTexture);
        }

        skyShells.clusters.push({
            vertices,
            texcoords,
            rgbas,
            triangles,
        });
    }
    return skyShells;
}

export interface SkyHeader {
    skyColor: { r: number, g: number, b: number, a: number },
    clearScreen: number,
    shellCount: number,
    spriteCount: number,
    maximumSpriteCount: number,
    textureCount: number,
    fxCount: number,
    textureDefs: number,
    textureData: number,
    fxList: number,
    sprites: number,
    shells: number[],
};
export const SIZEOF_SKY_HEADER = 0x40;
export function readSkyHeader(view: DataViewExt): SkyHeader {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/sky.h#L59
    */
    return {
        skyColor: view.getUint8_Rgba(0x0),
        clearScreen: view.getInt16(0x04),
        shellCount: view.getInt16(0x06),
        spriteCount: view.getInt16(0x08),
        maximumSpriteCount: view.getInt16(0x0a),
        textureCount: view.getInt16(0x0c),
        fxCount: view.getInt16(0x0e),
        textureDefs: view.getInt32(0x10),
        textureData: view.getInt32(0x14),
        fxList: view.getInt32(0x18),
        sprites: view.getInt32(0x1c),
        shells: view.getArrayOfNumbers(0x20, 8, Int32Array),
    };
}

export interface SkyTextureEntry {
    palette: number,
    dataOffset: number,
    width: number,
    height: number,
};
export const SIZEOF_SKY_TEXTURE_ENTRY = 0x10;
export function readSkyTextureEntry(view: DataViewExt): SkyTextureEntry {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/sky.h#L74
    */
    return {
        palette: view.getInt32(0x0),
        dataOffset: view.getInt32(0x4),
        width: view.getInt32(0x8),
        height: view.getInt32(0xc),
    };
}

export interface SkyShellHeader {
    clusterCount: number,
    flags: {
        textured: boolean,
    },
};
export const SIZEOF_SKY_SHELL_HEADER = 0x8;
export function readSkyShellHeader(view: DataViewExt): SkyShellHeader {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/sky.h#L87C15-L87C34

    Different in rac3+
    */

    const flags = view.getInt32(0x4);

    return {
        clusterCount: view.getInt32(0x0),
        flags: {
            textured: flags & 0x1 ? false : true,
        },
    };
}

export interface SkyClusterHeader {
    boundingSphere: { x: number, y: number, z: number, w: number },
    data: number,
    vertexCount: number,
    triCount: number,
    vertexOffset: number,
    texcoordsOrRgbasOffset: number,
    triOffset: number,
    dataSize: number,
}
export const SIZEOF_SKY_CLUSTER_HEADER = 0x20;
export function readSkyClusterHeader(view: DataViewExt): SkyClusterHeader {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/sky.h#L99
    */
    return {
        boundingSphere: view.getFloat32_Xyzw(0x00),
        data: view.getInt32(0x10),
        vertexCount: view.getInt16(0x14),
        triCount: view.getInt16(0x16),
        vertexOffset: view.getInt16(0x18),
        texcoordsOrRgbasOffset: view.getInt16(0x1a), // <- if flags.textured is true then this is texcoords, otherwise it's rgbas
        triOffset: view.getInt16(0x1c),
        dataSize: view.getInt16(0x1e),
    };
}

export interface SkyVertex {
    x: number;
    y: number;
    z: number;
    alpha: number;
};
export const SIZEOF_SKY_VERTEX = 0x8;
export function readSkyVertex(view: DataViewExt): SkyVertex {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/sky.h#L110
    */
    return {
        x: view.getInt16(0x0),
        y: view.getInt16(0x2),
        z: view.getInt16(0x4),
        alpha: view.getInt16(0x6),
    };
}

// uint8[4]
export interface SkyRgba {
    r: number;
    g: number;
    b: number;
    a: number;
}

export interface SkyTexcoord {
    s: number;
    t: number;
}
export const SIZEOF_SKY_TEXCOORD = 0x4;
export function readSkyTexcoord(view: DataViewExt): SkyTexcoord {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/sky.h#L117
    */
    return {
        s: view.getUint16(0x0),
        t: view.getUint16(0x2),
    };
}

export interface SkyFace {
    indices: number[],
    texture: number,
}
export const SIZEOF_SKY_FACE = 0x4;
export function readSkyFace(view: DataViewExt): SkyFace {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/sky.h#L122
    */
    return {
        indices: view.getArrayOfNumbers(0x0, 3, Uint8Array),
        texture: view.getUint8(0x3),
    };
}

export interface Collision {
    header: CollisionHeader,
    meshGrid: CollisionOctant[],
    heroGroups: HeroCollisionGroups,
};

export function readCollision(view: DataViewExt): Collision {
    const header = readCollisionHeader(view);
    const meshGrid = readCollisionMeshGrid(view.subview(header.mesh));
    const heroGroups = readHeroCollisionGroups(view.subview(header.heroGroups));
    return {
        header,
        meshGrid,
        heroGroups,
    };
}

export interface CollisionHeader {
    mesh: number,
    heroGroups: number,
};
export function readCollisionHeader(view: DataViewExt): CollisionHeader {
    return {
        mesh: view.getInt32(0x0),
        heroGroups: view.getInt32(0x4),
    }
}

export function readCollisionAxis_Z(view: DataViewExt) {
    const count = view.getUint16(0x2);
    const offsets: number[] = [];
    for (let i = 0; i < count; i++) {
        offsets.push(view.getUint16(0x4 + i * 0x2));
    }
    return {
        coord: view.getInt16(0x0),
        count,
        offsets,
    };
}

export function readCollisionAxis_YX(view: DataViewExt) {
    const count = view.getUint16(0x2);
    const offsets: number[] = [];
    for (let i = 0; i < count; i++) {
        offsets.push(view.getInt32(0x4 + i * 0x4));
    }
    return {
        coord: view.getInt16(0x0),
        count,
        offsets,
    };
}

export function readCollisionMeshGrid(view: DataViewExt) {
    const octants: CollisionOctant[] = [];
    const axisZ = readCollisionAxis_Z(view.subview(0x0));
    let worldZ = axisZ.coord * 4 + 2;
    for (let z = 0; z < axisZ.count; z++) {
        const yOffset = axisZ.offsets[z] * 4;
        if (yOffset !== 0) {
            const axisY = readCollisionAxis_YX(view.subview(yOffset));
            let worldY = axisY.coord * 4 + 2;
            for (let y = 0; y < axisY.count; y++) {
                const xOffset = axisY.offsets[y];
                if (xOffset !== 0) {
                    const axisX = readCollisionAxis_YX(view.subview(xOffset));
                    let worldX = axisX.coord * 4 + 2;
                    for (let x = 0; x < axisX.count; x++) {
                        const maxLength16 = axisX.offsets[x] & 0xFF; // the length of the pointed-to data divided by 16, rounded up
                        const octantOffset = axisX.offsets[x] >> 8;
                        if (octantOffset !== 0) {
                            octants.push(readCollisionOctant(view.subview(octantOffset), maxLength16, worldX, worldY, worldZ));
                        }
                        worldX += 4;
                    }
                }
                worldY += 4;
            }
        }
        worldZ += 4;
    }

    return octants;
}

export interface CollisionOctant {
    pos: {
        x: number,
        y: number,
        z: number,
    },
    verts: {
        x: number,
        y: number,
        z: number,
    }[],
    faces: {
        v0: number,
        v1: number,
        v2: number,
        v3: number | null,
        quad: boolean,
        type: number,
    }[],
};
export function readCollisionOctant(view: DataViewExt, maxLength16: number, worldX: number, worldY: number, worldZ: number): CollisionOctant {
    const faceCount = view.getUint16(0x0);
    const vertCount = view.getUint8(0x2);
    const quadCount = view.getUint8(0x3);

    let ptr = 4;

    const verts = view.getArrayOfNumbers(ptr, vertCount, Uint32Array).map(value => {
        return {
            x: ((value << 22) >> 22) / 16,
            y: ((value << 12) >> 22) / 16,
            z: ((value << 0) >> 20) / 64,
        };
    });
    ptr += vertCount * 0x4;

    const faces = view.subdivide(ptr, faceCount, 0x4).map(view => ({
        v0: view.getUint8(0x0),
        v1: view.getUint8(0x1),
        v2: view.getUint8(0x2),
        v3: null as number | null,
        quad: false,
        type: view.getUint8(0x3),
    }));
    ptr += faceCount * 0x4;

    const quads = view.getArrayOfNumbers(ptr, quadCount, Uint8Array);
    for (let i = 0; i < quadCount; i++) {
        const v3Idx = quads[i];
        faces[i].v3 = v3Idx;
        faces[i].quad = true;
    }
    ptr += quadCount * 0x1;

    assert(Math.ceil(ptr / 0x10) === maxLength16);

    return {
        pos: {
            x: worldX,
            y: worldY,
            z: worldZ,
        },
        verts,
        faces,
    };
}

export interface HeroCollisionGroupsHeader {
    count: number,
    groups: {
        boundingSphere: { x: number, y: number, z: number, w: number },
        triangleCount: number,
        vertexCount: number,
        offset: number,
    }[],
};

export function readHeroCollisionGroupsHeader(view: DataViewExt) {
    /*
    struct HeroCollisionGroupsHeader {
        uint32 count;
        uint32 pad[3];
        // 0x10
        struct {
            uint16vec4 boundingSphere;
            uint16 triangle_count;
            uint16 vertex_count;
            uint32 offset;
        } groups[count];
    }
    */

    const count = view.getUint32(0x0);
    const groups = view.subdivide(0x10, count, 0x10).map(view => ({
        boundingSphere: view.getUint16_Xyzw(0x0),
        triangleCount: view.getUint16(0x8),
        vertexCount: view.getUint16(0xa),
        offset: view.getUint32(0xc),
    }));

    return {
        count,
        groups,
    };
}

export interface HeroCollisionGroupData {
    verts: {
        x: number,
        y: number,
        z: number
    }[],
    faces: {
        v0: number,
        v1: number,
        v2: number,
    }[],
};

export interface HeroCollisionGroups {
    header: HeroCollisionGroupsHeader,
    groupData: HeroCollisionGroupData[],
};

export function readHeroCollisionGroups(view: DataViewExt): HeroCollisionGroups {
    const header = readHeroCollisionGroupsHeader(view);
    const groupData = [];
    for (const group of header.groups) {
        const groupView = view.subview(group.offset);
        const verts = groupView.subdivide(0, group.vertexCount, 0x8).map(view => view.getUint16_Xyz(0x0));
        const faces = groupView.subdivide(group.vertexCount * 0x8, group.triangleCount, 0x4).map(view => ({
            v0: view.getUint8(0x0),
            v1: view.getUint8(0x1),
            v2: view.getUint8(0x2),
        }));
        groupData.push({
            verts,
            faces,
        });
    }
    return {
        header,
        groupData,
    }
}
