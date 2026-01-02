
import { mat4, vec2, vec3 } from "gl-matrix";
import { OpaqueBlack, White, colorCopy, colorNewCopy } from "../Color.js";
import { projectionMatrixForCuboid, saturate } from '../MathHelpers.js';
import { TSDraw } from "../SuperMarioGalaxy/DDraw.js";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers.js";
import { projectionMatrixConvertClipSpaceNearZ } from '../gfx/helpers/ProjectionHelpers.js';
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxChannelWriteMask, GfxClipSpaceNearZ, GfxCompareMode, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxRenderPass, GfxSampler, GfxSamplerFormatKind, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxRenderInst, GfxRenderInstExecutionOrder, GfxRenderInstList, GfxRenderInstManager, gfxRenderInstCompareNone, gfxRenderInstCompareSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder.js';
import { DisplayListRegisters, GX_Array, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData, LoadedVertexLayout, compileVtxLoader, displayListRegistersInitGX, displayListRegistersRun } from "../gx/gx_displaylist.js";
import * as GX from '../gx/gx_enum.js';
import { GX_Program } from '../gx/gx_material.js';
import { ColorKind, DrawParams, GXMaterialHelperGfx, MaterialParams, SceneParams, createInputLayout, fillFogBlock, fillSceneParamsData, ub_SceneParamsBufferSize } from "../gx/gx_render.js";
import { assert, assertExists, nArray } from '../util.js';
import { ViewerRenderInput } from '../viewer.js';
import { SymbolMap, dGlobals } from './Main.js';
import { PeekZManager } from "./d_dlst_peekZ.js";
import { cBgS_PolyInfo } from "./d_bg.js";
import { BTI_Texture, BTIData } from "../Common/JSYSTEM/JUTTexture.js";
import { J3DModelInstance } from "../Common/JSYSTEM/J3D/J3DGraphBase.js";
import { dKy_GxFog_set, dKy_tevstr_c } from "./d_kankyo.js";
import { cM_s2rad } from "./SComponent.js";
import { dRes_control_c, ResType } from "./d_resorce.js";
import { DeviceProgram } from "../Program.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { fullscreenMegaState, setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { preprocessProgramObj_GLSL } from "../gfx/shaderc/GfxShaderCompiler.js";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription, GfxrRenderTargetID } from "../gfx/render/GfxRenderGraph.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { IsDepthReversed } from "../gfx/helpers/ReversedDepthHelpers.js";
import { AABB } from "../Geometry.js";

export enum dDlst_alphaModel__Type {
    Bonbori,
    BonboriTwice,
    BeamCheck,
    Cube,
    Bonbori2,
    BonboriThrice,
}

class dDlst_alphaModelData_c {
    constructor(public type: dDlst_alphaModel__Type, public mtx: mat4, public alpha: number) {
    }
}

export class dDlst_BasicShape_c {
    public inputLayout: GfxInputLayout;
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public indexCount: number;

    constructor(cache: GfxRenderCache, loadedVertexLayout: LoadedVertexLayout, loadedVertexData: LoadedVertexData) {
        this.inputLayout = createInputLayout(cache, loadedVertexLayout);
        this.vertexBuffer = createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, loadedVertexData.vertexBuffers[0]);
        this.indexBuffer = createBufferFromData(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, loadedVertexData.indexData);
        assert(loadedVertexData.draws.length === 1);
        assert(loadedVertexData.draws[0].indexOffset === 0);
        this.indexCount = loadedVertexData.draws[0].indexCount;
    }

    public setOnRenderInst(renderInst: GfxRenderInst): void {
        renderInst.setVertexInput(this.inputLayout, [{ buffer: this.vertexBuffer }], { buffer: this.indexBuffer });
        renderInst.setDrawCount(this.indexCount);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

const drawParams = new DrawParams();
const materialParams = new MaterialParams();
const sceneParams = new SceneParams();
class dDlst_alphaModel_c {
    public color = colorNewCopy(White);
    private datas: dDlst_alphaModelData_c[] = [];

    private materialHelperBackRevZ: GXMaterialHelperGfx;
    private materialHelperFrontZ: GXMaterialHelperGfx;
    private bonboriShape: dDlst_BasicShape_c;

    private materialHelperDrawAlpha: GXMaterialHelperGfx;
    private orthoSceneParams = new SceneParams();
    private orthoQuad = new TSDraw('dDlst_alphaModel_c');

    constructor(device: GfxDevice, cache: GfxRenderCache, symbolMap: SymbolMap) {
        const bonboriPos = symbolMap.findSymbolData(`d_drawlist.o`, `l_bonboriPos`);
        const bonboriDL = symbolMap.findSymbolData(`d_drawlist.o`, `l_bonboriDL`);

        const vat: GX_VtxAttrFmt[] = [];
        vat[GX.Attr.POS] = { compType: GX.CompType.F32, compCnt: GX.CompCnt.POS_XYZ, compShift: 0 };
        const vcd: GX_VtxDesc[] = [];
        vcd[GX.Attr.POS] = { type: GX.AttrType.INDEX8 };
        const bonboriVtxLoader = compileVtxLoader(vat, vcd);

        const shadowVtxArrays: GX_Array[] = [];
        shadowVtxArrays[GX.Attr.POS] = { buffer: bonboriPos, offs: 0, stride: 0x0C };
        const bonboriVertices = bonboriVtxLoader.runVertices(shadowVtxArrays, bonboriDL);
        this.bonboriShape = new dDlst_BasicShape_c(cache, bonboriVtxLoader.loadedVertexLayout, bonboriVertices);

        const matRegisters = new DisplayListRegisters();
        displayListRegistersInitGX(matRegisters);

        displayListRegistersRun(matRegisters, symbolMap.findSymbolData(`d_drawlist.o`, `l_matDL$5108`));

        // Original game uses three different materials -- two add, one sub. We can reduce this to two draws.
        displayListRegistersRun(matRegisters, symbolMap.findSymbolData(`d_drawlist.o`, `l_backRevZMat`));

        const matBuilder = new GXMaterialBuilder();
        matBuilder.setFromRegisters(matRegisters);

        this.materialHelperBackRevZ = new GXMaterialHelperGfx(matBuilder.finish(`dDlst_alphaModel_c l_backRevZMat`));

        displayListRegistersRun(matRegisters, symbolMap.findSymbolData(`d_drawlist.o`, `l_frontZMat`));
        matBuilder.setFromRegisters(matRegisters);

        const frontZ = matBuilder.finish(`dDlst_alphaModel_c l_frontZMat`);
        // TODO(jstpierre): Do this with GXMatBuilder
        frontZ.ropInfo.blendMode = GX.BlendMode.SUBTRACT;
        frontZ.ropInfo.depthFunc = GX.CompareType.GREATER;

        this.materialHelperFrontZ = new GXMaterialHelperGfx(frontZ);

        assert(this.materialHelperBackRevZ.materialParamsBufferSize === this.materialHelperFrontZ.materialParamsBufferSize);

        const mb = new GXMaterialBuilder(`dDlst_alphaModel_c drawAlphaBuffer`);
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.RASC);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setZMode(false, GX.CompareType.ALWAYS, false);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.DSTALPHA, GX.BlendFactor.ONE); // the magic is the DSTALPHA
        mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.OR, GX.CompareType.ALWAYS, 0);
        this.materialHelperDrawAlpha = new GXMaterialHelperGfx(mb.finish());

        projectionMatrixForCuboid(this.orthoSceneParams.u_Projection, 0, 1, 0, 1, 0, 10);
        const clipSpaceNearZ = device.queryVendorInfo().clipSpaceNearZ;
        projectionMatrixConvertClipSpaceNearZ(this.orthoSceneParams.u_Projection, clipSpaceNearZ, GfxClipSpaceNearZ.NegativeOne);

        this.orthoQuad.setVtxDesc(GX.Attr.POS, true);

        this.orthoQuad.beginDraw(cache);
        this.orthoQuad.begin(GX.Command.DRAW_QUADS, 4);
        this.orthoQuad.position3f32(0, 0, 0);
        this.orthoQuad.position3f32(1, 0, 0);
        this.orthoQuad.position3f32(1, 1, 0);
        this.orthoQuad.position3f32(0, 1, 0);
        this.orthoQuad.end();
        this.orthoQuad.endDraw(cache);
    }

    private reset(): void {
        this.datas.length = 0;
    }

    public set(type: dDlst_alphaModel__Type, mtx: mat4, alpha: number): void {
        this.datas.push(new dDlst_alphaModelData_c(type, mtx, alpha));
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (this.datas.length === 0)
            return;

        const cache = globals.modelCache.cache;

        for (let i = 0; i < this.datas.length; i++) {
            const data = this.datas[i];

            const template = renderInstManager.pushTemplate();

            if (data.type === dDlst_alphaModel__Type.Bonbori) {
                this.bonboriShape.setOnRenderInst(template);
                mat4.mul(drawParams.u_PosMtx[0], globals.camera.viewFromWorldMatrix, data.mtx);
                this.materialHelperBackRevZ.allocateDrawParamsDataOnInst(template, drawParams);

                materialParams.u_Color[ColorKind.MAT0].a = data.alpha / 0xFF;

                // These materials should all have the same buffer size (asserted for in constructor)
                this.materialHelperBackRevZ.allocateMaterialParamsDataOnInst(template, materialParams);

                const back = renderInstManager.newRenderInst();
                this.materialHelperBackRevZ.setOnRenderInst(cache, back);
                renderInstManager.submitRenderInst(back);

                const front = renderInstManager.newRenderInst();
                this.materialHelperFrontZ.setOnRenderInst(cache, front);
                renderInstManager.submitRenderInst(front);
            }

            renderInstManager.popTemplate();
        }

        // Blend onto main screen.
        const renderInst = renderInstManager.newRenderInst();
        const sceneParamsOffs = renderInst.allocateUniformBuffer(GX_Program.ub_SceneParams, ub_SceneParamsBufferSize);
        fillSceneParamsData(renderInst.mapUniformBufferF32(GX_Program.ub_SceneParams), sceneParamsOffs, this.orthoSceneParams);
        this.materialHelperDrawAlpha.setOnRenderInst(cache, renderInst);
        colorCopy(materialParams.u_Color[ColorKind.MAT0], this.color);
        this.materialHelperDrawAlpha.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        this.orthoQuad.setOnRenderInst(renderInst);
        mat4.identity(drawParams.u_PosMtx[0]);
        this.materialHelperDrawAlpha.allocateDrawParamsDataOnInst(renderInst, drawParams);
        renderInstManager.submitRenderInst(renderInst);

        this.reset();
    }

    public destroy(device: GfxDevice): void {
        this.bonboriShape.destroy(device);
        this.orthoQuad.destroy(device);
    }
}

export type dDlst_list_Set = [GfxRenderInstList, GfxRenderInstList];

export class dDlst_list_c {
    public sky: dDlst_list_Set = [
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards),
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards),
    ];
    public sea = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards);
    public bg: dDlst_list_Set = [
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Forwards),
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Forwards),
    ];
    public main: dDlst_list_Set = [
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Forwards),
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Forwards),
    ];
    public wetherEffect = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards);
    public wetherEffectSet: dDlst_list_Set = [
        this.wetherEffect, this.wetherEffect,
    ]
    public effect: dDlst_list_Set = [
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Backwards),
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Backwards),
    ];
    public ui: dDlst_list_Set = [
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards),
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards),
    ];

    // These correspond to 2DOpa and 2DXlu
    public ui2D: dDlst_list_Set = [
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Forwards),
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Forwards)
    ];

    public particle2DBack = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Forwards);
    public particle2DFore = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Forwards);

    public alphaModel = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Forwards);
    public shadow = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Forwards);
    public peekZ = new PeekZManager(128);
    public alphaModel0: dDlst_alphaModel_c;
    public shadowControl: dDlst_shadowControl_c;

    constructor(device: GfxDevice, cache: GfxRenderCache, resCtrl: dRes_control_c, symbolMap: SymbolMap) {
        this.alphaModel0 = new dDlst_alphaModel_c(device, cache, symbolMap);
        this.shadowControl = new dDlst_shadowControl_c(device, cache, resCtrl);
    }

    public destroy(device: GfxDevice): void {
        this.peekZ.destroy(device);
        this.alphaModel0.destroy(device);
        this.shadowControl.destroy(device);
    }
}

class DownsampleProgram extends DeviceProgram {
    public override vert = GfxShaderLibrary.fullscreenVS;
    public override frag = GfxShaderLibrary.fullscreenBlitOneTexPS;
}

class ShadowVolumeProgram extends DeviceProgram {
    public static bindingLayouts: GfxBindingLayoutDescriptor[] = [{
        numUniformBuffers: 1, numSamplers: 2, samplerEntries: [
            { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
            { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.UnfilterableFloat, },
        ]
    }];

    private generateFogZCoord() {
        const isDepthReversed = IsDepthReversed;
        if (isDepthReversed)
            return `(1.0 - gl_FragCoord.z)`;
        else
            return `gl_FragCoord.z`;
    }

    private generateFogBase() {
        // We allow switching between orthographic & perspective at runtime for the benefit of camera controls.
        // const ropInfo = this.material.ropInfo;
        // const proj = !!(ropInfo.fogType >>> 3);
        // const isProjection = (proj === 0);
        const isProjection = `(u_FogBlock.Param.y != 0.0)`;

        const A = `u_FogBlock.Param.x`;
        const B = `u_FogBlock.Param.y`;
        const z = this.generateFogZCoord();

        return `(${isProjection}) ? (${A} / (${B} - ${z})) : (${A} * ${z})`;
    }

    private generateFogAdj(base: string) {
        // TODO(jstpierre): Fog adj
        return ``;
    }

    public generateFog() {
        const C = `u_FogBlock.Param.z`;
        return `
    float t_FogBase = ${this.generateFogBase()};
    ${this.generateFogAdj(`t_FogBase`)}
    float t_FogZ = saturate(t_FogBase - ${C});
    t_PixelOut.rgb = mix(t_PixelOut.rgb, u_FogBlock.Color.rgb, t_FogZ);
`;
    }

    constructor() {
        super();

        this.both = `
${GfxShaderLibrary.MatrixLibrary}
${GfxShaderLibrary.saturate}

struct FogBlock {
    // A, B, C, Center
    vec4 Param;
    // 10 items
    vec4 AdjTable[3];
    // Fog color is RGB
    vec4 Color;
};

layout(std140) uniform ub_Params {
    vec2 u_ViewportSize;
    vec2 u_Params;
    vec4 u_AtlasScaleBias;
    Mat4x4 u_ClipFromLocal;
    Mat4x4 u_LocalFromClip;
    FogBlock u_FogBlock;
};

layout(location = 0) uniform sampler2D u_TextureShadow;
layout(location = 1) uniform sampler2D u_TextureFramebufferDepth; // Depth buffer

#if defined VERT
layout(location = 0) in vec3 a_Position; // Cube coordinates (-1 to 1).

void main() {
    gl_Position = UnpackMatrix(u_ClipFromLocal) * vec4(a_Position.xyz, 1.0);
}
#elif defined FRAG

void main() {
    vec3 t_ClipPos;
    t_ClipPos.xy = (gl_FragCoord.xy / u_ViewportSize.xy) * 2.0 - vec2(1.0);
#if GFX_VIEWPORT_ORIGIN_TL()
    t_ClipPos.y *= -1.0;
#endif
    t_ClipPos.z = texelFetch(SAMPLER_2D(u_TextureFramebufferDepth), ivec2(gl_FragCoord.xy), 0).r;
#if !GFX_CLIPSPACE_NEAR_ZERO()
    t_ClipPos.z = t_ClipPos.z * 2.0 - 1.0;
#endif
    vec4 t_ObjectPos = UnpackMatrix(u_LocalFromClip) * vec4(t_ClipPos, 1.0);
    t_ObjectPos.xyz /= t_ObjectPos.w;

    // Now that we have our object-space position, remove any samples outside of the box.
    if (any(lessThan(t_ObjectPos.xyz, vec3(-1))) || any(greaterThan(t_ObjectPos.xyz, vec3(1))))
        discard;

    // Top-down project our shadow texture. Our local space is between -1 and 1, we want to move into 0.0 to 1.0.
    vec2 t_ShadowTexCoord = t_ObjectPos.xy * vec2(0.5) + vec2(0.5);
    t_ShadowTexCoord = t_ShadowTexCoord * u_AtlasScaleBias.xy + u_AtlasScaleBias.zw;
    float t_ShadowColor = texture(SAMPLER_2D(u_TextureShadow), t_ShadowTexCoord).r;
    
    // If sampling from a predefined texture, smooth the shadow edges
    float shadowStep =  u_Params.x;
    float smoothFactor = u_Params.y;
    float t_Alpha = smoothstep(shadowStep, shadowStep + smoothFactor, t_ShadowColor);
    
    vec4 t_PixelOut = vec4(0, 0, 0, 0.25 * t_Alpha);

    ${this.generateFog()}

    gl_FragColor = t_PixelOut;
}
#endif
`;
    }
}

const scratchMat4 = mat4.create();
const scratchVec3a = vec3.create();
const scratchAABB = new AABB();

const realShadowCount = 8;
const shadowAtlasDim = getAtlasDimensions(realShadowCount);
const shadowAtlasInvDim = [1.0 / shadowAtlasDim[0], 1.0 / shadowAtlasDim[1]];

function getAtlasDimensions(count: number): [number, number] {
    let dimMin = Math.floor(Math.sqrt(count));
    while (count % dimMin !== 0) { dimMin--; }
    const dimMax = count / dimMin;
    return [dimMax, dimMin];
}

class dDlst_shadowReal_c {
    public state = 0; // 0: unallocated, 1: ready, 2: pendingDelete
    public id: number = 0;

    private models: J3DModelInstance[] = [];
    private alpha: number = 0; // 0-255
    private lightViewMtx = mat4.create();
    private lightProjMtx = mat4.create();
    private modelMtx = mat4.create();
    private volumeFromWorld = mat4.create();
    private atlasOffset = vec2.create();

    constructor(private index: number) {
        this.atlasOffset = [this.index % shadowAtlasDim[0], Math.floor(this.index / shadowAtlasDim[0])];
    }

    public reset(): void {
        if (this.state === 1) {
            this.state = 2; // This shadow will be freed next frame if not set() again 
        } else {
            this.state = 0;
        }
        this.models.length = 0;
    }

    public imageDraw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const template = renderInstManager.pushTemplate();
        mat4.copy(sceneParams.u_Projection, this.lightProjMtx);
        const d = template.allocateUniformBufferF32(GX_Program.ub_SceneParams, ub_SceneParamsBufferSize);
        fillSceneParamsData(d, 0, sceneParams);
        for (let i = 0; i < this.models.length; i++) {
            const model = this.models[i];
            model.shapeInstances
            model.calcView(this.lightViewMtx, null);

            if (!model.isAnyShapeVisible())
                return;

            // Ensure model always draws a non-black color to the buffer (Depth is harder to debug and downsample)
            model.setVertexColorsEnabled(false);
            model.setLightingEnabled(false);
            model.setTexturesEnabled(false);

            model.drawOpa(renderInstManager, this.lightProjMtx);
            model.drawXlu(renderInstManager, this.lightProjMtx);

            model.setVertexColorsEnabled(globals.renderHacks.vertexColorsEnabled);
            model.setLightingEnabled(true);
            model.setTexturesEnabled(globals.renderHacks.texturesEnabled);
        }
        renderInstManager.popTemplate();
    }

    // Draw "real" shadows
    // noclip modification: The game's original real shadowing uses many draw calls which is inefficient on modern hardware. It works as follows:
    // 1. Compute a bounding box for the shadow, gather any bg triangles that intersect it. These will be the shadow receivers.
    // 2. Cull any shadow receiver bounding boxes that are outside of the camera frustum.
    // 3. Generate a 256x256 shadow map by rendering the shadow caster from the light's point of view into a texture.
    // 4. Downsample the shadowmap into a 128x128 4bpp texture, and generate mipmaps. 
    // 5. Render the front/back faces of the bounding box into the alpha buffer, adding/subtracting just like simple shadows 2. & 3.
    // 6. Render all of the bg triangles gathered in step 1, sampling from the shadow map, clear the alpha where texture not > 0.
    // 7. Render the bounding box, clearing the alpha to 0. This same framebuffer is used to render other shadows, and then alpha objects.
    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (this.state !== 1)
            return;

        const worldFromClip = mat4.invert(scratchMat4, globals.camera.clipFromWorldMatrix);

        const renderInst = renderInstManager.newRenderInst();
        let offset = renderInst.allocateUniformBuffer(0, 8 + 16 * 2 + 20);
        const buf = renderInst.mapUniformBufferF32(0);
        offset += fillVec4(buf, offset, viewerInput.backbufferWidth, viewerInput.backbufferHeight, 0.5, 0.0);
        offset += fillVec4(buf, offset, shadowAtlasInvDim[0], shadowAtlasInvDim[1], this.atlasOffset[0] * shadowAtlasInvDim[0], this.atlasOffset[1] * shadowAtlasInvDim[1]);
        offset += fillMatrix4x4(buf, offset, this.modelMtx);
        offset += fillMatrix4x4(buf, offset, mat4.mul(scratchMat4, this.volumeFromWorld, worldFromClip));
        offset += fillFogBlock(buf, offset, materialParams.u_FogBlock);
        materialParams.m_TextureMapping[0].lateBinding = 'shadowmap-target';
        materialParams.m_TextureMapping[1].lateBinding = 'depth-target';
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        renderInstManager.submitRenderInst(renderInst);
    }

    public set(shouldFade: number, model: J3DModelInstance, pos: vec3, casterSize: number, heightAgl: number, tevStr: dKy_tevstr_c): number {
        // TODO: Implement set logic
        return this.id;
    }

    public set2(globals: dGlobals, shouldFade: number, model: J3DModelInstance, casterCenter: vec3, casterSize: number, heightAgl: number, tevStr: dKy_tevstr_c): number {
        if (this.models.length === 0) {
            assertExists(tevStr); // The game allows passing a null tevStr (uses player's light pos), we do not.
            const lightPos = tevStr.lightObj.Position;
            this.alpha = this.setShadowRealMtx(globals, this.lightViewMtx, this.lightProjMtx, this.modelMtx, lightPos, casterCenter, casterSize, heightAgl,
                shouldFade == 0 ? 0.0 : heightAgl * 0.0007);

            if (this.alpha === 0)
                return 0;

            this.state = 1;
            this.models.length = 0;
        }

        this.models.push(model);
        return this.id;
    }

    public add(model: J3DModelInstance): boolean {
        if (this.models.length === 0) {
            return false;
        }

        this.models.push(model);
        return true;
    }

    private setShadowRealMtx(globals: dGlobals, lightViewMtx: mat4, lightProjMtx: mat4, modelMtx: mat4, lightPos: vec3, casterCenter: vec3,
        casterSize: number, heightAgl: number, heightFade: number): number {
        if (heightFade >= 1.0) {
            return 0;
        }

        let opacity = Math.min(1.0, 1.0 - heightFade);
        let alpha = Math.floor(200.0 * opacity);

        // NOTE(mikelester): The game uses the same values for casterSize and center Y offset for almost all actors (800 and 150).
        //       This results in poor shadowmap fitting, however it does keep the shadow detail consistent across actors.
        //       I think this was a conscious design choice, so I'm going to leave it. We're judging the shadows at a much
        //       higher resolution than the original hardware, so if an actor looks particularly bad we can tweak its casterSize and y offset. 

        // Calculate light vector
        const lightVec = scratchVec3a;
        vec3.sub(lightVec, lightPos, casterCenter);

        // The higher off the ground a shadow caster is, the weaker the shadow's horizontal components become
        // This cheats the light vec to be more vertical when the caster is in the air, a la platforming drop shadows
        // At 50 units above ground, the shadow is fully vertical
        lightVec[1] += heightAgl;
        let xzScale = Math.max(0.0, 0.02 * (50.0 - heightAgl));
        lightVec[0] *= xzScale;
        lightVec[2] *= xzScale;

        // Place the light pos / shadowmap camera just outside of the caster radius
        let lightDist = vec3.length(lightVec);
        if (lightDist !== 0.0) {
            let tmp3 = (lightVec[1] / lightDist);
            if (tmp3 < 1.5) {
                lightVec[1] = 1.5 * lightDist;
                lightDist = vec3.length(lightVec);
            }
            lightDist = (casterSize * 0.5) / lightDist;
        }
        vec3.scale(lightVec, lightVec, lightDist);
        vec3.add(lightVec, lightVec, casterCenter);

        // Calculate caster radius and ray direction
        const casterRadius = casterSize * 0.4;
        const rayDir = vec3.create();
        vec3.sub(rayDir, casterCenter, lightVec);
        if (vec3.squaredLength(rayDir) === 0.0) {
            rayDir[1] = -1.0;
            lightVec[1] = casterCenter[1] + 1.0;
        } else {
            vec3.normalize(rayDir, rayDir);
        }

        // noclip modification: 
        // The game uses realPolygonCheck to gather a list of bg polygons that intersect the shadow's bounding volume.
        // These are then renderered to sample the shadow map. Instead, we render an oriented box (the shadow volume) and sample the shadowmap there.
        // if (!realPolygonCheck(casterCenter, casterRadius, heightAgl, rayDir, shadowPoly)) {
        //     return 0;
        // }

        // Build view matrix (lookAt)
        mat4.lookAt(lightViewMtx, lightVec, casterCenter, [0, 1, 0]);
        mat4.orthoZO(lightProjMtx, -casterRadius, casterRadius, -casterRadius, casterRadius, 1.0, 10000.0);

        // Scale and bias the projection to fit into our slot in the shadowmap atlas
        const vpMtx = mat4.fromTranslation(scratchMat4, [shadowAtlasInvDim[0] * (1 + 2 * this.atlasOffset[0]) - 1.0, shadowAtlasInvDim[1] * (1 + 2 * this.atlasOffset[1]) - 1.0, 0]);
        mat4.scale(scratchMat4, scratchMat4, [shadowAtlasInvDim[0], shadowAtlasInvDim[1], 1]);
        mat4.mul(lightProjMtx, vpMtx, lightProjMtx);

        // Compute the end caps for the oriented shadow volume. Ideally we want the start cap to be just above ground level, and end cap to be fully below.
        const hMag = Math.sqrt(rayDir[0] * rayDir[0] + rayDir[2] * rayDir[2]);
        const lightAngle = Math.atan2(-rayDir[1], hMag);
        const volZEnd = casterSize / Math.sin( lightAngle ) + heightAgl;
        const volZStart = -10;

        // Build a matrix to transform a world space position into the shadowmap's ortho frustum. The xy position can then be used to sample the shadowmap.
        const view = mat4.lookAt(mat4.create(), casterCenter, vec3.add(scratchVec3a, casterCenter, rayDir), [0, 1, 0]);
        const proj = mat4.orthoNO(mat4.create(), -casterRadius, casterRadius, -casterRadius, casterRadius, volZStart, volZEnd);
        mat4.mul(this.volumeFromWorld, proj, view);

        // TODO: Defer this until image draw. There, compute a bounding box in light frustum space. Manipulate the z range, and that is our tight shadow volume.
        const worldFromVolume = mat4.invert(scratchMat4, this.volumeFromWorld);
        mat4.scale(worldFromVolume, worldFromVolume, [0.5, 0.5, 1.0]);
        mat4.mul(this.modelMtx, globals.camera.clipFromWorldMatrix, worldFromVolume);

        // Cull the shadow receiver volume. If culled for two frames, this id will be freed.
        scratchAABB.set(-1, -1, -1, 1, 1, 1);
        scratchAABB.transform(scratchAABB, this.modelMtx);
        if (globals.camera.frustum.contains(scratchAABB))
            return 0.0;

        return alpha;
    }
}

// Renders a simple cube-shaped shadow volume directly below an object (light position is ignored). Optionally, use a 
// texture (defaults to a circle) oriented to the ground normal to stencil out the shadow volume (i.e. a gobo texture).
class dDlst_shadowSimple_c {
    public alpha: number = 0; // 0-255
    public tex: BTIData;
    public modelMtx = mat4.create();

    // noclip modification: The game's original shadowing uses many draw calls which is inefficient on modern hardware. It works as follows:
    // 1. For each shadow, create a box directly under the object. Its Y rotation matches the caster. It's height is based on the ground slope.
    // 2. Render the front faces of the box, adding 0.25 to the empty alpha buffer. Depth testing is enabled. Similar to shadow volumes.
    // 3. Render the back faces of the box, subtracting 0.25 from the empty alpha buffer. Now alpha is filled only where the box interesects the ground. 
    // 4. If the shadow has a texture (defaults to a circle): Render a textured quad oriented to the ground normal, clear the alpha where texture is 0.
    // 5. Render the box, multiplying the color buffer by (1.0 - alpha). This darkens the areas where the shadow is visible.
    // 6. Render the box, clearing the alpha to 0. This same framebuffer is used to render other shadows, and then alpha objects.
    // We take a different approach, blending each shadow directly into the color buffer with a single draw call using a deferred decal technique. 
    // The results are very similar, with a few exceptions:
    // - For overlapping shadows, the game multiples color by (1.0 - 0.25 * N). We multiply by 0.75 ^ N. Similar results for 2 shadows, but at 3 ours will be lighter.
    // - For shadows overlapping ledges, the game's textured-quad approach will appear to hang over the edge. Ours will project the shadow down to the lower level. 
    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const renderInst = renderInstManager.newRenderInst();
        let offset = renderInst.allocateUniformBuffer(0, 8 + 16 * 2 + 20);
        const buf = renderInst.mapUniformBufferF32(0);
        offset += fillVec4(buf, offset, viewerInput.backbufferWidth, viewerInput.backbufferHeight, 0.0, 0.1);
        offset += fillVec4(buf, offset, 1.0, 1.0, 0.0, 0.0);
        offset += fillMatrix4x4(buf, offset, mat4.mul(scratchMat4, globals.camera.clipFromWorldMatrix, this.modelMtx));
        offset += fillMatrix4x4(buf, offset, mat4.invert(scratchMat4, scratchMat4));
        offset += fillFogBlock(buf, offset, materialParams.u_FogBlock);
        this.tex.fillTextureMapping(materialParams.m_TextureMapping[0]);
        materialParams.m_TextureMapping[1].lateBinding = 'depth-target';
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        renderInstManager.submitRenderInst(renderInst);
    }

    public set(pos: vec3, floorY: number, scaleXZ: number, floorNrm: vec3, rotY: number, scaleZ: number, tex: BTIData): void {
        const offsetY = scaleXZ * 16.0 * (1.0 - floorNrm[1]) + 1.0;

        // Build the matrix which will transform a [-1, 1] cube into our shadow volume oriented to the floor plane (floor normal becomes Z+).
        // A physically accurate drop shadow would use a vertical box to project the shadow texture straight down, but the original 
        // game chooses to use this approach which always keeps the shape of the shadow consistent, regardless of ground geometry.
        const yVec = vec3.rotateY(scratchVec3a, [1, 0, 0], [0, 0, 0], cM_s2rad(rotY));
        mat4.targetTo(this.modelMtx, [pos[0], floorY, pos[2]], vec3.add(vec3.create(), pos, floorNrm), yVec);
        mat4.scale(this.modelMtx, this.modelMtx, [scaleXZ, scaleXZ * scaleZ, offsetY + offsetY + 16.0]);

        let opacity = 1.0 - saturate((pos[1] - floorY) * 0.0007);
        this.alpha = opacity * 64.0;
        this.tex = tex;
    }
}

class dDlst_shadowControl_c_Cache {
    public program: GfxProgram;
    public inputLayout: GfxInputLayout;
    public positionBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public pointSampler: GfxSampler;
    public linearSampler: GfxSampler;

    public defaultSimpleTex: BTIData;
    public whiteTex: BTIData;

    public shadowmapDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    public shadowmapDepthDesc = new GfxrRenderTargetDescription(GfxFormat.D32F);
    public shadowmapDownDesc = new GfxrRenderTargetDescription(GfxFormat.U8_R_NORM);
    public downsampleProgram: GfxProgram;

    constructor(resCtrl: dRes_control_c, cache: GfxRenderCache) {
        const glsl = preprocessProgramObj_GLSL(cache.device, new ShadowVolumeProgram());
        this.program = cache.createProgramSimple(glsl);
        this.inputLayout = cache.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 }, // position
            ],
            vertexBufferDescriptors: [
                { byteStride: 4 * 3, frequency: GfxVertexBufferFrequency.PerVertex },
            ],
        });
        this.positionBuffer = createBufferFromData(
            cache.device,
            GfxBufferUsage.Vertex,
            GfxBufferFrequencyHint.Static,
            new Float32Array([
                [-1, -1, -1],
                [1, -1, -1],
                [1, 1, -1],
                [-1, 1, -1],
                [-1, -1, 1],
                [1, -1, 1],
                [1, 1, 1],
                [-1, 1, 1],
            ].flat()).buffer,
        );

        this.indexBuffer = createBufferFromData(
            cache.device,
            GfxBufferUsage.Index,
            GfxBufferFrequencyHint.Static,
            new Uint16Array([
                0, 2, 1,
                0, 3, 2,
                4, 5, 6,
                4, 6, 7,
                0, 1, 5,
                0, 5, 4,
                2, 3, 7,
                2, 7, 6,
                1, 2, 6,
                1, 6, 5,
                3, 0, 4,
                3, 4, 7,
            ]).buffer,
        );

        this.pointSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0, maxLOD: 0,
        });

        this.linearSampler = cache.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0, maxLOD: 0,
        });

        const img = resCtrl.getObjectRes(ResType.Raw, `Always`, 0x71); // ALWAYS_I4_BALL128B
        const bti: BTI_Texture = {
            name: img.name,
            format: GX.TexFormat.I4,
            width: 128,
            height: 128,
            data: img,
            mipCount: 1,
            wrapS: GX.WrapMode.CLAMP,
            wrapT: GX.WrapMode.CLAMP,
            minFilter: GX.TexFilter.LINEAR,
            magFilter: GX.TexFilter.LINEAR,
            minLOD: 0,
            maxLOD: 0,
            lodBias: 0,
            maxAnisotropy: GX.Anisotropy._1,
            paletteFormat: 0,
            paletteData: null,
        };
        this.defaultSimpleTex = new BTIData(cache.device, cache, bti);

        bti.name = "whiteTex";
        bti.width = 1;
        bti.height = 1;
        bti.data = new ArrayBufferSlice(new Uint8Array(32).fill(0xFF).buffer);
        this.whiteTex = new BTIData(cache.device, cache, bti);

        this.shadowmapDesc.setDimensions(256 * shadowAtlasDim[0], 256 * shadowAtlasDim[1], 1);
        this.shadowmapDesc.clearColor = colorNewCopy(OpaqueBlack);
        this.shadowmapDepthDesc.copyDimensions(this.shadowmapDesc);
        this.shadowmapDepthDesc.clearDepth = standardFullClearRenderPassDescriptor.clearDepth;
        this.shadowmapDownDesc.setDimensions(128 * shadowAtlasDim[0], 128 * shadowAtlasDim[1], 1);
        this.shadowmapDownDesc.clearColor = colorNewCopy(OpaqueBlack);

        this.downsampleProgram = cache.createProgram(new DownsampleProgram());

        return this;
    }

    destroy(device: GfxDevice): void {
        this.whiteTex.destroy(device);
        this.defaultSimpleTex.destroy(device);

        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.positionBuffer);

        // Everything else is managed by the cache, and will be destroyed when the cache is destroyed.
    }
}

class dDlst_shadowControl_c {
    private simples = nArray(128, () => new dDlst_shadowSimple_c());
    private simpleCount = 0;

    private reals = nArray(realShadowCount, (i) => new dDlst_shadowReal_c(i));
    private latestId: number = 0;
    private realCasterInstList = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Forwards);
    private realInstList = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Forwards);

    private cache: dDlst_shadowControl_c_Cache;

    public get defaultSimpleTex(): BTIData {
        return this.cache.defaultSimpleTex;
    }

    constructor(device: GfxDevice, cache: GfxRenderCache, resCtrl: dRes_control_c) {
        this.cache = new dDlst_shadowControl_c_Cache(resCtrl, cache);
    }

    destroy(device: GfxDevice): void {
        this.cache.destroy(device);
    }

    public reset(): void {
        this.simpleCount = 0;
        for (let i = 0; i < this.reals.length; i++) {
            this.reals[i].reset();
        }
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        // First, render our real shadow casters into the shadowmap
        renderInstManager.setCurrentList(this.realCasterInstList);
        for (let i = 0; i < this.reals.length; i++) {
            this.reals[i].imageDraw(globals, renderInstManager, viewerInput);
        }

        // Then, render shadow volumes for simple and real shadows. These are [-1, 1] cubes tranformed into oriented 
        // boxes bounding the shadow receivers. Simple shadows sample a predefined texture, real shadows sample the shadowmap.
        const shadowVolTemplate = renderInstManager.pushTemplate();
        shadowVolTemplate.setBindingLayouts(ShadowVolumeProgram.bindingLayouts);
        shadowVolTemplate.setGfxProgram(this.cache.program);
        shadowVolTemplate.setVertexInput(this.cache.inputLayout, [{ buffer: this.cache.positionBuffer }], { buffer: this.cache.indexBuffer });
        shadowVolTemplate.setDrawCount(36);
        shadowVolTemplate.setMegaStateFlags({
            depthCompare: GfxCompareMode.Always,
            depthWrite: false,
            cullMode: GfxCullMode.Back,
            ...setAttachmentStateSimple({}, {
                channelWriteMask: GfxChannelWriteMask.RGB,
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            })
        });
        dKy_GxFog_set(globals.g_env_light, materialParams.u_FogBlock, globals.camera);

        renderInstManager.setCurrentList(globals.dlst.shadow);
        for (let i = 0; i < this.simpleCount; i++) {
            this.simples[i].draw(globals, renderInstManager, viewerInput);
        }

        renderInstManager.setCurrentList(this.realInstList);
        for (let i = 0; i < this.reals.length; i++) {
            this.reals[i].draw(globals, renderInstManager, viewerInput);
        }

        renderInstManager.popTemplate()
        this.reset();
    }

    public pushPasses(globals: dGlobals, renderInstManager: GfxRenderInstManager, builder: GfxrGraphBuilder, mainDepthTargetID: GfxrRenderTargetID, mainColorTargetID: GfxrRenderTargetID): void {
        const shadowmapColorTargetID = builder.createRenderTargetID(this.cache.shadowmapDesc, 'Shadowmap');
        const shadowmapDepthTargetID = builder.createRenderTargetID(this.cache.shadowmapDepthDesc, 'Shadowmap Depth');
        const shadowmapDownColorTargetID = builder.createRenderTargetID(this.cache.shadowmapDownDesc, 'Shadowmap');

        builder.pushPass((pass) => {
            pass.setDebugName('Shadowmaps');
            // TODO: Don't bind a color target, we don't need it. (Currently using it for debug thumbnails).
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, shadowmapColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, shadowmapDepthTargetID);
            pass.exec((passRenderer) => {
                this.realCasterInstList.drawOnPassRenderer(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        // Downsample the 256x256 shadowmaps into 128x128 textures (Softens the edges, gives more samples per tap).
        builder.pushPass((pass) => {
            pass.setDebugName(`Shadowmap Downsample`);
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, shadowmapDownColorTargetID);

            const srcResolveTextureID = builder.resolveRenderTarget(shadowmapColorTargetID);
            pass.attachResolveTexture(srcResolveTextureID);

            pass.exec((passRenderer, scope) => {
                const renderInst = renderInstManager.newRenderInst();
                renderInst.setGfxProgram(this.cache.downsampleProgram);
                renderInst.setBindingLayouts([{ numUniformBuffers: 0, numSamplers: 1 }]);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                materialParams.m_TextureMapping[0].gfxTexture = scope.getResolveTextureForID(srcResolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
                renderInst.setDrawCount(3);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Simple Shadows');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            const mainDepthResolveTextureID = builder.resolveRenderTarget(mainDepthTargetID);
            pass.attachResolveTexture(mainDepthResolveTextureID);
            pass.exec((passRenderer, scope) => {
                globals.camera.applyScissor(passRenderer);
                const depthTex = scope.getResolveTextureForID(mainDepthResolveTextureID);
                globals.dlst.shadow.resolveLateSamplerBinding('depth-target', { gfxTexture: depthTex, gfxSampler: this.cache.pointSampler, lateBinding: null });
                globals.dlst.shadow.drawOnPassRenderer(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Real Shadows');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            const mainDepthResolveTextureID = builder.resolveRenderTarget(mainDepthTargetID);
            const shadowmapResolveTextureID = builder.resolveRenderTarget(shadowmapDownColorTargetID);
            pass.attachResolveTexture(shadowmapResolveTextureID);
            pass.attachResolveTexture(mainDepthResolveTextureID);
            pass.exec((passRenderer, scope) => {
                globals.camera.applyScissor(passRenderer);
                const shadowmap = scope.getResolveTextureForID(shadowmapResolveTextureID);
                const depthTex = scope.getResolveTextureForID(mainDepthResolveTextureID);
                this.realInstList.resolveLateSamplerBinding('depth-target', { gfxTexture: depthTex, gfxSampler: this.cache.pointSampler, lateBinding: null });
                this.realInstList.resolveLateSamplerBinding('shadowmap-target', { gfxTexture: shadowmap, gfxSampler: this.cache.linearSampler, lateBinding: null });
                this.realInstList.drawOnPassRenderer(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        builder.pushDebugThumbnail(shadowmapColorTargetID);
        builder.pushDebugThumbnail(shadowmapDownColorTargetID);
    }

    public setReal(id: number, shouldFade: number, model: J3DModelInstance, pos: vec3, casterSize: number, heightAgl: number, tevStr: dKy_tevstr_c): number {
        let real = this.getOrAllocate(id);
        return real ? real.set(shouldFade, model, pos, casterSize, heightAgl, tevStr) : 0;
    }

    public setReal2(globals: dGlobals, id: number, shouldFade: number, model: J3DModelInstance, casterCenter: vec3, casterSize: number, heightAgl: number, tevStr: dKy_tevstr_c): number {
        let real = this.getOrAllocate(id);
        return real ? real.set2(globals, shouldFade, model, casterCenter, casterSize, heightAgl, tevStr) : 0;
    }

    public addReal(id: number, model: J3DModelInstance): boolean {
        let real = this.reals.find(r => r.id === id);
        if (real)
            return real.add(model);

        return false;
    }

    public setSimple(globals: dGlobals, pos: vec3, groundY: number, scaleXZ: number, floorNrm: vec3, angle: number, scaleZ: number, tex: BTIData | null): boolean {
        if (floorNrm === null || this.simpleCount >= this.simples.length)
            return false;

        const simple = this.simples[this.simpleCount++];
        simple.set(pos, groundY, scaleXZ, floorNrm, angle, scaleZ, tex ? tex : this.cache.whiteTex);
        return true;
    }

    private getOrAllocate(id: number): dDlst_shadowReal_c | null {
        let real = id ? this.reals.find(r => r.id === id) : undefined;
        if (!real) {
            const freeIdx = this.reals.findIndex(r => r.state === 0);
            if (freeIdx >= 0) {
                real = this.reals[freeIdx];
                real.id = ++this.latestId;
            }
            else return null;
        }
        return real;
    }
}

export function dComIfGd_setSimpleShadow2(globals: dGlobals, pos: vec3, groundY: number, scaleXZ: number, floorPoly: cBgS_PolyInfo,
    rotY: number = 0, scaleZ: number = 1.0, tex: BTIData | null = globals.dlst.shadowControl.defaultSimpleTex): boolean {
    if (floorPoly.ChkSetInfo() && groundY !== -Infinity) {
        const plane_p = globals.scnPlay.bgS.GetTriPla(floorPoly.bgIdx, floorPoly.triIdx);
        return globals.dlst.shadowControl.setSimple(globals, pos, groundY, scaleXZ, plane_p.n, rotY, scaleZ, tex);
    } else {
        return false;
    }
}

export function dComIfGd_setShadow(globals: dGlobals, id: number, shouldFade: boolean, model: J3DModelInstance, casterCenter: vec3, casterSize: number, scaleXZ: number,
    casterY: number, groundY: number, pFloorPoly: cBgS_PolyInfo, pTevStr: dKy_tevstr_c, rotY = 0.0, scaleZ = 1.0, pTexObj: BTIData | null = globals.dlst.shadowControl.defaultSimpleTex
): number {
    assert(vec3.sqrLen(pTevStr.lightObj.Position) > 0, "Invalid light position in tevStr. Make sure to call settingTevStruct() before calling setShadow()");
    if (groundY <= -Infinity) {
        return 0;
    }

    const sid = globals.dlst.shadowControl.setReal2(globals, id, shouldFade ? 1 : 0, model, casterCenter, casterSize, casterY - groundY, pTevStr);
    if (sid === 0) {
        const simplePos: vec3 = [casterCenter[0], casterY, casterCenter[2]];
        dComIfGd_setSimpleShadow2(globals, simplePos, groundY, scaleXZ, pFloorPoly, rotY, scaleZ, pTexObj);
    }
    return sid;
}

export function dComIfGd_addRealShadow(globals: dGlobals, id: number, model: J3DModelInstance): boolean {
    return globals.dlst.shadowControl.addReal(id, model);
}