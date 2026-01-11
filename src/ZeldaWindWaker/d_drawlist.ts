
import { ReadonlyVec3, mat4, vec3, vec4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { OpaqueBlack, White, colorCopy, colorNewCopy } from "../Color.js";
import { J3DModelInstance, prepareShapeMtxGroup } from "../Common/JSYSTEM/J3D/J3DGraphBase.js";
import { BTIData, BTI_Texture } from "../Common/JSYSTEM/JUTTexture.js";
import { AABB } from "../Geometry.js";
import { Vec3UnitX, Vec3UnitY, Vec3Zero, getMatrixAxisZ, projectionMatrixForCuboid, saturate } from '../MathHelpers.js';
import { DeviceProgram } from "../Program.js";
import { TSDraw } from "../SuperMarioGalaxy/DDraw.js";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers.js";
import { fullscreenMegaState, setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { projectionMatrixConvertClipSpaceNearZ } from '../gfx/helpers/ProjectionHelpers.js';
import { standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers.js";
import { IsDepthReversed, reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers.js";
import { fillMatrix4x3, fillMatrix4x4, fillVec4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxChannelWriteMask, GfxClipSpaceNearZ, GfxCompareMode, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxSamplerFormatKind, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription, GfxrRenderTargetID } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderInst, GfxRenderInstExecutionOrder, GfxRenderInstList, GfxRenderInstManager, gfxRenderInstCompareNone, gfxRenderInstCompareSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder.js';
import { DisplayListRegisters, GX_Array, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData, LoadedVertexLayout, compileVtxLoader, displayListRegistersInitGX, displayListRegistersRun } from "../gx/gx_displaylist.js";
import * as GX from '../gx/gx_enum.js';
import { GX_Program } from '../gx/gx_material.js';
import { ColorKind, DrawParams, GXMaterialHelperGfx, MaterialParams, SceneParams, createInputLayout, fillFogBlock, fillSceneParamsData, ub_SceneParamsBufferSize } from "../gx/gx_render.js";
import { assert, assertExists, nArray } from '../util.js';
import { ViewerRenderInput } from '../viewer.js';
import { SymbolMap, dGlobals } from './Main.js';
import { cM_s2rad } from "./SComponent.js";
import { cBgS_PolyInfo } from "./d_bg.js";
import { PeekZManager } from "./d_dlst_peekZ.js";
import { dKy_GxFog_set, dKy_tevstr_c } from "./d_kankyo.js";
import { ResType, dRes_control_c } from "./d_resorce.js";

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

//#region Shadows
const visualizeShadowVolumes = false;

const scratchMat4a = mat4.create();
const scratchMat4b = mat4.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchAABB = new AABB();

class DownsampleProgram extends DeviceProgram {
    public override vert = GfxShaderLibrary.fullscreenVS;
    public override frag = `
uniform sampler2D u_TextureFramebufferDepth;
in vec2 v_TexCoord;

float FakeGather0(ivec2 offs) {
    ivec2 coord = ivec2(v_TexCoord.xy * vec2(textureSize(TEXTURE(u_TextureFramebufferDepth), 0))) + offs;
    return texelFetch(TEXTURE(u_TextureFramebufferDepth), coord, 0).r != 0.0 ? 1.0 : 0.0;
}

vec4 FakeGather() {
    return vec4(
        FakeGather0(ivec2(0, 0)),
        FakeGather0(ivec2(1, 0)),
        FakeGather0(ivec2(0, 1)),
        FakeGather0(ivec2(1, 1))
    );
}

void main() {
    vec4 dt = FakeGather();
    gl_FragColor = vec4(dot(dt, vec4(0.25)));
}
`;
}

class ShadowVolumeProgram extends DeviceProgram {
    public static bindingLayouts: GfxBindingLayoutDescriptor[] = [{
        numUniformBuffers: 1, numSamplers: 3, samplerEntries: [
            { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
            { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.UnfilterableFloat, },
            { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
        ]
    }];

    constructor(shadowMap: boolean) {
        super();

        this.name = `ShadowVolumeProgram ${shadowMap ? `(Shadow Map)` : `(Static Tex)`}`;
        this.setDefineBool('SHADOWMAP', shadowMap);

        this.both = `
precision highp sampler2DArray;
precision highp float;

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
    vec4 u_Params[1];
    vec4 u_TexScaleBias;
    Mat4x4 u_ClipFromLocal;
    Mat4x4 u_LocalFromClip;
    FogBlock u_FogBlock;
};

#define u_ViewportSize (u_Params[0].xy)
#define u_ShadowLayer (u_Params[0].z)

layout(location = 0) uniform sampler2D u_TextureShadow;
layout(location = 1) uniform sampler2D u_TextureFramebufferDepth; // Depth buffer
layout(location = 2) uniform sampler2DArray u_TextureShadowMap;

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
    t_ClipPos.z = texelFetch(TEXTURE(u_TextureFramebufferDepth), ivec2(gl_FragCoord.xy), 0).r;
#if !GFX_CLIPSPACE_NEAR_ZERO()
    t_ClipPos.z = t_ClipPos.z * 2.0 - 1.0;
#endif
    vec4 t_ObjectPos = UnpackMatrix(u_LocalFromClip) * vec4(t_ClipPos, 1.0);
    t_ObjectPos.xyz /= t_ObjectPos.w;

    bool t_VisualizeShadowVolumes = ${visualizeShadowVolumes};
    if (!t_VisualizeShadowVolumes) {
        // Now that we have our object-space position, remove any samples outside of the box.
        if (any(lessThan(t_ObjectPos.xyz, vec3(-1))) || any(greaterThan(t_ObjectPos.xyz, vec3(1))))
            discard;

        // Don't apply shadows to surfaces facing away from the light (same math as the game)
        vec3 normal = normalize(cross(dFdx(t_ObjectPos.xyz), dFdy(t_ObjectPos.xyz)));
        if (dot(normal, vec3(0, 0, 1)) < 0.2)
            discard;
    }

    float t_ShadowStep = 0.0;
    float t_SmoothFactor = 0.0;

    // Top-down project our shadow texture. Our local space is between -1 and 1, we want to move into 0.0 to 1.0.
    vec2 t_ShadowTexCoord = (t_ObjectPos.xy * u_TexScaleBias.xy + u_TexScaleBias.zw) * 0.5 + 0.5;
#if GFX_VIEWPORT_ORIGIN_TL()
    t_ShadowTexCoord.y = 1.0 - t_ShadowTexCoord.y;
#endif

#if defined SHADOWMAP
    t_ShadowStep = 0.5;
    float t_ShadowColor = texture(SAMPLER_2DArray(u_TextureShadowMap), vec3(t_ShadowTexCoord.xy, u_ShadowLayer)).r;
#else
    // If sampling from a predefined texture, smooth the shadow edges
    t_SmoothFactor = 0.1;
    float t_ShadowColor = texture(SAMPLER_2D(u_TextureShadow), t_ShadowTexCoord.xy).r;
#endif

    float t_Alpha = smoothstep(t_ShadowStep, t_ShadowStep + t_SmoothFactor, t_ShadowColor);
    if (t_VisualizeShadowVolumes)
        t_Alpha += 1.0;

    vec4 t_PixelOut = vec4(0, 0, 0, 0.25 * t_Alpha);

    ${this.generateFog()}

    gl_FragColor = t_PixelOut;
}
#endif
`;
    }
    
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
}

/**
 * Draw a J3DModelInstance without setting any materials. Culling is skipped.
 * materialParams and sceneParams must be set up prior to calling this function.
 */
function drawSimpleModelInstance(renderInstManager: GfxRenderInstManager, dstList: GfxRenderInstList, model: J3DModelInstance, viewFromWorldMatrix: mat4): void {
    // Update joint matrices into shapeInstanceState.drawViewMatrixArray
    model.calcView(viewFromWorldMatrix, null);

    const shapeData = model.modelData.shapeData;
    for (let s = 0; s < shapeData.length; s++) {
        if (!model.shapeInstances[s].visible)
            continue;
        const shape = shapeData[s];
        for (let i = 0; i < shape.shape.mtxGroups.length; i++) {
            const renderInst = renderInstManager.newRenderInst();
            shape.setOnRenderInst(renderInst, shape.draws[i]);

            // Copy the correct subset of drawViewMatrixArray into DrawParams
            prepareShapeMtxGroup(drawParams, model.shapeInstanceState, shape.shape, shape.shape.mtxGroups[i]);
            let offs = renderInst.allocateUniformBuffer(GX_Program.ub_DrawParams, 4 * 3 * 10);
            const d = renderInst.mapUniformBufferF32(GX_Program.ub_DrawParams);
            for (let i = 0; i < 10; i++)
                offs += fillMatrix4x3(d, offs, drawParams.u_PosMtx[i]);

            dstList.submitRenderInst(renderInst);
        }
    }
}

//#region Real Shadows

class dDlst_shadowReal_c {
    public id: number = 0;

    private models: J3DModelInstance[] = [];
    private alpha: number = 0; // 0-255
    private lightViewMtx = mat4.create();
    private lightProjMtx = mat4.create();
    private worldFromVolume = mat4.create();
    private volumeFromWorld = mat4.create();
    private shadowmapScaleBias = vec4.create();
    private heightAboveGround: number = 0;
    private casterSize: number = 0;

    public casterInstList = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Forwards);

    constructor(private index: number) {
    }

    public reset(): void {
        // Free this shadow if it was not set this frame
        if (this.id !== 0 && this.models.length == 0) {
            this.id = 0;
        }

        this.models.length = 0;
    }

    public imageDraw(globals: dGlobals, renderInstManager: GfxRenderInstManager): void {
        if (this.models.length === 0)
            return;

        const template = renderInstManager.pushTemplate();
        mat4.copy(sceneParams.u_Projection, this.lightProjMtx);
        const d = template.allocateUniformBufferF32(GX_Program.ub_SceneParams, ub_SceneParamsBufferSize);
        fillSceneParamsData(d, 0, sceneParams);

        for (let m = 0; m < this.models.length; m++)
            drawSimpleModelInstance(renderInstManager, this.casterInstList, this.models[m], this.lightViewMtx);

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
    // TODO: Fix simple shadow volume now that it is a unit cube
    // TODO: Fix ID thrashing when setShadowRealMtx returns 0.0
    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, dstList: GfxRenderInstList, viewerInput: ViewerRenderInput): void {
        if (this.models.length === 0)
            return;

        // Draw the receiver volume.
        const clipFromVolume = mat4.mul(scratchMat4a, globals.camera.clipFromWorldMatrix, this.worldFromVolume)

        const renderInst = renderInstManager.newRenderInst();
        let offset = renderInst.allocateUniformBuffer(0, 8 + 16 * 2 + 20);
        const buf = renderInst.mapUniformBufferF32(0);
        offset += fillVec4(buf, offset, viewerInput.backbufferWidth, viewerInput.backbufferHeight, this.index);
        offset += fillVec4v(buf, offset, this.shadowmapScaleBias);
        offset += fillMatrix4x4(buf, offset, clipFromVolume);
        offset += fillMatrix4x4(buf, offset, mat4.invert(scratchMat4a, clipFromVolume));
        offset += fillFogBlock(buf, offset, materialParams.u_FogBlock);
        materialParams.m_TextureMapping[0].reset();
        materialParams.m_TextureMapping[1].lateBinding = 'depth-target';
        materialParams.m_TextureMapping[2].lateBinding = 'shadowmap-target';
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        dstList.submitRenderInst(renderInst);
    }

    public set2(globals: dGlobals, shouldFade: number, model: J3DModelInstance, casterCenter: ReadonlyVec3, casterSize: number, heightAboveGround: number, tevStr: dKy_tevstr_c): number {
        if (this.models.length === 0) {
            assertExists(tevStr); // The game allows passing a null tevStr (uses player's light pos), we do not.
            const lightPos = tevStr.lightObj.Position;
            this.alpha = this.setShadowRealMtx(globals, this.lightViewMtx, this.lightProjMtx, lightPos, casterCenter, casterSize, heightAboveGround,
                shouldFade == 0 ? 0.0 : heightAboveGround * 0.0007);

            if (this.alpha === 0)
                return 0;

            this.casterSize = casterSize;
            this.heightAboveGround = heightAboveGround;
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

    private setShadowRealMtx(globals: dGlobals, lightViewMtx: mat4, lightProjMtx: mat4, lightPos: ReadonlyVec3, casterCenter: ReadonlyVec3,
        casterSize: number, heightAboveGround: number, heightFade: number): number {
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
        lightVec[1] += heightAboveGround;
        let xzScale = Math.max(0.0, 0.02 * (50.0 - heightAboveGround));
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
        // These are then renderered to sample the shadow map. Instead, we generate an oriented box (the shadow volume),
        // fit it to the light-space bounding box of the shadow casters, manipulate the z-axis caps to encapsulate the terrain,
        // and render that box as the shadow receiver. See generateShadowVolume(). We must wait until draw time to do this,
        // because dComIfGd_addRealShadow() may be called after this to add additional caster models.
        // if (!realPolygonCheck(casterCenter, casterRadius, heightAboveGround, rayDir, shadowPoly)) {
        //     return 0;
        // }

        // Generate a conservative shadow volume (from realPolygonCheck), and cull if not visible.
        const receiverAABB = scratchAABB;
        const tmp1 = casterRadius * casterRadius * 0.002;
        const tmp2 = Math.min(tmp1, 120.0);
        let groundDist = casterRadius + heightAboveGround - tmp2;
        const xOffset = rayDir[0] * groundDist;
        const zOffset = rayDir[2] * groundDist;
        receiverAABB.min[1] = casterCenter[1] - groundDist;
        receiverAABB.max[1] = casterCenter[1] + casterRadius * 0.4;
        receiverAABB.min[0] = Math.min(casterCenter[0] + xOffset, casterCenter[0]) - casterRadius;
        receiverAABB.max[0] = Math.max(casterCenter[0] + xOffset, casterCenter[0]) + casterRadius;
        receiverAABB.min[2] = Math.min(casterCenter[2] + zOffset, casterCenter[2]) - casterRadius;
        receiverAABB.max[2] = Math.max(casterCenter[2] + zOffset, casterCenter[2]) + casterRadius;
        if (!globals.camera.frustum.contains(receiverAABB)) {
            return 0.0;
        }

        // Build the light view/proj matrices
        mat4.lookAt(lightViewMtx, lightVec, casterCenter, Math.abs(rayDir[1]) == 1.0 ? Vec3UnitX : Vec3UnitY);
        projectionMatrixForCuboid(lightProjMtx, -casterRadius, casterRadius, -casterRadius, casterRadius, 1.0, 10000.0);
        projectionMatrixConvertClipSpaceNearZ(lightProjMtx, globals.camera.clipSpaceNearZ, GfxClipSpaceNearZ.NegativeOne);

        return alpha;
    }

    public generateShadowVolume(globals: dGlobals): void {
        if (this.models.length === 0)
            return;

        const worldFromLight = mat4.invert(scratchMat4a, this.lightViewMtx);
        const lightDir = scratchVec3a;
        getMatrixAxisZ(lightDir, worldFromLight);
        const lightAngle = Math.atan2(lightDir[1], Math.sqrt(lightDir[0] * lightDir[0] + lightDir[2] * lightDir[2]));
        const groundYBias = (this.casterSize * 0.06 + this.heightAboveGround) / Math.sin(lightAngle)

        // NOTE(mikelester): Almost all NPCs use a standard casterSize of 800, which is way to large for their actual geometry.
        //     As an optimization, we'd like find the smallest volume that fits the models' bounding boxes in light space.
        //     However, some actors (most bosses) have bounding boxes that do not actually bound their geometry, resulting in shadow clipping.
        //     So, as a hacky compromise, we only do the tight fitting when the casterSize is 800.
        const useBbox = this.casterSize == 800;

        // Build an AABB containing all models in the light's view space
        const lightAABB = new AABB();
        if (useBbox) {
            for (let m = 0; m < this.models.length; m++) {
                const modelToLightMatrix = mat4.mul(scratchMat4b, this.lightViewMtx, this.models[m].modelMatrix);
                scratchAABB.transform(this.models[m].modelData.bbox, modelToLightMatrix);
                lightAABB.union(lightAABB, scratchAABB);
            }

            // Determine the near/far caps on the shadow volume based on light angle, ground slope, and height above ground.
            // TODO: Consider ground slope.
            lightAABB.max[2] = (lightAABB.max[2] + lightAABB.min[2]) * 0.5;
            lightAABB.min[2] = lightAABB.min[2] - groundYBias;
        } else {
            // If the models bounding boxes don't actually bound the geometry, use a conservative volume based on the shadowmap frustum
            const casterRadius = this.casterSize * 0.4;
            lightAABB.set(-casterRadius, -casterRadius, -2.0 * casterRadius - groundYBias, casterRadius, casterRadius, -casterRadius);
        }

        // Generate the shadow volume geometry as an oriented box based on the light-space AABB:
        // Transform a [-1, 1] cube into the light-space bounding volume computed above, then to world space.
        const scale = vec3.scale(scratchVec3a, vec3.sub(scratchVec3a, lightAABB.max, lightAABB.min), 0.5);
        const lightFromVolume = mat4.fromTranslation(mat4.create(), vec3.add(scratchVec3b, lightAABB.min, scale));
        mat4.scale(lightFromVolume, lightFromVolume, scale);
        mat4.mul(this.worldFromVolume, worldFromLight, lightFromVolume);
        mat4.invert(this.volumeFromWorld, this.worldFromVolume);

        // The shadow volume is contained within the shadowmap's ortho frustum. Create a mapping from volume space [-1, 1] to
        // shadowmap space [-1, 1] so we can sample the texture at the correct coordinates.
        const mapMax = vec3.transformMat4(scratchVec3a, lightAABB.max, this.lightProjMtx);
        const mapMin = vec3.transformMat4(scratchVec3b, lightAABB.min, this.lightProjMtx);
        const diff = vec3.sub(scratchVec3a, mapMax, mapMin);
        vec4.set(this.shadowmapScaleBias, diff[0] * 0.5, diff[1] * 0.5, (mapMin[0] + diff[0] * 0.5), (mapMin[1] + diff[1] * 0.5));
    }
}

//#region Simple Shadows

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
    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, dstList: GfxRenderInstList, viewerInput: ViewerRenderInput): void {
        const renderInst = renderInstManager.newRenderInst();
        let offset = renderInst.allocateUniformBuffer(0, 8 + 16 * 2 + 20);
        const buf = renderInst.mapUniformBufferF32(0);
        offset += fillVec4(buf, offset, viewerInput.backbufferWidth, viewerInput.backbufferHeight, 0.0, 0.1);
        offset += fillVec4(buf, offset, 1.0, 1.0, 0.0, 0.0);
        offset += fillMatrix4x4(buf, offset, mat4.mul(scratchMat4a, globals.camera.clipFromWorldMatrix, this.modelMtx));
        offset += fillMatrix4x4(buf, offset, mat4.invert(scratchMat4a, scratchMat4a));
        offset += fillFogBlock(buf, offset, materialParams.u_FogBlock);
        this.tex.fillTextureMapping(materialParams.m_TextureMapping[0]);
        materialParams.m_TextureMapping[1].lateBinding = 'depth-target';
        materialParams.m_TextureMapping[2].reset();
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        renderInstManager.submitRenderInst(renderInst);
    }

    public set(pos: ReadonlyVec3, floorY: number, scaleXZ: number, floorNrm: ReadonlyVec3, rotY: number, scaleZ: number, tex: BTIData): void {
        const offsetY = scaleXZ * 16.0 * (1.0 - floorNrm[1]) + 1.0;

        // Avoid the rare case of the target position being exactly equal to the eye position
        const normScale = (floorNrm[1] == 1 && (floorY - pos[1]) == 1) ? 2.0 : 1.0;

        // Build the matrix which will transform a [-1, 1] cube into our shadow volume oriented to the floor plane (floor normal becomes Z-).
        // A physically accurate drop shadow would use a vertical box to project the shadow texture straight down, but the original
        // game chooses to use this approach which always keeps the shape of the shadow consistent, regardless of ground geometry.
        const yVec = vec3.rotateY(scratchVec3a, Vec3UnitX, Vec3Zero, cM_s2rad(rotY));
        mat4.targetTo(this.modelMtx, [pos[0], floorY, pos[2]], vec3.scaleAndAdd(vec3.create(), pos, floorNrm, -normScale), yVec);
        mat4.scale(this.modelMtx, this.modelMtx, [scaleXZ, scaleXZ * scaleZ, 2 * offsetY + 16.0]);

        let opacity = 1.0 - saturate((pos[1] - floorY) * 0.0007);
        this.alpha = opacity * 64.0;
        this.tex = tex;
    }
}

//#region Shadow Control

class dDlst_shadowControl_c_Cache {
    public volumeProgram_StaticTex: GfxProgram;
    public volumeProgram_ShadowMap: GfxProgram;
    public inputLayout: GfxInputLayout;
    public positionBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public pointSampler: GfxSampler;
    public linearSampler: GfxSampler;

    public defaultSimpleTex: BTIData;
    public whiteTex: BTIData;

    public shadowmapMat: GXMaterialHelperGfx;
    public shadowmapDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    public shadowmapDepthDesc = new GfxrRenderTargetDescription(GfxFormat.D32F);
    public downsampleProgram: GfxProgram;

    constructor(resCtrl: dRes_control_c, cache: GfxRenderCache) {
        this.volumeProgram_StaticTex = cache.createProgram(new ShadowVolumeProgram(false));
        this.volumeProgram_ShadowMap = cache.createProgram(new ShadowVolumeProgram(true));

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


        const mb = new GXMaterialBuilder();
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.C0);
        mb.setZMode(true, GX.CompareType.LEQUAL, true);
        mb.setCullMode(GX.CullMode.BACK);
        mb.setUsePnMtxIdx(true);
        this.shadowmapMat = new GXMaterialHelperGfx(mb.finish('ShadowVolumeDrawer Front'));

        this.shadowmapDesc.setDimensions(256, 256, 1);
        this.shadowmapDesc.clearColor = colorNewCopy(OpaqueBlack);
        this.shadowmapDepthDesc.copyDimensions(this.shadowmapDesc);
        this.shadowmapDepthDesc.clearDepth = standardFullClearRenderPassDescriptor.clearDepth;

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

    private reals = nArray(8, (i) => new dDlst_shadowReal_c(i));
    private realVolumeInstList = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Forwards);
    private nextId: number = 1;
    private shadowAtlas: GfxTexture;

    private cache: dDlst_shadowControl_c_Cache;

    public get defaultSimpleTex(): BTIData {
        return this.cache.defaultSimpleTex;
    }

    constructor(device: GfxDevice, cache: GfxRenderCache, resCtrl: dRes_control_c) {
        this.cache = new dDlst_shadowControl_c_Cache(resCtrl, cache);
        this.shadowAtlas = device.createTexture({
            dimension: GfxTextureDimension.n2DArray,
            width: 128,
            height: 128,
            depthOrArrayLayers: this.reals.length,
            numLevels: 1,
            pixelFormat: GfxFormat.U8_R_NORM,
            usage: GfxTextureUsage.RenderTarget,
        });
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
        // noclip modification: The game computes shadow receiver geometry in setShadowRealMtx() using a conservative AABB.
        // Instead, we wait until draw time to generate a tight light-space AABB from the animated model.
        for (let i = 0; i < this.reals.length; i++)
            this.reals[i].generateShadowVolume(globals);

        // First, render our real shadow casters into the shadowmap
        const shadowmapTemplate = renderInstManager.pushTemplate();
        this.cache.shadowmapMat.setOnRenderInst(renderInstManager.gfxRenderCache, shadowmapTemplate);
        materialParams.u_Color[ColorKind.C0] = White;
        this.cache.shadowmapMat.allocateMaterialParamsDataOnInst(shadowmapTemplate, materialParams);
        for (let i = 0; i < this.reals.length; i++)
            this.reals[i].imageDraw(globals, renderInstManager);
        renderInstManager.popTemplate();

        // Then, render shadow volumes for simple and real shadows. These are [-1, 1] cubes tranformed into oriented
        // boxes bounding the shadow receivers. Simple shadows sample a predefined texture, real shadows sample the shadowmap.
        const shadowVolTemplate = renderInstManager.pushTemplate();
        shadowVolTemplate.setBindingLayouts(ShadowVolumeProgram.bindingLayouts);
        shadowVolTemplate.setVertexInput(this.cache.inputLayout, [{ buffer: this.cache.positionBuffer }], { buffer: this.cache.indexBuffer });
        shadowVolTemplate.setDrawCount(36);
        shadowVolTemplate.setMegaStateFlags({
            depthCompare: visualizeShadowVolumes ? GfxCompareMode.Always : reverseDepthForCompareMode(GfxCompareMode.GreaterEqual),
            depthWrite: false,
            cullMode: GfxCullMode.Front,
            ...setAttachmentStateSimple({}, {
                channelWriteMask: GfxChannelWriteMask.RGB,
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            })
        });
        dKy_GxFog_set(globals.g_env_light, materialParams.u_FogBlock, globals.camera);

        // Draw receiver volumes.
        shadowVolTemplate.setGfxProgram(this.cache.volumeProgram_StaticTex);
        for (let i = 0; i < this.simpleCount; i++)
            this.simples[i].draw(globals, renderInstManager, globals.dlst.shadow, viewerInput);

        shadowVolTemplate.setGfxProgram(this.cache.volumeProgram_ShadowMap);
        for (let i = 0; i < this.reals.length; i++)
            this.reals[i].draw(globals, renderInstManager, this.realVolumeInstList, viewerInput);

        renderInstManager.popTemplate();
        this.reset();
    }

    public pushPasses(globals: dGlobals, renderInstManager: GfxRenderInstManager, builder: GfxrGraphBuilder, mainDepthTargetID: GfxrRenderTargetID, mainColorTargetID: GfxrRenderTargetID): void {
        let hasReal = false;
        for (let i = 0; i < this.reals.length; i++) {
            const shadowmapDepthTargetID = builder.createRenderTargetID(this.cache.shadowmapDepthDesc, 'Shadow Map Depth');

            const wantsThumbnails = globals.renderer.renderHelper.debugThumbnails.enabled;
            const shadowmapColorTargetID = wantsThumbnails ? builder.createRenderTargetID(this.cache.shadowmapDesc, 'Shadow Map Color') : null;

            const real = this.reals[i];
            if (real.casterInstList.renderInsts.length === 0)
                continue;

            builder.pushPass((pass) => {
                pass.setDebugName(`Shadow Map ${i}`);
                if (shadowmapColorTargetID !== null)
                    pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, shadowmapColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, shadowmapDepthTargetID);
                pass.exec((passRenderer) => {
                    real.casterInstList.drawOnPassRenderer(renderInstManager.gfxRenderCache, passRenderer);
                    real.casterInstList.reset();
                });
            });

            if (shadowmapColorTargetID !== null)
                builder.pushDebugThumbnail(shadowmapColorTargetID);

            builder.pushPass((pass) => {
                pass.setDebugName(`Shadow Map ${i} Downsample`);
                pass.attachTexture(GfxrAttachmentSlot.Color0, this.shadowAtlas, { level: 0, z: i });

                const srcResolveTextureID = builder.resolveRenderTarget(shadowmapDepthTargetID);
                pass.attachResolveTexture(srcResolveTextureID);

                pass.exec((passRenderer, scope) => {
                    const renderInst = renderInstManager.newRenderInst();
                    renderInst.setGfxProgram(this.cache.downsampleProgram);
                    renderInst.setBindingLayouts([{ numUniformBuffers: 0, numSamplers: 1, samplerEntries: [
                        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.UnfilterableFloat },
                    ] }]);
                    renderInst.setMegaStateFlags(fullscreenMegaState);
                    materialParams.m_TextureMapping[0].gfxTexture = scope.getResolveTextureForID(srcResolveTextureID);
                    materialParams.m_TextureMapping[0].gfxSampler = this.cache.pointSampler;
                    renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
                    renderInst.setDrawCount(3);
                    renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
                });
            });

            hasReal = true;
        }
    
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

        if (hasReal) {
            builder.pushPass((pass) => {
                pass.setDebugName('Real Shadow Volumes');
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
                const mainDepthResolveTextureID = builder.resolveRenderTarget(mainDepthTargetID);
                pass.attachResolveTexture(mainDepthResolveTextureID);
                pass.exec((passRenderer, scope) => {
                    globals.camera.applyScissor(passRenderer);
                    const depthTex = scope.getResolveTextureForID(mainDepthResolveTextureID);
                    this.realVolumeInstList.resolveLateSamplerBinding('depth-target', { gfxTexture: depthTex, gfxSampler: this.cache.pointSampler, lateBinding: null });
                    this.realVolumeInstList.resolveLateSamplerBinding('shadowmap-target', { gfxTexture: this.shadowAtlas, gfxSampler: this.cache.linearSampler, lateBinding: null });
                    this.realVolumeInstList.drawOnPassRenderer(renderInstManager.gfxRenderCache, passRenderer);
                });
            });
        }
    }

    public setReal2(globals: dGlobals, id: number, shouldFade: number, model: J3DModelInstance, casterCenter: ReadonlyVec3, casterSize: number, heightAboveGround: number, tevStr: dKy_tevstr_c): number {
        let real = this.getOrAllocate(id);
        const curId = real ? real.set2(globals, shouldFade, model, casterCenter, casterSize, heightAboveGround, tevStr) : 0;
        if (curId === this.nextId)
            this.nextId++;
        return curId;
    }

    public addReal(id: number, model: J3DModelInstance): boolean {
        let real = this.reals.find(r => r.id === id);
        if (real)
            return real.add(model);

        return false;
    }

    public setSimple(globals: dGlobals, pos: ReadonlyVec3, groundY: number, scaleXZ: number, floorNrm: ReadonlyVec3, angle: number, scaleZ: number, tex: BTIData | null): boolean {
        if (floorNrm === null || this.simpleCount >= this.simples.length)
            return false;

        const simple = this.simples[this.simpleCount++];
        simple.set(pos, groundY, scaleXZ, floorNrm, angle, scaleZ, tex ? tex : this.cache.whiteTex);
        return true;
    }

    private getOrAllocate(id: number): dDlst_shadowReal_c | null {
        let real = id ? this.reals.find(r => r.id === id) : undefined;
        if (!real) {
            const freeIdx = this.reals.findIndex(r => r.id === 0);
            if (freeIdx >= 0) {
                real = this.reals[freeIdx];
                real.id = this.nextId;
            }
            else return null;
        }
        return real;
    }
}

export function dComIfGd_setSimpleShadow2(globals: dGlobals, pos: ReadonlyVec3, groundY: number, scaleXZ: number, floorPoly: cBgS_PolyInfo,
    rotY: number = 0, scaleZ: number = 1.0, tex: BTIData | null = globals.dlst.shadowControl.defaultSimpleTex): boolean {
    if (floorPoly.ChkSetInfo() && groundY !== -Infinity) {
        const plane_p = globals.scnPlay.bgS.GetTriPla(floorPoly.bgIdx, floorPoly.triIdx);
        return globals.dlst.shadowControl.setSimple(globals, pos, groundY, scaleXZ, plane_p.n, rotY, scaleZ, tex);
    } else {
        return false;
    }
}

export function dComIfGd_setShadow(globals: dGlobals, id: number, shouldFade: boolean, model: J3DModelInstance, casterCenter: ReadonlyVec3, casterSize: number, scaleXZ: number,
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
