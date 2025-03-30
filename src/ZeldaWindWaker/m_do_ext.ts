
import { mat4, ReadonlyMat4, ReadonlyVec3, vec2, vec3 } from "gl-matrix";
import { calcANK1JointAnimationTransform, calcJointMatrixFromTransform, entryJointAnimator, entryTevRegAnimator, entryTexMtxAnimator, entryTexNoAnimator, J3DFrameCtrl, J3DFrameCtrl__UpdateFlags, VAF1_getVisibility } from "../Common/JSYSTEM/J3D/J3DGraphAnimator.js";
import { J3DModelData, J3DModelInstance, JointMatrixCalc, ShapeInstanceState } from "../Common/JSYSTEM/J3D/J3DGraphBase.js";
import { AnimationBase, ANK1, JointTransformInfo, LoopMode, TPT1, TRK1, TTK1, VAF1 } from "../Common/JSYSTEM/J3D/J3DLoader.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { ViewerRenderInput } from "../viewer.js";
import { dDlst_list_Set } from "./d_drawlist.js";
import { dGlobals } from "./Main.js";
import { assert, nArray } from "../util.js";
import { BTIData } from "../Common/JSYSTEM/JUTTexture.js";
import { dKy_setLight__OnMaterialParams, dKy_tevstr_c } from "./d_kankyo.js";
import { Color, colorCopy } from "../Color.js";
import { TDDraw } from "../SuperMarioGalaxy/DDraw.js";
import { ColorKind, DrawParams, GXMaterialHelperGfx, MaterialParams } from "../gx/gx_render.js";
import * as GX from '../gx/gx_enum.js';
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder.js";
import { DisplayListRegisters, displayListRegistersInitGX, displayListRegistersRun } from "../gx/gx_displaylist.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { parseMaterial } from "../gx/gx_material.js";

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec3d = vec3.create();
const materialParams = new MaterialParams(); // TODO: Move?
const drawParams = new DrawParams();

abstract class mDoExt_baseAnm<T extends AnimationBase> {
    public frameCtrl = new J3DFrameCtrl(0);
    public anm: T;

    protected initPlay(duration: number, loopMode: LoopMode, speed: number = 1.0, startFrame: number = 0, endFrame: number = -1, i_modify: boolean = false) {
        if (!i_modify) {
            this.frameCtrl.init(0);
        }

        // Logic bug in Wind Waker: startFrame is assigned before calling init, so this doesn't do anything.
        // this.frameCtrl.startFrame = startFrame;

        this.frameCtrl.init(endFrame >= 0 ? endFrame : duration);
        this.frameCtrl.loopMode = loopMode;
        this.frameCtrl.speedInFrames = speed;
        if (speed > 0.0)
            this.frameCtrl.currentTimeInFrames = startFrame;
        else
            this.frameCtrl.currentTimeInFrames = this.frameCtrl.endFrame;
        this.frameCtrl.repeatStartFrame = this.frameCtrl.currentTimeInFrames;
    }

    public init(modelData: J3DModelData, anm: T, doInit: boolean = true, loopMode: LoopMode, speed: number = 1.0, startFrame: number = 0, endFrame: number = -1, i_modify: boolean = false) {
        this.anm = anm;

        if (doInit)
            this.initPlay(this.anm.duration, loopMode, speed, startFrame, endFrame, i_modify);
    }

    public play(deltaTimeFrames: number): boolean {
        this.frameCtrl.update(deltaTimeFrames);
        const hasStopped = !!(this.frameCtrl.updateFlags & J3DFrameCtrl__UpdateFlags.HasStopped) && (this.frameCtrl.speedInFrames === 0);
        return hasStopped;
    }

    public abstract entry(modelInstance: J3DModelInstance): void;
}

export class mDoExt_bckAnm extends mDoExt_baseAnm<ANK1> {
    public entry(modelInstance: J3DModelInstance, curTime: number = this.frameCtrl.currentTimeInFrames): void {
        this.frameCtrl.currentTimeInFrames = curTime;
        entryJointAnimator(modelInstance, this.anm, this.frameCtrl);
    }
}

export class mDoExt_btkAnm extends mDoExt_baseAnm<TTK1> {
    public entry(modelInstance: J3DModelInstance, curTime: number = this.frameCtrl.currentTimeInFrames): void {
        this.frameCtrl.currentTimeInFrames = curTime;
        entryTexMtxAnimator(modelInstance, this.anm, this.frameCtrl);
    }
}

export class mDoExt_brkAnm extends mDoExt_baseAnm<TRK1> {
    public entry(modelInstance: J3DModelInstance, curTime: number = this.frameCtrl.currentTimeInFrames): void {
        this.frameCtrl.currentTimeInFrames = curTime;
        entryTevRegAnimator(modelInstance, this.anm, this.frameCtrl);
    }
}

export type mDoExt_bpkAnm = mDoExt_brkAnm;

export class mDoExt_btpAnm extends mDoExt_baseAnm<TPT1> {
    public entry(modelInstance: J3DModelInstance, curTime: number = this.frameCtrl.currentTimeInFrames): void {
        this.frameCtrl.currentTimeInFrames = curTime;
        entryTexNoAnimator(modelInstance, this.anm, this.frameCtrl);
    }
}

export class mDoExt_bvaAnm extends mDoExt_baseAnm<VAF1> {
    public entry(modelInstance: J3DModelInstance, curTime: number = this.frameCtrl.currentTimeInFrames): void {
        this.frameCtrl.currentTimeInFrames = curTime;
        // TODO(jstpierre): J3DVisibilityManager?
        for (let i = 0; i < modelInstance.shapeInstances.length; i++)
            modelInstance.shapeInstances[i].visible = VAF1_getVisibility(this.anm, i, this.frameCtrl.currentTimeInFrames);
    }
}

export class mDoExt_3Dline_c {
    public segments: vec3[];

    // GPU data
    public scales: number[] | null = null;
    public texCoords: vec2[][] | null = null;
    public positions: vec3[][];

    init(numSegments: number, hasSize: boolean, hasTex: boolean): void {
        this.segments = nArray(numSegments, () => vec3.create());

        if (hasSize) { this.scales = nArray(numSegments, () => 0.0); }

        const numVerts = numSegments * 2;
        this.positions = nArray(2, () => nArray(numVerts, () => vec3.create()));

        if (hasTex) {
            this.texCoords = nArray(2, () => nArray(numVerts, () => vec2.create()));

            for (let i = 0; i < numSegments; i++) {
                this.texCoords[0][i * 2 + 0][0] = 0.0;
                this.texCoords[1][i * 2 + 0][0] = 0.0;
                this.texCoords[0][i * 2 + 1][0] = 1.0;
                this.texCoords[1][i * 2 + 1][0] = 1.0;
            }
        }
    }
}

export interface mDoExt_3DlineMat_c {
    getMaterialID(): number;
    setMaterial(): void;
    draw(globals: dGlobals, renderInstManager: GfxRenderInstManager): void;
}

const l_toonMat1DL = new Uint8Array([
    0x10, 0x00, 0x00, 0x10, 0x40, 0xFF, 0xFF, 0x42, 0x80, 0x08, 0x30, 0x3C, 0xF3, 0xCF, 0x00, 0x10,
    0x00, 0x00, 0x10, 0x18, 0x3C, 0xF3, 0xCF, 0x00, 0x10, 0x00, 0x00, 0x10, 0x0E, 0x00, 0x00, 0x05,
    0x06, 0x10, 0x00, 0x00, 0x10, 0x10, 0x00, 0x00, 0x05, 0x00, 0x10, 0x00, 0x00, 0x10, 0x0A, 0x00,
    0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x10, 0x0C, 0xFF, 0xFF, 0xFF, 0xFF, 0x61, 0x28, 0x3C, 0x00,
    0x00, 0x61, 0xC0, 0x08, 0x24, 0xAF, 0x61, 0xC1, 0x08, 0xFF, 0xF0, 0x61, 0x28, 0x3C, 0x00, 0x00,
    0x61, 0xC2, 0x08, 0xF0, 0x8F, 0x61, 0xC3, 0x08, 0xFF, 0xE0, 0x61, 0x43, 0x00, 0x00, 0x41, 0x61,
    0x40, 0x00, 0x00, 0x17, 0x61, 0x41, 0x00, 0x00, 0x0C, 0x61, 0xF3, 0x7F, 0x00, 0x00, 0x10, 0x00,
    0x00, 0x10, 0x3F, 0x00, 0x00, 0x00, 0x01, 0x10, 0x00, 0x00, 0x10, 0x09, 0x00, 0x00, 0x00, 0x01,
    0x61, 0x00, 0x00, 0x04, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00,
]);

const l_mat1DL = new Uint8Array([
    0x10, 0x00, 0x00, 0x10, 0x40, 0xFF, 0xFF, 0x42, 0x80, 0x08, 0x30, 0x3C, 0xF3, 0xCF, 0x00, 0x10,
    0x00, 0x00, 0x10, 0x18, 0x3C, 0xF3, 0xCF, 0x00, 0x10, 0x00, 0x00, 0x10, 0x0E, 0x00, 0x00, 0x05,
    0x06, 0x10, 0x00, 0x00, 0x10, 0x10, 0x00, 0x00, 0x05, 0x00, 0x10, 0x00, 0x00, 0x10, 0x0A, 0x00,
    0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x10, 0x0C, 0xFF, 0xFF, 0xFF, 0xFF, 0x61, 0x28, 0x38, 0x00,
    0x40, 0x61, 0xC0, 0x08, 0xFA, 0x8F, 0x61, 0xC1, 0x08, 0xFF, 0xF0, 0x61, 0x43, 0x00, 0x00, 0x41,
    0x61, 0x40, 0x00, 0x00, 0x17, 0x61, 0x41, 0x00, 0x00, 0x0C, 0x61, 0xF3, 0x7F, 0x00, 0x00, 0x10,
    0x00, 0x00, 0x10, 0x3F, 0x00, 0x00, 0x00, 0x01, 0x10, 0x00, 0x00, 0x10, 0x09, 0x00, 0x00, 0x00,
    0x01, 0x61, 0x00, 0x00, 0x00, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

export class mDoExt_3DlineMat1_c implements mDoExt_3DlineMat_c {
    public init(numLines: number, numSegments: number, img: BTIData, hasSize: boolean): void {
        this.numLines = numLines;
        this.maxSegments = numSegments;
        this.curArr = 0;

        this.lines = nArray(numLines, () => new mDoExt_3Dline_c());
        for (let i = 0; i < numLines; i++) {
            this.lines[i].init(numSegments, hasSize, true);
        }

        this.tex = img;

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.NRM, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
    }

    public setMaterial(): void {
        // TODO: Optimize this. Pre-generate the material helpers for both command lists. Select on setMaterial(). 

        const matRegisters = new DisplayListRegisters();
        const displayList = this.tevStr ? l_toonMat1DL : l_mat1DL;
        displayListRegistersInitGX(matRegisters);
        displayListRegistersRun(matRegisters, new ArrayBufferSlice(displayList.buffer));
        const material = parseMaterial(matRegisters, `mDoExt_3DlineMat1_c`);

        // Noclip disables diffuse lighting if the attenuation function is set to None. However this DL sets diffuse to
        // CLAMP and attenuation to NONE, so I don't believe that's correct. Modify the atten to work with Noclip.  
        material.lightChannels[0].colorChannel.attenuationFunction = GX.AttenuationFunction.SPOT;

        // TODO: The global light color only has its r channel set. This copies that value to the other channels. 
        //       Otherwise we get a "red" light. How does this normally work?
        material.tevStages[0].rasSwapTable = [0, 0, 0, 0]; 
        
        this.materialHelper = new GXMaterialHelperGfx(material);
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager): void {
        // GXLoadTexObj(&mTexObj, GX_TEXMAP0);
        // u16 h = GXGetTexObjHeight(&mTexObj);
        // u16 w = GXGetTexObjWidth(&mTexObj);
        // GXSetTexCoordScaleManually(GX_TEXCOORD0, GX_TRUE, w, h);

        const template = renderInstManager.pushTemplate();

        // TODO: Is this the same as dKy_SetLight_again?
        dKy_setLight__OnMaterialParams(globals.g_env_light, materialParams, globals.camera);

        this.tex.fillTextureMapping(materialParams.m_TextureMapping[0]);
        template.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

        colorCopy(materialParams.u_Color[ColorKind.C0], this.tevStr.colorC0);
        colorCopy(materialParams.u_Color[ColorKind.C1], this.tevStr.colorK0);
        colorCopy(materialParams.u_Color[ColorKind.C2], this.color);
        mat4.copy(drawParams.u_PosMtx[0], globals.camera.viewFromWorldMatrix);

        this.materialHelper.allocateMaterialParamsDataOnInst(template, materialParams);
        this.materialHelper.allocateDrawParamsDataOnInst(template, drawParams);

        this.ddraw.beginDraw(globals.modelCache.cache);
        for (let i = 0; i < this.numLines; i++) {
            const line = this.lines[i];
            this.ddraw.allocPrimitives(GX.Command.DRAW_TRIANGLE_STRIP, this.numSegments * 2);
            this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
            for (let j = 0; j < this.numSegments * 2; j += 2) {
                this.ddraw.position3vec3(line.positions[this.curArr][j + 0]);
                this.ddraw.texCoord2vec2(GX.Attr.TEX0, line.texCoords![this.curArr][j + 0]);
                this.ddraw.normal3f32(0.25, 0.0, 0.0); // TODO: These normals aren't working. It seems to be that they should be using the identity matrix, but NoClip will always use the normal version of the PosMtx

                this.ddraw.position3vec3(line.positions[this.curArr][j + 1]);
                this.ddraw.texCoord2vec2(GX.Attr.TEX0, line.texCoords![this.curArr][j + 1]);
                this.ddraw.normal3f32(-0.25, 0.0, 0.0);
            }
            this.ddraw.end();
        }
        this.ddraw.endDraw(renderInstManager);

        const renderInst = this.ddraw.makeRenderInst(renderInstManager);
        this.materialHelper.setOnRenderInst(renderInstManager.gfxRenderCache, renderInst);
        renderInstManager.submitRenderInst(renderInst);

        renderInstManager.popTemplate();
    }

    public updateWithScale(globals: dGlobals, segmentCount: number, scale: number, color: Color, space: number, tevStr: dKy_tevstr_c): void {
        this.color = color;
        this.tevStr = tevStr;
        this.numSegments = Math.min(segmentCount, this.maxSegments);
        const spacing = (space != 0) ? scale / space : 0.0;

        let dist = 0.0;
        for (let i = 0; i < this.numLines; i++) {
            const line = this.lines[i];
            const srcPos = line.segments;
            let segIdx = 0;
            let vertIdx = 0;
            assert(!!line.texCoords);

            const dstPos = line.positions[this.curArr];
            const dstUvs = line.texCoords[this.curArr];
            let r_scale = scale;

            // Handle the first segment
            dstUvs[vertIdx + 0][1] = dist;
            dstUvs[vertIdx + 1][1] = dist;

            const segVec = vec3.sub(scratchVec3a, srcPos[segIdx + 1], srcPos[segIdx + 0]);
            const delta = vec3.length(segVec);
            dist += delta * 0.1;

            // Normalize and then scale a vector orthogonal to both the segment and eye
            const eyeVec = vec3.sub(scratchVec3b, srcPos[segIdx + 0], globals.camera.cameraPos);
            const eyeCross = vec3.cross(scratchVec3a, segVec, eyeVec);
            const mag = vec3.length(eyeCross);
            if (mag !== 0.0) {
                vec3.scale(eyeCross, eyeCross, scale / mag);
            }

            vec3.add(dstPos[vertIdx + 0], srcPos[segIdx], eyeCross);
            vec3.sub(dstPos[vertIdx + 1], srcPos[segIdx], eyeCross);

            segIdx += 1;
            vertIdx += 2;
            const nextP0 = vec3.add(scratchVec3c, srcPos[segIdx], eyeCross);
            const nextP1 = vec3.sub(scratchVec3d, srcPos[segIdx], eyeCross);

            // Handle all of the middle segments
            for (let j = this.numSegments - 2; j > 0; j--) {
                if (j < space) {
                    r_scale -= spacing;
                }

                dstUvs[vertIdx + 0][1] = dist;
                dstUvs[vertIdx + 1][1] = dist;

                const segVec = vec3.sub(scratchVec3a, srcPos[segIdx + 1], srcPos[segIdx + 0]);
                const delta = vec3.length(segVec);
                dist += delta * 0.1;

                // Normalize and then scale a vector orthogonal to both the segment and eye
                const eyeVec = vec3.sub(scratchVec3b, srcPos[segIdx + 0], globals.camera.cameraPos);
                const eyeCross = vec3.cross(scratchVec3a, segVec, eyeVec);
                let mag = vec3.length(eyeCross);
                if (mag !== 0.0) {
                    mag = scale / mag;
                }
                vec3.scale(eyeCross, eyeCross, mag);

                nextP0;
                // Average the offset vectors from this and the previous billboard computation
                vec3.add(nextP0, nextP0, srcPos[segIdx + 0]);
                vec3.add(nextP0, nextP0, eyeCross);
                vec3.scale(dstPos[vertIdx + 0], nextP0, 0.5);

                vec3.add(nextP1, nextP1, srcPos[segIdx + 0]);
                vec3.sub(nextP1, nextP1, eyeCross);
                vec3.scale(dstPos[vertIdx + 1], nextP1, 0.5);

                segIdx += 1;
                vertIdx += 2;
                vec3.add(nextP0, srcPos[segIdx], eyeCross);
                vec3.sub(nextP1, srcPos[segIdx], eyeCross);
            }

            // Handle the last segment
            dstUvs[vertIdx + 0][1] = dist;
            dstUvs[vertIdx + 1][1] = dist;

            if (space != 0) {
                vec3.copy(dstPos[vertIdx + 0], srcPos[segIdx]);
                vec3.copy(dstPos[vertIdx + 1], srcPos[segIdx]);
            } else {
                vec3.copy(dstPos[vertIdx + 0], nextP0);
                vec3.copy(dstPos[vertIdx + 1], nextP1);
            }
        }
    }

    public update(segmentCount: number, color: Color, tevStr: dKy_tevstr_c): void {
        // TODO:
    }

    public getMaterialID(): number {
        return 1;
    }

    public lines: mDoExt_3Dline_c[];

    private tex: BTIData;
    private color: Color;
    private tevStr: dKy_tevstr_c;
    private numLines: number;
    private maxSegments: number;
    private numSegments: number;
    private curArr: number;

    private ddraw = new TDDraw();
    private materialHelper: GXMaterialHelperGfx;
}

export function mDoExt_modelEntryDL(globals: dGlobals, modelInstance: J3DModelInstance, renderInstManager: GfxRenderInstManager, drawListSet: dDlst_list_Set | null = null): void {
    if (!modelInstance.visible)
        return;

    if (drawListSet === null)
        drawListSet = globals.dlst.bg;

    // NOTE(jstpierre): This is custom to noclip, normally the toon textures are set in setToonTex during res loading.
    globals.renderer.extraTextures.fillExtraTextures(modelInstance);

    if (globals.renderHacks.renderHacksChanged) {
        modelInstance.setVertexColorsEnabled(globals.renderHacks.vertexColorsEnabled);
        modelInstance.setTexturesEnabled(globals.renderHacks.texturesEnabled);
    }

    const camera = globals.camera;
    modelInstance.calcView(camera.viewFromWorldMatrix, camera.frustum);

    if (!modelInstance.isAnyShapeVisible())
        return;

    renderInstManager.setCurrentList(drawListSet[0]);
    modelInstance.drawOpa(renderInstManager, camera.clipFromViewMatrix);
    renderInstManager.setCurrentList(drawListSet[1]);
    modelInstance.drawXlu(renderInstManager, camera.clipFromViewMatrix);
}

export function mDoExt_modelUpdateDL(globals: dGlobals, modelInstance: J3DModelInstance, renderInstManager: GfxRenderInstManager, drawListSet: dDlst_list_Set | null = null): void {
    if (!modelInstance.visible)
        return;

    modelInstance.calcAnim();
    mDoExt_modelEntryDL(globals, modelInstance, renderInstManager, drawListSet);
}

const scratchTransform = new JointTransformInfo();
export class mDoExt_McaMorf implements JointMatrixCalc {
    public model: J3DModelInstance;
    public frameCtrl = new J3DFrameCtrl(0);
    private prevMorf: number = -1.0;
    private curMorf: number = 0.0;
    private morfStepPerFrame: number =  1.0;
    private transformInfos: JointTransformInfo[] = [];

    constructor(modelData: J3DModelData, private callback1: any = null, private callback2: any = null, private anm: ANK1 | null = null, loopMode: LoopMode, speedInFrames: number = 1.0, startFrame: number = 0, duration: number = -1) {
        this.model = new J3DModelInstance(modelData);

        this.setAnm(anm, loopMode, 0.0, speedInFrames, startFrame, duration);
        this.prevMorf = -1.0;

        for (let i = 0; i < modelData.bmd.jnt1.joints.length; i++) {
            const j = new JointTransformInfo();
            j.copy(modelData.bmd.jnt1.joints[i].transform);
            this.transformInfos.push(j);
        }
    }

    public calcJointMatrix(dst: mat4, modelData: J3DModelData, jointIndex: number, shapeInstanceState: ShapeInstanceState): void {
        const dstTransform = this.transformInfos[jointIndex];

        const jnt1 = modelData.bmd.jnt1.joints[jointIndex];
        const animFrame = this.frameCtrl.currentTimeInFrames;
        const loadFlags = modelData.bmd.inf1.loadFlags;

        if (this.anm !== null) {
            const animFrame1 = this.frameCtrl.applyLoopMode(animFrame + 1);

            if (this.curMorf >= 1.0) {
                calcANK1JointAnimationTransform(dstTransform, this.anm.jointAnimationEntries[jointIndex], animFrame, animFrame1);
                // callback1
            } else {
                // callback1
                let amt = (this.curMorf - this.prevMorf) / (1.0 - this.prevMorf);

                if (amt > 0.0) {
                    calcANK1JointAnimationTransform(scratchTransform, this.anm.jointAnimationEntries[jointIndex], animFrame, animFrame1);
                    dstTransform.lerp(dstTransform, scratchTransform, amt);
                }
            }
        } else {
            dstTransform.copy(jnt1.transform);
            // callback1
        }

        // callback2
        calcJointMatrixFromTransform(dst, dstTransform, loadFlags, jnt1, shapeInstanceState);
    }

    public calc(): void {
        this.model.jointMatrixCalc = this;
        this.model.calcAnim();
    }

    public play(deltaTimeFrames: number): boolean {
        if (this.curMorf < 1.0) {
            this.prevMorf = this.curMorf;
            this.curMorf = this.curMorf + this.morfStepPerFrame * deltaTimeFrames;
        }

        this.frameCtrl.update(deltaTimeFrames);
        return this.frameCtrl.hasStopped();
    }

    public setMorf(morfFrames: number): void {
        if (this.prevMorf < 0.0 || morfFrames <= 0.0) {
            this.curMorf = 1.0;
        } else {
            this.curMorf = 0.0;
            this.morfStepPerFrame = 1.0 / morfFrames;
        }

        this.prevMorf = this.curMorf;
    }

    public setAnm(anm: ANK1 | null, loopMode: LoopMode, morf: number, speedInFrames: number = 1.0, startFrame: number = 0, duration: number = -1): void {
        this.anm = anm;

        if (duration >= 0.0)
            this.frameCtrl.init(duration);
        else if (this.anm !== null)
            this.frameCtrl.init(this.anm.duration);
        else
            this.frameCtrl.init(0);

        if (this.anm !== null && loopMode < 0)
            loopMode = this.anm.loopMode;

        this.frameCtrl.loopMode = loopMode;
        this.frameCtrl.speedInFrames = speedInFrames;

        if (speedInFrames >= 0.0)
            this.frameCtrl.currentTimeInFrames = startFrame;
        else
            this.frameCtrl.currentTimeInFrames = this.frameCtrl.endFrame;

        // this.frameCtrl.loopFrame = this.frameCtrl.currentTime;
        this.setMorf(morf);

        // sound
    }

    public update(): void {
        this.model.jointMatrixCalc = this;
    }

    public entryDL(globals: dGlobals, renderInstManager: GfxRenderInstManager, drawListSet: dDlst_list_Set | null = null): void {
        mDoExt_modelEntryDL(globals, this.model, renderInstManager, drawListSet);
    }
}

export function mDoLib_projectFB(dst: vec3, v: ReadonlyVec3, viewerInput: ViewerRenderInput, clipFromWorldMatrix: ReadonlyMat4 = viewerInput.camera.clipFromWorldMatrix): void {
    vec3.transformMat4(dst, v, clipFromWorldMatrix);
    // Put in viewport framebuffer space.
    dst[0] = (dst[0] * 0.5 + 0.5) * viewerInput.backbufferWidth;
    dst[1] = (dst[1] * 0.5 + 0.5) * viewerInput.backbufferHeight;
    dst[2] = 0.0;
}
