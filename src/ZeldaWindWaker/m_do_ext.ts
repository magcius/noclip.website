
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
import { dKy_GxFog_tevstr_set, dKy_setLight__OnMaterialParams, dKy_tevstr_c } from "./d_kankyo.js";
import { Color, colorCopy } from "../Color.js";
import { TDDraw } from "../SuperMarioGalaxy/DDraw.js";
import { ColorKind, DrawParams, GXMaterialHelperGfx, MaterialParams } from "../gx/gx_render.js";
import * as GX from '../gx/gx_enum.js';
import { DisplayListRegisters, displayListRegistersInitGX, displayListRegistersRun } from "../gx/gx_displaylist.js";
import { parseMaterial } from "../gx/gx_material.js";
import { normToLength } from "../MathHelpers.js";

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const materialParams = new MaterialParams();
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
    public texCoords: vec2[] | null = null;
    public positions: vec3[];

    constructor(numSegments: number, hasSize: boolean, hasTex: boolean) {
        this.segments = nArray(numSegments, () => vec3.create());

        if (hasSize)
            this.scales = nArray(numSegments, () => 0.0);

        const numVerts = numSegments * 2;
        this.positions = nArray(numVerts, () => vec3.create());

        if (hasTex) {
            this.texCoords = nArray(numVerts, () => vec2.create());

            for (let i = 0; i < numSegments; i++) {
                this.texCoords[i * 2 + 0][0] = 0.0;
                this.texCoords[i * 2 + 1][0] = 1.0;
            }
        }
    }
}

export interface mDoExt_3DlineMat_c {
    setMaterial(globals: dGlobals): void;
    draw(globals: dGlobals, renderInstManager: GfxRenderInstManager): void;
}

export class mDoExt_3DlineMat1_c implements mDoExt_3DlineMat_c {
    public lines: mDoExt_3Dline_c[];
    private ddraw = new TDDraw();

    private tex: BTIData;
    private color: Color;
    private tevStr: dKy_tevstr_c;
    private numLines: number;
    private maxSegments: number;
    private numSegments: number;
    private material: GXMaterialHelperGfx | null = null;

    public init(numLines: number, numSegments: number, tex: BTIData, hasSize: boolean): void {
        this.numLines = numLines;
        this.maxSegments = numSegments;

        this.lines = nArray(numLines, () => new mDoExt_3Dline_c(numSegments, hasSize, true));
        this.tex = tex;

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.NRM, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
    }

    public setMaterial(globals: dGlobals): void {
        if (!this.material) {
            const dlName = this.tevStr ? `l_toonMat1DL` : `l_mat1DL`;

            // Parse display lists into usable materials
            const dl = globals.findExtraSymbolData(`m_Do_ext.o`, dlName);
            const matRegisters = new DisplayListRegisters();
            displayListRegistersInitGX(matRegisters);
            displayListRegistersRun(matRegisters, dl);
            const material = parseMaterial(matRegisters, `mDoExt_3DlineMat1_c: ${dlName}`);
            material.ropInfo.fogType = GX.FogType.PERSP_LIN;
            material.ropInfo.fogAdjEnabled = true;
            material.hasFogBlock = true;
            this.material = new GXMaterialHelperGfx(material);
        }
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager): void {
        assert(!!this.material);

        dKy_setLight__OnMaterialParams(globals.g_env_light, materialParams, globals.camera);
        dKy_GxFog_tevstr_set(this.tevStr, materialParams.u_FogBlock, globals.camera);

        this.tex.fillTextureMapping(materialParams.m_TextureMapping[0]);
        colorCopy(materialParams.u_Color[ColorKind.C0], this.tevStr.colorC0);
        colorCopy(materialParams.u_Color[ColorKind.C1], this.tevStr.colorK0);
        colorCopy(materialParams.u_Color[ColorKind.C2], this.color);
        mat4.copy(drawParams.u_PosMtx[0], globals.camera.viewFromWorldMatrix);

        this.ddraw.beginDraw(globals.modelCache.cache);
        for (let i = 0; i < this.numLines; i++) {
            const line = this.lines[i];
            this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP, this.numSegments * 2);
            for (let j = 0; j < this.numSegments * 2; j += 2) {
                this.ddraw.position3vec3(line.positions[j + 0]);
                this.ddraw.texCoord2vec2(GX.Attr.TEX0, line.texCoords![j + 0]);
                this.ddraw.normal3f32(0.25, 0.0, 0.0);

                this.ddraw.position3vec3(line.positions[j + 1]);
                this.ddraw.texCoord2vec2(GX.Attr.TEX0, line.texCoords![j + 1]);
                this.ddraw.normal3f32(-0.25, 0.0, 0.0);
            }
            this.ddraw.end();
        }
        this.ddraw.endDraw(renderInstManager);

        const renderInst = this.ddraw.makeRenderInst(renderInstManager);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        this.material.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        this.material.allocateDrawParamsDataOnInst(renderInst, drawParams);
        this.material.setOnRenderInst(renderInstManager.gfxRenderCache, renderInst);

        renderInstManager.submitRenderInst(renderInst);
    }

    public updateWithScale(globals: dGlobals, segmentCount: number, width: number, color: Color, taperNum: number, tevStr: dKy_tevstr_c): void {
        this.color = color;
        this.tevStr = tevStr;
        this.numSegments = Math.min(segmentCount, this.maxSegments);
        const taperStartIdx = this.numSegments - taperNum;

        let dist = 0.0;
        for (let i = 0; i < this.numLines; i++) {
            const line = this.lines[i];
            let vertIdx = 0;
            assert(!!line.texCoords);

            for (let j = 0; j < this.numSegments; j++) {
                const taperScale = taperNum > 0 ? (Math.max(j - taperStartIdx, 0) / taperNum) : 1.0;

                if (j < this.numSegments - 1)
                    vec3.sub(scratchVec3a, line.segments[j + 1], line.segments[j + 0]);

                vec3.sub(scratchVec3b, line.segments[j + 0], globals.camera.cameraPos);
                vec3.cross(scratchVec3b, scratchVec3a, scratchVec3b);
                normToLength(scratchVec3b, width * taperScale);

                vec3.add(line.positions[vertIdx + 0], line.segments[j], scratchVec3b);
                vec3.sub(line.positions[vertIdx + 1], line.segments[j], scratchVec3b);

                line.texCoords[vertIdx + 0][1] = dist;
                line.texCoords[vertIdx + 1][1] = dist;

                vertIdx += 2;

                const delta = vec3.length(scratchVec3a);
                dist += delta * 0.1;
            }
        }
    }
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
