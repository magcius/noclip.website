
import * as Viewer from '../viewer.js';
import * as BYML from '../byml.js';
import * as UI from '../ui.js';

import { GfxDevice, GfxCullMode, GfxProgram, GfxMegaStateDescriptor, makeTextureDescriptor2D, GfxFormat, GfxSampler, GfxTexture, GfxTexFilterMode, GfxMipFilterMode, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxBuffer, GfxInputLayout, GfxBufferUsage, GfxBufferFrequencyHint, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxVertexBufferFrequency, GfxVertexBufferDescriptor, GfxIndexBufferDescriptor } from '../gfx/platform/GfxPlatform.js';
import { SceneContext } from '../SceneBase.js';
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { F3DEX_Program } from '../BanjoKazooie/render.js';
import { nArray, align, assert } from '../util.js';
import { DeviceProgram } from '../Program.js';
import { mat4, vec3 } from 'gl-matrix';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { TextureMapping, FakeTextureHolder } from '../TextureHolder.js';
import { AnimatedTexture, DrawCall, RSP_Geometry, RSPState, runDL_F3DEX2, RSPOutput } from './f3dex2.js';
import { translateBlendMode, translateCullMode } from '../PokemonSnap/f3dex2.js';
import { GfxRendererLayer, GfxRenderInstList, GfxRenderInstManager, makeSortKey } from '../gfx/render/GfxRenderInstManager.js';
import { computeViewMatrixSkybox, computeViewMatrix, CameraController } from '../Camera.js';
import { fillMatrix4x3, fillMatrix4x2, fillVec4, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { translateCM, Texture, OtherModeH_Layout, OtherModeH_CycleType } from '../Common/N64/RDP.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { TextFilt, ImageFormat, ImageSize } from "../Common/N64/Image.js";
import { RSPSharedOutput, Vertex } from '../BanjoKazooie/f3dex.js';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers.js';
import { Vec3UnitY, Vec3Zero } from '../MathHelpers.js';

import ArrayBufferSlice from '../ArrayBufferSlice.js';
import * as Deflate from '../Common/Compression/Deflate.js';
import { calcTextureMatrixFromRSPState } from '../Common/N64/RSP.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { createBufferFromData } from '../gfx/helpers/BufferHelpers.js';

const pathBase = `DonkeyKong64`;

function translateTexture(device: GfxDevice, texture: Texture): GfxTexture {
    const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, 1));
    device.setResourceName(gfxTexture, texture.name);
    device.uploadTextureData(gfxTexture, 0, [texture.pixels]);
    return gfxTexture;
}

function translateSampler(cache: GfxRenderCache, texture: Texture, linear: boolean): GfxSampler {
    return cache.createSampler({
        wrapS: translateCM(texture.tile.cms),
        wrapT: translateCM(texture.tile.cmt),
        minFilter: linear ? GfxTexFilterMode.Bilinear : GfxTexFilterMode.Point,
        magFilter: linear ? GfxTexFilterMode.Bilinear : GfxTexFilterMode.Point,
        mipFilter: GfxMipFilterMode.Nearest,
        minLOD: 0, maxLOD: 0,
    });
}

function initDL(rspState: RSPState, opaque: boolean): void {
    rspState.gSPSetGeometryMode(RSP_Geometry.G_SHADE);
    if (opaque) {
        rspState.gDPSetOtherModeL(0, 29, 0x0C192078); // opaque surfaces
        rspState.gSPSetGeometryMode(RSP_Geometry.G_LIGHTING);
    } else
        rspState.gDPSetOtherModeL(0, 29, 0x005049D8); // translucent surfaces
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTFILT, 2, TextFilt.G_TF_BILERP << OtherModeH_Layout.G_MDSFT_TEXTFILT);
    // initially 2-cycle, though this can change
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    // some objects seem to assume this gets set, might rely on stage rendering first
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 0, 0x100, 5, 0, 0, 0, 0, 0, 0, 0);
}

// D_global_asm_80747D80[4], used by map scene nodes for water. The game
// generates this material display list at runtime, before submitting the
// geometry-only display list stored in the map file.
function initWaterMaterial(rspState: RSPState): void {
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    rspState.gSPClearGeometryMode(0xFFFFFFFF);
    rspState.gSPSetGeometryMode(RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADE | RSP_Geometry.G_SHADING_SMOOTH);
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTLOD, 1, 0);
    rspState.gSPTexture(true, 1, 1, 0xFFFF, 0xFFFF);
    rspState.gDPSetOtherModeL(0, 29, 0x0C184A50);
    rspState.gDPSetCombine(0x00FF9441, 0xFF13FFFF);

    // Handler 4 loads table-7 texture 0x3E0 once, then interprets the same
    // TMEM contents through two independently scrolling IA8 render tiles.
    rspState.gDPSetTextureImage(ImageFormat.G_IM_FMT_IA, ImageSize.G_IM_SIZ_16b, 1, 0x0C000000);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_IA, ImageSize.G_IM_SIZ_16b, 0, 0, 7, 0, 0, 6, 0, 0, 6, 0);
    rspState.gDPLoadBlock(7, 0, 0, 2047, 256);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_IA, ImageSize.G_IM_SIZ_8b, 8, 0, 0, 0, 0, 6, 0, 0, 6, 0);
    rspState.gDPSetTileSize(0, 0, 0, 0x0FC, 0x0FC);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_IA, ImageSize.G_IM_SIZ_8b, 8, 0, 1, 0, 0, 6, 1, 0, 6, 1);
    rspState.gDPSetTileSize(1, 0, 0, 0x0FC, 0x0FC);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_IA, ImageSize.G_IM_SIZ_8b, 8, 0, 2, 0, 0, 6, 1, 0, 6, 1);
    rspState.gDPSetTileSize(2, 0, 0, 0x0FC, 0x0FC);
    rspState.setTextureScrollSpeeds([5, 2]);
}

function initWaterSurfaceMaterial(rspState: RSPState, scrollS: number, scrollT: number): void {
    rspState.gDPSetTextureImage(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_32b, 1, 0x0D000000);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_32b, 0, 0, 7, 0, 0, 5, 14, 0, 5, 14);
    rspState.gDPLoadBlock(7, 0, 0, 1023, 128);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_32b, 8, 0, 0, 0, 0, 5, 14, 0, 5, 14);
    rspState.gDPSetTileSize(0, 0, 0, 0x07C, 0x07C);
    rspState.gDPSetCombine(0x0020FE04, 0xFF13F3FF);
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    rspState.gSPClearGeometryMode(0xFFFFFFFF);
    rspState.gSPSetGeometryMode(RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADE | RSP_Geometry.G_SHADING_SMOOTH);
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTLOD, 1, 0);
    rspState.gSPTexture(true, 1, 1, 0xFFFF, 0xFFFF);
    rspState.gDPSetOtherModeL(0, 29, 0x0C184A50);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_32b, 8, 0, 1, 0, 0, 5, 14, 0, 5, 14);
    rspState.gDPSetTileSize(1, 0, 0, 0x07C, 0x07C);
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_32b, 8, 0, 2, 0, 0, 5, 13, 0, 5, 13);
    rspState.gDPSetTileSize(2, 0, 0, 0x07C, 0x07C);
    rspState.setTextureScrollSpeeds([scrollS, scrollT]);
}

function getSpriteImageFormat(sprite: SpriteData): ImageFormat {
    // func_global_asm_80714778 copies SpriteData::unk6 to the runtime
    // descriptor's unkA. func_global_asm_80715E94 then uses unkA & 7 as
    // G_IM_FMT for every texture command.
    return sprite.flags & 0x07;
}

function getSpriteImageSize(sprite: SpriteData): ImageSize {
    // The four branches in func_global_asm_80715E94 are the N64's four
    // texel sizes in order.
    assert(sprite.codec >= 0 && sprite.codec <= 3);
    return sprite.codec as ImageSize;
}

function initSpriteMaterial(rspState: RSPState, sprite: SpriteData, segment: number, color: readonly number[]): void {
    const fmt = getSpriteImageFormat(sprite);
    const siz = getSpriteImageSize(sprite);
    const bitsPerPixel = 4 << siz;
    const texelCount = sprite.width * sprite.height;
    const loadCount = Math.min(0x07FF, Math.ceil(texelCount * bitsPerPixel / 16) - 1);
    const line = Math.max(1, Math.ceil(sprite.width * bitsPerPixel / 64));
    // G_TX_DXT_FRAC is 11: CALC_DXT rounds 2^11 / words-per-line up.
    // Using 0x07FF here is one short for exact divisors (including both
    // waterfall sprites), which shears the texture as it is loaded to TMEM.
    const dxt = Math.max(1, Math.ceil(0x0800 / line));
    const maskS = Math.ceil(Math.log2(sprite.width));
    const maskT = Math.ceil(Math.log2(sprite.height));

    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_1CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    rspState.gSPClearGeometryMode(0xFFFFFFFF);
    rspState.gSPSetGeometryMode(RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADE | RSP_Geometry.G_SHADING_SMOOTH);
    rspState.gSPTexture(true, 0, 0, 0xFFFF, 0xFFFF);
    rspState.gDPSetOtherModeL(0, 29, 0x005049D8);
    rspState.gDPSetCombine(0x00119623, 0xFF2FFFFF); // G_CC_MODULATEIA_PRIM
    rspState.gSPSetPrimColor(0, color[0], color[1], color[2], color[3]);

    // The game loads through a 16-bit tile for 4/8/16-bit sprites and a
    // 32-bit tile for RGBA32, then renders using the definition's real size.
    const loadSize = siz === ImageSize.G_IM_SIZ_32b ? ImageSize.G_IM_SIZ_32b : ImageSize.G_IM_SIZ_16b;
    rspState.gDPSetTextureImage(fmt, loadSize, 1, segment << 24);
    rspState.gDPSetTile(fmt, loadSize, 0, 0, 7, 0, 0, maskT, 0, 0, maskS, 0);
    rspState.gDPLoadBlock(7, 0, 0, loadCount, dxt);
    rspState.gDPSetTile(fmt, siz, line, 0, 0, 0, 0, maskT, 0, 0, maskS, 0);
    rspState.gDPSetTileSize(0, 0, 0, (sprite.width - 1) << 2, (sprite.height - 1) << 2);
}

function createSpriteVertexBuffer(sprite: SpriteData, quadCount = 1): ArrayBufferSlice {
    const buffer = new ArrayBuffer(quadCount * 4 * 0x10);
    const view = new DataView(buffer);
    const textureCoordinates = [
        0, 0,
        sprite.width << 5, 0,
        sprite.width << 5, sprite.height << 5,
        0, sprite.height << 5,
    ];
    for (let quad = 0; quad < quadCount; quad++) {
        for (let i = 0; i < 4; i++) {
            const offs = (quad * 4 + i) * 0x10;
            view.setInt16(offs + 0x08, textureCoordinates[i * 2]);
            view.setInt16(offs + 0x0A, textureCoordinates[i * 2 + 1]);
            view.setUint8(offs + 0x0C, 0xFF);
            view.setUint8(offs + 0x0D, 0xFF);
            view.setUint8(offs + 0x0E, 0xFF);
            view.setUint8(offs + 0x0F, 0xFF);
        }
    }
    return new ArrayBufferSlice(buffer);
}

function waterSurfaceHeight(surface: WaterSurface, x: number, z: number, tick: number): number {
    const phaseS = tick * surface.phaseSpeedS;
    const phaseT = tick * surface.phaseSpeedT;
    const angleS = (phaseS + Math.trunc(surface.frequencyS * x)) % 0x0FFF;
    const angleT = (phaseT + Math.trunc(surface.frequencyT * z)) % 0x0FFF;
    return surface.baseY
        + Math.sin(angleS * Math.PI * 2 / 0x1000) * surface.amplitudeS
        + Math.sin(angleT * Math.PI * 2 / 0x1000) * surface.amplitudeT;
}

function createWaterSurfaceVertexBuffer(surface: WaterSurface): ArrayBufferSlice {
    const buffer = new ArrayBuffer(surface.columns * surface.rows * 0x10);
    const view = new DataView(buffer);
    let offs = 0;
    for (let row = 0; row < surface.rows; row++) {
        const z = Math.min(surface.minZ + row * surface.step, surface.maxZ);
        for (let column = 0; column < surface.columns; column++) {
            const x = Math.min(surface.minX + column * surface.step, surface.maxX);
            const y = waterSurfaceHeight(surface, x, z, 0);
            const alpha = Math.max(0, Math.min(0xFF, Math.trunc(
                ((y - surface.baseY) / (surface.amplitudeS + surface.amplitudeT))
                * surface.alphaRange + surface.alphaBase,
            )));
            view.setInt16(offs + 0x00, x * 3);
            view.setInt16(offs + 0x02, Math.trunc(y * 3));
            view.setInt16(offs + 0x04, z * 3);
            view.setInt16(offs + 0x08, Math.trunc(x * surface.textureScale) % 0x7FFF);
            view.setInt16(offs + 0x0A, Math.trunc(z * surface.textureScale) % 0x7FFF);
            view.setUint8(offs + 0x0C, surface.colorR);
            view.setUint8(offs + 0x0D, surface.colorG);
            view.setUint8(offs + 0x0E, surface.colorB);
            view.setUint8(offs + 0x0F, alpha);
            offs += 0x10;
        }
    }
    return new ArrayBufferSlice(buffer);
}

const viewMatrixScratch = mat4.create();
const texMatrixScratch = mat4.create();
class DrawCallInstance {
    private textureEntry: Texture[] = [];
    private animatedTextureEntries: Texture[][] = [];
    private animatedTextureMappings: TextureMapping[][] = [];
    private vertexColorsEnabled = true;
    private texturesEnabled = true;
    private monochromeVertexColorsEnabled = false;
    private alphaVisualizerEnabled = false;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private program!: DeviceProgram;
    private gfxProgram: GfxProgram | null = null;
    private textureMappings = nArray(2, () => new TextureMapping());
    private isAnimated = false;
    public visible = true;

    constructor(device: GfxDevice, cache: GfxRenderCache, sharedOutput: RSPSharedOutput, private drawCall: DrawCall) {
        const linearFiltering = ((drawCall.DP_OtherModeH >>> OtherModeH_Layout.G_MDSFT_TEXTFILT) & 0x03) === TextFilt.G_TF_BILERP;
        for (let i = 0; i < this.textureMappings.length; i++) {
            const textureIndex = drawCall.textureIndices[i];
            const tex = sharedOutput.textureCache.textures[textureIndex];

            if (tex) {
                this.textureEntry[i] = tex;
                this.textureMappings[i].gfxTexture = translateTexture(device, tex);
                this.textureMappings[i].gfxSampler = translateSampler(cache, tex, linearFiltering);
            }

            const animationIndices = drawCall.textureAnimationIndices[i];
            if (animationIndices !== undefined && animationIndices.length > 0) {
                this.isAnimated = true;
                this.animatedTextureEntries[i] = animationIndices.map((index) => sharedOutput.textureCache.textures[index]);
                this.animatedTextureMappings[i] = this.animatedTextureEntries[i].map((entry, frame) => {
                    if (frame === 0)
                        return this.textureMappings[i];
                    const mapping = new TextureMapping();
                    mapping.gfxTexture = translateTexture(device, entry);
                    mapping.gfxSampler = translateSampler(cache, entry, linearFiltering);
                    return mapping;
                });
            }
        }

        this.megaStateFlags = translateBlendMode(this.drawCall.SP_GeometryMode, this.drawCall.DP_OtherModeL);
        this.setBackfaceCullingEnabled(true);
        this.createProgram();
    }

    private createProgram(): void {
        const program = new F3DEX_Program(this.drawCall.DP_OtherModeH, this.drawCall.DP_OtherModeL, this.drawCall.DP_Combine);
        program.defines.set('BONE_MATRIX_COUNT', '1');

        if (this.texturesEnabled && this.textureEntry.length)
            program.defines.set('USE_TEXTURE', '1');

        if (!!(this.drawCall.SP_GeometryMode & RSP_Geometry.G_LIGHTING))
            program.defines.set('LIGHTING', '1');

        // FIXME: Levels disable the SHADE flags. wtf?
        const shade = true; // (this.drawCall.SP_GeometryMode & RSP_Geometry.G_SHADING_SMOOTH) !== 0;
        if (this.vertexColorsEnabled && shade)
            program.defines.set('USE_VERTEX_COLOR', '1');

        if (this.drawCall.SP_GeometryMode & RSP_Geometry.G_TEXTURE_GEN)
            program.defines.set('TEXTURE_GEN', '1');

        // many display lists seem to set this flag without setting texture_gen,
        // despite this one being dependent on it
        if (this.drawCall.SP_GeometryMode & RSP_Geometry.G_TEXTURE_GEN_LINEAR)
            program.defines.set('TEXTURE_GEN_LINEAR', '1');

        if (this.monochromeVertexColorsEnabled)
            program.defines.set('USE_MONOCHROME_VERTEX_COLOR', '1');

        if (this.alphaVisualizerEnabled)
            program.defines.set('USE_ALPHA_VISUALIZER', '1');

        this.program = program;
        this.gfxProgram = null;
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        const cullMode = v ? translateCullMode(this.drawCall.SP_GeometryMode) : GfxCullMode.None;
        this.megaStateFlags.cullMode = cullMode;
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.vertexColorsEnabled = v;
        this.createProgram();
    }

    public setTexturesEnabled(v: boolean): void {
        this.texturesEnabled = v;
        this.createProgram();
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        this.monochromeVertexColorsEnabled = v;
        this.createProgram();
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        this.alphaVisualizerEnabled = v;
        this.createProgram();
    }

    private computeTextureMatrix(m: mat4, textureEntryIndex: number, time: number): void {
        if (this.textureEntry[textureEntryIndex] !== undefined) {
            const entry = this.textureEntry[textureEntryIndex];
            calcTextureMatrixFromRSPState(m, this.drawCall.SP_TextureState.s, this.drawCall.SP_TextureState.t, entry.width, entry.height, entry.tile.shifts, entry.tile.shiftt);
            const speed = this.drawCall.textureScrollSpeeds[textureEntryIndex] ?? 0;
            if (speed !== 0) {
                const ticks = Math.floor(time / (1000 / 30));
                if (ticks > 0) {
                    const cycle = (Math.floor(255 / speed) + 1) * speed;
                    const tileOffset = 255 - (((ticks - 1) * speed) % cycle);
                    m[13] -= (tileOffset / 4) / entry.height;
                }
            }
        } else {
            mat4.identity(m);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4, isSkybox: boolean, primAlphaMultiplier = 1): void {
        if (!this.visible)
            return;

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.program);

        for (let i = 0; i < this.animatedTextureMappings.length; i++) {
            const mappings = this.animatedTextureMappings[i];
            if (mappings === undefined)
                continue;
            // DK64 advances these counters once per 30 Hz game tick.
            const frameDuration = Math.max(this.drawCall.textureAnimationFrameDurations[i], 1);
            const frameOffset = this.drawCall.textureAnimationFrameOffsets[i] ?? 0;
            const frame = (Math.floor(viewerInput.time / (1000 / 30) / frameDuration) + frameOffset) % mappings.length;
            this.textureMappings[i] = mappings[frame];
        }

        const renderInst = renderInstManager.newRenderInst();
        if (this.isAnimated)
            renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.setDrawCount(this.drawCall.indexCount, this.drawCall.firstIndex);

        let offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_DrawParams, 12 + 8*2);
        const mappedF32 = renderInst.mapUniformBufferF32(F3DEX_Program.ub_DrawParams);

        if (isSkybox)
            computeViewMatrixSkybox(viewMatrixScratch, viewerInput.camera);
        else
            computeViewMatrix(viewMatrixScratch, viewerInput.camera);
        mat4.mul(viewMatrixScratch, viewMatrixScratch, modelMatrix);

        offs += fillMatrix4x3(mappedF32, offs, viewMatrixScratch); // u_ModelView

        this.computeTextureMatrix(texMatrixScratch, 0, viewerInput.time);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch); // u_TexMatrix[0]

        this.computeTextureMatrix(texMatrixScratch, 1, viewerInput.time);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch); // u_TexMatrix[1]

        offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_CombineParams, 8);
        const comb = renderInst.mapUniformBufferF32(F3DEX_Program.ub_CombineParams);
        const primColor = this.drawCall.DP_PrimColor;
        offs += fillVec4(comb, offs, primColor[0], primColor[1], primColor[2], primColor[3] * primAlphaMultiplier); // primitive color
        const envColor = this.drawCall.DP_EnvColor;
        offs += fillVec4(comb, offs, envColor[0], envColor[1], envColor[2], envColor[3]); // environment color
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.textureMappings.length; i++)
            if (this.animatedTextureMappings[i] === undefined && this.textureMappings[i].gfxTexture !== null)
                device.destroyTexture(this.textureMappings[i].gfxTexture!);
        for (const mappings of this.animatedTextureMappings)
            if (mappings !== undefined)
                for (const mapping of mappings)
                    if (mapping.gfxTexture !== null)
                        device.destroyTexture(mapping.gfxTexture);
    }
}

function makeVertexBufferData(v: Vertex[]): Float32Array {
    const buf = new Float32Array(10 * v.length);
    let j = 0;
    for (let i = 0; i < v.length; i++) {
        buf[j++] = v[i].x;
        buf[j++] = v[i].y;
        buf[j++] = v[i].z;
        buf[j++] = 1.0;

        buf[j++] = v[i].tx;
        buf[j++] = v[i].ty;

        buf[j++] = v[i].c0;
        buf[j++] = v[i].c1;
        buf[j++] = v[i].c2;
        buf[j++] = v[i].a;
    }
    return buf;
}

export class RenderData {
    public vertexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;
    public vertexBufferData: Float32Array;
    public indexBuffer: GfxBuffer;

    constructor(device: GfxDevice, cache: GfxRenderCache, public sharedOutput: RSPSharedOutput, dynamic = false) {
        assert(sharedOutput.vertices.length <= 0xFFFFFFFF);
        this.vertexBufferData = makeVertexBufferData(sharedOutput.vertices);
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, dynamic ? GfxBufferFrequencyHint.Dynamic : GfxBufferFrequencyHint.Static, this.vertexBufferData.buffer);

        const indexBufferData = new Uint32Array(sharedOutput.indices);
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indexBufferData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: F3DEX_Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 0*0x04, },
            { location: F3DEX_Program.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG,   bufferByteOffset: 4*0x04, },
            { location: F3DEX_Program.a_Color   , bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 6*0x04, },
        ];

        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 10*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];

        this.inputLayout = cache.createInputLayout({
            indexBufferFormat: GfxFormat.U32_R,
            vertexBufferDescriptors,
            vertexAttributeDescriptors,
        });

        this.vertexBufferDescriptors = [{ buffer: this.vertexBuffer }];
        this.indexBufferDescriptor = { buffer: this.indexBuffer };
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
    }
}

export interface Mesh {
    sharedOutput: RSPSharedOutput;
    rspState: RSPState;
    rspOutput: RSPOutput | null;
    waterAnimation?: {
        surface: WaterSurface;
        firstVertex: number;
        vertexCount: number;
    };
    spriteBillboards?: {
        firstVertex: number;
        origin: vec3;
        centerX: number;
        centerY: number;
        halfWidth: number;
        halfHeight: number;
        spawnTick?: number;
        lifetime?: number;
        loopTicks?: number;
        velocityY?: number;
        maxDistance?: number;
        fadeStartDistance?: number;
    }[];
}

export class MeshData {
    public renderData: RenderData;
    private lastWaterTick = -1;
    private spritePrimAlphas: number[];

    constructor(device: GfxDevice, cache: GfxRenderCache, public mesh: Mesh) {
        this.renderData = new RenderData(device, cache, mesh.sharedOutput, mesh.waterAnimation !== undefined || mesh.spriteBillboards !== undefined);
        this.spritePrimAlphas = mesh.rspOutput?.drawCalls.map((drawCall) => drawCall.DP_PrimColor[3]) ?? [];
    }

    public update(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const animation = this.mesh.waterAnimation;
        const sprites = this.mesh.spriteBillboards;
        if (animation === undefined && sprites === undefined)
            return;
        const tick = Math.floor(viewerInput.time / (1000 / 30));
        if (tick === this.lastWaterTick)
            return;
        this.lastWaterTick = tick;

        if (animation !== undefined) {
            const surface = animation.surface;
            const amplitude = surface.amplitudeS + surface.amplitudeT;
            for (let i = 0; i < animation.vertexCount; i++) {
                const vertexIndex = animation.firstVertex + i;
                const vertex = this.mesh.sharedOutput.vertices[vertexIndex];
                const y = waterSurfaceHeight(surface, vertex.x / 3, vertex.z / 3, tick);
                const alpha = Math.max(0, Math.min(0xFF, Math.trunc(
                    ((y - surface.baseY) / amplitude) * surface.alphaRange + surface.alphaBase,
                )));
                this.renderData.vertexBufferData[vertexIndex * 10 + 1] = Math.trunc(y * 3);
                this.renderData.vertexBufferData[vertexIndex * 10 + 9] = alpha / 0xFF;
            }
        }

        let spriteFade = 0;
        let hasSpriteFade = false;
        for (const sprite of sprites ?? []) {
            const age = sprite.spawnTick === undefined
                ? 0
                : ((tick - sprite.spawnTick + sprite.loopTicks!) % sprite.loopTicks!);
            const dx = viewerInput.camera.worldMatrix[12] - sprite.origin[0];
            const dy = viewerInput.camera.worldMatrix[13] - sprite.origin[1];
            const dz = viewerInput.camera.worldMatrix[14] - sprite.origin[2];
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const withinDistance = sprite.maxDistance === undefined
                || distance <= sprite.maxDistance;
            const active = withinDistance && (sprite.spawnTick === undefined || age < sprite.lifetime!);
            if (sprite.fadeStartDistance !== undefined) {
                hasSpriteFade = true;
                const fade = distance < sprite.fadeStartDistance
                    ? 1
                    : Math.max(0, Math.min(1, (sprite.maxDistance! - distance) / (sprite.maxDistance! - sprite.fadeStartDistance)));
                if (active)
                    spriteFade = Math.max(spriteFade, fade);
            }
            const rightScale = sprite.centerX;
            const upScale = sprite.centerY;
            const centerX = sprite.origin[0]
                + viewerInput.camera.worldMatrix[0] * rightScale
                + viewerInput.camera.worldMatrix[4] * upScale;
            const centerY = sprite.origin[1] + age * (sprite.velocityY ?? 0)
                + viewerInput.camera.worldMatrix[1] * rightScale
                + viewerInput.camera.worldMatrix[5] * upScale;
            const centerZ = sprite.origin[2]
                + viewerInput.camera.worldMatrix[2] * rightScale
                + viewerInput.camera.worldMatrix[6] * upScale;
            const rightX = viewerInput.camera.worldMatrix[0] * sprite.halfWidth;
            const rightY = viewerInput.camera.worldMatrix[1] * sprite.halfWidth;
            const rightZ = viewerInput.camera.worldMatrix[2] * sprite.halfWidth;
            const upX = viewerInput.camera.worldMatrix[4] * sprite.halfHeight;
            const upY = viewerInput.camera.worldMatrix[5] * sprite.halfHeight;
            const upZ = viewerInput.camera.worldMatrix[6] * sprite.halfHeight;
            const signs = [-1, 1, 1, 1, 1, -1, -1, -1];
            for (let i = 0; i < 4; i++) {
                const vertex = (sprite.firstVertex + i) * 10;
                if (!active) {
                    this.renderData.vertexBufferData[vertex + 0] = sprite.origin[0];
                    this.renderData.vertexBufferData[vertex + 1] = sprite.origin[1];
                    this.renderData.vertexBufferData[vertex + 2] = sprite.origin[2];
                    continue;
                }
                const sx = signs[i * 2], sy = signs[i * 2 + 1];
                this.renderData.vertexBufferData[vertex + 0] = centerX + rightX * sx + upX * sy;
                this.renderData.vertexBufferData[vertex + 1] = centerY + rightY * sx + upY * sy;
                this.renderData.vertexBufferData[vertex + 2] = centerZ + rightZ * sx + upZ * sy;
            }
        }
        if (hasSpriteFade) {
            for (let i = 0; i < this.spritePrimAlphas.length; i++)
                this.mesh.rspOutput!.drawCalls[i].DP_PrimColor[3] = this.spritePrimAlphas[i] * spriteFade;
        }

        device.uploadBufferData(this.renderData.vertexBuffer, 0, new Uint8Array(this.renderData.vertexBufferData.buffer));
    }

    public destroy(device: GfxDevice): void {
        this.renderData.destroy(device);
    }
}

class MeshRenderer {
    public drawCallInstances: DrawCallInstance[] = [];

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4, isSkybox: boolean, primAlphaMultiplier = 1): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].prepareToRender(device, renderInstManager, viewerInput, modelMatrix, isSkybox, primAlphaMultiplier);
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setBackfaceCullingEnabled(v);
    }

    public setVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setTexturesEnabled(v);
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setMonochromeVertexColorsEnabled(v);
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setAlphaVisualizerEnabled(v);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].destroy(device);
    }
}

const lookatScratch = vec3.create();
const modelViewScratch = mat4.create();
export class RootMeshRenderer {
    private visible = true;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    public isSkybox = false;
    public sortKeyBase = makeSortKey(GfxRendererLayer.OPAQUE);
    public modelMatrix = mat4.create();
    public distanceFade: { origin: vec3; startDistance: number; endDistance: number } | null = null;

    public objectFlags = 0;
    private rootNodeRenderer: MeshRenderer;

    constructor(device: GfxDevice, cache: GfxRenderCache, private geometryData: MeshData) {
        this.megaStateFlags = {};
        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });

        const geo = this.geometryData.mesh;

        // Traverse the node tree.
        this.rootNodeRenderer = this.buildGeoNodeRenderer(device, cache, geo);
    }

    private buildGeoNodeRenderer(device: GfxDevice, cache: GfxRenderCache, node: Mesh): MeshRenderer {
        const geoNodeRenderer = new MeshRenderer();

        if (node.rspOutput !== null) {
            for (let i = 0; i < node.rspOutput.drawCalls.length; i++) {
                const drawCallInstance = new DrawCallInstance(device, cache, node.sharedOutput, node.rspOutput.drawCalls[i]);
                geoNodeRenderer.drawCallInstances.push(drawCallInstance);
            }
        }

        return geoNodeRenderer;
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        this.rootNodeRenderer.setBackfaceCullingEnabled(v);
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.rootNodeRenderer.setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        this.rootNodeRenderer.setTexturesEnabled(v);
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        this.rootNodeRenderer.setMonochromeVertexColorsEnabled(v);
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        this.rootNodeRenderer.setAlphaVisualizerEnabled(v);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        let primAlphaMultiplier = 1;
        if (this.distanceFade !== null) {
            const camera = viewerInput.camera.worldMatrix;
            const dx = camera[12] - this.distanceFade.origin[0];
            const dy = camera[13] - this.distanceFade.origin[1];
            const dz = camera[14] - this.distanceFade.origin[2];
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (distance >= this.distanceFade.endDistance)
                return;
            if (distance > this.distanceFade.startDistance) {
                primAlphaMultiplier = (this.distanceFade.endDistance - distance)
                    / (this.distanceFade.endDistance - this.distanceFade.startDistance);
            }
        }

        this.geometryData.update(device, viewerInput);
        const renderData = this.geometryData.renderData;

        const template = renderInstManager.pushTemplate();
        template.setBindingLayouts(bindingLayouts);
        template.setVertexInput(renderData.inputLayout, renderData.vertexBufferDescriptors, renderData.indexBufferDescriptor);
        template.setMegaStateFlags(this.megaStateFlags);

        template.sortKey = this.sortKeyBase;

        const computeLookAt = false; // FIXME: or true?
        const sceneParamsSize = 16 + (computeLookAt ? 8 : 0);

        let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, sceneParamsSize);
        const mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);

        if (computeLookAt) {
            // compute lookat X and Y in view space, since that's the transform the shader will have
            mat4.getTranslation(lookatScratch, this.modelMatrix);
            vec3.transformMat4(lookatScratch, lookatScratch, viewerInput.camera.viewMatrix);

            mat4.lookAt(modelViewScratch, Vec3Zero, lookatScratch, Vec3UnitY);
            offs += fillVec4(mappedF32, offs, modelViewScratch[0], modelViewScratch[4], modelViewScratch[8]);
            offs += fillVec4(mappedF32, offs, modelViewScratch[1], modelViewScratch[5], modelViewScratch[9]);
        }

        this.rootNodeRenderer.prepareToRender(device, renderInstManager, viewerInput, this.modelMatrix, this.isSkybox, primAlphaMultiplier);

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        this.rootNodeRenderer.destroy(device);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 2, },
];

class DK64Renderer implements Viewer.SceneGfx {
    public renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();

    public meshDatas: MeshData[] = [];
    public meshRenderers: RootMeshRenderer[] = [];

    public textureHolder = new FakeTextureHolder([]);

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(30/60);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');

        const enableCullingCheckbox = new UI.Checkbox('Enable Culling', true);
        enableCullingCheckbox.onchanged = () => {
            for (const meshRenderer of this.meshRenderers)
                meshRenderer.setBackfaceCullingEnabled(enableCullingCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableCullingCheckbox.elem);

        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (const meshRenderer of this.meshRenderers)
                meshRenderer.setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);

        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (const meshRenderer of this.meshRenderers)
                meshRenderer.setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        const enableMonochromeVertexColors = new UI.Checkbox('Grayscale Vertex Colors', false);
        enableMonochromeVertexColors.onchanged = () => {
            for (const meshRenderer of this.meshRenderers)
                meshRenderer.setMonochromeVertexColorsEnabled(enableMonochromeVertexColors.checked);
        };
        renderHacksPanel.contents.appendChild(enableMonochromeVertexColors.elem);

        const enableAlphaVisualizer = new UI.Checkbox('Visualize Vertex Alpha', false);
        enableAlphaVisualizer.onchanged = () => {
            for (const meshRenderer of this.meshRenderers)
                meshRenderer.setAlphaVisualizerEnabled(enableAlphaVisualizer.checked);
        };
        renderHacksPanel.contents.appendChild(enableAlphaVisualizer.elem);

        return [renderHacksPanel];
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);

        for (let i = 0; i < this.meshRenderers.length; i++)
            this.meshRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);

        this.renderHelper.renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        builder.execute();
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        for (let i = 0; i < this.meshRenderers.length; i++)
            this.meshRenderers[i].destroy(device);
        for (let i = 0; i < this.meshDatas.length; i++)
            this.meshDatas[i].destroy(device);
    }
}

export class DisplayListInfo {
    public ChunkID: number;
    public dlStartAddr: number;
    public VertStartIndex: number;
    public textureAnimationGroup: number | null;
    public materialIndex: number | null;
}

interface WaterSurface {
    textureScale: number;
    frequencyS: number;
    frequencyT: number;
    amplitudeS: number;
    amplitudeT: number;
    phaseSpeedS: number;
    phaseSpeedT: number;
    scrollSpeedS: number;
    scrollSpeedT: number;
    step: number;
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
    baseY: number;
    colorR: number;
    colorG: number;
    colorB: number;
    alphaBase: number;
    alphaRange: number;
    materialIndex: number;
    columns: number;
    rows: number;
}

export class MapChunk {
    public x: number
    public y: number
    public z: number

    public dlOffsets: number[] = [];
    public dlSizes: number[] = [];
    public vertOffset: number;
    public vertSize: number;

    static readonly size = 0x34;

    constructor(bin: ArrayBufferSlice, public id: number) {
        let view = bin.createDataView();
        this.x = view.getInt32(0x00);
        this.y = view.getInt32(0x04);

        let dlTableIdx = 0x0C;
        for (let i = 0; i < 4; i++) {
            this.dlOffsets[i] = view.getInt32(dlTableIdx + 0x00);
            this.dlSizes[i] = view.getUint32(dlTableIdx + 0x04);
            dlTableIdx += 0x08;
        }

        this.vertOffset = view.getInt32(0x2C);
        this.vertSize = view.getUint32(0x30);
    }
}

export class MapSection {
    public meshID: number;
    public textureAnimationGroup: number;
    public vertOffsets: number[] = [];

    static readonly size = 0x1C;

    constructor(bin: ArrayBufferSlice) {
        let view = bin.createDataView();
        this.textureAnimationGroup = view.getUint16(0x00, false);
        this.meshID = view.getUint16(0x02, false);
        for (let i = 0; i < 8; i++)
            this.vertOffsets[i] = view.getUint16(0x08 + i*0x02);
    }
}

export class Map {
    public bin: ArrayBufferSlice;
    public vertBin: ArrayBufferSlice;
    public f3dexBin: ArrayBufferSlice;
    public chunkCount: number;
    public chunks: MapChunk[] = [];
    public sections: MapSection[] = [];
    public displayLists: DisplayListInfo[] = [];
    public animatedTextures: AnimatedTexture[] = [];
    public waterSurfaces: WaterSurface[] = [];
    public effectPointSets: vec3[][] = [];

    // headerInfo
    private dlStart: number;
    private vertStart: number;
    private vertEnd: number;
    private sectionStart: number;
    private sectionEnd: number;
    private chunkCountOffset: number;
    private chunkStart: number;

    constructor(buffer: ArrayBufferSlice, animTexData: ArrayBufferSlice[]) {
        this.bin = buffer;

        const view = this.bin.createDataView();
        this.dlStart = view.getUint32(0x34, false);
        this.vertStart = view.getUint32(0x38, false);
        this.vertEnd = view.getUint32(0x40, false);
        this.sectionStart = view.getUint32(0x58, false);
        this.sectionEnd = view.getUint32(0x5C, false);
        this.chunkCountOffset = view.getUint32(0x64, false);
        this.chunkStart = view.getUint32(0x68, false);

        // MapGeometryHeader::unk40 is the point-set table used by generic
        // prop-script effects (D_global_asm_807F5FD4 in the game). Its first
        // word is the highest set index, followed by relative start pointers
        // and one sentinel end pointer.
        const effectPointStart = view.getUint32(0x40, false);
        const effectPointSetMax = view.getInt32(effectPointStart, false);
        const effectPointSetCount = effectPointSetMax + 1;
        for (let set = 0; set < effectPointSetCount; set++) {
            const start = effectPointStart + view.getUint32(effectPointStart + 4 + set * 4, false);
            const end = effectPointStart + view.getUint32(effectPointStart + 8 + set * 4, false);
            const points: vec3[] = [];
            for (let offs = start; offs + 12 <= end; offs += 12) {
                points.push(vec3.fromValues(
                    view.getFloat32(offs + 0, false),
                    view.getFloat32(offs + 4, false),
                    view.getFloat32(offs + 8, false),
                ));
            }
            this.effectPointSets.push(points);
        }

        const animatedTextureStart = view.getUint32(0x48, false);
        const animatedTextureCount = view.getUint32(animatedTextureStart, false);
        for (let i = 0; i < animatedTextureCount; i++) {
            const offs = animatedTextureStart + 0x04 + i * 0x7C;
            const frameCount = view.getUint8(offs + 0x03);
            const frames: ArrayBufferSlice[] = [];
            for (let j = 0; j < frameCount; j++) {
                const textureIndex = view.getUint32(offs + 0x0C + j * 0x04, false);
                const frame = animTexData[textureIndex];
                if (frame !== undefined)
                    frames.push(frame);
            }
            if (frames.length === 0)
                continue;
            this.animatedTextures.push({
                segment: view.getUint8(offs + 0x00),
                group: view.getUint8(offs + 0x01),
                frameDuration: view.getUint8(offs + 0x02),
                frames,
            });
        }

        const waterSurfaceStart = view.getUint32(0x4C, false);
        const waterSurfaceCount = view.getUint32(waterSurfaceStart, false);
        for (let i = 0; i < waterSurfaceCount; i++) {
            const offs = waterSurfaceStart + 0x04 + i * 0x6C;
            const step = view.getInt16(offs + 0x44, false);
            const minX = view.getInt16(offs + 0x46, false);
            const minZ = view.getInt16(offs + 0x48, false);
            const maxX = view.getInt16(offs + 0x4A, false);
            const maxZ = view.getInt16(offs + 0x4C, false);
            const materialIndex = view.getUint8(offs + 0x66);
            // Material zero is the two-layer, sine-deformed water surface.
            // Other entries in this table drive different generated effects.
            if (materialIndex !== 0)
                continue;
            this.waterSurfaces.push({
                textureScale: view.getFloat32(offs + 0x00, false),
                frequencyS: view.getFloat32(offs + 0x04, false),
                frequencyT: view.getFloat32(offs + 0x08, false),
                amplitudeS: view.getFloat32(offs + 0x0C, false),
                amplitudeT: view.getFloat32(offs + 0x10, false),
                phaseSpeedS: view.getInt32(offs + 0x14, false),
                phaseSpeedT: view.getInt32(offs + 0x18, false),
                scrollSpeedS: view.getFloat32(offs + 0x34, false),
                scrollSpeedT: view.getFloat32(offs + 0x38, false),
                step,
                minX,
                minZ,
                maxX,
                maxZ,
                baseY: view.getInt16(offs + 0x4E, false),
                colorR: view.getUint8(offs + 0x61),
                colorG: view.getUint8(offs + 0x62),
                colorB: view.getUint8(offs + 0x63),
                alphaBase: view.getUint8(offs + 0x64),
                alphaRange: view.getUint8(offs + 0x65),
                materialIndex,
                columns: Math.trunc((maxX - minX) / step) + 2,
                rows: Math.trunc((maxZ - minZ) / step) + 2,
            });
        }

        this.f3dexBin = this.bin.slice(this.dlStart, this.vertStart);
        this.vertBin = this.bin.slice(this.vertStart, this.vertEnd);

        this.chunkCount = view.getUint32(this.chunkCountOffset, false);

        if (this.chunkCount > 0) {
            for (let i = 0; i < this.chunkCount; i++) {
                const chunkBuffer = this.bin.subarray(this.chunkStart + MapChunk.size * i, MapChunk.size);
                this.chunks[i] = new MapChunk(chunkBuffer, i);
            }
        }

        for (let i = 0; (i * MapSection.size) < (this.sectionEnd - this.sectionStart); i++) {
            const sectionBuffer = this.bin.subarray(this.sectionStart + i * MapSection.size + 4, MapSection.size);
            this.sections[i] = new MapSection(sectionBuffer);
        }

        console.log(`${this.chunkCount} CHUNKS PARSED FOR MAP`);

        if (this.chunkCount > 0) {
            this.chunks.forEach(chunk => {
                for (let iDL = 0; iDL < 4; iDL++) {
                    if (chunk.dlOffsets[iDL] !== -1 && chunk.dlSizes[iDL] !== 0){
                        let snoopPresent = false;
                        let currf3dexCnt = chunk.dlSizes[iDL];
                        let currf3dexOffset = this.dlStart + chunk.dlOffsets[iDL];
                        do {
                            let command = view.getUint8(currf3dexOffset);

                            // Load vertex segment buffer?
                            if (command === 0x00) {
                                snoopPresent = true;
                                const sectionID = view.getUint32(currf3dexOffset + 0x04, false);
                                const currSection = this.sections.find((section) => section.meshID === sectionID);

                                if (currSection !== undefined) {
                                    this.displayLists.push({
                                        ChunkID: chunk.id,
                                        dlStartAddr: currf3dexOffset - this.dlStart,
                                        VertStartIndex: (chunk.vertOffset/0x10 + currSection.vertOffsets[iDL]),
                                        textureAnimationGroup: currSection.textureAnimationGroup,
                                        materialIndex: null,
                                    });
                                }
                            }

                            currf3dexOffset = currf3dexOffset + 8;
                            currf3dexCnt = currf3dexCnt - 8;
                        } while (currf3dexCnt > 0);

                        if (!snoopPresent) {
                            // More than 5 segments to chunk
                            // Include Start as DL
                            this.displayLists.push({
                                ChunkID: chunk.id,
                                dlStartAddr: chunk.dlOffsets[iDL],
                                VertStartIndex: chunk.vertOffset/0x10,
                                textureAnimationGroup: null,
                                materialIndex: null,
                            });
                        }
                    }
                }
            });
        } else {
            this.displayLists.push({
                ChunkID: 0,
                dlStartAddr: 0,
                VertStartIndex: 0,
                textureAnimationGroup: null,
                materialIndex: null,
            });
        }

        // Scene nodes can reference geometry-only display lists which the game
        // surrounds with one of eight runtime-generated material handlers.
        // These lists are independent of the normal map chunk table.
        const rootNode = view.getUint32(0x30, false);
        const specialDisplayListCount = view.getUint8(rootNode + 0xC5);
        for (let i = 0; i < specialDisplayListCount; i++) {
            const dlStartAddr = view.getInt32(rootNode + 0x1C + i * 0x04, false);
            if (dlStartAddr < 0)
                continue;
            const materialIndex = view.getUint16(rootNode + 0x70 + i * 0x02, false);
            // The remaining runtime handlers need their own exact RDP setup.
            if (materialIndex !== 4)
                continue;
            this.displayLists.push({
                ChunkID: -1,
                dlStartAddr,
                VertStartIndex: 0,
                textureAnimationGroup: null,
                materialIndex,
            });
        }

        console.log(`${this.displayLists.length} DISPLAY LISTS FOUND IN MAP MODEL`);
    }
}

function decompress(buffer: ArrayBufferSlice): ArrayBufferSlice {
    const view = buffer.createDataView();
    assert(view.getUint32(0x00) === 0x1F8B0800);
    const decompressed = Deflate.decompress_raw(buffer.slice(0x0A));
    return decompressed;
}

interface SpriteData {
    address: number;
    id: number;
    imagesPerFrameHorizontal: number;
    imagesPerFrameVertical: number;
    flags: number;
    codec: number;
    params: number[];
    table: number;
    width: number;
    height: number;
    images: number[];
}

interface EnvironmentParticleData {
    map: number;
    start: [number, number, number];
    end: [number, number, number];
    gap: number;
    distance: number;
    baseScale: number;
    risingScale: number;
}

interface SetupProp {
    id: number;
    type: number;
    position: vec3;
    scale: number;
    rotation: vec3;
}

interface TerrainTriangle {
    vertices: [vec3, vec3, vec3];
    normal: vec3;
}

interface TerrainSurface {
    y: number;
    normal: vec3;
}

function buildTerrainTriangles(sharedOutput: RSPSharedOutput): TerrainTriangle[] {
    const triangles: TerrainTriangle[] = [];
    const indices = sharedOutput.indices;
    const vertices = sharedOutput.vertices;
    for (let i = 0; i + 2 < indices.length; i += 3) {
        const va = vertices[indices[i]];
        const vb = vertices[indices[i + 1]];
        const vc = vertices[indices[i + 2]];
        const a = vec3.fromValues(va.x, va.y, va.z);
        const b = vec3.fromValues(vb.x, vb.y, vb.z);
        const c = vec3.fromValues(vc.x, vc.y, vc.z);
        const ab = vec3.subtract(vec3.create(), b, a);
        const ac = vec3.subtract(vec3.create(), c, a);
        const normal = vec3.cross(vec3.create(), ab, ac);
        if (vec3.squaredLength(normal) < 0.0001 || Math.abs(normal[1]) < 0.0001)
            continue;
        vec3.normalize(normal, normal);
        if (normal[1] < 0)
            vec3.negate(normal, normal);
        triangles.push({ vertices: [a, b, c], normal });
    }
    return triangles;
}

function findTerrainSurface(triangles: TerrainTriangle[], x: number, z: number, rayStartY: number): TerrainSurface | null {
    let result: TerrainSurface | null = null;
    for (const triangle of triangles) {
        const [a, b, c] = triangle.vertices;
        const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        if (Math.abs(denominator) < 0.0001)
            continue;
        const wa = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / denominator;
        const wb = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / denominator;
        const wc = 1 - wa - wb;
        if (wa < -0.0001 || wb < -0.0001 || wc < -0.0001)
            continue;
        const y = wa * a[1] + wb * b[1] + wc * c[1];
        if (y > rayStartY || (result !== null && y <= result.y))
            continue;
        result = { y, normal: triangle.normal };
    }
    return result;
}

interface ScriptCommand {
    opcode: number;
    args: [number, number, number];
}

interface ScriptBlock {
    conditions: ScriptCommand[];
    executions: ScriptCommand[];
}

interface InstanceScript {
    id: number;
    behavior: number;
    blocks: ScriptBlock[];
}

function parseSetupProps(data: ArrayBufferSlice): SetupProp[] {
    const view = data.createDataView();
    const count = view.getUint32(0, false);
    const props: SetupProp[] = [];
    for (let i = 0; i < count; i++) {
        const offs = 4 + i * 0x30;
        props.push({
            id: view.getUint16(offs + 0x2A, false),
            type: view.getUint16(offs + 0x28, false),
            position: vec3.fromValues(
                view.getFloat32(offs + 0x00, false),
                view.getFloat32(offs + 0x04, false),
                view.getFloat32(offs + 0x08, false),
            ),
            scale: view.getFloat32(offs + 0x0C, false),
            rotation: vec3.fromValues(
                view.getFloat32(offs + 0x18, false),
                view.getFloat32(offs + 0x1C, false),
                view.getFloat32(offs + 0x20, false),
            ),
        });
    }
    return props;
}

function parseScriptCommand(view: DataView, offs: number): ScriptCommand {
    return {
        opcode: view.getUint16(offs, false),
        args: [
            view.getInt16(offs + 2, false),
            view.getInt16(offs + 4, false),
            view.getInt16(offs + 6, false),
        ],
    };
}

function parseInstanceScripts(data: ArrayBufferSlice): InstanceScript[] {
    const view = data.createDataView();
    const count = view.getUint16(0, false);
    const scripts: InstanceScript[] = [];
    let offs = 2;
    for (let scriptIndex = 0; scriptIndex < count; scriptIndex++) {
        const id = view.getUint16(offs, false);
        const blockCount = view.getUint16(offs + 2, false);
        const behavior = view.getUint16(offs + 4, false);
        offs += 6;
        const blocks: ScriptBlock[] = [];
        for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
            const conditionCount = view.getUint16(offs, false);
            offs += 2;
            const conditions: ScriptCommand[] = [];
            for (let i = 0; i < conditionCount; i++, offs += 8)
                conditions.push(parseScriptCommand(view, offs));
            const executionCount = view.getUint16(offs, false);
            offs += 2;
            const executions: ScriptCommand[] = [];
            for (let i = 0; i < executionCount; i++, offs += 8)
                executions.push(parseScriptCommand(view, offs));
            blocks.push({ conditions, executions });
        }
        scripts.push({ id, behavior, blocks });
    }
    return scripts;
}

class ROMData {
    public MapData: (ArrayBufferSlice | number)[];
    public PropGeometryData: (ArrayBufferSlice | number)[];
    public SetupData: (ArrayBufferSlice | number)[];
    public ScriptData: (ArrayBufferSlice | number)[];
    public CritterData: (ArrayBufferSlice | number)[];
    public SpriteData: SpriteData[];
    public CustomScriptFunctionData: number[];
    public EnvironmentParticleData: EnvironmentParticleData[];
    public TexData: ArrayBufferSlice[];
    public AnimTexData: ArrayBufferSlice[];

    constructor(buffer: ArrayBufferSlice) {
        const obj: any = BYML.parse(buffer, BYML.FileType.CRG1);

        this.MapData = obj.MapData;
        this.PropGeometryData = obj.PropGeometryData ?? [];
        this.SetupData = obj.SetupData ?? [];
        this.ScriptData = obj.ScriptData ?? [];
        this.CritterData = obj.CritterData ?? [];
        this.SpriteData = obj.SpriteData ?? [];
        this.CustomScriptFunctionData = obj.CustomScriptFunctionData ?? [];
        this.EnvironmentParticleData = obj.EnvironmentParticleData ?? [];
        this.TexData = obj.TexData.map((buffer: ArrayBufferSlice) => decompress(buffer));
        if (obj.AnimTexData === undefined)
            throw new Error('DK64 archive is missing animated textures; rerun npm run build:DonkeyKong64');
        this.AnimTexData = obj.AnimTexData;
    }

    private loadMapTableEntry(table: (ArrayBufferSlice | number)[], mapID: number): ArrayBufferSlice {
        let entry = table[mapID];
        const visited = new Set<number>();
        while (typeof entry === 'number') {
            assert(!visited.has(entry));
            visited.add(entry);
            entry = table[entry];
        }
        assert(entry !== undefined);
        return decompress(entry);
    }

    public loadSetup(mapID: number): ArrayBufferSlice {
        return this.loadMapTableEntry(this.SetupData, mapID);
    }

    public loadPropGeometry(propType: number): ArrayBufferSlice {
        return this.loadMapTableEntry(this.PropGeometryData, propType);
    }

    public loadScripts(mapID: number): ArrayBufferSlice {
        return this.loadMapTableEntry(this.ScriptData, mapID);
    }

    public destroy(device: GfxDevice): void {
    }
}

function findHighDetailPropDisplayList(view: DataView, mainDisplayListStart: number): number {
    let half1 = -1;
    for (let offs = mainDisplayListStart; offs < Math.min(view.byteLength, mainDisplayListStart + 0x80); offs += 8) {
        const w0 = view.getUint32(offs, false);
        const w1 = view.getUint32(offs + 4, false);
        const opcode = w0 >>> 24;
        if (opcode === 0xE1)
            half1 = w1;
        else if (opcode === 0x04 && (half1 >>> 24) === 0x0A)
            return half1 & 0x00FFFFFF;
        else if (opcode === 0xDF)
            break;
    }
    return 0;
}

function propDisplayListUsesMatrices(view: DataView, start: number, end: number): boolean {
    for (let offs = start; offs + 8 <= Math.min(view.byteLength, end); offs += 8) {
        if (view.getUint8(offs) === 0xDA)
            return true;
    }
    return false;
}

function createPropDecalVertexBuffer(halfWidth: number, halfHeight: number, textureWidth: number, textureHeight: number): ArrayBufferSlice {
    const buffer = new ArrayBuffer(4 * 0x10);
    const view = new DataView(buffer);
    const positions = [
        -halfWidth, 0, -halfHeight,
         halfWidth, 0, -halfHeight,
         halfWidth, 0,  halfHeight,
        -halfWidth, 0,  halfHeight,
    ];
    const textureCoordinates = [
        0, 0,
        textureWidth << 5, 0,
        textureWidth << 5, textureHeight << 5,
        0, textureHeight << 5,
    ];
    for (let i = 0; i < 4; i++) {
        const offs = i * 0x10;
        view.setInt16(offs + 0x00, positions[i * 3]);
        view.setInt16(offs + 0x02, positions[i * 3 + 1]);
        view.setInt16(offs + 0x04, positions[i * 3 + 2]);
        view.setInt16(offs + 0x08, textureCoordinates[i * 2]);
        view.setInt16(offs + 0x0A, textureCoordinates[i * 2 + 1]);
        view.setUint8(offs + 0x0C, 0xFF);
        view.setUint8(offs + 0x0D, 0xFF);
        view.setUint8(offs + 0x0E, 0xFF);
        view.setUint8(offs + 0x0F, 0xFF);
    }
    return new ArrayBufferSlice(buffer);
}

function parseModel2IndexedTextures(geometryView: DataView, romData: ROMData): AnimatedTexture[] {
    // func_global_asm_806349FC registers the target G_SETTIMG IDs from this
    // descriptor list. func_global_asm_80636EFC then deliberately leaves
    // those IDs unresolved while loading every other model texture from table
    // 25; func_global_asm_80639CD0 supplies the selected frames from table 7.
    const descriptorStart = geometryView.getUint32(0x6C, false);
    if (descriptorStart + 4 > geometryView.byteLength)
        return [];
    const descriptorCount = geometryView.getUint32(descriptorStart, false);
    const textures: AnimatedTexture[] = [];
    for (let i = 0; i < descriptorCount; i++) {
        const offs = descriptorStart + 4 + i * 0x84;
        if (offs + 0x84 > geometryView.byteLength)
            break;
        const targetTextureID = geometryView.getUint32(offs + 0x00, false);
        const crossfade = geometryView.getUint32(offs + 0x04, false);
        const frameDuration = geometryView.getUint32(offs + 0x08, false);
        const frameCount = geometryView.getUint32(offs + 0x0C, false);
        if (frameCount === 0 || frameCount > 0x1E)
            continue;
        const frames: ArrayBufferSlice[] = [];
        for (let frame = 0; frame < frameCount; frame++) {
            const textureID = frame === 0
                ? targetTextureID
                : geometryView.getUint32(offs + 0x0C + frame * 4, false);
            const texture = romData.AnimTexData[textureID];
            if (texture === undefined)
                break;
            frames.push(texture);
        }
        if (frames.length !== frameCount)
            continue;
        // func_global_asm_806349FC initializes playback mode to 1, which
        // advances these frames automatically. Descriptor +0x04 is instead
        // unk4A: whether 80639CD0 supplies two adjacent frames for a blend.
        // TODO: interpolate adjacent frames for crossfade-enabled descriptors.
        void crossfade;
        textures.push({
            segment: 0,
            group: targetTextureID,
            frameDuration,
            frames,
        });
    }
    return textures;
}

function addModel2PropDecals(device: GfxDevice, cache: GfxRenderCache, sceneRenderer: DK64Renderer, sharedOutput: RSPSharedOutput, romData: ROMData, geometryView: DataView, instances: SetupProp[], terrainTriangles: TerrainTriangle[]): void {
    const textureID = geometryView.getUint16(0x28, false);
    if (textureID === 0xFFFF)
        return;

    const halfWidth = geometryView.getInt16(0x2E, false);
    const halfHeight = geometryView.getInt16(0x30, false);
    const textureWidth = geometryView.getUint8(0x32) || 0x100;
    const textureHeight = geometryView.getUint8(0x33) || 0x100;
    const format = geometryView.getUint8(0x34) & 0x07;
    const size = geometryView.getUint8(0x35);
    const alpha = geometryView.getUint8(0x38);
    const fadeStartDistance = geometryView.getUint8(0x36) * 10 * 3;
    const fadeEndDistance = geometryView.getUint8(0x37) * 10 * 3;
    if (halfWidth <= 0 || halfHeight <= 0 || size > ImageSize.G_IM_SIZ_32b || romData.TexData[textureID] === undefined)
        return;

    const bitsPerPixel = 4 << size;
    const loadCount = Math.min(0x07FF, Math.ceil(textureWidth * textureHeight * bitsPerPixel / 16) - 1);
    const line = Math.max(1, Math.ceil(textureWidth * bitsPerPixel / 64));
    const dxt = Math.max(1, Math.ceil(0x0800 / line));
    const maskS = Math.ceil(Math.log2(textureWidth));
    const maskT = Math.ceil(Math.log2(textureHeight));
    const segmentBuffers: ArrayBufferSlice[] = [];
    segmentBuffers[0x08] = createPropDecalVertexBuffer(halfWidth, halfHeight, textureWidth, textureHeight);
    const decalTexture: AnimatedTexture[] = [{
        segment: 0x0E,
        group: textureID,
        frameDuration: 0,
        frames: [romData.TexData[textureID]],
    }];
    const state = new RSPState(romData.TexData, segmentBuffers, sharedOutput, decalTexture);
    initDL(state, false);
    state.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_1CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    state.gSPClearGeometryMode(0xFFFFFFFF);
    state.gSPSetGeometryMode(RSP_Geometry.G_ZBUFFER | RSP_Geometry.G_SHADE | RSP_Geometry.G_SHADING_SMOOTH);
    state.gSPTexture(true, 0, 0, 0xFFFF, 0xFFFF);
    state.gDPSetOtherModeL(0, 29, 0x00504DD8);
    state.gDPSetCombine(0x00119623, 0xFF2FFFFF);
    state.gSPSetPrimColor(0, 0x00, 0x00, 0x00, alpha);
    const loadSize = size === ImageSize.G_IM_SIZ_32b ? ImageSize.G_IM_SIZ_32b : ImageSize.G_IM_SIZ_16b;
    state.gDPSetTextureImage(format, loadSize, 1, 0x0E000000);
    state.gDPSetTile(format, loadSize, 0, 0, 7, 0, 0, maskT, 0, 0, maskS, 0);
    state.gDPLoadBlock(7, 0, 0, loadCount, dxt);
    state.gDPSetTile(format, size, line, 0, 0, 0, 0, maskT, 0, 0, maskS, 0);
    state.gDPSetTileSize(0, 0, 0, (textureWidth - 1) << 2, (textureHeight - 1) << 2);
    state.gSPVertex(0x08000000, 4, 0);
    state.gSPTri(0, 1, 2);
    state.gSPTri(0, 2, 3);
    const output = state.finish();
    if (output === null)
        return;

    const mesh: Mesh = { sharedOutput, rspState: state, rspOutput: output };
    const meshData = new MeshData(device, cache, mesh);
    sceneRenderer.meshDatas.push(meshData);
    for (const prop of instances) {
        const renderer = new RootMeshRenderer(device, cache, meshData);
        const worldX = prop.position[0] * 3;
        const worldY = prop.position[1] * 3;
        const worldZ = prop.position[2] * 3;
        // func_global_asm_80632FCC performs the same floor query with a ray
        // beginning 20 game units above the prop, then 8063A968 rotates the
        // generated quad to the returned ground angles. ZMODE_DEC supplies
        // polygon offset, so the decal can remain coplanar with the floor.
        const surface = findTerrainSurface(terrainTriangles, worldX, worldZ, worldY + 20 * 3);
        const normal = surface?.normal ?? Vec3UnitY;
        const yaw = prop.rotation[1] * Math.PI / 180;
        const tangentZ = vec3.fromValues(Math.sin(yaw), 0, Math.cos(yaw));
        vec3.scaleAndAdd(tangentZ, tangentZ, normal, -vec3.dot(tangentZ, normal));
        if (vec3.squaredLength(tangentZ) < 0.0001)
            vec3.set(tangentZ, Math.cos(yaw), 0, -Math.sin(yaw));
        vec3.normalize(tangentZ, tangentZ);
        const tangentX = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), normal, tangentZ));
        const modelMatrix = renderer.modelMatrix;
        modelMatrix[0] = tangentX[0];
        modelMatrix[1] = tangentX[1];
        modelMatrix[2] = tangentX[2];
        modelMatrix[4] = normal[0];
        modelMatrix[5] = normal[1];
        modelMatrix[6] = normal[2];
        modelMatrix[8] = tangentZ[0];
        modelMatrix[9] = tangentZ[1];
        modelMatrix[10] = tangentZ[2];
        modelMatrix[12] = worldX;
        modelMatrix[13] = surface?.y ?? worldY;
        modelMatrix[14] = worldZ;
        mat4.scale(renderer.modelMatrix, renderer.modelMatrix, [
            prop.scale * 3,
            prop.scale * 3,
            prop.scale * 3,
        ]);
        if (fadeEndDistance > fadeStartDistance) {
            renderer.distanceFade = {
                origin: vec3.fromValues(prop.position[0] * 3, prop.position[1] * 3, prop.position[2] * 3),
                startDistance: fadeStartDistance,
                endDistance: fadeEndDistance,
            };
        }
        sceneRenderer.meshRenderers.push(renderer);
    }
}

function addModel2Props(device: GfxDevice, cache: GfxRenderCache, sceneRenderer: DK64Renderer, sharedOutput: RSPSharedOutput, romData: ROMData, props: SetupProp[], terrainTriangles: TerrainTriangle[]): void {
    if (props.length === 0 || romData.PropGeometryData.length === 0)
        return;

    const propsByType = new globalThis.Map<number, SetupProp[]>();
    for (const prop of props) {
        if (!propsByType.has(prop.type))
            propsByType.set(prop.type, []);
        propsByType.get(prop.type)!.push(prop);
    }

    for (const [propType, instances] of propsByType) {
        // func_global_asm_80636FFC explicitly returns without submitting
        // these object types; they are handled outside the static model path.
        if (propType === 0x0000 || propType === 0x0241)
            continue;
        const geometry = romData.loadPropGeometry(propType);
        const view = geometry.createDataView();
        const assetFamily = geometry.createTypedArray(Uint8Array, 0x0C, 0x10);
        const assetFamilyEnd = assetFamily.indexOf(0);
        const assetFamilyName = String.fromCharCode(...assetFamily.subarray(0, assetFamilyEnd >= 0 ? assetFamilyEnd : assetFamily.length));
        // Keep this decoded for diagnostics and future family-specific
        // behavior, but do not use it to restrict generic prop rendering.
        void assetFamilyName;
        addModel2PropDecals(device, cache, sceneRenderer, sharedOutput, romData, view, instances, terrainTriangles);
        // Header layout 1 stores an F3DEX2 display-list range followed by its
        // segment-8 vertices. Layout 2 is runtime-generated/animated model
        // data and cannot be interpreted as the same structure.
        // TODO: parse and render model2 header layout 2.
        if (view.getUint8(0x1C) !== 1)
            continue;

        const mainDisplayListStart = view.getUint32(0x40, false);
        const secondaryDisplayListStart = view.getUint32(0x44, false);
        const vertexStart = view.getUint32(0x48, false);
        // Some props have a hierarchy driven by segment-9 matrices generated
        // at runtime. Ignoring G_MTX collapses those parts into the wrong
        // transforms, so leave them out until the hierarchy is decoded.
        // TODO: parse the prop node/matrix data and implement G_MTX.
        if (propDisplayListUsesMatrices(view, mainDisplayListStart, secondaryDisplayListStart))
            continue;
        const segmentBuffers: ArrayBufferSlice[] = [];
        segmentBuffers[0x08] = geometry.slice(vertexStart);
        segmentBuffers[0x0A] = geometry.slice(mainDisplayListStart);
        // The game submits the secondary range by physical address while it
        // retains segment 0x0A for branches into the primary range. Give the
        // secondary entry point an otherwise unused local segment.
        segmentBuffers[0x0F] = geometry;

        const indexedTextures = parseModel2IndexedTextures(view, romData);
        const state = new RSPState(romData.TexData, segmentBuffers, sharedOutput, [], indexedTextures);
        initDL(state, true);
        // func_global_asm_80636FFC installs this inherited state immediately
        // before submitting both prop display lists. Tree materials use
        // primitive color but do not set it inside their own lists.
        state.gSPSetPrimColor(0, 0xFF, 0xFF, 0xFF, 0xFF);
        // LOD wrappers select their first (highest-detail) target with
        // G_RDPHALF_1 + G_BRANCH_Z. Direct display lists simply begin at zero.
        // TODO: implement G_BRANCH_Z and submit the wrapper itself so props
        // can switch LOD based on the projected Z value.
        const displayListOffset = findHighDetailPropDisplayList(view, mainDisplayListStart);
        runDL_F3DEX2(state, 0x0A000000 | displayListOffset);
        runDL_F3DEX2(state, 0x0F000000 | secondaryDisplayListStart);
        const output = state.finish();
        if (output === null)
            continue;

        const mesh: Mesh = { sharedOutput, rspState: state, rspOutput: output };
        const meshData = new MeshData(device, cache, mesh);
        sceneRenderer.meshDatas.push(meshData);
        for (const prop of instances) {
            const renderer = new RootMeshRenderer(device, cache, meshData);
            mat4.translate(renderer.modelMatrix, renderer.modelMatrix, [
                prop.position[0] * 3,
                prop.position[1] * 3,
                prop.position[2] * 3,
            ]);
            mat4.rotateX(renderer.modelMatrix, renderer.modelMatrix, prop.rotation[0] * Math.PI / 180);
            mat4.rotateY(renderer.modelMatrix, renderer.modelMatrix, prop.rotation[1] * Math.PI / 180);
            mat4.rotateZ(renderer.modelMatrix, renderer.modelMatrix, prop.rotation[2] * Math.PI / 180);
            mat4.scale(renderer.modelMatrix, renderer.modelMatrix, [
                prop.scale * 3,
                prop.scale * 3,
                prop.scale * 3,
            ]);
            sceneRenderer.meshRenderers.push(renderer);
        }
    }
}

interface SpriteParticleEvent {
    origin: vec3;
    spawnTick: number;
    frameOffset?: number;
    velocityY?: number;
}

function addSpriteParticleEvents(device: GfxDevice, cache: GfxRenderCache, sceneRenderer: DK64Renderer, sharedOutput: RSPSharedOutput, romData: ROMData, definition: SpriteData, events: SpriteParticleEvent[], scale: number, loopTicks: number, frameDuration = 1, lifetime: number | undefined = definition.images.length * frameDuration, color: readonly number[] = definition.params.slice(0, 4), maxDistance?: number, fadeStartDistance?: number): void {
    assert(definition.imagesPerFrameHorizontal === 1 && definition.imagesPerFrameVertical === 1);
    const sourceTable = definition.table !== 0 ? romData.TexData : romData.AnimTexData;
    const sourceFrames = definition.images.map((image) => sourceTable[image]);
    const frameCount = sourceFrames.length;
    // Sprite instances have their own sub-frame counter in the game. Expand
    // the frame list to one entry per tick so particles emitted between global
    // frame boundaries still begin on their requested first image.
    const frames = sourceFrames.flatMap((frame) => new Array(frameDuration).fill(frame));
    const animationTickCount = frames.length;

    for (let phase = 0; phase < animationTickCount; phase++) {
        const phaseEvents = events.filter((event) => {
            const requestedTick = (event.frameOffset ?? 0) * frameDuration;
            const animationOffset = ((requestedTick - event.spawnTick) % animationTickCount + animationTickCount) % animationTickCount;
            return animationOffset === phase;
        });
        for (let eventBase = 0; eventBase < phaseEvents.length; eventBase += 8) {
            const batch = phaseEvents.slice(eventBase, eventBase + 8);
            const segment = 0x0E;
            const segmentBuffers: ArrayBufferSlice[] = [];
            segmentBuffers[0x08] = createSpriteVertexBuffer(definition, batch.length);
            const animation: AnimatedTexture[] = [{
                segment,
                // All phase batches use the same source frames. Key the
                // translated textures by sprite definition, not phase;
                // otherwise different sprites on segment 0x0E can alias in
                // the shared texture cache when their phase numbers match.
                group: definition.id,
                frameDuration: 1,
                frameOffset: phase,
                frames,
            }];
            const state = new RSPState(romData.TexData, segmentBuffers, sharedOutput, animation);
            initDL(state, false);
            initSpriteMaterial(state, definition, segment, color);
            const firstVertex = sharedOutput.vertices.length;
            for (let quad = 0; quad < batch.length; quad++) {
                state.gSPVertex(0x08000000 + quad * 4 * 0x10, 4, 0);
                state.gSPTri(0, 1, 2);
                state.gSPTri(0, 2, 3);
            }
            const output = state.finish();
            if (output === null)
                continue;

            const width = definition.width * scale * 3;
            const height = definition.height * scale * 3;
            const mesh: Mesh = {
                sharedOutput,
                rspState: state,
                rspOutput: output,
                spriteBillboards: batch.map((event, index) => ({
                    firstVertex: firstVertex + index * 4,
                    origin: event.origin,
                    centerX: 0,
                    centerY: 0,
                    halfWidth: width / 2,
                    halfHeight: height / 2,
                    spawnTick: lifetime === undefined ? undefined : event.spawnTick,
                    lifetime: lifetime,
                    loopTicks: lifetime === undefined ? undefined : loopTicks,
                    velocityY: event.velocityY,
                    maxDistance,
                    fadeStartDistance,
                })),
            };
            const meshData = new MeshData(device, cache, mesh);
            sceneRenderer.meshDatas.push(meshData);
            const renderer = new RootMeshRenderer(device, cache, meshData);
            renderer.sortKeyBase = makeSortKey(GfxRendererLayer.TRANSLUCENT);
            renderer.setBackfaceCullingEnabled(false);
            sceneRenderer.meshRenderers.push(renderer);
        }
    }
}

function isAlwaysRunningInitialBlock(block: ScriptBlock): boolean {
    return block.conditions.length === 1
        && block.conditions[0].opcode === 1
        && block.conditions[0].args[0] === 0
        && !block.executions.some((command) => command.opcode === 1);
}

function nextEffectRandom(state: { value: number }): number {
    // A fixed stream makes the viewer's static reconstruction repeatable.
    // The game uses its shared RNG; emitter frequency and selection semantics
    // below are otherwise identical.
    state.value = (Math.imul(state.value, 0x41C64E6D) + 0x3039) >>> 0;
    return state.value >>> 16;
}

function interpolateEnvironmentParticle(entry: EnvironmentParticleData, offset: number): vec3 {
    return vec3.fromValues(
        (entry.start[0] + (entry.end[0] - entry.start[0]) * offset) * 3,
        (entry.start[1] + (entry.end[1] - entry.start[1]) * offset) * 3,
        (entry.start[2] + (entry.end[2] - entry.start[2]) * offset) * 3,
    );
}

function addEnvironmentalEffects(device: GfxDevice, cache: GfxRenderCache, sceneRenderer: DK64Renderer, sharedOutput: RSPSharedOutput, romData: ROMData, map: Map, mapID: number): void {
    const props = parseSetupProps(romData.loadSetup(mapID));
    const propsByID = new globalThis.Map(props.map((prop) => [prop.id, prop]));
    const scripts = parseInstanceScripts(romData.loadScripts(mapID));
    const spriteByAddress = new globalThis.Map(romData.SpriteData.map((sprite) => [sprite.address, sprite]));
    const loopTicks = 900;

    // func_global_asm_80664CB0 / func_global_asm_80664D20: map-keyed
    // ambient waterfall emitters. Each definition emits a broad, stationary
    // RGBA32 splash along its line and a smaller rising IA8 spray.
    const baseSpray = spriteByAddress.get(0x8072140C);
    const risingSpray = spriteByAddress.get(0x8071FF18);
    if (baseSpray !== undefined && risingSpray !== undefined) {
        for (const [entryIndex, entry] of romData.EnvironmentParticleData.entries()) {
            if (entry.map !== mapID)
                continue;
            const random = { value: (mapID << 16) ^ entryIndex ^ 0x664D20 };
            const baseEvents: SpriteParticleEvent[] = [];
            const risingEvents: SpriteParticleEvent[] = [];
            // func_global_asm_80717B64 kills the base sprite after one full
            // animation: 6 frames * 3 ticks. The emitter replaces all five
            // B0 sprites on that same 18-tick cadence. Generate every row,
            // rather than leaving the first row alive forever, since each
            // replacement chooses a fresh random starting frame.
            for (let tick = 0; tick < loopTicks; tick++) {
                if (tick % 18 === 0) {
                    for (let offset = 0; offset <= 1.00001; offset += entry.gap) {
                        baseEvents.push({
                            origin: interpolateEnvironmentParticle(entry, Math.min(offset, 1)),
                            spawnTick: tick,
                            frameOffset: (nextEffectRandom(random) % 10000) % 6,
                        });
                    }
                }
                if (tick % 10 === 0) {
                    risingEvents.push({
                        origin: interpolateEnvironmentParticle(entry, ((nextEffectRandom(random) % 10000) % 1000) / 1000),
                        spawnTick: tick,
                        velocityY: 1.7 * 3,
                    });
                }
            }
            const drawDistance = entry.distance * 3;
            // func_global_asm_80717B64 preserves the spawn alpha through the
            // first 3/4 of the draw distance, then fades it to zero.
            addSpriteParticleEvents(device, cache, sceneRenderer, sharedOutput, romData, baseSpray, baseEvents, entry.baseScale, loopTicks, 3, 18, [0xFF, 0xFF, 0xFF, 0x96], drawDistance, drawDistance * 3 / 4);
            addSpriteParticleEvents(device, cache, sceneRenderer, sharedOutput, romData, risingSpray, risingEvents, entry.risingScale, loopTicks, 3, 30, [0xFF, 0xFF, 0xFF, 0x96], entry.distance * 3);
        }
    }

    for (const script of scripts) {
        const prop = propsByID.get(script.id);
        if (prop === undefined)
            continue;
        for (const block of script.blocks) {
            if (!isAlwaysRunningInitialBlock(block))
                continue;
            for (const command of block.executions) {
                if (command.opcode !== 7)
                    continue;
                const functionAddress = romData.CustomScriptFunctionData[command.args[0]];

                // func_global_asm_80644EC8: twice per tick, emit sprite
                // D_global_asm_80720A7C at a random point in point sets 0/1.
                if (functionAddress === 0x80644EC8) {
                    const definition = spriteByAddress.get(0x80720A7C);
                    if (definition === undefined)
                        continue;
                    const frequency = command.args[1];
                    const requestedPointCount = command.args[2];
                    if (frequency <= 0 || requestedPointCount <= 0)
                        continue;
                    const random = { value: (mapID << 16) ^ script.id ^ 0x44EC8 };
                    const events: SpriteParticleEvent[] = [];
                    for (let tick = 0; tick < loopTicks; tick++) {
                        for (let set = 0; set < 2; set++) {
                            if ((nextEffectRandom(random) % frequency) !== 0)
                                continue;
                            const points = map.effectPointSets[set];
                            if (points === undefined || points.length === 0)
                                continue;
                            const pointCount = Math.min(requestedPointCount, points.length);
                            const point = points[nextEffectRandom(random) % pointCount];
                            events.push({
                                origin: vec3.fromValues(point[0] * 3, point[1] * 3, point[2] * 3),
                                spawnTick: tick,
                            });
                        }
                    }
                    addSpriteParticleEvents(device, cache, sceneRenderer, sharedOutput, romData, definition, events, 1.2, loopTicks);
                }
            }
        }
    }
}

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const romData = await context.dataShare.ensureObject(`${pathBase}/ROMData`, async () => {
            return new ROMData(await dataFetcher.fetchData(`${pathBase}/ROM_arc.crg1`)!);
        });

        const sceneID = parseInt(this.id, 16);

        let mapData = romData.MapData[sceneID];
        if (typeof mapData === 'number')
            mapData = romData.MapData[mapData];
        const map = new Map(decompress(mapData as ArrayBufferSlice), romData.AnimTexData);

        const sharedOutput = new RSPSharedOutput();
        const sceneRenderer = new DK64Renderer(device);
        const cache = sceneRenderer.renderHelper.renderCache;
        for (let i = 0; i < map.displayLists.length; i++) {
            const dl = map.displayLists[i];

            const segmentBuffers: ArrayBufferSlice[] = [];
            segmentBuffers[0x06] = map.vertBin.slice(dl.VertStartIndex * 0x10);
            segmentBuffers[0x07] = map.f3dexBin;
            // Segment bindings persist across DK64's material display lists.
            // Put the section's own animation group first, but retain the
            // other map bindings as fallbacks for lists which inherit state
            // from a previous section.
            const animatedTextures = dl.textureAnimationGroup !== null
                ? [
                    ...map.animatedTextures.filter((entry) => entry.group === dl.textureAnimationGroup),
                    ...map.animatedTextures.filter((entry) => entry.group !== dl.textureAnimationGroup),
                ]
                : [...map.animatedTextures];
            if (dl.materialIndex === 4) {
                animatedTextures.unshift({
                    segment: 0x0C,
                    group: 0,
                    frameDuration: 0,
                    frames: [romData.AnimTexData[0x3E0]],
                });
            }
            const state = new RSPState(romData.TexData, segmentBuffers, sharedOutput, animatedTextures);
            initDL(state, true);
            if (dl.materialIndex === 4)
                initWaterMaterial(state);
            runDL_F3DEX2(state, 0x07000000 | dl.dlStartAddr);

            const output = state.finish();

            if (output === null) {
                // TODO(jstpierre): Warn?
                continue;
            }

            const mesh: Mesh = { sharedOutput, rspState: state, rspOutput: output };
            const meshData = new MeshData(device, cache, mesh);
            sceneRenderer.meshDatas.push(meshData);

            const meshRenderer = new RootMeshRenderer(device, cache, meshData);
            sceneRenderer.meshRenderers.push(meshRenderer);
        }

        // Capture only the map display-list geometry. The game obtains these
        // planes from its floor-collision query; the rendered triangles give
        // the decal pass the corresponding visible surface without archiving
        // a second copy of the map collision data.
        const terrainTriangles = buildTerrainTriangles(sharedOutput);

        for (const surface of map.waterSurfaces) {
            const vertexBuffer = createWaterSurfaceVertexBuffer(surface);
            const segmentBuffers: ArrayBufferSlice[] = [];
            segmentBuffers[0x08] = vertexBuffer;
            const materialTextures: AnimatedTexture[] = [{
                segment: 0x0D,
                group: 0,
                frameDuration: 0,
                frames: [romData.AnimTexData[0x3C5]],
            }];
            const state = new RSPState(romData.TexData, segmentBuffers, sharedOutput, materialTextures);
            initDL(state, false);
            initWaterSurfaceMaterial(state, surface.scrollSpeedS, surface.scrollSpeedT);

            const firstVertex = sharedOutput.vertices.length;
            for (let row = 0; row < surface.rows - 1; row++) {
                for (let column = 0; column < surface.columns - 1; column += 15) {
                    const cellCount = Math.min(15, surface.columns - 1 - column);
                    const vertexCount = cellCount + 1;
                    state.gSPVertex(0x08000000 + (row * surface.columns + column) * 0x10, vertexCount, 0);
                    state.gSPVertex(0x08000000 + ((row + 1) * surface.columns + column) * 0x10, vertexCount, 16);
                    for (let cell = 0; cell < cellCount; cell++) {
                        state.gSPTri(cell + 1, cell, 16 + cell);
                        state.gSPTri(16 + cell, 16 + cell + 1, cell + 1);
                    }
                }
            }

            const output = state.finish();
            if (output === null)
                continue;
            const mesh: Mesh = {
                sharedOutput,
                rspState: state,
                rspOutput: output,
                waterAnimation: {
                    surface,
                    firstVertex,
                    vertexCount: sharedOutput.vertices.length - firstVertex,
                },
            };
            const meshData = new MeshData(device, cache, mesh);
            sceneRenderer.meshDatas.push(meshData);
            sceneRenderer.meshRenderers.push(new RootMeshRenderer(device, cache, meshData));
        }

        const setupProps = parseSetupProps(romData.loadSetup(sceneID));
        addModel2Props(device, cache, sceneRenderer, sharedOutput, romData, setupProps, terrainTriangles);
        addEnvironmentalEffects(device, cache, sceneRenderer, sharedOutput, romData, map, sceneID);

        // for (let i = 0; i < sharedOutput.textureCache.textures.length; i++)
        //     sceneRenderer.textureHolder.viewerTextures.push(textureToCanvas(sharedOutput.textureCache.textures[i]));

        return sceneRenderer;
    }

}

// Names taken from ScriptHawk
const id = `dk64`;
const name = "Donkey Kong 64";
const sceneDescs = [

    "DK Isles",
    new SceneDesc(`22`, "DK Isles Overworld"),
    new SceneDesc(`B0`, "Training Grounds"),
    new SceneDesc(`AB`, "DK's House"),
    new SceneDesc(`BD`, "Fairy Island"),
    new SceneDesc(`61`, "K. Lumsy"),
    new SceneDesc(`A9`, "Jungle Japes Lobby"),
    new SceneDesc(`AD`, "Angry Aztec Lobby"),
    new SceneDesc(`AF`, "Frantic Factory Lobby"),
    new SceneDesc(`AE`, "Gloomy Galleon Lobby"),
    new SceneDesc(`C2`, "Crystal Caves Lobby"),
    new SceneDesc(`B2`, "Fungi Forest Lobby"),
    new SceneDesc(`C1`, "Creepy Castle Lobby"),
    new SceneDesc(`AA`, "Hideout Helm Lobby"),
    new SceneDesc(`B1`, "Dive Barrel"),
    new SceneDesc(`B4`, "Orange Barrel"),
    new SceneDesc(`B5`, "Barrel Barrel"),
    new SceneDesc(`B6`, "Vine Barrel"),
    new SceneDesc(`C3`, "DK Isles: Snide's Room"),

    "Jungle Japes",
    new SceneDesc(`07`, "Jungle Japes"),
    new SceneDesc(`04`, "Mountain"),
    new SceneDesc(`06`, "Minecart"),
    new SceneDesc(`08`, "Army Dillo"),
    new SceneDesc(`0C`, "Shell"),
    new SceneDesc(`0D`, "Lanky's Cave"),
    new SceneDesc(`21`, "Chunky's Cave"),
    new SceneDesc(`25`, "Barrel Blast"),

    "Angry Aztec",
    new SceneDesc(`26`, "Angry Aztec"),
    new SceneDesc(`0E`, "Beetle Race"),
    new SceneDesc(`10`, "Tiny's Temple"),
    new SceneDesc(`13`, "Five Door Temple (DK)"),
    new SceneDesc(`14`, "Llama Temple"),
    new SceneDesc(`15`, "Five Door Temple (Diddy)"),
    new SceneDesc(`16`, "Five Door Temple (Tiny)"),
    new SceneDesc(`17`, "Five Door Temple (Lanky)"),
    new SceneDesc(`18`, "Five Door Temple (Chunky)"),
    new SceneDesc(`29`, "Barrel Blast"),
    new SceneDesc(`C5`, "Dogadon"),

    "Frantic Factory",
    new SceneDesc(`1A`, "Frantic Factory"),
    new SceneDesc(`1B`, "Car Race"),
    new SceneDesc(`1D`, "Power Shed"),
    new SceneDesc(`24`, "Crusher Room"),
    new SceneDesc(`6E`, "Barrel Blast"),
    new SceneDesc(`9A`, "Mad Jack"),

    "Gloomy Galleon",
    new SceneDesc(`1E`, "Gloomy Galleon"),
    new SceneDesc(`1F`, "K. Rool's Ship"),
    new SceneDesc(`27`, "Seal Race"),
    new SceneDesc(`2B`, "Shipwreck (Diddy, Lanky, Chunky)"),
    new SceneDesc(`2C`, "Treasure Chest"),
    new SceneDesc(`2D`, "Mermaid"),
    new SceneDesc(`2E`, "Shipwreck (DK, Tiny)"),
    new SceneDesc(`2F`, "Shipwreck (Lanky, Tiny)"),
    new SceneDesc(`31`, "Lighthouse"),
    new SceneDesc(`33`, "Mechanical Fish"),
    new SceneDesc(`36`, "Barrel Blast"),
    new SceneDesc(`6F`, "Pufftoss"),
    new SceneDesc(`B3`, "Submarine"),

    "Fungi Forest",
    new SceneDesc(`30`, "Fungi Forest"),
    new SceneDesc(`34`, "Ant Hill"),
    new SceneDesc(`37`, "Minecart"),
    new SceneDesc(`38`, "Diddy's Barn"),
    new SceneDesc(`39`, "Diddy's Attic"),
    new SceneDesc(`3A`, "Lanky's Attic"),
    new SceneDesc(`3B`, "DK's Barn"),
    new SceneDesc(`3C`, "Spider"),
    new SceneDesc(`3D`, "Front Part of Mill"),
    new SceneDesc(`3E`, "Rear Part of Mill"),
    new SceneDesc(`3F`, "Mushroom Puzzle"),
    new SceneDesc(`40`, "Giant Mushroom"),
    new SceneDesc(`46`, "Mushroom Leap"),
    new SceneDesc(`47`, "Shooting Game"),
    new SceneDesc(`53`, "Dogadon"),
    new SceneDesc(`BC`, "Barrel Blast"),

    "Crystal Caves",
    new SceneDesc(`48`, "Crystal Caves"),
    new SceneDesc(`52`, "Beetle Race"),
    new SceneDesc(`54`, "Igloo (Tiny)"),
    new SceneDesc(`55`, "Igloo (Lanky)"),
    new SceneDesc(`56`, "Igloo (DK)"),
    new SceneDesc(`59`, "Rotating Room"),
    new SceneDesc(`5A`, "Shack (Chunky)"),
    new SceneDesc(`5B`, "Shack (DK)"),
    new SceneDesc(`5C`, "Shack (Diddy, middle part)"),
    new SceneDesc(`5D`, "Shack (Tiny)"),
    new SceneDesc(`5E`, "Lanky's Hut"),
    new SceneDesc(`5F`, "Igloo (Chunky)"),
    new SceneDesc(`62`, "Ice Castle"),
    new SceneDesc(`64`, "Igloo (Diddy)"),
    new SceneDesc(`BA`, "Barrel Blast"),
    new SceneDesc(`C4`, "Army Dillo"),
    new SceneDesc(`C8`, "Shack (Diddy, upper part)"),

    "Creepy Castle",
    new SceneDesc(`57`, "Creepy Castle"),
    new SceneDesc(`58`, "Ballroom"),
    new SceneDesc(`69`, "Tower"),
    new SceneDesc(`6A`, "Minecart"),
    new SceneDesc(`6C`, "Crypt (Lanky, Tiny)"),
    new SceneDesc(`70`, "Crypt (DK, Diddy, Chunky)"),
    new SceneDesc(`71`, "Museum"),
    new SceneDesc(`72`, "Library"),
    new SceneDesc(`97`, "Dungeon"),
    new SceneDesc(`A3`, "Basement"),
    new SceneDesc(`A4`, "Tree"),
    new SceneDesc(`A6`, "Chunky's Toolshed"),
    new SceneDesc(`A7`, "Trash Can"),
    new SceneDesc(`A8`, "Greenhouse"),
    new SceneDesc(`B7`, "Crypt"),
    new SceneDesc(`B9`, "Car Race"),
    new SceneDesc(`BB`, "Barrel Blast"),
    new SceneDesc(`C7`, "King Kut Out"),

    "Hideout Helm",
    new SceneDesc(`11`, "Hideout Helm"),
    new SceneDesc(`03`, "K. Rool Barrel: Lanky's Maze"),
    new SceneDesc(`23`, "K. Rool Barrel: DK's Target Game"),
    new SceneDesc(`32`, "K. Rool Barrel: Tiny's Mushroom Game"),
    new SceneDesc(`A5`, "K. Rool Barrel: Diddy's Kremling Game"),
    new SceneDesc(`C9`, "K. Rool Barrel: Diddy's Rocketbarrel Game"),
    new SceneDesc(`CA`, "K. Rool Barrel: Lanky's Shooting Game"),
    new SceneDesc(`D1`, "K. Rool Barrel: Chunky's Hidden Kremling Game"),
    new SceneDesc(`D2`, "K. Rool Barrel: Tiny's Pony Tail Twirl Game"),
    new SceneDesc(`D3`, "K. Rool Barrel: Chunky's Shooting Game"),
    new SceneDesc(`D4`, "K. Rool Barrel: DK's Rambi Game"),

    "K. Rool",
    new SceneDesc(`CB`, "DK Phase"),
    new SceneDesc(`CC`, "Diddy Phase"),
    new SceneDesc(`CD`, "Lanky Phase"),
    new SceneDesc(`CE`, "Tiny Phase"),
    new SceneDesc(`CF`, "Chunky Phase"),
    new SceneDesc(`D6`, "K. Rool's Shoe"),
    new SceneDesc(`D7`, "K. Rool's Arena"),

    "Cutscene",
    new SceneDesc(`1C`, "Hideout Helm (Level Intros, Game Over)"),
    new SceneDesc(`28`, "Nintendo Logo"),
    new SceneDesc(`4C`, "DK Rap"),
    new SceneDesc(`51`, "Title Screen (Not For Resale Version)"),
    new SceneDesc(`98`, "Hideout Helm (Intro Story)"),
    new SceneDesc(`99`, "DK Isles (DK Theatre)"),
    new SceneDesc(`AC`, "Rock (Intro Story)"),
    new SceneDesc(`C6`, "Training Grounds (End Sequence)"),
    new SceneDesc(`D0`, "Bloopers Ending"),
    new SceneDesc(`D5`, "K. Lumsy Ending"),

    "Bonus Barrels",
    new SceneDesc(`0A`, "Kremling Kosh! (very easy)"),
    new SceneDesc(`0B`, "Stealthy Snoop! (normal, no logo)"),
    new SceneDesc(`12`, "Teetering Turtle Trouble! (very easy)"),
    new SceneDesc(`20`, "Batty Barrel Bandit! (easy)"),
    new SceneDesc(`41`, "Stealthy Snoop! (normal)"),
    new SceneDesc(`42`, "Mad Maze Maul! (hard)"),
    new SceneDesc(`43`, "Stash Snatch! (normal)"),
    new SceneDesc(`44`, "Mad Maze Maul! (easy)"),
    new SceneDesc(`45`, "Mad Maze Maul! (normal)"),
    new SceneDesc(`4A`, "Stash Snatch! (easy)"),
    new SceneDesc(`4B`, "Stash Snatch! (hard)"),
    new SceneDesc(`4D`, "Minecart Mayhem! (easy)"),
    new SceneDesc(`4E`, "Busy Barrel Barrage! (easy)"),
    new SceneDesc(`4F`, "Busy Barrel Barrage! (normal)"),
    new SceneDesc(`60`, "Splish-Splash Salvage! (normal)"),
    new SceneDesc(`63`, "Speedy Swing Sortie! (easy)"),
    new SceneDesc(`65`, "Krazy Kong Klamour! (easy)"),
    new SceneDesc(`66`, "Big Bug Bash! (very easy)"),
    new SceneDesc(`67`, "Searchlight Seek! (very easy)"),
    new SceneDesc(`68`, "Beaver Bother! (easy)"),
    new SceneDesc(`73`, "Kremling Kosh! (easy)"),
    new SceneDesc(`74`, "Kremling Kosh! (normal)"),
    new SceneDesc(`75`, "Kremling Kosh! (hard)"),
    new SceneDesc(`76`, "Teetering Turtle Trouble! (easy)"),
    new SceneDesc(`77`, "Teetering Turtle Trouble! (normal)"),
    new SceneDesc(`78`, "Teetering Turtle Trouble! (hard)"),
    new SceneDesc(`79`, "Batty Barrel Bandit! (easy)"),
    new SceneDesc(`7A`, "Batty Barrel Bandit! (normal)"),
    new SceneDesc(`7B`, "Batty Barrel Bandit! (hard)"),
    new SceneDesc(`7C`, "Mad Maze Maul! (insane)"),
    new SceneDesc(`7D`, "Stash Snatch! (insane)"),
    new SceneDesc(`7E`, "Stealthy Snoop! (very easy)"),
    new SceneDesc(`7F`, "Stealthy Snoop! (easy)"),
    new SceneDesc(`80`, "Stealthy Snoop! (hard)"),
    new SceneDesc(`81`, "Minecart Mayhem! (normal)"),
    new SceneDesc(`82`, "Minecart Mayhem! (hard)"),
    new SceneDesc(`83`, "Busy Barrel Barrage! (hard)"),
    new SceneDesc(`84`, "Splish-Splash Salvage! (hard)"),
    new SceneDesc(`85`, "Splish-Splash Salvage! (easy)"),
    new SceneDesc(`86`, "Speedy Swing Sortie! (normal)"),
    new SceneDesc(`87`, "Speedy Swing Sortie! (hard)"),
    new SceneDesc(`88`, "Beaver Bother! (normal)"),
    new SceneDesc(`89`, "Beaver Bother! (hard)"),
    new SceneDesc(`8A`, "Searchlight Seek! (easy)"),
    new SceneDesc(`8B`, "Searchlight Seek! (normal)"),
    new SceneDesc(`8C`, "Searchlight Seek! (hard)"),
    new SceneDesc(`8D`, "Krazy Kong Klamour! (normal)"),
    new SceneDesc(`8E`, "Krazy Kong Klamour! (hard)"),
    new SceneDesc(`8F`, "Krazy Kong Klamour! (insane)"),
    new SceneDesc(`90`, "Peril Path Panic! (very easy)"),
    new SceneDesc(`91`, "Peril Path Panic! (easy)"),
    new SceneDesc(`92`, "Peril Path Panic! (normal)"),
    new SceneDesc(`93`, "Peril Path Panic! (hard)"),
    new SceneDesc(`94`, "Big Bug Bash! (easy)"),
    new SceneDesc(`95`, "Big Bug Bash! (normal)"),
    new SceneDesc(`96`, "Big Bug Bash! (hard)"),

    "Battle Arenas",
    new SceneDesc(`35`, "Beaver Brawl!"),
    new SceneDesc(`49`, "Kritter Karnage!"),
    new SceneDesc(`9B`, "Arena Ambush!"),
    new SceneDesc(`9C`, "More Kritter Karnage!"),
    new SceneDesc(`9D`, "Forest Fracas!"),
    new SceneDesc(`9E`, "Bish Bash Brawl!"),
    new SceneDesc(`9F`, "Kamikaze Kremlings!"),
    new SceneDesc(`A0`, "Plinth Panic!"),
    new SceneDesc(`A1`, "Pinnacle Palaver!"),
    new SceneDesc(`A2`, "Shockwave Showdown!"),

    "Kong Battle",
    new SceneDesc(`6B`, "Battle Arena"),
    new SceneDesc(`6D`, "Arena 1"),
    new SceneDesc(`BE`, "Arena 2"),
    new SceneDesc(`C0`, "Arena 3"),

    "Other",
    new SceneDesc(`00`, "Test Map"),
    new SceneDesc(`01`, "Funky's Store"),
    new SceneDesc(`02`, "DK Arcade"),
    new SceneDesc(`05`, "Cranky's Lab"),
    new SceneDesc(`09`, "Jetpac"),
    new SceneDesc(`0F`, "Snide's H.Q."),
    new SceneDesc(`19`, "Candy's Music Shop"),
    new SceneDesc(`2A`, "Troff 'n' Scoff"),
    new SceneDesc(`50`, "Main Menu"),
    new SceneDesc(`B8`, "Enguarde Arena"),
    new SceneDesc(`BF`, "Rambi Arena"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, altName: "dk64" };
