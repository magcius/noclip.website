import { DataFetcher } from '../DataFetcher';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import ArrayBufferSlice from '../ArrayBufferSlice';

import { GameInfo } from './scenes';
import { Model, ModelCollection } from './models';
import { SFATextureCollection } from './textures';
import { loadRes } from './resource';
import { createDownloadLink } from './util';

function dataSubarray(data: DataView, byteOffset: number, byteLength?: number): DataView {
    return new DataView(data.buffer, data.byteOffset + byteOffset, byteLength);
}

class SFAObject {
    public name: string;
    public objClass: number;
    public models: Model[] = [];

    constructor(public objType: number, private data: DataView, private isEarlyObject: boolean) {
        this.name = '';
        this.objClass = data.getInt16(0x50); // FIXME: where is this field for early objects?
        let offs = isEarlyObject ? 0x58 : 0x91;
        let c;
        while ((c = data.getUint8(offs)) != 0) {
            this.name += String.fromCharCode(c);
            offs++;
        }
    }

    public async create(device: GfxDevice, modelColl: ModelCollection) {
        const data = this.data;

        const numModels = data.getUint8(0x55);
        const modelListOffs = data.getUint32(0x8);
        for (let i = 0; i < numModels; i++) {
            const modelNum = data.getUint32(modelListOffs + i * 4);
            const model = modelColl.loadModel(device, modelNum);
            this.models.push(model);
        }
    }
}

export class ObjectManager {
    private objectsTab: DataView;
    private objectsBin: DataView;
    private objindexBin: DataView | null;
    private modelColl: ModelCollection;

    constructor(private gameInfo: GameInfo, private texColl: SFATextureCollection, private useEarlyObjects: boolean) {
    }

    public async create(dataFetcher: DataFetcher, subdir: string) {
        const pathBase = this.gameInfo.pathBase;
        this.modelColl = new ModelCollection(this.texColl, this.gameInfo);
        const [objectsTab, objectsBin, objindexBin, _] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/OBJECTS.tab`),
            dataFetcher.fetchData(`${pathBase}/OBJECTS.bin`),
            !this.useEarlyObjects ? dataFetcher.fetchData(`${pathBase}/OBJINDEX.bin`) : null,
            this.modelColl.create(dataFetcher, subdir),
        ]);
        this.objectsTab = objectsTab.createDataView();
        this.objectsBin = objectsBin.createDataView();
        this.objindexBin = !this.useEarlyObjects ? objindexBin!.createDataView() : null;
    }

    public async loadObject(device: GfxDevice, objType: number, skipObjindex: boolean = false): Promise<SFAObject> {
        if (!this.useEarlyObjects && !skipObjindex) {
            objType = this.objindexBin!.getUint16(objType * 2);
        }
        const offs = this.objectsTab.getUint32(objType * 4);
        const obj = new SFAObject(objType, dataSubarray(this.objectsBin, offs), this.useEarlyObjects);
        await obj.create(device, this.modelColl);
        return obj;
    }
}