
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readString, assert } from "../../util";
import { computeTextureByteSize, decodeTexture, TextureFormat } from "../../oot3d/pica_texture";
import { mat4 } from "gl-matrix";

//#region PICA
const enum PICAReg {
    PICA_REG_TEXTURE0_SIZE   = 0x0082,
    PICA_REG_TEXTURE0_ADDR0  = 0x0085,
    PICA_REG_TEXTURE0_FORMAT = 0x008E,
}

class PICARegisters {
    public registers = new Uint32Array(0x300);

    constructor() {
    }

    public run(buffer: ArrayBufferSlice): void {
        const view = buffer.createDataView();

        this.registers.fill(0);

        for (let idx = 0; idx < buffer.byteLength;) {
            const h = view.getUint32(idx + 0x04, true);

            const reg = h & 0x0000FFFF;
            const msk = 0xFFFFFFF0 | ((h >>> 16) & 0x0F);
            const cnt = ((h >>> 20) & 0x7FF) + 1;
            const inc = !!(h & 0x80000000);

            let ridx = reg;
            for (let i = 0; i < cnt; i++) {
                let p = view.getUint32(idx + 0x00, true);

                idx += 0x04;
                if (i === 0)
                    idx += 0x04;

                this.registers[ridx] = (this.registers[ridx] & ~msk) | (p & msk);

                if (inc)
                    ridx++;
            }
        }
    }
}
//#endregion

//#region H3D
const enum FileSectionType {
    CONTENT,
    STRING,
    COMMAND,
    RAW,
    RAW_EXT,
    RELOCATABLE_TABLE,
    UNINIT_DATA,
    UNINIT_COMMAND,
}

const enum RelocationType {
    CONTENT,
    STRING,
    COMMAND,
    COMMAND_SRC,
    RAW,
    RAW_TEXTURE,
    RAW_VERTEX,
    RAW_INDEX,
    RAW_INDEX_U8,
    RAW_EXT,
    RAW_EXT_TEXTURE,
    RAW_EXT_VERTEX,
    RAW_EXT_INDEX,
    RAW_EXT_INDEX_U8,
    BASE_ADDRESS,
}

function toSection(relocationType: RelocationType): FileSectionType {
    switch (relocationType) {
    case RelocationType.CONTENT: return FileSectionType.CONTENT;
    case RelocationType.STRING: return FileSectionType.STRING;
    case RelocationType.COMMAND: return FileSectionType.COMMAND;
    case RelocationType.COMMAND_SRC: return FileSectionType.COMMAND;
    case RelocationType.RAW: return FileSectionType.RAW;
    case RelocationType.RAW_TEXTURE: return FileSectionType.RAW;
    case RelocationType.RAW_VERTEX: return FileSectionType.RAW;
    case RelocationType.RAW_INDEX: return FileSectionType.RAW;
    case RelocationType.RAW_INDEX_U8: return FileSectionType.RAW;
    case RelocationType.RAW_EXT: return FileSectionType.RAW_EXT;
    case RelocationType.RAW_EXT_TEXTURE: return FileSectionType.RAW_EXT;
    case RelocationType.RAW_EXT_VERTEX: return FileSectionType.RAW_EXT;
    case RelocationType.RAW_EXT_INDEX: return FileSectionType.RAW_EXT;
    case RelocationType.RAW_EXT_INDEX_U8: return FileSectionType.RAW_EXT;
    default: throw "whoops";
    }
}

export interface TextureLevel {
    width: number;
    height: number;
    pixels: Uint8Array;
    name: string;
}

export interface Texture {
    name: string;
    width: number;
    height: number;
    format: TextureFormat;
    levels: TextureLevel[];
}

export interface BCH {
    textures: Texture[];
}

interface PatriciaMapEntry {
    offs: number;
    name: string;
}

export function parse(buffer: ArrayBufferSlice): BCH {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04, false) === 'BCH\0');

    const backwardCompatibility = view.getUint8(0x04);
    const forwardCompatibility = view.getUint8(0x05);
    assert(backwardCompatibility === 0x21 && forwardCompatibility === 0x21);

    const revision = view.getUint16(0x06);

    const fileSectionOffs: number[] = [];
    fileSectionOffs[FileSectionType.CONTENT] = view.getUint32(0x08, true);
    fileSectionOffs[FileSectionType.STRING] = view.getUint32(0x0C, true);
    fileSectionOffs[FileSectionType.COMMAND] = view.getUint32(0x10, true);
    fileSectionOffs[FileSectionType.RAW] = view.getUint32(0x14, true);
    fileSectionOffs[FileSectionType.RAW_EXT] = view.getUint32(0x18, true);
    fileSectionOffs[FileSectionType.RELOCATABLE_TABLE] = view.getUint32(0x1C, true);

    const fileSectionSize: number[] = [];
    fileSectionSize[FileSectionType.CONTENT] = view.getUint32(0x20, true);
    fileSectionSize[FileSectionType.STRING] = view.getUint32(0x24, true);
    fileSectionSize[FileSectionType.COMMAND] = view.getUint32(0x28, true);
    fileSectionSize[FileSectionType.RAW] = view.getUint32(0x2C, true);
    fileSectionSize[FileSectionType.RAW_EXT] = view.getUint32(0x30, true);
    fileSectionSize[FileSectionType.RELOCATABLE_TABLE] = view.getUint32(0x34, true);
    fileSectionSize[FileSectionType.UNINIT_DATA] = view.getUint32(0x38, true);
    fileSectionSize[FileSectionType.UNINIT_DATA] = view.getUint32(0x3C, true);

    const flags = view.getUint8(0x40);
    // Padding
    const physicalAddressCount = view.getUint16(0x42, true);

    // Relocate.
    const relocTableOffs = fileSectionOffs[FileSectionType.RELOCATABLE_TABLE];
    const relocTableSize = fileSectionSize[FileSectionType.RELOCATABLE_TABLE];
    for (let idx = relocTableOffs; idx < relocTableOffs + relocTableSize; idx += 0x04) {
        const rel = view.getUint32(idx + 0x00, true);
        const srcSection = (rel >>> 29) & 0x07;
        const target = (rel >>> 25) & 0x0F;
        let srcOffset = (rel >>> 0) & 0x01FFFFFF;

        if (target !== RelocationType.STRING)
            srcOffset *= 0x04;

        const srcOffs = fileSectionOffs[srcSection] + srcOffset;
        const targetOffset = view.getUint32(srcOffs + 0x00, true);
        view.setUint32(srcOffs + 0x00, fileSectionOffs[toSection(target)] + targetOffset, true);
    }

    let contentIdx = fileSectionOffs[FileSectionType.CONTENT];

    function parsePatriciaMap(offs: number): PatriciaMapEntry[] {
        const entries: PatriciaMapEntry[] = [];
        let entryTablePtrIdx = view.getUint32(offs + 0x00, true);
        const entryTableCount = view.getUint32(offs + 0x04, true);
        let entryTableIdx = view.getUint32(offs + 0x08, true);
        offs += 0x0C;

        // Skip root entry
        entryTableIdx += 0x0C;

        for (let i = 0; i < entryTableCount; i++) {
            const offs = view.getUint32(entryTablePtrIdx + 0x00, true);
            const nameOffs = view.getUint32(entryTableIdx + 0x08, true);
            const name = readString(buffer, nameOffs, 0x20);
            entryTablePtrIdx += 0x04;
            entryTableIdx += 0x0C;
            entries.push({ offs, name });
        }

        return entries;
    }

    function parseContentMap(): PatriciaMapEntry[] {
        const p = parsePatriciaMap(contentIdx);
        contentIdx += 0x0C;
        return p;
    }

    const modelContentMap = parseContentMap();
    const materialContentMap = parseContentMap();
    const shaderContentMap = parseContentMap();
    const textureContentMap = parseContentMap();
    const lutSetContentMap = parseContentMap();
    const lightContentMap = parseContentMap();
    const cameraContentMap = parseContentMap();
    const fogContentMap = parseContentMap();
    const skeletalAnimContentMap = parseContentMap();
    const materialAnimContentMap = parseContentMap();
    const visibilityAnimContentMap = parseContentMap();
    const lightAnimContentMap = parseContentMap();
    const cameraAnimContentMap = parseContentMap();
    const fogAnimContentMap = parseContentMap();
    const sceneEnvironmentContentMap = parseContentMap();

    const pica = new PICARegisters();

    for (let i = 0; i < modelContentMap.length; i++) {
        const offs = textureContentMap[i].offs;
        const flags = view.getUint8(offs + 0x00);
        const skeletonScalingRule = view.getUint8(offs + 0x01);
        const silhouetteMaterialCount = view.getUint16(offs + 0x02, true);

        const worldMtx00 = view.getFloat32(offs + 0x04, true);
        const worldMtx10 = view.getFloat32(offs + 0x08, true);
        const worldMtx20 = view.getFloat32(offs + 0x0C, true);
        const worldMtx30 = view.getFloat32(offs + 0x10, true);
        const worldMtx01 = view.getFloat32(offs + 0x14, true);
        const worldMtx11 = view.getFloat32(offs + 0x18, true);
        const worldMtx21 = view.getFloat32(offs + 0x1C, true);
        const worldMtx31 = view.getFloat32(offs + 0x20, true);
        const worldMtx02 = view.getFloat32(offs + 0x24, true);
        const worldMtx12 = view.getFloat32(offs + 0x28, true);
        const worldMtx22 = view.getFloat32(offs + 0x2C, true);
        const worldMtx32 = view.getFloat32(offs + 0x30, true);

        const worldMtx = mat4.fromValues(
            worldMtx00, worldMtx01, worldMtx02, 0,
            worldMtx10, worldMtx11, worldMtx12, 0,
            worldMtx20, worldMtx21, worldMtx22, 0,
            worldMtx30, worldMtx31, worldMtx32, 1,
        );
    }

    const textures: Texture[] = [];
    for (let i = 0; i < textureContentMap.length; i++) {
        const offs = textureContentMap[i].offs;
        const tex0Offs = view.getUint32(offs + 0x00, true);
        const tex0WordCount = view.getUint32(offs + 0x04, true);
        const tex1Offs = view.getUint32(offs + 0x08, true);
        const tex1WordCount = view.getUint32(offs + 0x0C, true);
        const tex2Offs = view.getUint32(offs + 0x10, true);
        const tex2WordCount = view.getUint32(offs + 0x14, true);
        const format = view.getUint8(offs + 0x18);
        const mipmapSize = view.getUint8(offs + 0x19);
        // Padding
        const name = readString(buffer, view.getUint32(offs + 0x1C, true));
        assert(name === textureContentMap[i].name);
        pica.run(buffer.subarray(tex0Offs, tex0WordCount * 0x04));

        const size0 = pica.registers[PICAReg.PICA_REG_TEXTURE0_SIZE];
        const width0 = (size0 >>> 16), height0 = size0 & 0x0000FFFF;
        const addr0 = pica.registers[PICAReg.PICA_REG_TEXTURE0_ADDR0];
        const format0 = pica.registers[PICAReg.PICA_REG_TEXTURE0_FORMAT];
        assert(format0 === format);

        let dataOffs = addr0;
        let mipWidth = width0, mipHeight = height0;
        const levels: TextureLevel[] = [];
        for (let i = 0; i < mipmapSize; i++) {
            const dataSize = computeTextureByteSize(format, mipWidth, mipHeight);
            const pixels = decodeTexture(format0, mipWidth, mipHeight, buffer.subarray(dataOffs, dataSize));
            levels.push({ name, width: mipWidth, height: mipHeight, pixels });
            dataOffs += dataSize;
            mipWidth /= 2;
            mipHeight /= 2;
        }

        textures.push({ name, width: width0, height: height0, format, levels });
    }

    return { textures };
}
//#endregion