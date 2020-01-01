
import { BMD, BMT, BCK, BPK, BTK, BRK, ANK1, TRK1, TTK1, BVA, VAF1 } from "../Common/JSYSTEM/J3D/J3DLoader";

import * as DZB from './DZB';

import { JKRArchive, RARCFile } from "../Common/JSYSTEM/JKRArchive";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { assert, readString, assertExists } from "../util";
import { J3DModelData, BMDModelMaterialData } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { BTI, BTIData } from "../Common/JSYSTEM/JUTTexture";
import ArrayBufferSlice from "../ArrayBufferSlice";

interface DZSChunkHeader {
    type: string;
    count: number;
    offs: number;
}

export interface DZS {
    headers: Map<string, DZSChunkHeader>;
    buffer: ArrayBufferSlice;
}

function parseDZSHeaders(buffer: ArrayBufferSlice): DZS {
    const view = buffer.createDataView();
    const chunkCount = view.getUint32(0x00);

    const chunkHeaders = new Map<string, DZSChunkHeader>();
    let chunkTableIdx = 0x04;
    for (let i = 0; i < chunkCount; i++) {
        const type = readString(buffer, chunkTableIdx + 0x00, 0x04);
        const numEntries = view.getUint32(chunkTableIdx + 0x04);
        const offs = view.getUint32(chunkTableIdx + 0x08);
        chunkHeaders.set(type, { type, count: numEntries, offs });
        chunkTableIdx += 0x0C;
    }

    return { headers: chunkHeaders, buffer };
}

export const enum ResType {
    Model, Bmt, Bck, Bpk, Brk, Btk, Bti, Dzb, Dzs, Bva,
}

export class dRes_control_c {
    public resObj: dRes_info_c[] = [];
    public resStg: dRes_info_c[] = [];

    public findResInfo(arcName: string, resList: dRes_info_c[]): dRes_info_c | null {
        for (let i = 0; i < resList.length; i++)
            if (resList[i].name === arcName)
                return resList[i];
        return null;
    }

    public getStageResByName<T>(resType: ResType, arcName: string, resName: string): T {
        return this.getResByName(resType, arcName, resName, this.resStg);
    }

    public getObjectRes<T>(resType: ResType, arcName: string, resID: number): T {
        return this.getResByID(resType, arcName, resID, this.resObj);
    }

    public getResByName<T>(resType: ResType, arcName: string, resName: string, resList: dRes_info_c[]): T {
        const resInfo = assertExists(this.findResInfo(arcName, resList));
        return resInfo.getResByName(resType, resName);
    }

    public getResByID<T>(resType: ResType, arcName: string, resID: number, resList: dRes_info_c[]): T {
        const resInfo = assertExists(this.findResInfo(arcName, resList));
        return resInfo.getResByID(resType, resID);
    }

    public mountRes(device: GfxDevice, cache: GfxRenderCache, arcName: string, archive: JKRArchive, resList: dRes_info_c[]): void {
        resList.push(new dRes_info_c(device, cache, arcName, archive));
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.resObj.length; i++)
            this.resObj[i].destroy(device);
        for (let i = 0; i < this.resStg.length; i++)
            this.resStg[i].destroy(device);
    }

    public destroyList(device: GfxDevice, resList: dRes_info_c[]): void {
        for (let i = 0; i < resList.length; i++)
            resList[i].destroy(device);
        resList.length = 0;
    }
}

interface ResEntry<T> {
    file: RARCFile;
    res: T;
}

// A dRes_info_c represents a single archive. The original game modifies the buffer
// contents into J3DModelData, etc. classes, but we can't do that here since we have
// to load our data into the GPU, sometimes.
export class dRes_info_c {
    public resModel: ResEntry<J3DModelData>[] = [];
    public resBmt: ResEntry<BMDModelMaterialData>[] = [];
    public resBck: ResEntry<ANK1>[] = [];
    public resBpk: ResEntry<TRK1>[] = [];
    public resBrk: ResEntry<TRK1>[] = [];
    public resBtk: ResEntry<TTK1>[] = [];
    public resBti: ResEntry<BTIData>[] = [];
    public resDzb: ResEntry<DZB.DZB>[] = [];
    public resDzs: ResEntry<DZS>[] = [];
    public resBva: ResEntry<VAF1>[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, public name: string, public archive: JKRArchive) {
        this.loadResource(device, cache);
    }

    private getResList<T>(resType: ResType): ResEntry<T>[] {
        if (resType === ResType.Model)
            return this.resModel as unknown as ResEntry<T>[];
        if (resType === ResType.Bmt)
            return this.resBmt as unknown as ResEntry<T>[];
        if (resType === ResType.Bck)
            return this.resBck as unknown as ResEntry<T>[];
        if (resType === ResType.Bpk)
            return this.resBpk as unknown as ResEntry<T>[];
        if (resType === ResType.Brk)
            return this.resBrk as unknown as ResEntry<T>[];
        if (resType === ResType.Btk)
            return this.resBtk as unknown as ResEntry<T>[];
        if (resType === ResType.Bti)
            return this.resBti as unknown as ResEntry<T>[];
        if (resType === ResType.Dzb)
            return this.resDzb as unknown as ResEntry<T>[];
        if (resType === ResType.Dzs)
            return this.resDzs as unknown as ResEntry<T>[];
        if (resType === ResType.Bva)
            return this.resBva as unknown as ResEntry<T>[];
        else
            throw "whoops";
    }

    public getResByIDFromList<T>(resList: ResEntry<T>[], resID: number): T {
        for (let i = 0; i < resList.length; i++)
            if (resList[i].file.id === resID)
                return resList[i].res;
        throw "whoops";
    }

    public getResByNameFromList<T>(resList: ResEntry<T>[], resName: string): T {
        for (let i = 0; i < resList.length; i++)
            if (resList[i].file.name === resName)
                return resList[i].res;
        throw "whoops";
    }

    public getResByID<T>(resType: ResType, resID: number): T {
        return this.getResByIDFromList(this.getResList(resType), resID);
    }

    public getResByName<T>(resType: ResType, resName: string): T {
        return this.getResByNameFromList(this.getResList(resType), resName);
    }

    private pushRes<T>(resList: ResEntry<T>[], file: RARCFile, res: T): T {
        resList.push({ file, res });
        return res;
    }

    private loadResourceOfType(device: GfxDevice, cache: GfxRenderCache, type: string, file: RARCFile): any {
        if (type === `BMD ` || type === `BMDM` || type === `BMDC` || type === `BMDS` || type === `BSMD` ||
            type === `BDL ` || type === `BDLM` || type === `BDLC` || type === `BDLI`) {
            // J3D models.
            const res = new J3DModelData(device, cache, BMD.parse(file.buffer));
            return this.pushRes(this.resModel, file, res);
        } else if (type === `BMT `) {
            // J3D material table.
            const res = new BMDModelMaterialData(device, cache, BMT.parse(file.buffer));
            return this.pushRes(this.resBmt, file, res);
        } else if (type === `BCK ` || type === `BCKS`) {
            // TODO(jstpierre): BCKS sound data.
            const res = BCK.parse(file.buffer);
            return this.pushRes(this.resBck, file, res);
        } else if (type === `BPK `) {
            const res = BPK.parse(file.buffer);
            return this.pushRes(this.resBpk, file, res);
        } else if (type === `BRK `) {
            const res = BRK.parse(file.buffer);
            return this.pushRes(this.resBrk, file, res);
        } else if (type === `BTP `) {
            const res = BTK.parse(file.buffer);
            return this.pushRes(this.resBtk, file, res);
        } else if (type === `BTK `) {
            const res = BTK.parse(file.buffer);
            return this.pushRes(this.resBtk, file, res);
        } else if (type === `TEX `) {
            const res = new BTIData(device, cache, BTI.parse(file.buffer, file.name).texture);
            return this.pushRes(this.resBti, file, res);
        } else if (type === `DZB `) {
            const res = DZB.parse(file.buffer);
            return this.pushRes(this.resDzb, file, res);
        } else if (type === `DZS ` || type === `DZR `) {
            const res = parseDZSHeaders(file.buffer);
            return this.pushRes(this.resDzs, file, res);
        } else if (type === `BVA `) {
            const res = BVA.parse(file.buffer);
            return this.pushRes(this.resBva, file, res);
        } else if (type === `BAS `) {
            // Known; anim sound data, can't handle.
        } else if (type === `MSG `) {
            // Known; MESG data, can't handle.
        } else if (type === `STB `) {
            // Known; JStudio Binary, can't handle.
        } else if (type === `DAT `) {
            // Known; Misc data, cant' handle.
        } else {
            console.warn(`Unsupported resource type: ${type} / ${file.name}`);
            debugger;
        }
    }

    private loadResource(device: GfxDevice, cache: GfxRenderCache): void {
        const root = this.archive!.root;
        for (let i = 0; i < root.subdirs.length; i++) {
            const resourceType = root.subdirs[i];
            assert(resourceType.subdirs.length === 0);

            for (let j = 0; j < resourceType.files.length; j++)
                this.loadResourceOfType(device, cache, resourceType.type, resourceType.files[j]);
        }
    }

    public forceLoadResource<T>(device: GfxDevice, cache: GfxRenderCache, type: string, resID: number): T {
        const file = assertExists(this.archive.files.find((file) => file.id === resID));
        return this.loadResourceOfType(device, cache, type, file);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.resModel.length; i++)
            this.resModel[i].res.destroy(device);
        for (let i = 0; i < this.resBmt.length; i++)
            this.resBmt[i].res.destroy(device);
        for (let i = 0; i < this.resBti.length; i++)
            this.resBti[i].res.destroy(device);
    }
}
