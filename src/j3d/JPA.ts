
// JParticle's JPAC2-10 resource file, as seen in Super Mario Galaxy, amongst other
// Nintendo games. JPAC1-00 is an older variant which is unsupported.

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString, assertExists } from "../util";
import { BTI } from "./j3d";
import { vec3 } from "gl-matrix";
import { Endianness } from "../endian";

export interface JPAResourceRaw {
    resourceId: number;
    data: ArrayBufferSlice;
}

export interface JPAC {
    effects: JPAResourceRaw[];
    textures: BTI[];
}

const enum JPAVolumeType {
    Cube     = 0x00,
    Sphere   = 0x01,
    Cylinder = 0x02,
    Torus    = 0x03,
    Point    = 0x04,
    Circle   = 0x05,
    Line     = 0x06,
}

export interface JPADynamicsBlock {
    volumeType: JPAVolumeType;
    emitterScl: vec3;
    emitterTrs: vec3;
    emitterDir: vec3;
    emitterRot: vec3;
    initialVelOmni: number;
    initialVelAxis: number;
    initialVelRndm: number;
    initialVelDir: number;
    spread: number;
    rate: number;
    lifeTimeRndm: number;
    volumeMinRad: number;
    maxFrame: number;
    startFrame: number;
    lifeTime: number;
    volumeSize: number;
    divNumber: number;
}

const enum JPABSPType {
    Point            = 0x00,
    Line             = 0x01,
    BillBoard        = 0x02,
    Directional      = 0x03,
    DirectionalCross = 0x04,
    Stripe           = 0x05,
    StripeCross      = 0x06,
    Rotation         = 0x07,
    Particle         = 0x08,
    DirBillBoard     = 0x09,
    YBillBoard       = 0x0A,
}

export interface JPABaseShapeBlock {
    flags: number;
    type: JPABSPType;
}

export interface JPAExtraShapeBlock {
}

export interface JPAExTexBlock {
}

export interface JPAChildShapeBlock {
}

const enum JPAFieldType {
    Gravity    = 0x00,
    Air        = 0x01,
    Magnet     = 0x02,
    Newton     = 0x03,
    Vortex     = 0x04,
    Random     = 0x05,
    Drag       = 0x06,
    Convection = 0x07,
    Spin       = 0x08,
}

const enum JPAFieldVelType {
    Unk00 = 0x00,
    Unk01 = 0x01,
    Unk02 = 0x02,
}

export interface JPAFieldBlock {
    flags: number;
    type: JPAFieldType;
    velType: JPAFieldVelType;
    pos: vec3;
    dir: vec3;
    mag: number;
    magRndm: number;
    maxDist: number;
    fadeIn: number;
    fadeOut: number;
    disTime: number;
    enTime: number;
}

const enum JPAKeyType {
    Rate           = 0x00,
    VolumeSize     = 0x01,
    VolumeSweep    = 0x02,
    VolumeMinRad   = 0x03,
    LifeTime       = 0x04,
    Moment         = 0x05,
    InitialVelOmni = 0x06,
    InitialVelAxis = 0x07,
    InitialVelDir  = 0x08,
    Spread         = 0x09,
}

export interface JPAKeyBlock {
    keyType: JPAKeyType;
    keyValues: Float32Array;
    isLoopEnable: boolean;
}

export interface JPAResource {
    bem1: JPADynamicsBlock;
    bsp1: JPABaseShapeBlock;
    esp1: JPAExtraShapeBlock | null;
    etx1: JPAExTexBlock | null;
    ssp1: JPAChildShapeBlock | null;
    fld1: JPAFieldBlock[];
    kfa1: JPAKeyBlock[];
    tdb1: Uint16Array;
}

export function parseResource(res: JPAResourceRaw): JPAResource {
    const buffer = res.data;
    const view = buffer.createDataView();

    const blockCount = view.getUint16(0x02);
    const fieldBlockCount = view.getUint8(0x04);
    const keyBlockCount = view.getUint8(0x05);
    // Unknown at 0x06. Seemingly unused?

    let bem1: JPADynamicsBlock | null = null;
    let bsp1: JPABaseShapeBlock | null = null;
    let esp1: JPAExtraShapeBlock | null = null;
    let etx1: JPAExTexBlock | null = null;
    let ssp1: JPAChildShapeBlock | null = null;
    let fld1: JPAFieldBlock[] = [];
    let kfa1: JPAKeyBlock[] = [];
    let tdb1: Uint16Array | null = null;

    // Parse through the blocks.
    let tableIdx = 0x08;
    for (let j = 0; j < blockCount; j++) {
        // blockSize includes the header.
        const fourcc = readString(buffer, tableIdx + 0x00, 0x04, false);
        const blockSize = view.getUint32(tableIdx + 0x04);

        if (fourcc === 'BEM1') {
            // J3DDynamicsBlock

            // Contains emitter settings and details about how the particle simulates.

            const flags = view.getUint32(tableIdx + 0x08);
            const volumeType: JPAVolumeType = (flags >>> 8) & 0x07;

            // 0x08 = unk
            // 0x0C = unk
            const emitterSclX = view.getFloat32(tableIdx + 0x10);
            const emitterSclY = view.getFloat32(tableIdx + 0x14);
            const emitterSclZ = view.getFloat32(tableIdx + 0x18);
            const emitterScl = vec3.fromValues(emitterSclX, emitterSclY, emitterSclZ);

            const emitterTrsX = view.getFloat32(tableIdx + 0x1C);
            const emitterTrsY = view.getFloat32(tableIdx + 0x20);
            const emitterTrsZ = view.getFloat32(tableIdx + 0x24);
            const emitterTrs = vec3.fromValues(emitterTrsX, emitterTrsY, emitterTrsZ);

            const emitterDirX = view.getFloat32(tableIdx + 0x28);
            const emitterDirY = view.getFloat32(tableIdx + 0x2C);
            const emitterDirZ = view.getFloat32(tableIdx + 0x30);
            const emitterDir = vec3.fromValues(emitterDirX, emitterDirY, emitterDirZ);
            vec3.normalize(emitterDir, emitterDir);

            const initialVelOmni = view.getFloat32(tableIdx + 0x34);
            const initialVelAxis = view.getFloat32(tableIdx + 0x38);
            const initialVelRndm = view.getFloat32(tableIdx + 0x3C);
            const initialVelDir  = view.getFloat32(tableIdx + 0x40);

            const spread = view.getFloat32(tableIdx + 0x44);
            // 0x48 = unk
            const rate = view.getFloat32(tableIdx + 0x4C);
            // 0x50 = unk
            const lifeTimeRndm = view.getFloat32(tableIdx + 0x54);
            // 0x58 = unk
            const volumeMinRad = view.getFloat32(tableIdx + 0x5C);
            // 0x60 = unk
            // 0x64 = unk
            const emitterRotX = view.getInt16(tableIdx + 0x68) / 0x7FFF;
            const emitterRotY = view.getInt16(tableIdx + 0x6A) / 0x7FFF;
            const emitterRotZ = view.getInt16(tableIdx + 0x6C) / 0x7FFF;
            const emitterRot = vec3.fromValues(emitterRotX, emitterRotY, emitterRotZ);
            const maxFrame = view.getInt16(tableIdx + 0x6E);
            const startFrame = view.getInt16(tableIdx + 0x70);
            const lifeTime = view.getInt16(tableIdx + 0x72);
            const volumeSize = view.getInt16(tableIdx + 0x74);
            const divNumber = view.getInt16(tableIdx + 0x76);

            bem1 = {
                volumeType, emitterScl, emitterTrs, emitterDir, emitterRot,
                initialVelOmni, initialVelAxis, initialVelRndm, initialVelDir,
                spread, rate, lifeTimeRndm, volumeMinRad,
                maxFrame, startFrame, lifeTime, volumeSize, divNumber
            };
        } else if (fourcc === 'BSP1') {
            // J3DBaseShape

            // Contains particle draw settings.
            const flags = view.getUint32(tableIdx + 0x08);
            const type: JPABSPType = flags & 0x0F;

            bsp1 = { flags, type };
        } else if (fourcc === 'ESP1') {
            // J3DExtraShape

            // Contains misc. extra particle draw settings.

            esp1 = {};
        } else if (fourcc === 'SSP1') {
            // J3DChildShape

            // Contains child particle draw settings.

            ssp1 = {};
        } else if (fourcc === 'ETX1') {
            // J3DExTexShape

            // Contains extra texture draw settings.

            etx1 = {};
        } else if (fourcc === 'KFA1') {
            // J3DKeyBlock

            // Contains curve animations for various emitter parameters.
            const keyType: JPAKeyType = view.getUint8(tableIdx + 0x08);
            const keyCount = view.getUint8(tableIdx + 0x09);
            const isLoopEnable = !!view.getUint8(tableIdx + 0x0B);

            // The curves are four floats per key, in typical time/value/tangent in/tangent out order.
            const keyValues = buffer.createTypedArray(Float32Array, tableIdx + 0x0C, keyCount * 4, Endianness.BIG_ENDIAN);

            kfa1.push({ keyType, isLoopEnable, keyValues });
        } else if (fourcc === 'FLD1') {
            // J3DFieldBlock

            // Contains physics simulation fields that act on the particles.
            const flags = view.getUint32(tableIdx + 0x08);
            const type: JPAFieldType = flags & 0x0F;
            const velType: JPAFieldVelType = (flags >>> 8) & 0x03;

            const posX = view.getFloat32(tableIdx + 0x0C);
            const posY = view.getFloat32(tableIdx + 0x10);
            const posZ = view.getFloat32(tableIdx + 0x14);
            const pos = vec3.fromValues(posX, posY, posZ);

            const dirX = view.getFloat32(tableIdx + 0x18);
            const dirY = view.getFloat32(tableIdx + 0x1C);
            const dirZ = view.getFloat32(tableIdx + 0x20);
            const dir = vec3.fromValues(dirX, dirY, dirZ);

            const mag = view.getFloat32(tableIdx + 0x24);
            const magRndm = view.getFloat32(tableIdx + 0x28);
            const maxDist = view.getFloat32(tableIdx + 0x2C);
            const fadeIn = view.getFloat32(tableIdx + 0x30);
            const fadeOut = view.getFloat32(tableIdx + 0x34);
            const enTime = view.getFloat32(tableIdx + 0x38);
            const disTime = view.getFloat32(tableIdx + 0x3C);

            fld1.push({ flags, type, velType, pos, dir, mag, magRndm, maxDist, fadeIn, fadeOut, enTime, disTime });
        } else if (fourcc === 'TDB1') {
            // Not a block. Stores a mapping of particle texture indexes
            // to JPAC texture indices -- I assume this is "Texture Database".
            tdb1 = buffer.subarray(tableIdx + 0x08, blockSize - 0x08).createTypedArray(Uint16Array, 0, undefined, Endianness.BIG_ENDIAN);
        } else {
            throw "whoops";
        }

        tableIdx += blockSize;
    }

    assert(fld1.length === fieldBlockCount);
    assert(kfa1.length === keyBlockCount);

    return {
        bem1: assertExists(bem1),
        bsp1: assertExists(bsp1),
        esp1,
        etx1,
        ssp1,
        fld1,
        kfa1,
        tdb1: assertExists(tdb1),
    };
}

export function parse(buffer: ArrayBufferSlice): JPAC {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x08) === 'JPAC2-10');

    const effectCount = view.getUint16(0x08);
    const textureCount = view.getUint16(0x0A);
    const textureTableOffs = view.getUint32(0x0C);

    const effects: JPAResourceRaw[] = [];
    let effectTableIdx = 0x10;
    for (let i = 0; i < effectCount; i++) {
        const resourceBeginOffs = effectTableIdx;

        const resourceId = view.getUint16(effectTableIdx + 0x00);
        const blockCount = view.getUint16(effectTableIdx + 0x02);

        effectTableIdx += 0x08;

        // Quickly skim through the blocks.
        for (let j = 0; j < blockCount; j++) {
            // blockSize includes the header.
            const blockSize = view.getUint32(effectTableIdx + 0x04);
            effectTableIdx += blockSize;
        }

        const data = buffer.slice(resourceBeginOffs, effectTableIdx);
        effects.push({ resourceId, data });
    }

    const textures: BTI[] = [];
    let textureTableIdx = textureTableOffs;
    for (let i = 0; i < textureCount; i++) {
        assert(readString(buffer, textureTableIdx + 0x00, 0x04, false) === 'TEX1');
        const blockSize = view.getUint32(textureTableIdx + 0x04);
        const textureName = readString(buffer, textureTableIdx + 0x0C, 0x14, true);
        const texture = BTI.parse(buffer.slice(textureTableIdx + 0x20, textureTableIdx + blockSize), textureName);
        textures.push(texture);
        textureTableIdx += blockSize;
    }

    return { effects, textures };
}
