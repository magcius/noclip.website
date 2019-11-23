
import { JMapInfoIter, createCsvParser } from "./JMapInfo";
import { assertExists, nullify } from "../util";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { J3DFrameCtrl, VAF1_getVisibility, entryTexRegAnimator, removeTexRegAnimator, entryTexMtxAnimator, removeTexMtxAnimator, entryTexNoAnimator, removeTexNoAnimator } from "../Common/JSYSTEM/J3D/J3DGraphAnimator";
import { AnimationBase, VAF1, TRK1, TTK1, TPT1, ANK1, ANK1Animator } from "../Common/JSYSTEM/J3D/J3DLoader";
import { ResTable } from "./Main";
import { J3DModelInstance } from "../Common/JSYSTEM/J3D/J3DGraphBase";

export class BckCtrlData {
    public Name: string = '';
    public PlayFrame = -1;
    public StartFrame = -1;
    public EndFrame = -1;
    public Interpole = -1;
    public Attribute = -1;

    public setFromAnmt(infoIter: JMapInfoIter): void {
        this.Name = assertExists(infoIter.getValueString(`name`));
        this.PlayFrame = assertExists(infoIter.getValueNumber('play_frame'));
        this.StartFrame = assertExists(infoIter.getValueNumber('start_frame'));
        this.EndFrame = assertExists(infoIter.getValueNumber('end_frame'));
        this.Interpole = assertExists(infoIter.getValueNumber('interpole'));
        this.Attribute = assertExists(infoIter.getValueNumber('attribute'));
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
        if (bckCtrlData !== null)
            reflectBckCtrlData(bckCtrlData, xanimePlayer);
        else
            reflectBckCtrlData(this.defaultBckCtrlData, xanimePlayer);
    }
}

function reflectBckCtrlData(bckCtrlData: BckCtrlData, xanimePlayer: XanimePlayer): void {
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

export class XanimePlayer extends AnmPlayerBase<ANK1> {
    constructor(public resTable: ResTable<ANK1>, private modelInstance: J3DModelInstance) {
        super(resTable);
    }

    public startAnimation(): void {
        this.modelInstance.bindANK1(this.currentRes!);
    }

    public stopAnimation(): void {
        this.modelInstance.bindANK1(null);
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
