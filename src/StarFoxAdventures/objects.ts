import { DataFetcher } from '../DataFetcher';

import { GameInfo } from './scenes';

function dataSubarray(data: DataView, byteOffset: number, byteLength?: number): DataView {
    return new DataView(data.buffer, data.byteOffset + byteOffset, byteLength);
}

class SFAObject {
    public name: string;
    public objClass: number;

    constructor(public objType: number, data: DataView) {
        this.name = '';
        this.objClass = data.getInt16(0x50);
        let offs = 0x91;
        let c;
        while ((c = data.getUint8(offs)) != 0) {
            this.name += String.fromCharCode(c);
            offs++;
        }
    }
}

export class ObjectManager {
    private objectsTab: DataView;
    private objectsBin: DataView;
    private objindexBin: DataView;

    constructor(private gameInfo: GameInfo) {
    }

    public async create(dataFetcher: DataFetcher) {
        const pathBase = this.gameInfo.pathBase;
        const [objectsTab, objectsBin, objindexBin] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/OBJECTS.tab`),
            dataFetcher.fetchData(`${pathBase}/OBJECTS.bin`),
            dataFetcher.fetchData(`${pathBase}/OBJINDEX.bin`),
        ]);
        this.objectsTab = objectsTab.createDataView();
        this.objectsBin = objectsBin.createDataView();
        this.objindexBin = objindexBin.createDataView();
    }

    public loadObject(objType: number): SFAObject {
        objType = this.objindexBin.getUint16(objType * 2);
        const offs = this.objectsTab.getUint32(objType * 4);
        return new SFAObject(objType, dataSubarray(this.objectsBin, offs));
    }
}