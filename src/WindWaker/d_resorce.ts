
import { BMD, BMT, BCK, BPK, BTK, BRK, ANK1, TRK1, TTK1, BVA, VAF1, BTP, TPT1 } from "../Common/JSYSTEM/J3D/J3DLoader";

import * as DZB from './DZB';

import { JKRArchive, RARCFile } from "../Common/JSYSTEM/JKRArchive";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { assert, readString, assertExists } from "../util";
import { J3DModelData, BMDModelMaterialData } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { BTI, BTIData } from "../Common/JSYSTEM/JUTTexture";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { Destroyable } from "../SceneBase";

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
    Model, Bmt, Bck, Bpk, Brk, Btp, Btk, Bti, Dzb, Dzs, Bva,
}

export type ResAssetType<T extends ResType> =
    T extends ResType.Model ? J3DModelData :
    T extends ResType.Bmt ? BMDModelMaterialData :
    T extends ResType.Bck ? ANK1 :
    T extends ResType.Bpk ? TPT1 :
    T extends ResType.Brk ? TRK1 :
    T extends ResType.Btp ? TPT1 :
    T extends ResType.Btk ? TTK1 :
    T extends ResType.Bti ? BTIData :
    T extends ResType.Dzb ? DZB.DZB :
    T extends ResType.Dzs ? DZS :
    T extends ResType.Bva ? VAF1 :
    never;

type OptionalGfx<T extends ResType> = T extends ResType.Bti ? true : false;

export class dRes_control_c {
    public resObj: dRes_info_c[] = [];
    public resStg: dRes_info_c[] = [];

    public findResInfo(arcName: string, resList: dRes_info_c[]): dRes_info_c | null {
        for (let i = 0; i < resList.length; i++)
            if (resList[i].name === arcName)
                return resList[i];
        return null;
    }

    public findResInfoByArchive(archive: JKRArchive, resList: dRes_info_c[]): dRes_info_c | null {
        for (let i = 0; i < resList.length; i++)
            if (resList[i].archive === archive)
                return resList[i];
        return null;
    }

    public getStageResByName<T extends ResType>(resType: T, arcName: string, resName: string): ResAssetType<T> {
        return this.getResByName(resType, arcName, resName, this.resStg);
    }

    public getObjectRes<T extends ResType>(resType: T, arcName: string, resID: number): ResAssetType<T> {
        return this.getResByID(resType, arcName, resID, this.resObj);
    }

    public getResByName<T extends ResType>(resType: T, arcName: string, resName: string, resList: dRes_info_c[]): ResAssetType<T> {
        const resInfo = assertExists(this.findResInfo(arcName, resList));
        return resInfo.getResByName(resType, resName);
    }

    public getResByID<T extends ResType>(resType: T, arcName: string, resID: number, resList: dRes_info_c[]): ResAssetType<T> {
        const resInfo = assertExists(this.findResInfo(arcName, resList));
        return resInfo.getResByID(resType, resID);
    }

    public mountRes(device: GfxDevice, cache: GfxRenderCache, arcName: string, archive: JKRArchive, resList: dRes_info_c[]): void {
        if (this.findResInfo(arcName, resList) !== null)
            return;
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
    public res: ResEntry<any | null>[] = [];
    public destroyables: Destroyable[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, public name: string, public archive: JKRArchive) {
        this.loadResource(device, cache);
    }

    public lazyLoadResource<T extends ResType>(resType: T, resEntry: ResEntry<ResAssetType<T> | null>, device?: GfxDevice, cache?: GfxRenderCache): ResAssetType<T> {
        if (resEntry.res === null) {
            const file = resEntry.file;
            if (resType === ResType.Bpk) {
                resEntry.res = BPK.parse(file.buffer) as ResAssetType<T>;
            } else if (resType === ResType.Brk) {
                resEntry.res = BRK.parse(file.buffer) as ResAssetType<T>;
            } else if (resType === ResType.Btp) {
                resEntry.res = BTP.parse(file.buffer) as ResAssetType<T>;
            } else if (resType === ResType.Btk) {
                resEntry.res = BTK.parse(file.buffer) as ResAssetType<T>;
            } else if (resType === ResType.Bti) {
                const bti = new BTIData(assertExists(device), assertExists(cache), BTI.parse(file.buffer, file.name).texture);
                resEntry.res = bti as ResAssetType<T>;
                this.destroyables.push(bti);
            } else if (resType === ResType.Bva) {
                resEntry.res = BVA.parse(file.buffer) as ResAssetType<T>;
            } else {
                throw "whoops";
            }
        }

        return resEntry.res;
    }

    // there has to be a better way to do this junk lol
    public lazyLoadResourceByID<T extends ResType, G extends OptionalGfx<T>, H extends true>(resType: T, resID: number, device: GfxDevice, cache: GfxRenderCache): ResAssetType<T>;
    public lazyLoadResourceByID<T extends ResType, G extends OptionalGfx<T>, H extends false>(resType: T, resID: number): ResAssetType<T>;
    public lazyLoadResourceByID<T extends ResType>(resType: T, resID: number, device?: GfxDevice, cache?: GfxRenderCache): ResAssetType<T> {
        const resEntry = this.getResEntryByID(resType, resID);
        return this.lazyLoadResource(resType, resEntry, device, cache);
    }

    private getResEntryByID<T extends ResType>(resType: T, resID: number): ResEntry<ResAssetType<T>> {
        const resList: ResEntry<ResAssetType<T>>[] = this.res;
        for (let i = 0; i < resList.length; i++)
            if (resList[i].file.id === resID)
                return resList[i];
        throw "whoops";
    }

    private getResEntryByName<T extends ResType>(resType: T, resName: string): ResEntry<ResAssetType<T>> {
        const resList: ResEntry<ResAssetType<T>>[] = this.res;
        for (let i = 0; i < resList.length; i++)
            if (resList[i].file.name === resName)
                return resList[i];
        throw "whoops";
    }

    public getResByID<T extends ResType>(resType: T, resID: number): ResAssetType<T> {
        return assertExists(this.getResEntryByID(resType, resID).res);
    }

    public getResByName<T extends ResType>(resType: T, resName: string): ResAssetType<T> {
        return assertExists(this.getResEntryByName(resType, resName).res);
    }

    private autoLoadResource(device: GfxDevice, cache: GfxRenderCache, type: string, resEntry: ResEntry<any>): void {
        const file = resEntry.file;
        if (type === `BMD ` || type === `BMDM` || type === `BMDC` || type === `BMDS` || type === `BSMD` ||
            type === `BDL ` || type === `BDLM` || type === `BDLC` || type === `BDLI`) {
            // J3D models.
            const res = new J3DModelData(device, cache, BMD.parse(file.buffer));
            this.destroyables.push(res);
            resEntry.res = res;
        } else if (type === `BMT ` || type === `BMTM`) {
            // J3D material table.
            const res = new BMDModelMaterialData(device, cache, BMT.parse(file.buffer));
            this.destroyables.push(res);
            resEntry.res = res;
        } else if (type === `BCK ` || type === `BCKS`) {
            // TODO(jstpierre): BCKS sound data.
            resEntry.res = BCK.parse(file.buffer);
        } else if (type === `DZB `) {
            resEntry.res = DZB.parse(file.buffer);
        } else if (type === `DZS ` || type === `DZR `) {
            resEntry.res = parseDZSHeaders(file.buffer);
        }
    }

    private loadResource(device: GfxDevice, cache: GfxRenderCache): void {
        for (let i = 0; i < this.archive.files.length; i++) {
            const res = { file: this.archive.files[i], res: null };
            this.res.push(res);
        }

        const root = this.archive!.root;
        for (let i = 0; i < root.subdirs.length; i++) {
            const subdir = root.subdirs[i];
            assert(subdir.subdirs.length === 0);

            for (let j = 0; j < subdir.files.length; j++) {
                const res = this.res.find((res) => res.file === subdir.files[j])!;
                this.autoLoadResource(device, cache, subdir.type, res);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.destroyables.length; i++)
            this.destroyables[i].destroy(device);
    }
}
