
import { mat4, vec3 } from 'gl-matrix';

import { BMD, BMT, MaterialEntry, Shape, ShapeDisplayFlags, DRW1MatrixKind, TTK1Animator, ANK1Animator, bindANK1Animator, bindVAF1Animator, VAF1, VAF1Animator, TPT1, bindTPT1Animator, TPT1Animator, TEX1, BTI_Texture, INF1, calcJointMatrix, HierarchyNodeType, TexMtx } from './j3d';
import { TTK1, bindTTK1Animator, TRK1, bindTRK1Animator, TRK1Animator, ANK1 } from './j3d';

import * as GX from '../gx/gx_enum';
import * as GX_Material from '../gx/gx_material';
import { PacketParams, ColorKind, translateTexFilterGfx, translateWrapModeGfx, ub_MaterialParams, loadTextureFromMipChain, loadedDataCoalescerComboGfx, MaterialParams, fillIndTexMtx, fillMaterialParamsDataWithOptimizations } from '../gx/gx_render';
import { GXShapeHelperGfx, GXMaterialHelperGfx } from '../gx/gx_render';

import { computeViewMatrix, Camera, computeViewSpaceDepthFromWorldSpaceAABB, texProjCamera } from '../Camera';
import { TextureMapping } from '../TextureHolder';
import AnimationController from '../AnimationController';
import { nArray, assert } from '../util';
import { AABB } from '../Geometry';
import { GfxDevice, GfxSampler, GfxTexture } from '../gfx/platform/GfxPlatform';
import { GfxCoalescedBuffersCombo, GfxBufferCoalescerCombo } from '../gfx/helpers/BufferHelpers';
import { ViewerRenderInput, Texture } from '../viewer';
import { setSortKeyDepth, GfxRendererLayer, setSortKeyBias, setSortKeyLayer } from '../gfx/render/GfxRenderer';
import { GfxRenderInst, GfxRenderInstManager } from '../gfx/render/GfxRenderer2';
import { colorCopy, Color } from '../Color';
import { computeNormalMatrix, texEnvMtx } from '../MathHelpers';
import { calcMipChain } from '../gx/gx_texture';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';

export class ShapeInstanceState {
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
        for (let i = 0; i < this.shape.packets.length; i++) {
            const packet = this.shape.packets[i];
            // TODO(jstpierre): Use only one ShapeHelper.
            const shapeHelper = new GXShapeHelperGfx(device, cache, coalescedBuffers.shift()!, this.shape.loadedVertexLayout, packet.loadedVertexData);
            this.shapeHelpers.push(shapeHelper);
        }
    }

    public destroy(device: GfxDevice) {
        this.shapeHelpers.forEach((shapeHelper) => shapeHelper.destroy(device));
    }
}

export class MaterialData {
    public jointData: JointData | null = null;
    public fillMaterialParamsCallback: ((materialParams: MaterialParams, materialInstance: MaterialInstance, viewMatrix: mat4, modelMatrix: mat4, camera: Camera, packetParams: PacketParams) => void) | null = null;

    constructor(public material: MaterialEntry) {
    }
}

class JointData {
    constructor(public jointIndex: number = 0, public parentJointIndex: number = 0) {
    }
}

function J3DCalcBBoardMtx(dst: mat4, m: mat4): void {
    // Modifies m in-place.

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
function J3DCalcYBBoardMtx(dst: mat4, m: mat4, v: vec3 = scratchVec3): void {
    // Modifies m in-place.

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
    constructor(public shapeData: ShapeData, private materialInstance: MaterialInstance) {
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, depth: number, camera: Camera, materialInstanceState: MaterialInstanceState, shapeInstanceState: ShapeInstanceState): void {
        const materialInstance = this.materialInstance;
        if (!materialInstance.visible)
            return;

        const shape = this.shapeData.shape;
        const materialJointMatrix = shapeInstanceState.jointToWorldMatrixArray[materialInstance.materialData.jointData.jointIndex];

        if (!shape.bbox.isEmpty()) {
            bboxScratch.transform(shape.bbox, materialJointMatrix);
            if (!camera.frustum.contains(bboxScratch))
                return;
        }

        packetParams.clear();

        const template = renderInstManager.pushTemplateRenderInst();
        template.sortKey = materialInstance.sortKey;
        template.sortKey = setSortKeyDepth(template.sortKey, depth);
        template.sortKey = setSortKeyBias(template.sortKey, this.shapeData.sortKeyBias);

        materialInstance.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);

        const usesSkinning = shape.displayFlags === ShapeDisplayFlags.USE_PNMTXIDX;

        if (!usesSkinning)
            materialInstance.fillMaterialParams(template, materialInstanceState, shapeInstanceState.worldToViewMatrix, materialJointMatrix, camera, packetParams);

        for (let p = 0; p < shape.packets.length; p++) {
            const packet = shape.packets[p];

            let instVisible = false;
            for (let i = 0; i < packet.matrixTable.length; i++) {
                const matrixIndex = packet.matrixTable[i];

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
                materialInstance.fillMaterialParams(renderInst, materialInstanceState, shapeInstanceState.worldToViewMatrix, materialJointMatrix, camera, packetParams);
        }

        renderInstManager.popTemplateRenderInst();
    }
}

export class MaterialInstanceState {
    public colorOverrides: GX_Material.Color[] = [];
    public alphaOverrides: boolean[] = [];
    public lights = nArray(8, () => new GX_Material.Light());
    public textureMappings: TextureMapping[];
}

function mat4SwapTranslationColumns(m: mat4): void {
    const tx = m[12];
    m[12] = m[8];
    m[8] = tx;
    const ty = m[13];
    m[13] = m[9];
    m[9] = ty;
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
    mat4SwapTranslationColumns(dst);
}

function J3DGetTextureMtxOld(dst: mat4, srt: mat4): void {
    mat4.copy(dst, srt);
}

function J3DBuildE8Mtx(dst: mat4, flipY: boolean): void {
    const flipYScale = flipY ? -1.0 : 1.0;
    texEnvMtx(dst, 0.5, 0.5 * flipYScale, 0.5, 0.5);
    dst[14] = 0.0;
    dst[10] = 1.0;
}

function J3DBuildB8Mtx(dst: mat4, flipY: boolean): void {
    const flipYScale = flipY ? -1.0 : 1.0;
    // B8 is column-swapped from E8.
    texEnvMtx(dst, 0.5, 0.5 * flipYScale, 0.5, 0.5);
    dst[14] = 0.0;
    dst[10] = 1.0;
    mat4SwapTranslationColumns(dst);
}

const materialParams = new MaterialParams();
const matrixScratch = mat4.create(), matrixScratch2 = mat4.create(), matrixScratch3 = mat4.create();
export class MaterialInstance {
    public ttk1Animators: (TTK1Animator | null)[] = [];
    public tpt1Animators: (TPT1Animator | null)[] = [];
    public trk1Animators: (TRK1Animator | null)[] = [];
    public name: string;
    public materialHelper: GXMaterialHelperGfx;
    public visible: boolean = true;
    public sortKey: number = 0;

    constructor(public materialData: MaterialData, materialHacks: GX_Material.GXMaterialHacks) {
        const material = this.materialData.material;
        this.materialHelper = new GXMaterialHelperGfx(material.gxMaterial, materialHacks);
        this.name = material.name;
        let layer = !material.gxMaterial.ropInfo.depthTest ? GfxRendererLayer.BACKGROUND : material.translucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.setSortKeyLayer(layer);
    }

    public setColorWriteEnabled(colorWrite: boolean): void {
        this.materialHelper.megaStateFlags.colorWrite = colorWrite;
    }

    public setMaterialHacks(materialHacks: GX_Material.GXMaterialHacks) {
        this.materialHelper.setMaterialHacks(materialHacks);
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
                    this.trk1Animators[i] = trk1Animator;
            } else {
                this.trk1Animators[i] = null;
            }
        }
    }

    public bindTTK1(animationController: AnimationController, ttk1: TTK1 | null): void {
        for (let i = 0; i < 8; i++) {
            const ttk1Animator = ttk1 !== null ? bindTTK1Animator(animationController, ttk1, this.name, i) : null;
            this.ttk1Animators[i] = ttk1Animator;
        }
    }

    public bindTPT1(animationController: AnimationController, tpt1: TPT1 | null): void {
        for (let i = 0; i < 8; i++) {
            const tpt1Animator = tpt1 !== null ? bindTPT1Animator(animationController, tpt1, this.name, i) : null;
            this.tpt1Animators[i] = tpt1Animator;
        }
    }

    private clampTo8Bit(color: GX_Material.Color): void {
        // TODO(jstpierre): Actually clamp. For now, just make sure it doesn't go negative.
        color.r = Math.max(color.r, 0);
        color.g = Math.max(color.g, 0);
        color.b = Math.max(color.b, 0);
        color.a = Math.max(color.a, 0);
    }

    public setOnRenderInst(device: GfxDevice, cache: GfxRenderCache, renderInst: GfxRenderInst): void {
        this.materialHelper.setOnRenderInst(device, cache, renderInst);
    }

    private calcColor(dst: Color, i: ColorKind, materialInstanceState: MaterialInstanceState, fallbackColor: GX_Material.Color, clampTo8Bit: boolean): void {
        if (this.trk1Animators[i]) {
            this.trk1Animators[i].calcColor(dst);
        } else if (materialInstanceState.colorOverrides[i] !== undefined) {
            if (materialInstanceState.alphaOverrides[i])
                colorCopy(dst, materialInstanceState.colorOverrides[i]);
            else
                colorCopy(dst, materialInstanceState.colorOverrides[i], fallbackColor.a);
        } else {
            colorCopy(dst, fallbackColor);
        }

        if (clampTo8Bit)
            this.clampTo8Bit(dst);
    }

    private calcTexMtxInput(dst: mat4, texMtx: TexMtx, modelViewMatrix: mat4, modelMatrix: mat4): void {
        const matrixMode = texMtx.info & 0x3F;

        // ref. J3DTexGenBlockPatched::calc()
        switch (matrixMode) {
        case 0x01:
        case 0x06:
        case 0x07:
            // Environment mapping. Uses an approximation of the normal matrix (MV with the translation lopped off).
            computeNormalMatrix(dst, modelViewMatrix, true);
            break;

        case 0x02:
        case 0x08:
            // Copy over model matrix.
            mat4.copy(dst, modelMatrix);
            break;

        case 0x03:
        case 0x09:
            // Projection. Used for indtexwater, mostly.
            mat4.copy(dst, modelViewMatrix);
            break;

        case 0x05:
        case 0x0A:
        case 0x0B:
            // Environment mapping, but only using the model matrix.
            computeNormalMatrix(dst, modelMatrix, true);
            break;

        default:
            // No mapping.
            mat4.identity(dst);
            break;
        }
    }

    public calcPostTexMtxInput(dst: mat4, texMtx: TexMtx, viewMatrix: mat4): void {
        const matrixMode = texMtx.info & 0x3F;

        // ref. J3DTexGenBlockPatched::calcPostTexMtx()
        switch (matrixMode) {
            case 0x01:
            case 0x06:
            case 0x07:
                mat4.identity(dst);
                break;

            case 0x02:
            case 0x08:
                mat4.invert(dst, viewMatrix);
                break;

            case 0x03:
            case 0x09:
                mat4.identity(dst);
                break;

            case 0x05:
            case 0x0A:
            case 0x0B:
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
        const texMtx = this.materialData.material.texMatrices[i];
        const isMaya = !!(texMtx.info >>> 7);
        if (this.ttk1Animators[i]) {
            this.ttk1Animators[i].calcTexMtx(dst, isMaya);
        } else {
            mat4.copy(dst, texMtx.matrix);
        }
    }

    public calcTexMtx(dst: mat4, texMtx: TexMtx, texSRT: mat4, modelMatrix: mat4, camera: Camera, flipY: boolean): void {
        // The input matrix is passed in in dst.

        const matrixMode = texMtx.info & 0x3F;
        const flipYScale = flipY ? -1.0 : 1.0;

        // Now apply effects.

        // ref. J3DTexMtx::calc()

        // J3DGetTextureMtxOld puts the translation into the fourth column.
        // J3DGetTextureMtx puts the translation into the third column.
        // Our calcTexMtx uses fourth column, so we need to swap for non-Old.

        // _B8 and _E8 are constant 4x3 matrices
        // _B8 has the translation mapping in the third column, _E8 has the translation mapping in the fourth column.
        // _E8 is equivalent to texEnvMtx, and _B8 is the same but column-swapped.
        // _48 and _88 are scratch space, _24 is effectMatrix,
        // _94 is input matrix calculated above, _64 is output.
        const tmp48 = matrixScratch;
        const tmp88 = matrixScratch2;
        switch (matrixMode) {
        case 0x01:
            {
                // J3DGetTextureMtxOld(_48)
                J3DGetTextureMtxOld(tmp48, texSRT);

                if (flipY) {
                    texEnvMtx(tmp88, 1, 1, 0, 1);
                    mat4.mul(tmp48, tmp88, tmp48);
                }

                // PSMTXConcat(_48, _94, this->_64)
                mat43Concat(dst, tmp48, dst);
            }
            break;

        case 0x02:
        case 0x03:
        case 0x05:
            {
                // J3DGetTextureMtxOld(_88)
                J3DGetTextureMtxOld(tmp88, texSRT);

                if (flipY) {
                    texEnvMtx(tmp48, 1, 1, 0, 1);
                    mat4.mul(tmp88, tmp48, tmp88);
                }

                // J3DMtxProjConcat(_88, this->_24, _48)
                J3DMtxProjConcat(tmp48, tmp88, texMtx.effectMatrix);
                // PSMTXConcat(_48, _94, this->_64)
                mat43Concat(dst, tmp48, dst);
            }
            break;

        case 0x04:
            {
                // J3DGetTextureMtxOld(_88)
                J3DGetTextureMtxOld(tmp88, texSRT);

                if (flipY) {
                    texEnvMtx(tmp48, 1, 1, 0, 1);
                    mat4.mul(tmp88, tmp48, tmp88);
                }

                // J3DMtxProjConcat(_88, this->_24, this->_64);
                J3DMtxProjConcat(dst, tmp88, texMtx.effectMatrix);
            }
            break;

        case 0x06:
            {
                // J3DGetTextureMtxOld(_48)
                J3DGetTextureMtxOld(tmp48, texSRT);

                // PSMTXConcat(_48, _E8, _48)
                J3DBuildE8Mtx(tmp88, flipY);
                mat43Concat(tmp48, tmp48, tmp88);

                // PSMTXConcat(_48, _94, this->_64)
                mat43Concat(dst, tmp48, dst);
            }
            break;

        case 0x07:
            {
                // J3DGetTextureMtx(_48)
                J3DGetTextureMtx(tmp48, texSRT);

                // PSMTXConcat(_48, _B8, _48)
                J3DBuildB8Mtx(tmp88, flipY);
                mat43Concat(tmp48, tmp48, tmp88);

                // PSMTXConcat(_48, _94, this->_64)
                mat43Concat(dst, tmp48, dst);
            }
            break;

        case 0x08:
        case 0x09:
        case 0x0B:
            {
                // J3DGetTextureMtx(_88)
                J3DGetTextureMtx(tmp88, texSRT);

                if (matrixMode === 0x09) {
                    // The effect matrix here is a GameCube projection matrix. Swap it out with out own.
                    // In Galaxy, this is done in ViewProjmapEffectMtxSetter.

                    // Replaces the effectMatrix (this->_24). B8 is built into this call, as well.
                    texProjCamera(tmp48, camera, 0.5, -0.5 * flipYScale, 0.5, 0.5);
                    // J3DMtxProjConcat(_88, this->_24, _48)
                    J3DMtxProjConcat(tmp48, tmp88, tmp48);
                } else if (matrixMode === 0x08) {
                    // PSMTXConcat(_88, _B8, _88)
                    J3DBuildB8Mtx(tmp48, flipY);
                    mat43Concat(tmp88, tmp88, tmp48);

                    // Multiply the effect matrix by the inverse of the model matrix.
                    // In Galaxy, this is done in ProjmapEffectMtxSetter.
                    mat4.invert(tmp48, modelMatrix);
                    mat4.mul(tmp48, texMtx.effectMatrix, tmp48);

                    // J3DMtxProjConcat(_88, this->_24, _48)
                    J3DMtxProjConcat(tmp48, tmp88, tmp48);
                } else {
                    // PSMTXConcat(_88, _B8, _88)
                    J3DBuildB8Mtx(tmp48, flipY);
                    mat43Concat(tmp88, tmp88, tmp48);

                    mat4.mul(tmp48, texMtx.effectMatrix, tmp48);

                    // J3DMtxProjConcat(_88, this->_24, _48)
                    J3DMtxProjConcat(tmp48, tmp88, texMtx.effectMatrix);
                }

                // PSMTXConcat(_48, _94, this->_64)
                mat43Concat(dst, tmp48, dst);
            }
            break;

        case 0x0A:
            {
                // J3DGetTextureMtxOld(_88)
                J3DGetTextureMtxOld(tmp88, texSRT);

                // PSMTXConcat(_88, _E8, _88)
                J3DBuildE8Mtx(tmp48, flipY);
                mat43Concat(tmp88, tmp88, tmp48);

                // J3DMtxProjConcat(_88, this->_24, _48)
                J3DMtxProjConcat(tmp48, tmp88, texMtx.effectMatrix);

                // PSMTXConcat(_48, _94, this->_64)
                mat43Concat(dst, tmp48, dst);
            }
            break;

        case 0x00:
            {
                // J3DGetTextureMtxOld(this->_64)
                J3DGetTextureMtxOld(dst, texSRT);

                if (flipY) {
                    texEnvMtx(tmp48, 1, 1, 0, 1);
                    mat4.mul(dst, tmp48, dst);
                }
            }
            break;

        default:
            {
                throw "whoops";
            }
        }
    }

    public fillMaterialParams(renderInst: GfxRenderInst, materialInstanceState: MaterialInstanceState, viewMatrix: mat4, modelMatrix: mat4, camera: Camera, packetParams: PacketParams): void {
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
            if (this.tpt1Animators[i])
                samplerIndex = this.tpt1Animators[i].calcTextureIndex();
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
            this.calcTexMtx(dst, texMtx, texSRT, modelMatrix, camera, flipY);
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
            this.materialData.fillMaterialParamsCallback(materialParams, this, viewMatrix, modelMatrix, camera, packetParams);

        let offs = renderInst.allocateUniformBuffer(ub_MaterialParams, this.materialHelper.materialParamsBufferSize);
        const d = renderInst.mapUniformBufferF32(ub_MaterialParams);
        fillMaterialParamsDataWithOptimizations(this.materialHelper.material, d, offs, materialParams);

        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
    }
}

interface TEX1_SamplerSub {
    minFilter: GX.TexFilter;
    magFilter: GX.TexFilter;
    wrapS: GX.WrapMode;
    wrapT: GX.WrapMode;
    minLOD: number;
    maxLOD: number;
}

function translateSampler(device: GfxDevice, sampler: TEX1_SamplerSub): GfxSampler {
    const [minFilter, mipFilter] = translateTexFilterGfx(sampler.minFilter);
    const [magFilter]            = translateTexFilterGfx(sampler.magFilter);

    const gfxSampler = device.createSampler({
        wrapS: translateWrapModeGfx(sampler.wrapS),
        wrapT: translateWrapModeGfx(sampler.wrapT),
        minFilter, mipFilter, magFilter,
        minLOD: sampler.minLOD,
        maxLOD: sampler.maxLOD,
    });

    return gfxSampler;
}

// TODO(jstpierre): Unify with TEX1Data? Build a unified cache that can deduplicate
// based on hashing texture data?
export class BTIData {
    private gfxSampler: GfxSampler;
    private gfxTexture: GfxTexture;
    public viewerTexture: Texture;

    constructor(device: GfxDevice, public btiTexture: BTI_Texture) {
        this.gfxSampler = translateSampler(device, btiTexture);
        const mipChain = calcMipChain(this.btiTexture, this.btiTexture.mipCount);
        const { viewerTexture, gfxTexture } = loadTextureFromMipChain(device, mipChain);
        this.gfxTexture = gfxTexture;
        this.viewerTexture = viewerTexture;
    }

    public fillTextureMapping(m: TextureMapping): boolean {
        m.gfxTexture = this.gfxTexture;
        m.gfxSampler = this.gfxSampler;
        m.lodBias = this.btiTexture.lodBias;
        m.width = this.btiTexture.width;
        m.height = this.btiTexture.height;
        return true;
    }

    public destroy(device: GfxDevice): void {
        device.destroySampler(this.gfxSampler);
        device.destroyTexture(this.gfxTexture);
    }
}

export class TEX1Data {
    private gfxSamplers: GfxSampler[] = [];
    private gfxTextures: (GfxTexture | null)[] = [];
    public viewerTextures: (Texture | null)[] = [];

    constructor(device: GfxDevice, public tex1: TEX1) {
        for (let i = 0; i < this.tex1.samplers.length; i++) {
            const tex1Sampler = this.tex1.samplers[i];
            this.gfxSamplers.push(translateSampler(device, tex1Sampler));
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

        m.gfxTexture = this.gfxTextures[sampler.textureDataIndex];
        m.gfxSampler = this.gfxSamplers[sampler.index];
        m.lodBias = sampler.lodBias;
        const textureData = this.tex1.textureDatas[sampler.textureDataIndex];
        m.width = textureData.width;
        m.height = textureData.height;

        return true;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.gfxSamplers.length; i++)
            device.destroySampler(this.gfxSamplers[i]);
        for (let i = 0; i < this.gfxTextures.length; i++)
            if (this.gfxTextures[i] !== null)
                device.destroyTexture(this.gfxTextures[i]);
    }
}

export class BMDModel {
    private realized: boolean = false;
    public tex1Data: TEX1Data;

    private bufferCoalescer: GfxBufferCoalescerCombo;

    public materialData: MaterialData[] = [];
    public shapeData: ShapeData[] = [];
    public jointData: JointData[] = [];

    public hasBillboard: boolean = false;

    public bbox = new AABB();

    constructor(
        device: GfxDevice,
        cache: GfxRenderCache,
        public bmd: BMD,
        public bmt: BMT | null = null,
    ) {
        const mat3 = (bmt !== null && bmt.mat3 !== null) ? bmt.mat3 : bmd.mat3;
        const tex1 = (bmt !== null && bmt.tex1 !== null) ? bmt.tex1 : bmd.tex1;
        this.tex1Data = new TEX1Data(device, tex1);

        // Load shape data.
        const loadedVertexDatas = [];
        for (let i = 0; i < bmd.shp1.shapes.length; i++)
            for (let j = 0; j < bmd.shp1.shapes[i].packets.length; j++)
                loadedVertexDatas.push(bmd.shp1.shapes[i].packets[j].loadedVertexData);
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
        for (let i = 0; i < mat3.materialEntries.length; i++)
            this.materialData.push(new MaterialData(mat3.materialEntries[i]));

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
                const materialData = this.materialData[value];
                assert(materialData.jointData === null);
                materialData.jointData = jointStack[0];
            } else if (type === HierarchyNodeType.Shape) {
                const shapeData = this.shapeData[value];

                // Translucent draws happen in reverse order -- later shapes are drawn first.
                if (this.materialData[shapeData.shape.materialIndex].material.translucent)
                    shapeData.sortKeyBias = --translucentDrawIndex;
            }

            offs += 0x04;
        }

        assert(jointStack.length === 1);
        assert(this.jointData[0].jointIndex === 0 && this.jointData[0].parentJointIndex === -1);
    }

    public createDefaultTextureMappings(): TextureMapping[] {
        const tex1Data = this.tex1Data;
        const textureMappings = nArray(tex1Data.tex1.samplers.length, () => new TextureMapping());
        for (let i = 0; i < tex1Data.tex1.samplers.length; i++)
            tex1Data.fillTextureMappingFromIndex(textureMappings[i], i);
        return textureMappings;
    }

    public destroy(device: GfxDevice): void {
        if (!this.realized)
            return;

        this.bufferCoalescer.destroy(device);
        for (let i = 0; i < this.shapeData.length; i++)
            this.shapeData[i].destroy(device);
        this.tex1Data.destroy(device);
        this.realized = false;
    }
}

const bboxScratch = new AABB();
const scratchViewMatrix = mat4.create();
export class BMDModelInstance {
    public name: string = '';
    public visible: boolean = true;
    public isSkybox: boolean = false;
    public passMask: number = 0x01;

    public modelMatrix = mat4.create();
    public baseScale = vec3.fromValues(1, 1, 1);

    // Animations.
    public animationController = new AnimationController();
    public ank1Animator: ANK1Animator | null = null;
    public vaf1Animator: VAF1Animator | null = null;

    public materialInstanceState = new MaterialInstanceState();
    private materialInstances: MaterialInstance[] = [];
    private shapeInstances: ShapeInstance[] = [];
    private shapeInstanceState = new ShapeInstanceState();

    private jointVisibility: boolean[];

    constructor(
        public bmdModel: BMDModel,
        materialHacks?: GX_Material.GXMaterialHacks
    ) {
        this.materialInstances = this.bmdModel.materialData.map((materialData) => {
            return new MaterialInstance(materialData, materialHacks);
        });
        this.shapeInstances = this.bmdModel.shapeData.map((shapeData) => {
            return new ShapeInstance(shapeData, this.materialInstances[shapeData.shape.materialIndex]);
        });

        this.materialInstanceState.textureMappings = this.bmdModel.createDefaultTextureMappings();

        const bmd = this.bmdModel.bmd;

        const numJoints = bmd.jnt1.joints.length;
        this.shapeInstanceState.jointToWorldMatrixArray = nArray(numJoints, () => mat4.create());
        this.jointVisibility = nArray(numJoints, () => true);

        const drawViewMatrixCount = bmd.drw1.matrixDefinitions.length;
        this.shapeInstanceState.drawViewMatrixArray = nArray(drawViewMatrixCount, () => mat4.create());
        this.shapeInstanceState.drawViewMatrixVisibility = nArray(drawViewMatrixCount, () => true);
        this.shapeInstanceState.worldToViewMatrix = scratchViewMatrix;
    }

    public destroy(device: GfxDevice): void {
        this.bmdModel.destroy(device);
    }

    public setVisible(v: boolean): void {
        this.visible = v;
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
        const samplers = this.bmdModel.tex1Data.tex1.samplers;
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
        const samplers = this.bmdModel.tex1Data.tex1.samplers;
        const samplerIndex = samplers.findIndex((sampler) => sampler.name === samplerName);
        if (samplerIndex < 0)
            throw new Error(`Cannot find texture by name ${samplerName}`);
        this.bmdModel.tex1Data.fillTextureMappingFromIndex(m, samplerIndex);
    }

    /**
     * Sets whether a certain material with name {@param name} should be shown ({@param v} is
     * {@constant true}), or hidden ({@param v} is {@constant false}). All materials are shown
     * by default.
     */
    public setMaterialVisible(name: string, v: boolean): void {
        const materialInstance = this.materialInstances.find((matInst) => matInst.name === name);
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
        this.materialInstances.find((m) => m.name === materialName).setColorWriteEnabled(colorWrite);
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
    public setColorOverride(colorKind: ColorKind, color: GX_Material.Color | undefined, useAlpha: boolean = false): void {
        this.materialInstanceState.colorOverrides[colorKind] = color;
        this.materialInstanceState.alphaOverrides[colorKind] = useAlpha;
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
        this.ank1Animator = ank1 !== null ? bindANK1Animator(animationController, ank1) : null;
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

    /**
     * Returns the joint-to-world matrix for the joint with name {@param jointName}.
     *
     * This object is not a copy; if an animation updates the joint, the values in this object will be
     * updated as well. You can use this as a way to parent an object to this one.
     */
    public getJointToWorldMatrixReference(jointName: string): mat4 {
        const joints = this.bmdModel.bmd.jnt1.joints;
        for (let i = 0; i < joints.length; i++)
            if (joints[i].name === jointName)
                return this.shapeInstanceState.jointToWorldMatrixArray[i];
        throw "could not find joint";
    }

    private isAnyShapeVisible(): boolean {
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

        this.calcJointToWorld();

        // Billboards have their model matrix modified to face the camera, so their world space position doesn't
        // quite match what they kind of do.
        //
        // For now, we simply don't cull both of these special cases, hoping they'll be simple enough to just always
        // render. In theory, we could cull billboards using the bounding sphere.
        const disableCulling = this.bmdModel.hasBillboard;
        computeViewMatrix(this.shapeInstanceState.worldToViewMatrix, camera);

        const jnt1 = this.bmdModel.bmd.jnt1;
        for (let i = 0; i < this.bmdModel.bmd.jnt1.joints.length; i++) {
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

    private computeDepth(camera: Camera): number {
        // Use the root joint to calculate depth.
        const rootJoint = this.bmdModel.bmd.jnt1.joints[0];
        bboxScratch.transform(rootJoint.bbox, this.modelMatrix);
        const depth = Math.max(computeViewSpaceDepthFromWorldSpaceAABB(camera, bboxScratch), 0);
        return depth;
    }

    // The classic public interface, for compatibility.
    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (!this.visible)
            return;

        this.animationController.setTimeInMilliseconds(viewerInput.time);
        this.calcAnim(viewerInput.camera);

        // If entire model is culled away, then we don't need to render anything.
        if (!this.isAnyShapeVisible())
            return;

        const depth = this.computeDepth(viewerInput.camera);
        const template = renderInstManager.pushTemplateRenderInst();
        template.filterKey = this.passMask;
        for (let i = 0; i < this.shapeInstances.length; i++) {
            const shapeVisibility = (this.vaf1Animator !== null ? this.vaf1Animator.calcVisibility(i) : true);
            if (!shapeVisibility)
                continue;
            this.shapeInstances[i].prepareToRender(device, renderInstManager, depth, viewerInput.camera, this.materialInstanceState, this.shapeInstanceState);
        }
        renderInstManager.popTemplateRenderInst();
    }

    // TODO(jstpierre): Sort shapeInstances based on translucent material?
    private draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, camera: Camera, translucent: boolean): void {
        if (!this.isAnyShapeVisible())
            return;

        const depth = this.computeDepth(camera);
        for (let i = 0; i < this.shapeInstances.length; i++) {
            const shapeVisibility = (this.vaf1Animator !== null ? this.vaf1Animator.calcVisibility(i) : true);
            if (!shapeVisibility)
                continue;
            const materialIndex = this.shapeInstances[i].shapeData.shape.materialIndex;
            if (this.materialInstances[materialIndex].materialData.material.translucent !== translucent)
                continue;
            this.shapeInstances[i].prepareToRender(device, renderInstManager, depth, camera, this.materialInstanceState, this.shapeInstanceState);
        }
    }

    public drawOpa(device: GfxDevice, renderInstManager: GfxRenderInstManager, camera: Camera): void {
        this.draw(device, renderInstManager, camera, false);
    }

    public drawXlu(device: GfxDevice, renderInstManager: GfxRenderInstManager, camera: Camera): void {
        this.draw(device, renderInstManager, camera, true);
    }

    public calcJointToWorld(): void {
        for (let i = 0; i < this.bmdModel.jointData.length; i++) {
            const joint = this.bmdModel.jointData[i];

            const jointIndex = joint.jointIndex;
            const jointToParentMatrix = matrixScratch2;
            calcJointMatrix(jointToParentMatrix, jointIndex, this.bmdModel.bmd, this.ank1Animator);

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
        const drw1 = this.bmdModel.bmd.drw1;
        const evp1 = this.bmdModel.bmd.evp1;

        // Now update our matrix definition array.
        for (let i = 0; i < drw1.matrixDefinitions.length; i++) {
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
