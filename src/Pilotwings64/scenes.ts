
import { GfxDevice, GfxBuffer, GfxInputLayout, GfxInputState, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxFormat, GfxVertexAttributeFrequency, GfxRenderPass, GfxHostAccessPass, GfxBindingLayoutDescriptor } from "../gfx/platform/GfxPlatform";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { SceneDesc, SceneContext, SceneGroup } from "../SceneBase";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, assert, hexzero, assertExists, nArray } from "../util";
import { decompress } from "../compression/MIO0";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { DeviceProgram } from "../Program";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { fillMatrix4x3, fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { mat4, vec3 } from "gl-matrix";
import { GfxRenderHelper } from "../gfx/render/GfxRenderGraph";
import { standardFullClearRenderPassDescriptor, BasicRenderTarget } from "../gfx/helpers/RenderTargetHelpers";
import { computeViewMatrix } from "../Camera";
import { MathConstants } from "../MathHelpers";
import { IS_DEVELOPMENT } from "../BuildVersion";
import { TextureCache, TextureState, TextureImageState, TileState } from "../bk/f3dex";

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

interface UVCT_Chunk {
    vertexData: Float32Array;
    indexData: Uint16Array;
}

function parseUVCT_Chunk(chunk: Pilotwings64FSFileChunk): UVCT_Chunk {
    assert(chunk.tag === 'COMM');
    const view = chunk.buffer.createDataView();

    const vertCount = view.getUint16(0x00);
    const faceCount = view.getUint16(0x02);
    const unkCount = view.getUint16(0x04);
    const planeCount = view.getUint16(0x06);

    let offs = 0x08;

    const vertexData = new Float32Array(9 * vertCount);
    for (let i = 0; i < vertexData.length;) {
        vertexData[i++] = view.getInt16(offs + 0x00);
        vertexData[i++] = view.getInt16(offs + 0x02);
        vertexData[i++] = view.getInt16(offs + 0x04);
        // Unknown
        vertexData[i++] = (view.getInt16(offs + 0x08) / 0x40) + 0.5;
        vertexData[i++] = (view.getInt16(offs + 0x0A) / 0x40) + 0.5;
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

    return { vertexData, indexData };
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

interface UVTX {
}

/*
class RSPState {
    private textureCache = new TextureCache();

    private SP_GeometryMode: number = 0;
    private SP_TextureState = new TextureState();

    private DP_OtherModeL: number = 0;
    private DP_OtherModeH: number = 0;
    private DP_CombineL: number = 0;
    private DP_CombineH: number = 0;
    private DP_TextureImageState = new TextureImageState();
    private DP_TileState = nArray(8, () => new TileState());

    public gSPTexture(on: boolean, tile: number, level: number, s: number, t: number): void {
        // This is the texture we're using to rasterize triangles going forward.
        this.SP_TextureState.set(on, tile, level, s, t);
    }

    private _translateTileTexture(tileIndex: number): number {
        const tile = this.DP_TileState[tileIndex];

        const dramAddr = assertExists(this.DP_TMemTracker.get(tile.tmem));

        let dramPalAddr: number;
        if (tile.fmt === ImageFormat.G_IM_FMT_CI) {
            const textlut = (this.DP_OtherModeH >>> 14) & 0x03;
            assert(textlut === TextureLUT.G_TT_RGBA16);

            const palTmem = 0x100 + (tile.palette << 4);
            dramPalAddr = assertExists(this.DP_TMemTracker.get(palTmem));
        } else {
            dramPalAddr = 0;
        }

        return this.textureCache.translateTileTexture(this.segmentBuffers, dramAddr, dramPalAddr, tile);
    }

    public gDPSetTextureImage(fmt: number, siz: number, w: number, addr: number): void {
        this.DP_TextureImageState.set(fmt, siz, w, addr);
    }

    public gDPSetTile(fmt: number, siz: number, line: number, tmem: number, tile: number, palette: number, cmt: number, maskt: number, shiftt: number, cms: number, masks: number, shifts: number): void {
        this.DP_TileState[tile].set(fmt, siz, line, tmem, palette, cmt, maskt, shiftt, cms, masks, shifts);
    }

    public gDPLoadTLUT(tile: number, count: number): void {
        // Track the TMEM destination back to the originating DRAM address.
        const tmemDst = this.DP_TileState[tile].tmem;
        this.DP_TMemTracker.set(tmemDst, this.DP_TextureImageState.addr);
    }

    public gDPLoadBlock(tileIndex: number, uls: number, ult: number, lrs: number, dxt: number): void {
        // First, verify that we're loading the whole texture.
        assert(uls === 0 && ult === 0);
        // Verify that we're loading into LOADTILE.
        assert(tileIndex === 7);

        const tile = this.DP_TileState[tileIndex];
        // Compute the texture size from lrs/dxt. This is required for mipmapping to work correctly
        // in B-K due to hackery.
        const numWordsTotal = lrs + 1;
        const numWordsInLine = (1 << 11) / dxt;
        const numPixelsInLine = (numWordsInLine * 8 * 8) / getSizBitsPerPixel(tile.siz);
        tile.lrs = (numPixelsInLine - 1) << 2;
        tile.lrt = (((numWordsTotal / numWordsInLine) / 4) - 1) << 2;

        // Track the TMEM destination back to the originating DRAM address.
        this.DP_TMemTracker.set(tile.tmem, this.DP_TextureImageState.addr);
        this.stateChanged = true;
    }

    public gDPSetTileSize(tile: number, uls: number, ult: number, lrs: number, lrt: number): void {
        this.DP_TileState[tile].setSize(uls, ult, lrs, lrt);
    }

    public gDPSetOtherModeL(sft: number, len: number, w1: number): void {
        const mask = ((1 << len) - 1) << sft;
        this.DP_OtherModeL = (this.DP_OtherModeL & ~mask) | (w1 & mask);
        this.stateChanged = true;
    }

    public gDPSetOtherModeH(sft: number, len: number, w1: number): void {
        const mask = ((1 << len) - 1) << sft;
        this.DP_OtherModeH = (this.DP_OtherModeH & ~mask) | (w1 & mask);
        this.stateChanged = true;
    }

    public gDPSetCombine(w0: number, w1: number): void {
        this.DP_CombineH = w0;
        this.DP_CombineL = w1;
        this.stateChanged = true;
    }
}
*/

function parseUVTX_Chunk(chunk: Pilotwings64FSFileChunk): UVTX {
    const view = chunk.buffer.createDataView();
    const dataSize = view.getUint16(0x00);
    const dlSize = view.getUint16(0x02) * 0x08;

    const addr = 0x14 + dataSize;
    const dlEnd = addr + dlSize;
    for (let i = (addr & 0x00FFFFFF); i < dlEnd; i += 0x08) {
        const w0 = view.getUint32(i + 0x00);
        const w1 = view.getUint32(i + 0x04);

        const cmd: F3D_GBI = w0 >>> 24;
        console.log(hexzero(i, 8), F3D_GBI[cmd], hexzero(w0, 8), hexzero(w1, 8));

        if (cmd === F3D_GBI.G_TEXTURE) {
            const level = (w0 >>> 11) & 0x07;
            const tile  = (w0 >>> 8) & 0x07;
            const on    = !!((w0 >>> 0) & 0x7F);
            const s     = (w1 >>> 16) & 0xFFFF;
            const t     = (w1 >>> 0)  & 0xFFFF;
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
            // state.gDPSetTextureImage(fmt, siz, w, w1);
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
            // state.gDPSetTile(fmt, siz, line, tmem, tile, palette, cmt, maskt, shiftt, cms, masks, shifts);
        } else if (cmd === F3D_GBI.G_LOADBLOCK) {
            const uls =  (w0 >>> 12) & 0x0FFF;
            const ult =  (w0 >>>  0) & 0x0FFF;
            const tile = (w1 >>> 24) & 0x07;
            const lrs =  (w1 >>> 12) & 0x0FFF;
            const dxt =  (w1 >>>  0) & 0x0FFF;
        } else if (cmd === F3D_GBI.G_SETTILESIZE) {
            const uls =  (w0 >>> 12) & 0x0FFF;
            const ult =  (w0 >>>  0) & 0x0FFF;
            const tile = (w1 >>> 24) & 0x07;
            const lrs =  (w1 >>> 12) & 0x0FFF;
            const lrt =  (w1 >>>  0) & 0x0FFF;
        } else if (cmd === F3D_GBI.G_ENDDL) {
            break;
        } else {
            throw "whoops";
        }
    }

    return {};
}

function parseUVTX(file: Pilotwings64FSFile): UVTX {
    assert(file.chunks.length === 1);
    return parseUVTX_Chunk(file.chunks[0]);
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

    public static ub_SceneParams = 0;
    public static ub_DrawParams = 1;

    public both = `
precision mediump float;

layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(row_major, std140) uniform ub_DrawParams {
    Mat4x3 u_BoneMatrix[1];
};

varying vec4 v_Color;
`;

    public vert = `
layout(location = ${PW64Program.a_Position}) in vec3 a_Position;
layout(location = ${PW64Program.a_Color}) in vec4 a_Color;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[0]), vec4(a_Position, 1.0)));
    v_Color = a_Color;
}
`;

    public frag = `
void main() {
    gl_FragColor = v_Color;
}
`;
}

class UVCTData {
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;

    constructor(device: GfxDevice, public uvct: UVCT_Chunk) {
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, uvct.vertexData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, uvct.indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: PW64Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB,  bufferByteOffset: 0*0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
            { location: PW64Program.a_Color   , bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 5*0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
        ];

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, byteStride: 9*0x04, },
        ], { buffer: this.indexBuffer, byteOffset: 0, byteStride: 0x02 });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

const scratchMatrix = mat4.create();
class UVCTInstance {
    public modelMatrix = mat4.create();
    public program = new PW64Program();

    constructor(private uvctData: UVCTData) {
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const renderInst = renderInstManager.pushRenderInst();

        let offs = renderInst.allocateUniformBuffer(PW64Program.ub_DrawParams, 12);
        const d = renderInst.mapUniformBufferF32(PW64Program.ub_DrawParams);

        computeViewMatrix(scratchMatrix, viewerInput.camera);
        mat4.mul(scratchMatrix, scratchMatrix, this.modelMatrix);

        offs += fillMatrix4x3(d, offs, scratchMatrix);

        const gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);
        renderInst.setGfxProgram(gfxProgram);
        renderInst.setInputLayoutAndState(this.uvctData.inputLayout, this.uvctData.inputState);
        renderInst.drawIndexes(this.uvctData.uvct.indexData.length);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 0 },
];

class Pilotwings64Renderer implements SceneGfx {
    public uvctData: UVCTData[] = [];
    public uvctInstance: UVCTInstance[] = [];
    public renderHelper: GfxRenderHelper;
    private renderTarget = new BasicRenderTarget();

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        let offs = template.allocateUniformBuffer(PW64Program.ub_SceneParams, 16);
        const d = template.mapUniformBufferF32(PW64Program.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < this.uvctInstance.length; i++)
            this.uvctInstance[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
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
        for (let i = 0; i < this.uvctData.length; i++)
            this.uvctData[i].destroy(device);
    }
}

const pathBase = `Pilotwings64`;
class Pilotwings64SceneDesc implements SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const fsBin = await context.dataFetcher.fetchData(`${pathBase}/fs.bin`);
        const fs = parsePilotwings64FS(fsBin);

        const renderer = new Pilotwings64Renderer(device);

        const uvct = fs.files.filter((file) => file.type === 'UVCT').map((file) => parseUVCT(file));

        const uvtr = fs.files.filter((file) => file.type === 'UVTR').map((file) => parseUVTR(file));
        assert(uvtr.length === 1);

        const uvctData = uvct.map((uvct) => new UVCTData(device, uvct));
        renderer.uvctData = uvctData;

        const uvtx = parseUVTX(fs.files.find((file) => file.type === 'UVTX'));

        for (let i = 0; i < uvtr[0].maps.length; i++) {
            const map = uvtr[0].maps[i];
            const baseY = i * 1000;
            for (let j = 0; j < map.contourPlacements.length; j++) {
                const ct = map.contourPlacements[j];
                const instance = new UVCTInstance(uvctData[ct.contourIndex]);
                const position = vec3.fromValues(ct.position[0], baseY, -ct.position[1]);
                mat4.scale(instance.modelMatrix, instance.modelMatrix, [50, 50, 50]);
                mat4.translate(instance.modelMatrix, instance.modelMatrix, position);
                mat4.rotateX(instance.modelMatrix, instance.modelMatrix, -90 * MathConstants.DEG_TO_RAD);
                renderer.uvctInstance.push(instance);
            }
        }

        return renderer;
    }
}

const id = 'Pilotwings64';
const name = "Pilotwings 64";
const sceneDescs = [
    new Pilotwings64SceneDesc('uvcttest', 'UVCT Test'),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: !IS_DEVELOPMENT };
