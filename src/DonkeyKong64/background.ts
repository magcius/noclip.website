import * as Viewer from '../viewer.js';
import { mat4 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { F3DEX_Program } from '../BanjoKazooie/render.js';
import { decodeTex_RGBA16, TextFilt } from '../Common/N64/Image.js';
import * as RDP from '../Common/N64/RDP.js';
import { OtherModeH_Layout } from '../Common/N64/RDP.js';
import { createBufferFromData } from '../gfx/helpers/BufferHelpers.js';
import {
    fillMatrix4x2, fillMatrix4x3, fillMatrix4x4, fillVec4,
} from '../gfx/helpers/UniformBufferHelpers.js';
import {
    GfxBindingLayoutDescriptor, GfxBuffer, GfxBufferFrequencyHint,
    GfxBufferUsage, GfxCompareMode, GfxDevice, GfxFormat,
    GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxMipFilterMode,
    GfxProgram, GfxTexFilterMode, GfxTexture, GfxVertexAttributeDescriptor,
    GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode,
    makeTextureDescriptor2D,
} from '../gfx/platform/GfxPlatform.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import {
    GfxRendererLayer, GfxRenderInstManager, makeSortKeyOpaque,
} from '../gfx/render/GfxRenderInstManager.js';
import { TextureMapping } from '../TextureHolder.js';
import { assert, hexzero } from '../util.js';

export interface BackdropData {
    TextureID: number;
    Data: ArrayBufferSlice;
}

export interface BackdropRenderer {
    prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void;
    destroy(device: GfxDevice): void;
}

const backdropBindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 2 },
];

const identityMatrix = mat4.create();
const textureMatrix = mat4.create();

function wrap01(v: number): number {
    return v - Math.floor(v);
}

function calcAztecBeetleRaceTint(height: number): readonly [number, number, number] {
    // From func_global_asm_807065F8 and D_global_asm_80754F58
    const keys: readonly (readonly [number, number, number, number])[] = [
        [0, 0xFF, 0x00, 0x00],
        [1900, 0x00, 0x00, 0xFF],
        [3600, 0x00, 0xFF, 0x00],
        [5300, 0xFF, 0x00, 0x00],
    ];
    if (height <= keys[0][0])
        return [keys[0][1] / 0xFF, keys[0][2] / 0xFF, keys[0][3] / 0xFF];
    for (let i = 1; i < keys.length; i++) {
        if (height <= keys[i][0]) {
            const prev = keys[i - 1];
            const next = keys[i];
            const t = (height - prev[0]) / (next[0] - prev[0]);
            return [
                (prev[1] + (next[1] - prev[1]) * t) / 0xFF,
                (prev[2] + (next[2] - prev[2]) * t) / 0xFF,
                (prev[3] + (next[3] - prev[3]) * t) / 0xFF,
            ];
        }
    }
    const last = keys[keys.length - 1];
    return [last[1] / 0xFF, last[2] / 0xFF, last[3] / 0xFF];
}

function calcBackdropTint(mapID: number, height: number): readonly [number, number, number] {
    if (mapID === 0x0E)
        return calcAztecBeetleRaceTint(height);

    // From func_global_asm_807065F8
    switch (mapID) {
    case 0x41:
    case 0x42:
    case 0x43:
    case 0x44:
    case 0x45:
    case 0x4A:
    case 0x4B:
    case 0x7C:
    case 0x7D:
    case 0x7E:
    case 0x7F:
    case 0x80:
        return [0x3F / 0xFF, 0x3F / 0xFF, 0x3F / 0xFF];
    default:
        return [1, 1, 1];
    }
}

class PanoramaBackdropRenderer implements BackdropRenderer {
    private gfxProgram: GfxProgram;
    private gfxTexture: GfxTexture;
    private textureMappings = [new TextureMapping(), new TextureMapping()];
    private vertexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];

    constructor(device: GfxDevice, cache: GfxRenderCache, backdrop: BackdropData, private mapID: number) {
        const width = 320;
        const height = 240;
        assert(backdrop.Data.byteLength === width * height * 2);
        const src = backdrop.Data.createDataView();
        const pixels = new Uint8Array(width * height * 4);
        decodeTex_RGBA16(pixels, src, 0, width, height);

        // From func_global_asm_807069A4
        const otherModeH = TextFilt.G_TF_BILERP << OtherModeH_Layout.G_MDSFT_TEXTFILT;
        const program = new F3DEX_Program(
            otherModeH,
            0x00404240,
            RDP.decodeCombineParams(0x0011FE23, 0xFFFFF7FB),
        );
        program.defines.set('BONE_MATRIX_COUNT', '1');
        program.defines.set('USE_TEXTURE', '1');
        this.gfxProgram = cache.createProgram(program);

        this.gfxTexture = device.createTexture(makeTextureDescriptor2D(
            GfxFormat.U8_RGBA_NORM, width, height, 1,
        ));
        device.setResourceName(this.gfxTexture, `DK64 HUD texture ${hexzero(backdrop.TextureID, 2)}`);
        device.uploadTextureData(this.gfxTexture, 0, [pixels]);
        this.textureMappings[0].gfxTexture = this.gfxTexture;
        this.textureMappings[0].gfxSampler = cache.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0,
            maxLOD: 0,
        });

        const vertices = new Float32Array([
            // pos.xyz, bone index, texcoord, color
            -1,  1, 0, 0,  0, 0,  1, 1, 1, 1,
             1,  1, 0, 0,  1, 0,  1, 1, 1, 1,
             1, -1, 0, 0,  1, 1,  1, 1, 1, 1,
            -1,  1, 0, 0,  0, 0,  1, 1, 1, 1,
             1, -1, 0, 0,  1, 1,  1, 1, 1, 1,
            -1, -1, 0, 0,  0, 1,  1, 1, 1, 1,
        ]);
        this.vertexBuffer = createBufferFromData(
            device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertices.buffer,
        );
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: F3DEX_Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 * 0x04 },
            { location: F3DEX_Program.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 4 * 0x04 },
            { location: F3DEX_Program.a_Color, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 6 * 0x04 },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 10 * 0x04, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        this.inputLayout = cache.createInputLayout({
            indexBufferFormat: null,
            vertexBufferDescriptors,
            vertexAttributeDescriptors,
        });
        this.vertexBufferDescriptors = [{ buffer: this.vertexBuffer }];
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setDrawCount(6);
        renderInst.sortKey = makeSortKeyOpaque(GfxRendererLayer.BACKGROUND, this.gfxProgram.ResourceUniqueId);
        renderInst.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, null);
        renderInst.setBindingLayouts(backdropBindingLayouts);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setMegaStateFlags({ depthCompare: GfxCompareMode.Always, depthWrite: false });

        let offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, 16);
        let mapped = renderInst.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        fillMatrix4x4(mapped, offs, identityMatrix);

        // Translated from func_global_asm_8068BBF8 and func_global_asm_807069A4
        const camera = viewerInput.camera.worldMatrix;
        const forwardX = -camera[8];
        const forwardY = -camera[9];
        const forwardZ = -camera[10];
        const horizontalAngle = wrap01(Math.atan2(-forwardZ, -forwardX) / (Math.PI * 2));
        const pitch = Math.atan2(forwardY, Math.hypot(forwardX, forwardZ));
        const verticalAngle = Math.PI / 2 - pitch;
        const centerU = horizontalAngle;
        const centerV = wrap01((verticalAngle / (Math.PI * 2)) * (320 / 240));
        const backdropScale = 5.6;
        const scaleU = (230 / backdropScale) / 320;
        const scaleV = (190 / backdropScale) / 240;

        offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_DrawParams, 12 + 8 * 2);
        mapped = renderInst.mapUniformBufferF32(F3DEX_Program.ub_DrawParams);
        offs += fillMatrix4x3(mapped, offs, identityMatrix);
        mat4.identity(textureMatrix);
        textureMatrix[0] = scaleU;
        textureMatrix[5] = scaleV;
        textureMatrix[12] = centerU - scaleU / 2;
        textureMatrix[13] = centerV - scaleV / 2;
        offs += fillMatrix4x2(mapped, offs, textureMatrix);
        offs += fillMatrix4x2(mapped, offs, identityMatrix);

        const tint = calcBackdropTint(this.mapID, camera[13] / 3);
        offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_CombineParams, 8);
        mapped = renderInst.mapUniformBufferF32(F3DEX_Program.ub_CombineParams);
        offs += fillVec4(mapped, offs, tint[0], tint[1], tint[2], 1);
        fillVec4(mapped, offs, 1, 1, 1, 1);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyTexture(this.gfxTexture);
    }
}

type BackdropColor = readonly [number, number, number];

// Backdrop palettes from func_global_asm_80704B20 + D_global_asm_80754EF8
// Colors go from top to bottom.
const gradientBackdropPalettes: readonly (readonly BackdropColor[])[] = [
    [[0x00, 0x40, 0xFF], [0xFF, 0x8F, 0x11], [0xFF, 0x8F, 0x11], [0x00, 0x2C, 0x00]],
    [[0x46, 0x82, 0xFA], [0xFF, 0xFF, 0xFF], [0xFF, 0xFF, 0xFF], [0x00, 0x2C, 0x00]],
    [[0x46, 0x82, 0xFA], [0x96, 0x96, 0xFA], [0x96, 0x96, 0xFA], [0x00, 0x2C, 0x00]],
    [[0x46, 0x82, 0xFA], [0xFF, 0xFA, 0xFA], [0x00, 0x00, 0x00], [0x00, 0x00, 0x00]],
    [[0x00, 0x01, 0x75], [0xFF, 0xFF, 0xFF], [0x1E, 0x7D, 0x19], [0x00, 0x2D, 0x00]],
    [[0x46, 0x82, 0xFA], [0x9D, 0xC4, 0xFF], [0x00, 0x19, 0xFF], [0x00, 0x19, 0x23]],
    [[0x00, 0x00, 0xA5], [0x00, 0x00, 0x00], [0x28, 0x0A, 0x14], [0x00, 0x00, 0x00]],
    [[0xFF, 0x00, 0x00], [0xFF, 0xBE, 0x00], [0xFF, 0xFF, 0x00], [0x00, 0x00, 0xFF]],
    [[0xFF, 0xFF, 0x00], [0xFF, 0xFF, 0x00], [0xFF, 0xFF, 0x00], [0xFF, 0xFF, 0x00]],
    [[0xFF, 0xFF, 0xFF], [0xFF, 0xFF, 0xFF], [0xFF, 0xFF, 0xFF], [0xFF, 0xFF, 0xFF]],
];

// From func_global_asm_80707980's gradient assignments.
const gradientBackdropPaletteByMap = new Map<number, number>([
    [0x07, 4],
    [0x08, 3],
    [0x1E, 0],
    [0x22, 5],
    [0x26, 0],
    [0x27, 0],
    [0x30, 2],
    [0x36, 8],
    [0x37, 1],
    [0x50, 7],
    [0x57, 6],
    [0x6F, 6],
    [0x99, 5],
    [0xAC, 5],
    [0xD0, 9],
    [0xD5, 7],
]);

function pushGradientQuad(
    dst: number[], y0: number, y1: number, color0: BackdropColor, color1: BackdropColor,
): void {
    const r0 = color0[0] / 0xFF, g0 = color0[1] / 0xFF, b0 = color0[2] / 0xFF;
    const r1 = color1[0] / 0xFF, g1 = color1[1] / 0xFF, b1 = color1[2] / 0xFF;
    // pos.xyz, bone index, texcoord, color
    dst.push(
        -1, y0, 0, 0, 0, 0, r0, g0, b0, 1,
         1, y0, 0, 0, 0, 0, r0, g0, b0, 1,
         1, y1, 0, 0, 0, 0, r1, g1, b1, 1,
        -1, y0, 0, 0, 0, 0, r0, g0, b0, 1,
         1, y1, 0, 0, 0, 0, r1, g1, b1, 1,
        -1, y1, 0, 0, 0, 0, r1, g1, b1, 1,
    );
}

class GradientBackdropRenderer implements BackdropRenderer {
    private gfxProgram: GfxProgram;
    private textureMappings = [new TextureMapping(), new TextureMapping()];
    private vertexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];

    constructor(device: GfxDevice, cache: GfxRenderCache, palette: readonly BackdropColor[], paletteIndex: number) {
        // From func_global_asm_80704B20 + D_global_asm_80754ED8
        const program = new F3DEX_Program(
            0,
            0x00552048,
            RDP.decodeCombineParams(0x00FFFFFF, 0xFFFE793C),
        );
        program.defines.set('BONE_MATRIX_COUNT', '1');
        program.defines.set('USE_VERTEX_COLOR', '1');
        this.gfxProgram = cache.createProgram(program);

        const sourceRows = paletteIndex === 4
            ? [0, 400, 440, 800]
            : (paletteIndex === 5 || paletteIndex === 7)
                ? [0, 480, 500, 800]
                : [0, 492, 552, 960];
        const sourceYToNDC = (sourceY: number): number => 1 - (sourceY - 336) / 120;
        const vertices: number[] = [];
        const rows = [
            6,
            sourceYToNDC(sourceRows[0]),
            sourceYToNDC(sourceRows[1]),
            sourceYToNDC(sourceRows[2]),
            sourceYToNDC(sourceRows[3]),
            -6,
        ];
        const colors = [palette[0], palette[0], palette[1], palette[2], palette[3], palette[3]];
        for (let i = 0; i < rows.length - 1; i++)
            pushGradientQuad(vertices, rows[i], rows[i + 1], colors[i], colors[i + 1]);

        const vertexData = new Float32Array(vertices);
        this.vertexBuffer = createBufferFromData(
            device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertexData.buffer,
        );
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: F3DEX_Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 * 0x04 },
            { location: F3DEX_Program.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 4 * 0x04 },
            { location: F3DEX_Program.a_Color, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 6 * 0x04 },
        ];
        this.inputLayout = cache.createInputLayout({
            indexBufferFormat: null,
            vertexBufferDescriptors: [{ byteStride: 10 * 0x04, frequency: GfxVertexBufferFrequency.PerVertex }],
            vertexAttributeDescriptors,
        });
        this.vertexBufferDescriptors = [{ buffer: this.vertexBuffer }];
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setDrawCount(30);
        renderInst.sortKey = makeSortKeyOpaque(GfxRendererLayer.BACKGROUND, this.gfxProgram.ResourceUniqueId);
        renderInst.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, null);
        renderInst.setBindingLayouts(backdropBindingLayouts);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setMegaStateFlags({ depthCompare: GfxCompareMode.Always, depthWrite: false });

        let offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, 16);
        let mapped = renderInst.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        fillMatrix4x4(mapped, offs, identityMatrix);

        const camera = viewerInput.camera.worldMatrix;
        const pitch = Math.atan2(-camera[9], Math.hypot(camera[8], camera[10]));
        const drawMatrix = mat4.create();
        drawMatrix[13] = -2.5 * Math.sin(pitch);
        offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_DrawParams, 12 + 8 * 2);
        mapped = renderInst.mapUniformBufferF32(F3DEX_Program.ub_DrawParams);
        offs += fillMatrix4x3(mapped, offs, drawMatrix);
        offs += fillMatrix4x2(mapped, offs, identityMatrix);
        fillMatrix4x2(mapped, offs, identityMatrix);

        offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_CombineParams, 8);
        mapped = renderInst.mapUniformBufferF32(F3DEX_Program.ub_CombineParams);
        offs += fillVec4(mapped, offs, 1, 1, 1, 1);
        fillVec4(mapped, offs, 1, 1, 1, 1);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
    }
}

export function createBackdropRenderer(
    device: GfxDevice, cache: GfxRenderCache, backdrop: BackdropData | null, mapID: number,
): BackdropRenderer | null {
    if (backdrop !== null)
        return new PanoramaBackdropRenderer(device, cache, backdrop, mapID);

    const paletteIndex = gradientBackdropPaletteByMap.get(mapID);
    if (paletteIndex === undefined)
        return null;
    return new GradientBackdropRenderer(device, cache, gradientBackdropPalettes[paletteIndex], paletteIndex);
}
