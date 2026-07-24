
import * as Viewer from '../viewer.js';
import * as BYML from '../byml.js';
import * as UI from '../ui.js';

import { GfxDevice, GfxCullMode, GfxProgram, GfxMegaStateDescriptor, makeTextureDescriptor2D, GfxFormat, GfxSampler, GfxTexture, GfxTexFilterMode, GfxMipFilterMode, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxBuffer, GfxInputLayout, GfxBufferUsage, GfxBufferFrequencyHint, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxVertexBufferFrequency, GfxVertexBufferDescriptor, GfxIndexBufferDescriptor } from '../gfx/platform/GfxPlatform.js';
import { SceneContext } from '../SceneBase.js';
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { F3DEX_Program } from '../BanjoKazooie/render.js';
import { nArray, align, assert, hexzero } from '../util.js';
import { DeviceProgram } from '../Program.js';
import { mat4, vec3 } from 'gl-matrix';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { TextureMapping, FakeTextureHolder } from '../TextureHolder.js';
import { AnimatedTexture, DrawCall, RSP_Geometry, RSPState, runDL_F3DEX2, RSPOutput } from './f3dex2.js';
import { translateBlendMode, translateCullMode } from '../PokemonSnap/f3dex2.js';
import { GfxRendererLayer, GfxRenderInstList, GfxRenderInstManager, makeSortKey } from '../gfx/render/GfxRenderInstManager.js';
import { computeViewMatrixSkybox, computeViewMatrix, CameraController } from '../Camera.js';
import { fillMatrix4x3, fillMatrix4x2, fillVec4, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { translateCM, Texture, OtherModeH_Layout } from '../Common/N64/RDP.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { TextFilt } from "../Common/N64/Image.js";
import { RSPSharedOutput, Vertex } from '../BanjoKazooie/f3dex.js';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers.js';
import { Vec3UnitY, Vec3Zero, scaleMatrix, setMatrixTranslation } from '../MathHelpers.js';

import ArrayBufferSlice from '../ArrayBufferSlice.js';
import * as Deflate from '../Common/Compression/Deflate.js';
import { calcTextureMatrixFromRSPState } from '../Common/N64/RSP.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { createBufferFromData } from '../gfx/helpers/BufferHelpers.js';
import { ActiveLightCache, buildDynamicLights, buildMapChunkLighting, buildObjectLighting, buildObjectLightingEnvironment, sampleObjectLighting, updateDynamicLighting } from './light.js';
import type { DynamicLight, DynamicLighting, ObjectLighting, ObjectLightingEnvironment } from './light.js';
import { actorModelScale, buildSkeletalActorMesh, getActorRenderDefinition, updateSkeletalActor } from './actor.js';
import type { ActorRenderDefinition, SkeletalActorAnimation, SkeletalActorMesh } from './actor.js';
import { addModel2Props, buildTerrainTriangles, updatePropMatrixAnimation } from './prop.js';
import type { PropMatrixAnimation } from './prop.js';
import {
    getGeneratedSurfaceAnimatedTextureBindings,
    getSceneNodeAnimatedTextureBindings, initDL, initGeneratedSurfaceMaterial,
    initSceneNodeMaterial, initSpriteMaterial,
} from './material.js';
import type { AnimatedMaterialTextureBinding } from './material.js';
import { DK64Map, parseInstanceScripts, parseSetup } from './parse.js';
import type { GeneratedSurface, InstanceScript, ScriptBlock, SetupActor, SetupProp } from './parse.js';
import { createBackdropRenderer } from './background.js';
import type { BackdropData, BackdropRenderer } from './background.js';
import { AABB } from '../Geometry.js';
import { SceneCuller, computeMeshLocalBoundingBox, computeMeshWorldBoundingBox } from './cull.js';
import type { CullGroup } from './cull.js';

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

function renderModeIsTranslucent(megaStateFlags: Partial<GfxMegaStateDescriptor>): boolean {
    const blendState = megaStateFlags.attachmentsState?.[0]?.rgbBlendState;
    return blendState !== undefined
        && (blendState.blendSrcFactor !== GfxBlendFactor.One
            || blendState.blendDstFactor !== GfxBlendFactor.Zero);
}

function resolveAnimatedMaterialTextures(bindings: readonly AnimatedMaterialTextureBinding[], textures: ArrayBufferSlice[]): AnimatedTexture[] {
    return bindings.map((binding) => ({
        segment: binding.segment,
        group: 0,
        frameDuration: binding.frameDuration,
        frames: binding.textureIDs.map((textureID) => textures[textureID]),
    }));
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

function generatedSurfaceHeight(surface: GeneratedSurface, x: number, z: number, tick: number): number {
    const phaseS = tick * surface.phaseSpeedS;
    const phaseT = tick * surface.phaseSpeedT;
    const angleS = (phaseS + Math.trunc(surface.frequencyS * x)) % 0x0FFF;
    const angleT = (phaseT + Math.trunc(surface.frequencyT * z)) % 0x0FFF;
    return surface.baseY
        + Math.sin(angleS * Math.PI * 2 / 0x1000) * surface.amplitudeS
        + Math.sin(angleT * Math.PI * 2 / 0x1000) * surface.amplitudeT;
}

function createGeneratedSurfaceVertexBuffer(surface: GeneratedSurface): ArrayBufferSlice {
    const buffer = new ArrayBuffer(surface.columns * surface.rows * 0x10);
    const view = new DataView(buffer);
    let offs = 0;
    for (let row = 0; row < surface.rows; row++) {
        const z = Math.min(surface.minZ + row * surface.step, surface.maxZ);
        for (let column = 0; column < surface.columns; column++) {
            const x = Math.min(surface.minX + column * surface.step, surface.maxX);
            const y = generatedSurfaceHeight(surface, x, z, 0);
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
interface FogParams {
    near: number;
    far: number;
    color: readonly [number, number, number, number];
}

function fogPositionToViewDistance(position: number, clipNear: number, clipFar: number): number {
    const normalizedPosition = position / 1000;
    return clipNear * clipFar / (clipFar - normalizedPosition * (clipFar - clipNear));
}

class DrawCallInstance {
    private textureEntry: Texture[] = [];
    private animatedTextureEntries: Texture[][] = [];
    private animatedTextureMappings: TextureMapping[][] = [];
    private vertexColorsEnabled = true;
    private texturesEnabled = true;
    private monochromeVertexColorsEnabled = false;
    private alphaVisualizerEnabled = false;
    private fogEnabled = false;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private program!: DeviceProgram;
    private gfxProgram: GfxProgram | null = null;
    private textureMappings = nArray(2, () => new TextureMapping());
    private isTranslucent = false;
    private crossfadeDuration = 0;
    public visible = true;

    constructor(device: GfxDevice, cache: GfxRenderCache, sharedOutput: RSPSharedOutput, private drawCall: DrawCall, private firstIndex: number, private fogParams: FogParams) {
        const linearFiltering = ((drawCall.DP_OtherModeH >>> OtherModeH_Layout.G_MDSFT_TEXTFILT) & 0x03) === TextFilt.G_TF_BILERP;
        for (let i = 0; i < this.textureMappings.length; i++) {
            const binding = drawCall.textureBindings[i];
            if (binding === undefined)
                continue;
            const tex = sharedOutput.textureCache.textures[binding.textureIndex];

            if (tex) {
                this.textureEntry[i] = tex;
                this.textureMappings[i].gfxTexture = translateTexture(device, tex);
                this.textureMappings[i].gfxSampler = translateSampler(cache, tex, linearFiltering);
            }

            const animation = binding.animation;
            if (animation !== undefined) {
                this.animatedTextureEntries[i] = animation.textureIndices.map((index) => sharedOutput.textureCache.textures[index]);
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
        const crossfade0 = drawCall.textureBindings[0]?.animation?.crossfadeGroup;
        const crossfade1 = drawCall.textureBindings[1]?.animation?.crossfadeGroup;
        if (crossfade0 !== null && crossfade0 !== undefined && crossfade0 === crossfade1)
            this.crossfadeDuration = Math.max(drawCall.textureBindings[0].animation!.frameDuration, 1);

        this.megaStateFlags = translateBlendMode(this.drawCall.SP_GeometryMode, this.drawCall.DP_OtherModeL);
        this.isTranslucent = this.crossfadeDuration > 0 || renderModeIsTranslucent(this.megaStateFlags);
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

        if (this.vertexColorsEnabled && this.drawCall.useVertexColors)
            program.defines.set('USE_VERTEX_COLOR', '1');

        if (this.drawCall.SP_GeometryMode & RSP_Geometry.G_TEXTURE_GEN)
            program.defines.set('TEXTURE_GEN', '1');

        // many display lists seem to set this flag without setting texture_gen,
        // despite this one being dependent on it
        if (this.drawCall.SP_GeometryMode & RSP_Geometry.G_TEXTURE_GEN_LINEAR)
            program.defines.set('TEXTURE_GEN_LINEAR', '1');

        if (this.fogEnabled && (this.drawCall.SP_GeometryMode & RSP_Geometry.G_FOG)) {
            program.defines.set('USE_FOG', '1');
        }

        if (this.monochromeVertexColorsEnabled)
            program.defines.set('USE_MONOCHROME_VERTEX_COLOR', '1');

        if (this.alphaVisualizerEnabled)
            program.defines.set('USE_ALPHA_VISUALIZER', '1');

        if (this.crossfadeDuration > 0)
            program.defines.set('EXTRA_COMBINE', '1');

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

    public setFogEnabled(v: boolean): void {
        this.fogEnabled = v;
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
            const speed = this.drawCall.textureBindings[textureEntryIndex]?.scrollSpeed ?? 0;
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

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4, isSkybox: boolean, primAlphaMultiplier = 1, primColorMultiplier: vec3 | null = null): void {
        if (!this.visible)
            return;

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.program);

        const animationTick = viewerInput.time / (1000 / 30);
        for (let i = 0; i < this.animatedTextureMappings.length; i++) {
            const mappings = this.animatedTextureMappings[i];
            if (mappings === undefined)
                continue;
            // DK64 advances these counters once per 30 Hz game tick.
            const animation = this.drawCall.textureBindings[i].animation!;
            const frameDuration = Math.max(animation.frameDuration, 1);
            const frameOffset = animation.frameOffset;
            const frame = (Math.floor(animationTick / frameDuration) + frameOffset) % mappings.length;
            this.textureMappings[i] = mappings[frame];
        }
        const renderInst = renderInstManager.newRenderInst();
        if (this.isTranslucent)
            renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.setDrawCount(this.drawCall.indexCount, this.firstIndex);

        const usesFog = this.fogEnabled && (this.drawCall.SP_GeometryMode & RSP_Geometry.G_FOG) !== 0;
        let offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_DrawParams, 12 + 8*2 + (usesFog ? 8 : 0));
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

        if (usesFog) {
            offs += fillVec4(mappedF32, offs, this.fogParams.near, this.fogParams.far, 0, 0);
            const fogColor = this.fogParams.color;
            offs += fillVec4(mappedF32, offs, fogColor[0], fogColor[1], fogColor[2], fogColor[3]);
        }

        offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_CombineParams, this.crossfadeDuration > 0 ? 12 : 8);
        const comb = renderInst.mapUniformBufferF32(F3DEX_Program.ub_CombineParams);
        const primColor = this.drawCall.DP_PrimColor;
        offs += fillVec4(comb, offs,
            primColor[0] * (primColorMultiplier?.[0] ?? 1),
            primColor[1] * (primColorMultiplier?.[1] ?? 1),
            primColor[2] * (primColorMultiplier?.[2] ?? 1),
            primColor[3] * primAlphaMultiplier); // primitive color
        const envColor = this.drawCall.DP_EnvColor;
        offs += fillVec4(comb, offs, envColor[0], envColor[1], envColor[2], envColor[3]); // environment color
        if (this.crossfadeDuration > 0) {
            // The game writes its integer animation counter to PRIM_LOD_FRAC.
            // Retain its 30 Hz frame boundaries, but interpolate the fraction
            // continuously so the fade stays smooth at the viewer frame rate.
            const blend = (animationTick % this.crossfadeDuration) / this.crossfadeDuration;
            offs += fillVec4(comb, offs, blend, 0, 0, 0); // primitive LOD fraction
        }
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

function makeVertexBufferData(v: readonly Vertex[]): Float32Array {
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
    public vertexStart: number;
    public indexStart: number;

    constructor(device: GfxDevice, cache: GfxRenderCache, mesh: Mesh, dynamic = false) {
        const sharedOutput = mesh.sharedOutput;
        const drawCalls = mesh.rspOutput?.drawCalls ?? [];
        this.indexStart = drawCalls.reduce(
            (start, drawCall) => Math.min(start, drawCall.firstIndex),
            sharedOutput.indices.length,
        );
        const indexEnd = drawCalls.reduce(
            (end, drawCall) => Math.max(end, drawCall.firstIndex + drawCall.indexCount),
            this.indexStart,
        );
        const sharedIndices = sharedOutput.indices.slice(this.indexStart, indexEnd);
        let vertexStart = sharedIndices.reduce(
            (start, vertexIndex) => Math.min(start, vertexIndex),
            sharedOutput.vertices.length,
        );
        let vertexEnd = sharedIndices.reduce(
            (end, vertexIndex) => Math.max(end, vertexIndex + 1),
            vertexStart,
        );
        const includeVertexRange = (firstVertex: number, vertexCount: number): void => {
            if (vertexCount <= 0)
                return;
            vertexStart = Math.min(vertexStart, firstVertex);
            vertexEnd = Math.max(vertexEnd, firstVertex + vertexCount);
        };
        if (mesh.generatedSurfaceAnimation !== undefined)
            includeVertexRange(mesh.generatedSurfaceAnimation.firstVertex, mesh.generatedSurfaceAnimation.vertexCount);
        if (mesh.actorAnimation !== undefined)
            includeVertexRange(mesh.actorAnimation.firstVertex, mesh.actorAnimation.vertexCount);
        if (mesh.propMatrixAnimation !== undefined) {
            for (const vertexOffset of mesh.propMatrixAnimation.vertexOffsets)
                includeVertexRange(mesh.propMatrixAnimation.firstVertex + vertexOffset, 1);
        }
        for (const sprite of mesh.spriteBillboards ?? [])
            includeVertexRange(sprite.firstVertex, 4);
        for (const vertexIndex of mesh.dynamicLighting?.vertexIndices ?? [])
            includeVertexRange(vertexIndex, 1);
        this.vertexStart = vertexStart;

        assert(vertexEnd - this.vertexStart <= 0xFFFFFFFF);
        this.vertexBufferData = makeVertexBufferData(sharedOutput.vertices.slice(this.vertexStart, vertexEnd));
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, dynamic ? GfxBufferFrequencyHint.Dynamic : GfxBufferFrequencyHint.Static, this.vertexBufferData.buffer);

        const indexBufferData = Uint32Array.from(sharedIndices, (vertexIndex) => vertexIndex - this.vertexStart);
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
    generatedSurfaceAnimation?: {
        surface: GeneratedSurface;
        firstVertex: number;
        vertexCount: number;
    };
    dynamicLighting?: DynamicLighting;
    actorAnimation?: SkeletalActorAnimation;
    propMatrixAnimation?: PropMatrixAnimation;
    spriteBillboards?: {
        firstVertex: number;
        origin: vec3;
        centerX: number;
        centerY: number;
        halfWidth: number;
        halfHeight: number;
        rightOffsets?: number[];
        upOffsets?: number[];
        forwardOffsets?: number[];
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
    private localBoundingBox: AABB | null | undefined;
    private lastUpdateTick = -1;
    private lightingDirty: boolean;
    private dirtyVertexRange: { start: number, end: number } | null = null;
    public dynamicLightingEnabled = true;
    private spritePrimAlphas: number[];

    constructor(device: GfxDevice, cache: GfxRenderCache, public mesh: Mesh) {
        this.renderData = new RenderData(device, cache, mesh, mesh.generatedSurfaceAnimation !== undefined || mesh.spriteBillboards !== undefined || mesh.dynamicLighting !== undefined || mesh.actorAnimation !== undefined || mesh.propMatrixAnimation !== undefined);
        this.spritePrimAlphas = mesh.rspOutput?.drawCalls.map((drawCall) => drawCall.DP_PrimColor[3]) ?? [];
        this.lightingDirty = mesh.dynamicLighting !== undefined;

        const includeVertexRange = (firstVertex: number, vertexCount: number): void => {
            if (vertexCount <= 0)
                return;
            const localFirstVertex = firstVertex - this.renderData.vertexStart;
            if (this.dirtyVertexRange === null) {
                this.dirtyVertexRange = { start: localFirstVertex, end: localFirstVertex + vertexCount };
            } else {
                this.dirtyVertexRange.start = Math.min(this.dirtyVertexRange.start, localFirstVertex);
                this.dirtyVertexRange.end = Math.max(this.dirtyVertexRange.end, localFirstVertex + vertexCount);
            }
        };
        if (mesh.generatedSurfaceAnimation !== undefined)
            includeVertexRange(mesh.generatedSurfaceAnimation.firstVertex, mesh.generatedSurfaceAnimation.vertexCount);
        if (mesh.actorAnimation !== undefined)
            includeVertexRange(mesh.actorAnimation.firstVertex, mesh.actorAnimation.vertexCount);
        if (mesh.propMatrixAnimation !== undefined) {
            for (const vertexOffset of mesh.propMatrixAnimation.vertexOffsets)
                includeVertexRange(mesh.propMatrixAnimation.firstVertex + vertexOffset, 1);
        }
        for (const sprite of mesh.spriteBillboards ?? [])
            includeVertexRange(sprite.firstVertex, 4);
        for (const vertexIndex of mesh.dynamicLighting?.vertexIndices ?? [])
            includeVertexRange(vertexIndex, 1);
    }

    public getLocalBoundingBox(): AABB | null {
        if (this.localBoundingBox === undefined) {
            this.localBoundingBox = this.mesh.rspOutput === null ? null : computeMeshLocalBoundingBox(
                this.mesh.sharedOutput,
                this.mesh.rspOutput,
                [this.mesh.propMatrixAnimation?.boundingBox, this.mesh.actorAnimation?.boundingBox],
            );
        }
        return this.localBoundingBox;
    }

    public setDynamicLightingEnabled(enabled: boolean): void {
        if (this.dynamicLightingEnabled === enabled)
            return;
        this.dynamicLightingEnabled = enabled;
        this.lightingDirty = true;
        this.lastUpdateTick = -1;
    }

    public update(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput, activeLightCache: ActiveLightCache): void {
        const animation = this.mesh.generatedSurfaceAnimation;
        const sprites = this.mesh.spriteBillboards;
        const lighting = this.mesh.dynamicLighting;
        const actorAnimation = this.mesh.actorAnimation;
        const propMatrixAnimation = this.mesh.propMatrixAnimation;
        if (animation === undefined && sprites === undefined && lighting === undefined && actorAnimation === undefined && propMatrixAnimation === undefined)
            return;
        const tick = Math.floor(viewerInput.time / (1000 / 30));
        if (tick === this.lastUpdateTick)
            return;
        const lightingIsDynamic = lighting !== undefined && lighting.lights.length > 0 && this.dynamicLightingEnabled;
        const hasPerTickUpdate = animation !== undefined || sprites !== undefined || actorAnimation !== undefined
            || propMatrixAnimation !== undefined || lightingIsDynamic;
        if (!hasPerTickUpdate && !this.lightingDirty)
            return;
        this.lastUpdateTick = tick;

        if (animation !== undefined) {
            const surface = animation.surface;
            const amplitude = surface.amplitudeS + surface.amplitudeT;
            for (let i = 0; i < animation.vertexCount; i++) {
                const vertexIndex = animation.firstVertex + i;
                const vertex = this.mesh.sharedOutput.vertices[vertexIndex];
                const y = generatedSurfaceHeight(surface, vertex.x / 3, vertex.z / 3, tick);
                const alpha = Math.max(0, Math.min(0xFF, Math.trunc(
                    ((y - surface.baseY) / amplitude) * surface.alphaRange + surface.alphaBase,
                )));
                const localVertex = (vertexIndex - this.renderData.vertexStart) * 10;
                this.renderData.vertexBufferData[localVertex + 1] = Math.trunc(y * 3);
                this.renderData.vertexBufferData[localVertex + 9] = alpha / 0xFF;
            }
        }

        if (lighting !== undefined && (lightingIsDynamic || this.lightingDirty)) {
            updateDynamicLighting(lighting, this.mesh.sharedOutput.vertices, this.renderData.vertexBufferData, this.renderData.vertexStart, activeLightCache, this.dynamicLightingEnabled);
            this.lightingDirty = false;
        }
        if (actorAnimation !== undefined)
            updateSkeletalActor(actorAnimation, this.mesh.sharedOutput.vertices, this.renderData.vertexBufferData, this.renderData.vertexStart, tick);
        if (propMatrixAnimation !== undefined)
            updatePropMatrixAnimation(propMatrixAnimation, this.renderData.vertexBufferData, this.renderData.vertexStart, tick);

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
            const signs = [-1, 1, 1, 1, 1, -1, -1, -1];
            for (let i = 0; i < 4; i++) {
                const vertex = (sprite.firstVertex + i - this.renderData.vertexStart) * 10;
                if (!active) {
                    this.renderData.vertexBufferData[vertex + 0] = sprite.origin[0];
                    this.renderData.vertexBufferData[vertex + 1] = sprite.origin[1];
                    this.renderData.vertexBufferData[vertex + 2] = sprite.origin[2];
                    continue;
                }
                const rightOffset = sprite.rightOffsets?.[i] ?? sprite.halfWidth * signs[i * 2];
                const upOffset = sprite.upOffsets?.[i] ?? sprite.halfHeight * signs[i * 2 + 1];
                const forwardOffset = sprite.forwardOffsets?.[i] ?? 0;
                this.renderData.vertexBufferData[vertex + 0] = centerX
                    + viewerInput.camera.worldMatrix[0] * rightOffset
                    + viewerInput.camera.worldMatrix[4] * upOffset
                    + viewerInput.camera.worldMatrix[8] * forwardOffset;
                this.renderData.vertexBufferData[vertex + 1] = centerY
                    + viewerInput.camera.worldMatrix[1] * rightOffset
                    + viewerInput.camera.worldMatrix[5] * upOffset
                    + viewerInput.camera.worldMatrix[9] * forwardOffset;
                this.renderData.vertexBufferData[vertex + 2] = centerZ
                    + viewerInput.camera.worldMatrix[2] * rightOffset
                    + viewerInput.camera.worldMatrix[6] * upOffset
                    + viewerInput.camera.worldMatrix[10] * forwardOffset;
            }
        }
        if (hasSpriteFade) {
            for (let i = 0; i < this.spritePrimAlphas.length; i++)
                this.mesh.rspOutput!.drawCalls[i].DP_PrimColor[3] = this.spritePrimAlphas[i] * spriteFade;
        }

        if (this.dirtyVertexRange !== null) {
            const byteOffset = this.dirtyVertexRange.start * 10 * 4;
            const byteLength = (this.dirtyVertexRange.end - this.dirtyVertexRange.start) * 10 * 4;
            device.uploadBufferData(
                this.renderData.vertexBuffer,
                byteOffset,
                new Uint8Array(this.renderData.vertexBufferData.buffer, byteOffset, byteLength),
            );
        }
    }

    public destroy(device: GfxDevice): void {
        this.renderData.destroy(device);
    }
}

enum SceneRenderLayer {
    MapGeometry,
    Props,
    Actors,
    Surfaces,
    Effects,
}

class MeshRenderer {
    public drawCallInstances: DrawCallInstance[] = [];

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4, isSkybox: boolean, primAlphaMultiplier = 1, primColorMultiplier: vec3 | null = null): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].prepareToRender(device, renderInstManager, viewerInput, modelMatrix, isSkybox, primAlphaMultiplier, primColorMultiplier);
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

    public setFogEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setFogEnabled(v);
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
    private cullParent: CullGroup | null = null;
    private cullBoundingBox: AABB | null = null;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    public isSkybox = false;
    public sortKeyBase = makeSortKey(GfxRendererLayer.OPAQUE);
    public modelMatrix = mat4.create();
    public distanceFade: { origin: vec3; startDistance: number; endDistance: number } | null = null;
    private rootTransformAnimation: {
        baseMatrix: mat4;
        rotationYRadiansPerTick: number;
        positionYAmplitude: number;
        positionYRadiansPerTick: number;
    } | null = null;
    private computeLookAt = false;
    private cameraBillboard: { origin: vec3; scale: number } | null = null;
    private objectLighting: ObjectLighting | null = null;
    private objectLightColor = vec3.create();

    public objectFlags = 0;
    private rootNodeRenderer: MeshRenderer;
    private ownsRootNodeRenderer: boolean;

    constructor(
        device: GfxDevice,
        cache: GfxRenderCache,
        private geometryData: MeshData,
        public renderLayer: SceneRenderLayer,
        private fogParams: FogParams,
        sharedRenderer: RootMeshRenderer | null = null,
    ) {
        this.megaStateFlags = {};
        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });

        const geo = this.geometryData.mesh;
        this.computeLookAt = geo.rspOutput?.drawCalls.some((drawCall) => {
            const requiredModes = RSP_Geometry.G_LIGHTING | RSP_Geometry.G_TEXTURE_GEN;
            return (drawCall.SP_GeometryMode & requiredModes) === requiredModes;
        }) ?? false;

        if (sharedRenderer !== null) {
            assert(sharedRenderer.geometryData === geometryData);
            this.rootNodeRenderer = sharedRenderer.rootNodeRenderer;
            this.ownsRootNodeRenderer = false;
        } else {
            this.rootNodeRenderer = this.buildGeoNodeRenderer(device, cache, geo);
            this.ownsRootNodeRenderer = true;
        }
    }

    private buildGeoNodeRenderer(device: GfxDevice, cache: GfxRenderCache, node: Mesh): MeshRenderer {
        const geoNodeRenderer = new MeshRenderer();

        if (node.rspOutput !== null) {
            for (let i = 0; i < node.rspOutput.drawCalls.length; i++) {
                const drawCall = node.rspOutput.drawCalls[i];
                const drawCallInstance = new DrawCallInstance(device, cache, node.sharedOutput, drawCall, drawCall.firstIndex - this.geometryData.renderData.indexStart, this.fogParams);
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

    public setFogEnabled(v: boolean): void {
        this.rootNodeRenderer.setFogEnabled(v);
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        this.rootNodeRenderer.setMonochromeVertexColorsEnabled(v);
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        this.rootNodeRenderer.setAlphaVisualizerEnabled(v);
    }

    public setVisible(v: boolean): void {
        this.visible = v;
    }

    public setCullBoundingBox(boundingBox: AABB): void {
        this.cullBoundingBox = boundingBox;
    }

    public setCullParent(cullGroup: CullGroup): void {
        this.cullParent = cullGroup;
    }

    public computeWorldBoundingBox(): AABB | null {
        const localBoundingBox = this.geometryData.getLocalBoundingBox();
        if (localBoundingBox === null)
            return null;
        return computeMeshWorldBoundingBox(
            localBoundingBox,
            this.modelMatrix,
            this.rootTransformAnimation,
        );
    }

    public setRotationYAnimation(anglePerTick: number): void {
        this.ensureRootTransformAnimation();
        this.rootTransformAnimation!.rotationYRadiansPerTick = anglePerTick / 0x1000 * Math.PI * 2;
    }

    public setPositionYAnimation(amplitude: number, anglePerTick: number): void {
        this.ensureRootTransformAnimation();
        this.rootTransformAnimation!.positionYAmplitude = amplitude;
        this.rootTransformAnimation!.positionYRadiansPerTick = anglePerTick / 0x1000 * Math.PI * 2;
    }

    public setCameraBillboard(origin: vec3, scale: number): void {
        this.cameraBillboard = { origin, scale };
    }

    private ensureRootTransformAnimation(): void {
        if (this.rootTransformAnimation !== null)
            return;
        this.rootTransformAnimation = {
            baseMatrix: mat4.clone(this.modelMatrix),
            rotationYRadiansPerTick: 0,
            positionYAmplitude: 0,
            positionYRadiansPerTick: 0,
        };
    }

    public setObjectLighting(lighting: ObjectLighting): void {
        this.objectLighting = lighting;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, activeLightCache: ActiveLightCache): void {
        if (!this.visible)
            return;
        if (this.cullParent !== null && !this.cullParent.visible)
            return;
        if (this.cullBoundingBox !== null
            && !viewerInput.camera.frustum.contains(this.cullBoundingBox))
            return;

        if (this.rootTransformAnimation !== null) {
            const animation = this.rootTransformAnimation;
            mat4.copy(this.modelMatrix, animation.baseMatrix);
            const tick = Math.floor(viewerInput.time / (1000 / 30));
            mat4.rotateY(this.modelMatrix, this.modelMatrix, tick * animation.rotationYRadiansPerTick);
            this.modelMatrix[13] += Math.sin(tick * animation.positionYRadiansPerTick)
                * animation.positionYAmplitude;
        } else if (this.cameraBillboard !== null) {
            const billboard = this.cameraBillboard;
            scaleMatrix(this.modelMatrix, viewerInput.camera.worldMatrix, billboard.scale);
            setMatrixTranslation(this.modelMatrix, billboard.origin);
        }

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

        this.geometryData.update(device, viewerInput, activeLightCache);
        const renderData = this.geometryData.renderData;

        const template = renderInstManager.pushTemplate();
        template.setBindingLayouts(bindingLayouts);
        template.setVertexInput(renderData.inputLayout, renderData.vertexBufferDescriptors, renderData.indexBufferDescriptor);
        template.setMegaStateFlags(this.megaStateFlags);

        template.sortKey = this.sortKeyBase;

        const sceneParamsSize = 16 + (this.computeLookAt ? 8 : 0);

        let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, sceneParamsSize);
        const mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);

        if (this.computeLookAt) {
            // compute lookat X and Y in view space, since that's the transform the shader will have
            mat4.getTranslation(lookatScratch, this.modelMatrix);
            vec3.transformMat4(lookatScratch, lookatScratch, viewerInput.camera.viewMatrix);

            mat4.lookAt(modelViewScratch, Vec3Zero, lookatScratch, Vec3UnitY);
            offs += fillVec4(mappedF32, offs, modelViewScratch[0], modelViewScratch[4], modelViewScratch[8]);
            offs += fillVec4(mappedF32, offs, modelViewScratch[1], modelViewScratch[5], modelViewScratch[9]);
        }

        const objectLightColor = this.objectLighting !== null
            ? sampleObjectLighting(this.objectLightColor, this.objectLighting, activeLightCache, this.geometryData.dynamicLightingEnabled)
            : null;
        this.rootNodeRenderer.prepareToRender(device, renderInstManager, viewerInput, this.modelMatrix, this.isSkybox, primAlphaMultiplier, objectLightColor);

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        if (this.ownsRootNodeRenderer)
            this.rootNodeRenderer.destroy(device);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 2, },
];

export class DK64Renderer implements Viewer.SceneGfx {
    public renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    private backdropRenderer: BackdropRenderer | null;
    private sceneCuller = new SceneCuller();
    private activeLightCache: ActiveLightCache;

    public meshDatas: MeshData[] = [];
    public meshRenderers: RootMeshRenderer[] = [];
    public fogParams: FogParams;

    public textureHolder = new FakeTextureHolder([]);

    public addMeshData(device: GfxDevice, cache: GfxRenderCache, mesh: Mesh): MeshData {
        const meshData = new MeshData(device, cache, mesh);
        this.meshDatas.push(meshData);
        return meshData;
    }

    public addPropMeshRenderer(device: GfxDevice, cache: GfxRenderCache, meshData: MeshData, sharedRenderer: RootMeshRenderer | null = null): RootMeshRenderer {
        const renderer = new RootMeshRenderer(device, cache, meshData, SceneRenderLayer.Props, this.fogParams, sharedRenderer);
        this.meshRenderers.push(renderer);
        return renderer;
    }

    public addChunkBoundingBox(chunkID: number, boundingBox: AABB): CullGroup {
        return this.sceneCuller.addChunkBoundingBox(chunkID, boundingBox);
    }

    public setObjectCullBoundingBox(renderer: RootMeshRenderer, objectBoundingBox: AABB | null): void {
        this.sceneCuller.setObjectCullBoundingBox(renderer, objectBoundingBox);
    }

    constructor(device: GfxDevice, sceneID: number, clipNear: number, clipFar: number, backdrop: BackdropData | null, dynamicLights: readonly DynamicLight[]) {
        this.renderHelper = new GfxRenderHelper(device);
        this.backdropRenderer = createBackdropRenderer(device, this.renderHelper.renderCache, backdrop, sceneID);
        this.activeLightCache = new ActiveLightCache(dynamicLights);
        // func_global_asm_80648C84 overrides Aztec's generic 990 start with
        // 995 while its map-specific fog animation is idle. The animation can
        // temporarily lower it toward 970 during gameplay.
        const fogNearPosition = sceneID === 0x26 ? 995 : 990;
        this.fogParams = {
            // gSPFogPosition is expressed in projected-depth units. Convert
            // through DK64's map projection instead of noclip's projection.
            near: fogPositionToViewDistance(fogNearPosition, clipNear, clipFar),
            far: fogPositionToViewDistance(999, clipNear, clipFar),
            color: sceneID === 0x26
                ? [0x8A / 0xFF, 0x52 / 0xFF, 0x16 / 0xFF, 0]
                : [0, 0, 0, 0],
        };
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(30/60);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');

        const enableCullingCheckbox = new UI.Checkbox('Enable Backface Culling', true);
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

        const enableDynamicLightingCheckbox = new UI.Checkbox('Enable Dynamic Lighting', true);
        enableDynamicLightingCheckbox.onchanged = () => {
            for (const meshData of this.meshDatas)
                meshData.setDynamicLightingEnabled(enableDynamicLightingCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableDynamicLightingCheckbox.elem);

        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (const meshRenderer of this.meshRenderers)
                meshRenderer.setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        const enableFog = new UI.Checkbox('Enable Fog', false);
        enableFog.onchanged = () => {
            for (const meshRenderer of this.meshRenderers)
                meshRenderer.setFogEnabled(enableFog.checked);
        };
        renderHacksPanel.contents.appendChild(enableFog.elem);

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

        const addVisibilityCheckbox = (label: string, layer: SceneRenderLayer): void => {
            const checkbox = new UI.Checkbox(label, true);
            checkbox.onchanged = () => {
                for (const meshRenderer of this.meshRenderers) {
                    if (meshRenderer.renderLayer === layer)
                        meshRenderer.setVisible(checkbox.checked);
                }
            };
            renderHacksPanel.contents.appendChild(checkbox.elem);
        };
        addVisibilityCheckbox('Show Map Geometry', SceneRenderLayer.MapGeometry);
        addVisibilityCheckbox('Show Actors', SceneRenderLayer.Actors);
        addVisibilityCheckbox('Show Props', SceneRenderLayer.Props);
        addVisibilityCheckbox('Show Surfaces', SceneRenderLayer.Surfaces);
        addVisibilityCheckbox('Show Effects', SceneRenderLayer.Effects);

        const showChunkBoundsCheckbox = new UI.Checkbox('Show Chunk Bounds', false);
        showChunkBoundsCheckbox.onchanged = () => {
            this.sceneCuller.showBounds = showChunkBoundsCheckbox.checked;
        };
        renderHacksPanel.contents.appendChild(showChunkBoundsCheckbox.elem);

        return [renderHacksPanel];
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);

        const template = this.renderHelper.pushTemplateRenderInst();
        this.backdropRenderer?.prepareToRender(this.renderHelper.renderInstManager, viewerInput);

        template.setBindingLayouts(bindingLayouts);

        const tick = Math.floor(viewerInput.time / (1000 / 30));
        this.activeLightCache.update(viewerInput.camera.worldMatrix, tick);
        this.sceneCuller.prepareToRender(viewerInput.camera.frustum);
        for (let i = 0; i < this.meshRenderers.length; i++)
            this.meshRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput, this.activeLightCache);

        this.renderHelper.renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const debugDraw = this.renderHelper.debugDraw;
        const showChunkBounds = this.sceneCuller.showBounds;
        if (showChunkBounds) {
            debugDraw.beginFrame(
                viewerInput.camera.projectionMatrix,
                viewerInput.camera.viewMatrix,
                viewerInput.backbufferWidth,
                viewerInput.backbufferHeight,
            );
            this.sceneCuller.drawBounds(debugDraw);
        }

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
        if (showChunkBounds)
            debugDraw.pushPasses(builder, mainColorTargetID, mainDepthTargetID);
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        builder.execute();
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice): void {
        this.backdropRenderer?.destroy(device);
        this.renderHelper.destroy();
        for (let i = 0; i < this.meshRenderers.length; i++)
            this.meshRenderers[i].destroy(device);
        for (let i = 0; i < this.meshDatas.length; i++)
            this.meshDatas[i].destroy(device);
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

class CommonData {
    public SpriteData: SpriteData[];
    public CustomScriptFunctionData: number[];
    public TexData: ArrayBufferSlice[] = [];
    public AnimTexData: ArrayBufferSlice[] = [];

    constructor(buffer: ArrayBufferSlice) {
        const obj: any = BYML.parse(buffer, BYML.FileType.CRG1);

        this.SpriteData = obj.SpriteData ?? [];
        this.CustomScriptFunctionData = obj.CustomScriptFunctionData ?? [];
        applyTextureEntries(this.TexData, obj.TexData, true);
        if (obj.AnimTexData === undefined)
            throw new Error('DK64 common archive is missing animated textures; rerun npm run build:DonkeyKong64');
        applyTextureEntries(this.AnimTexData, obj.AnimTexData, false);
    }

    public destroy(device: GfxDevice): void {
    }
}

function applyTextureEntries(target: ArrayBufferSlice[], entries: any[] | undefined, compressed: boolean): void {
    for (const entry of entries ?? [])
        target[entry.ID] = compressed ? decompress(entry.Data) : entry.Data;
}

function overlayTextureData(target: ArrayBufferSlice[], source: ArrayBufferSlice[]): void {
    for (let id = 0; id < source.length; id++) {
        if (source[id] !== undefined)
            target[id] = source[id];
    }
}

class TextureData {
    public TexData: ArrayBufferSlice[] = [];
    public AnimTexData: ArrayBufferSlice[] = [];

    constructor(buffer: ArrayBufferSlice) {
        const obj: any = BYML.parse(buffer, BYML.FileType.CRG1);
        applyTextureEntries(this.TexData, obj.TexData, true);
        applyTextureEntries(this.AnimTexData, obj.AnimTexData, false);
    }

    public destroy(device: GfxDevice): void {
    }
}

export class ROMData {
    public MapData: ArrayBufferSlice;
    public Backdrop: BackdropData | null;
    public PropGeometryData = new Map<number, ArrayBufferSlice>();
    public ActorDefinitions = new Map<number, number>();
    public ActorGeometryData = new Map<number, ArrayBufferSlice>();
    public AnimationData = new Map<number, ArrayBufferSlice>();
    public SetupData: ArrayBufferSlice;
    public ScriptData: ArrayBufferSlice;
    public CritterData: ArrayBufferSlice | null;
    public EnvironmentParticleData: EnvironmentParticleData[];

    public SpriteData: SpriteData[];
    public CustomScriptFunctionData: number[];
    public TexData: ArrayBufferSlice[];
    public AnimTexData: ArrayBufferSlice[];

    constructor(common: CommonData, level: any, commonTextureGroups: TextureData[], unknown: TextureData | null) {
        this.MapData = level.MapData;
        this.SetupData = level.SetupData;
        this.ScriptData = level.ScriptData;
        this.CritterData = level.CritterData;
        this.EnvironmentParticleData = level.EnvironmentParticleData ?? [];
        for (const prop of level.PropGeometry ?? [])
            this.PropGeometryData.set(prop.Type, prop.Data);
        for (const actor of level.ActorDefinitions ?? [])
            this.ActorDefinitions.set(actor.Type, actor.Model);
        for (const actor of level.ActorGeometry ?? [])
            this.ActorGeometryData.set(actor.Model, actor.Data);
        for (const animation of level.AnimationData ?? [])
            this.AnimationData.set(animation.ID, animation.Data);

        this.SpriteData = common.SpriteData;
        this.CustomScriptFunctionData = common.CustomScriptFunctionData;
        this.TexData = common.TexData.slice();
        this.AnimTexData = common.AnimTexData.slice();
        for (const group of commonTextureGroups) {
            overlayTextureData(this.TexData, group.TexData);
            overlayTextureData(this.AnimTexData, group.AnimTexData);
        }
        if (unknown !== null) {
            overlayTextureData(this.TexData, unknown.TexData);
            overlayTextureData(this.AnimTexData, unknown.AnimTexData);
        }
        applyTextureEntries(this.TexData, level.TexData, true);
        applyTextureEntries(this.AnimTexData, level.AnimTexData, false);
        const backdrop = level.Backdrop ?? null;
        if (backdrop !== null) {
            const data = this.TexData[backdrop.TextureIndex];
            assert(data !== undefined);
            this.Backdrop = { TextureID: backdrop.TextureID, Data: data };
        } else {
            this.Backdrop = null;
        }
    }

    public loadSetup(): ArrayBufferSlice {
        return decompress(this.SetupData);
    }

    public loadPropGeometry(propType: number): ArrayBufferSlice {
        const data = this.PropGeometryData.get(propType);
        assert(data !== undefined);
        return decompress(data);
    }

    public loadActorGeometry(model: number): ArrayBufferSlice {
        const data = this.ActorGeometryData.get(model);
        assert(data !== undefined);
        return decompress(data);
    }

    public loadAnimation(id: number): ArrayBufferSlice {
        const data = this.AnimationData.get(id);
        assert(data !== undefined);
        return data;
    }

    public loadScripts(): ArrayBufferSlice {
        return decompress(this.ScriptData);
    }

    public destroy(device: GfxDevice): void {
    }
}


function addSceneActors(
    device: GfxDevice,
    cache: GfxRenderCache,
    sceneRenderer: DK64Renderer,
    sharedOutput: RSPSharedOutput,
    romData: ROMData,
    setupActors: readonly SetupActor[],
    worldScale: number,
    lightingEnvironment: ObjectLightingEnvironment,
): void {
    const actors: { actor: SetupActor, definition: ActorRenderDefinition }[] = [];
    for (const actor of setupActors) {
        const definition = getActorRenderDefinition(actor.type, romData.ActorDefinitions.get(actor.type) ?? 0);
        if (definition !== null)
            actors.push({ actor, definition });
    }
    if (actors.length === 0)
        return;

    if (romData.ActorGeometryData.size === 0) {
        console.warn(
            `[DK64 actor] level archive has no ActorGeometry. `
            + `Regenerate the DK64 data archives to render actors.`,
        );
        return;
    }

    const meshDataByDefinition = new Map<string, MeshData | null>();
    const warnedModels = new Set<number>();
    for (const { actor, definition } of actors) {
        if (!romData.ActorGeometryData.has(definition.model)) {
            console.warn(`[DK64 actor] model 0x${definition.model.toString(16).padStart(2, '0')} is missing from the level archive`);
            continue;
        }
        if (definition.animation !== null && !romData.AnimationData.has(definition.animation)) {
            console.warn(`[DK64 actor] animation 0x${definition.animation.toString(16)} is missing from the level archive`);
            continue;
        }
        const animationSpeed = definition.animationSpeed === 'setup' ? actor.lightSpeed : definition.animationSpeed;
        const meshKey = `${definition.model}:${definition.animation ?? -1}:${animationSpeed}`;
        let meshData = meshDataByDefinition.get(meshKey);
        if (meshData === undefined) {
            let actorMesh: SkeletalActorMesh | null = null;
            try {
                switch (definition.renderer) {
                case 'skeletal':
                    actorMesh = buildSkeletalActorMesh(
                        romData.loadActorGeometry(definition.model),
                        definition.animation !== null ? romData.loadAnimation(definition.animation) : null,
                        definition.animation,
                        animationSpeed,
                        actor,
                        romData.TexData,
                        sharedOutput,
                    );
                    break;
                }
            } catch (e) {
                // Actor setup is opt-out: malformed or unsupported model
                // families are isolated here instead of aborting the scene.
                if (!warnedModels.has(definition.model)) {
                    warnedModels.add(definition.model);
                    console.warn(
                        `[DK64 actor] model 0x${definition.model.toString(16).padStart(2, '0')} is not renderable yet`,
                        e,
                    );
                }
            }
            if (actorMesh !== null) {
                const actorAnimation = definition.animation !== null ? actorMesh.animation : undefined;
                if (actorAnimation === undefined)
                    updateSkeletalActor(actorMesh.animation, sharedOutput.vertices, null, 0, 0);
                const mesh: Mesh = {
                    sharedOutput,
                    rspState: actorMesh.rspState,
                    rspOutput: actorMesh.rspOutput,
                    actorAnimation,
                };
                meshData = new MeshData(device, cache, mesh);
                sceneRenderer.meshDatas.push(meshData);
            } else {
                meshData = null;
            }
            meshDataByDefinition.set(meshKey, meshData);
        }
        if (meshData === null)
            continue;
        const rendererScale = actor.scale * actorModelScale * worldScale;
        const renderer = new RootMeshRenderer(device, cache, meshData, SceneRenderLayer.Actors, sceneRenderer.fogParams);
        const origin = vec3.fromValues(
            actor.position[0] * worldScale,
            actor.position[1] * worldScale,
            actor.position[2] * worldScale,
        );
        mat4.translate(renderer.modelMatrix, renderer.modelMatrix, [
            origin[0],
            origin[1],
            origin[2],
        ]);
        mat4.rotateY(renderer.modelMatrix, renderer.modelMatrix, actor.rotationY / 0x1000 * Math.PI * 2);
        mat4.scale(renderer.modelMatrix, renderer.modelMatrix, [rendererScale, rendererScale, rendererScale]);
        renderer.setObjectLighting(buildObjectLighting(lightingEnvironment, origin));
        if (definition.rotationYSpeed !== undefined)
            renderer.setRotationYAnimation(definition.rotationYSpeed);
        if (definition.positionYAmplitude !== undefined)
            renderer.setPositionYAnimation(definition.positionYAmplitude * worldScale, definition.rotationYSpeed ?? 0);
        sceneRenderer.setObjectCullBoundingBox(renderer, renderer.computeWorldBoundingBox());
        sceneRenderer.meshRenderers.push(renderer);
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
            const renderer = new RootMeshRenderer(device, cache, meshData, SceneRenderLayer.Effects, sceneRenderer.fogParams);
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

function addEnvironmentalEffects(device: GfxDevice, cache: GfxRenderCache, sceneRenderer: DK64Renderer, sharedOutput: RSPSharedOutput, romData: ROMData, map: DK64Map, mapID: number, props: readonly SetupProp[], scripts: InstanceScript[]): void {
    const propsByID = new Map(props.map((prop) => [prop.id, prop]));
    const spriteByAddress = new Map(romData.SpriteData.map((sprite) => [sprite.address, sprite]));
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
        const sceneID = parseInt(this.id, 16);
        const [commonData, levelBuffer] = await Promise.all([
            context.dataShare.ensureObject(`${pathBase}/CommonData`, async () => {
                return new CommonData(await dataFetcher.fetchData(`${pathBase}/common.crg1`));
            }),
            dataFetcher.fetchData(`${pathBase}/${this.id}.crg1`),
        ]);
        const levelData: any = BYML.parse(levelBuffer, BYML.FileType.CRG1);
        const commonTextureGroupIDs: number[] = levelData.CommonTextureGroups ?? [];
        for (const groupID of commonTextureGroupIDs)
            assert(Number.isInteger(groupID) && groupID >= 0 && groupID < 0x20);
        const [commonTextureGroups, unknownData] = await Promise.all([
            Promise.all(commonTextureGroupIDs.map((groupID) => {
                const suffix = hexzero(groupID, 2).toUpperCase();
                return context.dataShare.ensureObject(`${pathBase}/CommonTextureData/${suffix}`, async () => {
                    return new TextureData(await dataFetcher.fetchData(`${pathBase}/common_${suffix}.crg1`));
                });
            })),
            levelData.UsesUnknownTextures
                ? context.dataShare.ensureObject(`${pathBase}/UnknownData`, async () => {
                    return new TextureData(await dataFetcher.fetchData(`${pathBase}/unknown.crg1`));
                })
                : Promise.resolve(null),
        ]);
        const romData = new ROMData(commonData, levelData, commonTextureGroups, unknownData);
        const map = new DK64Map(decompress(romData.MapData), romData.AnimTexData);
        const setup = parseSetup(romData.loadSetup());
        const scripts = parseInstanceScripts(romData.loadScripts());
        const dynamicLights = buildDynamicLights(
            setup,
            (type) => romData.loadPropGeometry(type).createDataView(),
            {
                loadActorGeometry: (model) => romData.ActorGeometryData.has(model) ? romData.loadActorGeometry(model) : null,
                loadAnimation: (animation) => romData.AnimationData.has(animation) ? romData.loadAnimation(animation) : null,
            },
        );
        const objectLightingEnvironment = buildObjectLightingEnvironment(map.vertBin, map.chunks, dynamicLights);

        const sharedOutput = new RSPSharedOutput();
        const sceneRenderer = new DK64Renderer(device, sceneID, map.clipNear, map.clipFar, romData.Backdrop, dynamicLights);
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
            animatedTextures.unshift(...resolveAnimatedMaterialTextures(
                getSceneNodeAnimatedTextureBindings(dl.materialIndex),
                romData.AnimTexData,
            ));
            const state = new RSPState(romData.TexData, segmentBuffers, sharedOutput, animatedTextures);
            // func_global_asm_806592B4 applies global fog before ordinary
            // map display lists are submitted.
            initDL(state, true, map.fogEnabled);
            if (dl.materialIndex !== null)
                initSceneNodeMaterial(state, dl.materialIndex, map.fogEnabled, sceneID);
            const firstVertex = sharedOutput.vertices.length;
            runDL_F3DEX2(state, 0x07000000 | dl.dlStartAddr, dl.ChunkID >= 0);

            const output = state.finish();

            if (output === null) {
                // TODO(jstpierre): Warn?
                continue;
            }

            const chunk = dl.ChunkID >= 0 ? map.chunks[dl.ChunkID] ?? null : null;
            const mesh: Mesh = {
                sharedOutput,
                rspState: state,
                rspOutput: output,
                dynamicLighting: buildMapChunkLighting(
                    sharedOutput, output.drawCalls, firstVertex,
                    state.vertexSourceAddresses, dl.VertStartIndex * 0x10,
                    chunk, dynamicLights,
                ),
            };
            const meshData = new MeshData(device, cache, mesh);
            sceneRenderer.meshDatas.push(meshData);

            const renderLayer = dl.materialIndex === null
                ? SceneRenderLayer.MapGeometry
                : SceneRenderLayer.Surfaces;
            const meshRenderer = new RootMeshRenderer(device, cache, meshData, renderLayer, sceneRenderer.fogParams);
            if (dl.ChunkID >= 0) {
                const boundingBox = meshData.getLocalBoundingBox();
                if (boundingBox !== null) {
                    meshRenderer.setCullBoundingBox(boundingBox);
                    meshRenderer.setCullParent(sceneRenderer.addChunkBoundingBox(dl.ChunkID, boundingBox));
                }
            }
            sceneRenderer.meshRenderers.push(meshRenderer);
        }

        // Capture only the map display-list geometry. The game obtains these
        // planes from its floor-collision query; the rendered triangles give
        // the decal pass the corresponding visible surface without archiving
        // a second copy of the map collision data.
        const terrainTriangles = buildTerrainTriangles(sharedOutput);
        // Streamed maps store their map vertices at three times setup-space
        // coordinates. Single-model maps such as DK's House store both map
        // vertices and setup objects in the same coordinate space.
        const setupWorldScale = map.chunkCount > 0 ? 3 : 1;

        for (const surface of map.generatedSurfaces) {
            const vertexBuffer = createGeneratedSurfaceVertexBuffer(surface);
            const segmentBuffers: ArrayBufferSlice[] = [];
            segmentBuffers[0x08] = vertexBuffer;
            const materialTextures = resolveAnimatedMaterialTextures(
                getGeneratedSurfaceAnimatedTextureBindings(surface.materialIndex),
                romData.AnimTexData,
            );
            const state = new RSPState(romData.TexData, segmentBuffers, sharedOutput, materialTextures);
            initDL(state, false);
            initGeneratedSurfaceMaterial(state, surface.materialIndex, surface);

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
                generatedSurfaceAnimation: {
                    surface,
                    firstVertex,
                    vertexCount: sharedOutput.vertices.length - firstVertex,
                },
            };
            const meshData = new MeshData(device, cache, mesh);
            sceneRenderer.meshDatas.push(meshData);
            sceneRenderer.meshRenderers.push(new RootMeshRenderer(device, cache, meshData, SceneRenderLayer.Surfaces, sceneRenderer.fogParams));
        }

        addModel2Props(device, cache, sceneRenderer, sharedOutput, romData, setup.props, scripts, terrainTriangles, setupWorldScale, map.fogEnabled, objectLightingEnvironment);
        addSceneActors(device, cache, sceneRenderer, sharedOutput, romData, setup.actors, setupWorldScale, objectLightingEnvironment);
        addEnvironmentalEffects(device, cache, sceneRenderer, sharedOutput, romData, map, sceneID, setup.props, scripts);
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
