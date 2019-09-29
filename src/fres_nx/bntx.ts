
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, assert } from "../util";
import { isMarkerLittleEndian, readBinStr } from "./bfres";
import { ImageDimension, ImageFormat, ImageStorageDimension, TileMode, getChannelFormat } from "./nngfx_enum";
import { getBlockHeightLog2, getFormatBlockHeight, isChannelFormatSupported } from "./tegra_texture";

export interface BNTX {
    textures: BRTI[];
}

export interface BRTI {
    name: string;
    imageDimension: ImageDimension;
    imageFormat: ImageFormat;
    width: number;
    height: number;
    depth: number;
    arraySize: number;
    mipBuffers: ArrayBufferSlice[];
}

function parseBRTI(buffer: ArrayBufferSlice, offs: number, littleEndian: boolean): BRTI | null {
    const view = buffer.createDataView();

    assert(readString(buffer, offs + 0x00, 0x04) === 'BRTI');

    const name = readBinStr(buffer, view.getUint32(offs + 0x60, littleEndian), littleEndian);
    const flag = view.getUint8(offs + 0x10);
    const imageStorageDimension: ImageStorageDimension = view.getUint8(offs + 0x11);
    const tileMode: TileMode = view.getUint16(offs + 0x12, littleEndian);
    assert(tileMode === TileMode.Optimal);
    const swizzle = view.getUint16(offs + 0x14, littleEndian);
    const mipCount = view.getUint16(offs + 0x16, littleEndian);
    const multisampleCount = view.getUint16(offs + 0x18, littleEndian);
    assert(multisampleCount === 1);
    const imageFormat: ImageFormat = view.getUint32(offs + 0x1C, littleEndian);
    const gpuAccessFlags = view.getUint32(offs + 0x20, littleEndian);
    const width = view.getUint32(offs + 0x24, littleEndian);
    const height = view.getUint32(offs + 0x28, littleEndian);
    const depth = view.getUint32(offs + 0x2C, littleEndian);
    const arraySize = view.getUint32(offs + 0x30, littleEndian);
    // layout, the first element of which appears to be blockHeightLog2
    const blockHeightLog2 = view.getUint32(offs + 0x34, littleEndian);
    const channelFormat = getChannelFormat(imageFormat);
    if (!isChannelFormatSupported(channelFormat))
        return null;

    const bh = getFormatBlockHeight(channelFormat);
    const blockHeightLog2_2 = getBlockHeightLog2(height / bh);

    // TODO(jstpierre): Support images where this isn't true.
    if (blockHeightLog2 !== blockHeightLog2_2)
        return null;

    assert(blockHeightLog2 === blockHeightLog2_2);

    const textureDataSize = view.getUint32(offs + 0x50, littleEndian);
    const alignment = view.getUint32(offs + 0x54, littleEndian);
    const channelMapping = view.getUint32(offs + 0x58, littleEndian);
    const imageDimension = view.getUint8(offs + 0x5C);

    const dataOffsets: number[] = [];
    let dataOffsTableIdx = view.getUint32(offs + 0x70, littleEndian);
    for (let i = 0; i < mipCount; i++) {
        dataOffsets.push(view.getUint32(dataOffsTableIdx + 0x00, littleEndian));
        dataOffsTableIdx += 0x08;
    }

    const mipBuffers: ArrayBufferSlice[] = [];
    for (let i = 0; i < mipCount - 1; i++)
        mipBuffers.push(buffer.slice(dataOffsets[i], dataOffsets[i + 1]));
    mipBuffers.push(buffer.slice(dataOffsets[mipCount - 1], dataOffsets[0] + textureDataSize));

    return { name, imageDimension, imageFormat, width, height, depth, arraySize, mipBuffers };
}

export function parse(buffer: ArrayBufferSlice): BNTX {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x08, false) === 'BNTX\0\0\0\0');
    const littleEndian: boolean = isMarkerLittleEndian(view.getUint16(0x0C, false));

    const version = view.getUint32(0x08, littleEndian);
    const supportedVersions: number[] = [
        0x00040000, // Super Mario Odyssey
    ];
    assert(supportedVersions.includes(version));

    const targetPlatform = readString(buffer, 0x20, 0x04);
    assert(targetPlatform === 'NX  ');

    const textureDicOffs = view.getUint32(0x38, littleEndian);
    assert(readString(buffer, textureDicOffs + 0x00, 0x04) === '_DIC');

    const textureDicCount = view.getUint32(textureDicOffs + 0x04, littleEndian);
    let textureDicIdx = textureDicOffs + 0x18;
    let textureArrIdx = view.getUint32(0x28, littleEndian) + 0x00;
    const textures: BRTI[] = [];
    for (let i = 0; i < textureDicCount; i++) {
        const textureName = readBinStr(buffer, view.getUint32(textureDicIdx + 0x08, littleEndian), littleEndian);
        const textureHeaderOffs = view.getUint32(textureArrIdx + 0x00, littleEndian);

        const brti = parseBRTI(buffer, textureHeaderOffs, littleEndian);
        if (brti !== null) {
            assert(brti.name === textureName);
            textures.push(brti);
        }

        textureDicIdx += 0x10;
        textureArrIdx += 0x08;
    }

    return { textures };
}
