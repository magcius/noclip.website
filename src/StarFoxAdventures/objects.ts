import { DataFetcher } from '../DataFetcher';

import { GameInfo } from './scenes';

function dataSubarray(data: DataView, byteOffset: number, byteLength?: number): DataView {
    return new DataView(data.buffer, data.byteOffset + byteOffset, byteLength);
}

class SFAObject {
    public name: string;
    public objClass: number;

    constructor(public objType: number, data: DataView, private isEarlyObject: boolean) {
        this.name = '';
        this.objClass = data.getInt16(0x50); // FIXME: where is this field for early objects?
        let offs = isEarlyObject ? 0x58 : 0x91;
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
    private objindexBin: DataView | null;

    constructor(private gameInfo: GameInfo, private useEarlyObjects: boolean) {
    }

    public async create(dataFetcher: DataFetcher) {
        const pathBase = this.gameInfo.pathBase;
        const [objectsTab, objectsBin, objindexBin] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/OBJECTS.tab`),
            dataFetcher.fetchData(`${pathBase}/OBJECTS.bin`),
            !this.useEarlyObjects ? dataFetcher.fetchData(`${pathBase}/OBJINDEX.bin`) : null,
        ]);
        this.objectsTab = objectsTab.createDataView();
        this.objectsBin = objectsBin.createDataView();
        this.objindexBin = !this.useEarlyObjects ? objindexBin!.createDataView() : null;
    }

    public loadObject(objType: number, skipObjindex: boolean = false): SFAObject {
        if (!this.useEarlyObjects && !skipObjindex) {
            objType = this.objindexBin!.getUint16(objType * 2);
        }
        const offs = this.objectsTab.getUint32(objType * 4);
        return new SFAObject(objType, dataSubarray(this.objectsBin, offs), this.useEarlyObjects);
    }
}