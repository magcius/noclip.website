
import {
    GfxDevice, GfxBuffer, GfxInputLayout, GfxInputState, GfxBufferUsage,
    GfxVertexAttributeDescriptor, GfxFormat, GfxVertexAttributeFrequency, GfxRenderPass,
    GfxHostAccessPass, GfxBindingLayoutDescriptor, GfxTextureDimension, GfxWrapMode,
    GfxMipFilterMode, GfxTexFilterMode, GfxSampler, GfxBlendFactor, GfxBlendMode, GfxTexture
} from "../gfx/platform/GfxPlatform";
import { SceneGfx, ViewerRenderInput, Texture } from "../viewer";
import { SceneDesc, SceneContext, SceneGroup } from "../SceneBase";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, assert, hexzero, nArray } from "../util";
import { decompress } from "../compression/MIO0";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { DeviceProgram } from "../Program";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { fillMatrix4x3, fillMatrix4x4, fillMatrix4x2 } from "../gfx/helpers/UniformBufferHelpers";
import { mat4, vec3 } from "gl-matrix";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { standardFullClearRenderPassDescriptor, BasicRenderTarget } from "../gfx/helpers/RenderTargetHelpers";
import { computeViewMatrix } from "../Camera";
import { MathConstants } from "../MathHelpers";
import { TextureState, TileState } from "../bk/f3dex";
import { ImageFormat, ImageSize, getImageFormatName, decodeTex_RGBA16, getImageSizeName, decodeTex_I4, decodeTex_I8, decodeTex_IA4, decodeTex_IA8, decodeTex_IA16 } from "../Common/N64/Image";
import { TextureMapping } from "../TextureHolder";
import { Endianness } from "../endian";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";

interface Pilotwings64FSFileChunk {
    tag: string;
    buffer: ArrayBufferSlice;
}

interface Pilotwings64FSFile {
    name: string;
    type: string;
    chunks: Pilotwings64FSFileChunk[];
}

interface Pilotwings64FS {
    files: Pilotwings64FSFile[];
}

interface MaterialData {
    rspModeInfo: number;
    textureIndex: number;
    indexOffset: number;
    triCount: number;
}

interface Mesh_Chunk {
    vertexData: Float32Array;
    indexData: Uint16Array;
    materials: MaterialData[];
}

interface UVCT_ModelPlacement {
    modelIndex: number;
    placement: mat4;
}

interface UVCT_Chunk {
    mesh: Mesh_Chunk;
    models: UVCT_ModelPlacement[];
}

function parseUVCT_Chunk(chunk: Pilotwings64FSFileChunk): UVCT_Chunk {
    assert(chunk.tag === 'COMM');
    const view = chunk.buffer.createDataView();

    const vertCount = view.getUint16(0x00);
    const faceCount = view.getUint16(0x02);
    const modelCount = view.getUint16(0x04);
    const materialCount = view.getUint16(0x06);

    let offs = 0x08;

    const vertexData = new Float32Array(9 * vertCount);
    for (let i = 0; i < vertexData.length;) {
        vertexData[i++] = view.getInt16(offs + 0x00);
        vertexData[i++] = view.getInt16(offs + 0x02);
        vertexData[i++] = view.getInt16(offs + 0x04);
        // Unknown
        vertexData[i++] = (view.getInt16(offs + 0x08) / 0x20) + 0.5;
        vertexData[i++] = (view.getInt16(offs + 0x0A) / 0x20) + 0.5;
        vertexData[i++] = view.getUint8(offs + 0x0C) / 0xFF;
        vertexData[i++] = view.getUint8(offs + 0x0D) / 0xFF;
        vertexData[i++] = view.getUint8(offs + 0x0E) / 0xFF;
        vertexData[i++] = view.getUint8(offs + 0x0F) / 0xFF;
        offs += 0x10;
    }

    const indexData = new Uint16Array(3 * faceCount);
    for (let i = 0; i < indexData.length;) {
        indexData[i++] = view.getUint16(offs + 0x00);
        indexData[i++] = view.getUint16(offs + 0x02);
        indexData[i++] = view.getUint16(offs + 0x04);
        // Unknown
        offs += 0x08;
    }

    const models: UVCT_ModelPlacement[] = [];
    for (let i = 0; i < modelCount; i++) {
        const matrixCount = view.getUint8(offs + 0x00);
        offs += 0x01;

        let placement: mat4 = mat4.create();
        for (let j = 0; j < matrixCount; j++) {
            const wholes = offs;
            const fracs = offs + 0x20;
            const m00 = view.getInt16(wholes + 0x00) + view.getUint16(fracs + 0x00) / 0x10000;
            const m01 = view.getInt16(wholes + 0x02) + view.getUint16(fracs + 0x02) / 0x10000;
            const m02 = view.getInt16(wholes + 0x04) + view.getUint16(fracs + 0x04) / 0x10000;
            const m03 = view.getInt16(wholes + 0x06) + view.getUint16(fracs + 0x06) / 0x10000;
            const m10 = view.getInt16(wholes + 0x08) + view.getUint16(fracs + 0x08) / 0x10000;
            const m11 = view.getInt16(wholes + 0x0a) + view.getUint16(fracs + 0x0a) / 0x10000;
            const m12 = view.getInt16(wholes + 0x0c) + view.getUint16(fracs + 0x0c) / 0x10000;
            const m13 = view.getInt16(wholes + 0x0e) + view.getUint16(fracs + 0x0e) / 0x10000;
            const m20 = view.getInt16(wholes + 0x10) + view.getUint16(fracs + 0x10) / 0x10000;
            const m21 = view.getInt16(wholes + 0x12) + view.getUint16(fracs + 0x12) / 0x10000;
            const m22 = view.getInt16(wholes + 0x14) + view.getUint16(fracs + 0x14) / 0x10000;
            const m23 = view.getInt16(wholes + 0x16) + view.getUint16(fracs + 0x16) / 0x10000;
            const matx = view.getInt16(wholes + 0x18) + view.getUint16(fracs + 0x18) / 0x10000;
            const maty = view.getInt16(wholes + 0x1a) + view.getUint16(fracs + 0x1a) / 0x10000;
            const matz = view.getInt16(wholes + 0x1c) + view.getUint16(fracs + 0x1c) / 0x10000;
            const one = view.getInt16(wholes + 0x1e) + view.getUint16(fracs + 0x1e) / 0x10000;
            if (j == 0) { // TODO: figure out what other matrices are for
                placement = mat4.fromValues(
                    m00, m01, m02, m03,
                    m10, m11, m12, m13,
                    m20, m21, m22, m23,
                    matx, maty, matz, one,
                );
            }
            assert(one === 1);

            offs += 0x40;
        }

        const modelIndex = view.getInt16(offs + 0x00);
        // these are redundant with the matrix, though could differ due to precision
        const x = view.getFloat32(offs + 0x02);
        const y = view.getFloat32(offs + 0x06);
        const z = view.getFloat32(offs + 0x0a);
        if (matrixCount === 0) {
            assert(x === 0.0);
            assert(y === 0.0);
            assert(z === 0.0);
        }
        offs += 0x12;

        if (modelIndex >= 0)
            models.push({ modelIndex, placement });
    }

    const materials: MaterialData[] = [];
    for (let i = 0; i < materialCount; i++) {
        const rspModeInfo = view.getUint16(offs + 0x00);
        const textureIndex = view.getUint16(offs + 0x02);
        const vertCount = view.getUint16(offs + 0x04);
        const triCount = view.getUint16(offs + 0x06);
        const numCommands = view.getUint16(offs + 0x08);
        offs += 0x0a;

        for (let j = 0; j < numCommands; j++) {
            const indexData = view.getUint16(offs + 0x00);
            offs += 0x02;
            if ((indexData & 0x4000) === 0)
                offs += 0x01; // vertex load count
        }
        const indexOffset = view.getUint16(offs + 0x00) * 3;
        offs += 0x18;

        materials.push({ rspModeInfo, textureIndex, indexOffset, triCount })
    }

    return { mesh: { vertexData, indexData, materials }, models };
}

function parseUVCT(file: Pilotwings64FSFile): UVCT_Chunk {
    assert(file.chunks.length === 1);
    assert(file.chunks[0].tag === 'COMM');
    return parseUVCT_Chunk(file.chunks[0]);
}

interface UVTR_ContourPlacement {
    contourIndex: number;
    position: vec3;
}

interface UVTR_Chunk {
    gridWidth: number;
    gridHeight: number;
    cellX: number;
    cellY: number;
    contourPlacements: UVTR_ContourPlacement[];
}

function parseUVTR_Chunk(chunk: Pilotwings64FSFileChunk): UVTR_Chunk {
    const view = chunk.buffer.createDataView();

    const minX = view.getFloat32(0x00);
    const minY = view.getFloat32(0x04);

    const gridWidth = view.getUint8(0x18);
    const gridHeight = view.getUint8(0x19);
    const cellX = view.getFloat32(0x1A);
    const cellY = view.getFloat32(0x1E);
    const unk = view.getFloat32(0x22);

    const contourPlacements: UVTR_ContourPlacement[] = [];
    let offs = 0x26;
    for (let i = 0; i < gridWidth * gridHeight; i++) {
        const flag = view.getUint8(offs++);

        if (flag === 0) {
            // No data in this cell.
            continue;
        }

        const m00 = view.getFloat32(offs + 0x00);
        const m01 = view.getFloat32(offs + 0x04);
        const m02 = view.getFloat32(offs + 0x08);
        const m03 = view.getFloat32(offs + 0x0C);
        const m10 = view.getFloat32(offs + 0x10);
        const m11 = view.getFloat32(offs + 0x14);
        const m12 = view.getFloat32(offs + 0x18);
        const m13 = view.getFloat32(offs + 0x1C);
        const m20 = view.getFloat32(offs + 0x20);
        const m21 = view.getFloat32(offs + 0x24);
        const m22 = view.getFloat32(offs + 0x28);
        const m23 = view.getFloat32(offs + 0x2C);
        assert(m00 === 1.0 && m01 === 0.0 && m02 === 0.0 && m03 === 0.0);
        assert(m10 === 0.0 && m11 === 1.0 && m12 === 0.0 && m13 === 0.0);
        assert(m20 === 0.0 && m21 === 0.0 && m22 === 1.0 && m23 === 0.0);

        const x = view.getFloat32(offs + 0x30);
        const y = view.getFloat32(offs + 0x34);
        const z = view.getFloat32(offs + 0x38);
        assert(z === 0.0);
        const position = vec3.fromValues(x, y, z);
        const one = view.getFloat32(offs + 0x3C);
        assert(one === 1.0);
        const rotation = view.getInt8(offs + 0x40);
        assert(rotation === 0x00);
        const contourIndex = view.getUint16(offs + 0x41);

        contourPlacements.push({ contourIndex, position });
        offs += 0x43;
    }

    return { gridWidth, gridHeight, cellX, cellY, contourPlacements };
}

interface UVTR {
    maps: UVTR_Chunk[];
}

function parseUVTR(file: Pilotwings64FSFile): UVTR {
    const maps: UVTR_Chunk[] = [];
    for (let i = 0; i < file.chunks.length; i++)
        maps.push(parseUVTR_Chunk(file.chunks[i]));
    return { maps };
}

enum F3D_GBI {
    // DMA
    G_MTX               = 0x01,
    G_MOVEMEM           = 0x03,
    G_VTX               = 0x04,
    G_DL                = 0x06,

    // IMM
    G_TRI1              = 0xBF,
    G_CULLDL            = 0xBE,
    G_POPMTX            = 0xBD,
    G_MOVEWORD          = 0xBC,
    G_TEXTURE           = 0xBB,
    G_SETOTHERMODE_H    = 0xBA,
    G_SETOTHERMODE_L    = 0xB9,
    G_ENDDL             = 0xB8,
    G_SETGEOMETRYMODE   = 0xB7,
    G_CLEARGEOMETRYMODE = 0xB6,
    G_LINE3D            = 0xB5,
    G_RDPHALF_1         = 0xB4,
    G_RDPHALF_2         = 0xB3,
    G_MODIFYVTX         = 0xB2,
    G_TRI2              = 0xB1,
    G_BRANCH_Z          = 0xB0,
    G_LOAD_UCODE        = 0xAF,

    // RDP
    G_SETCIMG           = 0xFF,
    G_SETZIMG           = 0xFE,
    G_SETTIMG           = 0xFD,
    G_SETCOMBINE        = 0xFC,
    G_SETENVCOLOR       = 0xFB,
    G_SETPRIMCOLOR      = 0xFA,
    G_SETBLENDCOLOR     = 0xF9,
    G_SETFOGCOLOR       = 0xF8,
    G_SETFILLCOLOR      = 0xF7,
    G_FILLRECT          = 0xF6,
    G_SETTILE           = 0xF5,
    G_LOADTILE          = 0xF4,
    G_LOADBLOCK         = 0xF3,
    G_SETTILESIZE       = 0xF2,
    G_LOADTLUT          = 0xF0,
    G_RDPSETOTHERMODE   = 0xEF,
    G_SETPRIMDEPTH      = 0xEE,
    G_SETSCISSOR        = 0xED,
    G_SETCONVERT        = 0xEC,
    G_SETKEYR           = 0xEB,
    G_SETKEYFB          = 0xEA,
    G_RDPFULLSYNC       = 0xE9,
    G_RDPTILESYNC       = 0xE8,
    G_RDPPIPESYNC       = 0xE7,
    G_RDPLOADSYNC       = 0xE6,
    G_TEXRECTFLIP       = 0xE5,
    G_TEXRECT           = 0xE4,
}

interface UVTX_Level {
    width: number;
    height: number;
    pixels: Uint8Array;
}

interface UV_Scroll {
    scaleS: number;
    scaleT: number;
}

interface UVTX {
    name: string;
    width: number;
    height: number;
    fmt: ImageFormat;
    siz: ImageSize;
    levels: UVTX_Level[];
    cms: number;
    cmt: number;
    blendLayer: number;
    uvScroll?: UV_Scroll;
    blendScroll?: UV_Scroll;
}

function parseUVTX_Chunk(chunk: Pilotwings64FSFileChunk, name: string): UVTX {
    const view = chunk.buffer.createDataView();
    const dataSize = view.getUint16(0x00);
    const dlSize = view.getUint16(0x02) * 0x08;

    const scaleS = view.getFloat32(0x04);
    const scaleT = view.getFloat32(0x08);
    const blendScaleS = view.getFloat32(0x0c);
    const blendScaleT = view.getFloat32(0x10);
    const uvScroll: UV_Scroll = { scaleS, scaleT };
    const blendScroll: UV_Scroll = { scaleS: blendScaleS, scaleT: blendScaleT };

    const textureState = new TextureState();
    const tiles: TileState[] = nArray(8, () => new TileState());
    const levels: UVTX_Level[] = [];

    const addr = 0x14 + dataSize;
    const dlEnd = addr + dlSize;
    for (let i = (addr & 0x00FFFFFF); i < dlEnd; i += 0x08) {
        const w0 = view.getUint32(i + 0x00);
        const w1 = view.getUint32(i + 0x04);

        const cmd: F3D_GBI = w0 >>> 24;
        // console.log(hexzero(i, 8), F3D_GBI[cmd], hexzero(w0, 8), hexzero(w1, 8));

        if (cmd === F3D_GBI.G_TEXTURE) {
            const level = (w0 >>> 11) & 0x07;
            const tile  = (w0 >>> 8) & 0x07;
            const on    = !!((w0 >>> 0) & 0x7F);
            const s     = (w1 >>> 16) & 0xFFFF;
            const t     = (w1 >>> 0)  & 0xFFFF;
            assert(on);
            textureState.set(on, tile, level, s, t);
        } else if (cmd === F3D_GBI.G_SETCOMBINE) {
            // state.gDPSetCombine(w0 & 0x00FFFFFF, w1);
        } else if (cmd === F3D_GBI.G_SETOTHERMODE_H) {
            const len = (w0 >>> 0) & 0xFF;
            const sft = (w0 >>> 8) & 0xFF;
            // state.gDPSetOtherModeH(sft, len, w1);
        } else if (cmd === F3D_GBI.G_RDPLOADSYNC) {
            // No need to do anything.
        } else if (cmd === F3D_GBI.G_RDPTILESYNC) {
            // No need to do anything.
        } else if (cmd === F3D_GBI.G_SETTIMG) {
            const fmt = (w0 >>> 21) & 0x07;
            const siz = (w0 >>> 19) & 0x03;
            const w   = (w0 & 0x0FFF) + 1;
            // w1 (the address) is written dynamically by the game engine, so it should
            // always be 0 here.
            assert(w1 === 0);
        } else if (cmd === F3D_GBI.G_SETTILE) {
            const fmt =     (w0 >>> 21) & 0x07;
            const siz =     (w0 >>> 19) & 0x03;
            const line =    (w0 >>>  9) & 0x1FF;
            const tmem =    (w0 >>>  0) & 0x1FF;
            const tile    = (w1 >>> 24) & 0x07;
            const palette = (w1 >>> 20) & 0x0F;
            const cmt =     (w1 >>> 18) & 0x03;
            const maskt =   (w1 >>> 14) & 0x0F;
            const shiftt =  (w1 >>> 10) & 0x0F;
            const cms =     (w1 >>>  8) & 0x03;
            const masks =   (w1 >>>  4) & 0x0F;
            const shifts =  (w1 >>>  0) & 0x0F;
            tiles[tile].set(fmt, siz, line, tmem, palette, cmt, maskt, shiftt, cms, masks, shifts);
        } else if (cmd === F3D_GBI.G_LOADBLOCK) {
            const uls =  (w0 >>> 12) & 0x0FFF;
            const ult =  (w0 >>>  0) & 0x0FFF;
            const tile = (w1 >>> 24) & 0x07;
            const lrs =  (w1 >>> 12) & 0x0FFF;
            const dxt =  (w1 >>>  0) & 0x0FFF;
            // Uploads the tile to TMEM. Should always use the load tile (7).
            assert(tile === 0x07);
            // Make sure we're loading the whole block.
            assert(uls === 0x00 && ult === 0x00);
            // dxt should be 0, this means we need to apply deinterleaving....
            assert(dxt === 0);
        } else if (cmd === F3D_GBI.G_SETTILESIZE) {
            const uls =  (w0 >>> 12) & 0x0FFF;
            const ult =  (w0 >>>  0) & 0x0FFF;
            const tile = (w1 >>> 24) & 0x07;
            const lrs =  (w1 >>> 12) & 0x0FFF;
            const lrt =  (w1 >>>  0) & 0x0FFF;
            tiles[tile].setSize(uls, ult, lrs, lrt);
        } else if (cmd === F3D_GBI.G_ENDDL) {
            break;
        } else if (cmd === F3D_GBI.G_SETPRIMCOLOR) {
            // TODO(jstpierre)
        } else if (cmd === F3D_GBI.G_SETENVCOLOR) {
            // TODO(jstpierre)
        } else {
            console.warn(`Unsupported command ${F3D_GBI[cmd]}`);
        }
    }

    const cms = tiles[textureState.tile].cms;
    const cmt = tiles[textureState.tile].cmt;

    const lastTile = textureState.level + textureState.tile + 1;
    for (let i = textureState.tile; i < lastTile; i++) {
        const tile = tiles[i];

        if (tile.lrs === 0 || tile.lrt === 0) {
            // TODO: handle animated texture, assuming that's what this means
            tile.lrs = view.getUint16(dlEnd + 0x00);
            tile.lrt = view.getUint16(dlEnd + 0x02);
        }

        const tileW = ((tile.lrs - tile.uls) >>> 2) + 1;
        const tileH = ((tile.lrt - tile.ult) >>> 2) + 1;

        if (tile.lrs === 0 || tile.lrt === 0)
            break;

        assert(tile.cms == cms)
        assert(tile.cmt == cmt)

        const dst = new Uint8Array(tileW * tileH * 4);
        const srcOffs = 0x14 + tile.tmem;
        if (tile.fmt === ImageFormat.G_IM_FMT_RGBA && tile.siz === ImageSize.G_IM_SIZ_16b) decodeTex_RGBA16(dst, view, srcOffs, tileW, tileH, tile.line, true);
        else if (tile.fmt === ImageFormat.G_IM_FMT_I && tile.siz === ImageSize.G_IM_SIZ_4b) decodeTex_I4(dst, view, srcOffs, tileW, tileH, tile.line, true);
        else if (tile.fmt === ImageFormat.G_IM_FMT_I && tile.siz === ImageSize.G_IM_SIZ_8b) decodeTex_I8(dst, view, srcOffs, tileW, tileH, tile.line, true);
        else if (tile.fmt === ImageFormat.G_IM_FMT_IA && tile.siz === ImageSize.G_IM_SIZ_4b) decodeTex_IA4(dst, view, srcOffs, tileW, tileH, tile.line, true);
        else if (tile.fmt === ImageFormat.G_IM_FMT_IA && tile.siz === ImageSize.G_IM_SIZ_8b) decodeTex_IA8(dst, view, srcOffs, tileW, tileH, tile.line, true);
        else if (tile.fmt === ImageFormat.G_IM_FMT_IA && tile.siz === ImageSize.G_IM_SIZ_16b) decodeTex_IA16(dst, view, srcOffs, tileW, tileH, tile.line, true);
        else console.warn(`Unsupported texture format ${getImageFormatName(tile.fmt)} / ${getImageSizeName(tile.siz)}`);

        levels.push({ width: tileW, height: tileH, pixels: dst });

        // For now, use only one LOD.
        break;
    }

    const width = levels[0].width, height = levels[0].height;
    const fmt = tiles[textureState.tile].fmt;
    const siz = tiles[textureState.tile].siz;

    const blendLayer = view.getUint16(dlEnd + 0x09);

    return { name, width, height, fmt, siz, levels, cms, cmt, blendLayer, uvScroll, blendScroll };
}

function parseUVTX(file: Pilotwings64FSFile): UVTX {
    assert(file.chunks.length === 1);
    return parseUVTX_Chunk(file.chunks[0], file.name);
}

interface UVLV {
    levels: UVLV_Chunk[];
}

interface UVLV_Chunk {
    terras: Uint16Array;
    lights: Uint16Array;
    envs: Uint16Array;
    models: Uint16Array;
    contours: Uint16Array;
    textures: Uint16Array;
    sqs: Uint16Array;
    anims: Uint16Array;
    fonts: Uint16Array;
    blits: Uint16Array;
}

function parseUVLV_Chunk(chunk: Pilotwings64FSFileChunk): UVLV_Chunk {
    const buffer = chunk.buffer;
    const view = buffer.createDataView();
    const allIndices: Uint16Array[] = [];
    let idx = 0x00;
    for (let i = 0; i < 10; i++) {
        const indicesCount = view.getUint16(idx + 0x00);
        const indices = buffer.createTypedArray(Uint16Array, idx + 0x02, indicesCount, Endianness.BIG_ENDIAN);
        allIndices.push(indices);
        idx += 0x02 + 0x02 * indicesCount;
    }
    return {
        terras: allIndices[0],
        lights: allIndices[1],
        envs: allIndices[2],
        models: allIndices[3],
        contours: allIndices[4],
        textures: allIndices[5],
        sqs: allIndices[6],
        anims: allIndices[7],
        fonts: allIndices[8],
        blits: allIndices[9],
    };
}

function parseUVLV(file: Pilotwings64FSFile): UVLV {
    const levels: UVLV_Chunk[] = [];
    for (let i = 0; i < file.chunks.length; i++)
        levels.push(parseUVLV_Chunk(file.chunks[i]));
    return { levels };
}

interface ModelPart {
    indexData: Uint16Array;
    materials: MaterialData[];
}

interface ModelLOD {
    parts: ModelPart[];
    radius: number;
}

interface UVMD {
    vertexData: Float32Array;
    partPlacements: mat4[];
    lods: ModelLOD[];
    inverseScale: number;
}

function parseUVMD(file: Pilotwings64FSFile): UVMD {
    assert(file.chunks.length == 1);
    const view = file.chunks[0].buffer.createDataView();
    const vertCount = view.getUint16(0x0);
    const lodCount = view.getUint8(0x02);
    const transformCount = view.getUint8(0x03);
    const unknownCount = view.getUint8(0x04);
    // unknown byte, short

    let offs = 0x08;
    const vertexData = new Float32Array(9 * vertCount);
    for (let i = 0; i < vertexData.length;) {
        vertexData[i++] = view.getInt16(offs + 0x00);
        vertexData[i++] = view.getInt16(offs + 0x02);
        vertexData[i++] = view.getInt16(offs + 0x04);
        // Unknown
        vertexData[i++] = (view.getInt16(offs + 0x08) / 0x20) + 0.5;
        vertexData[i++] = (view.getInt16(offs + 0x0A) / 0x20) + 0.5;
        vertexData[i++] = view.getUint8(offs + 0x0C) / 0xFF;
        vertexData[i++] = view.getUint8(offs + 0x0D) / 0xFF;
        vertexData[i++] = view.getUint8(offs + 0x0E) / 0xFF;
        vertexData[i++] = view.getUint8(offs + 0x0F) / 0xFF;
        offs += 0x10;
    }

    const lods: ModelLOD[] = [];
    const vertBuffer = new Uint16Array(16);
    for (let i = 0; i < lodCount; i++) {
        const partCount = view.getUint8(offs + 0x00);
        assert(partCount <= transformCount);
        offs += 0x02;
        const parts: ModelPart[] = [];
        for (let p = 0; p < partCount; p++) {
            const texCount = view.getUint8(offs + 0x00);
            offs += 0x03;

            const indexData: number[] = [];
            const materials: MaterialData[] = [];
            for (let t = 0; t < texCount; t++) {
                const rspModeInfo = view.getUint16(offs + 0x00);
                const textureIndex = view.getUint16(offs + 0x02);
                const otherCount = view.getUint16(offs + 0x04);
                const triCount = view.getUint16(offs + 0x06);
                const commandCount = view.getUint16(offs + 0x08);
                offs += 0x0A;
                const indexOffset = indexData.length;
                for (let c = 0; c < commandCount; c++) {
                    const index = view.getUint16(offs);
                    offs += 0x02;
                    if (index & 0x4000) { // draw face, emulate 0xbf G_TRI1
                        indexData.push(
                            vertBuffer[(index & 0xF00) >> 8],
                            vertBuffer[(index & 0x0F0) >> 4],
                            vertBuffer[(index & 0x00F) >> 0],
                        );
                    } else { // load verts, emulate 0x04 G_VTX
                        const loadCount = view.getUint8(offs++);
                        for (let read = 0, write = loadCount & 0x0F; read <= (loadCount >> 4); read++ , write++)
                            vertBuffer[write] = (index & 0x3FFF) + read;
                    }
                }
                assert(indexData.length - indexOffset == 3 * triCount);
                materials.push({ rspModeInfo, textureIndex, indexOffset, triCount });
            }
            parts.push({ indexData: new Uint16Array(indexData), materials });
        }
        const radius = view.getFloat32(offs);
        offs += 0x04;
        lods.push({ parts, radius });
    }
    const partPlacements: mat4[] = [];
    for (let i = 0; i < transformCount; i++) {
        const m00 = view.getFloat32(offs + 0x00);
        const m01 = view.getFloat32(offs + 0x04);
        const m02 = view.getFloat32(offs + 0x08);
        const m03 = view.getFloat32(offs + 0x0C);
        const m10 = view.getFloat32(offs + 0x10);
        const m11 = view.getFloat32(offs + 0x14);
        const m12 = view.getFloat32(offs + 0x18);
        const m13 = view.getFloat32(offs + 0x1C);
        const m20 = view.getFloat32(offs + 0x20);
        const m21 = view.getFloat32(offs + 0x24);
        const m22 = view.getFloat32(offs + 0x28);
        const m23 = view.getFloat32(offs + 0x2C);
        const x = view.getFloat32(offs + 0x30);
        const y = view.getFloat32(offs + 0x34);
        const z = view.getFloat32(offs + 0x38);
        const one = view.getFloat32(offs + 0x3C);
        assert(one === 1.0);
        const m = mat4.fromValues(
            m00, m01, m02, m03,
            m10, m11, m12, m13,
            m20, m21, m22, m23,
            x, y, z, 1.0
        );
        partPlacements.push(m);
        offs += 0x40;
    }
    offs += unknownCount * 0x24;
    const inverseScale = view.getFloat32(offs + 0x4);
    return { vertexData, partPlacements, lods, inverseScale };
}


function parsePilotwings64FS(buffer: ArrayBufferSlice): Pilotwings64FS {
    const view = buffer.createDataView();

    const files: Pilotwings64FSFile[] = [];
    let offs = 0x00;
    while (offs < buffer.byteLength) {
        const magic = readString(buffer, offs + 0x00, 0x04, false);

        if (magic === '\0\0\0\0')
            break;

        assert(magic === 'FORM');

        const formLength = view.getUint32(offs + 0x04);
        const formEnd = offs + 0x08 + formLength;

        const type = readString(buffer, offs + 0x08, 0x04);
        const name = `${type}_${hexzero(offs, 6)}`;

        offs += 0x0C;

        const chunks: Pilotwings64FSFileChunk[] = [];

        // Read sub-chunks.
        while (offs < formEnd) {
            const subchunkTag = readString(buffer, offs + 0x00, 0x04);
            const subchunkSize = view.getUint32(offs + 0x04);
            const subchunkEnd = offs + 0x08 + subchunkSize;

            if (subchunkTag === 'GZIP') {
                const subchunkTag2 = readString(buffer, offs + 0x08, 0x04);
                const decompressedSize = view.getUint32(offs + 0x0C);
                const decompressed = decompress(buffer.subarray(offs + 0x10, subchunkSize - 0x08));
                assert(decompressed.byteLength === decompressedSize);
                chunks.push({ tag: subchunkTag2, buffer: decompressed });
            } else if (subchunkTag !== 'PAD ') {
                chunks.push({ tag: subchunkTag, buffer: buffer.subarray(offs + 0x08, subchunkSize) });
            }

            offs = subchunkEnd;
        }

        files.push({ name, type, chunks });
        assert(offs === formEnd);
    }

    return { files };
}

class PW64Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_DrawParams = 1;

    public both = `
precision mediump float;

layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(row_major, std140) uniform ub_DrawParams {
    Mat4x3 u_BoneMatrix[1];
    Mat4x2 u_TexMatrix[2];
};

uniform sampler2D u_Texture[2];

varying vec4 v_Color;
varying vec4 v_TexCoord;
`;

    public vert = `
layout(location = ${PW64Program.a_Position}) in vec3 a_Position;
layout(location = ${PW64Program.a_Color}) in vec4 a_Color;
layout(location = ${PW64Program.a_TexCoord}) in vec2 a_TexCoord;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[0]), vec4(a_Position, 1.0)));
    v_Color = a_Color;
    v_TexCoord.xy = Mul(u_TexMatrix[0], vec4(a_TexCoord, 1.0, 1.0));
    v_TexCoord.zw = Mul(u_TexMatrix[1], vec4(a_TexCoord, 1.0, 1.0));
}
`;



    public frag = `
vec4 Texture2D_N64_Point(sampler2D t_Texture, vec2 t_TexCoord) {
    return texture(t_Texture, t_TexCoord);
}

vec4 Texture2D_N64_Average(sampler2D t_Texture, vec2 t_TexCoord) {
    // Unimplemented.
    return texture(t_Texture, t_TexCoord);
}

// Implements N64-style "triangle bilienar filtering" with three taps.
// Based on ArthurCarvalho's implementation, modified by NEC and Jasper for noclip.
vec4 Texture2D_N64_Bilerp(sampler2D t_Texture, vec2 t_TexCoord) {
    vec2 t_Size = vec2(textureSize(t_Texture, 0));
    vec2 t_Offs = fract(t_TexCoord*t_Size - vec2(0.5));
    t_Offs -= step(1.0, t_Offs.x + t_Offs.y);
    vec4 t_S0 = texture(t_Texture, t_TexCoord - t_Offs / t_Size);
    vec4 t_S1 = texture(t_Texture, t_TexCoord - vec2(t_Offs.x - sign(t_Offs.x), t_Offs.y) / t_Size);
    vec4 t_S2 = texture(t_Texture, t_TexCoord - vec2(t_Offs.x, t_Offs.y - sign(t_Offs.y)) / t_Size);
    return t_S0 + abs(t_Offs.x)*(t_S1-t_S0) + abs(t_Offs.y)*(t_S2-t_S0);
}

#define Texture2D_N64 Texture2D_N64_Bilerp

void main() {
    vec4 t_Color = vec4(1.0);

#ifdef USE_TEXTURE
    t_Color *= Texture2D_N64(u_Texture[0], v_TexCoord.xy);
#endif

#ifdef HAS_BLEND
    t_Color *= Texture2D_N64(u_Texture[1], v_TexCoord.zw);
#endif

#ifdef USE_VERTEX_COLOR
    t_Color.rgba *= v_Color.rgba;
#endif

#ifdef USE_ALPHA_VISUALIZER
    t_Color.rgb = vec3(v_Color.a);
    t_Color.a = 1.0;
#endif

    gl_FragColor = t_Color;
}
`;
}

class MeshData {
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;

    constructor(device: GfxDevice, public mesh: Mesh_Chunk) {
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, mesh.vertexData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, mesh.indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: PW64Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 * 0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
            { location: PW64Program.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 3 * 0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
            { location: PW64Program.a_Color, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 5 * 0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
        ];

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, byteStride: 9 * 0x04, },
        ], { buffer: this.indexBuffer, byteOffset: 0, byteStride: 0x02 });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

class MeshRenderer {
    public modelMatrix = mat4.create();
    private materials: MaterialInstance[] = [];

    constructor(device: GfxDevice, private meshData: MeshData, textureData: TextureData[]) {
        for (let material of meshData.mesh.materials)
            this.materials.push(new MaterialInstance(device, material, textureData));
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();

        template.setInputLayoutAndState(this.meshData.inputLayout, this.meshData.inputState);
        for (let material of this.materials) {
            material.prepareToRender(device, renderInstManager, viewerInput, this.modelMatrix);
        }
        renderInstManager.popTemplateRenderInst();
    }
}

const scratchMatrix = mat4.create();
const texMatrixScratch = mat4.create();
class MaterialInstance {
    public program = new PW64Program();
    private hasTexture = false;
    private hasBlend = false;
    private textureMappings: TextureMapping[] = nArray(2, () => new TextureMapping());
    private uvtx: UVTX;

    constructor(device: GfxDevice, private materialData: MaterialData, textureData: TextureData[]) {
        this.hasTexture = materialData.textureIndex < 0x0FFF;
        if (this.hasTexture) {
            const mainTextureData = textureData[materialData.textureIndex];
            this.uvtx = mainTextureData.uvtx;
            mainTextureData.fillTextureMapping(this.textureMappings[0]);
            if (this.uvtx.blendLayer < 0x0FFF) {
                this.hasBlend = true;
                textureData[this.uvtx.blendLayer].fillTextureMapping(this.textureMappings[1]);
            }
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, modelMatrix: mat4): void {
        const renderInst = renderInstManager.pushRenderInst();

        let offs = renderInst.allocateUniformBuffer(PW64Program.ub_DrawParams, 12 + 2 * 8);
        const d = renderInst.mapUniformBufferF32(PW64Program.ub_DrawParams);

        computeViewMatrix(scratchMatrix, viewerInput.camera);
        mat4.mul(scratchMatrix, scratchMatrix, modelMatrix);

        offs += fillMatrix4x3(d, offs, scratchMatrix);
        if (this.hasTexture) {
            renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);

            mat4.fromScaling(texMatrixScratch,
                [1 / this.textureMappings[0].width, 1 / this.textureMappings[0].height, 1]);
            if (this.uvtx.uvScroll) {
                texMatrixScratch[12] = -((viewerInput.time / 1000) * this.uvtx.uvScroll.scaleS) % 1;
                texMatrixScratch[13] = -((viewerInput.time / 1000) * this.uvtx.uvScroll.scaleT) % 1;
            }
            offs += fillMatrix4x2(d, offs, texMatrixScratch);
            this.program.defines.set('USE_TEXTURE', '1');

            if (this.hasBlend) {
                mat4.fromScaling(texMatrixScratch,
                    [1 / this.textureMappings[1].width, 1 / this.textureMappings[1].height, 1]);
                if (this.uvtx.blendScroll) {
                    texMatrixScratch[12] = -((viewerInput.time / 1000) * this.uvtx.blendScroll.scaleS) % 1;
                    texMatrixScratch[13] = -((viewerInput.time / 1000) * this.uvtx.blendScroll.scaleT) % 1;
                }
                offs += fillMatrix4x2(d, offs, texMatrixScratch);
                this.program.defines.set('HAS_BLEND', '1');
            }
        }

        this.program.defines.set('USE_VERTEX_COLOR', '1');
        const gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);
        renderInst.setGfxProgram(gfxProgram);
        renderInst.drawIndexes(3 * this.materialData.triCount, this.materialData.indexOffset);
    }
}

const enum TexCM {
    WRAP = 0x00, MIRROR = 0x01, CLAMP = 0x02,
}

function translateCM(cm: TexCM): GfxWrapMode {
    switch (cm) {
        case TexCM.WRAP: return GfxWrapMode.REPEAT;
        case TexCM.MIRROR: return GfxWrapMode.MIRROR;
        case TexCM.CLAMP: return GfxWrapMode.CLAMP;
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 2 },
];

function textureToCanvas(texture: UVTX): Texture {
    const surfaces: HTMLCanvasElement[] = [];

    for (let i = 0; i < texture.levels.length; i++) {
        const level = texture.levels[i];
        const canvas = document.createElement("canvas")!;
        canvas.width = level.width;
        canvas.height = level.height;

        const ctx = canvas.getContext("2d")!;
        const imgData = ctx.createImageData(canvas.width, canvas.height);
        imgData.data.set(level.pixels);
        ctx.putImageData(imgData, 0, 0);

        surfaces.push(canvas);
    }

    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', `${getImageFormatName(texture.fmt)}${getImageSizeName(texture.siz)}`);

    return { name: texture.name, extraInfo, surfaces };
}

class TextureData {
    public gfxTexture: GfxTexture;
    public gfxSampler: GfxSampler;
    public viewerTexture: Texture;

    constructor(device: GfxDevice, cache: GfxRenderCache, public uvtx: UVTX) {
        const texture = this.uvtx;

        this.gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2D, pixelFormat: GfxFormat.U8_RGBA,
            width: texture.width, height: texture.height, depth: 1, numLevels: texture.levels.length,
        });
        device.setResourceName(this.gfxTexture, texture.name);
        const hostAccessPass = device.createHostAccessPass();
        const levels = texture.levels.map((t) => t.pixels);
        hostAccessPass.uploadTextureData(this.gfxTexture, 0, levels);
        device.submitPass(hostAccessPass);

        this.gfxSampler = cache.createSampler(device, {
            wrapS: translateCM(texture.cms),
            wrapT: translateCM(texture.cmt),
            minFilter: GfxTexFilterMode.POINT,
            magFilter: GfxTexFilterMode.POINT,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0, maxLOD: 0,
        });

        this.viewerTexture = textureToCanvas(uvtx);
    }

    public fillTextureMapping(m: TextureMapping): void {
        m.gfxTexture = this.gfxTexture;
        m.gfxSampler = this.gfxSampler;
        m.width = this.uvtx.width;
        m.height = this.uvtx.height;
        m.lodBias = 0;
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}

class Pilotwings64Renderer implements SceneGfx {
    public uvctData: MeshData[] = [];
    public uvmdData: MeshData[][] = [];
    public uvctInstance: MeshRenderer[] = [];
    public uvmdInstance: MeshRenderer[] = [];
    public renderHelper: GfxRenderHelper;
    public textureData: TextureData[] = [];
    private renderTarget = new BasicRenderTarget();

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setMegaStateFlags({
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
        });

        let offs = template.allocateUniformBuffer(PW64Program.ub_SceneParams, 16);
        const d = template.mapUniformBufferF32(PW64Program.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < this.uvctInstance.length; i++)
            this.uvctInstance[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        for (let i = 0; i < this.uvmdInstance.length; i++)
            this.uvmdInstance[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        const renderInstManager = this.renderHelper.renderInstManager;
        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        const passRenderer = this.renderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        passRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        renderInstManager.drawOnPassRenderer(device, passRenderer);
        renderInstManager.resetRenderInsts();
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
        for (let i = 0; i < this.textureData.length; i++)
            this.textureData[i].destroy(device);
        for (let i = 0; i < this.uvctData.length; i++)
            this.uvctData[i].destroy(device);
        for (let i = 0; i < this.uvmdData.length; i++)
            for (let j = 0; j < this.uvmdData[i].length; j++)
                this.uvmdData[i][j].destroy(device);
    }
}

const toNoclipSpace = mat4.create();
mat4.fromXRotation(toNoclipSpace, -90 * MathConstants.DEG_TO_RAD);
mat4.scale(toNoclipSpace, toNoclipSpace, [50, 50, 50]);

const pathBase = `Pilotwings64`;
class Pilotwings64SceneDesc implements SceneDesc {
    public id: string;
    constructor(public levelID: number, public name: string) {
        this.id = '' + levelID;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const fsBin = await context.dataFetcher.fetchData(`${pathBase}/fs.bin`);
        const fs = parsePilotwings64FS(fsBin);

        const renderer = new Pilotwings64Renderer(device);

        const uvct = fs.files.filter((file) => file.type === 'UVCT').map((file) => parseUVCT(file));

        const uvtr = fs.files.filter((file) => file.type === 'UVTR').map((file) => parseUVTR(file));
        assert(uvtr.length === 1);

        const uvmd = fs.files.filter((file) => file.type === 'UVMD').map((file) => parseUVMD(file));

        const uvctData = uvct.map((uvct) => new MeshData(device, uvct.mesh));
        renderer.uvctData = uvctData;

        const uvmdData = uvmd.map((uvmd) => uvmd.lods[0].parts.map((part) =>
            new MeshData(device, {
                indexData: part.indexData,
                vertexData: uvmd.vertexData,
                materials: part.materials
            })));
        renderer.uvmdData = uvmdData;

        function dummy(name: string): UVTX {
            return {
                name: "dummy_" + name,
                width: 2,
                height: 2,
                fmt: ImageFormat.G_IM_FMT_I,
                siz: ImageSize.G_IM_SIZ_4b,
                levels: [{
                    width: 2,
                    height: 2,
                    pixels: new Uint8Array([
                        0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff,
                        0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00
                    ]),
                }],
                cms: 0,
                cmt: 0,
                blendLayer: 0xfff,
            };
        }
        const uvtx = fs.files.filter((file => file.type === 'UVTX')).map((file) => {
            try {
                return parseUVTX(file);
            } catch (e) {
                // preserve the ordering of the textures for indexing
                return dummy(file.name);
            }
        });

        const cache = renderer.renderHelper.getCache();
        for (let i = 0; i < uvtx.length; i++) {
            const data = new TextureData(device, cache, uvtx[i]);
            renderer.textureData.push(data);
        }

        const levelData = parseUVLV(fs.files.filter((file) => file.type === 'UVLV')[0]).levels[this.levelID];

        for (let terraIndex of levelData.terras) {
            const map = uvtr[0].maps[terraIndex];
            for (let j = 0; j < map.contourPlacements.length; j++) {
                const ct = map.contourPlacements[j];
                const contourInstance = new MeshRenderer(device, uvctData[ct.contourIndex], renderer.textureData);
                mat4.multiply(contourInstance.modelMatrix, contourInstance.modelMatrix, toNoclipSpace);
                mat4.translate(contourInstance.modelMatrix, contourInstance.modelMatrix, ct.position);
                renderer.uvctInstance.push(contourInstance);

                // render attached static models (Sobjs)
                for (let model of uvct[ct.contourIndex].models) {
                    const instances = uvmdData[model.modelIndex].map(
                        (part) => new MeshRenderer(device, part, renderer.textureData)
                    );
                    const relPositions = uvmd[model.modelIndex].partPlacements;
                    for (let k = 0; k < instances.length; k++) {
                        mat4.multiply(instances[k].modelMatrix, instances[k].modelMatrix, contourInstance.modelMatrix);
                        mat4.multiply(instances[k].modelMatrix, instances[k].modelMatrix, model.placement);
                        mat4.multiply(instances[k].modelMatrix, instances[k].modelMatrix, relPositions[k]);
                        renderer.uvmdInstance.push(instances[k]);
                    }
                }
            }
        }
        return renderer;
    }
}

const id = 'Pilotwings64';
const name = "Pilotwings 64";
const sceneDescs = [
    new Pilotwings64SceneDesc(1, 'Holiday Island'),
    new Pilotwings64SceneDesc(3, 'Crescent Island'),
    new Pilotwings64SceneDesc(5, 'Little States'),
    new Pilotwings64SceneDesc(10, 'Ever-Frost Island'),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
