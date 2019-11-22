
import { JMapInfoIter, createCsvParser } from "./JMapInfo";
import { assertExists } from "../util";
import ArrayBufferSlice from "../ArrayBufferSlice";

interface XanimePlayer {
}

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
