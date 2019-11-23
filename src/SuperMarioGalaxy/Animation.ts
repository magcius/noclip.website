
import { mat4 } from "gl-matrix";

import { assertExists, nullify } from "../util";
import { computeModelMatrixSRT } from "../MathHelpers";
import ArrayBufferSlice from "../ArrayBufferSlice";

import { J3DModelInstance } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { AnimationBase, VAF1, TRK1, TTK1, TPT1, ANK1, Joint, sampleAnimationData } from "../Common/JSYSTEM/J3D/J3DLoader";
import { J3DFrameCtrl, VAF1_getVisibility, entryTexRegAnimator, removeTexRegAnimator, entryTexMtxAnimator, removeTexMtxAnimator, entryTexNoAnimator, removeTexNoAnimator } from "../Common/JSYSTEM/J3D/J3DGraphAnimator";

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
            if (this.bckCtrlDatas[i].Name === bckName)
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

export class XanimeCore {
    constructor(public frameCtrl: J3DFrameCtrl, public ank1: ANK1) {
    }

    public calcJointMatrix(dst: mat4, i: number, jnt1: Joint): void {
        const animFrame = this.frameCtrl.currentTimeInFrames;
        const entry = this.ank1.jointAnimationEntries[i];

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
    }
}

export class XanimePlayer extends AnmPlayerBase<ANK1> {
    constructor(public resTable: ResTable<ANK1>, private modelInstance: J3DModelInstance) {
        super(resTable);
    }

    public startAnimation(): void {
        this.modelInstance.jointMatrixCalc = new XanimeCore(this.frameCtrl, this.currentRes!);
    }

    public stopAnimation(): void {
        // this.modelInstance.jointMatrixCalc = new XanimeCore(this.frameCtrl, this.currentRes!);
    }

    public changeSpeed(v: number): void {
        this.frameCtrl.speedInFrames = v;
    }

    public changeInterpoleFrame(v: number): void {
        // this.frameCtrl.interpole = v;
    }
}

export class BtkPlayer extends AnmPlayerBase<TTK1> {
    constructor(public resTable: ResTable<TTK1>, private modelInstance: J3DModelInstance) {
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
    constructor(public resTable: ResTable<TRK1>, private modelInstance: J3DModelInstance) {
        super(resTable);
    }

    public startAnimation(): void {
        entryTexRegAnimator(this.modelInstance, this.currentRes!, this.frameCtrl);
    }

    public stopAnimation(): void {
        removeTexRegAnimator(this.modelInstance, this.currentRes!);
    }
}

export class BtpPlayer extends AnmPlayerBase<TPT1> {
    constructor(public resTable: ResTable<TPT1>, private modelInstance: J3DModelInstance) {
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
    constructor(public resTable: ResTable<VAF1>, private modelInstance: J3DModelInstance) {
        super(resTable);
    }

    public calc(): void {
        if (this.currentRes !== null) {
            for (let i = 0; i < this.modelInstance.shapeInstances.length; i++)
                this.modelInstance.shapeInstances[i].visible = VAF1_getVisibility(this.currentRes, i, this.frameCtrl.currentTimeInFrames);
        }
    }
}
