import {
    GfxDevice, GfxBuffer, GfxInputLayout, GfxInputState, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxFormat, GfxVertexAttributeFrequency,
    GfxRenderPass, GfxHostAccessPass, GfxBindingLayoutDescriptor, GfxTextureDimension, GfxWrapMode, GfxMipFilterMode, GfxTexFilterMode,
    GfxSampler, GfxBlendFactor, GfxBlendMode, GfxTexture, GfxMegaStateDescriptor, GfxCullMode, GfxCompareMode,
} from "../gfx/platform/GfxPlatform";
import { SceneGfx, ViewerRenderInput, Texture } from "../viewer";
import { SceneDesc, SceneContext, SceneGroup } from "../SceneBase";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, assert, hexzero, nArray } from "../util";
import { decompress } from "../Common/Compression/MIO0";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { DeviceProgram } from "../Program";
import { GfxRenderInstManager, makeSortKey, GfxRendererLayer, setSortKeyDepth, getSortKeyLayer, executeOnPass } from "../gfx/render/GfxRenderer";
import { fillMatrix4x3, fillMatrix4x4, fillMatrix4x2, fillVec4v, fillVec4, fillVec3 } from "../gfx/helpers/UniformBufferHelpers";
import { mat4, vec3, vec4 } from "gl-matrix";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { standardFullClearRenderPassDescriptor, BasicRenderTarget, depthClearRenderPassDescriptor } from "../gfx/helpers/RenderTargetHelpers";
import { computeViewMatrix } from "../Camera";
import { MathConstants, clamp, computeMatrixWithoutTranslation } from "../MathHelpers";
import { TextureState, TileState, getTextFiltFromOtherModeH, OtherModeH_CycleType, getCycleTypeFromOtherModeH } from "../BanjoKazooie/f3dex";
import { ImageFormat, ImageSize, getImageFormatName, decodeTex_RGBA16, getImageSizeName, decodeTex_I4, decodeTex_I8, decodeTex_IA4, decodeTex_IA8, decodeTex_IA16, TextFilt } from "../Common/N64/Image";
import { TextureMapping } from "../TextureHolder";
import { Endianness } from "../endian";
import { DataFetcher } from "../DataFetcher";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { getPointCubic, getPointHermite } from "../Spline";
import { SingleSelect, Panel, TIME_OF_DAY_ICON, COOL_BLUE_COLOR } from "../ui";
import { fullscreenMegaState } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";

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
    billboard: boolean;
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
        const billboard = view.getUint8(offs + 0x01) !== 0;
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
        lods.push({ parts, radius, billboard });
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

interface AnimationKeyframe {
    time: number;
    value: number;
}

interface SPTH {
    xTrack: AnimationKeyframe[];
    yTrack: AnimationKeyframe[];
    zTrack: AnimationKeyframe[];
    hTrack: AnimationKeyframe[];
    pTrack: AnimationKeyframe[];
    rTrack: AnimationKeyframe[];
}

function posKeyframe(dst: vec3, spth: SPTH, index: number): void {
    dst[0] = spth.xTrack[index].value;
    dst[1] = spth.yTrack[index].value;
    dst[2] = spth.zTrack[index].value;
}

function parseSPTH(file: Pilotwings64FSFile): SPTH {
    const xTrack: AnimationKeyframe[] = [];
    const yTrack: AnimationKeyframe[] = [];
    const zTrack: AnimationKeyframe[] = [];
    const hTrack: AnimationKeyframe[] = [];
    const pTrack: AnimationKeyframe[] = [];
    const rTrack: AnimationKeyframe[] = [];


    for (let i = 0; i < file.chunks.length; i++) {
        const tag = file.chunks[i].tag;
        const view = file.chunks[i].buffer.createDataView();
        const pointCount = view.getUint32(0x00);

        let currTrack: AnimationKeyframe[];
        if (tag === 'SCPX') {
            currTrack = xTrack;
        } else if (tag === 'SCPY') {
            currTrack = yTrack;
        } else if (tag === 'SCPZ') {
            currTrack = zTrack;
        } else if (tag === 'SCPH') {
            currTrack = hTrack;
        } else if (tag === 'SCPP') {
            currTrack = pTrack;
        } else if (tag === 'SCPR') {
            currTrack = rTrack;
        } else {
            assert(tag === 'SCP#' && i == file.chunks.length - 1);
            break;
        }

        let offs = 0x04;
        for (let j = 0; j < pointCount; j++) {
            const time = view.getFloat32(offs + 0x00);
            const value = view.getFloat32(offs + 0x04);
            currTrack.push({time, value});
            offs += 0x08;
        }
    }
    return { xTrack, yTrack, zTrack, hTrack, pTrack, rTrack};
}

function getTwoDerivativeHermite(dst: AnimationTrackSample, p0: number, p1: number, s0: number, s1: number, t: number): void {
    const cf0 = (p0 * 2) + (p1 * -2) + (s0 * 1) + (s1 * 1);
    const cf1 = (p0 * -3) + (p1 * 3) + (s0 * -2) + (s1 * -1);
    const cf2 = (p0 * 0) + (p1 * 0) + (s0 * 1) + (s1 * 0);
    const cf3 = (p0 * 1) + (p1 * 0) + (s0 * 0) + (s1 * 0);
    dst.pos = getPointCubic(cf0, cf1, cf2, cf3, t);
    dst.vel = getDerivativeCubic(cf0, cf1, cf2, t);
    dst.acc = 6 * cf0 * t + 2 * cf1;
}

function getDerivativeCubic(cf0: number, cf1: number, cf2: number, t: number): number {
    return (3 * cf0 * t + 2 * cf1) * t + cf2;
}

function hermiteInterpolate(dst: AnimationTrackSample, k0: AnimationKeyframe, k1: AnimationKeyframe, t0: AnimationKeyframe, t1: AnimationKeyframe, time: number): void {
    const length = k1.time - k0.time;
    const t = (time - k0.time) / length;
    const p0 = k0.value;
    const p1 = k1.value;
    const s0 = t0.value * length;
    const s1 = t1.value * length;
    getTwoDerivativeHermite(dst, p0, p1, s0, s1, t);
}

class AnimationTrackSample {
    public pos = 0;
    public vel = 0;
    public acc = 0;
}

const animFrameScratch = nArray(3, () => new AnimationTrackSample());
function sampleFloatAnimationTrackHermite(dst: AnimationTrackSample, track: AnimationKeyframe[], tangentTrack: AnimationKeyframe[], time: number): void {
    let idx1 = 1;
    for (; idx1 < track.length; idx1++) {
        if (time <= track[idx1].time)
            break;
    }

    const idx0 = idx1 - 1;

    const k0 = track[idx0];
    const k1 = track[idx1];
    const t0 = tangentTrack[idx0];
    const t1 = tangentTrack[idx1];

    hermiteInterpolate(dst, k0, k1, t0, t1, time);
}

function sampleFloatAnimationTrackSimple(track: AnimationKeyframe[], time: number, t0: number, t1: number): number {
    if (time <= track[0].time)
        return track[0].value;
    if (time >= track[track.length - 1].time)
        return track[track.length - 1].value;

    let idx1 = 1;
    for (; idx1 < track.length; idx1++) {
        if (time <= track[idx1].time)
            break;
    }
    const idx0 = idx1 - 1;
    const k0 = track[idx0];
    const k1 = track[idx1];
    const length = k1.time - k0.time;
    const t = (time - k0.time) / length;

    return getPointHermite(k0.value, k1.value, t0, t1, t);
}

interface SimpleModelPlacement {
    modelIndex: number;
    position: vec3;
    scale?: vec3;
    angles?: vec3;
}

interface UPWL {
    windObjects: SimpleModelPlacement[];
    landingPads: SimpleModelPlacement[];
    bonusStar: vec3;
}

function parseUPWL(file: Pilotwings64FSFile): UPWL {
    const windObjects: SimpleModelPlacement[] = [];
    const landingPads: SimpleModelPlacement[] = [];
    let bonusStar = vec3.create();

    for (let i = 0; i < file.chunks.length; i++) {
        const view = file.chunks[i].buffer.createDataView();
        let offs = 0;
        // ignore LEVL (just the lengths of the other lists),
        // ESND (environment sound), TOYS (since we already handle them),
        // TPTS (terrain transitions), and APTS (audio transitions)
        if (file.chunks[i].tag === 'LEVL') {

        } else if (file.chunks[i].tag === 'WOBJ') {
            while (offs < view.byteLength) {
                const position = vec3.fromValues(
                    view.getFloat32(offs + 0x00),
                    view.getFloat32(offs + 0x04),
                    view.getFloat32(offs + 0x08),
                );
                const wobjType = view.getUint8(offs + 0x0c);
                // 0 is windsock, 1 is wind turbine
                const modelIndex = wobjType === 0 ? 0x40 : 0x53;
                // game has wobjType 2 (unused), which is also a windsock
                // but the part matrices don't get used?

                windObjects.push({ position, modelIndex });
                offs += 0x10;
            }
        } else if (file.chunks[i].tag === 'LPAD') {
            while (offs < view.byteLength) {
                const position = vec3.fromValues(
                    view.getFloat32(offs + 0x00),
                    view.getFloat32(offs + 0x04),
                    view.getFloat32(offs + 0x08),
                );
                const heading = view.getFloat32(offs + 0x0c);
                landingPads.push({ modelIndex: 0xd4, position, angles: vec3.fromValues(heading, 0, 0) });
                offs += 0x18;
            }
        } else if (file.chunks[i].tag === 'BNUS') {
            vec3.set(bonusStar,
                view.getFloat32(offs + 0x00),
                view.getFloat32(offs + 0x04),
                view.getFloat32(offs + 0x08),
            );
            // next byte is always 0x80
        }
    }
    return { windObjects, landingPads, bonusStar };
}

const enum Vehicle {
    HangGlider = 0,
    RocketBelt = 1,
    Gyrocopter = 2,
    Cannonball = 3,
    Skydiving = 4,
    JumbleHopper = 5,
    Birdman = 6,
}

const enum RotationAxis {
    X = 0x78,
    Y = 0x79,
    Z = 0x7A,
}

interface RingParams {
    position: vec3;
    angles: vec3;
    axis: RotationAxis;
    modelIndex: number;
}

interface TaskLabel{
    taskClass: number;
    vehicle: Vehicle;
    taskStage: number;
    level: number;
    weather: number;
}

const taskClassNames = ["Beginner", "Class A", "Class B", "Pilot"];
const vehicleNames = ["Hang Glider", "Rocket Belt", "Gyrocopter", "Cannonball", "Skydiving", "Jumble Hopper", "Birdman"];

function simpleTaskName(label: TaskLabel): string {
    const vehicle = vehicleNames[label.vehicle];
    if (label.vehicle <= Vehicle.Gyrocopter) {
        const taskClass = taskClassNames[label.taskClass];
        return `${vehicle} ${taskClass} #${label.taskStage + 1}`;
    }
    if (label.vehicle === Vehicle.Cannonball) {
        return `${vehicle} Level ${label.taskClass + 1} Target #${label.taskStage + 1}`;
    }
    if (label.vehicle < Vehicle.Birdman) {
        assert(label.taskStage === 0);
        return `${vehicle} Level ${label.taskClass + 1}`;
    }
    // not actually displaying birdman tasks
    return `${vehicle} ${label.taskClass} ${label.taskStage}`;
}

interface UPWT {
    jptx: string;
    name: string;
    info: string;
    label: TaskLabel;
    models: SimpleModelPlacement[];
    rings: RingParams[];
    landingPad?: SimpleModelPlacement;
}

function isEmptyTask(task: UPWT): boolean {
    return task.rings.length === 0 && task.models.length === 0 && !task.landingPad;
}

function taskSort(a: UPWT, b: UPWT): number {
    if (a.label.taskClass !== b.label.taskClass) {
        return a.label.taskClass - b.label.taskClass;
    }
    if (a.label.vehicle !== b.label.vehicle) {
        return a.label.vehicle - b.label.vehicle;
    }
    return a.label.taskStage - b.label.taskStage;
}

function parseUPWT(file: Pilotwings64FSFile): UPWT {
    let jptx = "";
    let name = "";
    let info = "";
    let models: SimpleModelPlacement[] = [];
    let rings: RingParams[] = [];
    let label!: TaskLabel;
    let landingPad: SimpleModelPlacement | undefined;
    for (let i = 0; i < file.chunks.length; i++) {
        const view = file.chunks[i].buffer.createDataView();

        let offs = 0;
        // ignoring TPAD and LSTP for now since they don't change display
        // could add player models there or something

        if (file.chunks[i].tag === 'JPTX') {
            jptx = readString(file.chunks[i].buffer, offs + 0x00, file.chunks[i].buffer.byteLength, true);
        } else if (file.chunks[i].tag === 'INFO') {
            info = readString(file.chunks[i].buffer, offs + 0x00, file.chunks[i].buffer.byteLength, true);
        } else if (file.chunks[i].tag === 'NAME') {
            name = readString(file.chunks[i].buffer, offs + 0x00, file.chunks[i].buffer.byteLength, true);
        } else if (file.chunks[i].tag === 'COMM') {
            const taskClass = view.getUint8(offs + 0x00);
            const vehicle = view.getUint8(offs + 0x01);
            const taskStage = view.getUint8(offs + 0x02);
            const level = view.getUint8(offs + 0x03);
            const weather = view.getUint8(offs + 0x08);
            label = { taskClass, vehicle, taskStage, level, weather };
            // TODO: understand all the data here
            // ends with object counts
        } else if (file.chunks[i].tag === 'LPAD') {
            const position = vec3.fromValues(
                view.getFloat32(offs + 0x00),
                view.getFloat32(offs + 0x04),
                view.getFloat32(offs + 0x08),
            );
            const angles = vec3.fromValues(
                view.getFloat32(offs + 0x0c),
                view.getFloat32(offs + 0x10),
                view.getFloat32(offs + 0x14),
            );
            // not actually used
            assert(vec3.equals(angles, [0, 0, 0]));
            const modelIndex = 0x102 + view.getUint8(offs + 0x2c);
            landingPad = { modelIndex, position };
        } else if (file.chunks[i].tag === 'THER') {
            while (offs < view.byteLength - 0x28) {
                const position = vec3.fromValues(
                    view.getFloat32(offs + 0x00),
                    view.getFloat32(offs + 0x04),
                    view.getFloat32(offs + 0x08),
                );
                const scale = view.getFloat32(offs + 0x0c);
                const heightScale = view.getFloat32(offs + 0x10);
                // other info?
                models.push({ modelIndex: 0x101, position, scale: vec3.fromValues(scale, scale, heightScale) });
                offs += 0x28;
            }
        } else if (file.chunks[i].tag === 'RNGS') {
            while (offs < view.byteLength - 0x84) {
                const position = vec3.fromValues(
                    view.getFloat32(offs + 0x00),
                    view.getFloat32(offs + 0x04),
                    view.getFloat32(offs + 0x08),
                );
                const angles = vec3.fromValues(
                    view.getFloat32(offs + 0x0c),
                    view.getFloat32(offs + 0x10),
                    view.getFloat32(offs + 0x14),
                );
                vec3.scale(angles, angles, MathConstants.DEG_TO_RAD);
                // other motion info?
                const other = view.getUint8(offs + 0x1d) === 0 ? 0 : 1;
                const size = view.getUint8(offs + 0x54);
                const axis = view.getUint8(offs + 0x70);
                const special = view.getUint8(offs + 0x72);
                // this is read from a table
                let modelIndex = 0xd9 + special + 2 * other + 4 * size;
                if (special > 1) {
                    // goal ring, game skips if special != 3
                    modelIndex = 0xf1;
                }
                rings.push({ position, angles, axis, modelIndex });
                offs += 0x84;
            }
        } else if (file.chunks[i].tag === 'BALS') {
            while (offs < view.byteLength) {
                const position = vec3.fromValues(
                    view.getFloat32(offs + 0x00),
                    view.getFloat32(offs + 0x04),
                    view.getFloat32(offs + 0x08),
                );
                const ballType = view.getUint8(offs + 0x20);
                const scale = view.getFloat32(offs + 0x30);
                models.push({ modelIndex: 0xf4 + ballType, position, scale: vec3.fromValues(scale, scale, scale) });
                offs += 0x68;
            }
        } else if (file.chunks[i].tag === 'TARG') {
            while (offs < view.byteLength) {
                const position = vec3.fromValues(
                    view.getFloat32(offs + 0x00),
                    view.getFloat32(offs + 0x04),
                    view.getFloat32(offs + 0x08),
                );
                const angles = vec3.fromValues(
                    view.getFloat32(offs + 0x0c),
                    view.getFloat32(offs + 0x10),
                    view.getFloat32(offs + 0x14),
                );
                vec3.scale(angles, angles, MathConstants.DEG_TO_RAD);
                const type = view.getUint8(offs + 0x18);
                models.push({ modelIndex: 0xf9 - type, position, angles });
                offs += 0x20;
            }
        }
    }
    return { jptx, name, info, label, rings, models, landingPad };
}

interface UVEN {
    skyboxModel?: number;
    skyboxFlags?: number;
    oceanModel?: number;
    oceanFlags?: number;
    clearColor: vec4;
    fogColor: vec4;
    otherColor: vec4;
}

function parseUVEN_Chunk(chunk: Pilotwings64FSFileChunk): UVEN {
    const view = chunk.buffer.createDataView();
    const modelCount = view.getUint8(0x00);
    let skyboxModel: number | undefined;
    let skyboxFlags: number | undefined;
    let oceanModel: number | undefined;
    let oceanFlags: number | undefined;
    let offs = 0x01;
    if (modelCount == 2) {
        skyboxModel = view.getUint16(offs + 0x00);
        skyboxFlags = view.getUint8(offs + 0x02);
        offs += 0x03;
    }
    if (modelCount > 0) {
        oceanModel = view.getUint16(offs + 0x00);
        oceanFlags = view.getUint8(offs + 0x02);
        offs += 0x03;
    }
    const clearColor = vec4.fromValues(
        view.getUint8(offs + 0x00)/0xff,
        view.getUint8(offs + 0x01)/0xff,
        view.getUint8(offs + 0x02)/0xff,
        view.getUint8(offs + 0x03)/0xff,
    );
    const fogColor = vec4.fromValues(
        view.getUint8(offs + 0x04)/0xff,
        view.getUint8(offs + 0x05)/0xff,
        view.getUint8(offs + 0x06)/0xff,
        view.getUint8(offs + 0x07)/0xff,
    );
    const otherColor = vec4.fromValues(
        view.getUint8(offs + 0x08)/0xff,
        view.getUint8(offs + 0x09)/0xff,
        view.getUint8(offs + 0x0a)/0xff,
        view.getUint8(offs + 0x0b)/0xff,
    );
    return {skyboxModel, skyboxFlags, oceanModel, oceanFlags, clearColor, fogColor, otherColor};
}

function parseUVEN(file: Pilotwings64FSFile): UVEN[] {
    const environments: UVEN[] = [];
    for (let i = 0; i < file.chunks.length; i++) {
        environments.push(parseUVEN_Chunk(file.chunks[i]));
    }
    return environments;
}

type UVTP = Map<number, number>;

function parseUVTP_Chunk(chunk: Pilotwings64FSFileChunk): UVTP {
    const palette = new Map<number, number>();
    const view = chunk.buffer.createDataView();
    const entryCount = view.getUint16(0x00);
    let offs = 0x02;
    for (let i = 0; i < entryCount; i++) {
        const original = view.getUint16(offs + 0x00);
        const swap = view.getUint16(offs + 0x02);
        palette.set(original, swap);
        offs += 0x04;
    }
    return palette;
}

function parseUVTP(file: Pilotwings64FSFile): UVTP[] {
    const palettes: Map<number, number>[] = [];
    for (let i = 0; i < file.chunks.length; i++)
        palettes.push(parseUVTP_Chunk(file.chunks[i]));
    return palettes;
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

const vec4 t_Zero = vec4(0.0);
const vec4 t_One = vec4(1.0);
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
ivec4 UnpackParams(float val) {
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

vec3 CombineColorCycle(vec4 t_CombColor, vec4 t_Tex0, vec4 t_Tex1, float t_Params) {
    vec3 t_ColorInputs[8] = vec3[8](
        t_CombColor.rgb, t_Tex0.rgb, t_Tex1.rgb, u_PrimColor.rgb,
        v_Color.rgb, u_EnvColor.rgb, t_One.rgb, t_Zero.rgb
    );

    vec3 t_MultInputs[16] = vec3[16](
        t_CombColor.rgb, t_Tex0.rgb, t_Tex1.rgb, u_PrimColor.rgb,
        v_Color.rgb, u_EnvColor.rgb, t_Zero.rgb /* key */, t_CombColor.aaa,
        t_Tex0.aaa, t_Tex1.aaa, u_PrimColor.aaa, v_Color.aaa,
        u_EnvColor.aaa, t_Zero.rgb /* LOD */, t_Zero.rgb /* prim LOD */, t_Zero.rgb
    );

    ivec4 p = UnpackParams(t_Params);

    return (t_ColorInputs[p.x] - t_ColorInputs[p.y]) * t_MultInputs[p.z] + t_ColorInputs[p.w];
}

float CombineAlphaCycle(float combAlpha, float t_Tex0, float t_Tex1, float t_Params) {
    float t_AlphaInputs[8] = float[8](
        combAlpha, t_Tex0, t_Tex1, u_PrimColor.a,
        v_Color.a, 0.0, 1.0, 0.0
    );

    ivec4 p = UnpackParams(t_Params);

    return (t_AlphaInputs[p.x] - t_AlphaInputs[p.y])* t_AlphaInputs[p.z] + t_AlphaInputs[p.w];
}
#ifdef BILERP_FILTER
#define Texture2D_N64 Texture2D_N64_Bilerp
#else
#define Texture2D_N64 Texture2D_N64_Point
#endif


void main() {
    vec4 t_Tex0, t_Tex1;

#ifdef USE_TEXTURE
    t_Tex0 = Texture2D_N64(u_Texture[0], v_TexCoord.xy);
    t_Tex1 = t_Tex1;
#endif

#ifdef HAS_PAIRED_TEXTURE
    t_Tex1 = Texture2D_N64(u_Texture[1], v_TexCoord.zw);
#endif

    vec4 t_Color = vec4(
        CombineColorCycle(t_Zero, t_Tex0, t_Tex1, u_Params.x),
        CombineAlphaCycle(t_Zero.a, t_Tex0.a, t_Tex1.a, u_Params.y)
    );

#ifdef TWO_CYCLE
    t_Color = vec4(
        CombineColorCycle(t_Color, t_Tex0, t_Tex1, u_Params.z),
        CombineAlphaCycle(t_Color.a, t_Tex0.a, t_Tex1.a, u_Params.w)
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
    const baseValue = ratio*(Math.PI/4+delta*0.309);
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
function interpretPartHierarchy(partLevels: number[]): number[] {
    // UVMD index 0xCF has parts list that starts at 1 instead of 0...
    const base = partLevels[0];

    // Translate to a list of parents for each node. -1 means "above root" node.
    const parents: number[] = [-1];

    // The depth stack.
    const depthStack: number[] = [0];

    for (let i = 1; i < partLevels.length; i++) {
        const last = partLevels[i - 1], cur = partLevels[i];
        if (cur > last)
            assert(cur === last + 1);
        parents[i] = depthStack[cur - base - 1];
        depthStack[cur - base] = i;
    }

    return parents;
}

class ObjectRenderer {
    private static jointMatrixScratch = nArray(20, () => mat4.create());

    public modelMatrix = mat4.create();
    public sortKeyBase: number;
    protected partRenderers: MeshRenderer[] = [];
    protected visible = true;
    public taskNumber = -1;

    constructor(protected model: ModelData, texturePalette: TexturePalette, isEnv?: boolean) {
        this.sortKeyBase = makeSortKey(this.model.uvmd.hasTransparency ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE);

        for (let i = 0; i < model.parts.length; i++) {
            const partRenderer = new MeshRenderer(model.parts[i], texturePalette, isEnv, this.model.uvmd.lods[0].billboard);
            this.partRenderers.push(partRenderer);
        }

        assert((model.parts.length + 1) <= ObjectRenderer.jointMatrixScratch.length);
    }

    public syncTaskVisibility(task: number): boolean {
        if (this.taskNumber < 0) // just in case
            return this.visible;
        this.visible = this.taskNumber === task;
        return this.visible;
    }

    protected calcAnimJoint(dst: mat4, viewerInput: ViewerRenderInput, partIndex: number): void {
        // Nothing by default.
    }

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
        template.sortKey = this.sortKeyBase;

        const jointMatrixScratch = ObjectRenderer.jointMatrixScratch;
        this.calcAnim(jointMatrixScratch, viewerInput, parentModelMatrix);

        for (let i = 0; i < this.partRenderers.length; i++)
            this.partRenderers[i].prepareToRender(device, renderInstManager, viewerInput, jointMatrixScratch[i]);

        renderInstManager.popTemplateRenderInst();
    }
}

class MeshRenderer {
    public static scratchMatrix = mat4.create();
    private materials: MaterialInstance[] = [];
    private visible = true;

    constructor(private meshData: MeshData, texturePalette: TexturePalette, isEnv?: boolean, isBillboard?: boolean) {
        for (let material of meshData.mesh.materials)
            this.materials.push(new MaterialInstance(material, texturePalette, isEnv, isBillboard));
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

interface DecodeMaterialResult {
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

function decodeMaterial(rspMode: number, hasTexture: boolean, cutOutTransparent: boolean, textureByte: number): DecodeMaterialResult {
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
        renderMode = 0x00103048; // RM_AA_TEX_TERR
    }
    if (modeIndex === 7 && hasTexture) {
        if (!cutOutTransparent || textureByte === 1 || (rspMode >>> 10) & 1) {
            renderMode = 0x001049d8; // RM_AA_ZB_XLU_SURF
        } else {
            renderMode = 0x00103078; // RM_AA_ZB_TEX_TERR
        }
    }
    if ((rspMode >>> 12) & 1) {
        renderMode = 0x111103f0; // custom mode, scale memory value based on fog
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

    const result: DecodeMaterialResult = { geoMode, renderMode };
    if (combineOverride.length > 0) {
        result.combineOverride = combineOverride;
    }
    if (scaleOverride > 0) {
        result.scaleOverride = scaleOverride;
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


export function calcZBBoardMtx(dst: mat4, m: mat4): void {
    // Modifies m in-place.

    // rotate around the model's Z-axis (up in PW64)
    // so that the Y-axis (forward in PW64 model space)
    // is as towards-camera as possible (+Z in noclip)

    // The column vectors lengths here are the scale.
    const mx = Math.hypot(m[0], m[1], m[2]);
    const my = Math.hypot(m[4], m[5], m[6]);

    const h = Math.hypot(m[9], m[10]);

    dst[0] = -mx;
    dst[4] = 0;
    dst[8] = m[8]; // we assume this is negligible
    dst[12] = m[12];

    dst[1] = 0;
    dst[5] = -my * m[10] / h;
    dst[9] = m[9];
    dst[13] = m[13];

    dst[2] = 0;
    dst[6] = my * m[9] / h;
    dst[10] = m[10];
    dst[14] = m[14];

    // Fill with junk to try and signal when something has gone horribly wrong. This should go unused,
    // since this is supposed to generate a mat4x3 matrix.
    m[3] = 9999.0;
    m[7] = 9999.0;
    m[11] = 9999.0;
    m[15] = 9999.0;
}

const scratchMatrix = mat4.create();
const texMatrixScratch = mat4.create();
class MaterialInstance {
    public program = new PW64Program();
    private hasTexture = false;
    private hasPairedTexture = false;
    private textureMappings: TextureMapping[] = nArray(2, () => new TextureMapping());
    private uvtx: UVTX;
    private decodedMaterial: DecodeMaterialResult;
    private stateFlags: Partial<GfxMegaStateDescriptor>;
    private visible = true;

    constructor(private materialData: MaterialData, texturePalette: TexturePalette, isEnv?: boolean, private isBillboard?: boolean) {
        this.hasTexture = materialData.textureIndex < 0x0FFF;
        let modeInfo = materialData.rspModeInfo;
        if (!!isEnv)
            modeInfo &= ~PilotwingsRSPFlag.ZBUFFER;
        if (this.hasTexture) {
            const mainTextureData = texturePalette.get(materialData.textureIndex);
            this.uvtx = mainTextureData.uvtx;
            mainTextureData.fillTextureMapping(this.textureMappings[0]);
            if (this.uvtx.pairedIndex !== undefined) {
                this.hasPairedTexture = true;
                assert(this.uvtx.levels.length > 1);
                texturePalette.get(this.uvtx.pairedIndex).fillTextureMapping(this.textureMappings[1]);
                if (this.uvtx.levels[0].usesPaired) {
                    // the paired texture is actually loaded into the first tile,
                    // so swap the underlying texture and sampler
                    assert(!this.uvtx.levels[1].usesPaired);
                    this.textureMappings.reverse()
                }
            }
            this.decodedMaterial = decodeMaterial(modeInfo, true, this.uvtx.cutOutTransparent, this.uvtx.otherModeLByte);
        } else {
            this.decodedMaterial = decodeMaterial(modeInfo, false, true, 0);
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

        // note that the game actually rotates the model placement matrix, allowing for a model
        // with multiple parts to face towards the camera overall, while individual parts might not
        // however, every billboard in the game has only one part, so we ignore this detail
        if (this.isBillboard)
            calcZBBoardMtx(scratchMatrix, scratchMatrix);

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

        this.gfxSampler = device.createSampler({
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
        device.destroySampler(this.gfxSampler);
    }
}

// the game actually specifies animated models by listing their final coordinates
// we assume all instances of a given model are animated

class Carousel extends ObjectRenderer {
    protected calcAnimJoint(dst: mat4, viewerInput: ViewerRenderInput, partIndex: number): void {
        const timeInSeconds = viewerInput.time / 1000;
        if (partIndex === 1) {
            const speed = 10;
            mat4.rotateZ(dst, dst, MathConstants.DEG_TO_RAD * speed * timeInSeconds);
        }
    }
}

class FerrisWheel extends ObjectRenderer {
    protected calcAnimJoint(dst: mat4, viewerInput: ViewerRenderInput, partIndex: number): void {
        const timeInSeconds = viewerInput.time / 1000;
        if (partIndex === 1) {
            const speed = 17;
            mat4.rotateY(dst, dst, MathConstants.DEG_TO_RAD * speed * timeInSeconds);
        } else if (partIndex >= 2) {
            const speed = -17;
            mat4.rotateY(dst, dst, MathConstants.DEG_TO_RAD * speed * timeInSeconds);
        }
    }
}

class WaterWheel extends ObjectRenderer {
    protected calcAnimJoint(dst: mat4, viewerInput: ViewerRenderInput, partIndex: number): void {
        const timeInSeconds = viewerInput.time / 1000;
        if (partIndex === 0) {
            const speed = 40;
            mat4.rotateY(dst, dst, MathConstants.DEG_TO_RAD * speed * timeInSeconds);
        }
    }
}

function getOscillation(xScale: number, yScale: number, theta: number): number {
    return badAtan2(xScale * theta, yScale);
}

class OilDerrick extends ObjectRenderer {
    protected calcAnimJoint(dst: mat4, viewerInput: ViewerRenderInput, partIndex: number): void {
        const timeInSeconds = viewerInput.time / 1000;
        if (partIndex === 1) {
            // offset: 4.71239
            const speed = 65;
            mat4.rotateX(dst, dst, MathConstants.DEG_TO_RAD * (270 + (speed * timeInSeconds)));
        } else if (partIndex === 2) {
            const theta = Math.sin(MathConstants.DEG_TO_RAD * 65 * timeInSeconds);
            mat4.rotateX(dst, dst, getOscillation(1.16, 55, theta));
        } else if (partIndex === 3) {
            const theta = Math.sin(MathConstants.DEG_TO_RAD * 65 * timeInSeconds);
            mat4.rotateX(dst, dst, getOscillation(-1.16, 55, theta));
        }
    }
}

class DynamicObjectRenderer extends ObjectRenderer {
    protected translationScale: number;

    constructor(model: ModelData, texturePalette: TexturePalette) {
        super(model, texturePalette);
        const modelScale = 1/model.uvmd.inverseScale;
        mat4.scale(this.modelMatrix, this.modelMatrix, [modelScale, modelScale, modelScale]);
        this.translationScale = model.uvmd.inverseScale;
    }
}

class BirdmanStar extends ObjectRenderer {
    protected calcAnimJoint(dst: mat4, viewerInput: ViewerRenderInput, partIndex: number): void {
        const timeInSeconds = viewerInput.time / 1000;
        mat4.rotateZ(dst, dst, MathConstants.TAU * timeInSeconds);
    }
}

class LandingPad extends ObjectRenderer {
    public alternates: ObjectRenderer[] = [];

    public syncTaskVisibility(task: number): boolean {
        this.visible = true;
        for (let i = 0; i < this.alternates.length; i++) {
            if (this.alternates[i].syncTaskVisibility(task))
                this.visible = false;
        }
        return this.visible;
    }
}

interface LooperParams {
    angularVelocity: number;
    center: vec3;
    radius: number;
    roll: number;
    bounce?: BoatBounceParams;
}

interface BoatBounceParams {
    bouncingPart: number;
    maxAngle: number;
    maxHeight: number;
    maxVelocity: number;
}

class Looper extends DynamicObjectRenderer {
    private bounceHeight = 0;
    private bounceVelocity = 0;

    constructor(model: ModelData, texturePalette: TexturePalette, private params: LooperParams) {
        super(model, texturePalette);
        if (params.bounce)
            this.bounceVelocity = params.bounce.maxVelocity;
        vec3.scale(this.params.center, this.params.center, this.translationScale);
        mat4.translate(this.modelMatrix, this.modelMatrix, this.params.center);
    }

    protected calcAnimJoint(dst: mat4, viewerInput: ViewerRenderInput, partIndex: number): void {
        const timeInSeconds = viewerInput.time / 1000;
        if (partIndex === 0) {
            mat4.fromZRotation(dst, this.params.angularVelocity * timeInSeconds * MathConstants.DEG_TO_RAD);
            mat4.translate(dst, dst, [this.params.radius*this.translationScale, 0, 0]);
            if (this.params.roll !== 0)
                mat4.rotateY(dst, dst, this.params.roll * MathConstants.DEG_TO_RAD);
        } else if (this.params.bounce && this.params.bounce.bouncingPart === partIndex) {
            const timeStep = 0.75 * viewerInput.deltaTime / 1000;
            const bounce = this.params.bounce;

            this.bounceVelocity -= 9.8 * timeStep;
            this.bounceHeight += this.bounceVelocity * timeStep;
            if (this.bounceHeight <= 0) {
                this.bounceHeight = 0;
                this.bounceVelocity = bounce.maxVelocity * Math.random();
            }
            let bounceAngle = this.bounceHeight / bounce.maxHeight * bounce.maxAngle;
            if (this.bounceVelocity > 0)
                bounceAngle *= 2;
            if (bounceAngle > bounce.maxAngle)
                bounceAngle = bounce.maxAngle;
            if (this.params.angularVelocity < 0)
                bounceAngle *= -1

            mat4.rotateX(dst, dst, bounceAngle * MathConstants.DEG_TO_RAD);
            mat4.translate(dst, dst, [0, 0, this.bounceHeight*this.translationScale]);
        }
    }
}

function tracksMatch(a: AnimationKeyframe[], b: AnimationKeyframe[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++)
        if (a[i].time !== b[i].time)
            return false;

    return true;
}

interface AirplaneParams {
    pathLength: number;
    minHeight: number;
    rollFactor: number;
}

class Airplane extends DynamicObjectRenderer {
    private pos = vec3.create();
    private angles = vec3.create();
    private speed = 0;
    private yawSpeed = 0;
    private oldPitch = 0;

    constructor(model: ModelData, texturePalette: TexturePalette, private spline: SPTH, private params: AirplaneParams) {
        super(model, texturePalette);
        this.fly(params.pathLength);
        this.pos[2] = params.minHeight;
        this.angles[2] = 0;
        assert(tracksMatch(spline.xTrack, spline.hTrack));
        assert(tracksMatch(spline.yTrack, spline.pTrack));
        assert(tracksMatch(spline.zTrack, spline.rTrack));
    }

    private fly(progress: number) {
        const phase = progress / this.params.pathLength * 100;
        sampleFloatAnimationTrackHermite(animFrameScratch[0], this.spline.xTrack, this.spline.hTrack, phase);
        sampleFloatAnimationTrackHermite(animFrameScratch[1],this.spline.yTrack, this.spline.pTrack, phase);
        sampleFloatAnimationTrackHermite(animFrameScratch[2],this.spline.zTrack, this.spline.rTrack, phase);

        const xPt = animFrameScratch[0];
        const yPt = animFrameScratch[1];
        const zPt = animFrameScratch[2];

        const tNorm = Math.hypot(xPt.vel, yPt.vel);
        const norm = Math.hypot(xPt.pos, yPt.pos);
        const proj = Math.abs(xPt.pos * xPt.vel + yPt.pos * yPt.vel) / norm;
        const lastNorm = Math.hypot(zPt.vel, proj);

        this.angles[0] = badAtan2(-xPt.vel / tNorm, yPt.vel / tNorm);
        this.angles[1] = badAtan2(zPt.vel / lastNorm, proj / lastNorm);
        vec3.set(this.pos, xPt.pos, yPt.pos, zPt.pos);

        // the game computes these derivatives by dividing the change by the frame time
        this.speed = Math.hypot(tNorm, zPt.vel);
        this.yawSpeed = (yPt.acc * xPt.vel - xPt.acc * yPt.vel) / (tNorm * tNorm);
    }

    protected calcAnimJoint(dst: mat4, viewerInput: ViewerRenderInput, partIndex: number): void {
        const timeInSeconds = viewerInput.time / 1000;
        const maxTurn = Math.abs(viewerInput.deltaTime / 1000 / 10);

        this.oldPitch = this.angles[1];
        this.fly(timeInSeconds % this.params.pathLength);
        if (this.pos[2] < this.params.minHeight) {
            this.pos[2] = this.params.minHeight;
        }
        this.angles[1] = clamp(this.angles[1], this.oldPitch - maxTurn, this.oldPitch + maxTurn)
        const turnRate = -this.params.rollFactor * this.yawSpeed / this.speed;
        if (Math.abs(turnRate) > 1e-5) {
            let angle: number;
            if (turnRate < -1) {
                angle = -Math.PI / 2;
            } else if (turnRate > 1) {
                angle = Math.PI / 2;
            } else {
                angle = badAtan2(turnRate, Math.sqrt(1 - turnRate * turnRate));
            }
            this.angles[2] = clamp(angle, this.angles[2] - maxTurn, this.angles[2] + maxTurn)
        } else {
            this.angles[2] = 0;
        }
        vec3.scale(this.pos, this.pos, this.translationScale);
        fromTranslationScaleEuler(dst, this.pos, 1, this.angles);
    }
}

class ChairliftChair extends DynamicObjectRenderer {
    private static scratchVectors: vec3[] = nArray(4, () => vec3.create());

    private pos = vec3.create();

    constructor(model: ModelData, texturePalette: TexturePalette, private spline: SPTH, private offset: number) {
        super(model, texturePalette);
        assert(tracksMatch(spline.xTrack, spline.yTrack));
        assert(tracksMatch(spline.xTrack, spline.zTrack));
    }

    protected calcAnimJoint(dst: mat4, viewerInput: ViewerRenderInput, partIndex: number): void {
        const timeInSeconds = viewerInput.time / 1000;

        const cyclePhase = (timeInSeconds + this.offset) % 100;

        const posPathLength = this.spline.xTrack.length;
        let idx = 1;
        for (; idx < posPathLength; idx++) {
            if (cyclePhase <= this.spline.xTrack[idx].time)
                break;
        }

        const vecs = ChairliftChair.scratchVectors;

        const nxt = idx < posPathLength - 1 ? idx + 1 : 0;
        const prev = idx - 1;
        const twoPrev = idx > 1 ? idx - 2 : posPathLength - 1;
        posKeyframe(vecs[0], this.spline, twoPrev);
        posKeyframe(vecs[1], this.spline, prev);
        posKeyframe(vecs[2], this.spline, idx);
        posKeyframe(vecs[3], this.spline, nxt);

        const tangentScale = 512 * Math.abs(this.spline.xTrack[idx].time - this.spline.xTrack[prev].time) / 100;

        vec3.sub(vecs[1], vecs[1], vecs[0]);
        vec3.normalize(vecs[1], vecs[1]);
        vec3.scale(vecs[1], vecs[1], tangentScale);

        vec3.sub(vecs[3], vecs[3], vecs[2]);
        vec3.normalize(vecs[3], vecs[3]);
        vec3.scale(vecs[3], vecs[3], tangentScale);

        const t0 = vecs[1];
        const t1 = vecs[3];

        this.pos[0] = sampleFloatAnimationTrackSimple(this.spline.xTrack, cyclePhase, t0[0], t1[0])
        this.pos[1] = sampleFloatAnimationTrackSimple(this.spline.yTrack, cyclePhase, t0[1], t1[1])
        this.pos[2] = sampleFloatAnimationTrackSimple(this.spline.zTrack, cyclePhase, t0[2], t1[2])
        vec3.scale(this.pos, this.pos, this.translationScale);

        const heading = sampleFloatAnimationTrackSimple(this.spline.hTrack, cyclePhase, 1, -1);
        const pitch = sampleFloatAnimationTrackSimple(this.spline.pTrack, cyclePhase, 1, -1);
        const roll = sampleFloatAnimationTrackSimple(this.spline.rTrack, cyclePhase, 1, -1);

        mat4.fromTranslation(dst, this.pos);
        mat4.rotateZ(dst, dst, heading * MathConstants.DEG_TO_RAD);
        mat4.rotateX(dst, dst, pitch * MathConstants.DEG_TO_RAD);
        mat4.rotateY(dst, dst, roll * MathConstants.DEG_TO_RAD);
    }
}

class Ring extends ObjectRenderer {
    constructor(model: ModelData, texturePalette: TexturePalette, private axis: RotationAxis) {
        super(model, texturePalette);
    }

    protected calcAnimJoint(dst: mat4, viewerInput: ViewerRenderInput, partIndex: number): void {
        if (partIndex !== 0)
            return;
        const radians = viewerInput.time / 1000;
        if (this.axis === RotationAxis.X) {
            mat4.fromXRotation(dst, radians);
        } else if (this.axis === RotationAxis.Y) {
            mat4.fromYRotation(dst, radians);
        } else if (this.axis === RotationAxis.Z) {
            mat4.fromZRotation(dst, radians);
        }
    }
}

class SnowProgram extends DeviceProgram {
    public name = "PW64_Snow";
    public static a_Position = 0;
    public static a_Corner = 1;

    public static ub_SceneParams = 0;
    public static ub_DrawParams = 1;

    public both = `
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(row_major, std140) uniform ub_DrawParams {
    Mat4x3 u_BoneMatrix;
    vec4 u_Shift;
};`
    public vert = `
layout(location = 0) in vec3 a_Position;

void main() {
    gl_Position = vec4(a_Position, 1.0) + vec4(u_Shift.xyz, 0.0);
    // slightly clumsy, force into 0-10k cube, then shift center to origin
    // just easier than dealing with negative mod values
    float cubeSide = 5000.0;
    gl_Position = mod(gl_Position, 2.0*vec4(cubeSide)) - vec4(vec3(cubeSide), 0.0);
    gl_Position = Mul(_Mat4x4(u_BoneMatrix), gl_Position);
    // shift snow cube in front of camera
    gl_Position.z -= cubeSide;
    // add offset based on which corner this is, undoing perspective correction so every flake is the same size
    gl_Position += (u_Shift.w * gl_Position.z) * vec4(float(gl_VertexID & 1) - 0.5, float((gl_VertexID >> 1) & 1) - 0.5, 0.0, 0.0);
    gl_Position = Mul(u_Projection, gl_Position);
    // game writes snow directly to the frame buffer, with a very simple projection
    // this effectively leads to a slightly larger FOV, so apply the same multiplier here
    gl_Position = gl_Position * vec4(0.81778, 0.81778, 1.0, 1.0);
}`;
    public frag = `
void main() {
    gl_FragColor = vec4(1.0); // flakes are just white
}`;
}

const snowBindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 0 },
];
const snowScratchVector = vec3.create();
class SnowRenderer {
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    private visible = true;
    private snowProgram = new SnowProgram();
    private snowShift = vec3.create();

    private flakeBounds = 200 * 50; // 200 in game, scale up to make things simpler
    private flakeScale = .005; // somewhat arbitrary, apparent size of flake at z = 1

    constructor(device: GfxDevice, private flakeCount: number) {
        const flakeVertices = new Float32Array(4 * 3 * flakeCount);
        const flakeIndices = new Uint16Array(6 * flakeCount);
        // randomize initial positions in a cube
        for (let i = 0; i < flakeCount; i++) {
            const flakeCenter = vec3.fromValues(
                this.flakeBounds * Math.random(),
                this.flakeBounds * Math.random(),
                this.flakeBounds * Math.random(),
            );

            // put all four quad vertices at the flake center, but with different corner values
            for (let j = 0; j < 4; j++) {
                flakeVertices[12 * i + 3 * j + 0] = flakeCenter[0];
                flakeVertices[12 * i + 3 * j + 1] = flakeCenter[1];
                flakeVertices[12 * i + 3 * j + 2] = flakeCenter[2];
            }

            flakeIndices[6 * i + 0] = 4 * i + 0;
            flakeIndices[6 * i + 1] = 4 * i + 1;
            flakeIndices[6 * i + 2] = 4 * i + 2;

            flakeIndices[6 * i + 3] = 4 * i + 2;
            flakeIndices[6 * i + 4] = 4 * i + 1;
            flakeIndices[6 * i + 5] = 4 * i + 3;
        }

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, flakeVertices.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, flakeIndices.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: SnowProgram.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
        ];

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, byteStride: 3 * 0x04, },
        ], { buffer: this.indexBuffer, byteOffset: 0, byteStride: 0x02 });

    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (!this.visible)
            return;

        const renderInst = renderInstManager.pushRenderInst();
        renderInst.filterKey = PW64Pass.SNOW;

        renderInst.setBindingLayouts(snowBindingLayouts);
        renderInst.setMegaStateFlags(fullscreenMegaState);

        let offs = renderInst.allocateUniformBuffer(SnowProgram.ub_DrawParams, 12 + 4);
        const d = renderInst.mapUniformBufferF32(SnowProgram.ub_DrawParams);
        // snowflake coordinates are relative to camera already
        computeMatrixWithoutTranslation(scratchMatrix, viewerInput.camera.viewMatrix);
        offs += fillMatrix4x3(d, offs, scratchMatrix);

        // determine how much the snow cube center moved
        vec3.set(this.snowShift, 0, 0, -this.flakeBounds / 2);
        vec3.transformMat4(this.snowShift, this.snowShift, viewerInput.camera.worldMatrix);
        vec3.scale(this.snowShift, this.snowShift, -1);
        // this would be physically correct, but the game adds extra to exaggerate motion
        mat4.getTranslation(snowScratchVector, viewerInput.camera.worldMatrix);
        vec3.scaleAndAdd(this.snowShift, this.snowShift, snowScratchVector, -3);

        // include gravity
        this.snowShift[1] -= viewerInput.time * .75;
        // wrap to a positive output here so the shader doesn't have to
        for (let i = 0; i < 3; i++) {
            this.snowShift[i] = this.snowShift[i] % this.flakeBounds;
            if (this.snowShift[i] < 0)
                this.snowShift[i] += this.flakeBounds;
        }
        fillVec3(d, offs, this.snowShift, this.flakeScale);

        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.setGfxProgram(renderInstManager.gfxRenderCache.createProgram(device, this.snowProgram));
        renderInst.drawIndexes(6 * this.flakeCount);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
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
    public uvtr: UVTR[] = [];
    public uvlv: UVLV[] = [];
    public upwl: UPWL[] = [];
    public upwt: UPWT[][] = nArray(4, () => []);
    public uven: UVEN[] = [];
    public uvtp: UVTP[] = [];
    public splineData = new Map<number, SPTH>();
    public gfxRenderCache = new GfxRenderCache(true);

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.textureData.length; i++)
            this.textureData[i].destroy(device);
        for (let i = 0; i < this.uvmdData.length; i++)
            this.uvmdData[i].destroy(device);
        for (let i = 0; i < this.uvctData.length; i++)
            this.uvctData[i].destroy(device);
        this.gfxRenderCache.destroy(device);
    }
}

function spawnEnvObject(modelBuilder: ModelBuilder, uvmdIndex: number): ObjectRenderer {
    const uvmdData = modelBuilder.uvmdData[uvmdIndex];
    return new ObjectRenderer(uvmdData, modelBuilder.palette, true);
}

function spawnObject(builder: ModelBuilder, uvmdIndex: number): ObjectRenderer {
    const uvmdData = builder.uvmdData[uvmdIndex];
    const texturePalette = builder.palette;

    if (uvmdIndex === 0x09) {
        return new Carousel(uvmdData, texturePalette);
    } else if (uvmdIndex === 0x0C) {
        return new FerrisWheel(uvmdData, texturePalette);
    } else if (uvmdIndex === 0x0D) {
        return new WaterWheel(uvmdData, texturePalette);
    } else if (uvmdIndex === 0x54) {
        return new OilDerrick(uvmdData, texturePalette);
    } else {
        return new ObjectRenderer(uvmdData, texturePalette);
    }
}

// helper because I don't feel like convertin these Euler angles to glmatrix's representation
function fromTranslationScaleEuler(dst: mat4, pos: vec3, scale: number, angles?: vec3): void {
    mat4.fromTranslation(dst, pos);
    dst[0] = scale;
    dst[5] = scale;
    dst[10] = scale;
    if (angles) {
        mat4.rotateZ(dst, dst, angles[0]);
        mat4.rotateX(dst, dst, angles[1]);
        mat4.rotateY(dst, dst, angles[2]);
    }
}

// helper for those "dynamic" objects that don't really move
function spawnObjectAt(modelBuilder: ModelBuilder, placement: SimpleModelPlacement, task?: number): ObjectRenderer {
    const uvmdData = modelBuilder.uvmdData[placement.modelIndex];

    const obj = new ObjectRenderer(uvmdData, modelBuilder.palette);
    if (task !== undefined) {
        obj.taskNumber = task;
        obj.syncTaskVisibility(-1); // set to default visibility
    }
    let scale = 1 / uvmdData.uvmd.inverseScale;
    fromTranslationScaleEuler(obj.modelMatrix, placement.position, scale, placement.angles)
    if (placement.scale) {
        // additional scaling is relative to default model size
        mat4.scale(obj.modelMatrix, obj.modelMatrix, placement.scale);
    }
    return obj;
}

class UVCTRenderer {
    public static scratchMatrix = mat4.create();

    public modelMatrix = mat4.create();
    public meshRenderer: MeshRenderer;
    public sobjRenderers: ObjectRenderer[] = [];
    private visible = true;

    constructor(modelBuilder: ModelBuilder, private uvctData: UVCTData) {
        this.meshRenderer = new MeshRenderer(uvctData.meshData, modelBuilder.palette);

        const sobjPlacements = this.uvctData.uvct.models;
        for (let i = 0; i < sobjPlacements.length; i++) {
            const placement = sobjPlacements[i];
            const sobjRenderer = spawnObject(modelBuilder, placement.modelIndex);
            mat4.copy(sobjRenderer.modelMatrix, placement.modelMatrix);
            this.sobjRenderers.push(sobjRenderer);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, parentModelMatrix: mat4): void {
        if (!this.visible)
            return;

        mat4.mul(UVCTRenderer.scratchMatrix, parentModelMatrix, this.modelMatrix);

        const template = renderInstManager.pushTemplateRenderInst();
        template.sortKey = makeSortKey(GfxRendererLayer.OPAQUE);
        this.meshRenderer.prepareToRender(device, renderInstManager, viewerInput, UVCTRenderer.scratchMatrix);
        renderInstManager.popTemplateRenderInst();

        for (let i = 0; i < this.sobjRenderers.length; i++)
            this.sobjRenderers[i].prepareToRender(device, renderInstManager, viewerInput, UVCTRenderer.scratchMatrix);
    }
}

class UVTRRenderer {
    public uvctRenderers: UVCTRenderer[] = [];
    public modelMatrix = mat4.create();

    constructor(dataHolder: DataHolder, modelBuilder: ModelBuilder, private uvtrChunk: UVTR_Chunk) {
        for (let i = 0; i < this.uvtrChunk.contourPlacements.length; i++) {
            const contourPlacement = this.uvtrChunk.contourPlacements[i];
            const uvctData = dataHolder.uvctData[contourPlacement.contourIndex];
            const uvctRenderer = new UVCTRenderer(modelBuilder, uvctData);
            mat4.translate(uvctRenderer.modelMatrix, uvctRenderer.modelMatrix, contourPlacement.position);

            this.uvctRenderers.push(uvctRenderer);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        for (let i = 0; i < this.uvctRenderers.length; i++)
            this.uvctRenderers[i].prepareToRender(device, renderInstManager, viewerInput, this.modelMatrix);
    }
}

// the game picks characters in order, skipping the player
function chooseFlyers(): number[] {
    return [0x10A, 0x10B, 0x10C, 0x10D, 0x10E, 0x10F];
}

function getLevelDobjs(levelID: number, modelBuilder: ModelBuilder, dataHolder: DataHolder): ObjectRenderer[] {
    const dobjs: ObjectRenderer[] = [];

    const flyerIDs = chooseFlyers();
    if (levelID === 0) { // Holiday Island
        // Boats
        dobjs.push(new Looper(modelBuilder.uvmdData[3], modelBuilder.palette, { // from 2d1dfc
            angularVelocity: -4,
            center: vec3.fromValues(-600, -600, 0),
            radius: 300,
            roll: -5,
            bounce: {
                bouncingPart: 1,
                maxAngle: 10,
                maxHeight: 1.5,
                maxVelocity: 7,
            },
            // TODO: figure out what's going on with the attached model 0x02
        }));
        dobjs.push(new Looper(modelBuilder.uvmdData[1], modelBuilder.palette, {  // from 2d1e70
            angularVelocity: 10,
            center: vec3.fromValues(700,-500,0),
            radius: 300,
            roll: 15,
        }));

        // Gliders
        dobjs.push(new Looper(modelBuilder.uvmdData[flyerIDs[0]], modelBuilder.palette, {
            angularVelocity: 20,
            center: vec3.fromValues(-66, 320, 125),
            radius: 80,
            roll: -15,
        }));
        dobjs.push(new Looper(modelBuilder.uvmdData[flyerIDs[1]], modelBuilder.palette, {
            angularVelocity: 18,
            center: vec3.fromValues(-66, 320, 135),
            radius: 70,
            roll: -15,
        }));
        dobjs.push(new Looper(modelBuilder.uvmdData[flyerIDs[2]], modelBuilder.palette, {
            angularVelocity: 18,
            center: vec3.fromValues(-70, 320, 155),
            radius: 90,
            roll: -15,
        }));
    } else if (levelID === 1) { // Crescent Island
        // Boats
        dobjs.push(new Looper(modelBuilder.uvmdData[3], modelBuilder.palette, { // from 2d1b88
            angularVelocity: -4,
            center: vec3.fromValues(400, -300, 0),
            radius: 400,
            roll: -5,
            bounce: {
                    bouncingPart: 1,
                    maxAngle: 10,
                    maxHeight: 1.5,
                    maxVelocity: 7,
                },
                // also has 2 attached
        }));
        dobjs.push(new Looper(modelBuilder.uvmdData[0x29], modelBuilder.palette, {  // from 2d1c04
            angularVelocity: 2,
            center: vec3.fromValues(300, -200, 0),
            radius: 275,
            roll: 0,
        }));
        // Gliders
        dobjs.push(new Looper(modelBuilder.uvmdData[flyerIDs[0]], modelBuilder.palette, {
            angularVelocity: 10,
            center: vec3.fromValues(-891.24, 602.16, 450),
            radius: 220,
            roll: -15,
        }));
        dobjs.push(new Looper(modelBuilder.uvmdData[flyerIDs[1]], modelBuilder.palette, {
            angularVelocity: 18,
            center: vec3.fromValues(1100.06, 686.22, 250),
            radius: 70,
            roll: -15,
        }));
        dobjs.push(new Looper(modelBuilder.uvmdData[flyerIDs[2]], modelBuilder.palette, {
            angularVelocity: 18,
            center: vec3.fromValues(1050.06, 686.22, 265),
            radius: 90,
            roll: -15,
        }));
    } else if (levelID === 2) { // Little States
        dobjs.push(new Looper(modelBuilder.uvmdData[flyerIDs[0]], modelBuilder.palette, {
            angularVelocity: 17,
            center: vec3.fromValues(1666.32, -1099.06, 100),
            radius: 30,
            roll: -15,
        }));
        dobjs.push(new Looper(modelBuilder.uvmdData[flyerIDs[1]], modelBuilder.palette, {
            angularVelocity: 13,
            center: vec3.fromValues(3293.09, 931.19, 150),
            radius: 60,
            roll: -15,
        }));
        dobjs.push(new Looper(modelBuilder.uvmdData[flyerIDs[2]], modelBuilder.palette, {
            angularVelocity: 18,
            center: vec3.fromValues(-2294.23, -791.48, 150),
            radius: 30,
            roll: -15,
        }));
        dobjs.push(new Looper(modelBuilder.uvmdData[flyerIDs[3]], modelBuilder.palette, {
            angularVelocity: 18,
            center: vec3.fromValues(-2290.23, -791.48, 170),
            radius: 50,
            roll: -15,
        }));
        // airplanes
        dobjs.push(new Airplane(modelBuilder.uvmdData[0x27], modelBuilder.palette, dataHolder.splineData.get(0x6d)!, {
            pathLength: 120,
            minHeight: 42.4323081970215,
            rollFactor: 150,
        }));
        dobjs.push(new Airplane(modelBuilder.uvmdData[0x1b], modelBuilder.palette, dataHolder.splineData.get(0x6e)!, {
            pathLength: 120,
            minHeight: 33.757682800293,
            rollFactor: 150,
        }));
    } else if (levelID === 3) { // Everfrost Island
        dobjs.push(new Looper(modelBuilder.uvmdData[flyerIDs[0]], modelBuilder.palette, {
            angularVelocity: 7,
            center: vec3.fromValues(80.03, -162.16, 600),
            radius: 250,
            roll: -15,
        }));
        dobjs.push(new Looper(modelBuilder.uvmdData[flyerIDs[1]], modelBuilder.palette, {
            angularVelocity: 17,
            center: vec3.fromValues(745.26, 1107.29, 150),
            radius: 70,
            roll: -15,
        }));
        dobjs.push(new Looper(modelBuilder.uvmdData[flyerIDs[2]], modelBuilder.palette, {
            angularVelocity: 17,
            center: vec3.fromValues(800.26, 1107.29, 170),
            radius: 168,
            roll: -15,
        }));
        for (let i = 0; i < 20; i++) {
            dobjs.push(new ChairliftChair(
                modelBuilder.uvmdData[0xa7],
                modelBuilder.palette,
                dataHolder.splineData.get(4)!,
                5 * i));
        }
    }
    return dobjs;
}

async function fetchDataHolder(dataFetcher: DataFetcher, device: GfxDevice): Promise<DataHolder> {
    const fsBin = await dataFetcher.fetchData(`${pathBase}/fs.bin`);
    const fs = parsePilotwings64FS(fsBin);

    const dataHolder = new DataHolder();
    let userFileCounter = 0;
    for (let i = 0; i < fs.files.length; i++) {
        const file = fs.files[i];
        if (file.type === 'UVCT') {
            const uvct = parseUVCT(file);
            dataHolder.uvctData.push(new UVCTData(device, uvct));
        } else if (file.type === 'UVTX') {
            const uvtx = parseUVTX(file);
            dataHolder.textureData.push(new TextureData(device, dataHolder.gfxRenderCache, uvtx));
        } else if (file.type === 'UVMD') {
            const uvmd = parseUVMD(file);
            dataHolder.uvmdData.push(new ModelData(device, uvmd, dataHolder.uvmdData.length));
        } else if (file.type === 'UVTR') {
            dataHolder.uvtr.push(parseUVTR(file));
        } else if (file.type === 'UVLV') {
            dataHolder.uvlv.push(parseUVLV(file));
        } else if (file.type === 'UPWL') {
            // technically "user files", but lookup is done by relative order
            dataHolder.upwl.push(parseUPWL(file));
        } else if (file.type === 'UPWT') {
            const task = parseUPWT(file);
            dataHolder.upwt[task.label.level].push(task);
        } else if (file.type === 'UVTP') {
            dataHolder.uvtp = parseUVTP(file);
        } else if (file.type === 'UVEN') {
            dataHolder.uven = parseUVEN(file);
        } else if (file.type === 'SPTH') {
            dataHolder.splineData.set(userFileCounter, parseSPTH(file));
        }
        if (!file.type.startsWith('UV'))
            userFileCounter++;
    }

    return dataHolder;
}

const enum PW64Pass { SKYBOX, NORMAL, SNOW }

const toNoclipSpace = mat4.create();
mat4.fromXRotation(toNoclipSpace, -90 * MathConstants.DEG_TO_RAD);
mat4.scale(toNoclipSpace, toNoclipSpace, [50, 50, 50]);

class Pilotwings64Renderer implements SceneGfx {
    private static scratchMatrix = mat4.create();

    public uvtrRenderers: UVTRRenderer[] = [];
    public dobjRenderers: ObjectRenderer[] = [];
    public skyRenderers: ObjectRenderer[] = [];
    public snowRenderer: SnowRenderer | null = null;
    public renderHelper: GfxRenderHelper;
    private renderTarget = new BasicRenderTarget();

    public taskLabels: TaskLabel[] = [];
    public strIndexToTask: number[] = [];

    private currentTaskIndex: number = -1;
    private taskSelect: SingleSelect;

    constructor(device: GfxDevice, private dataHolder: DataHolder, private modelBuilder: ModelBuilder) {
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

        template.filterKey = PW64Pass.SKYBOX;
        const skyMatrix = Pilotwings64Renderer.scratchMatrix;
        mat4.copy(skyMatrix, toNoclipSpace);
        skyMatrix[12] = viewerInput.camera.worldMatrix[12];
        skyMatrix[13] = viewerInput.camera.worldMatrix[13] - 5000;
        skyMatrix[14] = viewerInput.camera.worldMatrix[14];
        for (let i = 0; i < this.skyRenderers.length; i++)
            this.skyRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput, skyMatrix);

        template.filterKey = PW64Pass.NORMAL;
        for (let i = 0; i < this.uvtrRenderers.length; i++)
            this.uvtrRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        for (let i = 0; i < this.dobjRenderers.length; i++)
            this.dobjRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput, toNoclipSpace);
        if (this.snowRenderer !== null)
            this.snowRenderer.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    // For console runtime debugging.
    private spawnObject(objIndex: number) {
        const dobjRenderer = spawnObject(this.modelBuilder, objIndex);
        this.dobjRenderers.push(dobjRenderer);
        return dobjRenderer;
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        const renderInstManager = this.renderHelper.renderInstManager;
        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const skyPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, standardFullClearRenderPassDescriptor);
        executeOnPass(renderInstManager, device, skyPassRenderer, PW64Pass.SKYBOX);
        skyPassRenderer.endPass(null);
        device.submitPass(skyPassRenderer);

        const passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, depthClearRenderPassDescriptor);
        executeOnPass(renderInstManager, device, passRenderer, PW64Pass.NORMAL);
        executeOnPass(renderInstManager, device, passRenderer, PW64Pass.SNOW);

        renderInstManager.resetRenderInsts();
        return skyPassRenderer;
    }

    public setCurrentTask(index: number): void {
        if (this.currentTaskIndex === index)
            return;

        this.currentTaskIndex = index;
        for (let i = 0; i < this.dobjRenderers.length; i++) {
            this.dobjRenderers[i].syncTaskVisibility(index);
        }
    }

    public createPanels(): Panel[] {
        const taskPanel = new Panel();
        taskPanel.customHeaderBackgroundColor = COOL_BLUE_COLOR;
        taskPanel.setTitle(TIME_OF_DAY_ICON, 'Task');

        const taskNames: string[] = ['None'];
        for (let i = 0; i < this.taskLabels.length; i++) {
            taskNames.push(simpleTaskName(this.taskLabels[i]));
        }

        this.taskSelect = new SingleSelect();
        this.taskSelect.setStrings(taskNames);
        this.taskSelect.onselectionchange = (strIndex: number) => {
            const taskNumber = this.strIndexToTask[strIndex - 1];
            this.setCurrentTask(taskNumber);
        };
        this.taskSelect.selectItem(0);

        taskPanel.contents.appendChild(this.taskSelect.elem);

        return [taskPanel];
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderTarget.destroy(device);
        if (this.snowRenderer !== null)
            this.snowRenderer.destroy(device);
    }
}

const uvlvIDList = [1, 3, 5, 10];

// mapping from 2e12b4
function envIndex(level: number, weather: number): number {
    const base = 2 + 5 * level + weather; // roughly 5 per level, 0 and 1 aren't used for this
    if (level === 0) {
        return weather < 3 ? base : base - 1; // skip 3
    } else if (level === 1) {
        return weather < 4 ? base : base - 1; // skip 4
    } else if (level === 2) { // states has six consecutive UVEN
        return base;
    } else if (level === 3) {
        return weather < 3 ? base + 1 : base; // skip 3, but states has an extra
    }
    throw "Unknown level " + level;
}

// mapping from env_loadtpal (2e1990) combined with envIndex
function paletteIndex(level: number, weather: number): number {
    // everfrost always has a palette to make the landing pads snowy
    if (level === 3) {
        if (weather === 2)
            return 4;
        if (weather === 4)
            return 3;
        return 5;
    }
    // for other levels, only set palette if night
    return weather === 5 ? level : -1;
}

interface ModelBuilder {
    uvmdData: ModelData[];
    palette: TexturePalette;
}

class TexturePalette {
    constructor(private textureData: TextureData[], public palette?: UVTP) { }

    public get(index: number): TextureData {
        if (this.palette && this.palette.has(index))
            return this.textureData[this.palette.get(index)!];
        return this.textureData[index];
    }
}

const pathBase = `Pilotwings64`;
class Pilotwings64SceneDesc implements SceneDesc {
    public id: string;
    constructor(public levelID: number, public weatherConditions: number, public name: string) {
        this.id = `${levelID}:${weatherConditions}`;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        let dataHolder = await context.dataShare.ensureObject<DataHolder>(`${pathBase}/DataHolder`, async () => {
            return await fetchDataHolder(context.dataFetcher, device);
        });

        const levelData = dataHolder.uvlv[0].levels[uvlvIDList[this.levelID]];

        const skybox = dataHolder.uven[envIndex(this.levelID, this.weatherConditions)];
        const activePalette: Map<number, number> | undefined = dataHolder.uvtp[paletteIndex(this.levelID, this.weatherConditions)];

        const modelBuilder = {
            uvmdData: dataHolder.uvmdData,
            palette: new TexturePalette(dataHolder.textureData, activePalette),
        };

        const renderer = new Pilotwings64Renderer(device, dataHolder, modelBuilder);

        if (skybox.skyboxModel !== undefined) {
            const sky = spawnObject(modelBuilder, skybox.skyboxModel);
            renderer.skyRenderers.push(sky);
        }
        if (skybox.oceanModel !== undefined) {
            const oceanPlane = spawnEnvObject(modelBuilder, skybox.oceanModel);
            oceanPlane.sortKeyBase = makeSortKey(GfxRendererLayer.BACKGROUND);
            renderer.dobjRenderers.push(oceanPlane);
        }
        if (this.levelID === 3 && this.weatherConditions === 2)
            renderer.snowRenderer = new SnowRenderer(device, 800);

        for (let i = 0; i < levelData.terras.length; i++) {
            const terraIndex = levelData.terras[i];
            const uvtrChunk = dataHolder.uvtr[0].maps[terraIndex];
            const uvtrRenderer = new UVTRRenderer(dataHolder, modelBuilder, uvtrChunk);
            mat4.copy(uvtrRenderer.modelMatrix, toNoclipSpace);
            renderer.uvtrRenderers.push(uvtrRenderer);
        }

        const levelDobjs = getLevelDobjs(this.levelID, modelBuilder, dataHolder);
        for (let i = 0; i < levelDobjs.length; i++) {
            renderer.dobjRenderers.push(levelDobjs[i]);
        }

        const currUPWL = dataHolder.upwl[this.levelID];
        for (let i = 0; i < currUPWL.windObjects.length; i++) {
            // TODO: move these based on wind
            renderer.dobjRenderers.push(spawnObjectAt(modelBuilder, currUPWL.windObjects[i]));
        }
        const landingPads: LandingPad[] = [];
        for (let i = 0; i < currUPWL.landingPads.length; i++) {
            const padData = dataHolder.uvmdData[currUPWL.landingPads[i].modelIndex];
            const pad = new LandingPad(padData, modelBuilder.palette);
            fromTranslationScaleEuler(pad.modelMatrix, currUPWL.landingPads[i].position, 1 / padData.uvmd.inverseScale, currUPWL.landingPads[i].angles)
            renderer.dobjRenderers.push(pad);
            landingPads.push(pad);
        }
        const starData = dataHolder.uvmdData[0xf2];
        const star = new BirdmanStar(starData, modelBuilder.palette);
        fromTranslationScaleEuler(star.modelMatrix, currUPWL.bonusStar, 1 / starData.uvmd.inverseScale)
        renderer.dobjRenderers.push(star);

        const taskList = dataHolder.upwt[this.levelID];
        taskList.sort(taskSort);
        for (let i = 0; i < taskList.length; i++) {
            const upwt = taskList[i];
            if (isEmptyTask(upwt))
                continue;
            renderer.taskLabels.push(upwt.label);
            renderer.strIndexToTask.push(i);
            for (let j = 0; j < upwt.models.length; j++) {
                renderer.dobjRenderers.push(spawnObjectAt(modelBuilder, upwt.models[j], i));
            }
            for (let j = 0; j < upwt.rings.length; j++) {
                const ringData = upwt.rings[j];
                const ringModel = dataHolder.uvmdData[ringData.modelIndex];
                const ringObj = new Ring(ringModel, modelBuilder.palette, ringData.axis);
                ringObj.taskNumber = i;
                fromTranslationScaleEuler(ringObj.modelMatrix, ringData.position, 1 / ringModel.uvmd.inverseScale, ringData.angles);
                renderer.dobjRenderers.push(ringObj);
            }
            if (upwt.landingPad) {
                for (let j = 0; j < currUPWL.landingPads.length; j++) {
                    // when a task is chosen, the game finds a nearby inactive pad and replaces its model and flags
                    if (vec3.distance(upwt.landingPad.position, currUPWL.landingPads[j].position) < 100) {
                        // the UPWT pad doesn't have the real position, copy from UPWL
                        upwt.landingPad.position = currUPWL.landingPads[j].position;
                        upwt.landingPad.angles = currUPWL.landingPads[j].angles;
                        const activePad = spawnObjectAt(modelBuilder, upwt.landingPad, i);
                        renderer.dobjRenderers.push(activePad);
                        landingPads[j].alternates.push(activePad);
                        break;
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
    'Holiday Island',
    new Pilotwings64SceneDesc(0, 0, 'Holiday Island (Sunny)'),
    new Pilotwings64SceneDesc(0, 1, 'Holiday Island (Sunny Part 2)'),
    new Pilotwings64SceneDesc(0, 2, 'Holiday Island (Cloudy)'),
    new Pilotwings64SceneDesc(0, 4, 'Holiday Island (Evening)'),
    new Pilotwings64SceneDesc(0, 5, 'Holiday Island (Starry Night)'),
    'Crescent Island',
    new Pilotwings64SceneDesc(1, 0, 'Crescent Island (Sunny)'),
    new Pilotwings64SceneDesc(1, 1, 'Crescent Island (Sunny Part 2)'),
    new Pilotwings64SceneDesc(1, 2, 'Crescent Island (Cloudy)'),
    new Pilotwings64SceneDesc(1, 3, 'Crescent Island (Cloudy Night)'),
    new Pilotwings64SceneDesc(1, 5, 'Crescent Island (Starry Night)'),
    'Little States',
    new Pilotwings64SceneDesc(2, 0, 'Little States (Sunny)'),
    new Pilotwings64SceneDesc(2, 1, 'Little States (Sunny Part 2)'),
    new Pilotwings64SceneDesc(2, 2, 'Little States (Cloudy)'),
    new Pilotwings64SceneDesc(2, 3, 'Little States (Cloudy Night)'),
    new Pilotwings64SceneDesc(2, 4, 'Little States (Evening)'),
    new Pilotwings64SceneDesc(2, 5, 'Little States (Starry Night)'),
    'Ever-Frost Island',
    new Pilotwings64SceneDesc(3, 0, 'Ever-Frost Island (Sunny)'),
    new Pilotwings64SceneDesc(3, 1, 'Ever-Frost Island (Sunny Part 2)'),
    new Pilotwings64SceneDesc(3, 2, 'Ever-Frost Island (Snowing)'),
    new Pilotwings64SceneDesc(3, 4, 'Ever-Frost Island (Starry Night)'),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
