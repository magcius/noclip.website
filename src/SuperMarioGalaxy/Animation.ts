
import { mat4, vec3, quat } from "gl-matrix";

import { assertExists, nullify, assert, nArray } from "../util";
import { quatFromEulerRadians } from "../MathHelpers";
import ArrayBufferSlice from "../ArrayBufferSlice";

import { J3DModelInstance, J3DModelData } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { AnimationBase, VAF1, TRK1, TTK1, TPT1, ANK1, Joint, sampleAnimationData, LoopMode, JNT1 } from "../Common/JSYSTEM/J3D/J3DLoader";
import { J3DFrameCtrl, VAF1_getVisibility, entryTevRegAnimator, removeTevRegAnimator, entryTexMtxAnimator, removeTexMtxAnimator, entryTexNoAnimator, removeTexNoAnimator } from "../Common/JSYSTEM/J3D/J3DGraphAnimator";

import { JMapInfoIter, createCsvParser } from "./JMapInfo";
import { ResTable } from "./Main";

export class BckCtrlData {
    public Name: string = '';
    public PlayFrame = -1;
    public StartFrame = -1;
    public EndFrame = -1;
    public RepeatFrame = -1;
    public Interpole = -1;
    public Attribute = 0xFF;

    public setFromAnmt(infoIter: JMapInfoIter): void {
        this.Name = assertExists(infoIter.getValueString(`name`));
        this.PlayFrame = assertExists(infoIter.getValueNumber('play_frame'));
        this.StartFrame = assertExists(infoIter.getValueNumber('start_frame'));
        this.EndFrame = assertExists(infoIter.getValueNumber('end_frame'));
        this.Interpole = assertExists(infoIter.getValueNumber('interpole'));
        const attribute = assertExists(infoIter.getValueNumber('attribute'));
        if (attribute > -1)
            this.Attribute = attribute;
    }
}

export class BckCtrl {
    private defaultBckCtrlData = new BckCtrlData();
    private bckCtrlDatas: BckCtrlData[] = [];

    public static parse(buffer: ArrayBufferSlice): BckCtrl {
        const ctrl = new BckCtrl();
        ctrl.setFromAnmt(createCsvParser(buffer));
        return ctrl;
    }

    public setFromAnmt(infoIter: JMapInfoIter): void {
        infoIter.mapRecords((jmp, i) => {
            const name = assertExists(jmp.getValueString('name'));

            let ctrlData: BckCtrlData;
            if (name === '_default') {
                ctrlData = this.defaultBckCtrlData;
            } else {
                ctrlData = new BckCtrlData();
                this.bckCtrlDatas.push(ctrlData);
            }

            ctrlData.setFromAnmt(jmp);
        });
    }

    private find(bckName: string): BckCtrlData | null {
        for (let i = 0; i < this.bckCtrlDatas.length; i++)
            if (this.bckCtrlDatas[i].Name.toLowerCase() === bckName.toLowerCase())
                return this.bckCtrlDatas[i];
        return null;
    }

    public changeBckSetting(bckName: string, xanimePlayer: XanimePlayer): void {
        const bckCtrlData = this.find(bckName);
        if (bckCtrlData !== null) {
            if (bckCtrlData.Interpole > -1 || bckCtrlData.PlayFrame > -1 || bckCtrlData.StartFrame > -1 ||
                bckCtrlData.EndFrame > -1 || bckCtrlData.RepeatFrame > -1 || bckCtrlData.Attribute !== 0xFF) {
                reflectBckCtrlData(bckCtrlData, xanimePlayer);
                return;
            }
        }

        reflectBckCtrlData(this.defaultBckCtrlData, xanimePlayer);
    }
}

function reflectBckCtrlData(bckCtrlData: BckCtrlData, xanimePlayer: XanimePlayer): void {
    const frameCtrl = xanimePlayer.frameCtrl;

    if (bckCtrlData.StartFrame > -1 && bckCtrlData.StartFrame < frameCtrl.endFrame) {
        frameCtrl.startFrame = bckCtrlData.StartFrame;
        frameCtrl.currentTimeInFrames = bckCtrlData.StartFrame;
        frameCtrl.repeatStartFrame = bckCtrlData.StartFrame;
    }

    if (bckCtrlData.EndFrame > -1 && bckCtrlData.EndFrame < frameCtrl.endFrame) {
        frameCtrl.endFrame = bckCtrlData.EndFrame;
    }

    if (bckCtrlData.RepeatFrame > -1 && bckCtrlData.RepeatFrame < frameCtrl.endFrame) {
        frameCtrl.repeatStartFrame = bckCtrlData.RepeatFrame;
    }

    if (bckCtrlData.PlayFrame > -1) {
        const speed = bckCtrlData.PlayFrame !== 0 ? (frameCtrl.endFrame - frameCtrl.startFrame) / bckCtrlData.PlayFrame : 0;
        xanimePlayer.changeSpeed(speed);
    }

    if (bckCtrlData.Interpole > -1) {
        xanimePlayer.changeInterpoleFrame(bckCtrlData.Interpole);
    }

    if (bckCtrlData.Attribute !== 0xFF) {
        frameCtrl.loopMode = bckCtrlData.Attribute;
    }
}

export function getRes<T>(table: ResTable<T>, name: string): T | null {
    return nullify(table.get(name.toLowerCase()));
}

export abstract class AnmPlayerBase<T extends AnimationBase> {
    public frameCtrl = new J3DFrameCtrl(0);
    public currentRes: T | null = null;
    private currentResName: string | null = null;

    constructor(public resTable: ResTable<T>) {
    }

    protected startAnimation(): void {
        // Do nothing.
    }

    protected stopAnimation(): void {
        // Do nothing.
    }

    public start(name: string): void {
        const res = assertExists(getRes(this.resTable, name));
        if (this.currentRes !== res) {
            this.currentRes = res;
            this.currentResName = name.toLowerCase();
            this.startAnimation();
        }

        this.frameCtrl.init(this.currentRes.duration);
        this.frameCtrl.loopMode = this.currentRes.loopMode;
    }

    public stop(): void {
        this.stopAnimation();
        this.frameCtrl.speedInFrames = 0;
    }

    public update(deltaTimeFrame: number): void {
        if (this.currentRes !== null)
            this.frameCtrl.update(deltaTimeFrame);
    }

    public isPlaying(name: string): boolean {
        return this.currentResName === name;
    }
}

class XjointTransform {
    public scale = vec3.create();
    public translation = vec3.create();
    public rotation = quat.create();

    public copy(other: XjointTransform): void {
        vec3.copy(this.scale, other.scale);
        vec3.copy(this.translation, other.translation);
        quat.copy(this.rotation, other.rotation);
    }
}

class XjointInfo {
    public xformFrozen = new XjointTransform();
    public xformAnm = new XjointTransform();
}

export class XanimeFrameCtrl extends J3DFrameCtrl {
    public interpoleFrame: number = 0.0;
}

// We only emulate simple mode, which contains one track.
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchQuat = quat.create();
export class XanimeCore {
    public curAnmTime = 0.0;
    public interpoleRatio = 0.0;
    public freeze: boolean = false;
    public resetJointXform: boolean = false;
    private ank1: ANK1 | null = null;
    private joints: XjointInfo[];

    constructor(jointCount: number) {
        this.joints = nArray(jointCount, () => new XjointInfo());
    }

    public initT(modelData: J3DModelData): void {
        const jnt1 = modelData.bmd.jnt1.joints;

        for (let i = 0; i < jnt1.length; i++) {
            const src = jnt1[i];
            const dst = this.joints[i];

            vec3.set(dst.xformFrozen.translation, src.translationX, src.translationY, src.translationZ);
            vec3.set(dst.xformFrozen.scale, src.scaleX, src.scaleY, src.scaleZ);
            quatFromEulerRadians(dst.xformFrozen.rotation, src.rotationX, src.rotationY, src.rotationZ);

            dst.xformAnm.copy(dst.xformFrozen);
        }
    }

    public doFreeze(): void {
        this.freeze = true;
    }

    public updateFrame(): void {
        this.resetJointXform = this.freeze;
        this.freeze = false;
    }

    public setBck(track: number, ank1: ANK1): void {
        assert(track === 0);
        this.ank1 = ank1;
    }

    public calcSingle(i: number): void {
        const xj = this.joints[i];

        if (this.ank1 !== null) {
            const entry = this.ank1.jointAnimationEntries[i];
            const animFrame = this.curAnmTime * this.ank1.duration;
            const scaleX = sampleAnimationData(entry.scaleX, animFrame);
            const scaleY = sampleAnimationData(entry.scaleY, animFrame);
            const scaleZ = sampleAnimationData(entry.scaleZ, animFrame);
            const rotationX = sampleAnimationData(entry.rotationX, animFrame) * Math.PI;
            const rotationY = sampleAnimationData(entry.rotationY, animFrame) * Math.PI;
            const rotationZ = sampleAnimationData(entry.rotationZ, animFrame) * Math.PI;
            const translationX = sampleAnimationData(entry.translationX, animFrame);
            const translationY = sampleAnimationData(entry.translationY, animFrame);
            const translationZ = sampleAnimationData(entry.translationZ, animFrame);

            const anmScale = scratchVec3a;
            const anmTrans = scratchVec3b;
            const anmRot = scratchQuat;
            vec3.set(anmScale, scaleX, scaleY, scaleZ);
            vec3.set(anmTrans, translationX, translationY, translationZ);
            quatFromEulerRadians(anmRot, rotationX, rotationY, rotationZ);

            if (this.resetJointXform)
                xj.xformFrozen.copy(xj.xformAnm);

            if (this.interpoleRatio < 1.0) {
                vec3.lerp(anmScale, xj.xformFrozen.scale, anmScale, this.interpoleRatio);
                vec3.lerp(anmTrans, xj.xformFrozen.translation, anmTrans, this.interpoleRatio);
                quat.lerp(anmRot, xj.xformFrozen.rotation, scratchQuat, this.interpoleRatio);
            }

            vec3.copy(xj.xformAnm.scale, anmScale);
            vec3.copy(xj.xformAnm.translation, anmTrans);
            quat.copy(xj.xformAnm.rotation, anmRot);
        }
    }

    public calcJointMatrix(dst: mat4, i: number, jnt1: Joint): void {
        this.calcSingle(i);

        const xj = this.joints[i];
        mat4.fromRotationTranslationScale(dst, xj.xformAnm.rotation, xj.xformAnm.translation, xj.xformAnm.scale);
    }
}

export class XanimePlayer {
    public frameCtrl = new XanimeFrameCtrl(0);
    public currentRes: ANK1 | null = null;
    private currentResName: string | null = null;
    private core: XanimeCore;
    private interpoleRatio: number = 0.0;
    private interpoleFrameCounter: number = 0.0;
    private updatedFrameCtrl: boolean = false;
    private oldTimeInFrames: number = 0.0;
    private oldSpeedInFrames: number = 0.0;

    constructor(public resTable: ResTable<ANK1>, private modelInstance: J3DModelInstance) {
        this.core = new XanimeCore(this.modelInstance.modelData.bmd.jnt1.joints.length);
        this.core.initT(this.modelInstance.modelData);
    }

    public isRun(name: string): boolean {
        return this.currentResName === name;
    }

    public isTerminate(name: string): boolean {
        if (this.currentResName === name)
            return this.frameCtrl.speedInFrames === 0.0;
        else
            return true;
    }

    public getCurrentBckName(): string | null {
        return this.currentResName;
    }

    public changeAnimationBck(name: string): void {
        const res = getRes(this.resTable, name);
        if (res !== null) {
            this.changeAnimationSimple(res);
            this.currentRes = res;
            this.currentResName = name;
        } else {
            this.currentResName = null;
        }
    }

    private changeAnimationSimple(res: ANK1): void {
        this.core.doFreeze();
        this.core.setBck(0, res);

        this.frameCtrl.init(res.duration);
        this.frameCtrl.loopMode = res.loopMode;
        this.frameCtrl.interpoleFrame = 1;
        this.interpoleRatio = 0.0;
    }

    public calcAnm(): void {
        if (this.currentRes !== null) {
            const duration = this.currentRes.duration !== 0 ? this.currentRes.duration : 1;
            const currentTimeInFrames = this.updatedFrameCtrl ? this.oldTimeInFrames : this.frameCtrl.currentTimeInFrames;
            this.core.curAnmTime = currentTimeInFrames / duration;
        }

        this.core.updateFrame();
        this.modelInstance.jointMatrixCalc = this.core;
        this.updatedFrameCtrl = false;
    }

    public clearAnm(): void {
        // We should only temporarily insert the mtx calc on the joint, but we would
        // have to separate out the matrix calc systems per-joint, and I don't see a
        // reason to do that, so I just don't...
    }

    public stop(): void {
        this.frameCtrl.speedInFrames = 0;
    }

    private updateInterpoleRatio(deltaTimeFrames: number = 1): void {
        const frameCtrl = this.frameCtrl;
        if (frameCtrl.speedInFrames === 0.0 && frameCtrl.loopMode !== LoopMode.ONCE_AND_RESET) {
            this.interpoleRatio = 1.0;
            frameCtrl.interpoleFrame = 0;
        } else if (this.interpoleFrameCounter >= frameCtrl.interpoleFrame) {
            this.interpoleRatio = 1.0;
            frameCtrl.interpoleFrame = 0;
        } else {
            // The actual game code does this, which is an exponential slide but with a decreasing k factor.
            // We use a lerp instead since it works better with deltaTimeFrames-style.

            // this.interpoleRatio += (1.0 - this.interpoleRatio) / frameCtrl.interpoleFrame;
            // frameCtrl.interpoleFrame = Math.max(frameCtrl.interpoleFrame - deltaTimeFrames, 0);

            this.interpoleFrameCounter += deltaTimeFrames;
            this.interpoleRatio = this.interpoleFrameCounter / Math.max(frameCtrl.interpoleFrame, 1);
        }
    }

    public update(deltaTimeFrames: number): void {
        if (this.currentRes !== null) {
            this.oldTimeInFrames = this.frameCtrl.currentTimeInFrames;
            this.oldSpeedInFrames = this.frameCtrl.speedInFrames;
            this.frameCtrl.update(deltaTimeFrames);
            this.updatedFrameCtrl = true;

            this.updateInterpoleRatio(deltaTimeFrames);
            this.core.interpoleRatio = this.interpoleRatio;
        }
    }

    public changeSpeed(v: number): void {
        this.frameCtrl.speedInFrames = v;
    }

    public changeInterpoleFrame(v: number): void {
        this.frameCtrl.interpoleFrame = v;
        this.interpoleFrameCounter = 0;

        if (v === 0) {
            this.interpoleRatio = 1.0;
            this.core.interpoleRatio = 1.0;
        } else {
            this.interpoleRatio = 0.0;
            this.core.interpoleRatio = 0.0;
            this.updateInterpoleRatio(1.0);
        }
    }

    public checkPass(frame: number, deltaTimeFrames: number): boolean {
        if (this.updatedFrameCtrl) {
            return this.frameCtrl.checkPass(frame, deltaTimeFrames, this.oldTimeInFrames, this.oldSpeedInFrames);
        } else {
            return this.frameCtrl.checkPass(frame, deltaTimeFrames);
        }
    }
}

export class BtkPlayer extends AnmPlayerBase<TTK1> {
    constructor(resTable: ResTable<TTK1>, private modelInstance: J3DModelInstance) {
        super(resTable);
    }

    public startAnimation(): void {
        entryTexMtxAnimator(this.modelInstance, this.currentRes!, this.frameCtrl);
    }

    public stopAnimation(): void {
        removeTexMtxAnimator(this.modelInstance, this.currentRes!);
    }
}

export class BrkPlayer extends AnmPlayerBase<TRK1> {
    constructor(resTable: ResTable<TRK1>, private modelInstance: J3DModelInstance) {
        super(resTable);
    }

    public startAnimation(): void {
        entryTevRegAnimator(this.modelInstance, this.currentRes!, this.frameCtrl);
    }

    public stopAnimation(): void {
        removeTevRegAnimator(this.modelInstance, this.currentRes!);
    }
}

export class BtpPlayer extends AnmPlayerBase<TPT1> {
    constructor(resTable: ResTable<TPT1>, private modelInstance: J3DModelInstance) {
        super(resTable);
    }

    public startAnimation(): void {
        entryTexNoAnimator(this.modelInstance, this.currentRes!, this.frameCtrl);
    }

    public stopAnimation(): void {
        removeTexNoAnimator(this.modelInstance, this.currentRes!);
    }
}

export class BvaPlayer extends AnmPlayerBase<VAF1> {
    constructor(resTable: ResTable<VAF1>, private modelInstance: J3DModelInstance) {
        super(resTable);
    }

    public calc(): void {
        if (this.currentRes !== null) {
            for (let i = 0; i < this.modelInstance.shapeInstances.length; i++)
                this.modelInstance.shapeInstances[i].visible = VAF1_getVisibility(this.currentRes, i, this.frameCtrl.currentTimeInFrames);
        }
    }
}
