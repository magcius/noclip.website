import { IS_DEVELOPMENT } from "../BuildVersion";
import { GsPrimitiveType } from "../Common/PS2/GS";
import { DataViewExt, EMPTY_VIEW } from "./DataViewExt";
import { align, assert } from "../util";
import { getBits, GN, ImaginaryGsCommand, ImaginaryGsCommandBuffer, readA1BGR5 } from "./utils";
import { readVifCommandList, VifUnpackReader } from "./vif";
import { VifUnpackFormat } from "../Common/PS2/VIF";
import { DirectionLightSelector, readDirectionLightSelector } from "./bin-gameplay";
import { RAC1_SKY_ANGULAR_VELOCITY, RAC1_SKY_ROTATION } from "./hardcoded";

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
    header: TieClassHeader,
    normalsData: { x: number, y: number, z: number, w: number }[],
    rgbaRemaps: (RgbaRemaps | null)[] | null; // [lod], not present in rac1
    nearDist: number,
    midDist: number,
    farDist: number,
    bsphere: { x: number, y: number, z: number, w: number },
    scale: number,
    packets: TiePacket[][], // [lod][packet]
    adGifs: TieGifAds[],

    // the index of this class within the class list
    _classIndex: number,
};
export interface TiePacket {
    header: TiePacketHeader,
    body: TiePacketBody,
};
export function readTieClass(gn: GN, view: DataViewExt, oClass: number, classIndex: number): TieClass {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/tie.h#L37
    */

    const header = readTieClassHeader(gn, view);

    // `header.packetOffsets[i]` points to `TiePacketHeader packets[header.packetCount[i]]`
    // (relative to this struct)
    const packets: TiePacket[][] = [];

    const adGifs = view.subdivide(header.adGifsOffset, header.textureCount, SIZEOF_TIE_AD_GIFS).map(readTieAdGifs);

    const normalsData = readTieNormalData(gn, view.subview(header.normalsOffset), header.normalsCount);

    const rgbaRemaps: (RgbaRemaps | null)[] = [null, null, null]; // by lod

    // there are always 3 lods
    for (let lod = 0; lod < 3; lod++) {
        const packetOffset = header.packetOffsets[lod];
        const packetCount = header.packetCounts[lod];
        const packetHeaders = view.subdivide(packetOffset, packetCount, SIZEOF_TIE_PACKET_HEADER).map(readTiePacketHeader);

        // packets
        const packetsInThisLod: TiePacket[] = [];
        let baseRgbaRemapSlot = 0;
        for (let j = 0; j < packetCount; j++) {
            const packetDataOffset = packetOffset + packetHeaders[j].data;
            const packetBody = readTiePacketBody(gn, view.subview(packetDataOffset), packetHeaders[j], adGifs, oClass, lod, j, baseRgbaRemapSlot);
            packetsInThisLod.push({
                header: packetHeaders[j],
                body: packetBody,
            });
            baseRgbaRemapSlot += align(packetBody.totalVertexCount, 4); // why align here I have no idea
        }
        packets.push(packetsInThisLod);

        // rgba remaps
        if (gn >= 2) {
            const offset = header.rgbaRemapOffsets![lod];
            assert(offset !== 0);
            if (offset === header.adGifsOffset || header.lodHeaders![lod]!.vertCount === 0) continue;

            const remaps = readTieRgbaRemaps(view.subview(header.normalsOffset + offset), oClass);
            rgbaRemaps[lod] = remaps;
        }
    }


    const tie: TieClass = {
        header,
        normalsData,
        rgbaRemaps,
        nearDist: header.nearDist,
        midDist: header.midDist,
        farDist: header.farDist,
        bsphere: header.bsphere,
        scale: header.scale,
        packets,
        adGifs,

        _classIndex: classIndex,
    };
    return tie;
}

function readTieNormalData(gn: GN, view: DataViewExt, count: number) {
    switch (gn) {
        case 1: {
            return view.subdivide(0, count, 8).map(view => {
                const n = view.getInt16_Xyzw(0);
                const scale = 1 / 0x7FFF;
                return { x: n.x * scale, y: n.y * scale, z: n.z * scale, w: n.w * scale };
            });
        }
        case 2:
        case 3: {
            return view.subdivide(0, count, 8).map(view => readTieNormalEntry_rac234(view));
        }
        case 4: {
            return view.subdivide(0x10, count, 8).map(view => readTieNormalEntry_rac234(view));
        }
    }
}

function readTieNormalEntry_rac234(view: DataViewExt) {
    /*
    struct TieNormalEntry {
        uint8 x;
        uint8 y;
        uint8 z;
        uint8 w;
        uint8 unknown5;
        uint8 scale;
        uint8 elevation; // xyzw and elevation/azimuth are redundant, idk why, I'll use the second
        uint8 azimuth;
    }
    */
    const angleScale = 2 * Math.PI / 256;
    const elevation = view.getUint8(0x6) * angleScale;
    const azimuth = view.getUint8(0x7) * angleScale;

    return {
        x: azimuth,
        y: elevation,
        z: 0,
        w: 0,
    }
}

export interface RgbaRemap {
    dest: number,
    src: [number, number, number, number] | 0,
    kind: RgbaRemapKind,
}
export enum RgbaRemapKind {
    Zero = 0,
    AAAA = 1,
    AABB = 2,
    AAAB = 3,
    AABC = 4,
    ABCD = 5,
}
export interface RgbaRemapPacketDescriptor {
    aaaaSize: number;
    aabbSize: number;
    aaabSize: number;
    aabcSize: number;
    abcdSize: number;
    zeroSize: number;
    outputSize: number;
    packetSize: number;
}
export interface RgbaRemapPacket {
    outputBase: number,
    remaps: RgbaRemap[],
}
export interface RgbaRemaps {
    packets: RgbaRemapPacket[],
}

// needs more reverse engineering work
// I can parse the headers but no idea what the inner data is
export function readTieRgbaRemaps(view: DataViewExt, oClass: number): RgbaRemaps {
    const blockSizes = view.getArrayOfNumbers(0x0, 32, Uint8Array).map(size => size * 0x10);

    let base = 0;
    const packets: RgbaRemapPacket[] = [];

    let packetView = view.subview(0x20);
    for (let i = 0; i < blockSizes.length; i++) {
        const packetSizeBytes = blockSizes[i];
        if (packetSizeBytes === 0) break;

        const descriptor = {
            aaaaSize: packetView.getUint16(0x0),
            aabbSize: packetView.getUint16(0x2),
            aaabSize: packetView.getUint16(0x4),
            aabcSize: packetView.getUint16(0x6),
            abcdSize: packetView.getUint16(0x8),
            zeroSize: packetView.getUint16(0xa),
            outputSize: packetView.getUint16(0xc), // <- in units of 0x10
            packetSize: packetView.getUint16(0xe), // <- in bytes
        };

        assert(descriptor.aaaaSize % 4 === 0);
        assert(descriptor.aabbSize % 4 === 0);
        assert(descriptor.aaabSize % 4 === 0);
        assert(descriptor.aabcSize % 8 === 0);
        assert(descriptor.abcdSize % 8 === 0);

        let ptr = 0x10;

        const aaaaView = descriptor.aaaaSize ? packetView.subview(ptr, descriptor.aaaaSize) : EMPTY_VIEW;
        ptr += descriptor.aaaaSize;
        const aabbView = descriptor.aabbSize ? packetView.subview(ptr, descriptor.aabbSize) : EMPTY_VIEW;
        ptr += descriptor.aabbSize;
        const aaabView = descriptor.aaabSize ? packetView.subview(ptr, descriptor.aaabSize) : EMPTY_VIEW;
        ptr += descriptor.aaabSize;
        const aabcView = descriptor.aabcSize ? packetView.subview(ptr, descriptor.aabcSize) : EMPTY_VIEW;
        ptr += descriptor.aabcSize;
        const abcdView = descriptor.abcdSize ? packetView.subview(ptr, descriptor.abcdSize) : EMPTY_VIEW;
        ptr += descriptor.abcdSize;
        const zeroView = descriptor.zeroSize ? packetView.subview(ptr, descriptor.zeroSize) : EMPTY_VIEW;
        ptr += descriptor.zeroSize;
        ptr = align(ptr, 0x10);
        assert(ptr === descriptor.packetSize);
        assert(ptr === packetSizeBytes);

        // unsure about any of this

        // everything here is an 11-bit int divisible by 4

        // AAAA
        const aaaaRemaps: RgbaRemap[] = aaaaView.subdivide(0, 0xFFFF, 4).map((view): RgbaRemap => {
            const a = view.getUint16(0x0) & 0x7FF;
            assert(a % 4 === 0);
            const dest = view.getUint16(0x2);
            assert(dest % 4 === 0);
            return { dest, src: [a, a, a, a], kind: RgbaRemapKind.AAAA };
        });

        // AABB
        const aabbRemaps: RgbaRemap[] = aabbView.subdivide(0, 0xFFFF, 4).map(view => {
            const packed = view.getUint32(0x0);
            const dest = packed & 0x7FF;
            assert(dest % 4 === 0);
            const a = (packed >> 21) & 0x7FC;
            const b = (packed >> 12) & 0x7FC;
            return { dest, src: [a, a, b, b], kind: RgbaRemapKind.AABB };
        });

        // AAAB
        const aaabRemaps: RgbaRemap[] = aaabView.subdivide(0, 0xFFFF, 4).map(view => {
            const packed = view.getUint32(0x0);
            const dest = packed & 0x7FF;
            assert(dest % 4 === 0);
            const a = (packed >> 21) & 0x7FC;
            const b = (packed >> 12) & 0x7FC;
            return { dest, src: [a, a, a, b], kind: RgbaRemapKind.AAAB };
        });

        // AABC
        const aabcRemaps: RgbaRemap[] = aabcView.subdivide(0, 0xFFFF, 8).map(view => {
            const a = view.getUint16(0x0) & 0x7FF;
            assert(a % 4 === 0);
            const b = view.getUint16(0x2) & 0x7FF;
            assert(b % 4 === 0);
            const c = view.getUint16(0x4) & 0x7FF;
            assert(c % 4 === 0);
            const dest = view.getUint16(0x6) & 0x7FF;
            assert(dest % 4 === 0);
            return { dest, src: [a, a, b, c], kind: RgbaRemapKind.AABC };
        });

        // ABCD
        const abcdRemaps: RgbaRemap[] = abcdView.subdivide(0, 0xFFFF, 8).map(view => {
            const packed = view.getUint32(0x0);
            const a = packed & 0x7FF;
            assert(a % 4 === 0);
            const b = (packed >> 9) & 0x7FC;
            const c = (packed >> 18) & 0x7FC;
            const d = view.getUint16(0x4) & 0x7FF;
            assert(d % 4 === 0);
            const dest = view.getUint16(0x6) & 0x7FF;
            assert(dest % 4 === 0);
            return { dest, src: [a, b, c, d], kind: RgbaRemapKind.ABCD };
        });

        // zero
        const zeroRemaps: RgbaRemap[] = zeroView.subdivide(0, 0xFFFF, 8).map(view => {
            const dest = view.getUint16(0x0) & 0x7FF;
            assert(dest % 4 === 0);
            return { dest, src: 0, kind: RgbaRemapKind.Zero };
        });

        const allRemaps = [aaaaRemaps, aabbRemaps, aaabRemaps, aabcRemaps, abcdRemaps, zeroRemaps].flat(1);

        packets.push({
            outputBase: base,
            remaps: allRemaps,
        });

        packetView = packetView.subview(packetSizeBytes);

        base += descriptor.outputSize * 0x10;
    }

    return {
        packets
    }
}

export type TieClassHeader = {
    packetOffsets: number[],
    packetCounts: number[],
    textureCount: number,
    nearDist: number,
    midDist: number,
    farDist: number,
    adGifsOffset: number,
    instanceIndex: number,
    cacheSizes: number[],
    rgbaRemapOffsets: number[],
    ambientRgbasOffset: number,
    normalsOffset: number,
    normalsCount: number,
    ambientSize: number,
    /**
     * Seems to affect what the alpha channel does
     * 0x2 = wind effect?
     * 0x4 = another wind effect?
     * 0x10 = glow?
     * 0x20 = specular mask?
     * 0x40 = no idea (used on enemy spawners on rac3 veldin)
     */
    modeBits: number,
    instanceCount: number,
    scale: number,
    oClass: number,
    tClass: number,
    mipDist: number,
    glowRgba: { r: number, g: number, b: number, a: number },
    bsphere: { x: number, y: number, z: number, w: number },
    lodHeaders: (TieLodHeader | null)[],
    glowRemapOffsets: number[],
}
export function readTieClassHeader(gn: GN, view: DataViewExt): TieClassHeader {
    switch (gn) {
        case 1: {
            /*
            https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/tie.h#L37
            */
            return {
                packetOffsets: view.getArrayOfNumbers(0x0, 3, Uint32Array),
                normalsOffset: view.getUint32(0xc),
                nearDist: view.getFloat32(0x10),
                midDist: view.getFloat32(0x14),
                farDist: view.getFloat32(0x18),
                packetCounts: view.getArrayOfNumbers(0x20, 3, Uint8Array),
                textureCount: view.getUint8(0x23),
                modeBits: view.getInt16(0x24),
                adGifsOffset: view.getUint32(0x2c),
                bsphere: view.getFloat32_Xyzw(0x30),
                scale: view.getFloat32(0x40),

                // fields definitely not in rac1
                normalsCount: 64, // always 64 normals in rac1
                rgbaRemapOffsets: [0, 0, 0],
                cacheSizes: [],
                ambientRgbasOffset: 0,

                // fields that probably exist but idk where
                lodHeaders: [null, null, null],
                instanceIndex: 0,
                ambientSize: 0,
                instanceCount: 0,
                oClass: 0,
                tClass: 0,
                mipDist: 0,
                glowRgba: { r: 0, g: 0, b: 0, a: 0 },
                glowRemapOffsets: []
            };
        }
        case 2:
        case 3:
        case 4: {
            /*
            https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/tie.h#L64
            */
            return {
                packetOffsets: view.getArrayOfNumbers(0x0, 3, Uint32Array),
                packetCounts: view.getArrayOfNumbers(0xc, 3, Uint8Array),
                textureCount: view.getUint8(0xf),
                nearDist: view.getFloat32(0x10),
                midDist: view.getFloat32(0x14),
                farDist: view.getFloat32(0x18),
                adGifsOffset: view.getInt32(0x1c),
                instanceIndex: view.getInt32(0x20),
                cacheSizes: view.getArrayOfNumbers(0x24, 3, Uint16Array),
                rgbaRemapOffsets: view.getArrayOfNumbers(0x2a, 3, Uint16Array),
                ambientRgbasOffset: view.getInt32(0x30),
                normalsOffset: view.getInt32(0x34),
                normalsCount: view.getInt16(0x38),
                ambientSize: view.getInt16(0x3a),
                modeBits: view.getInt16(0x3c),
                instanceCount: view.getInt16(0x3e),
                scale: view.getFloat32(0x40),
                oClass: view.getInt16(0x44),
                tClass: view.getInt16(0x46),
                mipDist: view.getFloat32(0x48),
                glowRgba: view.getUint8_Rgba(0x4c),
                bsphere: view.getFloat32_Xyzw(0x50),
                lodHeaders: view.subdivide(0x60, 3, SIZEOF_TIE_LOD_HEADER).map(readTieLodHeader),
                glowRemapOffsets: view.getArrayOfNumbers(0x78, 3, Uint16Array),
            };
        }
    }
}

export type TieLodHeader = {
    vertCount: number,
    triCount: number,
    stripCount: number,
};
export const SIZEOF_TIE_LOD_HEADER = 0x8;
export function readTieLodHeader(view: DataViewExt) {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/tie.h#L30
    */
    return {
        vertCount: view.getInt16(0x0),
        triCount: view.getInt16(0x2),
        stripCount: view.getInt16(0x4),
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

export interface TieVertexWithNormalAndRgba {
    writeOrder: number, // the order in which the vertex was copied from the uploaded data to the GS packet buffer
    vertex: TieVertex,
    normalIndices: [number, number, number],
    rgbaIndices: [number, number, number],
};
export type TieImaginaryGsCommand = ImaginaryGsCommand<TieStrip, { material: number, clamp: number }, TieVertexWithNormalAndRgba>;

const tieCommandSizes = {
    primitiveReset: 1,
    setMaterial: 6,
    vertex: 3,
};

export type TiePacketBody = ReturnType<typeof readTiePacketBody>;
export function readTiePacketBody(gn: GN, view: DataViewExt, tiePacketHeader: TiePacketHeader, adGifs: TieGifAds[], oClass: number, lod: number, packetIndex: number, baseRgbaRemapSlot: number) {
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
        if (gn === 1) {
            // align 0x10
            uint8 regularNormalIndices[tieVuHeader.regularVertexCount];
            // align 0x4
            uint8vec4 morphingNormalIndices[tieVuHeader.morphingVertexCount];
            // align 0x10
            uint8 regularRgbaIndices[tieVuHeader.regularVertexCount];
            // align 0x4
            uint8vec4 morphingRgbaIndices[tieVuHeader.morphingVertexCount];
        }
        // align 0x10
        uint8 stripControlBytes[until the (stripCount + 1)'th flag that is either 0x7, 0xFC, or 0xF6];
    }
    */

    let ptr = 0;

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
    ptr = align(ptr, 0x10);
    const regularVertexCount = tieVuHeader.regularVertexCount;
    const regularVerts = view.subdivide(ptr, regularVertexCount, SIZEOF_TIE_REGULAR_VERTEX).map(readTieRegularVertex);
    ptr += regularVertexCount * SIZEOF_TIE_REGULAR_VERTEX;

    // morphing verts
    const morphingVertexCount = tieVuHeader.morphingVertexCount;
    const morphingVerts = view.subdivide(ptr, morphingVertexCount, SIZEOF_TIE_MORPHING_VERTEX).map(readTieMorphingVertex);
    ptr += morphingVertexCount * SIZEOF_TIE_MORPHING_VERTEX;

    // normal and rgba indices for rac1 only
    let regularNormalIndices: number[] = [];
    let morphingNormalIndices: { x: number, y: number, z: number }[] = [];
    let regularRgbaIndices: number[] = [];
    let morphingRgbaIndices: { x: number, y: number, z: number }[] = [];
    if (gn === 1) {
        // indices into the tie's normal array
        ptr = align(ptr, 0x10);
        regularNormalIndices = view.subdivide(ptr, tieVuHeader.regularVertexCount, 0x1).map(view => view.getUint8(0));
        ptr += tieVuHeader.regularVertexCount * 0x1;
        ptr = align(ptr, 0x4);
        morphingNormalIndices = view.subdivide(ptr, tieVuHeader.morphingVertexCount, 0x4).map(view => view.getUint8_Xyz(0));
        ptr += tieVuHeader.morphingVertexCount * 0x4;

        // indices into the instance's rgba array
        ptr = align(ptr, 0x10);
        regularRgbaIndices = view.subdivide(ptr, tieVuHeader.regularVertexCount, 0x1).map(view => view.getUint8(0));
        ptr += tieVuHeader.regularVertexCount * 0x1;
        ptr = align(ptr, 0x4);
        morphingRgbaIndices = view.subdivide(ptr, tieVuHeader.morphingVertexCount, 0x4).map(view => view.getUint8_Xyzw(0));
        ptr += tieVuHeader.morphingVertexCount * 0x4;
    }

    ptr = align(ptr, 0x10);
    const stripControlBytes: number[] = [];
    let stripCount = tieVuHeader.stripCount + 1;
    while (true) {
        const flag = view.getUint8(ptr++);
        if (flag == 0x7 || flag == 0xFC || flag == 0xF6) {
            stripCount--;
            stripControlBytes.push(flag);
            if (stripCount === 0) break;
        } else if (flag == 0x3) {
            stripControlBytes.push(flag);
        } else {
            assert(false);
        }
    }

    const imaginaryGsBuffer = new ImaginaryGsCommandBuffer<TieStrip, { material: number, clamp: number }, TieVertexWithNormalAndRgba>();

    // first command always sets the material to the first material
    const firstMaterialId = adGifSrcOffsets[0] / SIZEOF_TIE_AD_GIFS;
    const firstAdGif = adGifs[firstMaterialId];
    const firstClamp = firstAdGif.clamp.low + (firstAdGif.clamp.high << 2);
    imaginaryGsBuffer.writeSetMaterial(0, tieCommandSizes.setMaterial, { material: firstMaterialId, clamp: firstClamp });

    let vertexWriteOrder = baseRgbaRemapSlot;

    // Write verts into command buffer
    // Some are written twice.
    for (let i = 0; i < regularVerts.length; i++) {
        const vertex = regularVerts[i];
        let normalIndices: [number, number, number] = [0, 0, 0];
        let rgbaIndices: [number, number, number] = [0, 0, 0];
        if (gn === 1) {
            normalIndices = [regularNormalIndices[i], regularNormalIndices[i], regularNormalIndices[i]];
            rgbaIndices = [regularRgbaIndices[i] - 64, regularRgbaIndices[i] - 64, regularRgbaIndices[i] - 64];
        } else {
            // TODO: rgba remaps for rac2
        }
        const commandValue: TieVertexWithNormalAndRgba = {
            writeOrder: vertexWriteOrder++,
            vertex,
            normalIndices,
            rgbaIndices,
        };
        imaginaryGsBuffer.writeVertex(vertex.gsPacketWriteOffset, tieCommandSizes.vertex, commandValue, true);
        if (vertex.gsPacketWriteOffset2 !== 0 && vertex.gsPacketWriteOffset !== vertex.gsPacketWriteOffset2) {
            imaginaryGsBuffer.writeVertex(vertex.gsPacketWriteOffset2, tieCommandSizes.vertex, commandValue, true);
        }
    }
    for (let i = 0; i < morphingVerts.length; i++) {
        const vertex = morphingVerts[i];
        let normalIndices: [number, number, number] = [0, 0, 0];
        let rgbaIndices: [number, number, number] = [0, 0, 0];
        if (gn === 1) {
            normalIndices = [
                morphingNormalIndices[i].x,
                morphingNormalIndices[i].y,
                morphingNormalIndices[i].z,
            ];
            rgbaIndices = [
                morphingRgbaIndices[i].x - 64,
                morphingRgbaIndices[i].y - 64,
                morphingRgbaIndices[i].z - 64,
            ];
        } else {
            // TODO: rgba remaps for rac2
        }
        const commandValue: TieVertexWithNormalAndRgba = {
            writeOrder: vertexWriteOrder++,
            vertex,
            normalIndices,
            rgbaIndices,
        };
        imaginaryGsBuffer.writeVertex(vertex.gsPacketWriteOffset, tieCommandSizes.vertex, commandValue, true);
        if (vertex.gsPacketWriteOffset2 !== 0 && vertex.gsPacketWriteOffset !== vertex.gsPacketWriteOffset2) {
            imaginaryGsBuffer.writeVertex(vertex.gsPacketWriteOffset2, tieCommandSizes.vertex, commandValue, true);
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
        totalVertexCount: regularVertexCount + morphingVertexCount,
        regularVertexCount,
        regularVerts,
        morphingVerts,
        regularNormalIndices,
        morphingNormalIndices,
        regularRgbaIndices,
        morphingRgbaIndices,
        stripControlBytes,
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
    offset: number,
    azimuth: number,
    elevation: number,
    ambientColor: { a: number, r: number, g: number, b: number },
    lightSelector: DirectionLightSelector,
};
export const SIZEOF_TFRAG_LIGHT = 0x8;
export function readTfragLight(view: DataViewExt): TfragLight {
    /*
    struct TfragLight {
        uint16 offset; // byte offset into the vertex array, not needed
        int8 azimuth;
        int8 elevation;
        uint16 ambientColor;
        uint16 lightSelector;
    }
    */

    return {
        offset: view.getUint16(0x0),
        azimuth: view.getInt8(0x2),
        elevation: view.getInt8(0x3),
        ambientColor: readA1BGR5(view.subview(0x4)),
        lightSelector: readDirectionLightSelector(view.subview(0x6)),
    }
}

export interface TfragLod {
    indices: Uint8Array,
    strips: TfragStrip[],
};

export interface Tfrag {
    header: TfragHeader,
    // actual lighting input
    lights: TfragLight[],
    // precomputed lit colors (should match lighting result)
    rgbas: { r: number, g: number, b: number, a: number }[],
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

export function readTfrag(view: DataViewExt, header: TfragHeader, tfragNumber: number) {
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
        if (unpackReader.hasNext() && unpackReader.peekNextVnvl() === VifUnpackFormat.V4_16) {
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
    header: SkyHeader | null, // sky is optional
    textureEntries: SkyTextureEntry[],
    shells: SkyShell[],
}
export function readSky(gn: GN, levelNumber: number, skyView: DataViewExt): Sky {
    const header = readSkyHeader(skyView);
    const textureEntries = skyView.subdivide(header.textureDefs, header.textureCount, SIZEOF_SKY_TEXTURE_ENTRY).map(readSkyTextureEntry);
    const shells = header.shells.slice(0, header.shellCount).map((offset, i) => readSkyShell(gn, levelNumber, skyView, skyView.subview(offset), i));
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
export function readSkyShell(gn: GN, levelNumber: number, skyView: DataViewExt, skyShellView: DataViewExt, shellIndex: number): SkyShell {
    const shellHeader = readSkyShellHeader(gn, levelNumber, skyShellView, shellIndex);
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

        // the texcoords and rgbas are the same memory interpreted differently
        // triangle.texture controls which one is used on a per-triangle basis
        const texcoordsOrRgbaBuffer = dataView.subview(clusterHeader.texcoordsOrRgbasOffset);
        const texcoords = texcoordsOrRgbaBuffer.subdivide(0, clusterHeader.vertexCount, SIZEOF_SKY_TEXCOORD).map(readSkyTexcoord);
        const rgbas = texcoordsOrRgbaBuffer.subdivide(0, clusterHeader.vertexCount, 4).map(view => view.getUint8_Rgba(0));

        const indicesBuffer = dataView.subview(clusterHeader.triOffset);
        const triangles = indicesBuffer.subdivide(0, clusterHeader.triCount, SIZEOF_SKY_FACE).map(readSkyFace);

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
        bloom: boolean,
    },
    rotation: { x: number, y: number, z: number } | null;
    angularVelocity: { x: number, y: number, z: number } | null;
};
export const SIZEOF_SKY_SHELL_HEADER = (gn: GN) => {
    switch (gn) {
        case 1:
        case 2: return 0x8;
        case 3:
        case 4: return 0x10;
    }
    assert(false);
}
export function readSkyShellHeader(gn: GN, levelNumber: number, view: DataViewExt, shellIndex: number): SkyShellHeader {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/sky.h#L87C15-L87C34
    */

    switch (gn) {
        case 1: {
            const flags = view.getInt32(0x4);

            return {
                clusterCount: view.getInt32(0x0),
                flags: {
                    textured: flags === 0,
                    bloom: false,
                },
                rotation: RAC1_SKY_ROTATION.get(levelNumber)?.find(item => item.shell === shellIndex)?.rotation ?? null,
                angularVelocity: RAC1_SKY_ANGULAR_VELOCITY.get(levelNumber)?.find(item => item.shell === shellIndex)?.angularVelocity ?? null,
            };
        }
        case 2: {
            const flags = view.getInt32(0x4);

            return {
                clusterCount: view.getInt32(0x0),
                flags: {
                    textured: flags === 0,
                    bloom: false,
                },
                rotation: null,
                angularVelocity: null
            };
        }
        case 3:
        case 4: {
            const flags = view.getInt16(0x2);

            return {
                clusterCount: view.getInt16(0x0),
                flags: {
                    textured: !(flags & 0x1),
                    bloom: !!(flags & 0x2),
                },
                rotation: view.getInt16_Xyz(0x4),
                angularVelocity: view.getInt16_Xyz(0xa),
            };
        }
        default: {
            assert(false);
        }
    }
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
    heroGroups: HeroCollisionGroups | null,
};

export function readCollision(view: DataViewExt): Collision {
    const header = readCollisionHeader(view);
    const meshGrid = readCollisionMeshGrid(view.subview(header.mesh));
    const heroGroups = header.heroGroups ? readHeroCollisionGroups(view.subview(header.heroGroups)) : null;
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

export function readHeroCollisionGroups(view: DataViewExt): HeroCollisionGroups | null {
    const header = readHeroCollisionGroupsHeader(view);
    if (!header.count) return null;
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

export type MobyClass = {
    oClass: number,
    header: MobyClassHeader,
    mesh: MobyMesh | null,
    bangles: MobyBangles | null,
};
export function readMobyClass(gn: GN, view: DataViewExt, oClass: number): MobyClass {
    const header = readMobyClassHeader(view);

    // downgrade to rac1 format in rac2 if the flag is set
    let meshGn = gn;
    if (gn === 2 && header.rac12ByteB !== 0) meshGn = 1;

    let mesh: MobyMesh | null = null;
    if (header.packetTableOffset !== 0) {
        mesh = readMobyMesh(meshGn, view, header.packetTableOffset, header.meshInfo);
    }

    let bangles: MobyBangles | null = null;
    if (header.bangles) {
        assert(meshGn !== 1); // no bangles in rac1
        bangles = readMobyBangles(gn, view, header.bangles * 0x10, header.packetTableOffset);
    }

    return {
        oClass,
        header,
        mesh,
        bangles
    };
}

export type MobyClassHeader = {
    packetTableOffset: number,
    meshInfo: MobyMeshInfo,
    jointCount: number,
    unknown9: number,
    rac1ByteA: number,
    rac12ByteB: number, // rac12 -> if 0 use rac2 format, else use rac1 format; rac34 -> team textures
    sequenceCount: number,
    soundCount: number,
    lodTrans: number,
    shadow: number,
    collision: number,
    skeleton: number,
    commonTrans: number,
    joints: number,
    gifUsage: number,
    scale: number,
    soundDefs: number,
    bangles: number,
    mipDist: number,
    corncob: number,
    boundingSphere: { x: number, y: number, z: number, w: number },
    glowRgba: number,
    modeBits: number,
    type: number,
    modeBits2: number,
}
export const SIZEOF_MOBY_CLASS = 0x48;
export function readMobyClassHeader(view: DataViewExt): MobyClassHeader {
    /*
    https://github.com/chaoticgd/wrench/blob/ba12611f5e5b54733fd807f17b3210fd0248f996/src/engine/moby_low.h#L138
    */
    return {
        packetTableOffset: view.getInt32(0x0),
        meshInfo: readMobyMeshInfo(view.subview(0x4)),
        jointCount: view.getUint8(0x8),
        unknown9: view.getUint8(0x9),
        rac1ByteA: view.getUint8(0xa),
        rac12ByteB: view.getUint8(0xb),
        sequenceCount: view.getUint8(0xc),
        soundCount: view.getUint8(0xd),
        lodTrans: view.getUint8(0xe),
        shadow: view.getUint8(0xf),
        collision: view.getInt32(0x10),
        skeleton: view.getInt32(0x14),
        commonTrans: view.getInt32(0x18),
        joints: view.getInt32(0x1c),
        gifUsage: view.getInt32(0x20),
        scale: view.getFloat32(0x24),
        soundDefs: view.getInt32(0x28),
        bangles: view.getUint8(0x2c),
        mipDist: view.getUint8(0x2d),
        corncob: view.getInt16(0x2e),
        boundingSphere: view.getFloat32_Xyzw(0x30),
        glowRgba: view.getInt32(0x40),
        modeBits: view.getInt16(0x44),
        type: view.getUint8(0x46),
        modeBits2: view.getUint8(0x47),
    };
}

export type MobyMeshInfo = {
    highLodCount: number,
    lowLodCount: number,
    metalCount: number,
    metalBegin: number,
};

export function readMobyMeshInfo(view: DataViewExt): MobyMeshInfo {
    /*
    https://github.com/chaoticgd/wrench/blob/ba12611f5e5b54733fd807f17b3210fd0248f996/src/engine/moby_low.h#L131
    */
    return {
        highLodCount: view.getUint8(0x0),
        lowLodCount: view.getUint8(0x1),
        metalCount: view.getUint8(0x2),
        metalBegin: view.getUint8(0x3),
    }
}

export interface MobyBangles {
    header: MobyBanglesHeader,
    bangles: MobyBangle[],
}
export interface MobyBangle {
    packetsByLod: [MobyMeshPacket[], MobyMeshPacket[]],
}
export function readMobyBangles(gn: GN, mobyView: DataViewExt, banglesOffset: number, packetTableOffset: number): MobyBangles {
    const header = readMobyBanglesHeader(mobyView.subview(banglesOffset));
    let bangles: MobyBangle[] = [];
    for (let i = 0; i < header.bangleDescriptors.length; i++) {
        const bangleDescriptor = header.bangleDescriptors[i];
        if (!bangleDescriptor) continue;

        let packetsLod0: MobyMeshPacket[] = [];
        if (bangleDescriptor.lod0Count > 0) {
            const bangleOffset = packetTableOffset + bangleDescriptor.lod0Offset * 0x10;
            const packetHeaders = mobyView.subdivide(bangleOffset, bangleDescriptor.lod0Count, SIZEOF_MOBY_MESH_PACKET_HEADER).map(readMobyMeshPacketHeader);
            packetsLod0 = packetHeaders.map(packetHeader => readMobyMeshPacket(gn, mobyView, packetHeader, true));
        }

        let packetsLod1: MobyMeshPacket[] = [];
        if (bangleDescriptor.lod1Count > 0) {
            const bangleOffset = packetTableOffset + bangleDescriptor.lod1Offset * 0x10;
            const packetHeaders = mobyView.subdivide(bangleOffset, bangleDescriptor.lod1Count, SIZEOF_MOBY_MESH_PACKET_HEADER).map(readMobyMeshPacketHeader);
            packetsLod1 = packetHeaders.map(packetHeader => readMobyMeshPacket(gn, mobyView, packetHeader, true));
        }

        if (packetsLod0.length || packetsLod1.length) {
            bangles.push({
                packetsByLod: [packetsLod0, packetsLod1],
            });
        }
    }
    return {
        header,
        bangles,
    };
}

export interface MobyBangleDescriptor {
    lod0Offset: number;
    lod0Count: number;
    lod1Offset: number;
    lod1Count: number;
}
export interface MobyBanglesHeader {
    unknown0: number,
    bangleDescriptors: (MobyBangleDescriptor | null)[],
}
export function readMobyBanglesHeader(view: DataViewExt) {
    let ptr = 0;
    const unknown0 = view.getUint16(0); // ??
    const enabledBanglesBitmask = view.getUint16(2);
    ptr += 4;
    const bangleDescriptors: (MobyBangleDescriptor | null)[] = []
    for (let i = 0; i < 15; i++) {
        if (enabledBanglesBitmask & (1 << i)) {
            bangleDescriptors.push({
                lod0Offset: view.getUint8(ptr + 0x0),
                lod0Count: view.getUint8(ptr + 0x1),
                lod1Offset: view.getUint8(ptr + 0x2),
                lod1Count: view.getUint8(ptr + 0x3),
            });
        } else {
            bangleDescriptors.push(null);
        }
        ptr += 4;
    }

    return {
        unknown0,
        bangleDescriptors,
    }
}

export interface MobyMesh {
    packetHeaders: MobyMeshPacketHeader[],
    packetsByLod: [MobyMeshPacket[], MobyMeshPacket[]],
};
export function readMobyMesh(gn: GN, mobyView: DataViewExt, packetTableOffset: number, meshInfo: MobyMeshInfo): MobyMesh {
    const packetHeaders = mobyView.subdivide(packetTableOffset, meshInfo.highLodCount + meshInfo.lowLodCount, SIZEOF_MOBY_MESH_PACKET_HEADER).map(readMobyMeshPacketHeader);
    const packets = packetHeaders.map(packetHeader => readMobyMeshPacket(gn, mobyView, packetHeader, false));
    const packetsLod0 = packets.slice(0, meshInfo.highLodCount);
    const packetsLod1 = packets.slice(meshInfo.highLodCount);
    // TODO: read metal packets

    return {
        packetHeaders,
        packetsByLod: [packetsLod0, packetsLod1],
    };
}

export type MobyMeshPacketHeader = {
    vifListOffset: number,
    vifListSize: number,
    vifListTextureUnpackOffset: number,
    vertexOffset: number,
    vertexDataSize: number,
    unknownD: number,
    unknownE: number,
    transferVertexCount: number,
};
export const SIZEOF_MOBY_MESH_PACKET_HEADER = 0x10;
export function readMobyMeshPacketHeader(view: DataViewExt): MobyMeshPacketHeader {
    /**
     * https://github.com/chaoticgd/wrench/blob/master/src/engine/moby_packet.h#L83
     */
    return {
        vifListOffset: view.getInt32(0x0),
        vifListSize: view.getUint16(0x4),
        vifListTextureUnpackOffset: view.getUint16(0x6),
        vertexOffset: view.getInt32(0x8),
        vertexDataSize: view.getUint8(0xc),
        unknownD: view.getUint8(0xd),
        unknownE: view.getUint8(0xe),
        transferVertexCount: view.getUint8(0xf),
    };
}

export interface MobyMeshPacket {
    texcoords: { s: number, t: number }[],
    indicesHeader: MobyIndicesHeader,
    indices: Int8Array,
    secretIndices: number[],
    textures: MobyTexturePrimitive[],
    vertices: MobyVertex[],
    duplicateVertices: number[],
    isBanglePacket: boolean,
};
export function readMobyMeshPacket(meshGn: GN, mobyView: DataViewExt, packetHeader: MobyMeshPacketHeader, isBanglePacket: boolean): MobyMeshPacket {
    const vifCommands = readVifCommandList(mobyView.subview(packetHeader.vifListOffset, packetHeader.vifListSize * 0x10));
    const unpackReader = new VifUnpackReader(vifCommands);

    const unpack1 = unpackReader.next();
    const texcoords = unpack1.subdivide(0, 0xFFFF, 0x4).map(view => ({
        s: view.getInt16(0x0),
        t: view.getInt16(0x2),
    }));

    const unpack2 = unpackReader.next();
    const indicesHeader = readMobyIndicesHeader(unpack2);
    const indices = unpack2.subview(0x4).getTypedArrayView(Int8Array);

    let textures: MobyTexturePrimitive[] = [];

    // more unhinged behavior -
    // secret indices are a secondary index buffer, when the regular index buffer contains a 0,
    // the next secret index is used instead and the next texture is used
    // but if the secret index is also 0 that means the end of the mesh was 3 verts earlier.
    let secretIndices: number[] = [indicesHeader.secretIndex];

    assert(!!packetHeader.vifListTextureUnpackOffset === !!unpackReader.hasNext());
    if (packetHeader.vifListTextureUnpackOffset) {
        const unpack3 = unpackReader.next();
        assert(unpack3.byteLength % 0x40 === 0);
        const res = readMobyTexturePrimitives(unpack3);
        textures = res.textures;
        secretIndices = secretIndices.concat(res.secretIndices);
    }

    // important to have accurate size here so it knows how to read weird trailing cache address data
    const vertexTableSize = (packetHeader.vertexDataSize - (meshGn === 1 ? packetHeader.unknownE : 0)) * 0x10
    const vertexTable = readMobyVertexTable(meshGn, mobyView.subview(packetHeader.vertexOffset, vertexTableSize), packetHeader);

    return {
        texcoords,
        indicesHeader,
        indices,
        secretIndices,
        textures,
        vertices: vertexTable.vertices,
        duplicateVertices: vertexTable.duplicateVertices,
        isBanglePacket,
    };
}

export function readMobyVertexTable(meshGn: GN, vertexTableView: DataViewExt, packetHeader: MobyMeshPacketHeader) {
    /*
    struct {
        // 0x0
        VertexTableHeader header;
        // 0x10
        MobyMatrixTransfer matrix_transfers[header.matrixTransferCount];
        // align 0x8
        uint16 duplicateVerts[header.duplicateVertexCount];
        // seek to header.vertexTableOffset (usually same as align 0x10)
        MobyVertex verts[header.twoWayBlendVertexCount + header.threeWayBlendVertexCount + header.mainVertexCount];
        // has trailing data for vert cache addresses
    }
    */

    let ptr = 0;

    const vertexTableHeader = readVertexTableHeader(meshGn, vertexTableView);
    ptr += SIZEOF_VERTEX_TABLE_HEADER(meshGn);

    assert(vertexTableHeader.vertexTableOffset / 0x10 <= packetHeader.vertexDataSize);
    assert(vertexTableHeader.transferVertexCount === packetHeader.transferVertexCount);
    assert(packetHeader.unknownD === Math.floor((0xf + packetHeader.transferVertexCount * 6) / 0x10));
    assert(packetHeader.unknownE === Math.floor((3 + packetHeader.transferVertexCount) / 4));

    const matrixTransfers = vertexTableView.subdivide(ptr, vertexTableHeader.matrixTransferCount, SIZEOF_MOBY_MATRIX_TRANSFER).map(view => readMobyMatrixTransfer(view));
    ptr += vertexTableHeader.matrixTransferCount * SIZEOF_MOBY_MATRIX_TRANSFER;

    ptr = align(ptr, 0x8);

    // verts to copy from the cache
    const duplicateVertices = vertexTableView.getArrayOfNumbers(ptr, vertexTableHeader.duplicateVertexCount, Uint16Array).map(value => value >> 7);

    ptr = vertexTableHeader.vertexTableOffset;

    const vertexCount = vertexTableHeader.twoWayBlendVertexCount + vertexTableHeader.threeWayBlendVertexCount + vertexTableHeader.mainVertexCount;
    const verticesView = vertexTableView.subview(ptr); // important - must inherit accurate length from parent view 
    const vertices = verticesView.subdivide(0, vertexCount, SIZEOF_MOBY_VERTEX).map(view => readMobyVertex(view));

    // assign cache addresses to verts
    readMobyCacheAddresses(verticesView, vertices);

    return {
        vertexTableHeader,
        matrixTransfers,
        duplicateVertices,
        vertices,
    };
}

export interface MobyIndicesHeader {
    unknown0: number,
    textureUnpackOffsetQuadwords: number,
    secretIndex: number,
}
export const SIZEOF_MOBY_INDICES_HEADER = 0x4;
export function readMobyIndicesHeader(view: DataViewExt): MobyIndicesHeader {
    /*
    https://github.com/chaoticgd/wrench/blob/ba12611f5e5b54733fd807f17b3210fd0248f996/src/engine/moby_packet.h#L36
    */
    return {
        unknown0: view.getUint8(0x0),
        textureUnpackOffsetQuadwords: view.getUint8(0x1),
        secretIndex: view.getInt8(0x2),
    };
}

export function readMobyTexturePrimitives(view: DataViewExt) {
    assert(view.byteLength % 0x40 === 0);

    const textures = view.subdivide(0, 0xFFFF, 0x40).map(view => readMobyTexturePrimitive(view));

    /*
    Some unhinged behavior here -
    The secret indices occupy the same memory as the textures, but they fill the padding space.
    They're spaced weirdly - they're 0x10 apart even though the textures are 0x40.
    
    e.g. If there are 3 textures X,Y,Z then there will be 3 indices arranged like this:
    |XXXXXXXXX---01--|
    |XXXXXXXXX---02--|
    |XXXXXXXXX---03--|
    |XXXXXXXXX-------|
    |YYYYYYYYY-------|
    |YYYYYYYYY-------|
    |YYYYYYYYY-------|
    |YYYYYYYYY-------|
    |ZZZZZZZZZ-------|
    |ZZZZZZZZZ-------|
    |ZZZZZZZZZ-------|
    |ZZZZZZZZZ-------|
    */
    const secretIndices = view.subdivide(0, textures.length, 0x10).map(view => view.getInt32(0xc));

    return {
        textures,
        secretIndices,
    }
}

export interface MobyTexturePrimitive {
    tex1: GifAd,
    clamp: GifAd,
    tex0: GifAd,
    miptbp1: GifAd,
};
export const SIZEOF_MOBY_TEXTURE_PRIMITIVE = 0x40;
export function readMobyTexturePrimitive(view: DataViewExt): MobyTexturePrimitive {
    /*
    https://github.com/chaoticgd/wrench/blob/master/src/engine/moby_packet.h#L44
    Vertex indices are packed into the padding bytes but they don't correspond to the same texture so they're read elsewhere.
    */
    return {
        tex1: readGifAdData(view.subview(0x0)),
        clamp: readGifAdData(view.subview(0x10)),
        tex0: readGifAdData(view.subview(0x20)),
        miptbp1: readGifAdData(view.subview(0x30)),
    };
}

export type VertexTableHeader = {
    matrixTransferCount: number,
    twoWayBlendVertexCount: number,
    threeWayBlendVertexCount: number,
    mainVertexCount: number,
    duplicateVertexCount: number,
    transferVertexCount: number,
    vertexTableOffset: number,
    unknownE: number,
};
export const SIZEOF_VERTEX_TABLE_HEADER = (meshGn: GN) => meshGn === 1 ? 0x20 : 0x10;
export function readVertexTableHeader(gn: GN, view: DataViewExt): VertexTableHeader {
    /*
    https://github.com/chaoticgd/wrench/blob/ba12611f5e5b54733fd807f17b3210fd0248f996/src/engine/moby_vertex.cpp#L25-L45
    */
    switch (gn) {
        case 1:
            return {
                matrixTransferCount: view.getInt32(0x0),
                twoWayBlendVertexCount: view.getInt32(0x4),
                threeWayBlendVertexCount: view.getInt32(0x8),
                mainVertexCount: view.getInt32(0xc),
                duplicateVertexCount: view.getInt32(0x10),
                transferVertexCount: view.getInt32(0x14),
                vertexTableOffset: view.getInt32(0x18),
                unknownE: view.getInt32(0x1c),
            };
        case 2:
        case 3:
        case 4:
            // same but with 16 bit fields instead of 32 bit
            return {
                matrixTransferCount: view.getInt16(0x0),
                twoWayBlendVertexCount: view.getInt16(0x2),
                threeWayBlendVertexCount: view.getInt16(0x4),
                mainVertexCount: view.getInt16(0x6),
                duplicateVertexCount: view.getInt16(0x8),
                transferVertexCount: view.getInt16(0xa),
                vertexTableOffset: view.getInt16(0xc),
                unknownE: view.getInt16(0xe),
            };
    }
}

export type MobyVertex = {
    cacheAddress: number,
    normalAzumith: number,
    normalElevation: number,
    x: number,
    y: number,
    z: number,
}
export const SIZEOF_MOBY_VERTEX = 0x10;
export function readMobyVertex(view: DataViewExt): MobyVertex {
    /*
    https://github.com/chaoticgd/wrench/blob/d80ca3a0b70c756c90f727faafc5513bd14def60/src/engine/moby_vertex.h#L31-L70
    Skip skinning data for now because it's very complicated
    */
    return {
        cacheAddress: 0xFF, // populated later
        normalAzumith: view.getInt8(0x8),
        normalElevation: view.getInt8(0x9),
        x: view.getInt16(0xa),
        y: view.getInt16(0xc),
        z: view.getInt16(0xe),
    };
}

function readMobyCacheAddresses(view: DataViewExt, verts: MobyVertex[]) {
    /**
     * Each vert has a cache address.
     * But they are arranged in most insane way possible.
     * 
     * We have to iterate with a stride of 0x10, until we would reach the end of the buffer,
     * then we advance 0x4 once, then 0x2 thereafter.
     * 
     * The amount of trailing space varies but it's at least 0x10 and always a multiple of 0x10.
     * If there's exactly 3 verts there must be at least 0x20 trailing space.
     * 
     * We need to skip the first 7 elements but the iteration order is not affected by skipping.
     * 
     * They are arranged like this.
     * In this example there are 10 verts (XX) and 10 cache addresses (01-10).
     * |--XXXXXXXXXXXXXX| vert 1
     * |--XXXXXXXXXXXXXX|
     * |--XXXXXXXXXXXXXX|
     * |--XXXXXXXXXXXXXX|
     * |--XXXXXXXXXXXXXX|
     * |--XXXXXXXXXXXXXX|
     * |--XXXXXXXXXXXXXX| vert 7
     * |01XXXXXXXXXXXXXX|
     * |02XXXXXXXXXXXXXX|
     * |03XXXXXXXXXXXXXX| vert 10
     * |04--------------| trailing space
     * |05--------------|
     * |06--07080910----| end of buffer
     * 
     * Another example with 4 verts - the cache addresses don't overlap the vertex data at all:
     * |--XXXXXXXXXXXXXX| vert 1
     * |--XXXXXXXXXXXXXX|
     * |--XXXXXXXXXXXXXX|
     * |--XXXXXXXXXXXXXX| vert 4
     * |----------------| trailing space
     * |------01020304--| end of buffer
     */

    let ptr = 0;
    let vertIdx = 0;
    let i = 0;

    const lastRow = view.byteLength - 0x10;

    while (true) {
        // read cache address, skip the first 7
        if (i >= 7) {
            verts[vertIdx].cacheAddress = view.getUint16(ptr) & 0x1FF;
            vertIdx++;
        }

        if (vertIdx === verts.length) {
            // done
            break;
        }

        if (ptr === lastRow) {
            // 4 bytes when we hit the last row
            ptr += 0x4;
        } else if (ptr >= lastRow) {
            // 2 bytes within the last row
            ptr += 0x2;
        } else {
            // 0x10 bytes before the last row
            ptr += 0x10;
        }

        i++;
    }
}

export type MobyMatrixTransfer = {
    sprJointIndex: number,
    vu0DestAddr: number,
};
export const SIZEOF_MOBY_MATRIX_TRANSFER = 0x2;
export function readMobyMatrixTransfer(view: DataViewExt): MobyMatrixTransfer {
    /*
    https://github.com/chaoticgd/wrench/blob/ba12611f5e5b54733fd807f17b3210fd0248f996/src/engine/moby_vertex.h#L99
    */
    return {
        sprJointIndex: view.getUint8(0x0),
        vu0DestAddr: view.getUint8(0x1),
    }
}

export interface Occlusion {
    // [z][y][x] -> occlusion mask id
    // where x,y,z are the camera coords divided by 4 and rounded down
    grid: Map<number, Map<number, Map<number, number>>>,
    // is_occluded = masks[maskId * 128][occlusionIndex / 8] & (1 << (occlusionIndex % 8))
    masks: DataViewExt,
};

export function readOcclusion(view: DataViewExt): Occlusion {
    const masksOffset = view.getUint32(0x0);
    let maxMaskId = 0;
    const grid = new Map<number, Map<number, Map<number, number>>>();

    const zStart = view.getUint16(0x4);
    const zCount = view.getUint16(0x6);
    const zOffsets = view.getArrayOfNumbers(0x8, zCount, Uint16Array);

    for (let z = 0; z < zOffsets.length; z++) {
        const zOffset = zOffsets[z] * 4;
        if (!zOffset) continue;

        const yStart = view.getUint16(zOffset + 0x0);
        const yCount = view.getUint16(zOffset + 0x2);
        const yOffsets = view.getArrayOfNumbers(zOffset + 0x4, yCount, Uint16Array);
        for (let y = 0; y < yOffsets.length; y++) {
            const yOffset = yOffsets[y] * 4;
            if (!yOffset) continue;

            const xStart = view.getUint16(yOffset + 0x0);
            const xCount = view.getUint16(yOffset + 0x2);
            const xMaskIds = view.getArrayOfNumbers(yOffset + 0x4, xCount, Uint16Array);
            for (let x = 0; x < xMaskIds.length; x++) {
                const xMaskId = xMaskIds[x];
                if (xMaskId === 0xFFFF) continue;
                maxMaskId = Math.max(maxMaskId, xMaskId);

                const zPos = zStart + z;
                const yPos = yStart + y;
                const xPos = xStart + x;

                let zCell = grid.get(zPos);
                if (!zCell) zCell = grid.set(zPos, new Map()).get(zPos)!;
                let yCell = zCell.get(yPos);
                if (!yCell) yCell = zCell.set(yPos, new Map()).get(yPos)!;
                yCell.set(xPos, xMaskId);
            }
        }
    }

    const masks = view.subview(masksOffset, (maxMaskId + 1) * 128);

    return {
        masks,
        grid,
    }
}
