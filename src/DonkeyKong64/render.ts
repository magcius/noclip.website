import { mat4, vec3 } from 'gl-matrix';

import * as Viewer from '../viewer.js';
import { Vertex } from '../BanjoKazooie/f3dex.js';
import { F3DEX_Program } from '../BanjoKazooie/render.js';
import { computeViewMatrix } from '../Camera.js';
import { TextFilt } from '../Common/N64/Image.js';
import { OtherModeH_Layout, Texture, translateCM } from '../Common/N64/RDP.js';
import { calcTextureMatrixFromRSPState } from '../Common/N64/RSP.js';
import { createBufferFromData } from '../gfx/helpers/BufferHelpers.js';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers.js';
import { fillMatrix4x2, fillMatrix4x3, fillMatrix4x4, fillVec4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { GfxBlendFactor, GfxBlendMode, GfxBindingLayoutDescriptor, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, makeTextureDescriptor2D } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxRendererLayer, GfxRenderInstManager, makeSortKey } from '../gfx/render/GfxRenderInstManager.js';
import { AABB } from '../Geometry.js';
import { getMatrixTranslation, MathConstants, scaleMatrix, setMatrixTranslation, vec3SetAll, Vec3UnitY, Vec3Zero } from '../MathHelpers.js';
import { translateBlendMode, translateCullMode } from '../PokemonSnap/f3dex2.js';
import { DeviceProgram } from '../Program.js';
import { TextureMapping } from '../TextureHolder.js';
import { assert, nArray } from '../util.js';
import type { ActorAnimationState } from './actors.js';
import { DrawCall, RSP_Geometry, RSPOutput, RSPSharedOutput, RSPState } from './f3dex2.js';
import { ActiveLightCache, sampleObjectLighting, updateDynamicLighting } from './light.js';
import type { DynamicLighting, ObjectLighting } from './light.js';
import type { GeneratedSurface } from './parse.js';
import type { PropAnimationState } from './props.js';

const scratchVec3a = vec3.create();

function translateTexture(device: GfxDevice, texture: Texture): GfxTexture {
    const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, 1));
    device.setResourceName(gfxTexture, texture.name);
    device.uploadTextureData(gfxTexture, 0, [texture.pixels]);
    return gfxTexture;
}

export class DK64TextureCache {
    private textures = new Map<Texture, GfxTexture>();

    public getTexture(device: GfxDevice, texture: Texture): GfxTexture {
        let gfxTexture = this.textures.get(texture);
        if (gfxTexture === undefined) {
            gfxTexture = translateTexture(device, texture);
            this.textures.set(texture, gfxTexture);
        }
        return gfxTexture;
    }

    public destroy(device: GfxDevice): void {
        for (const texture of this.textures.values())
            device.destroyTexture(texture);
        this.textures.clear();
    }
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

export function generatedSurfaceHeight(surface: GeneratedSurface, x: number, z: number, tick: number): number {
    const phaseS = tick * surface.phaseSpeedS;
    const phaseT = tick * surface.phaseSpeedT;
    const angleS = (phaseS + Math.trunc(surface.frequencyS * x)) % 0x0FFF;
    const angleT = (phaseT + Math.trunc(surface.frequencyT * z)) % 0x0FFF;
    return surface.baseY
        + Math.sin(angleS * MathConstants.TAU / 0x1000) * surface.amplitudeS
        + Math.sin(angleT * MathConstants.TAU / 0x1000) * surface.amplitudeT;
}

export interface FogParams {
    near: number;
    far: number;
    color: readonly [number, number, number, number];
}

export function fogPositionToViewDistance(position: number, clipNear: number, clipFar: number): number {
    const normalizedPosition = position / 1000;
    return clipNear * clipFar / (clipFar - normalizedPosition * (clipFar - clipNear));
}

class DrawCallInstance {
    private textureEntry: Texture[] = [];
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
    private crossfadeDurationFrames = 0;
    private viewMatrix = mat4.create();
    private boneModelViewMatrix = mat4.create();
    private textureMatrix = mat4.create();

    constructor(device: GfxDevice, cache: GfxRenderCache, gfxTextureCache: DK64TextureCache, sharedOutput: RSPSharedOutput, private drawCall: DrawCall, private firstIndex: number, private fogParams: FogParams, private boneMatrices: mat4[] | undefined) {
        const linearFiltering = ((drawCall.DP_OtherModeH >>> OtherModeH_Layout.G_MDSFT_TEXTFILT) & 0x03) === TextFilt.G_TF_BILERP;
        for (let i = 0; i < this.textureMappings.length; i++) {
            const textureIndex = drawCall.textureIndices[i];
            if (textureIndex === undefined)
                continue;
            const tex = sharedOutput.textureCache.textures[textureIndex];

            if (tex) {
                this.textureEntry[i] = tex;
                this.textureMappings[i].gfxTexture = gfxTextureCache.getTexture(device, tex);
                this.textureMappings[i].gfxSampler = translateSampler(cache, tex, linearFiltering);
            }

            const textureAnimation = drawCall.textureAnimations[i];
            if (textureAnimation !== undefined) {
                const textures = textureAnimation.textureIndices.map((index) => sharedOutput.textureCache.textures[index]);
                this.animatedTextureMappings[i] = textures.map((texture, frame) => {
                    if (frame === 0)
                        return this.textureMappings[i];
                    const mapping = new TextureMapping();
                    mapping.gfxTexture = gfxTextureCache.getTexture(device, texture);
                    mapping.gfxSampler = translateSampler(cache, texture, linearFiltering);
                    return mapping;
                });
            }
        }
        const crossfadeGroup0 = drawCall.textureAnimations[0]?.crossfadeGroup;
        const crossfadeGroup1 = drawCall.textureAnimations[1]?.crossfadeGroup;
        if (crossfadeGroup0 !== null && crossfadeGroup0 !== undefined && crossfadeGroup0 === crossfadeGroup1)
            this.crossfadeDurationFrames = Math.max(drawCall.textureAnimations[0]!.frameDuration, 1);

        this.megaStateFlags = translateBlendMode(this.drawCall.SP_GeometryMode, this.drawCall.DP_OtherModeL);
        this.isTranslucent = this.crossfadeDurationFrames > 0 || renderModeIsTranslucent(this.megaStateFlags);
        this.setBackfaceCullingEnabled(true);
        this.createProgram();
    }

    private createProgram(): void {
        const program = new F3DEX_Program(this.drawCall.DP_OtherModeH, this.drawCall.DP_OtherModeL, this.drawCall.DP_Combine);
        program.defines.set('BONE_MATRIX_COUNT', (this.boneMatrices?.length ?? 1).toString());

        if (this.texturesEnabled && this.textureEntry.length)
            program.defines.set('USE_TEXTURE', '1');

        if (this.drawCall.SP_GeometryMode & RSP_Geometry.G_LIGHTING)
            program.defines.set('LIGHTING', '1');

        if (this.vertexColorsEnabled && (this.drawCall.SP_GeometryMode & RSP_Geometry.G_SHADE) !== 0)
            program.defines.set('USE_VERTEX_COLOR', '1');

        if (this.drawCall.SP_GeometryMode & RSP_Geometry.G_TEXTURE_GEN)
            program.defines.set('TEXTURE_GEN', '1');

        // many display lists seem to set this flag without setting texture_gen,
        // despite this one being dependent on it
        if (this.drawCall.SP_GeometryMode & RSP_Geometry.G_TEXTURE_GEN_LINEAR)
            program.defines.set('TEXTURE_GEN_LINEAR', '1');

        if (this.fogEnabled && (this.drawCall.SP_GeometryMode & RSP_Geometry.G_FOG))
            program.defines.set('USE_FOG', '1');

        if (this.monochromeVertexColorsEnabled)
            program.defines.set('USE_MONOCHROME_VERTEX_COLOR', '1');

        if (this.alphaVisualizerEnabled)
            program.defines.set('USE_ALPHA_VISUALIZER', '1');

        if (this.crossfadeDurationFrames > 0)
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
            const texture = this.textureEntry[textureEntryIndex];
            calcTextureMatrixFromRSPState(m, this.drawCall.SP_TextureState.s, this.drawCall.SP_TextureState.t, texture.width, texture.height, texture.tile.shifts, texture.tile.shiftt);
            const scrollSpeed = this.drawCall.textureScrollSpeeds[textureEntryIndex] ?? 0;
            if (scrollSpeed !== 0) {
                const tick = Math.floor(time / (1000 / 30));
                if (tick > 0) {
                    const scrollCycle = (Math.floor(255 / scrollSpeed) + 1) * scrollSpeed;
                    const tileOffset = 255 - (((tick - 1) * scrollSpeed) % scrollCycle);
                    m[13] -= (tileOffset / 4) / texture.height;
                }
            }
        } else {
            mat4.identity(m);
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4, primAlphaMultiplier = 1, primColorMultiplier: vec3 | null = null, sprites: readonly SpriteBillboard[] | null = null): void {
        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.program);

        const animationFrame = viewerInput.time / (1000 / 30);
        for (let i = 0; i < this.animatedTextureMappings.length; i++) {
            const mappings = this.animatedTextureMappings[i];
            if (mappings === undefined)
                continue;
            const textureAnimation = this.drawCall.textureAnimations[i]!;
            const frameDuration = Math.max(textureAnimation.frameDuration, 1);
            const frameOffset = textureAnimation.frameOffset;
            const frame = (Math.floor(animationFrame / frameDuration) + frameOffset) % mappings.length;
            this.textureMappings[i] = mappings[frame];
        }
        if (sprites !== null) {
            for (let i = 0; i < sprites.length; i++) {
                if (sprites[i].fade > 0)
                    this.prepareSingleRenderInst(renderInstManager, viewerInput, modelMatrix, primAlphaMultiplier * sprites[i].fade, primColorMultiplier, 6, this.firstIndex + i * 6);
            }
        } else {
            this.prepareSingleRenderInst(renderInstManager, viewerInput, modelMatrix, primAlphaMultiplier, primColorMultiplier, this.drawCall.indexCount, this.firstIndex);
        }
    }

    private prepareSingleRenderInst(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4, primAlphaMultiplier: number, primColorMultiplier: vec3 | null, indexCount: number, firstIndex: number): void {
        const renderInst = renderInstManager.newRenderInst();
        if (this.isTranslucent)
            renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);
        renderInst.setGfxProgram(this.gfxProgram!);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.setDrawCount(indexCount, firstIndex);

        const usesFog = this.fogEnabled && (this.drawCall.SP_GeometryMode & RSP_Geometry.G_FOG) !== 0;
        const boneMatrixCount = this.boneMatrices?.length ?? 1;
        let offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_DrawParams, 12 * boneMatrixCount + 8*2 + (usesFog ? 8 : 0));
        const mappedF32 = renderInst.mapUniformBufferF32(F3DEX_Program.ub_DrawParams);

        computeViewMatrix(this.viewMatrix, viewerInput.camera);
        mat4.mul(this.viewMatrix, this.viewMatrix, modelMatrix);

        if (this.boneMatrices !== undefined) {
            for (const boneMatrix of this.boneMatrices) {
                mat4.mul(this.boneModelViewMatrix, this.viewMatrix, boneMatrix);
                offs += fillMatrix4x3(mappedF32, offs, this.boneModelViewMatrix); // u_BoneMatrix
            }
        } else {
            offs += fillMatrix4x3(mappedF32, offs, this.viewMatrix); // u_BoneMatrix
        }

        this.computeTextureMatrix(this.textureMatrix, 0, viewerInput.time);
        offs += fillMatrix4x2(mappedF32, offs, this.textureMatrix); // u_TexMatrix[0]

        this.computeTextureMatrix(this.textureMatrix, 1, viewerInput.time);
        offs += fillMatrix4x2(mappedF32, offs, this.textureMatrix); // u_TexMatrix[1]

        if (usesFog) {
            offs += fillVec4(mappedF32, offs, this.fogParams.near, this.fogParams.far, 0, 0);
            const fogColor = this.fogParams.color;
            offs += fillVec4(mappedF32, offs, fogColor[0], fogColor[1], fogColor[2], fogColor[3]);
        }

        offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_CombineParams, this.crossfadeDurationFrames > 0 ? 12 : 8);
        const comb = renderInst.mapUniformBufferF32(F3DEX_Program.ub_CombineParams);
        const primColor = this.drawCall.DP_PrimColor;
        offs += fillVec4(comb, offs,
            primColor[0] * (primColorMultiplier?.[0] ?? 1),
            primColor[1] * (primColorMultiplier?.[1] ?? 1),
            primColor[2] * (primColorMultiplier?.[2] ?? 1),
            primColor[3] * primAlphaMultiplier);
        const envColor = this.drawCall.DP_EnvColor;
        offs += fillVec4(comb, offs, envColor[0], envColor[1], envColor[2], envColor[3]);
        if (this.crossfadeDurationFrames > 0) {
            // Interpolate the 30Hz game tick in PRIM_LOD_FRAC for smoother crossfades.
            const animationFrame = viewerInput.time / (1000 / 30);
            const blend = (animationFrame % this.crossfadeDurationFrames) / this.crossfadeDurationFrames;
            offs += fillVec4(comb, offs, blend, 0, 0, 0);
        }
        renderInstManager.submitRenderInst(renderInst);
    }
}

function makeVertexBufferData(v: Vertex[], actorAnimation: ActorAnimationState | undefined): Float32Array {
    const buf = new Float32Array(10 * v.length);
    let j = 0;
    for (let i = 0; i < v.length; i++) {
        buf[j++] = v[i].x;
        buf[j++] = v[i].y;
        buf[j++] = v[i].z;
        buf[j++] = actorAnimation !== undefined
            ? Math.min(v[i].matrixIndex, actorAnimation.pose.boneMatrices.length - 1)
            : 1;

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

    constructor(device: GfxDevice, cache: GfxRenderCache, geo: MeshInput, dynamic = false) {
        const sharedOutput = geo.sharedOutput;
        const drawCalls = geo.rspOutput?.drawCalls ?? [];
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
        const dynamicVertexRange = getDynamicVertexRange(geo);
        if (dynamicVertexRange !== null) {
            vertexStart = Math.min(vertexStart, dynamicVertexRange.start);
            vertexEnd = Math.max(vertexEnd, dynamicVertexRange.end);
        }
        this.vertexStart = vertexStart;

        assert(vertexEnd - this.vertexStart <= 0xFFFFFFFF);
        this.vertexBufferData = makeVertexBufferData(sharedOutput.vertices.slice(this.vertexStart, vertexEnd), geo.actorAnimation);
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

export class SpriteBillboard {
    private static readonly signs = [-1, 1, 1, 1, 1, -1, -1, -1];
    public fade = 1;
    private spawnTick: number | undefined;
    private lifetime: number | undefined;
    private loopTicks: number | undefined;
    private velocityY: number | undefined;
    public maxDistance: number | undefined;
    public fadeStartDistance: number | undefined;

    constructor(
        public firstVertex: number,
        public origin: vec3,
        private halfWidth: number,
        private halfHeight: number,
        options: {
            spawnTick?: number;
            lifetime?: number;
            loopTicks?: number;
            velocityY?: number;
            maxDistance?: number;
            fadeStartDistance?: number;
        },
    ) {
        this.spawnTick = options.spawnTick;
        this.lifetime = options.lifetime;
        this.loopTicks = options.loopTicks;
        this.velocityY = options.velocityY;
        this.maxDistance = options.maxDistance;
        this.fadeStartDistance = options.fadeStartDistance;
    }

    public update(vertexBufferData: Float32Array, vertexBufferFirstVertex: number, cameraMatrix: mat4, tick: number): void {
        const age = this.spawnTick === undefined
            ? 0
            : ((tick - this.spawnTick + this.loopTicks!) % this.loopTicks!);
        getMatrixTranslation(scratchVec3a, cameraMatrix);
        const distance = vec3.distance(scratchVec3a, this.origin);
        const withinDistance = this.maxDistance === undefined || distance <= this.maxDistance;
        const active = withinDistance && (this.spawnTick === undefined || age < this.lifetime!);
        this.fade = active ? 1 : 0;
        if (this.fadeStartDistance !== undefined) {
            this.fade = !active ? 0 : distance < this.fadeStartDistance
                ? 1
                : Math.max(0, Math.min(1, (this.maxDistance! - distance) / (this.maxDistance! - this.fadeStartDistance)));
        }
        const centerX = this.origin[0];
        const centerY = this.origin[1] + age * (this.velocityY ?? 0);
        const centerZ = this.origin[2];
        for (let i = 0; i < 4; i++) {
            const vertex = (this.firstVertex + i - vertexBufferFirstVertex) * 10;
            if (!active) {
                vertexBufferData[vertex + 0] = this.origin[0];
                vertexBufferData[vertex + 1] = this.origin[1];
                vertexBufferData[vertex + 2] = this.origin[2];
                continue;
            }
            const rightOffset = this.halfWidth * SpriteBillboard.signs[i * 2];
            const upOffset = this.halfHeight * SpriteBillboard.signs[i * 2 + 1];
            vertexBufferData[vertex + 0] = centerX
                + cameraMatrix[0] * rightOffset
                + cameraMatrix[4] * upOffset;
            vertexBufferData[vertex + 1] = centerY
                + cameraMatrix[1] * rightOffset
                + cameraMatrix[5] * upOffset;
            vertexBufferData[vertex + 2] = centerZ
                + cameraMatrix[2] * rightOffset
                + cameraMatrix[6] * upOffset;
        }
    }
}

export interface MeshInput {
    sharedOutput: RSPSharedOutput;
    rspOutput: RSPOutput | null;
    generatedSurfaceAnimation?: {
        surface: GeneratedSurface;
        firstVertex: number;
        vertexCount: number;
    };
    dynamicLighting?: DynamicLighting;
    actorAnimation?: ActorAnimationState;
    propAnimation?: PropAnimationState;
    spriteBillboards?: SpriteBillboard[];
}

function computeMeshBoundingBox(geo: MeshInput): AABB | null {
    if (geo.rspOutput === null)
        return null;

    const boundingBox = new AABB();
    for (const drawCall of geo.rspOutput.drawCalls) {
        const indexEnd = drawCall.firstIndex + drawCall.indexCount;
        for (let index = drawCall.firstIndex; index < indexEnd; index++) {
            const vertex = geo.sharedOutput.vertices[geo.sharedOutput.indices[index]];
            vec3.set(scratchVec3a, vertex.x, vertex.y, vertex.z);
            boundingBox.unionPoint(scratchVec3a);
        }
    }
    if (boundingBox.min[0] > boundingBox.max[0])
        return null;

    if (geo.actorAnimation !== undefined)
        boundingBox.union(boundingBox, geo.actorAnimation.boundingBox);
    const translationBounds = geo.propAnimation?.translationBounds;
    if (translationBounds !== undefined) {
        // The animation sweeps the mesh over translationBounds, so grow each side by that side's travel.
        vec3.add(boundingBox.min, boundingBox.min, translationBounds.min);
        vec3.add(boundingBox.max, boundingBox.max, translationBounds.max);
        // Rotation about the animated nodes can swing geometry outside the swept box; pad to cover it.
        const padding = Math.max(
            boundingBox.max[0] - boundingBox.min[0],
            boundingBox.max[1] - boundingBox.min[1],
            boundingBox.max[2] - boundingBox.min[2],
        ) * 0.5;
        vec3SetAll(scratchVec3a, padding);
        boundingBox.expandByExtent(boundingBox, scratchVec3a);
    }
    return boundingBox;
}

function getDynamicVertexRange(geo: MeshInput): { start: number, end: number } | null {
    let rangeStart = Infinity, rangeEnd = -Infinity;
    const include = (start: number, count: number): void => {
        rangeStart = Math.min(rangeStart, start);
        rangeEnd = Math.max(rangeEnd, start + count);
    };
    if (geo.generatedSurfaceAnimation !== undefined)
        include(geo.generatedSurfaceAnimation.firstVertex, geo.generatedSurfaceAnimation.vertexCount);
    if (geo.propAnimation !== undefined)
        for (const vertexOffset of geo.propAnimation.vertexOffsets)
            include(geo.propAnimation.firstVertex + vertexOffset, 1);
    for (const sprite of geo.spriteBillboards ?? [])
        include(sprite.firstVertex, 4);
    for (const vertexIndex of geo.dynamicLighting?.vertexIndices ?? [])
        include(vertexIndex, 1);
    return rangeStart <= rangeEnd ? { start: rangeStart, end: rangeEnd } : null;
}

export class GeometryData {
    public renderData: RenderData;
    public cullBoundingBox: AABB | null;
    public dynamicLightingEnabled = true;
    private lightingDirty: boolean;
    private dirtyVertexRange: { start: number, end: number } | null = null;

    constructor(device: GfxDevice, cache: GfxRenderCache, public geo: MeshInput) {
        this.renderData = new RenderData(device, cache, geo, geo.generatedSurfaceAnimation !== undefined || geo.spriteBillboards !== undefined || geo.dynamicLighting !== undefined || geo.propAnimation !== undefined);
        this.lightingDirty = geo.dynamicLighting !== undefined;
        this.cullBoundingBox = computeMeshBoundingBox(geo);

        const dynamicVertexRange = getDynamicVertexRange(geo);
        if (dynamicVertexRange !== null) {
            this.dirtyVertexRange = {
                start: dynamicVertexRange.start - this.renderData.vertexStart,
                end: dynamicVertexRange.end - this.renderData.vertexStart,
            };
        }
    }

    public setDynamicLightingEnabled(enabled: boolean): void {
        this.dynamicLightingEnabled = enabled;
        this.lightingDirty = true;
    }

    public update(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput, activeLightCache: ActiveLightCache): void {
        const surfaceAnimation = this.geo.generatedSurfaceAnimation;
        const sprites = this.geo.spriteBillboards;
        const lighting = this.geo.dynamicLighting;
        const actorAnimation = this.geo.actorAnimation;
        const propAnimation = this.geo.propAnimation;
        const tick = Math.floor(viewerInput.time / (1000 / 30));
        const lightingIsDynamic = lighting !== undefined && lighting.lights.length > 0 && this.dynamicLightingEnabled;

        if (surfaceAnimation !== undefined) {
            const surface = surfaceAnimation.surface;
            const amplitude = surface.amplitudeS + surface.amplitudeT;
            for (let i = 0; i < surfaceAnimation.vertexCount; i++) {
                const vertexIndex = surfaceAnimation.firstVertex + i;
                const vertex = this.geo.sharedOutput.vertices[vertexIndex];
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
            updateDynamicLighting(lighting, this.geo.sharedOutput.vertices, this.renderData.vertexBufferData, this.renderData.vertexStart, activeLightCache, this.dynamicLightingEnabled);
            this.lightingDirty = false;
        }
        if (actorAnimation !== undefined)
            actorAnimation.pose.update(tick);
        if (propAnimation !== undefined)
            propAnimation.update(this.renderData.vertexBufferData, this.renderData.vertexStart, tick);

        for (const sprite of sprites ?? [])
            sprite.update(this.renderData.vertexBufferData, this.renderData.vertexStart, viewerInput.camera.worldMatrix, tick);
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

export enum DK64Layer {
    MapGeometry,
    Props,
    Actors,
    Surfaces,
    Effects,
}

export class GeometryRenderer {
    private visible = true;
    private cullBoundingBox: AABB | null = null;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
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
    private lookAtPosition = vec3.create();
    private lookAtMatrix = mat4.create();

    // Shared by reference with any renderer constructed against the same GeometryData.
    private drawCallInstances: DrawCallInstance[];

    constructor(
        device: GfxDevice,
        cache: GfxRenderCache,
        private geometryData: GeometryData,
        public renderLayer: DK64Layer,
        private fogParams: FogParams,
        private gfxTextureCache: DK64TextureCache,
        sharedRenderer: GeometryRenderer | null = null,
    ) {
        this.megaStateFlags = {};
        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });

        const geo = this.geometryData.geo;
        this.computeLookAt = geo.rspOutput?.drawCalls.some((drawCall) => {
            const requiredModes = RSP_Geometry.G_LIGHTING | RSP_Geometry.G_TEXTURE_GEN;
            return (drawCall.SP_GeometryMode & requiredModes) === requiredModes;
        }) ?? false;

        if (sharedRenderer !== null) {
            assert(sharedRenderer.geometryData === geometryData);
            this.drawCallInstances = sharedRenderer.drawCallInstances;
        } else {
            this.drawCallInstances = this.buildDrawCallInstances(device, cache, geo);
        }
    }

    private buildDrawCallInstances(device: GfxDevice, cache: GfxRenderCache, geo: MeshInput): DrawCallInstance[] {
        if (geo.rspOutput === null)
            return [];

        return geo.rspOutput.drawCalls.map((drawCall) => new DrawCallInstance(
            device, cache, this.gfxTextureCache, geo.sharedOutput, drawCall,
            drawCall.firstIndex - this.geometryData.renderData.indexStart,
            this.fogParams, geo.actorAnimation?.pose.boneMatrices,
        ));
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

    public setVisible(v: boolean): void {
        this.visible = v;
    }

    public setCullBoundingBox(boundingBox: AABB | null): void {
        this.cullBoundingBox = boundingBox;
    }

    public computeWorldBoundingBox(): AABB | null {
        const sourceBoundingBox = this.geometryData.cullBoundingBox;
        if (sourceBoundingBox === null)
            return null;

        const localBoundingBox = sourceBoundingBox.clone();
        const worldBoundingBox = new AABB();
        const rootAnimation = this.rootTransformAnimation;
        if (rootAnimation === null) {
            worldBoundingBox.transform(localBoundingBox, this.modelMatrix);
        } else {
            if (rootAnimation.rotationYRadiansPerTick !== 0) {
                const radiusXZ = Math.hypot(
                    Math.max(Math.abs(localBoundingBox.min[0]), Math.abs(localBoundingBox.max[0])),
                    Math.max(Math.abs(localBoundingBox.min[2]), Math.abs(localBoundingBox.max[2])),
                );
                localBoundingBox.set(
                    -radiusXZ, localBoundingBox.min[1], -radiusXZ,
                    radiusXZ, localBoundingBox.max[1], radiusXZ,
                );
            }
            worldBoundingBox.transform(localBoundingBox, rootAnimation.baseMatrix);
            worldBoundingBox.min[1] -= Math.abs(rootAnimation.positionYAmplitude);
            worldBoundingBox.max[1] += Math.abs(rootAnimation.positionYAmplitude);
        }
        return worldBoundingBox;
    }

    public setRotationYAnimation(anglePerTick: number): void {
        this.ensureRootTransformAnimation();
        this.rootTransformAnimation!.rotationYRadiansPerTick = anglePerTick / 0x1000 * MathConstants.TAU;
    }

    public setPositionYAnimation(amplitude: number, anglePerTick: number): void {
        this.ensureRootTransformAnimation();
        this.rootTransformAnimation!.positionYAmplitude = amplitude;
        this.rootTransformAnimation!.positionYRadiansPerTick = anglePerTick / 0x1000 * MathConstants.TAU;
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
        if (this.cullBoundingBox !== null && !viewerInput.camera.frustum.contains(this.cullBoundingBox))
            return;

        if (this.rootTransformAnimation !== null) {
            const rootAnimation = this.rootTransformAnimation;
            mat4.copy(this.modelMatrix, rootAnimation.baseMatrix);
            const tick = Math.floor(viewerInput.time / (1000 / 30));
            mat4.rotateY(this.modelMatrix, this.modelMatrix, tick * rootAnimation.rotationYRadiansPerTick);
            this.modelMatrix[13] += Math.sin(tick * rootAnimation.positionYRadiansPerTick)
                * rootAnimation.positionYAmplitude;
        } else if (this.cameraBillboard !== null) {
            const billboard = this.cameraBillboard;
            scaleMatrix(this.modelMatrix, viewerInput.camera.worldMatrix, billboard.scale);
            setMatrixTranslation(this.modelMatrix, billboard.origin);
        }

        let primAlphaMultiplier = 1;
        if (this.distanceFade !== null) {
            getMatrixTranslation(scratchVec3a, viewerInput.camera.worldMatrix);
            const distance = vec3.distance(scratchVec3a, this.distanceFade.origin);
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
            mat4.getTranslation(this.lookAtPosition, this.modelMatrix);
            vec3.transformMat4(this.lookAtPosition, this.lookAtPosition, viewerInput.camera.viewMatrix);

            mat4.lookAt(this.lookAtMatrix, Vec3Zero, this.lookAtPosition, Vec3UnitY);
            offs += fillVec4(mappedF32, offs, this.lookAtMatrix[0], this.lookAtMatrix[4], this.lookAtMatrix[8]);
            offs += fillVec4(mappedF32, offs, this.lookAtMatrix[1], this.lookAtMatrix[5], this.lookAtMatrix[9]);
        }

        const objectLightColor = this.objectLighting !== null
            ? sampleObjectLighting(this.objectLightColor, this.objectLighting, activeLightCache, this.geometryData.dynamicLightingEnabled)
            : null;
        const sprites = this.geometryData.geo.spriteBillboards ?? null;
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].prepareToRender(renderInstManager, viewerInput, this.modelMatrix, primAlphaMultiplier, objectLightColor, sprites);

        renderInstManager.popTemplate();
    }
}

export const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 2, },
];
