
import {
    GfxDevice, GfxBuffer, GfxInputLayout, GfxInputState, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxFormat, GfxVertexAttributeFrequency,
    GfxRenderPass, GfxHostAccessPass, GfxBindingLayoutDescriptor, GfxTextureDimension, GfxWrapMode, GfxMipFilterMode, GfxTexFilterMode,
    GfxSampler, GfxBlendFactor, GfxBlendMode, GfxTexture, GfxMegaStateDescriptor, GfxCullMode, GfxCompareMode,
} from "../gfx/platform/GfxPlatform";
import { SceneGfx, ViewerRenderInput, Texture } from "../viewer";
import { SceneDesc, SceneContext, SceneGroup } from "../SceneBase";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, assert, hexzero, nArray } from "../util";
import { decompress } from "../compression/MIO0";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { DeviceProgram } from "../Program";
import { GfxRenderInstManager, makeSortKey, GfxRendererLayer, setSortKeyDepth, getSortKeyLayer } from "../gfx/render/GfxRenderer";
import { fillMatrix4x3, fillMatrix4x4, fillMatrix4x2, fillVec4v, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { mat4, vec3, vec4, mat2 } from "gl-matrix";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { standardFullClearRenderPassDescriptor, BasicRenderTarget } from "../gfx/helpers/RenderTargetHelpers";
import { computeViewMatrix } from "../Camera";
import { MathConstants } from "../MathHelpers";
import { TextureState, TileState, getTextFiltFromOtherModeH, OtherModeH_CycleType, getCycleTypeFromOtherModeH } from "../bk/f3dex";
import { ImageFormat, ImageSize, getImageFormatName, decodeTex_RGBA16, getImageSizeName, decodeTex_I4, decodeTex_I8, decodeTex_IA4, decodeTex_IA8, decodeTex_IA16, TextFilt } from "../Common/N64/Image";
import { TextureMapping } from "../TextureHolder";
import { Endianness } from "../endian";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { calcJointMatrix } from "../j3d/j3d";

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
    modelMatrix: mat4;
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
            models.push({ modelIndex, modelMatrix: placement });
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
    shiftS: number;
    shiftT: number;
    usesPaired?: boolean;
}

interface UV_Scroll {
    scaleS: number;
    scaleT: number;
}

const enum CCMUX {
    COMBINED    = 0,
    TEXEL0      = 1,
    TEXEL1      = 2,
    PRIMITIVE   = 3,
    SHADE       = 4,
    ENVIRONMENT = 5,
    ADD_ZERO    = 7,
    // param C only
    COMBINED_A  = 7, // only for C
    TEXEL0_A    = 8,
    TEXEL1_A    = 9,
    PRIMITIVE_A = 10,
    SHADE_A     = 11,
    ENV_A       = 12,
    MUL_ZERO    = 15, // should really be 31
}

const enum ACMUX {
    ADD_COMBINED = 0,
    TEXEL0 = 1,
    TEXEL1 = 2,
    PRIMITIVE = 3,
    SHADE = 4,
    ENVIRONMENT = 5,
    ADD_ONE = 6,
    ZERO = 7,
}

interface CombineParams {
    a: number;
    b: number;
    c: number;
    d: number;
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
    combine: CombineParams[];
    otherModeH: number;
    cutOutTransparent: boolean;
    // TODO: actual name
    otherModeLByte: number;

    pairedIndex?: number;
    uvScroll?: UV_Scroll;
    combineScroll?: UV_Scroll;
    primitive?: vec4;
    environment?: vec4;
}

function parseUVTX_Chunk(chunk: Pilotwings64FSFileChunk, name: string): UVTX {
    const view = chunk.buffer.createDataView();
    const dataSize = view.getUint16(0x00);
    const dlSize = view.getUint16(0x02) * 0x08;

    const combineScaleS = view.getFloat32(0x04);
    const combineScaleT = view.getFloat32(0x08);
    const scaleS = view.getFloat32(0x0c);
    const scaleT = view.getFloat32(0x10);

    let primitive: vec4 | undefined;
    let environment: vec4 | undefined;
    let otherModeH = 0;
    const combine: CombineParams[] = [];

    let setTextureImageCount = 0;
    let pairedTile = -1;

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
            // because we aren't implementing all the combine input options (notably, not noise)
            // and the highest values are just 0, we can get away with throwing away high bits:
            // ax,bx,dx can be 3 bits, and cx can be 4
            const a0  = (w0 >>> 20) & 0x07;
            const c0  = (w0 >>> 15) & 0x0f;
            const Aa0 = (w0 >>> 12) & 0x07;
            const Ac0 = (w0 >>> 9) & 0x07;
            const a1  = (w0 >>> 5) & 0x07;
            const c1  = (w0 >>> 0) & 0x0f;
            const b0  = (w1 >>> 28) & 0x07;
            const b1  = (w1 >>> 24) & 0x07;
            const Aa1 = (w1 >>> 21) & 0x07;
            const Ac1 = (w1 >>> 18) & 0x07;
            const d0  = (w1 >>> 15) & 0x07;
            const Ab0 = (w1 >>> 12) & 0x07;
            const Ad0 = (w1 >>> 9) & 0x07;
            const d1  = (w1 >>> 6) & 0x07;
            const Ab1 = (w1 >>> 3) & 0x07;
            const Ad1 = (w1 >>> 0) & 0x07;

            combine.push(
                { a: a0, b: b0, c: c0, d: d0 },
                { a: Aa0, b: Ab0, c: Ac0, d: Ad0 },
                { a: a1, b: b1, c: c1, d: d1 },
                { a: Aa1, b: Ab1, c: Ac1, d: Ad1 }
            );
            // state.gDPSetCombine(w0 & 0x00FFFFFF, w1);
        } else if (cmd === F3D_GBI.G_SETOTHERMODE_H) {
            const len = (w0 >>> 0) & 0xFF;
            const sft = (w0 >>> 8) & 0xFF;
            // state.gDPSetOtherModeH(sft, len, w1);
            otherModeH |= w1; // assume each mode is only set once
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
            setTextureImageCount++;
            assert(setTextureImageCount <= 2);
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
            if (setTextureImageCount === 2) {
                // we're seen two SETTIMG, either this is the first set_tile
                // or we've seen one to load the texture, using tile 7
                assert(pairedTile === -1 || pairedTile === 7);
                pairedTile = tile;
            }
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
            // skipping LOD params
            primitive = vec4.fromValues(
                ((w1 >>> 24) & 0xff) / 0xff,
                ((w1 >>> 16) & 0xff) / 0xff,
                ((w1 >>> 8) & 0xff) / 0xff,
                ((w1 >>> 0) & 0xff) / 0xff,
            );
        } else if (cmd === F3D_GBI.G_SETENVCOLOR) {
            environment = vec4.fromValues(
                ((w1 >>> 24) & 0xff) / 0xff,
                ((w1 >>> 16) & 0xff) / 0xff,
                ((w1 >>> 8) & 0xff) / 0xff,
                ((w1 >>> 0) & 0xff) / 0xff,
            );
        } else {
            console.warn(`Unsupported command ${F3D_GBI[cmd]}`);
        }
    }

    const cutOutTransparent = (view.getUint16(dlEnd + 0x07) >>> 15) === 0;
    const pairedIndex = view.getUint16(dlEnd + 0x09);
    const otherModeLByte = view.getUint8(dlEnd + 0x0d);
    if (setTextureImageCount > 1) {
        // we load another texture, make sure it's there
        assert(pairedIndex < 0xfff);
    }

    const lastTile = textureState.level + textureState.tile + 1;
    // since we're ignoring mipmapping for now, only allow two tiles,
    // and only when there is a paired texture
    for (let i = textureState.tile; i <= textureState.tile + 1; i++) {
        const tile = tiles[i];

        if (tile.lrs === 0 && tile.lrt === 0) { // technically a 1x1 texture
            assert(scaleS != 0 || scaleT != 0 || combineScaleS != 0 || combineScaleT != 0)
            // convert stored dimensions to fixed point
            tile.lrs = view.getUint16(dlEnd + 0x00) * 4 - 4;
            tile.lrt = view.getUint16(dlEnd + 0x02) * 4 - 4;
        }

        const usesPaired = pairedTile === i;

        const tileW = ((tile.lrs - tile.uls) >>> 2) + 1;
        const tileH = ((tile.lrt - tile.ult) >>> 2) + 1;

        const dst = new Uint8Array(tileW * tileH * 4);
        const srcOffs = 0x14 + tile.tmem;

        if (!usesPaired) { // only store this texture's data if it's used
            if (tile.fmt === ImageFormat.G_IM_FMT_RGBA && tile.siz === ImageSize.G_IM_SIZ_16b) decodeTex_RGBA16(dst, view, srcOffs, tileW, tileH, tile.line, true);
            else if (tile.fmt === ImageFormat.G_IM_FMT_I && tile.siz === ImageSize.G_IM_SIZ_4b) decodeTex_I4(dst, view, srcOffs, tileW, tileH, tile.line, true);
            else if (tile.fmt === ImageFormat.G_IM_FMT_I && tile.siz === ImageSize.G_IM_SIZ_8b) decodeTex_I8(dst, view, srcOffs, tileW, tileH, tile.line, true);
            else if (tile.fmt === ImageFormat.G_IM_FMT_IA && tile.siz === ImageSize.G_IM_SIZ_4b) decodeTex_IA4(dst, view, srcOffs, tileW, tileH, tile.line, true);
            else if (tile.fmt === ImageFormat.G_IM_FMT_IA && tile.siz === ImageSize.G_IM_SIZ_8b) decodeTex_IA8(dst, view, srcOffs, tileW, tileH, tile.line, true);
            else if (tile.fmt === ImageFormat.G_IM_FMT_IA && tile.siz === ImageSize.G_IM_SIZ_16b) decodeTex_IA16(dst, view, srcOffs, tileW, tileH, tile.line, true);
            else console.warn(`Unsupported texture format ${getImageFormatName(tile.fmt)} / ${getImageSizeName(tile.siz)}`);
        }

        levels.push({ width: tileW, height: tileH, pixels: dst, shiftS: tile.shifts, shiftT: tile.shiftt, usesPaired });

        // For now, use only one LOD.
        if (pairedIndex == 0xfff)
            break;
    }

    // skip over the main tile if it uses a paired
    const tileOffset = textureState.tile === pairedTile ? 1 : 0;
    const mainTile = tiles[textureState.tile + tileOffset]

    const cms = mainTile.cms, cmt = mainTile.cmt;
    const width = levels[tileOffset].width, height = levels[tileOffset].height;
    const fmt = mainTile.fmt;
    const siz = mainTile.siz;

    const uvtx: UVTX = {
        name, width, height, fmt, siz, levels, cms, cmt,
        combine, otherModeH, cutOutTransparent, otherModeLByte
    };

    if (scaleS !== 0.0 || scaleT !== 0.0) {
        uvtx.uvScroll = { scaleS, scaleT };
    }
    if (combineScaleS !== 0.0 || combineScaleT !== 0.0) {
        uvtx.combineScroll = { scaleS: combineScaleS, scaleT: combineScaleT };
    }
    if (!!primitive) {
        uvtx.primitive = primitive;
    }
    if (!!environment) {
        uvtx.environment = environment;
    }
    if (pairedIndex < 0xfff) {
        uvtx.pairedIndex = pairedIndex;
    }

    return uvtx;
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
    attachmentLevel: number;
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
    hasTransparency: boolean;
}

function parseUVMD(file: Pilotwings64FSFile): UVMD {
    assert(file.chunks.length == 1);
    const view = file.chunks[0].buffer.createDataView();
    const vertCount = view.getUint16(0x0);
    const lodCount = view.getUint8(0x02);
    const transformCount = view.getUint8(0x03);
    const unknownCount = view.getUint8(0x04);
    const hasTransparency = view.getInt8(0x05) > 0;
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
            const attachmentLevel = view.getUint8(offs + 0x02);
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
            parts.push({ indexData: new Uint16Array(indexData), materials, attachmentLevel });
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
    return { vertexData, partPlacements, lods, inverseScale, hasTransparency };
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
    public static ub_CombineParams = 2;

    public both = `
precision mediump float;

layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(row_major, std140) uniform ub_DrawParams {
    Mat4x3 u_BoneMatrix[1];
    Mat4x2 u_TexMatrix[2];
};

uniform ub_CombineParameters {
    vec4 u_Params;
    vec4 u_PrimColor;
    vec4 u_EnvColor;
};

uniform sampler2D u_Texture[2];

varying vec4 v_Color;
varying vec4 v_TexCoord;

const vec4 zero = vec4(0.0);
const vec4 one = vec4(1.0);

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
ivec4 getParams(float val) {
    int orig = int(val);
    ivec4 params;
    params.x = (orig >> 12) & 0xf;
    params.y = (orig >> 8) & 0xf;
    params.z = (orig >> 4) & 0xf;
    params.w = (orig >> 0) & 0xf;

    return params;
}

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

vec3 combineColorCycle(vec4 combColor, vec4 tex0, vec4 tex1, float params) {

    vec3 colorInputs[8] = vec3[8](
        combColor.rgb, tex0.rgb, tex1.rgb, u_PrimColor.rgb,
        v_Color.rgb, u_EnvColor.rgb, one.rgb, zero.rgb
    );

    vec3 multInputs[16] = vec3[16](
        combColor.rgb, tex0.rgb, tex1.rgb, u_PrimColor.rgb,
        v_Color.rgb, u_EnvColor.rgb, zero.rgb /* key */, combColor.aaa,
        tex0.aaa, tex1.aaa, u_PrimColor.aaa, v_Color.aaa,
        u_EnvColor.aaa, zero.rgb /* LOD */, zero.rgb /* prim LOD */, zero.rgb
    );

    ivec4 p = getParams(params);

    return (colorInputs[p.x]-colorInputs[p.y])*multInputs[p.z] + colorInputs[p.w];
}

float combineAlphaCycle(float combAlpha, float tex0, float tex1, float params) {
    float alphaInputs[8] = float[8](
        combAlpha, tex0, tex1, u_PrimColor.a,
        v_Color.a, 0.0, 1.0, 0.0
    );

    ivec4 p = getParams(params);

    return (alphaInputs[p.x]-alphaInputs[p.y])*alphaInputs[p.z] + alphaInputs[p.w];
}
#ifdef BILERP_FILTER
#define Texture2D_N64 Texture2D_N64_Bilerp
#else
#define Texture2D_N64 Texture2D_N64_Point
#endif


void main() {
    vec4 tex0;
    vec4 tex1;
#ifdef USE_TEXTURE
    tex0 = Texture2D_N64(u_Texture[0], v_TexCoord.xy);
    tex1 = tex0;
#endif

#ifdef HAS_PAIRED_TEXTURE
    tex1 = Texture2D_N64(u_Texture[1], v_TexCoord.zw);
#endif

    vec4 t_Color = vec4(
        combineColorCycle(zero, tex0, tex1, u_Params.x).rgb,
        combineAlphaCycle(zero.a, tex0.a, tex1.a, u_Params.y)
    );

#ifdef TWO_CYCLE
    t_Color = vec4(
        combineColorCycle(t_Color, tex0, tex1, u_Params.z).rgb,
        combineAlphaCycle(t_Color.a, tex0.a, tex1.a, u_Params.w)
    );
#endif

#ifdef USE_VERTEX_COLOR
    t_Color.rgba = v_Color.rgba;
#endif

#ifdef USE_ALPHA_VISUALIZER
    t_Color.rgb = vec3(t_Color.a);
    t_Color.a = 1.0;
#endif

    gl_FragColor = t_Color;

#ifdef CVG_X_ALPHA
    // this line is taken from GlideN64, but here's some rationale:
    // With this bit set, the pixel coverage value is multiplied by alpha
    // before being sent to the blender. While coverage mostly matters for
    // the n64 antialiasing, a pixel with zero coverage will be ignored.
    // Since coverage is really an integer from 0 to 8, we assume anything
    // less than 1 would be truncated to 0, leading to the value below.
    if (gl_FragColor.a < 0.125)
        discard;
#endif
}
`;
}

class ModelData {
    public parts: MeshData[];
    public partParentIndices: number[];

    constructor(device: GfxDevice, public uvmd: UVMD, public modelIndex: number) {
        // Only load LOD 0 for now...
        const lod = uvmd.lods[0];

        this.parts = lod.parts.map((part) => {
            // TODO(jstpierre): Don't create this fake mesh chunk...
            const meshChunk = { vertexData: uvmd.vertexData, indexData: part.indexData, materials: part.materials };
            return new MeshData(device, meshChunk);
        });

        // TODO(jstpierre): Replace with a PartData (???)
        const partLevels = lod.parts.map((part) => part.attachmentLevel);
        this.partParentIndices = interpretPartHierarchy(partLevels);
    }

    public destroy(device: GfxDevice): void {
        for (let part of this.parts)
            part.destroy(device);
    }
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

function badAtan2(x: number, y:number): number {
    if (x === 0 && y === 0) {
        return 0;
    }
    const absX = Math.abs(x), absY = Math.abs(y);
    const ratio = absX < absY? absX/absY : absY/absX;
    const delta = Math.abs(absX-absY);
    const baseValue = ratio*(0.785398+delta*0.309);
    let corrected = absX < absY? baseValue : Math.PI/2 - baseValue;
    if (y < 0)
        corrected = Math.PI - corrected;
    if (x >= 0)
        return corrected;
    else
        return -corrected;
}

// The original code uses an "in-order depth list" like: [0, 1, 1, 2, 3, 1, 2, 2]
// Each increment upwards pushes a new stack (only increments of one are allowed)
// Decrement pops back up to that list depth. Same number means siblings...
//
// TODO(jstpierre): Figure out what [1, 1, 2, 3] means... the first node should always
// be a parent of the root... right?
function interpretPartHierarchy(partLevels: number[]): number[] {
    // Translate to a list of parents for each node. -1 means "above root" node.
    const parents: number[] = [-1];

    // The depth stack.
    const depthStack: number[] = [0];

    for (let i = 1; i < partLevels.length; i++) {
        const last = partLevels[i - 1], cur = partLevels[i];
        assert(cur > 0);
        if (cur > last)
            assert(cur === last + 1);
        parents[i] = depthStack[cur - 1];
        depthStack[cur] = i;
    }

    return parents;
}

abstract class ObjectRenderer {
    private static jointMatrixScratch = nArray(16, () => mat4.create());

    public modelMatrix = mat4.create();
    protected partRenderers: MeshRenderer[] = [];
    private visible = true;

    constructor(protected model: ModelData, textureData: TextureData[]) {
        for (let i = 0; i < model.parts.length; i++) {
            const partRenderer = new MeshRenderer(model.parts[i], textureData);
            this.partRenderers.push(partRenderer);
        }

        assert((model.parts.length + 1) <= ObjectRenderer.jointMatrixScratch.length);
    }

    protected abstract calcAnimJoint(dst: mat4, viewerInput: ViewerRenderInput, partIndex: number): void;

    protected calcAnim(dst: mat4[], viewerInput: ViewerRenderInput, parentModelMatrix: mat4): void {
        for (let i = 0; i < this.partRenderers.length; i++) {
            const parentIndex = this.model.partParentIndices[i];

            let parentMatrix: mat4;
            if (parentIndex === -1) {
                // Root matrix.
                parentMatrix = scratchMatrix;
                mat4.mul(parentMatrix, parentModelMatrix, this.modelMatrix);
            } else {
                parentMatrix = ObjectRenderer.jointMatrixScratch[parentIndex];
            }

            mat4.copy(dst[i], this.model.uvmd.partPlacements[i]);
            this.calcAnimJoint(dst[i], viewerInput, i);
            mat4.mul(dst[i], parentMatrix, dst[i]);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, parentModelMatrix: mat4): void {
        if (!this.visible)
            return;

        const template = renderInstManager.pushTemplateRenderInst();
        template.sortKey = makeSortKey(this.model.uvmd.hasTransparency ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE);

        const jointMatrixScratch = ObjectRenderer.jointMatrixScratch;
        this.calcAnim(jointMatrixScratch, viewerInput, parentModelMatrix);

        for (let i = 0; i < this.partRenderers.length; i++)
            this.partRenderers[i].prepareToRender(device, renderInstManager, viewerInput, jointMatrixScratch[i]);

        renderInstManager.popTemplateRenderInst();
    }
}

class LegacyToyObjectRenderer extends ObjectRenderer {
    private partToyMotions: (ToyMotion | null)[] = [];

    constructor(model: ModelData, textureData: TextureData[]) {
        super(model, textureData);

        for (let i = 0; i < model.parts.length; i++) {
            const toyMotion = getToyMotion(this.model.modelIndex, i);
            this.partToyMotions.push(toyMotion);
        }
    }

    private calcAnimToyMotion(dst: mat4, viewerInput: ViewerRenderInput, toyMotion: ToyMotion): void {
        if (toyMotion.rotation) {
            const rotation = toyMotion.rotation;
            mat4.rotate(dst, dst, rotation.speed * viewerInput.time / 1000, rotation.axis);
        } else if (toyMotion.oscillation) {
            const osc = toyMotion.oscillation;
            const radians = badAtan2(osc.xScale * Math.sin(osc.speed * viewerInput.time / 1000), osc.yScale);
            mat4.rotate(dst, dst, radians, osc.axis);
        }
    }

    protected calcAnimJoint(dst: mat4, viewerInput: ViewerRenderInput, partIndex: number): void {
        const toyMotion = this.partToyMotions[partIndex];
        if (toyMotion !== null)
            this.calcAnimToyMotion(dst, viewerInput, toyMotion);
    }
 }

class MeshRenderer {
    public static scratchMatrix = mat4.create();
    private materials: MaterialInstance[] = [];
    private visible = true;

    constructor(private meshData: MeshData, textureData: TextureData[]) {
        for (let material of meshData.mesh.materials)
            this.materials.push(new MaterialInstance(material, textureData));
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, jointMatrix: mat4): void {
        if (!this.visible)
            return;

        const template = renderInstManager.pushTemplateRenderInst();

        template.setInputLayoutAndState(this.meshData.inputLayout, this.meshData.inputState);
        for (let i = 0; i < this.materials.length; i++)
            this.materials[i].prepareToRender(device, renderInstManager, viewerInput, jointMatrix);
        renderInstManager.popTemplateRenderInst();
    }
}

function packParams(params: CombineParams): number {
    return (params.a << 12) | (params.b << 8) | (params.c << 4) | params.d;
}

function calcScaleForShift(shift: number): number {
    if (shift <= 10) {
        return 1 / (1 << shift);
    } else {
        return 1 << (16 - shift);
    }
}

const enum F3D_RSP_Geometry_Flags {
    G_ZBUFFER            = 1 << 0,
    G_SHADE              = 1 << 2,
    G_SHADING_SMOOTH     = 1 << 9,
    G_CULL_FRONT         = 1 << 12,
    G_CULL_BACK          = 1 << 13,
    G_FOG                = 1 << 16,
    G_LIGHTING           = 1 << 17,
    G_TEXTURE_GEN        = 1 << 18,
    G_TEXTURE_GEN_LINEAR = 1 << 19,
    G_CLIPPING           = 1 << 23,
}

const enum OtherModeL_Layout {
    // cycle-independent
    AA_EN         = 3,
    Z_CMP         = 4,
    Z_UPD         = 5,
    IM_RD         = 6,
    CLR_ON_CVG    = 7,
    CVG_DST       = 8,
    ZMODE         = 10,
    CVG_X_ALPHA   = 12,
    ALPHA_CVG_SEL = 13,
    FORCE_BL      = 14,
    // bit 15 unused, was "TEX_EDGE"
    // cycle-dependent
    B_2 = 16,
    B_1 = 18,
    M_2 = 20,
    M_1 = 22,
    A_2 = 24,
    A_1 = 26,
    P_2 = 28,
    P_1 = 30,
}

const enum ZMode {
    ZMODE_OPA   = 0,
    ZMODE_INTER = 1,
    ZMODE_XLU   = 2, // translucent
    ZMODE_DEC   = 3,
}

const enum BlendParam_PM_Color {
    G_BL_CLR_IN  = 0,
    G_BL_CLR_MEM = 1,
    G_BL_CLR_BL  = 2,
    G_BL_CLR_FOG = 3,
}

const enum BlendParam_A {
    G_BL_A_IN    = 0,
    G_BL_A_FOG   = 1,
    G_BL_A_SHADE = 2,
    G_BL_0       = 3,
}

const enum BlendParam_B {
    G_BL_1MA   = 0,
    G_BL_A_MEM = 1,
    G_BL_1     = 2,
    G_BL_0     = 3,
}

interface decodeMaterialResult {
    geoMode: number;
    renderMode: number;
    scaleOverride?: number;
    combineOverride?: CombineParams[];
}

const enum PilotwingsRSPFlag {
    GOURAUD     = 1 << 1,
    CULL_FRONT  = 1 << 3,
    CULL_BACK   = 1 << 4,
    // mode index
    ZBUFFER     = 1 << 5, // for non-decal modes, anyway
    ANTIALIAS   = 1 << 6,
    TRANSPARENT = 1 << 7,
    DECAL       = 1 << 8,

    LIGHTING    = 1 << 11,
    FOG         = 1 << 15,
}

const pilotWingsRenderModeList = [
    0x03024000, // 0x0, forced pass through
    0x00112230, // 0x1, RM_ZB_OPA_SURF
    0x00102048, // 0x2, RM_AA_OPA_TERR
    0x00102078, // 0X3, RM_AA_ZB_OPA_TERR
    0x00104240, // 0X4, RM_XLU_SURF
    0x00104a50, // 0X5, RM_ZB_XLU_SURF
    0x001041c8, // 0X6, RM_AA_XLU_SURF
    0x001045d8, // 0X7, RM_AA_ZB_XLU_INTER
    // decal modes must use Z buffer, so the lowest bit stops mattering
    0x00112e10, // 0X8, RM_ZB_OPA_DECAL
    0x00112e10,
    0x00112d58, // 0XA, RM_AA_ZB_OPA_DECAL
    0x00112d58,
    0x00104e50, // 0XC, RM_ZB_XLU_DECAL
    0x00104e50,
    0x00104dd8, // 0XE, RM_AA_ZB_XLU_DECAL
    0x00104dd8,
];

function decodeMaterial(rspMode: number, hasTexture: boolean, cutOutTransparent: boolean, textureByte: number): decodeMaterialResult {
    // all of the combine commands actually generated by the original code have two separate cycles,
    // with the second cycle generally passing through the first value

    // TODO: figure these out, float @ 249208
    // if (mysteryFloat < 0) {
    //     rspMode |= PilotwingsRSPFlag.FOG | PilotwingsRSPFlag.GOURAUD
    // }
    if (rspMode & (1 << 9)) {
        // build dlist from fn_221e08
        throw "found alternate dlist: " + rspMode;
    }

    let geoMode = 0;
    if (rspMode & PilotwingsRSPFlag.LIGHTING)
        geoMode |= F3D_RSP_Geometry_Flags.G_LIGHTING | F3D_RSP_Geometry_Flags.G_TEXTURE_GEN;
    if (rspMode & PilotwingsRSPFlag.CULL_BACK)
        geoMode |= F3D_RSP_Geometry_Flags.G_CULL_BACK;
    if (rspMode & PilotwingsRSPFlag.CULL_FRONT)
        geoMode |= F3D_RSP_Geometry_Flags.G_CULL_FRONT;
    if (rspMode & PilotwingsRSPFlag.GOURAUD)
        geoMode |= F3D_RSP_Geometry_Flags.G_SHADING_SMOOTH;
    if (rspMode & PilotwingsRSPFlag.ZBUFFER)
        geoMode |= F3D_RSP_Geometry_Flags.G_ZBUFFER;
    if (rspMode & PilotwingsRSPFlag.FOG)
        geoMode |= F3D_RSP_Geometry_Flags.G_FOG;

    let combineOverride: CombineParams[] = [];
    let scaleOverride = 0;

    if (hasTexture && (rspMode & PilotwingsRSPFlag.LIGHTING)) {
        combineOverride = [
            { a: CCMUX.ADD_ZERO, b: CCMUX.ADD_ZERO, c: CCMUX.MUL_ZERO, d: CCMUX.TEXEL0 },
            { a: ACMUX.ZERO, b: ACMUX.ZERO, c: ACMUX.ZERO, d: ACMUX.SHADE },
            { a: CCMUX.ADD_ZERO, b: CCMUX.ADD_ZERO, c: CCMUX.MUL_ZERO, d: CCMUX.TEXEL0 },
            { a: ACMUX.ZERO, b: ACMUX.ZERO, c: ACMUX.ZERO, d: ACMUX.SHADE },
        ];
        scaleOverride = 0x7c00 / 0x10000;
    }

    if (rspMode & PilotwingsRSPFlag.DECAL) {
        // another G_TEXTURE command with the same scale as the given texture, 
        // but setting an unknown flag: 0xbb10____
    }

    const modeIndex = (rspMode >>> 5) & 0x0f
    const invalidMode = 0x03024000; // used for invalid mode index, though that's impossible
    let renderMode = pilotWingsRenderModeList[modeIndex];

    if (modeIndex === 6 && cutOutTransparent) {
        renderMode = 0x00103048 // RM_AA_TEX_TERR
    }
    if (modeIndex === 7 && hasTexture) {
        if (!cutOutTransparent || textureByte === 1 || (rspMode >>> 10) & 1) {
            renderMode = 0x001049d8 // RM_AA_ZB_XLU_SURF
        } else {
            renderMode = 0x00103078 // RM_AA_ZB_TEX_TERR
        }
    }
    if ((rspMode >>> 12) & 1) {
        renderMode = 0x111103f0 // custom mode, scale memory value based on fog
    }
    if (rspMode & PilotwingsRSPFlag.FOG) {
        // blend with fog first cycle
        renderMode |=
            (BlendParam_PM_Color.G_BL_CLR_FOG << OtherModeL_Layout.P_1) |
            (BlendParam_A.G_BL_A_FOG << OtherModeL_Layout.A_1);
        if (modeIndex === 7) {
            if (hasTexture) {
                combineOverride = [
                    { a: CCMUX.TEXEL0, b: CCMUX.ADD_ZERO, c: CCMUX.SHADE, d: CCMUX.ADD_ZERO },
                    { a: ACMUX.ZERO, b: ACMUX.ZERO, c: ACMUX.ZERO, d: ACMUX.TEXEL0 },
                    { a: CCMUX.ADD_ZERO, b: CCMUX.ADD_ZERO, c: CCMUX.MUL_ZERO, d: CCMUX.COMBINED },
                    { a: ACMUX.ZERO, b: ACMUX.ZERO, c: ACMUX.ZERO, d: ACMUX.ADD_COMBINED }
                ];
            } else {
                combineOverride = [
                    { a: CCMUX.ADD_ZERO, b: CCMUX.ADD_ZERO, c: CCMUX.MUL_ZERO, d: CCMUX.SHADE },
                    { a: ACMUX.ZERO, b: ACMUX.ZERO, c: ACMUX.ZERO, d: ACMUX.SHADE },
                    { a: CCMUX.ADD_ZERO, b: CCMUX.ADD_ZERO, c: CCMUX.MUL_ZERO, d: CCMUX.COMBINED },
                    { a: ACMUX.ZERO, b: ACMUX.ZERO, c: ACMUX.ZERO, d: ACMUX.ADD_COMBINED },
                ];
            }
        }
    } else {
        // pass through input in first cycle
        renderMode |=
            (BlendParam_A.G_BL_0 << OtherModeL_Layout.A_1) |
            (BlendParam_B.G_BL_1 << OtherModeL_Layout.B_1);
    }

    const result: decodeMaterialResult = { geoMode, renderMode };
    if (combineOverride.length > 0) {
        result.combineOverride = combineOverride;
    }
    if (scaleOverride > 0) {
        result.scaleOverride = scaleOverride
    }

    return result;
}

function translateBlendParamB(paramB: BlendParam_B, srcParam: GfxBlendFactor): GfxBlendFactor {
    if (paramB === BlendParam_B.G_BL_1MA) {
        if (srcParam === GfxBlendFactor.SRC_ALPHA)
            return GfxBlendFactor.ONE_MINUS_SRC_ALPHA;
        if (srcParam === GfxBlendFactor.ONE)
            return GfxBlendFactor.ZERO;
        return GfxBlendFactor.ONE;
    }
    if (paramB === BlendParam_B.G_BL_A_MEM)
        return GfxBlendFactor.DST_ALPHA;
    if (paramB === BlendParam_B.G_BL_1)
        return GfxBlendFactor.ONE;
    if (paramB === BlendParam_B.G_BL_0)
        return GfxBlendFactor.ZERO;

    throw "Unknown Blend Param B: "+paramB;
}

function translateZMode(zmode: ZMode): GfxCompareMode {
    if (zmode === ZMode.ZMODE_OPA)
        return GfxCompareMode.GREATER;
    if (zmode === ZMode.ZMODE_INTER) // TODO: understand this better
        return GfxCompareMode.GREATER;
    if (zmode === ZMode.ZMODE_XLU)
        return GfxCompareMode.GREATER;
    if (zmode === ZMode.ZMODE_DEC)
        return GfxCompareMode.GEQUAL;
    throw "Unknown Z mode: " + zmode;
}

function translateBlendMode(geoMode: number, renderMode: number): Partial<GfxMegaStateDescriptor> {
    const out: Partial<GfxMegaStateDescriptor> = {};

    if (renderMode & (1 << OtherModeL_Layout.FORCE_BL)) {
        const srcColor: BlendParam_PM_Color = (renderMode >>> OtherModeL_Layout.P_2) & 0x03;
        const srcFactor: BlendParam_A = (renderMode >>> OtherModeL_Layout.A_2) & 0x03;
        const dstColor: BlendParam_PM_Color = (renderMode >>> OtherModeL_Layout.M_2) & 0x03;
        const dstFactor: BlendParam_B = (renderMode >>> OtherModeL_Layout.B_2) & 0x03;

        assert(srcColor === BlendParam_PM_Color.G_BL_CLR_IN);
        assert(dstColor === BlendParam_PM_Color.G_BL_CLR_MEM || dstFactor === BlendParam_B.G_BL_0);

        if (srcFactor === BlendParam_A.G_BL_0) {
            out.blendSrcFactor = GfxBlendFactor.ZERO;
        } else if ((renderMode & (1 << OtherModeL_Layout.ALPHA_CVG_SEL)) &&
            !(renderMode & (1 << OtherModeL_Layout.CVG_X_ALPHA))) {
            // this is technically "coverage", admitting blending on edges
            out.blendSrcFactor = GfxBlendFactor.ONE;
        } else {
            out.blendSrcFactor = GfxBlendFactor.SRC_ALPHA;
        }
        out.blendDstFactor = translateBlendParamB(dstFactor, out.blendSrcFactor);
    } else {
        // without FORCE_BL, blending only happens for AA of internal edges
        // since we are ignoring n64 coverage values and AA, this means "never"
        out.blendSrcFactor = GfxBlendFactor.ONE;
        out.blendDstFactor = GfxBlendFactor.ZERO;
    }

    if (geoMode & F3D_RSP_Geometry_Flags.G_CULL_BACK) {
        if (geoMode & F3D_RSP_Geometry_Flags.G_CULL_FRONT) {
            out.cullMode = GfxCullMode.FRONT_AND_BACK;
        } else {
            out.cullMode = GfxCullMode.BACK;
        }
    } else if (geoMode & F3D_RSP_Geometry_Flags.G_CULL_FRONT) {
        out.cullMode = GfxCullMode.FRONT;
    } else {
        out.cullMode = GfxCullMode.NONE;
    }

    if (renderMode & (1 << OtherModeL_Layout.Z_CMP)) {
        const zmode: ZMode = (renderMode >>> OtherModeL_Layout.ZMODE) & 0x03;
        out.depthCompare = translateZMode(zmode);
    }

    const zmode:ZMode = (renderMode >>> OtherModeL_Layout.ZMODE) & 0x03;
    if (zmode === ZMode.ZMODE_DEC)
        out.polygonOffset = true;

    out.depthWrite = (renderMode & (1 << OtherModeL_Layout.Z_UPD)) !== 0;

    return out;
}

function scrollTexture(dest: mat4, millis: number, scroll: UV_Scroll) {
    const sOffset = ((millis / 1000) * scroll.scaleS) % 1;
    const tOffset = ((millis / 1000) * scroll.scaleT) % 1;
    dest[12] = -(sOffset >= 0 ? sOffset : sOffset + 1);
    dest[13] = -(tOffset >= 0 ? tOffset : tOffset + 1);
}

const scratchMatrix = mat4.create();
const texMatrixScratch = mat4.create();
class MaterialInstance {
    public program = new PW64Program();
    private hasTexture = false;
    private hasPairedTexture = false;
    private textureMappings: TextureMapping[] = nArray(2, () => new TextureMapping());
    private uvtx: UVTX;
    private decodedMaterial: decodeMaterialResult;
    private stateFlags: Partial<GfxMegaStateDescriptor>;
    private visible = true;

    constructor(private materialData: MaterialData, textureData: TextureData[]) {
        this.hasTexture = materialData.textureIndex < 0x0FFF;
        if (this.hasTexture) {
            const mainTextureData = textureData[materialData.textureIndex];
            this.uvtx = mainTextureData.uvtx;
            mainTextureData.fillTextureMapping(this.textureMappings[0]);
            if (this.uvtx.pairedIndex !== undefined) {
                this.hasPairedTexture = true;
                assert(this.uvtx.levels.length > 1);
                textureData[this.uvtx.pairedIndex].fillTextureMapping(this.textureMappings[1]);
                if (this.uvtx.levels[0].usesPaired) {
                    // the paired texture is actually loaded into the first tile,
                    // so swap the underlying texture and sampler
                    assert(!this.uvtx.levels[1].usesPaired);
                    this.textureMappings.reverse()
                }
            }
            this.decodedMaterial = decodeMaterial(materialData.rspModeInfo, true, this.uvtx.cutOutTransparent, this.uvtx.otherModeLByte);
        } else {
            this.decodedMaterial = decodeMaterial(materialData.rspModeInfo, false, true, 0);
        }
        this.stateFlags = translateBlendMode(this.decodedMaterial.geoMode, this.decodedMaterial.renderMode);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, modelMatrix: mat4): void {
        if (!this.visible)
            return;

        const renderInst = renderInstManager.pushRenderInst();
        renderInst.setMegaStateFlags(this.stateFlags);
        let offs = renderInst.allocateUniformBuffer(PW64Program.ub_DrawParams, 12 + 2 * 8);
        const d = renderInst.mapUniformBufferF32(PW64Program.ub_DrawParams);

        computeViewMatrix(scratchMatrix, viewerInput.camera);
        mat4.mul(scratchMatrix, scratchMatrix, modelMatrix);

        // TODO: look further into game logic for this
        if (!!(getSortKeyLayer(renderInst.sortKey) & GfxRendererLayer.TRANSLUCENT)) {
            renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, -scratchMatrix[14]);
        }

        offs += fillMatrix4x3(d, offs, scratchMatrix);

        if (this.decodedMaterial.renderMode & (1 << OtherModeL_Layout.CVG_X_ALPHA))
            this.program.defines.set('CVG_X_ALPHA', '1')

        if (this.hasTexture) {
            if (getTextFiltFromOtherModeH(this.uvtx.otherModeH) === TextFilt.G_TF_BILERP) {
                // ignore average filtering mode
                this.program.defines.set('BILERP_FILTER', '1');
            }
            if (getCycleTypeFromOtherModeH(this.uvtx.otherModeH) == OtherModeH_CycleType.G_CYC_2CYCLE) {
                this.program.defines.set('TWO_CYCLE', '1');
            }

            renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
            let scaleS0 = calcScaleForShift(this.uvtx.levels[0].shiftS);
            let scaleT0 = calcScaleForShift(this.uvtx.levels[0].shiftT);
            // should maybe be careful here because the G_TEXTURE command is overridden,
            // which could affect which tiles get used
            if (this.decodedMaterial.scaleOverride) {
                scaleS0 /= this.decodedMaterial.scaleOverride;
                scaleT0 /= this.decodedMaterial.scaleOverride;
            }
            mat4.fromScaling(texMatrixScratch,
                [scaleS0 / this.textureMappings[0].width, scaleT0 / this.textureMappings[0].height, 1]);
            if (this.uvtx.uvScroll) {
                scrollTexture(texMatrixScratch, viewerInput.time, this.uvtx.uvScroll)
            }
            offs += fillMatrix4x2(d, offs, texMatrixScratch);
            this.program.defines.set('USE_TEXTURE', '1');

            if (this.hasPairedTexture) {
                const scaleS1 = calcScaleForShift(this.uvtx.levels[1].shiftS);
                const scaleT1 = calcScaleForShift(this.uvtx.levels[1].shiftT);
                mat4.fromScaling(texMatrixScratch,
                    [scaleS1 / this.textureMappings[1].width, scaleT1 / this.textureMappings[1].height, 1]);
                if (this.uvtx.combineScroll) {
                    scrollTexture(texMatrixScratch, viewerInput.time, this.uvtx.combineScroll)
                }
                offs += fillMatrix4x2(d, offs, texMatrixScratch);
                this.program.defines.set('HAS_PAIRED_TEXTURE', '1');
            }
            offs = renderInst.allocateUniformBuffer(PW64Program.ub_CombineParams, 12);
            const comb = renderInst.mapUniformBufferF32(PW64Program.ub_CombineParams);
            const chosenCombine = (this.decodedMaterial.combineOverride) ? this.decodedMaterial.combineOverride : this.uvtx.combine;
            const cc0 = packParams(chosenCombine[0]);
            const cc1 = packParams(chosenCombine[1]);
            const cc2 = packParams(chosenCombine[2]);
            const cc3 = packParams(chosenCombine[3]);
            offs += fillVec4(comb, offs, cc0, cc1, cc2, cc3);

            if (this.uvtx.primitive)
                fillVec4v(comb, offs + 0x00, this.uvtx.primitive);
            if (this.uvtx.environment)
                fillVec4v(comb, offs + 0x04, this.uvtx.environment);
        } else {
            // game actually sets 2 cycle mode for some reason, and enables shading
            this.program.defines.set('USE_VERTEX_COLOR', '1');
        }

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
        const levels = texture.levels.filter((t) => !t.usesPaired).map((t) => t.pixels);
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
    public dataHolder: DataHolder = new DataHolder();
    public uvtrRenderers: UVTRRenderer[] = [];
    public renderHelper: GfxRenderHelper;
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

        for (let i = 0; i < this.uvtrRenderers.length; i++)
            this.uvtrRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);

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
        this.dataHolder.destroy(device);
    }
}

const xAxis = vec3.fromValues(1,0,0);
const yAxis = vec3.fromValues(0,1,0);

interface ToyRotation {
    axis: vec3;
    speed: number;
    offset?: number;
}

interface ToyOscillation {
    axis: vec3;
    speed: number;
    xScale: number;
    yScale: number;
}

interface ToyMotion {
    rotation?: ToyRotation;
    oscillation?: ToyOscillation;
}

// the game actually specifies animated models by listing their final coordinates
// we assume all instances of a given model are animated

class Carousel extends ObjectRenderer {
    protected calcAnimJoint(dst: mat4, viewerInput: ViewerRenderInput, partIndex: number): void {
        const timeInSeconds = viewerInput.time / 1000;
        if (partIndex === 1) {
            const speed = 10 * MathConstants.DEG_TO_RAD;
            mat4.rotateZ(dst, dst, speed * timeInSeconds);
        }
    }
}

class FerrisWheel extends ObjectRenderer {
    protected calcAnimJoint(dst: mat4, viewerInput: ViewerRenderInput, partIndex: number): void {
        const timeInSeconds = viewerInput.time / 1000;
        if (partIndex === 1) {
            const speed = 17 * MathConstants.DEG_TO_RAD;
            mat4.rotateY(dst, dst, speed * timeInSeconds);
        } else if (partIndex >= 2) {
            const speed = -17 * MathConstants.DEG_TO_RAD;
            mat4.rotateY(dst, dst, speed * timeInSeconds);
        }
    }
}

// Legacy motion system
function getToyMotion(modelIndex: number, partIndex: number): ToyMotion | null {
    // water wheel
    if (modelIndex === 0x0d && partIndex === 0) {
        const rotation = { axis: yAxis, speed: 40 * MathConstants.DEG_TO_RAD };
        return { rotation };
    }
    // derrick
    if (modelIndex === 0x54) {
        if (partIndex === 1) {
            const rotation = { axis: xAxis, speed: 65 * MathConstants.DEG_TO_RAD, offset: 4.71239 };
            return { rotation };
        }
        const oscillation = { axis: xAxis, speed: 65 * MathConstants.DEG_TO_RAD, xScale: 1.16, yScale: 55 }
        if (partIndex === 2) {
            return { oscillation };
        }
        if (partIndex === 3) {
            oscillation.xScale *= -1;
            return { oscillation };
        }
    }
    // the mount rushmore head (modelIndex 0x55 or 0x99) also has a "toy type", but no motion
    return null;
}

class UVCTData {
    public meshData: MeshData;

    constructor(device: GfxDevice, public uvct: UVCT_Chunk) {
        this.meshData = new MeshData(device, uvct.mesh);
    }

    public destroy(device: GfxDevice): void {
        this.meshData.destroy(device);
    }
}

class DataHolder {
    public textureData: TextureData[] = [];
    public uvmdData: ModelData[] = [];
    public uvctData: UVCTData[] = [];

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.textureData.length; i++)
            this.textureData[i].destroy(device);
        for (let i = 0; i < this.uvmdData.length; i++)
            this.uvmdData[i].destroy(device);
        for (let i = 0; i < this.uvctData.length; i++)
            this.uvctData[i].destroy(device);
    }
}

function spawnObject(dataHolder: DataHolder, uvmdIndex: number): ObjectRenderer {
    const uvmdData = dataHolder.uvmdData[uvmdIndex];
    const textureData = dataHolder.textureData;

    if (uvmdIndex === 0x09) {
        return new Carousel(uvmdData, textureData);
    } else if (uvmdIndex === 0x0c) {
        return new FerrisWheel(uvmdData, textureData);
    } else {
        return new LegacyToyObjectRenderer(uvmdData, textureData);
    }
}

class UVCTRenderer {
    public static scratchMatrix = mat4.create();

    public modelMatrix = mat4.create();
    public meshRenderer: MeshRenderer;
    public sobjRenderers: ObjectRenderer[] = [];
    private visible = true;

    constructor(dataHolder: DataHolder, private uvctData: UVCTData) {
        this.meshRenderer = new MeshRenderer(uvctData.meshData, dataHolder.textureData);

        const sobjPlacements = this.uvctData.uvct.models;
        for (let i = 0; i < sobjPlacements.length; i++) {
            const placement = sobjPlacements[i];
            const sobjRenderer = spawnObject(dataHolder, placement.modelIndex);
            mat4.copy(sobjRenderer.modelMatrix, placement.modelMatrix);
            this.sobjRenderers.push(sobjRenderer);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, parentModelMatrix: mat4): void {
        if (!this.visible)
            return;

        mat4.mul(UVCTRenderer.scratchMatrix, parentModelMatrix, this.modelMatrix);

        this.meshRenderer.prepareToRender(device, renderInstManager, viewerInput, UVCTRenderer.scratchMatrix);

        for (let i = 0; i < this.sobjRenderers.length; i++)
            this.sobjRenderers[i].prepareToRender(device, renderInstManager, viewerInput, UVCTRenderer.scratchMatrix);
    }
}

class UVTRRenderer {
    public uvctRenderers: UVCTRenderer[] = [];
    public modelMatrix = mat4.create();

    constructor(dataHolder: DataHolder, private uvtrChunk: UVTR_Chunk) {
        for (let i = 0; i < this.uvtrChunk.contourPlacements.length; i++) {
            const contourPlacement = this.uvtrChunk.contourPlacements[i];
            const uvctData = dataHolder.uvctData[contourPlacement.contourIndex];
            const uvctRenderer = new UVCTRenderer(dataHolder, uvctData);
            mat4.translate(uvctRenderer.modelMatrix, uvctRenderer.modelMatrix, contourPlacement.position);

            this.uvctRenderers.push(uvctRenderer);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        for (let i = 0; i < this.uvctRenderers.length; i++)
            this.uvctRenderers[i].prepareToRender(device, renderInstManager, viewerInput, this.modelMatrix);
    }
}

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

        const cache = renderer.renderHelper.getCache();
        const dataHolder = renderer.dataHolder;

        const uvtrs: UVTR[] = [];
        const uvlvs: UVLV[] = [];
        for (let i = 0; i < fs.files.length; i++) {
            const file = fs.files[i];
            if (file.type === 'UVCT') {
                const uvct = parseUVCT(file);
                dataHolder.uvctData.push(new UVCTData(device, uvct));
            } else if (file.type === 'UVTX') {
                const uvtx = parseUVTX(file);
                dataHolder.textureData.push(new TextureData(device, cache, uvtx));
            } else if (file.type === 'UVMD') {
                const uvmd = parseUVMD(file);
                dataHolder.uvmdData.push(new ModelData(device, uvmd, dataHolder.uvmdData.length));
            } else if (file.type === 'UVTR') {
                uvtrs.push(parseUVTR(file));
            } else if (file.type === 'UVLV') {
                uvlvs.push(parseUVLV(file));
            }
        }

        assert(uvtrs.length === 1);
        assert(uvlvs.length === 1);

        const levelData = uvlvs[0].levels[this.levelID];

        const toNoclipSpace = mat4.create();
        mat4.fromXRotation(toNoclipSpace, -90 * MathConstants.DEG_TO_RAD);
        mat4.scale(toNoclipSpace, toNoclipSpace, [50, 50, 50]);
        
        for (let i = 0; i < levelData.terras.length; i++) {
            const terraIndex = levelData.terras[i];
            const uvtrChunk = uvtrs[0].maps[terraIndex];
            const uvtrRenderer = new UVTRRenderer(dataHolder, uvtrChunk);
            mat4.copy(uvtrRenderer.modelMatrix, toNoclipSpace);
            renderer.uvtrRenderers.push(uvtrRenderer);
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
