
import { mat4, vec3 } from 'gl-matrix';

import { BMD, MaterialEntry, Shape, ShapeDisplayFlags, DRW1MatrixKind, bindVAF1Animator, VAF1, VAF1Animator, TPT1, bindTPT1Animator, TPT1Animator, TEX1, INF1, HierarchyNodeType, TexMtx, MAT3, TexMtxMapMode, Joint, getAnimFrame, sampleAnimationData } from './J3DLoader';
import { TTK1, bindTTK1Animator, TRK1, bindTRK1Animator, ANK1 } from './J3DLoader';

import * as GX_Material from '../../../gx/gx_material';
import { PacketParams, ColorKind, ub_MaterialParams, loadTextureFromMipChain, loadedDataCoalescerComboGfx, MaterialParams, fillIndTexMtx } from '../../../gx/gx_render';
import { GXShapeHelperGfx, GXMaterialHelperGfx } from '../../../gx/gx_render';

import { computeViewMatrix, Camera, computeViewSpaceDepthFromWorldSpaceAABB, texProjCameraSceneTex } from '../../../Camera';
import { TextureMapping } from '../../../TextureHolder';
import AnimationController from '../../../AnimationController';
import { nArray, assert, assertExists } from '../../../util';
import { AABB } from '../../../Geometry';
import { GfxDevice, GfxSampler, GfxTexture, GfxColorWriteMask } from '../../../gfx/platform/GfxPlatform';
import { GfxCoalescedBuffersCombo, GfxBufferCoalescerCombo } from '../../../gfx/helpers/BufferHelpers';
import { ViewerRenderInput, Texture } from '../../../viewer';
import { GfxRenderInst, GfxRenderInstManager, setSortKeyDepth, GfxRendererLayer, setSortKeyBias, setSortKeyLayer } from '../../../gfx/render/GfxRenderer';
import { colorCopy, Color } from '../../../Color';
import { computeNormalMatrix, texEnvMtx, computeModelMatrixSRT } from '../../../MathHelpers';
import { calcMipChain } from '../../../gx/gx_texture';
import { GfxRenderCache } from '../../../gfx/render/GfxRenderCache';
import { NormalizedViewportCoords } from '../../../gfx/helpers/RenderTargetHelpers';
import { setAttachmentStateSimple } from '../../../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { translateSampler } from '../JUTTexture';

export class ShapeInstanceState {
    // One matrix for each joint, which transform into their parent's space.
    public jointToParentMatrixArray: mat4[] = [];

    // One matrix for each joint, which transform into world space.
    public jointToWorldMatrixArray: mat4[] = [];

    // Draw (DRW1 matrix definitions, incl. envelopes), which transform into view space.
    public drawViewMatrixArray: mat4[] = [];

    // View-specific visibility for each of the matrices in drawToViewMatrices.
    // TODO(jstpierre): Currently true for all envelope matrices.
    public drawViewMatrixVisibility: boolean[] = [];

    // The camera's view matrix.
    public worldToViewMatrix: mat4;
}

class ShapeData {
    public shapeHelpers: GXShapeHelperGfx[] = [];
    public sortKeyBias: number = 0;

    constructor(device: GfxDevice, cache: GfxRenderCache, public shape: Shape, coalescedBuffers: GfxCoalescedBuffersCombo[]) {
        for (let i = 0; i < this.shape.mtxGroups.length; i++) {
            const mtxGroup = this.shape.mtxGroups[i];
            // TODO(jstpierre): Use only one ShapeHelper.
            const shapeHelper = new GXShapeHelperGfx(device, cache, coalescedBuffers.shift()!, this.shape.loadedVertexLayout, mtxGroup.loadedVertexData);
            this.shapeHelpers.push(shapeHelper);
        }
    }

    public destroy(device: GfxDevice) {
        for (let i = 0; i < this.shapeHelpers.length; i++)
            this.shapeHelpers[i].destroy(device);
    }
}

export class MaterialData {
    public fillMaterialParamsCallback: ((materialParams: MaterialParams, materialInstance: MaterialInstance, viewMatrix: mat4, modelMatrix: mat4, camera: Camera, viewport: NormalizedViewportCoords, packetParams: PacketParams) => void) | null = null;

    constructor(public material: MaterialEntry) {
    }
}

class JointData {
    constructor(public jointIndex: number = 0, public parentJointIndex: number = 0) {
    }
}

export function J3DCalcBBoardMtx(dst: mat4, m: mat4): void {
    // The column vectors lengths here are the scale.
    const mx = Math.hypot(m[0], m[1], m[2]);
    const my = Math.hypot(m[4], m[5], m[6]);
    const mz = Math.hypot(m[8], m[9], m[10]);

    dst[0] = mx;
    dst[4] = 0;
    dst[8] = 0;
    dst[12] = m[12];

    dst[1] = 0;
    dst[5] = my;
    dst[9] = 0;
    dst[13] = m[13];

    dst[2] = 0;
    dst[6] = 0;
    dst[10] = mz;
    dst[14] = m[14];

    // Fill with junk to try and signal when something has gone horribly wrong. This should go unused,
    // since this is supposed to generate a mat4x3 matrix.
    dst[3] = 9999.0;
    dst[7] = 9999.0;
    dst[11] = 9999.0;
    dst[15] = 9999.0;
}

const scratchVec3 = vec3.create();
export function J3DCalcYBBoardMtx(dst: mat4, m: mat4, v: vec3 = scratchVec3): void {
    // The column vectors lengths here are the scale.
    const mx = Math.hypot(m[0], m[1], m[2]);
    const mz = Math.hypot(m[8], m[9], m[10]);

    vec3.set(v, 0.0, -m[6], m[5]);
    vec3.normalize(v, v);

    dst[0] = mx;
    dst[4] = m[4];
    dst[8] = 0;
    dst[12] = m[12];

    dst[1] = 0;
    dst[5] = m[5];
    dst[9] = v[1] * mz;
    dst[13] = m[13];

    dst[2] = 0;
    dst[6] = m[6];
    dst[10] = v[2] * mz;
    dst[14] = m[14];

    // Fill with junk to try and signal when something has gone horribly wrong. This should go unused,
    // since this is supposed to generate a mat4x3 matrix.
    m[3] = 9999.0;
    m[7] = 9999.0;
    m[11] = 9999.0;
    m[15] = 9999.0;
}

const scratchModelViewMatrix = mat4.create();
const packetParams = new PacketParams();
export class ShapeInstance {
    public visible: boolean = true;

    constructor(public shapeData: ShapeData, private materialInstance: MaterialInstance) {
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, depth: number, camera: Camera, viewport: NormalizedViewportCoords, modelData: J3DModelData, materialInstanceState: MaterialInstanceState, shapeInstanceState: ShapeInstanceState): void {
        if (!this.visible)
            return;

        const materialInstance = this.materialInstance;
        if (!materialInstance.visible)
            return;

        const shape = this.shapeData.shape;
        const materialIndex = materialInstance.materialData.material.index;
        const materialJointIndex = modelData.materialJointIndices[materialIndex];
        const materialJointMatrix = shapeInstanceState.jointToWorldMatrixArray[materialJointIndex];

        packetParams.clear();

        const template = renderInstManager.pushTemplateRenderInst();
        template.sortKey = materialInstance.sortKey;
        template.sortKey = setSortKeyDepth(template.sortKey, depth);
        template.sortKey = setSortKeyBias(template.sortKey, this.shapeData.sortKeyBias);

        materialInstance.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);

        const usesSkinning = shape.displayFlags === ShapeDisplayFlags.USE_PNMTXIDX;

        if (!usesSkinning)
            materialInstance.fillMaterialParams(template, materialInstanceState, shapeInstanceState.worldToViewMatrix, materialJointMatrix, camera, viewport, packetParams);

        for (let p = 0; p < shape.mtxGroups.length; p++) {
            const mtxGroup = shape.mtxGroups[p];

            let instVisible = false;
            for (let i = 0; i < mtxGroup.useMtxTable.length; i++) {
                const matrixIndex = mtxGroup.useMtxTable[i];

                // Leave existing matrix.
                if (matrixIndex === 0xFFFF)
                    continue;

                const drw = shapeInstanceState.drawViewMatrixArray[matrixIndex];
                const dst = packetParams.u_PosMtx[i];

                if (shape.displayFlags === ShapeDisplayFlags.BILLBOARD)
                    J3DCalcBBoardMtx(dst, drw);
                else if (shape.displayFlags === ShapeDisplayFlags.Y_BILLBOARD)
                    J3DCalcYBBoardMtx(dst, drw);
                else
                    mat4.copy(dst, drw);

                if (shapeInstanceState.drawViewMatrixVisibility[matrixIndex])
                    instVisible = true;
            }

            if (!instVisible)
                continue;

            const renderInst = this.shapeData.shapeHelpers[p].pushRenderInst(renderInstManager);
            this.shapeData.shapeHelpers[p].fillPacketParams(packetParams, renderInst);

            if (usesSkinning)
                materialInstance.fillMaterialParams(renderInst, materialInstanceState, shapeInstanceState.worldToViewMatrix, materialJointMatrix, camera, viewport, packetParams);
        }

        renderInstManager.popTemplateRenderInst();
    }
}

export class MaterialInstanceState {
    public colorOverrides: Color[] = [];
    public lights = nArray(8, () => new GX_Material.Light());
    public textureMappings: TextureMapping[];
}

function J3DMtxProjConcat(dst: mat4, a: mat4, b: mat4): void {
    // This is almost mat4.mul except it only outputs three rows of output.
    // Slightly more efficient.

    const b00 = b[0] , b10 = b[1] , b20 = b[2] , b30 = b[3],
          b01 = b[4] , b11 = b[5] , b21 = b[6] , b31 = b[7],
          b02 = b[8] , b12 = b[9] , b22 = b[10], b32 = b[11],
          b03 = b[12], b13 = b[13], b23 = b[14], b33 = b[15];

    const a00 = a[0], a01 = a[4], a02 = a[8], a03 = a[12];
    dst[0]  = a00*b00 + a01*b10 + a02*b20 + a03*b30;
    dst[4]  = a00*b01 + a01*b11 + a02*b21 + a03*b31;
    dst[8]  = a00*b02 + a01*b12 + a02*b22 + a03*b32;
    dst[12] = a00*b03 + a01*b13 + a02*b23 + a03*b33;

    const a10 = a[1], a11 = a[5], a12 = a[9], a13 = a[13];
    dst[1]  = a10*b00 + a11*b10 + a12*b20 + a13*b30;
    dst[5]  = a10*b01 + a11*b11 + a12*b21 + a13*b31;
    dst[9]  = a10*b02 + a11*b12 + a12*b22 + a13*b32;
    dst[13] = a10*b03 + a11*b13 + a12*b23 + a13*b33;

    const a20 = a[2], a21 = a[6], a22 = a[10], a23 = a[14];
    dst[2]  = a20*b00 + a21*b10 + a22*b20 + a23*b30;
    dst[6]  = a20*b01 + a21*b11 + a22*b21 + a23*b31;
    dst[10] = a20*b02 + a21*b12 + a22*b22 + a23*b32;
    dst[14] = a20*b03 + a21*b13 + a22*b23 + a23*b33;
}

function mat43Concat(dst: mat4, a: mat4, b: mat4): void {
    // This is almost mat4.mul except the inputs/outputs are mat4x3s.
    // Slightly more efficient.

    const b00 = b[0] , b10 = b[1] , b20 = b[2],
          b01 = b[4] , b11 = b[5] , b21 = b[6],
          b02 = b[8] , b12 = b[9] , b22 = b[10],
          b03 = b[12], b13 = b[13], b23 = b[14];

    const a00 = a[0], a01 = a[4], a02 = a[8], a03 = a[12];
    dst[0]  = a00*b00 + a01*b10 + a02*b20;
    dst[4]  = a00*b01 + a01*b11 + a02*b21;
    dst[8]  = a00*b02 + a01*b12 + a02*b22;
    dst[12] = a00*b03 + a01*b13 + a02*b23 + a03;

    const a10 = a[1], a11 = a[5], a12 = a[9], a13 = a[13];
    dst[1]  = a10*b00 + a11*b10 + a12*b20;
    dst[5]  = a10*b01 + a11*b11 + a12*b21;
    dst[9]  = a10*b02 + a11*b12 + a12*b22;
    dst[13] = a10*b03 + a11*b13 + a12*b23 + a13;

    const a20 = a[2], a21 = a[6], a22 = a[10], a23 = a[14];
    dst[2]  = a20*b00 + a21*b10 + a22*b20;
    dst[6]  = a20*b01 + a21*b11 + a22*b21;
    dst[10] = a20*b02 + a21*b12 + a22*b22;
    dst[14] = a20*b03 + a21*b13 + a22*b23 + a23;
}

function J3DGetTextureMtx(dst: mat4, srt: mat4): void {
    mat4.copy(dst, srt);

    // Move translation to third column.
    dst[8] = dst[12];
    dst[9] = dst[13];
    dst[10] = 1.0;

    dst[12] = 0;
    dst[13] = 0;
    dst[14] = 0;
}

function J3DGetTextureMtxOld(dst: mat4, srt: mat4): void {
    mat4.copy(dst, srt);
}

const flipYMatrix = mat4.create();
function mtxFlipY(dst: mat4, flipY: boolean): void {
    if (flipY) {
        texEnvMtx(flipYMatrix, 1, 1, 0, 1);
        mat4.mul(dst, flipYMatrix, dst);
    }
}

function buildEnvMtxOld(dst: mat4, flipYScale: number): void {
    // Map from -1...1 range to 0...1 range.
    texEnvMtx(dst, 0.5, 0.5 * flipYScale, 0.5, 0.5);
    // texEnvMtx puts translation in fourth column, which is where we want it.
    // We just need to punt the Z identity outta here.
    dst[10] = 1.0;
    dst[14] = 0.0;
}

export function buildEnvMtx(dst: mat4, flipYScale: number): void {
    // Map from -1...1 range to 0...1 range.
    texEnvMtx(dst, 0.5, 0.5 * flipYScale, 0.5, 0.5);
    // texEnvMtx puts translation in fourth column, so we need to swap.
    const tx = dst[12];
    dst[12] = dst[8];
    dst[8] = tx;
    const ty = dst[13];
    dst[13] = dst[9];
    dst[9] = ty;
    const tz = dst[14];
    dst[14] = dst[10];
    dst[10] = tz;
}

interface ColorCalc {
    calcColor(dst: Color): void;
}

interface TexMtxCalc {
    calcTexMtx(dst: mat4): void;
}

interface TexNoCalc {
    calcTextureIndex(): number;
}

function setChanWriteEnabled(materialHelper: GXMaterialHelperGfx, bits: GfxColorWriteMask, en: boolean): void {
    let colorWriteMask = materialHelper.megaStateFlags.attachmentsState![0].colorWriteMask;
    if (en)
        colorWriteMask |= bits;
    else
        colorWriteMask &= ~bits;
    setAttachmentStateSimple(materialHelper.megaStateFlags, { colorWriteMask });
}

const materialParams = new MaterialParams();
const matrixScratch = mat4.create(), matrixScratch2 = mat4.create(), matrixScratch3 = mat4.create();
export class MaterialInstance {
    public colorCalc: (ColorCalc | null)[] = [];
    public texMtxCalc: (TexMtxCalc | null)[] = [];
    public texNoCalc: (TexNoCalc | null)[] = [];
    public name: string;
    public materialData: MaterialData;
    public materialHelper: GXMaterialHelperGfx;
    public visible: boolean = true;
    public sortKey: number = 0;

    constructor(materialData: MaterialData, materialHacks?: GX_Material.GXMaterialHacks) {
        this.setMaterialData(materialData, materialHacks);
    }

    public setMaterialData(materialData: MaterialData, materialHacks?: GX_Material.GXMaterialHacks): void {
        this.materialData = materialData;
        const material = this.materialData.material;
        this.materialHelper = new GXMaterialHelperGfx(material.gxMaterial, materialHacks);
        this.name = material.name;
        let layer = !material.gxMaterial.ropInfo.depthTest ? GfxRendererLayer.BACKGROUND : material.translucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.setSortKeyLayer(layer);
    }

    public setMaterialHacks(materialHacks: GX_Material.GXMaterialHacks) {
        this.materialHelper.setMaterialHacks(materialHacks);
    }

    public setColorWriteEnabled(v: boolean): void {
        setChanWriteEnabled(this.materialHelper, GfxColorWriteMask.COLOR, v);
    }

    public setSortKeyLayer(layer: GfxRendererLayer): void {
        if (this.materialData.material.translucent)
            layer |= GfxRendererLayer.TRANSLUCENT;
        this.sortKey = setSortKeyLayer(this.sortKey, layer);
    }

    public bindTRK1(animationController: AnimationController, trk1: TRK1 | null): void {
        for (let i: ColorKind = 0; i < ColorKind.COUNT; i++) {
            // If the TRK1 exists, only bind new channels. This is necessary for BPK/BRK animations to coexist.
            if (trk1 !== null) {
                const trk1Animator = bindTRK1Animator(animationController, trk1, this.name, i);
                if (trk1Animator !== null)
                    this.colorCalc[i] = trk1Animator;
            } else {
                this.colorCalc[i] = null;
            }
        }
    }

    public bindTTK1(animationController: AnimationController, ttk1: TTK1 | null): void {
        for (let i = 0; i < 8; i++) {
            const ttk1Animator = ttk1 !== null ? bindTTK1Animator(animationController, ttk1, this.name, i) : null;
            this.texMtxCalc[i] = ttk1Animator;
        }
    }

    public bindTPT1(animationController: AnimationController, tpt1: TPT1 | null): void {
        for (let i = 0; i < 8; i++) {
            const tpt1Animator = tpt1 !== null ? bindTPT1Animator(animationController, tpt1, this.name, i) : null;
            this.texNoCalc[i] = tpt1Animator;
        }
    }

    private clampTo8Bit(color: Color): void {
        // TODO(jstpierre): Actually clamp. For now, just make sure it doesn't go negative.
        color.r = Math.max(color.r, 0);
        color.g = Math.max(color.g, 0);
        color.b = Math.max(color.b, 0);
        color.a = Math.max(color.a, 0);
    }

    public setOnRenderInst(device: GfxDevice, cache: GfxRenderCache, renderInst: GfxRenderInst): void {
        this.materialHelper.setOnRenderInst(device, cache, renderInst);
    }

    private calcColor(dst: Color, i: ColorKind, materialInstanceState: MaterialInstanceState, fallbackColor: Color, clampTo8Bit: boolean): void {
        if (this.colorCalc[i]) {
            this.colorCalc[i]!.calcColor(dst);
        } else if (materialInstanceState.colorOverrides[i] !== undefined) {
            colorCopy(dst, materialInstanceState.colorOverrides[i]);
        } else {
            colorCopy(dst, fallbackColor);
        }

        if (clampTo8Bit)
            this.clampTo8Bit(dst);
    }

    private calcTexMtxInput(dst: mat4, texMtx: TexMtx, modelViewMatrix: mat4, modelMatrix: mat4): void {
        const matrixMode: TexMtxMapMode = texMtx.info & 0x3F;

        // ref. J3DTexGenBlockPatched::calc()
        switch (matrixMode) {
        case TexMtxMapMode.EnvmapBasic:
        case TexMtxMapMode.EnvmapOld:
        case TexMtxMapMode.Envmap:
            computeNormalMatrix(dst, modelViewMatrix, true);
            break;

        case TexMtxMapMode.ProjmapBasic:
        case TexMtxMapMode.Projmap:
            mat4.copy(dst, modelMatrix);
            break;

        case TexMtxMapMode.ViewProjmapBasic:
        case TexMtxMapMode.ViewProjmap:
            mat4.copy(dst, modelViewMatrix);
            break;

        case 0x05:
        case TexMtxMapMode.EnvmapOldEffectMtx:
        case TexMtxMapMode.EnvmapEffectMtx:
            computeNormalMatrix(dst, modelMatrix, true);
            break;

        default:
            // No mapping.
            mat4.identity(dst);
            break;
        }
    }

    public calcPostTexMtxInput(dst: mat4, texMtx: TexMtx, viewMatrix: mat4): void {
        const matrixMode: TexMtxMapMode = texMtx.info & 0x3F;

        // ref. J3DTexGenBlockPatched::calcPostTexMtx()
        switch (matrixMode) {
        case TexMtxMapMode.EnvmapBasic:
        case TexMtxMapMode.EnvmapOld:
        case TexMtxMapMode.Envmap:
            mat4.identity(dst);
            break;

        case TexMtxMapMode.ProjmapBasic:
        case TexMtxMapMode.Projmap:
            mat4.invert(dst, viewMatrix);
            break;

        case TexMtxMapMode.ViewProjmapBasic:
        case TexMtxMapMode.ViewProjmap:
            mat4.identity(dst);
            break;

        case 0x05:
        case TexMtxMapMode.EnvmapOldEffectMtx:
        case TexMtxMapMode.EnvmapEffectMtx:
            mat4.invert(dst, viewMatrix);
            computeNormalMatrix(dst, dst, true);
            break;

        default:
            // No mapping.
            mat4.identity(dst);
            break;
        }
    }

    public calcTexSRT(dst: mat4, i: number): void {
        const texMtx = this.materialData.material.texMatrices[i]!;
        const ttk1Animator = this.texMtxCalc[i];
        if (ttk1Animator) {
            ttk1Animator.calcTexMtx(dst);
        } else {
            mat4.copy(dst, texMtx.matrix);
        }
    }

    public calcTexMtx(dst: mat4, texMtx: TexMtx, texSRT: mat4, modelMatrix: mat4, camera: Camera, viewport: NormalizedViewportCoords, flipY: boolean): void {
        // The input matrix is passed in in dst.

        const matrixMode: TexMtxMapMode = texMtx.info & 0x3F;
        const flipYScale = flipY ? -1.0 : 1.0;

        // Now apply effects.

        // ref. J3DTexMtx::calc()
        const tmp1 = matrixScratch;
        const tmp2 = matrixScratch2;
        switch (matrixMode) {
        case TexMtxMapMode.EnvmapBasic:
            {
                // J3DGetTextureMtxOld(tmp1)
                J3DGetTextureMtxOld(tmp1, texSRT);

                // PSMTXConcat(tmp1, inputMatrix, this->finalMatrix)
                mat43Concat(dst, tmp1, dst);
            }
            break;

        case TexMtxMapMode.ProjmapBasic:
        case TexMtxMapMode.ViewProjmapBasic:
        case 0x05:
            {
                // J3DGetTextureMtxOld(tmp2)
                J3DGetTextureMtxOld(tmp2, texSRT);

                mtxFlipY(dst, flipY);

                // J3DMtxProjConcat(tmp2, this->effectMtx, tmp1)
                J3DMtxProjConcat(tmp1, tmp2, texMtx.effectMatrix);
                // PSMTXConcat(tmp1, inputMatrix, this->finalMatrix)
                mat43Concat(dst, tmp1, dst);
            }
            break;

        case 0x04:
            {
                // J3DGetTextureMtxOld(tmp2)
                J3DGetTextureMtxOld(tmp2, texSRT);

                mtxFlipY(dst, flipY);

                // J3DMtxProjConcat(tmp2, this->effectMtx, this->finalMatrix);
                J3DMtxProjConcat(dst, tmp2, texMtx.effectMatrix);
            }
            break;

        case TexMtxMapMode.EnvmapOld:
            {
                // J3DGetTextureMtxOld(tmp1)
                J3DGetTextureMtxOld(tmp1, texSRT);

                // PSMTXConcat(tmp1, EnvMtxOld, tmp1)
                buildEnvMtxOld(tmp2, flipYScale);
                mat43Concat(tmp1, tmp1, tmp2);

                // PSMTXConcat(tmp1, inputMatrix, this->finalMatrix)
                mat43Concat(dst, tmp1, dst);
            }
            break;

        case TexMtxMapMode.Envmap:
            {
                // J3DGetTextureMtx(tmp1)
                J3DGetTextureMtx(tmp1, texSRT);

                // PSMTXConcat(tmp1, EnvMtx, tmp1)
                buildEnvMtx(tmp2, flipYScale);
                mat43Concat(tmp1, tmp1, tmp2);

                // PSMTXConcat(tmp1, inputMatrix, this->finalMatrix)
                mat43Concat(dst, tmp1, dst);
            }
            break;

        case TexMtxMapMode.Projmap:
        case TexMtxMapMode.ViewProjmap:
        case TexMtxMapMode.EnvmapEffectMtx:
            {
                // J3DGetTextureMtx(tmp2)
                J3DGetTextureMtx(tmp2, texSRT);

                if (matrixMode === TexMtxMapMode.ViewProjmap) {
                    // The effect matrix here is a GameCube projection matrix. Swap it out with out own.
                    // In Galaxy, this is done in ViewProjmapEffectMtxSetter.

                    // Replaces the effectMatrix. EnvMtx is built into this call, as well.
                    texProjCameraSceneTex(tmp1, camera, viewport, flipYScale);

                    // J3DMtxProjConcat(tmp2, this->effectMtx, tmp1)
                    J3DMtxProjConcat(tmp1, tmp2, tmp1);
                } else if (matrixMode === TexMtxMapMode.Projmap) {
                    // PSMTXConcat(tmp2, EnvMtx, tmp2)
                    buildEnvMtx(tmp1, flipYScale);
                    mat43Concat(tmp2, tmp2, tmp1);

                    // Multiply the effect matrix by the inverse of the model matrix.
                    // In Galaxy, this is done in ProjmapEffectMtxSetter.
                    mat4.invert(tmp1, modelMatrix);
                    mat4.mul(tmp1, texMtx.effectMatrix, tmp1);

                    // J3DMtxProjConcat(tmp2, this->effectMtx, tmp1)
                    J3DMtxProjConcat(tmp1, tmp2, tmp1);
                } else {
                    // PSMTXConcat(tmp2, EnvMtx, tmp2)
                    buildEnvMtx(tmp1, flipYScale);
                    mat43Concat(tmp2, tmp2, tmp1);

                    // J3DMtxProjConcat(tmp2, this->effectMtx, tmp1)
                    J3DMtxProjConcat(tmp1, tmp2, texMtx.effectMatrix);
                }

                // PSMTXConcat(tmp1, inputMatrix, this->finalMatrix)
                mat43Concat(dst, tmp1, dst);
            }
            break;

        case TexMtxMapMode.EnvmapOldEffectMtx:
            {
                // J3DGetTextureMtxOld(tmp2)
                J3DGetTextureMtxOld(tmp2, texSRT);

                // PSMTXConcat(tmp2, EnvMtxOld, tmp2)
                buildEnvMtxOld(tmp1, flipYScale);
                mat43Concat(tmp2, tmp2, tmp1);

                // J3DMtxProjConcat(tmp2, this->effectMtx, tmp1)
                J3DMtxProjConcat(tmp1, tmp2, texMtx.effectMatrix);

                // PSMTXConcat(tmp1, inputMatrix, this->finalMatrix)
                mat43Concat(dst, tmp1, dst);
            }
            break;

        case TexMtxMapMode.None:
            {
                // J3DGetTextureMtxOld(this->finalMatrix)
                J3DGetTextureMtxOld(dst, texSRT);

                mtxFlipY(dst, flipY);
            }
            break;

        default:
            {
                throw "whoops";
            }
        }
    }

    public fillMaterialParams(renderInst: GfxRenderInst, materialInstanceState: MaterialInstanceState, viewMatrix: mat4, modelMatrix: mat4, camera: Camera, viewport: NormalizedViewportCoords, packetParams: PacketParams): void {
        const material = this.materialData.material;

        this.calcColor(materialParams.u_Color[ColorKind.MAT0],  ColorKind.MAT0,  materialInstanceState, material.colorMatRegs[0],   false);
        this.calcColor(materialParams.u_Color[ColorKind.MAT1],  ColorKind.MAT1,  materialInstanceState, material.colorMatRegs[1],   false);
        this.calcColor(materialParams.u_Color[ColorKind.AMB0],  ColorKind.AMB0,  materialInstanceState, material.colorAmbRegs[0],   false);
        this.calcColor(materialParams.u_Color[ColorKind.AMB1],  ColorKind.AMB1,  materialInstanceState, material.colorAmbRegs[1],   false);
        this.calcColor(materialParams.u_Color[ColorKind.K0],    ColorKind.K0,    materialInstanceState, material.colorConstants[0], true);
        this.calcColor(materialParams.u_Color[ColorKind.K1],    ColorKind.K1,    materialInstanceState, material.colorConstants[1], true);
        this.calcColor(materialParams.u_Color[ColorKind.K2],    ColorKind.K2,    materialInstanceState, material.colorConstants[2], true);
        this.calcColor(materialParams.u_Color[ColorKind.K3],    ColorKind.K3,    materialInstanceState, material.colorConstants[3], true);
        this.calcColor(materialParams.u_Color[ColorKind.CPREV], ColorKind.CPREV, materialInstanceState, material.colorRegisters[3], false);
        this.calcColor(materialParams.u_Color[ColorKind.C0],    ColorKind.C0,    materialInstanceState, material.colorRegisters[0], false);
        this.calcColor(materialParams.u_Color[ColorKind.C1],    ColorKind.C1,    materialInstanceState, material.colorRegisters[1], false);
        this.calcColor(materialParams.u_Color[ColorKind.C2],    ColorKind.C2,    materialInstanceState, material.colorRegisters[2], false);

        // Texture mappings.
        for (let i = 0; i < material.textureIndexes.length; i++) {
            const m = materialParams.m_TextureMapping[i];
            m.reset();

            let samplerIndex: number;
            const animator = this.texNoCalc[i];
            if (animator)
                samplerIndex = animator.calcTextureIndex();
            else
                samplerIndex = material.textureIndexes[i];

            if (samplerIndex >= 0)
                m.copy(materialInstanceState.textureMappings[samplerIndex]);
        }

        mat4.mul(scratchModelViewMatrix, viewMatrix, modelMatrix);

        // Texture matrices.
        for (let i = 0; i < material.texMatrices.length; i++) {
            const texMtx = material.texMatrices[i];
            if (texMtx === null)
                continue;

            const dst = materialParams.u_TexMtx[i];
            const flipY = materialParams.m_TextureMapping[i].flipY;

            this.calcTexMtxInput(dst, texMtx, scratchModelViewMatrix, modelMatrix);
            const texSRT = matrixScratch3;
            this.calcTexSRT(texSRT, i);
            this.calcTexMtx(dst, texMtx, texSRT, modelMatrix, camera, viewport, flipY);
        }

        for (let i = 0; i < material.indTexMatrices.length; i++) {
            const indTexMtx = material.indTexMatrices[i];
            if (indTexMtx === null)
                continue;

            fillIndTexMtx(materialParams.u_IndTexMtx[i], indTexMtx);
        }

        for (let i = 0; i < materialInstanceState.lights.length; i++)
            materialParams.u_Lights[i].copy(materialInstanceState.lights[i]);

        if (this.materialData.fillMaterialParamsCallback !== null)
            this.materialData.fillMaterialParamsCallback(materialParams, this, viewMatrix, modelMatrix, camera, viewport, packetParams);

        const offs = renderInst.allocateUniformBuffer(ub_MaterialParams, this.materialHelper.materialParamsBufferSize);
        this.materialHelper.fillMaterialParamsDataOnInst(renderInst, offs, materialParams);

        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
    }
}

// TODO(jstpierre): Unify with TEX1Data? Build a unified cache that can deduplicate
// based on hashing texture data?
export class TEX1Data {
    private realized: boolean = true;

    private gfxSamplers: GfxSampler[] = [];
    private gfxTextures: (GfxTexture | null)[] = [];
    public viewerTextures: (Texture | null)[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, public tex1: TEX1) {
        for (let i = 0; i < this.tex1.samplers.length; i++) {
            const tex1Sampler = this.tex1.samplers[i];
            this.gfxSamplers.push(translateSampler(device, cache, tex1Sampler));
        }

        for (let i = 0; i < this.tex1.textureDatas.length; i++) {
            const textureData = this.tex1.textureDatas[i];
            if (textureData.data === null) {
                this.gfxTextures.push(null);
                this.viewerTextures.push(null);
            } else {
                const mipChain = calcMipChain(textureData, textureData.mipCount);
                const { viewerTexture, gfxTexture } = loadTextureFromMipChain(device, mipChain);
                this.gfxTextures.push(gfxTexture);
                this.viewerTextures.push(viewerTexture);
            }
        }
    }

    public fillTextureMappingFromIndex(m: TextureMapping, samplerIndex: number): boolean {
        const sampler = this.tex1.samplers[samplerIndex];

        if (this.gfxTextures[sampler.textureDataIndex] === null) {
            // No texture data here...
            return false;
        }

        const textureData = this.tex1.textureDatas[sampler.textureDataIndex];
        m.gfxTexture = this.gfxTextures[sampler.textureDataIndex];
        m.gfxSampler = this.gfxSamplers[sampler.index];
        m.lodBias = sampler.lodBias;
        m.width = textureData.width;
        m.height = textureData.height;
        return true;
    }

    public destroy(device: GfxDevice): void {
        if (!this.realized)
            return;

        for (let i = 0; i < this.gfxTextures.length; i++)
            if (this.gfxTextures[i] !== null)
                device.destroyTexture(this.gfxTextures[i]!);

        this.realized = false;
    }
}

interface MaterialRes {
    mat3: MAT3 | null;
    tex1: TEX1 | null;
}

export class BMDModelMaterialData {
    public materialData: MaterialData[] | null = null;
    public tex1Data: TEX1Data | null = null;

    constructor(device: GfxDevice, cache: GfxRenderCache, materialRes: MaterialRes) {
        const mat3 = materialRes.mat3, tex1 = materialRes.tex1;
        if (mat3 !== null) {
            this.materialData = [];
            for (let i = 0; i < mat3.materialEntries.length; i++)
                this.materialData.push(new MaterialData(mat3.materialEntries[i]));
        }

        if (tex1 !== null)
            this.tex1Data = new TEX1Data(device, cache, tex1);
    }

    public createDefaultTextureMappings(): TextureMapping[] {
        const tex1Data = assertExists(this.tex1Data);
        const textureMappings = nArray(tex1Data.tex1.samplers.length, () => new TextureMapping());
        for (let i = 0; i < tex1Data.tex1.samplers.length; i++)
            tex1Data.fillTextureMappingFromIndex(textureMappings[i], i);
        return textureMappings;
    }

    public destroy(device: GfxDevice): void {
        if (this.tex1Data !== null)
            this.tex1Data.destroy(device);
    }
}

export class J3DModelData {
    public realized: boolean = false;

    private bufferCoalescer: GfxBufferCoalescerCombo;

    public modelMaterialData: BMDModelMaterialData;
    public shapeData: ShapeData[] = [];
    public jointData: JointData[] = [];
    // Reference joint indices for all materials.
    public materialJointIndices: number[] = [];

    public hasBillboard: boolean = false;

    public bbox = new AABB();

    constructor(device: GfxDevice, cache: GfxRenderCache, public bmd: BMD) {
        // Load shape data.
        const loadedVertexDatas = [];
        for (let i = 0; i < bmd.shp1.shapes.length; i++)
            for (let j = 0; j < bmd.shp1.shapes[i].mtxGroups.length; j++)
                loadedVertexDatas.push(bmd.shp1.shapes[i].mtxGroups[j].loadedVertexData);
        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, loadedVertexDatas);

        for (let i = 0; i < bmd.shp1.shapes.length; i++) {
            const shp1 = bmd.shp1.shapes[i];

            // Compute overall bbox.
            this.bbox.union(this.bbox, shp1.bbox);

            // Look for billboards.
            if (shp1.displayFlags === ShapeDisplayFlags.BILLBOARD || shp1.displayFlags === ShapeDisplayFlags.Y_BILLBOARD)
                this.hasBillboard = true;

            this.shapeData.push(new ShapeData(device, cache, shp1, this.bufferCoalescer.coalescedBuffers));
        }

        // Load material data.
        this.modelMaterialData = new BMDModelMaterialData(device, cache, bmd);

        this.loadHierarchy(bmd.inf1);

        // Load scene graph.
        this.realized = true;
    }

    private loadHierarchy(inf1: INF1): void {
        let offs = 0;
        const view = inf1.hierarchyData.createDataView();

        let translucentDrawIndex: number = 0;
        // Dummy joint to be the parent of our root node.
        let lastJoint: JointData = new JointData(-1);
        let jointStack: JointData[] = [lastJoint];
        while (true) {
            const type: HierarchyNodeType = view.getUint16(offs + 0x00);
            const value = view.getUint16(offs + 0x02);

            if (type === HierarchyNodeType.End) {
                break;
            } else if (type === HierarchyNodeType.Open) {
                jointStack.unshift(lastJoint);
            } else if (type === HierarchyNodeType.Close) {
                jointStack.shift();
            } else if (type === HierarchyNodeType.Joint) {
                const jointIndex = value, parentJointIndex = jointStack[0].jointIndex;
                assert(jointIndex > parentJointIndex);
                const joint = new JointData(jointIndex, parentJointIndex);
                this.jointData.push(joint);
                lastJoint = joint;
            } else if (type === HierarchyNodeType.Material) {
                assert(this.materialJointIndices[value] === undefined);
                this.materialJointIndices[value] = jointStack[0].jointIndex;
            } else if (type === HierarchyNodeType.Shape) {
                const shapeData = this.shapeData[value];

                // Translucent draws happen in reverse order -- later shapes are drawn first.
                // TODO(jstpierre): Verify these flags do not change upon changing BMT...
                if (this.modelMaterialData.materialData![shapeData.shape.materialIndex].material.translucent)
                    shapeData.sortKeyBias = --translucentDrawIndex;
            }

            offs += 0x04;
        }

        assert(jointStack.length === 1);
        assert(this.jointData[0].jointIndex === 0 && this.jointData[0].parentJointIndex === -1);
    }

    public destroy(device: GfxDevice): void {
        if (!this.realized)
            return;

        this.bufferCoalescer.destroy(device);
        for (let i = 0; i < this.shapeData.length; i++)
            this.shapeData[i].destroy(device);
        this.modelMaterialData.tex1Data!.destroy(device);
        this.realized = false;
    }
}

export interface JointMatrixCalc {
    calcJointMatrix(dst: mat4, i: number, jnt1: Joint): void;
}

function calcJointMatrixBase(dst: mat4, jnt1: Joint): void {
    const scaleX = jnt1.scaleX;
    const scaleY = jnt1.scaleY;
    const scaleZ = jnt1.scaleZ;
    const rotationX = jnt1.rotationX;
    const rotationY = jnt1.rotationY;
    const rotationZ = jnt1.rotationZ;
    const translationX = jnt1.translationX;
    const translationY = jnt1.translationY;
    const translationZ = jnt1.translationZ;
    computeModelMatrixSRT(dst, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);
}

// TODO(jstpierre): Support better recursive calculation here, SoftImage modes, etc.
export class JointMatrixCalcANK1 {
    constructor(public animationController: AnimationController, public ank1: ANK1) {
    }

    public calcJointMatrix(dst: mat4, i: number, jnt1: Joint): void {
        const frame = this.animationController.getTimeInFrames();
        const animFrame = getAnimFrame(this.ank1, frame);
        const entry = this.ank1.jointAnimationEntries[i];

        if (entry !== undefined) {
            const scaleX = sampleAnimationData(entry.scaleX, animFrame);
            const scaleY = sampleAnimationData(entry.scaleY, animFrame);
            const scaleZ = sampleAnimationData(entry.scaleZ, animFrame);
            const rotationX = sampleAnimationData(entry.rotationX, animFrame) * Math.PI;
            const rotationY = sampleAnimationData(entry.rotationY, animFrame) * Math.PI;
            const rotationZ = sampleAnimationData(entry.rotationZ, animFrame) * Math.PI;
            const translationX = sampleAnimationData(entry.translationX, animFrame);
            const translationY = sampleAnimationData(entry.translationY, animFrame);
            const translationZ = sampleAnimationData(entry.translationZ, animFrame);
            computeModelMatrixSRT(dst, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);
        } else {
            calcJointMatrixBase(dst, jnt1);
        }
    }
}

export class JointMatrixCalcNoAnm {
    public calcJointMatrix(dst: mat4, i: number, jnt1: Joint): void {
        calcJointMatrixBase(dst, jnt1);
    }
}

const bboxScratch = new AABB();
const scratchViewMatrix = mat4.create();
export class J3DModelInstance {
    public name: string = '';
    public visible: boolean = true;
    public isSkybox: boolean = false;

    public modelMatrix = mat4.create();
    public baseScale = vec3.fromValues(1, 1, 1);

    public jointMatrixCalc: JointMatrixCalc;
    public materialInstanceState = new MaterialInstanceState();
    public shapeInstances: ShapeInstance[] = [];
    public materialInstances: MaterialInstance[] = [];
    public shapeInstanceState = new ShapeInstanceState();

    public modelMaterialData: BMDModelMaterialData;
    public tex1Data: TEX1Data;

    private jointVisibility: boolean[];

    constructor(public modelData: J3DModelData, materialHacks?: GX_Material.GXMaterialHacks) {
        assert(this.modelData.realized);

        this.modelMaterialData = this.modelData.modelMaterialData;
        this.materialInstances = this.modelMaterialData.materialData!.map((materialData) => {
            return new MaterialInstance(materialData, materialHacks);
        });
        this.tex1Data = this.modelMaterialData.tex1Data!;

        this.shapeInstances = this.modelData.shapeData.map((shapeData) => {
            return new ShapeInstance(shapeData, this.materialInstances[shapeData.shape.materialIndex]);
        });

        this.materialInstanceState.textureMappings = this.modelMaterialData.createDefaultTextureMappings();

        const bmd = this.modelData.bmd;

        const numJoints = bmd.jnt1.joints.length;
        this.shapeInstanceState.jointToParentMatrixArray = nArray(numJoints, () => mat4.create());
        this.shapeInstanceState.jointToWorldMatrixArray = nArray(numJoints, () => mat4.create());
        this.jointVisibility = nArray(numJoints, () => true);
        this.jointMatrixCalc = new JointMatrixCalcNoAnm();
        this.calcJointAnim();

        // DRW1 seems to specify each envelope twice. Not sure why. J3D actually corrects for this in
        // J3DModelLoader::readDraw(). TODO(jstpierre): RE more of J3DMtxBuffer.
        const drawViewMatrixCount = bmd.drw1.matrixDefinitions.length - bmd.evp1.envelopes.length;
        this.shapeInstanceState.drawViewMatrixArray = nArray(drawViewMatrixCount, () => mat4.create());
        this.shapeInstanceState.drawViewMatrixVisibility = nArray(drawViewMatrixCount, () => true);
        this.shapeInstanceState.worldToViewMatrix = scratchViewMatrix;
    }

    public destroy(device: GfxDevice): void {
        this.modelData.destroy(device);
        this.tex1Data.destroy(device);
    }

    public setVisible(v: boolean): void {
        this.visible = v;
    }

    public setModelMaterialData(modelMaterialData: BMDModelMaterialData): void {
        this.modelMaterialData = modelMaterialData;

        // Set on our material instances.
        if (modelMaterialData.materialData !== null) {
            assert(modelMaterialData.materialData.length >= this.materialInstances.length);
            for (let i = 0; i < this.materialInstances.length; i++)
                this.materialInstances[i].setMaterialData(modelMaterialData.materialData[i]);
        }

        // Set up our new texture mappings.
        if (modelMaterialData.tex1Data !== null)
            this.materialInstanceState.textureMappings = this.modelMaterialData.createDefaultTextureMappings();
    }

    public setMaterialHacks(materialHacks: GX_Material.GXMaterialHacks): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setMaterialHacks(materialHacks);
    }

    public setSortKeyLayer(layer: GfxRendererLayer): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setSortKeyLayer(layer);
    }

    /**
     * Render Hack. Sets whether vertex colors are enabled. If vertex colors are disabled,
     * then opaque white is substituted for them in the shader generated for every material.
     *
     * By default, vertex colors are enabled.
     */
    public setVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setMaterialHacks({ disableVertexColors: !v });
    }

    /**
     * Render Hack. Sets whether texture samples are enabled. If texture samples are disabled,
     * then opaque white is substituted for them in the shader generated for every material.
     *
     * By default, textures are enabled.
     */
    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setMaterialHacks({ disableTextures: !v });
    }

    /**
     * Render Hack. Sets whether lighting is enabled. If lighting is disabled, then it is treated
     * like all light channels have lighting disabled -- meaning they become equivalent to the material
     * color.
     *
     * By default, lighting is enabled.
     */
    public setLightingEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setMaterialHacks({ disableLighting: !v });
    }

    /**
     * Returns the {@link TextureMapping} for the given sampler referenced by the name
     * {@param samplerName}. Manipulating this mapping will affect the texture's usage
     * across all materials. You can use this to bind missing or extra "system" textures,
     * to set up texture overrides for framebuffer-referencing effects, and more.
     *
     * To reset the texture mapping back to the default, you can use
     * {@method fillDefaultTextureMapping} to fill a texture mapping back to its default
     * state.
     *
     * This object is not a copy; setting parameters on this object will directly affect
     * the render for the next frame.
     */
    public getTextureMappingReference(samplerName: string): TextureMapping | null {
        // Find the correct slot for the texture name.
        const samplers = this.tex1Data.tex1.samplers;
        for (let i = 0; i < samplers.length; i++)
            if (samplers[i].name === samplerName)
                return this.materialInstanceState.textureMappings[i];
        return null;
    }

    /**
     * Fills the {@link TextureMapping} {@param m} with the default values for the given
     * sampler referenced by the name {@param samplerName}.
     */
    public fillDefaultTextureMapping(m: TextureMapping, samplerName: string): void {
        // Find the correct slot for the texture name.
        const samplers = this.tex1Data.tex1.samplers;
        const samplerIndex = samplers.findIndex((sampler) => sampler.name === samplerName);
        if (samplerIndex < 0)
            throw new Error(`Cannot find texture by name ${samplerName}`);
        this.tex1Data.fillTextureMappingFromIndex(m, samplerIndex);
    }

    /**
     * Sets whether a certain material with name {@param materialName} should be shown ({@param v} is
     * {@constant true}), or hidden ({@param v} is {@constant false}). All materials are shown
     * by default.
     */
    public setMaterialVisible(materialName: string, v: boolean): void {
        const materialInstance = assertExists(this.materialInstances.find((matInst) => matInst.name === materialName));
        materialInstance.visible = v;
    }

    /**
     * Sets whether color write is enabled. This is equivalent to the native GX function
     * GXSetColorUpdate. There is no MAT3 material flag for this, so some games have special
     * engine hooks to enable and disable color write at runtime.
     *
     * Specifically, Wind Waker turns off color write when drawing a specific part of character's
     * eyes so it can draw them on top of the hair.
     */
    public setMaterialColorWriteEnabled(materialName: string, colorWrite: boolean): void {
        const materialInstance = assertExists(this.materialInstances.find((matInst) => matInst.name === materialName));
        materialInstance.setColorWriteEnabled(colorWrite);
    }

    /**
     * Sets a color override for a specific color. The MAT3 has defaults for every color,
     * but engines can override colors on a model with their own colors if wanted. Color
     * overrides also take precedence over any bound color animations.
     *
     * Choose which color "slot" to override with {@param colorKind}.
     *
     * It is currently not possible to specify a color override per-material.
     *
     * By default, the alpha value in {@param color} is not used. Set {@param useAlpha}
     * to true to obey the alpha color override.
     *
     * To unset a color override, pass {@constant undefined} as for {@param color}.
     */
    public setColorOverride(colorKind: ColorKind, color: Color | undefined): void {
        if (color !== undefined)
            this.materialInstanceState.colorOverrides[colorKind] = color;
        else
            delete this.materialInstanceState.colorOverrides[colorKind];
    }

    /**
     * Sets the shape at index {@param shapeIndex} to be either visible or invisible depending
     * on the value of {@param v}. Note that this modifies the same internal visibility structure
     * as VAF1 animation, and that will be calculated in {@method calcAnim} or {@method prepareToRender}
     * if a VAF1 animation is bound, so this might have no effect in that case.
     */
    public setShapeVisible(shapeIndex: number, v: boolean): void {
        this.shapeInstances[shapeIndex].visible = v;
    }

    /**
     * Returns the {@link GX_Material.Light} at index {@param i} as used by this model instance.
     *
     * This object is not a copy; setting parameters on this object will directly affect
     * the render for the next frame.
     */
    public getGXLightReference(i: number): GX_Material.Light {
        return this.materialInstanceState.lights[i];
    }

    /**
     * Returns the joint-to-parent matrix for the joint with name {@param jointName}.
     *
     * This object is not a copy; if an animation updates the joint, the values in this object will be
     * updated as well. You can also modify this matrix in order to transform the joints. Note that
     * this is the same internal joint data as ANK1 animation, and that will be calculated in
     * {@method calcAnim} or {@method prepareToRender} if an ANK1 animation is bound, so modifiying
     * this matrix will have no effect in that case.
     */
    public getJointToParentMatrixReference(jointName: string): mat4 {
        const joints = this.modelData.bmd.jnt1.joints;
        for (let i = 0; i < joints.length; i++)
            if (joints[i].name === jointName)
                return this.shapeInstanceState.jointToParentMatrixArray[i];
        throw "could not find joint";
    }

    /**
     * Returns the joint-to-world matrix for the joint with name {@param jointName}.
     *
     * This object is not a copy; if an animation updates the joint, the values in this object will be
     * updated as well. You can use this as a way to parent an object to this one.
     */
    public getJointToWorldMatrixReference(jointName: string): mat4 {
        const joints = this.modelData.bmd.jnt1.joints;
        for (let i = 0; i < joints.length; i++)
            if (joints[i].name === jointName)
                return this.shapeInstanceState.jointToWorldMatrixArray[i];
        throw "could not find joint";
    }

    protected isAnyShapeVisible(): boolean {
        for (let i = 0; i < this.shapeInstanceState.drawViewMatrixVisibility.length; i++)
            if (this.shapeInstanceState.drawViewMatrixVisibility[i])
                return true;
        return false;
    }

    public calcAnim(camera: Camera): void {
        if (this.isSkybox) {
            this.modelMatrix[12] = camera.worldMatrix[12];
            this.modelMatrix[13] = camera.worldMatrix[13];
            this.modelMatrix[14] = camera.worldMatrix[14];
        }

        // Update joints from our matrix calculator.
        this.calcJointAnim();
    }

    public calcView(camera: Camera): void {
        this.calcJointToWorld();

        // Billboards have their model matrix modified to face the camera, so their world space position doesn't
        // quite match what they kind of do.
        //
        // For now, we simply don't cull both of these special cases, hoping they'll be simple enough to just always
        // render. In theory, we could cull billboards using the bounding sphere.
        const disableCulling = this.modelData.hasBillboard;
        computeViewMatrix(this.shapeInstanceState.worldToViewMatrix, camera);

        const jnt1 = this.modelData.bmd.jnt1;
        for (let i = 0; i < this.modelData.bmd.jnt1.joints.length; i++) {
            const jointToWorldMatrix = this.shapeInstanceState.jointToWorldMatrixArray[i];

            // TODO(jstpierre): Use shape visibility if the bbox is empty (?).
            if (disableCulling || jnt1.joints[i].bbox.isEmpty()) {
                this.jointVisibility[i] = true;
            } else {
                // Frustum cull.
                // Note to future self: joint bboxes do *not* contain their child joints (see: trees in Super Mario Sunshine).
                // You *cannot* use PARTIAL_INTERSECTION to optimize frustum culling.
                bboxScratch.transform(jnt1.joints[i].bbox, jointToWorldMatrix);
                this.jointVisibility[i] = camera.frustum.contains(bboxScratch);
            }
        }

        this.calcDrawMatrixArray(this.shapeInstanceState.worldToViewMatrix);
    }

    public computeDepth(camera: Camera): number {
        // Use the root joint to calculate depth.
        const rootJoint = this.modelData.bmd.jnt1.joints[0];
        bboxScratch.transform(rootJoint.bbox, this.modelMatrix);
        const depth = Math.max(computeViewSpaceDepthFromWorldSpaceAABB(camera, bboxScratch), 0);
        return depth;
    }

    // TODO(jstpierre): Sort shapeInstances based on translucent material?
    private draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, camera: Camera, viewport: NormalizedViewportCoords, translucent: boolean): void {
        if (!this.isAnyShapeVisible())
            return;

        const depth = this.computeDepth(camera);
        for (let i = 0; i < this.shapeInstances.length; i++) {
            if (!this.shapeInstances[i].visible)
                continue;
            const materialIndex = this.shapeInstances[i].shapeData.shape.materialIndex;
            if (this.materialInstances[materialIndex].materialData.material.translucent !== translucent)
                continue;
            this.shapeInstances[i].prepareToRender(device, renderInstManager, depth, camera, viewport, this.modelData, this.materialInstanceState, this.shapeInstanceState);
        }
    }

    public drawOpa(device: GfxDevice, renderInstManager: GfxRenderInstManager, camera: Camera, viewport: NormalizedViewportCoords): void {
        this.draw(device, renderInstManager, camera, viewport, false);
    }

    public drawXlu(device: GfxDevice, renderInstManager: GfxRenderInstManager, camera: Camera, viewport: NormalizedViewportCoords): void {
        this.draw(device, renderInstManager, camera, viewport, true);
    }

    public calcJointAnim(): void {
        for (let i = 0; i < this.modelData.jointData.length; i++) {
            const joint = this.modelData.jointData[i];
            const jointIndex = joint.jointIndex;
            const jointEntry = this.modelData.bmd.jnt1.joints[jointIndex];
            this.jointMatrixCalc.calcJointMatrix(this.shapeInstanceState.jointToParentMatrixArray[jointIndex], jointIndex, jointEntry);
        }
    }

    public calcJointToWorld(): void {
        for (let i = 0; i < this.modelData.jointData.length; i++) {
            const joint = this.modelData.jointData[i];

            const jointIndex = joint.jointIndex;
            const jointToParentMatrix = this.shapeInstanceState.jointToParentMatrixArray[jointIndex];
            const dst = this.shapeInstanceState.jointToWorldMatrixArray[jointIndex];

            if (joint.parentJointIndex < 0) {
                // Special: construct model matrix.
                mat4.identity(matrixScratch);
                matrixScratch[0] *= this.baseScale[0];
                matrixScratch[5] *= this.baseScale[1];
                matrixScratch[10] *= this.baseScale[2];
                mat4.mul(matrixScratch, this.modelMatrix, matrixScratch);
                mat4.mul(dst, matrixScratch, jointToParentMatrix);
            } else {
                const parentJointToWorldMatrix = this.shapeInstanceState.jointToWorldMatrixArray[joint.parentJointIndex];
                mat4.mul(dst, parentJointToWorldMatrix, jointToParentMatrix);
            }
        }
    }

    private calcDrawMatrixArray(worldToViewMatrix: mat4): void {
        const drw1 = this.modelData.bmd.drw1;
        const evp1 = this.modelData.bmd.evp1;

        // Now update our matrix definition array.
        for (let i = 0; i < this.shapeInstanceState.drawViewMatrixArray.length; i++) {
            const matrixDefinition = drw1.matrixDefinitions[i];
            const dst = this.shapeInstanceState.drawViewMatrixArray[i];
            if (matrixDefinition.kind === DRW1MatrixKind.Joint) {
                const matrixVisible = this.jointVisibility[matrixDefinition.jointIndex];
                this.shapeInstanceState.drawViewMatrixVisibility[i] = matrixVisible;
                mat4.mul(dst, worldToViewMatrix, this.shapeInstanceState.jointToWorldMatrixArray[matrixDefinition.jointIndex]);
            } else if (matrixDefinition.kind === DRW1MatrixKind.Envelope) {
                dst.fill(0);
                const envelope = evp1.envelopes[matrixDefinition.envelopeIndex];

                let matrixVisible = false;
                for (let i = 0; i < envelope.weightedBones.length; i++) {
                    const weightedBone = envelope.weightedBones[i];
                    if (this.jointVisibility[weightedBone.jointIndex]) {
                        matrixVisible = true;
                        break;
                    }
                }

                this.shapeInstanceState.drawViewMatrixVisibility[i] = matrixVisible;

                for (let i = 0; i < envelope.weightedBones.length; i++) {
                    const weightedBone = envelope.weightedBones[i];
                    const inverseBindPose = evp1.inverseBinds[weightedBone.jointIndex];
                    mat4.mul(matrixScratch, this.shapeInstanceState.jointToWorldMatrixArray[weightedBone.jointIndex], inverseBindPose);
                    mat4.multiplyScalarAndAdd(dst, dst, matrixScratch, weightedBone.weight);
                }

                mat4.mul(dst, worldToViewMatrix, dst);
            }
        }
    }
}

export class J3DModelInstanceSimple extends J3DModelInstance {
    public animationController = new AnimationController();
    public vaf1Animator: VAF1Animator | null = null;
    public passMask: number = 0x01;

    public calcAnim(camera: Camera): void {
        super.calcAnim(camera);

        if (this.vaf1Animator !== null)
            for (let i = 0; i < this.shapeInstances.length; i++)
                this.shapeInstances[i].visible = this.vaf1Animator.calcVisibility(i);
    }

    /**
     * Binds {@param ttk1} (texture animations) to this model instance.
     * TTK1 objects can be parsed from {@link BTK} files. See {@link BTK.parse}.
     *
     * @param animationController An {@link AnimationController} to control the progress of this animation to.
     * By default, this will default to this instance's own {@member animationController}.
     */
    public bindTTK1(ttk1: TTK1 | null, animationController: AnimationController = this.animationController): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].bindTTK1(animationController, ttk1);
    }

    /**
     * Binds {@param trk1} (color register animations) to this model instance.
     * TRK1 objects can be parsed from {@link BRK} files. See {@link BRK.parse}.
     *
     * @param animationController An {@link AnimationController} to control the progress of this animation to.
     * By default, this will default to this instance's own {@member animationController}.
     */
    public bindTRK1(trk1: TRK1 | null, animationController: AnimationController = this.animationController): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].bindTRK1(animationController, trk1);
    }

    /**
     * Binds {@param tpt1} (texture palette animations) to this model instance.
     * TPT1 objects can be parsed from {@link BTP} files. See {@link BTP.parse}.
     *
     * @param animationController An {@link AnimationController} to control the progress of this animation to.
     * By default, this will default to this instance's own {@member animationController}.
     */
    public bindTPT1(tpt1: TPT1 | null, animationController: AnimationController = this.animationController): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].bindTPT1(animationController, tpt1);
    }

    /**
     * Binds {@param ank1} (joint animations) to this model instance.
     * ANK1 objects can be parsed from {@link BCK} files. See {@link BCK.parse}.
     *
     * @param animationController An {@link AnimationController} to control the progress of this animation to.
     * By default, this will default to this instance's own {@member animationController}.
     */
    public bindANK1(ank1: ANK1 | null, animationController: AnimationController = this.animationController): void {
        this.jointMatrixCalc = ank1 !== null ? new JointMatrixCalcANK1(animationController, ank1) : new JointMatrixCalcNoAnm();
    }

    /**
     * Binds {@param vaf1} (shape visibility animations) to this model instance.
     * VAF1 objects can be parsed from {@link BVA} files. See {@link BVA.parse}.
     *
     * @param animationController An {@link AnimationController} to control the progress of this animation to.
     * By default, this will default to this instance's own {@member animationController}.
     */
    public bindVAF1(vaf1: VAF1 | null, animationController: AnimationController = this.animationController): void {
        if (vaf1 !== null)
            assert(vaf1.visibilityAnimationTracks.length === this.shapeInstances.length);
        this.vaf1Animator = vaf1 !== null ? bindVAF1Animator(animationController, vaf1) : null;
    }

    // The classic public interface, for compatibility.
    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (!this.visible)
            return;

        this.animationController.setTimeInMilliseconds(viewerInput.time);
        this.calcAnim(viewerInput.camera);
        this.calcView(viewerInput.camera);

        // If entire model is culled away, then we don't need to render anything.
        if (!this.isAnyShapeVisible())
            return;

        const depth = this.computeDepth(viewerInput.camera);
        const template = renderInstManager.pushTemplateRenderInst();
        template.filterKey = this.passMask;
        for (let i = 0; i < this.shapeInstances.length; i++)
            this.shapeInstances[i].prepareToRender(device, renderInstManager, depth, viewerInput.camera, viewerInput.viewport, this.modelData, this.materialInstanceState, this.shapeInstanceState);
        renderInstManager.popTemplateRenderInst();
    }
}
