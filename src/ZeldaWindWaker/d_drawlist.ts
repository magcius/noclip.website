
import { mat4, vec3 } from "gl-matrix";
import { White, colorCopy, colorFromRGBA, colorNewCopy } from "../Color.js";
import { projectionMatrixForCuboid, saturate } from '../MathHelpers.js';
import { TSDraw } from "../SuperMarioGalaxy/DDraw.js";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers.js";
import { projectionMatrixConvertClipSpaceNearZ } from '../gfx/helpers/ProjectionHelpers.js';
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxChannelWriteMask, GfxClipSpaceNearZ, GfxDevice, GfxFormat, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxRenderPass, GfxSampler, GfxSamplerFormatKind, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxRenderInst, GfxRenderInstExecutionOrder, GfxRenderInstList, GfxRenderInstManager, gfxRenderInstCompareNone, gfxRenderInstCompareSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder.js';
import { DisplayListRegisters, GX_Array, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData, LoadedVertexLayout, compileVtxLoader, displayListRegistersInitGX, displayListRegistersRun } from "../gx/gx_displaylist.js";
import * as GX from '../gx/gx_enum.js';
import { GX_Program } from '../gx/gx_material.js';
import { ColorKind, DrawParams, GXMaterialHelperGfx, MaterialParams, SceneParams, createInputLayout, fillSceneParamsData, ub_SceneParamsBufferSize } from "../gx/gx_render.js";
import { assert, assertExists, nArray } from '../util.js';
import { ViewerRenderInput } from '../viewer.js';
import { SymbolMap, dGlobals } from './Main.js';
import { PeekZManager } from "./d_dlst_peekZ.js";
import { cBgS_PolyInfo } from "./d_bg.js";
import { BTI_Texture, BTIData } from "../Common/JSYSTEM/JUTTexture.js";
import { J3DModelInstance } from "../Common/JSYSTEM/J3D/J3DGraphBase.js";
import { dKy_tevstr_c } from "./d_kankyo.js";
import { cM_s2rad } from "./SComponent.js";
import { dRes_control_c, ResType } from "./d_resorce.js";
import { DeviceProgram } from "../Program.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { fillMatrix4x4, fillVec3v, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { preprocessProgramObj_GLSL } from "../gfx/shaderc/GfxShaderCompiler.js";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetID } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderDynamicUniformBuffer } from "../gfx/render/GfxRenderDynamicUniformBuffer.js";

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
        this.shadowControl = new dDlst_shadowControl_c(device, cache, resCtrl, symbolMap);
    }

    public destroy(device: GfxDevice): void {
        this.peekZ.destroy(device);
        this.alphaModel0.destroy(device);
        this.shadowControl.destroy(device);
    }
}

interface dDlst_shadowSimple_c_DLCache {
    program: GfxProgram;
    inputLayout: GfxInputLayout;
    positionBuffer: GfxBuffer;
    indexBuffer: GfxBuffer;
    sampler: GfxSampler;
}

class SimpleShadowProgram extends DeviceProgram {
    public static bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 2, samplerEntries: [
            { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
            { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.UnfilterableFloat, },
        ] }];
    
    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_Params {
    vec4 u_viewportSize;
    Mat4x4 u_ClipFromLocal;
    Mat4x4 u_LocalFromClip;
};

layout(location = 0) uniform sampler2D u_TextureShadow;
layout(location = 1) uniform sampler2D u_TextureFramebufferDepth; // Depth buffer

varying vec2 v_UV;

#if defined VERT
layout(location = 0) in vec3 a_Position; // Unit cube coordinates (-1 to 1).

void main() {
    v_UV = a_Position.xz * vec2(0.5) + vec2(0.5);
    gl_Position = UnpackMatrix(u_ClipFromLocal) * vec4(a_Position.xyz, 1.0);
}
#elif defined FRAG

void main() {
    vec3 t_ClipPos;
    t_ClipPos.xy = (gl_FragCoord.xy / u_viewportSize.xy) * 2.0 - vec2(1.0);
    t_ClipPos.z = texelFetch(SAMPLER_2D(u_TextureFramebufferDepth), ivec2(gl_FragCoord.xy), 0).r;
    vec4 t_ObjectPos = UnpackMatrix(u_LocalFromClip) * vec4(t_ClipPos, 1.0);
    t_ObjectPos.xyz /= t_ObjectPos.w;

    // Now that we have our object-space position, remove any samples outside of the box.
    if (any(lessThan(t_ObjectPos.xyz, vec3(-1))) || any(greaterThan(t_ObjectPos.xyz, vec3(1))))
        discard;
    
    // Top-down project our shadow texture. Our local space is between -1 and 1, we want to move into 0.0 to 1.0.
    vec2 t_ShadowTexCoord = t_ObjectPos.xz * vec2(0.5) + vec2(0.5);
    float t_ShadowColor = texture(SAMPLER_2D(u_TextureShadow), t_ShadowTexCoord).r;
    if( t_ShadowColor == 0.0 )
        discard;

    gl_FragColor = vec4(0, 0, 0, 0.75);
}
#endif
`;
}

const scratchMat4 = mat4.create();

// Renders a simple cube-shaped shadow volume directly below an object (light position is ignored). Optionally, use a 
// textured quad (defaults to a circle) oriented to the ground normal to stencil out the shadow volume (i.e. a gobo texture).
class dDlst_shadowSimple_c {
    public alpha: number = 0; // 0-255
    public tex: BTIData | null = null;
    public modelViewMtx = mat4.create();
    public texMtx = mat4.create();

    static compileDLs(cache: GfxRenderCache, symbolMap: SymbolMap): dDlst_shadowSimple_c_DLCache {
        const dlCache: dDlst_shadowSimple_c_DLCache = {} as any;
        
        // Compile our custom shader
        const glsl = preprocessProgramObj_GLSL(cache.device, new SimpleShadowProgram());
        dlCache.program = cache.createProgramSimple( glsl );
        dlCache.inputLayout = cache.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 }, // position
            ],
            vertexBufferDescriptors: [
                { byteStride: 4 * 3, frequency: GfxVertexBufferFrequency.PerVertex },
            ],
        });
        dlCache.positionBuffer = createBufferFromData(
            cache.device,
            GfxBufferUsage.Vertex,
            GfxBufferFrequencyHint.Static,
            new Float32Array([
                [-1, -1, -1],
                [ 1, -1, -1],
                [ 1,  1, -1],
                [-1,  1, -1],
                [-1, -1,  1],
                [ 1, -1,  1],
                [ 1,  1,  1],
                [-1,  1,  1],
            ].flat()).buffer,
        );

        dlCache.indexBuffer = createBufferFromData(
            cache.device,
            GfxBufferUsage.Index,
            GfxBufferFrequencyHint.Static,
            new Uint16Array([
                0, 1, 2,
                2, 3, 0,
                4, 5, 6,
                6, 7, 4,
                0, 1, 5,
                5, 4, 0,
                2, 3, 7,
                7, 6, 2,
                1, 2, 6,
                6, 5, 1,
                3, 0, 4,
                4, 7, 3,
            ]).buffer,
        );

        dlCache.sampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0, maxLOD: 0,
        });

        return dlCache;
    }

    static destroy(cache: dDlst_shadowSimple_c_DLCache, device: GfxDevice): void {
        device.destroyProgram(cache.program);
        device.destroyBuffer(cache.positionBuffer);
        device.destroyBuffer(cache.indexBuffer);
        device.destroySampler(cache.sampler);
    }
    
    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {   
        const renderInst = renderInstManager.newRenderInst();  
        let offset = renderInst.allocateUniformBuffer(0, 4 * 16 * 2);
        const buf = renderInst.mapUniformBufferF32(0);
        offset += fillVec4(buf, offset, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        offset += fillMatrix4x4(buf, offset, mat4.mul(scratchMat4, globals.camera.clipFromViewMatrix, this.modelViewMtx));
        offset += fillMatrix4x4(buf, offset, mat4.invert(scratchMat4, scratchMat4));
        // TODO: Handle shadows with no texture 
        if (this.tex) this.tex.fillTextureMapping(materialParams.m_TextureMapping[0]);
        materialParams.m_TextureMapping[1].lateBinding = 'depth-target';
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        renderInstManager.submitRenderInst(renderInst);
    }

    public set(globals: dGlobals, pos: vec3, floorY: number, scaleXZ: number, floorNrm: vec3, rotY: number, scaleZ: number, tex: BTIData | null): void {
        const offsetY = scaleXZ * 16.0 * (1.0 - floorNrm[1]) + 1.0;

        // Build modelViewMtx
        mat4.fromTranslation(this.modelViewMtx, [pos[0], floorY + offsetY, pos[2]]);
        mat4.rotateY(this.modelViewMtx, this.modelViewMtx, cM_s2rad(rotY));
        mat4.scale(this.modelViewMtx, this.modelViewMtx, [scaleXZ, offsetY + offsetY + 16.0, scaleXZ * scaleZ]);
        mat4.mul(this.modelViewMtx, globals.camera.viewFromWorldMatrix, this.modelViewMtx);

        // Build texMtx (oriented to the floor plane)
        const xs = Math.sqrt(1.0 - floorNrm[0] * floorNrm[0]);
        let yy: number;
        let zz: number;
        if (xs !== 0.0) {
            yy = floorNrm[1] * xs;
            zz = -floorNrm[2] * xs;
        } else {
            yy = 0.0;
            zz = 0.0;
        }

        mat4.set(this.texMtx,
            xs, floorNrm[0], 0.0, 0.0,
            -floorNrm[0] * yy, floorNrm[1], zz, 0.0,
            floorNrm[0] * zz, floorNrm[2], yy, 0.0,
            pos[0], floorY, pos[2], 1.0
        );

        mat4.rotateY(this.texMtx, this.texMtx, cM_s2rad(rotY));
        mat4.scale(this.texMtx, this.texMtx, [scaleXZ, 1.0, scaleXZ * scaleZ]);
        mat4.mul(this.texMtx, globals.camera.viewFromWorldMatrix, this.texMtx);

        let opacity = 1.0 - saturate((pos[1] - floorY) * 0.0007);
        this.alpha = opacity * 64.0;
        this.tex = tex;
    }
}

class dDlst_shadowControl_c {
    private simples = nArray(128, () => new dDlst_shadowSimple_c());
    private simpleCount = 0;
    private simpleCache: dDlst_shadowSimple_c_DLCache;

    // TODO: Real shadows
    // private reals = nArray(8, () => new dDlst_shadowSimple_c());
    // private realCache: dDlst_shadowReal_c_DLCache;

    public defaultSimpleTex: BTIData;

    constructor(device: GfxDevice, cache: GfxRenderCache, resCtrl: dRes_control_c, symbolMap: SymbolMap) {
        this.simpleCache = dDlst_shadowSimple_c.compileDLs(cache, symbolMap);

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
        this.defaultSimpleTex = new BTIData(device, cache, bti);
    }

    destroy(device: GfxDevice): void {
        dDlst_shadowSimple_c.destroy(this.simpleCache, device);
        this.defaultSimpleTex.destroy(device);
    }

    public reset(): void {
        this.simpleCount = 0;
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        // dKy_GxFog_set();

        // Draw simple shadows
        // noclip modification: The game's original shadowing uses many draw calls which is inefficient on modern hardware. It works as follows:
        // 1. For each shadow, create a box directly under the object. Its Y rotation matches the caster. It's height is based on the ground slope.
        // 2. Render the front faces of the box, adding 0.25 to the empty alpha buffer. Depth testing is enabled. Similar to shadow volumes.
        // 3. Render the back faces of the box, subtracting 0.25 from the empty alpha buffer. Now alpha is filled only where the box interesects the ground. 
        // 4. If the shadow has a texture (defaults to a circle): Render a textured quad oriented to the ground normal, clear the alpha where texture is 0.
        // 5. Render the box, multiplying the color buffer by (1.0 - alpha). This darkens the areas where the shadow is visible.
        // 6. Render the box, clearing the alpha to 0. This same framebuffer is used to render other shadows, and then alpha objects.
        const template = renderInstManager.pushTemplate();
        template.setBindingLayouts(SimpleShadowProgram.bindingLayouts);
        template.setGfxProgram(this.simpleCache.program);
        template.setMegaStateFlags(setAttachmentStateSimple({}, {
            channelWriteMask: GfxChannelWriteMask.RGB,
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.Zero,
            blendDstFactor: GfxBlendFactor.SrcAlpha,
        }));
        template.setVertexInput(this.simpleCache.inputLayout, [{ buffer: this.simpleCache.positionBuffer }], { buffer: this.simpleCache.indexBuffer });
        template.setDrawCount(36);
        for (let i = 0; i < this.simpleCount; i++) {
            this.simples[i].draw(globals, renderInstManager, viewerInput);
        }
        renderInstManager.popTemplate();
    }

    public imageDraw(mtx: mat4): void {
        // TODO: Implementation
    }

    public pushPasses(globals: dGlobals, renderInstManager: GfxRenderInstManager, builder: GfxrGraphBuilder, mainDepthTargetID: GfxrRenderTargetID, mainColorTargetID: GfxrRenderTargetID): void {        
        builder.pushPass((pass) => {
            pass.setDebugName('Shadows');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            const mainDepthResolveTextureID = builder.resolveRenderTarget(mainDepthTargetID);
            pass.attachResolveTexture(mainDepthResolveTextureID);
            pass.exec((passRenderer, scope) => {
                globals.camera.applyScissor(passRenderer);
                const depthTex = scope.getResolveTextureForID(mainDepthResolveTextureID);
                globals.dlst.shadow.resolveLateSamplerBinding('depth-target', { gfxTexture: depthTex, gfxSampler: this.simpleCache.sampler, lateBinding: null });
                globals.dlst.shadow.drawOnPassRenderer(renderInstManager.gfxRenderCache, passRenderer);
                this.reset();
            });
        });
    }

    public setReal(id: number, shouldFade: number, model: J3DModelInstance, pos: vec3, casterSize: number, heightAgl: number, tevStr: dKy_tevstr_c): number {
        // TODO: Implementation
        return 0;
    }

    public setReal2(id: number, shouldFade: number, model: J3DModelInstance, pos: vec3, casterSize: number, heightAgl: number, tevStr: dKy_tevstr_c): number {
        // TODO: Implementation
        return 0;
    }

    public addReal(id: number, model: J3DModelInstance): boolean {
        // TODO: Implementation
        return false;
    }

    public setSimple(globals: dGlobals, pos: vec3, groundY: number, scaleXZ: number, floorNrm: vec3, angle: number, scaleZ: number, pTexObj: BTIData | null): boolean {
        if (floorNrm === null || this.simpleCount >= this.simples.length)
            return false;

        const simple = this.simples[this.simpleCount++];
        simple.set(globals, pos, groundY, scaleXZ, floorNrm, angle, scaleZ, pTexObj);
        return true;
    }
}

export function dComIfGd_setSimpleShadow2(globals: dGlobals, pos: vec3, groundY: number, scaleXZ: number, floorPoly: cBgS_PolyInfo,
    rotY: number = 0, scaleZ: number = 1.0, i_tex: BTIData | null = globals.dlst.shadowControl.defaultSimpleTex): boolean {
    if (floorPoly.ChkSetInfo() && groundY !== -Infinity) {
        const plane_p = globals.scnPlay.bgS.GetTriPla(floorPoly.bgIdx, floorPoly.triIdx);
        return globals.dlst.shadowControl.setSimple(globals, pos, groundY, scaleXZ, plane_p.n, rotY, scaleZ, i_tex);
    } else {
        return false;
    }
}