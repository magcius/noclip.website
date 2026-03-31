import { mat4, vec3, vec4 } from "gl-matrix";
import * as RDP from "../Common/N64/RDP.js";
import * as F3DEX from "./f3dex.js";
import { RenderData, F3DEX_Program } from "../BanjoKazooie/render.js";
import { RSP_Geometry, DrawCall, translateCullMode, getImageFormatString } from "./f3dex.js";
import { CameraController, computeViewMatrix } from "../Camera.js";
import { calcTextureMatrixFromRSPState } from "../Common/N64/RSP.js";
import {
    makeBackbufferDescSimple,
    makeAttachmentClearDescriptor,
} from "../gfx/helpers/RenderGraphHelpers.js";
import {
    fillMatrix4x2,
    fillMatrix4x3,
    fillMatrix4x4,
    fillVec4,
} from "../gfx/helpers/UniformBufferHelpers.js";
import {
    GfxDevice,
    GfxBlendFactor,
    GfxBlendMode,
    GfxMegaStateDescriptor,
    GfxProgram,
    GfxTexture,
} from "../gfx/platform/GfxPlatform.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { GfxrAttachmentClearDescriptor, GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import {
    GfxRenderInstList,
    GfxRenderInstManager,
    makeSortKey,
    GfxRendererLayer,
} from "../gfx/render/GfxRenderInstManager.js";
import { TextureMapping } from "../TextureHolder.js";
import { DeviceProgram } from "../Program.js";
import { SceneGfx, ViewerRenderInput, Texture as ViewerTexture } from "../viewer.js";
import * as UI from "../ui.js";
import { Destroyable } from "../SceneBase.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { TGRTrack } from "./data.js";
import { nArray } from "../util.js";

/**
 * Top Gear Rally track renderer.
 *
 * Walks N64 display lists from decompressed track data using the
 * BanjoKazooie F3DEX interpreter. Each track instance has a 4x4
 * matrix that transforms local DL geometry to world space.
 *
 * Uses its own DrawCallInstance to support G_SETPRIMCOLOR,
 * G_SETENVCOLOR, parameterised lighting, and per-vertex fog
 * without modifying BK's shared code.
 */

/** Low 24 bits of the N64 DRAM base address 0x80025c00. */
const TRACK_RAM_LOW24 = 0x025c00;

const bindingLayouts = [{ numUniformBuffers: 3, numSamplers: 2 }];

// -- TGR-specific DrawCallInstance with prim/env color support. --

const viewMatrixScratch = mat4.create();
const modelViewScratch = mat4.create();
const texMatrixScratch = mat4.create();

class TGRDrawCallInstance {
    public isSky = false;
    public flipTexS = false;
    public isTransparent = false;

    private readonly textureEntry: RDP.Texture[] = [];
    private readonly megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private program!: DeviceProgram;
    private gfxProgram: GfxProgram | null = null;
    private readonly textureMappings = nArray(2, () => new TextureMapping());
    private usesLighting = false;

    public constructor(
        geometryData: RenderData,
        private readonly drawMatrix: mat4[],
        private readonly drawCall: DrawCall,
    ) {

        for (let i = 0; i < this.textureMappings.length; i++) {
            if (i < this.drawCall.textureIndices.length) {
                const idx = this.drawCall.textureIndices[i];
                this.textureEntry[i] = geometryData.sharedOutput.textureCache.textures[idx];
                this.textureMappings[i].gfxTexture = geometryData.textures[idx];
                this.textureMappings[i].gfxSampler = geometryData.samplers[idx];
            }
        }

        this.megaStateFlags = RDP.translateRenderMode(this.drawCall.DP_OtherModeL);
        // The BK translateRenderMode only enables blending when the
        // blend destination is CLR_MEM. The N64 mode 0x0c1848f8 uses
        // coverage-based transparency that WebGL cannot replicate
        // directly. Apply standard alpha blending for this specific
        // mode so transparent pixels (e.g. camera flash backgrounds)
        // show through correctly.
        if (this.drawCall.DP_OtherModeL === 0x0c1848f8) {
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            });
            this.megaStateFlags.depthWrite = false;
        }
        const cullMode = translateCullMode(this.drawCall.SP_GeometryMode);
        this.megaStateFlags.cullMode = cullMode;

        this.createProgram();
    }

    public disableDepthWrite(): void {
        this.megaStateFlags.depthWrite = false;
    }

    public getDrawMatrix(): mat4 {
        return this.drawMatrix[0];
    }

    public setDrawMatrix(m: mat4): void {
        mat4.copy(this.drawMatrix[0], m);
        mat4.copy(this.drawMatrix[1], m);
    }

    public getTextureIndex(slot: number): number {
        if (slot < this.drawCall.textureIndices.length) {
            return this.drawCall.textureIndices[slot];
        }
        return -1;
    }

    public setGfxTexture(slot: number, tex: GfxTexture): void {
        if (slot < this.textureMappings.length) {
            this.textureMappings[slot].gfxTexture = tex;
        }
    }

    public prepareToRender(
        device: GfxDevice,
        renderInstManager: GfxRenderInstManager,
        viewerInput: ViewerRenderInput,
        skyMatrix?: mat4,
        fogParams?: WeatherParams,
    ): void {
        this.gfxProgram ??= renderInstManager.gfxRenderCache.createProgram(this.program);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.setDrawCount(this.drawCall.indexCount, this.drawCall.firstIndex);

        if (this.isSky) {
            renderInst.sortKey = makeSortKey(GfxRendererLayer.BACKGROUND);
        } else if (this.isTransparent) {
            renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);
        }

        // DrawParams layout: bone matrices + tex matrices +
        // [lighting] + fog. Lighting adds 3 vec4s
        // (DiffuseColor, DiffuseDirection, AmbientColor) for
        // 1 light.
        const lightingSize = this.usesLighting ? 4 + 4 + 4 : 0;
        let offs = renderInst.allocateUniformBuffer(
            F3DEX_Program.ub_DrawParams,
            12 * 2 + 8 * 2 + lightingSize + 4 + 4,
        );
        const mappedF32 = renderInst.mapUniformBufferF32(F3DEX_Program.ub_DrawParams);

        computeViewMatrix(viewMatrixScratch, viewerInput.camera);

        // For sky draw calls, use the sky matrix (which follows
        // the camera).
        const drawMat0 = this.isSky && skyMatrix ? skyMatrix : this.drawMatrix[0];
        const drawMat1 = this.isSky && skyMatrix ? skyMatrix : this.drawMatrix[1];

        mat4.mul(modelViewScratch, viewMatrixScratch, drawMat0);
        offs += fillMatrix4x3(mappedF32, offs, modelViewScratch);

        mat4.mul(modelViewScratch, viewMatrixScratch, drawMat1);
        offs += fillMatrix4x3(mappedF32, offs, modelViewScratch);

        this.computeTextureMatrix(texMatrixScratch, 0);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch);

        this.computeTextureMatrix(texMatrixScratch, 1);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch);

        // Lighting uniforms: u_DiffuseColor[0],
        // u_DiffuseDirection[0], u_AmbientColor.
        if (this.usesLighting) {
            // Game's summer lighting:
            //   directional=(0xFF,0xFF,0xCC),
            //   ambient=(0x66,0x66,0x77).
            // Light direction: (15, 10, 20) normalized in N64
            // space. In view space we need to transform by the
            // view matrix, but for simplicity use a fixed
            // direction that approximates top-front lighting.

            // u_DiffuseColor[0].
            offs += fillVec4(mappedF32, offs, 1.0, 1.0, 0.8, 0.0);
            // u_DiffuseDirection[0] (view-space approx:
            // slightly above+forward).
            offs += fillVec4(mappedF32, offs, 0.0, 0.57, 0.82, 0.0);
            // u_AmbientColor (0x66/0xFF, 0x66/0xFF,
            // 0x77/0xFF).
            offs += fillVec4(mappedF32, offs, 0.4, 0.4, 0.47, 1.0);
        }

        // Fog params: u_FogParam = (near, far, 0, 0),
        // u_FogColor = (r, g, b, 1).
        if (fogParams) {
            offs += fillVec4(mappedF32, offs, fogParams.fogNear, fogParams.fogFar, 0, 0);
            fillVec4(
                mappedF32,
                offs,
                fogParams.fogR / 255.0,
                fogParams.fogG / 255.0,
                fogParams.fogB / 255.0,
                1.0,
            );
        } else {
            // No fog: set near/far to extreme values so
            // fogFactor is always 0.
            offs += fillVec4(mappedF32, offs, 1000000, 1000001, 0, 0);
            fillVec4(mappedF32, offs, 0, 0, 0, 0);
        }

        offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_CombineParams, 8);
        const comb = renderInst.mapUniformBufferF32(F3DEX_Program.ub_CombineParams);
        const prim = this.drawCall.DP_PrimColor;
        const env = this.drawCall.DP_EnvColor;
        offs += fillVec4(comb, offs, prim[0], prim[1], prim[2], prim[3]);
        fillVec4(comb, offs, env[0], env[1], env[2], env[3]);
        renderInstManager.submitRenderInst(renderInst);
    }

    private createProgram(): void {
        this.usesLighting = (this.drawCall.SP_GeometryMode & RSP_Geometry.G_LIGHTING) !== 0;

        // When lighting is enabled, pass G_MW_NUMLIGHT=1 to the
        // F3DEX_Program so the shader knows how many directional
        // lights to process.
        const numLights = this.usesLighting ? 1 : 0;
        const program = new F3DEX_Program(
            this.drawCall.DP_OtherModeH,
            this.drawCall.DP_OtherModeL,
            this.drawCall.DP_Combine,
            0.5,
            [],
            numLights,
        );
        program.defines.set("BONE_MATRIX_COUNT", "2");

        if (this.drawCall.textureIndices.length) {
            program.defines.set("USE_TEXTURE", "1");
        }

        const shade = (this.drawCall.SP_GeometryMode & RSP_Geometry.G_SHADE) !== 0;
        if (shade) {
            program.defines.set("USE_VERTEX_COLOR", "1");
        }

        if (this.usesLighting) {
            program.defines.set("LIGHTING", "1");
            program.defines.set("PARAMETERIZED_LIGHTING", "1");
        }

        if (this.drawCall.SP_GeometryMode & RSP_Geometry.G_TEXTURE_GEN) {
            program.defines.set("TEXTURE_GEN", "1");
        }

        if (this.drawCall.SP_GeometryMode & RSP_Geometry.G_TEXTURE_GEN_LINEAR) {
            program.defines.set("TEXTURE_GEN_LINEAR", "1");
        }

        // Always enable fog support. Fog params control whether
        // it is visible.
        program.defines.set("USE_FOG", "1");

        this.program = program;
        this.gfxProgram = null;
    }

    private computeTextureMatrix(m: mat4, textureEntryIndex: number): void {
        const entry = this.textureEntry[textureEntryIndex] as RDP.Texture | undefined;
        if (entry === undefined) {
            mat4.identity(m);
            return;
        }
        calcTextureMatrixFromRSPState(
            m,
            this.drawCall.SP_TextureState.s,
            this.drawCall.SP_TextureState.t,
            entry.width,
            entry.height,
            entry.tile.shifts,
            entry.tile.shiftt,
        );
        // Flip the S (horizontal) texture coordinate for mirrored
        // banners. Negating the S components causes UV to go
        // negative. With GL REPEAT, negative UVs sample texels in
        // reverse order within each tile:
        //   frac(-0.25) = 0.75, frac(-0.5) = 0.5,
        //   frac(-0.75) = 0.25.
        if (this.flipTexS) {
            m[0] = -m[0];
            m[4] = -m[4];
            m[8] = -m[8];
            m[12] = -m[12];
        }
    }
}

// -- Main renderer. --

interface TGRDrawCallGroup {
    drawCallInstances: TGRDrawCallInstance[];
    isTransparent: boolean; // Instance flag 0x0008.
}

class TGRTextureHolder implements UI.TextureListHolder {
    public textureNames: string[] = [];
    public onnewtextures: (() => void) | null = null;

    public constructor(
        private readonly renderData: RenderData,
        sharedOutput: F3DEX.RSPSharedOutput,
    ) {
        for (let i = 0; i < sharedOutput.textureCache.textures.length; i++) {
            const tex = sharedOutput.textureCache.textures[i];
            const fmtStr = getImageFormatString(tex.tile.fmt, tex.tile.siz);
            this.textureNames.push(`${i}: ${fmtStr} ${tex.width}x${tex.height}`);
        }
    }

    public getViewerTexture(i: number): Promise<ViewerTexture> {
        return Promise.resolve({ gfxTexture: this.renderData.textures[i] });
    }
}

// Fog colour, clear colour, and near/far distances per weather mode.
interface WeatherParams {
    fogR: number;
    fogG: number;
    fogB: number;
    clearR: number;
    clearG: number;
    clearB: number;
    fogNear: number;
    fogFar: number;
}

// Fog near/far in GL view-space units (N64 units times WORLD_SCALE).
const WEATHER_PARAMS: WeatherParams[] = [
    // Sunny (effectively no fog).
    {
        fogR: 128,
        fogG: 179,
        fogB: 230,
        clearR: 0.5,
        clearG: 0.7,
        clearB: 0.9,
        fogNear: 99000,
        fogFar: 100000,
    },
    // Rain (mild fog, darker sky).
    {
        fogR: 100,
        fogG: 110,
        fogB: 120,
        clearR: 0.35,
        clearG: 0.4,
        clearB: 0.5,
        fogNear: 30000,
        fogFar: 60000,
    },
    // Snow (grey fog, moderate visibility).
    {
        fogR: 96,
        fogG: 104,
        fogB: 112,
        clearR: 0.38,
        clearG: 0.41,
        clearB: 0.44,
        fogNear: 25000,
        fogFar: 55000,
    },
    // Night (blue-tinted fog, dark sky).
    {
        fogR: 30,
        fogG: 30,
        fogB: 55,
        clearR: 0.02,
        clearG: 0.02,
        clearB: 0.08,
        fogNear: 20000,
        fogFar: 50000,
    },
    // Fog / blizzard (dense black fog, very low visibility).
    {
        fogR: 0,
        fogG: 0,
        fogB: 0,
        clearR: 0.0,
        clearG: 0.0,
        clearB: 0.0,
        fogNear: 5000,
        fogFar: 15000,
    },
];

// Per-instance rotation animation state (types 0 through 2).
interface RotationAnimState {
    instanceRawIndex: number;
    /** Rotation axis in N64 space (unit vector). */
    axis: vec3;
    /** Rotation speed in degrees per frame at 30 fps. */
    speed: number;
    /** Accumulated angle in degrees. */
    angle: number;
    /** Original N64 matrix before n64ToGL transform. */
    baseMatrixRaw: mat4;
}

// Per-spline follower animation state (type 3).
interface SplineAnimState {
    instanceRawIndex: number;
    leftRail: Float32Array;
    rightRail: Float32Array;
    nodeCount: number;
    currentNode: number;
    accumDist: number;
    segmentLen: number;
    /** Speed in N64 distance units per second. */
    speed: number;
    active: boolean;
}

// Per-channel animated texture state.
interface AnimTexState {
    /** Texture cache index for the base (KF0) texture. */
    texCacheIndex: number;
    /** Millisecond timestamps for each keyframe. */
    keyframeTimes: number[];
    /** GPU textures for each keyframe (index 0 = base). */
    keyframeGfxTextures: GfxTexture[];
    currentKeyframe: number;
    timeAccum: number;
    /** Duration of one full cycle in milliseconds. */
    totalCycleTime: number;
    /** Draw call instances that reference this texture. */
    affectedDrawCalls: TGRDrawCallInstance[];
}

/** Main scene renderer for Top Gear Rally tracks. */
export class TGRRenderer implements SceneGfx, Destroyable {
    /** Texture list holder for the debug texture viewer panel. */
    public textureHolder?: UI.TextureListHolder;

    private readonly renderHelper: GfxRenderHelper;
    private readonly renderInstListMain = new GfxRenderInstList();
    private clearDescriptor: GfxrAttachmentClearDescriptor;
    private renderData: RenderData | null = null;
    private readonly drawCallGroups: TGRDrawCallGroup[] = [];
    private readonly skyDrawCallInstances: TGRDrawCallInstance[] = [];
    private readonly skyN64ToGL = mat4.create();
    private readonly n64ToGL = mat4.create();
    private readonly trackCenter = vec3.create();
    private weatherMode = 0;
    private readonly rotationAnims: RotationAnimState[] = [];
    private readonly splineAnims: SplineAnimState[] = [];
    private readonly animTexStates: AnimTexState[] = [];
    // Map from raw instance index to the draw call group index for animation updates.
    private readonly rawIndexToGroupIdx: Map<number, number> = new Map();
    private animTexElapsedMs = 0;

    /**
     * Constructor.
     * @param {GfxDevice} device GPU device handle.
     * @param {TGRTrack} track Track data to render.
     * @param {boolean} mirrored Whether to mirror the track geometry (used for mirrored banners).
     * @param {number} trackIndex Index of the track (used for animation state).
     */
    public constructor(
        device: GfxDevice,
        private readonly track: TGRTrack,
        private readonly mirrored = false,
        private readonly trackIndex = 0,
    ) {
        this.renderHelper = new GfxRenderHelper(device);
        this.clearDescriptor = makeAttachmentClearDescriptor({ r: 0.5, g: 0.7, b: 0.9, a: 1.0 });

        try {
            this.parseAndBuild(device);
        } catch (e) {
            console.error("TGR: Failed to parse track data:", e);
        }
    }

    private static computeSegmentLen(s: SplineAnimState): void {
        const i = s.currentNode;
        if (i + 1 >= s.nodeCount) {
            s.segmentLen = 1;
            return;
        }
        // Midpoint of left/right rails at current and next
        // node.
        const lx0 = s.leftRail[i * 3];
        const ly0 = s.leftRail[i * 3 + 1];
        const lz0 = s.leftRail[i * 3 + 2];
        const rx0 = s.rightRail[i * 3];
        const ry0 = s.rightRail[i * 3 + 1];
        const rz0 = s.rightRail[i * 3 + 2];
        const lx1 = s.leftRail[(i + 1) * 3];
        const ly1 = s.leftRail[(i + 1) * 3 + 1];
        const lz1 = s.leftRail[(i + 1) * 3 + 2];
        const rx1 = s.rightRail[(i + 1) * 3];
        const ry1 = s.rightRail[(i + 1) * 3 + 1];
        const rz1 = s.rightRail[(i + 1) * 3 + 2];
        const mx0 = (lx0 + rx0) * 0.5;
        const my0 = (ly0 + ry0) * 0.5;
        const mz0 = (lz0 + rz0) * 0.5;
        const mx1 = (lx1 + rx1) * 0.5;
        const my1 = (ly1 + ry1) * 0.5;
        const mz1 = (lz1 + rz1) * 0.5;
        const dx = mx1 - mx0;
        const dy = my1 - my0;
        const dz = mz1 - mz0;
        s.segmentLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (s.segmentLen < 0.001) {
            s.segmentLen = 0.001;
        }
    }

    /**
     * Update animations and submit all render instances for
     * the current frame.
     *
     * @param {GfxDevice} device GPU device handle.
     * @param {ViewerRenderInput} viewerInput Per-frame viewer
     *     state.
     */
    public prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        if (
            this.renderData === null ||
            (this.drawCallGroups.length === 0 && this.skyDrawCallInstances.length === 0)
        ) {
            return;
        }

        // Update animations.
        const dtSec = viewerInput.deltaTime / 1000.0;
        this.updateAnimations(viewerInput.deltaTime);
        this.updateSplines(dtSec);
        // deltaTime is in ms.
        this.updateAnimatedTextures(viewerInput.deltaTime);

        const { renderInstManager } = this.renderHelper;
        renderInstManager.setCurrentList(this.renderInstListMain);

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setVertexInput(
            this.renderData.inputLayout,
            this.renderData.vertexBufferDescriptors,
            this.renderData.indexBufferDescriptor,
        );

        // Set scene params (projection matrix).
        const offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, 16);
        const mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);

        // Compute sky matrix: translate the sky dome to the
        // camera position. The sky dome follows the viewer so
        // it always appears at infinity.
        let skyMatrix: mat4 | undefined = undefined;
        if (this.skyDrawCallInstances.length > 0) {
            skyMatrix = mat4.create();
            // Extract camera world position from the view
            // matrix inverse.
            // camera.worldMatrix is the camera-to-world
            // transform; translation is in column 3.
            const { worldMatrix } = viewerInput.camera;
            const [, , , , , , , , , , , , camX, camY, camZ] = worldMatrix;

            // Build the sky model matrix: n64ToGL coordinate
            // transform, then translate to camera.
            mat4.copy(skyMatrix, this.skyN64ToGL);
            skyMatrix[12] = camX;
            skyMatrix[13] = camY;
            skyMatrix[14] = camZ;
        }

        // Weather fog parameters.
        const fogParams = this.weatherMode > 0 ? WEATHER_PARAMS[this.weatherMode] : undefined;

        // Sky weather tint: the game tints the skybox via
        // combiner (env color blending) not via fog. We pass a
        // sky-specific fog that covers the full sky to simulate
        // this. The game uses env alpha = 0x40 (25%) blend
        // toward fog color in weather modes.
        let skyFog: WeatherParams | undefined = undefined;
        if (fogParams) {
            // Sky vertices are at moderate view-space Z. Use
            // range that creates ~60% blend.
            skyFog = {
                ...fogParams,
                fogNear: 0,
                fogFar: 25000,
            };
        }

        // Render sky first (BACKGROUND sort key ensures it
        // draws behind everything).
        for (const dci of this.skyDrawCallInstances) {
            dci.prepareToRender(device, renderInstManager, viewerInput, skyMatrix, skyFog);
        }

        // Render track geometry with weather fog.
        for (const group of this.drawCallGroups) {
            for (const dci of group.drawCallInstances) {
                dci.prepareToRender(device, renderInstManager, viewerInput, undefined, fogParams);
            }
        }

        renderInstManager.popTemplate();

        this.renderHelper.prepareToRender();
    }

    /**
     * Build the render graph, execute all passes, and present.
     *
     * @param {GfxDevice} device GPU device handle.
     * @param {ViewerRenderInput} viewerInput Per-frame viewer
     *     state.
     */
    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        const wp = WEATHER_PARAMS[this.weatherMode];
        this.clearDescriptor = makeAttachmentClearDescriptor({
            r: wp.clearR,
            g: wp.clearG,
            b: wp.clearB,
            a: 1.0,
        });

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(
            GfxrAttachmentSlot.Color0,
            viewerInput,
            this.clearDescriptor,
        );
        const mainDepthDesc = makeBackbufferDescSimple(
            GfxrAttachmentSlot.DepthStencil,
            viewerInput,
            this.clearDescriptor,
        );

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, "Main Color");
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, "Main Depth");
        builder.pushPass((pass) => {
            pass.setDebugName("Main");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(
                    this.renderHelper.renderCache,
                    passRenderer,
                );
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(
            mainColorTargetID,
            viewerInput.onscreenTexture,
        );

        this.prepareToRender(device, viewerInput);
        builder.execute();
        this.renderInstListMain.reset();
    }

    /**
     * Create the weather selection UI panel.
     *
     * @returns {UI.Panel[]} Array of UI panels.
     */
    public createPanels(): UI.Panel[] {
        const panels: UI.Panel[] = [];

        // Weather / Time of Day panel.
        const weatherPanel = new UI.Panel();
        weatherPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        weatherPanel.setTitle(UI.TIME_OF_DAY_ICON, "Weather");

        const weatherSelect = new UI.SingleSelect();
        weatherSelect.setStrings(["Sunny", "Rain", "Snow", "Night", "Fog"]);
        weatherSelect.onselectionchange = (index: number) => {
            this.weatherMode = index;
        };
        weatherSelect.selectItem(0);
        weatherPanel.contents.appendChild(weatherSelect.elem);
        panels.push(weatherPanel);

        return panels;
    }

    /**
     * Configure the camera controller speed for this scene.
     *
     * @param {CameraController} c Camera controller instance.
     */
    // eslint-disable-next-line @typescript-eslint/class-methods-use-this
    public adjustCameraController(c: CameraController): void {
        c.setSceneMoveSpeedMult(1.0);
    }

    /**
     * Release all GPU resources.
     *
     * @param {GfxDevice} device GPU device handle.
     */
    public destroy(device: GfxDevice): void {
        if (this.renderData) {
            this.renderData.destroy(device);
        }
        this.renderHelper.destroy();
    }

    private parseAndBuild(device: GfxDevice): void {
        const { track } = this;
        const dataSize = track.dataBuffer.byteLength;

        // Create padded buffer so N64 absolute addresses resolve
        // correctly. 0x80025c00 -> segment 0, offset 0x025c00.
        const paddedSize = TRACK_RAM_LOW24 + dataSize;
        const paddedArrayBuffer = new ArrayBuffer(paddedSize);
        new Uint8Array(paddedArrayBuffer).set(
            track.dataBuffer.createTypedArray(Uint8Array),
            TRACK_RAM_LOW24,
        );
        const paddedBuffer = new ArrayBufferSlice(paddedArrayBuffer);

        // BK's F3DEX uses (addr >>> 24) & 0xFF for segment
        // lookup. TGR addresses are 0x80XXXXXX -> segment index
        // 0x80 = 128. Create 256-entry segment buffer array with
        // index 0x80 mapped.
        const segmentBuffers: ArrayBufferSlice[] = nArray(256, () => paddedBuffer);

        const sharedOutput = new F3DEX.RSPSharedOutput();

        // Collect unique DLs and build DL->DrawCall range mapping.
        const uniqueDLOffsets: number[] = [];
        const dlOffsetSet: Set<number> = new Set();
        for (const inst of track.instances) {
            if (!dlOffsetSet.has(inst.dlOffset)) {
                dlOffsetSet.add(inst.dlOffset);
                uniqueDLOffsets.push(inst.dlOffset);
            }
        }

        // Walk all DLs through a single RSP state (persistent
        // texture state).
        const rspState = new F3DEX.RSPState(segmentBuffers, sharedOutput);
        rspState.loadVerticesOnDemand = true;

        // Set default RSP/RDP state to match what the game's
        // RenderTrackGeometry sets up before iterating track
        // instances. Instance DLs that don't set their own state
        // will inherit these defaults.
        //
        // Replicate the RSP/RDP state that RenderTrackGeometry
        // sets up before iterating track instances. Instance DLs
        // rely on this inherited state.
        //
        // CRITICAL: Tile 6 must have tmem=496 (palette TMEM
        // area) and tile 7 must have tmem=0 (load tile area).
        // Without this, LOADTLUT and LOADBLOCK both target
        // tmem=0 in the DP_TMemTracker, causing the palette
        // load to overwrite the texture DRAM address. This
        // corrupts ALL CI4/CI8 textures.

        // Tile 7: load tile at tmem=0.
        rspState.gDPSetTile(0, 1, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0);
        // Tile 6: palette at tmem=496.
        rspState.gDPSetTile(0, 0, 0, 496, 6, 0, 0, 0, 0, 0, 0, 0);
        // Tile 5: secondary at tmem=256.
        rspState.gDPSetTile(0, 0, 0, 256, 5, 0, 0, 0, 0, 0, 0, 0);
        // Enable textures, 2 LOD levels.
        rspState.gSPTexture(true, 0, 1, 0xffff, 0xffff);
        // G_PM_1PRIMITIVE (pipeline mode).
        rspState.gDPSetOtherModeH(19, 1, 0x80000);
        // G_TT_RGBA16 (texture LUT mode).
        rspState.gDPSetOtherModeH(9, 3, 0xc00);
        // G_TF_BILERP (texture filter).
        rspState.gDPSetOtherModeH(12, 2, 0x2000);
        // G_TP_NONE (texture persp correction).
        rspState.gDPSetOtherModeH(8, 1, 0x0);
        // G_RM_AA_ZB_OPA_SURF (default opaque).
        rspState.gDPSetOtherModeL(3, 29, 0x0c192038);
        // G_SHADE | G_SHADING_SMOOTH | G_ZBUFFER |
        // G_CULL_BACK.
        rspState.gSPSetGeometryMode(0x20205);
        // Default combine: (TEX1-TEX0)*LOD+TEX0.
        rspState.gDPSetCombine(0x26a004, 0x1ffc93f8);

        // Walk all unique instance DLs and record draw call ranges.
        let dlErrorCount = 0;
        const dlToDrawCallRange: Map<number, { start: number; end: number }> = new Map();

        for (const dlOff of uniqueDLOffsets) {
            const out = rspState.finish();
            const startDC = out ? out.drawCalls.length : 0;
            const dlAddr = track.pointerBase + dlOff;

            // Reset render state to defaults before each DL.
            // The game's RenderTrackGeometry sets these once
            // before the instance loop; DLs that don't set their
            // own state expect these defaults. Texture/TMEM state
            // persists intentionally across DLs.
            rspState.gSPTexture(true, 0, 1, 0xffff, 0xffff);
            rspState.gDPSetOtherModeH(19, 1, 0x80000);
            rspState.gDPSetOtherModeH(9, 3, 0xc00);
            rspState.gDPSetOtherModeH(12, 2, 0x2000);
            rspState.gDPSetOtherModeH(8, 1, 0x0);
            // Default render mode (opaque).
            rspState.gDPSetOtherModeL(3, 29, 0x0c192038);
            rspState.gSPClearGeometryMode(0xffffff);
            rspState.gSPSetGeometryMode(0x20205);
            rspState.gDPSetCombine(0x26a004, 0x1ffc93f8);

            try {
                F3DEX.runDL_F3DEX(rspState, dlAddr);
            } catch (e) {
                if (dlErrorCount < 5) {
                    console.warn(`TGR: DL at 0x${dlOff.toString(16)} failed:`, e);
                }
                dlErrorCount++;
            }

            const out2 = rspState.finish();
            const endDC = out2 ? out2.drawCalls.length : 0;
            if (endDC > startDC) {
                dlToDrawCallRange.set(dlOff, {
                    start: startDC,
                    end: endDC,
                });
            }
        }

        if (dlErrorCount > 0) {
            console.warn(
                `TGR: ${dlErrorCount} DLs failed to parse` + ` (out of ${uniqueDLOffsets.length})`,
            );
        }

        // Process sky DL if present.
        let skyDCRange: { start: number; end: number } | null = null;
        const skyOffHex = track.skyboxDLOffset.toString(16);
        const dataSizeHex = dataSize.toString(16);
        const skyValid = track.skyboxDLOffset > 0 && track.skyboxDLOffset < dataSize;
        console.debug(
            `TGR: skyboxDLOffset=0x${skyOffHex}, dataSize=0x${dataSizeHex}, valid=${skyValid}`,
        );
        if (skyValid) {
            const out = rspState.finish();
            const startDC = out ? out.drawCalls.length : 0;
            const skyAddr = track.pointerBase + track.skyboxDLOffset;

            // The sky DL sets its own RSP/RDP state, but we
            // reset to clean defaults to avoid inheriting state
            // from the last instance DL.
            rspState.gSPClearGeometryMode(0xffffff);
            // SHADE | SMOOTH | ZBUFFER | CULL_BACK.
            rspState.gSPSetGeometryMode(0x20205);
            // Textures on, no LOD.
            rspState.gSPTexture(true, 0, 0, 0xffff, 0xffff);
            // Pipeline.
            rspState.gDPSetOtherModeH(19, 1, 0x80000);
            // No texture LUT (RGBA16 sky textures).
            rspState.gDPSetOtherModeH(9, 3, 0x0);
            // Bilinear filter.
            rspState.gDPSetOtherModeH(12, 2, 0x2000);
            // No persp correction.
            rspState.gDPSetOtherModeH(8, 1, 0x0);
            // Opaque render mode.
            rspState.gDPSetOtherModeL(3, 29, 0x0c192038);
            rspState.gDPSetCombine(0x26a004, 0x1ffc93f8);

            try {
                F3DEX.runDL_F3DEX(rspState, skyAddr);
            } catch (e) {
                console.warn(`TGR: Sky DL at 0x${skyOffHex} failed:`, e);
            }

            const out2 = rspState.finish();
            const endDC = out2 ? out2.drawCalls.length : 0;
            if (endDC > startDC) {
                skyDCRange = { start: startDC, end: endDC };
                console.debug(`TGR: Sky DL generated ${endDC - startDC} draw calls.`);
            }
        }

        const rspOutput = rspState.finish();
        if (rspOutput === null) {
            console.warn("TGR: No draw calls generated");
            return;
        }

        console.debug(
            `TGR: ${rspOutput.drawCalls.length} draw calls, ` +
                `${sharedOutput.textureCache.textures.length} textures, ` +
                `${sharedOutput.vertices.length} vertices`,
        );

        // Create GPU resources.
        const cache = this.renderHelper.renderCache;
        this.renderData = new RenderData(device, cache, sharedOutput);

        // Set up texture holder for the debug texture viewer
        // panel.
        this.textureHolder = new TGRTextureHolder(this.renderData, sharedOutput);

        // N64 uses Z-up coordinate system, noclip/OpenGL uses
        // Y-up.
        const WORLD_SCALE = 100;
        const zSign = this.mirrored ? -WORLD_SCALE : WORLD_SCALE;
        const n64ToGL = mat4.fromValues(
            0,
            0,
            zSign,
            0,
            WORLD_SCALE,
            0,
            0,
            0,
            0,
            WORLD_SCALE,
            0,
            0,
            0,
            0,
            0,
            1,
        );

        // Build per-instance draw call groups with transform
        // matrices.
        const isSeasonWinner = this.trackIndex === 10;

        // Find the banner DL offset: raw instance 1 is always
        // the banner. All instances sharing this DL offset are
        // banner copies placed around the track.
        let bannerDLOffset = -1;
        for (const inst of track.instances) {
            if (inst.rawIndex === 1) {
                bannerDLOffset = inst.dlOffset;
                break;
            }
        }

        for (const inst of track.instances) {
            const range = dlToDrawCallRange.get(inst.dlOffset);
            if (!range) {
                continue;
            }

            const isBanner = bannerDLOffset >= 0 && inst.dlOffset === bannerDLOffset;

            // Direct copy of N64 row-major -> gl-matrix
            // column-major.
            const mRaw = mat4.create();
            const s = inst.matrix;
            for (let j = 0; j < 16; j++) {
                mRaw[j] = s[j];
            }

            // Apply coordinate system rotation.
            const m = mat4.create();
            mat4.mul(m, n64ToGL, mRaw);

            const drawMatrices = [m, m];
            const isTransparent = (inst.flags & 0x0008) !== 0;
            const group: TGRDrawCallGroup = {
                drawCallInstances: [],
                isTransparent,
            };

            for (let i = range.start; i < range.end; i++) {
                const dc = rspOutput.drawCalls[i];
                if (dc.indexCount === 0) {
                    continue;
                }

                // On Season Winner, hide the banner texture but
                // keep the poles.
                if (isBanner && isSeasonWinner && dc.textureIndices.length > 0) {
                    continue;
                }

                const dci = new TGRDrawCallInstance(this.renderData, drawMatrices, dc);
                dci.isTransparent = isTransparent;
                group.drawCallInstances.push(dci);
            }

            if (group.drawCallInstances.length > 0) {
                this.rawIndexToGroupIdx.set(inst.rawIndex, this.drawCallGroups.length);
                this.drawCallGroups.push(group);
            }
        }

        // Store n64ToGL for animation use.
        mat4.copy(this.n64ToGL, n64ToGL);

        // Initialize rotation animations from track animation
        // table.
        this.initAnimations(track, n64ToGL);

        // Initialize spline animations.
        this.initSplines(track);

        // Initialize animated texture channels (waterfalls,
        // bird wings, etc.).
        this.initAnimatedTextures(device, track, segmentBuffers, sharedOutput, paddedArrayBuffer);

        // Build sky draw call instances.
        if (skyDCRange) {
            // The sky dome is rendered at the camera position
            // with the N64->GL coordinate transform. We store
            // n64ToGL so prepareToRender can build a per-frame
            // matrix that tracks the camera.
            mat4.copy(this.skyN64ToGL, n64ToGL);

            // Use identity as placeholder draw matrix; the
            // actual matrix is computed per-frame in
            // prepareToRender using the camera position.
            const skyIdentity = mat4.create();
            const skyDrawMatrices = [skyIdentity, skyIdentity];

            for (let i = skyDCRange.start; i < skyDCRange.end; i++) {
                const dc = rspOutput.drawCalls[i];
                if (dc.indexCount === 0) {
                    continue;
                }

                const dci = new TGRDrawCallInstance(
                    this.renderData,
                    skyDrawMatrices,
                    dc,
                );
                dci.isSky = true;
                dci.disableDepthWrite();
                this.skyDrawCallInstances.push(dci);
            }

            console.debug(`TGR: ${this.skyDrawCallInstances.length} sky draw call instances`);
        }

        // Compute track center from the first instance's
        // translation.
        if (track.instances.length > 0) {
            const s = track.instances[0].matrix;
            if (this.mirrored) {
                vec3.set(
                    this.trackCenter,
                    s[13] * WORLD_SCALE,
                    s[14] * WORLD_SCALE,
                    -s[12] * WORLD_SCALE,
                );
            } else {
                vec3.set(
                    this.trackCenter,
                    s[13] * WORLD_SCALE,
                    s[14] * WORLD_SCALE,
                    s[12] * WORLD_SCALE,
                );
            }
        }

        const cx = this.trackCenter[0].toFixed(0);
        const cy = this.trackCenter[1].toFixed(0);
        const cz = this.trackCenter[2].toFixed(0);
        console.debug(
            `TGR: ${this.drawCallGroups.length} instance groups, center: (${cx}, ${cy}, ${cz})`,
        );
    }

    private initAnimations(track: TGRTrack, _n64ToGL: mat4): void {
        for (const anim of track.animEntries) {
            // Only rotation types for now.
            if (anim.type > 2) {
                continue;
            }

            const instRawIdx = anim.data;
            const groupIdx = this.rawIndexToGroupIdx.get(instRawIdx);
            if (groupIdx === undefined) {
                continue;
            }

            // Find the matching raw instance to get the original
            // N64 matrix.
            const inst = track.instances.find((i) => i.rawIndex === instRawIdx);
            if (!inst) {
                continue;
            }

            // Decode rotation speed from float bits.
            const buf = new ArrayBuffer(4);
            new DataView(buf).setUint32(0, anim.params, false);
            const speed = new DataView(buf).getFloat32(0, false);

            // Axis in N64 space: type 0=Z, 1=X, 2=Y.
            const axis =
                anim.type === 0
                    ? vec3.fromValues(0, 0, 1)
                    : anim.type === 1
                      ? vec3.fromValues(1, 0, 0)
                      : vec3.fromValues(0, 1, 0);

            // Store the raw N64 matrix (before n64ToGL transform).
            // This is stored as gl-matrix column-major =
            // transpose of N64 row-major.
            const baseMatrixRaw = mat4.create();
            for (let j = 0; j < 16; j++) {
                baseMatrixRaw[j] = inst.matrix[j];
            }

            this.rotationAnims.push({
                instanceRawIndex: instRawIdx,
                axis,
                speed,
                angle: 0,
                baseMatrixRaw,
            });
        }
        if (this.rotationAnims.length > 0) {
            console.debug(`TGR: ${this.rotationAnims.length} rotation animations initialized`);
        }
    }

    private updateAnimations(deltaTimeMs: number): void {
        if (this.rotationAnims.length === 0) {
            return;
        }

        // The game applies speed (in degrees) per frame at
        // ~30fps. Convert to frames:
        // deltaTimeMs / (1000/30) = deltaTimeMs * 30 / 1000.
        const dtFrames = (deltaTimeMs * 30.0) / 1000.0;
        const rotMat = mat4.create();
        const n64Result = mat4.create();
        const glResult = mat4.create();

        for (const anim of this.rotationAnims) {
            // Accumulate angle in degrees (game uses degrees per
            // frame).
            anim.angle += anim.speed * dtFrames;

            const groupIdx = this.rawIndexToGroupIdx.get(anim.instanceRawIndex);
            if (groupIdx === undefined) {
                continue;
            }
            const group = this.drawCallGroups[groupIdx];

            // Convert accumulated angle to radians for
            // mat4.fromRotation.
            const angleRad = (anim.angle * Math.PI) / 180.0;

            // RIGHT-multiply the raw N64 matrix by the rotation.
            mat4.fromRotation(rotMat, angleRad, anim.axis);
            mat4.copy(n64Result, anim.baseMatrixRaw);
            mat4.mul(n64Result, n64Result, rotMat);

            // Transform to GL space.
            mat4.mul(glResult, this.n64ToGL, n64Result);

            // Update all draw call instances in this group.
            for (const dci of group.drawCallInstances) {
                dci.setDrawMatrix(glResult);
            }
        }
    }

    private initSplines(track: TGRTrack): void {
        // Speed: 50 units/sec for most tracks, 18 for Mountain
        // (track 1) and track 6.
        const speed = this.trackIndex === 1 || this.trackIndex === 6 ? 18.0 : 50.0;

        for (const spline of track.splines) {
            const groupIdx = this.rawIndexToGroupIdx.get(spline.followerInstanceIndex);
            if (groupIdx === undefined) {
                continue;
            }

            const state: SplineAnimState = {
                instanceRawIndex: spline.followerInstanceIndex,
                leftRail: spline.leftRail,
                rightRail: spline.rightRail,
                nodeCount: spline.nodeCount,
                currentNode: 0,
                accumDist: 0,
                segmentLen: 1,
                speed,
                active: true,
            };

            // Compute initial segment length.
            TGRRenderer.computeSegmentLen(state);
            this.splineAnims.push(state);
        }
        if (this.splineAnims.length > 0) {
            console.debug(`TGR: ${this.splineAnims.length} spline animations initialized`);
        }
    }

    private updateSplines(dt: number): void {
        const tmpFwd = vec3.create();
        // N64 Z-up; we transform later.
        const tmpUp = vec3.fromValues(0, 0, 1);
        const tmpRight = vec3.create();

        for (const s of this.splineAnims) {
            if (!s.active) {
                continue;
            }

            s.accumDist += s.speed * dt;

            // Advance segments.
            while (s.accumDist >= s.segmentLen && s.currentNode + 1 < s.nodeCount - 1) {
                s.accumDist -= s.segmentLen;
                s.currentNode++;
                TGRRenderer.computeSegmentLen(s);
            }

            // Loop back to start.
            if (s.currentNode + 1 >= s.nodeCount - 1) {
                s.currentNode = 0;
                s.accumDist = 0;
                TGRRenderer.computeSegmentLen(s);
            }

            const i = s.currentNode;
            const t = s.segmentLen > 0 ? s.accumDist / s.segmentLen : 0;

            // Interpolate midpoints between left/right rails.
            const lx0 = s.leftRail[i * 3];
            const ly0 = s.leftRail[i * 3 + 1];
            const lz0 = s.leftRail[i * 3 + 2];
            const rx0 = s.rightRail[i * 3];
            const ry0 = s.rightRail[i * 3 + 1];
            const rz0 = s.rightRail[i * 3 + 2];
            const lx1 = s.leftRail[(i + 1) * 3];
            const ly1 = s.leftRail[(i + 1) * 3 + 1];
            const lz1 = s.leftRail[(i + 1) * 3 + 2];
            const rx1 = s.rightRail[(i + 1) * 3];
            const ry1 = s.rightRail[(i + 1) * 3 + 1];
            const rz1 = s.rightRail[(i + 1) * 3 + 2];

            const mx0 = (lx0 + rx0) * 0.5;
            const my0 = (ly0 + ry0) * 0.5;
            const mz0 = (lz0 + rz0) * 0.5;
            const mx1 = (lx1 + rx1) * 0.5;
            const my1 = (ly1 + ry1) * 0.5;
            const mz1 = (lz1 + rz1) * 0.5;

            // Position: lerp between midpoints (N64 space).
            const px = mx0 + (mx1 - mx0) * t;
            const py = my0 + (my1 - my0) * t;
            const pz = mz0 + (mz1 - mz0) * t;

            // Forward direction (N64 space).
            tmpFwd[0] = mx1 - mx0;
            tmpFwd[1] = my1 - my0;
            tmpFwd[2] = mz1 - mz0;
            vec3.normalize(tmpFwd, tmpFwd);

            // Build N64-space 4x4 matrix with position and
            // orientation. Use forward as X, compute
            // right = fwd x up, then recompute up.
            vec3.set(tmpUp, 0, 0, 1); // N64 Z is up.
            vec3.cross(tmpRight, tmpFwd, tmpUp);
            vec3.normalize(tmpRight, tmpRight);
            vec3.cross(tmpUp, tmpRight, tmpFwd);
            vec3.normalize(tmpUp, tmpUp);

            // N64 row-major matrix stored column-major in our
            // Float32Array: Row 0 = forward (X),
            // Row 1 = right (Y), Row 2 = up (Z),
            // Row 3 = position.
            const mRaw = mat4.fromValues(
                tmpFwd[0],
                tmpRight[0],
                tmpUp[0],
                0,
                tmpFwd[1],
                tmpRight[1],
                tmpUp[1],
                0,
                tmpFwd[2],
                tmpRight[2],
                tmpUp[2],
                0,
                px,
                py,
                pz,
                1,
            );

            // Transform to GL space.
            const mGL = mat4.create();
            mat4.mul(mGL, this.n64ToGL, mRaw);

            // Update draw call group.
            const groupIdx = this.rawIndexToGroupIdx.get(s.instanceRawIndex);
            if (groupIdx === undefined) {
                continue;
            }
            const group = this.drawCallGroups[groupIdx];
            for (const dci of group.drawCallInstances) {
                dci.setDrawMatrix(mGL);
            }
        }
    }

    private initAnimatedTextures(
        device: GfxDevice,
        track: TGRTrack,
        segmentBuffers: ArrayBufferSlice[],
        sharedOutput: F3DEX.RSPSharedOutput,
        paddedArrayBuffer: ArrayBuffer,
    ): void {
        if (track.animTexChannels.length === 0 || !this.renderData) {
            return;
        }

        const texCache = sharedOutput.textureCache.textures;
        const paddedU8 = new Uint8Array(paddedArrayBuffer);

        for (const ch of track.animTexChannels) {
            const dramAddr = track.pointerBase + ch.destOffset;
            const bufOffset = TRACK_RAM_LOW24 + ch.destOffset;

            // Find the base texture cache entry that matches
            // this channel's DRAM address.
            let baseCacheIdx = -1;
            for (let i = 0; i < texCache.length; i++) {
                if (texCache[i].dramAddr === dramAddr) {
                    baseCacheIdx = i;
                    break;
                }
            }
            if (baseCacheIdx < 0) {
                console.warn(
                    `TGR: Animated tex channel dest=0x${dramAddr.toString(16)} not found in texture cache.`,
                );
                continue;
            }

            const baseTex = texCache[baseCacheIdx];

            // Save the original texture data (KF0).
            const origData = paddedU8.slice(bufOffset, bufOffset + ch.texSize);

            // Build GPU textures for each keyframe.
            const keyframeGfxTextures: GfxTexture[] = [];
            const keyframeTimes: number[] = [];

            // KF0 is already the base texture in renderData.
            keyframeGfxTextures.push(this.renderData.textures[baseCacheIdx]);
            keyframeTimes.push(ch.keyframes[0].time);

            for (let ki = 1; ki < ch.keyframes.length; ki++) {
                const kf = ch.keyframes[ki];
                keyframeTimes.push(kf.time);

                // Copy this keyframe's texture data into the
                // padded buffer.
                paddedU8.set(kf.texData, bufOffset);

                // Re-translate the texture using the same tile
                // state.
                const newTex = RDP.translateTileTexture(
                    segmentBuffers,
                    dramAddr,
                    baseTex.dramPalAddr,
                    baseTex.tile,
                    true,
                );
                keyframeGfxTextures.push(RDP.translateToGfxTexture(device, newTex));
            }

            // Restore original KF0 data.
            paddedU8.set(origData, bufOffset);

            // Find all draw call instances that reference this
            // texture.
            const affected: TGRDrawCallInstance[] = [];
            for (const group of this.drawCallGroups) {
                for (const dci of group.drawCallInstances) {
                    for (let slot = 0; slot < 2; slot++) {
                        if (dci.getTextureIndex(slot) === baseCacheIdx) {
                            affected.push(dci);
                            break;
                        }
                    }
                }
            }

            // Total cycle time = lastKF.time - firstKF.time (the
            // game uses modulo of this).
            const [firstTime] = keyframeTimes;
            const lastTime = keyframeTimes[keyframeTimes.length - 1];
            const totalCycleTime = lastTime - firstTime;
            // If cycle is 0 (shouldn't happen), use a default.
            const safeCycleTime = totalCycleTime > 0 ? totalCycleTime : 1000;

            this.animTexStates.push({
                texCacheIndex: baseCacheIdx,
                keyframeTimes,
                keyframeGfxTextures,
                currentKeyframe: 0,
                timeAccum: 0,
                totalCycleTime: safeCycleTime,
                affectedDrawCalls: affected,
            });
        }

        if (this.animTexStates.length > 0) {
            const totalKF = this.animTexStates.reduce(
                (s, a) => s + a.keyframeGfxTextures.length,
                0,
            );
            console.debug(
                `TGR: ${this.animTexStates.length} animated texture channels ` +
                    `(${totalKF} total GPU textures)`,
            );
        }
    }

    private updateAnimatedTextures(dtMs: number): void {
        // All animated texture channels share a single global
        // elapsed time (milliseconds). The game uses:
        // elapsedMs % totalCycleDuration to select keyframes.
        this.animTexElapsedMs += dtMs;

        for (const at of this.animTexStates) {
            // Wrap time within the cycle:
            // totalCycleTime = lastKF.time - firstKF.time.
            const wrappedTime =
                at.totalCycleTime > 0 ? this.animTexElapsedMs % at.totalCycleTime : 0;

            // Find active keyframe: walk forward, find last KF
            // whose time <= wrappedTime.
            let kfIdx = 0;
            for (let i = 1; i < at.keyframeTimes.length; i++) {
                const kfDelta = at.keyframeTimes[i] - at.keyframeTimes[0];
                if (wrappedTime < kfDelta) {
                    break;
                }
                kfIdx = i;
            }

            if (kfIdx !== at.currentKeyframe) {
                at.currentKeyframe = kfIdx;
                const tex = at.keyframeGfxTextures[kfIdx];
                for (const dci of at.affectedDrawCalls) {
                    for (let slot = 0; slot < 2; slot++) {
                        if (dci.getTextureIndex(slot) === at.texCacheIndex) {
                            dci.setGfxTexture(slot, tex);
                        }
                    }
                }
            }
        }
    }
}
