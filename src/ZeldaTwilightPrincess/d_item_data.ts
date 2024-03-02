import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { dGlobals, SymbolMap } from './Main.js';

export class dItem_itemResource {
    public arcName: string;
    public bmdID: number;
    public btkID: number;
    public bckID: number;
    public brkID: number;
    public btpID: number;
    public tevFrm: number;
    public btpFrm: number;
    public textureID: number;
    public texScale: number;

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();

        this.bmdID = view.getInt16(0x4);
        this.btkID = view.getInt16(0x6);
        this.bckID = view.getInt16(0x8);
        this.brkID = view.getInt16(0xA);
        this.btpID = view.getInt16(0xC);
        this.tevFrm = view.getInt8(0xE);
        this.btpFrm = view.getInt8(0xF);
        this.textureID = view.getInt16(0x10);
        this.texScale = view.getUint8(0x12);

        return 0x18;
    }
}

export class dItem_fieldItemResource {
    public arcName: string | null = null;
    public bmdID: number;
    public bckID: number;
    public brkID: number;

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();

        this.bmdID = view.getInt16(0x4);
        this.bckID = view.getInt16(0x6);
        this.brkID = view.getInt16(0x8);

        return 0x10;
    }
}

export class dItem_itemInfo {
    public shadowSize: number;
    public height: number;
    public radius: number;
    public flag: number;

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();

        this.shadowSize = view.getUint8(0x0);
        this.height = view.getUint8(0x1);
        this.radius = view.getUint8(0x2);
        this.flag = view.getUint8(0x3);

        return 0x4;
    }
}

export function getItemResource(globals: dGlobals, symbolMap: SymbolMap): dItem_itemResource[] {
    const stringsBuf = symbolMap.findSymbolData(`d_item_data.o`, `@stringBase0`);
    const textDecoder = new TextDecoder('utf8') as TextDecoder;

    const stringsBytes = stringsBuf.createTypedArray(Uint8Array);

    const nametable: string[] = [];

    for (let i = 0; i < 255; i++) {
        const ptr = 0;
        const strOffset = ptr - 0x8037ad68;
        const endOffset = stringsBytes.indexOf(0, strOffset);
        const arcname = textDecoder.decode(stringsBytes.subarray(strOffset, endOffset));
        nametable[i] = arcname;
    }

    const buffer = globals.findExtraSymbolData(`d_item_data.o`, `item_resource__10dItem_data`);
    const res: dItem_itemResource[] = [];

    let offs = 0x00;
    for (let i = 0; i < 255; i++) {
        const entry = new dItem_itemResource();
        offs += entry.parse(buffer.slice(offs));
        entry.arcName = nametable[i];
        res.push(entry);
    }

    return res;
}

export function getFieldItemResource(globals: dGlobals, symbolMap: SymbolMap): dItem_fieldItemResource[] {
    const buffer = globals.findExtraSymbolData(`d_item_data.o`, `field_item_res__10dItem_data`);
    const res: dItem_fieldItemResource[] = [];

    let offs = 0x00;
    for (let i = 0; i < 255; i++) {
        const entry = new dItem_fieldItemResource();
        offs += entry.parse(buffer.slice(offs));
        
        if ((i >= 0 && i < 8) || (i >= 14 && i < 19) || i === 31 || i === 33 || i === 34)
            entry.arcName = "Always";

        switch (i) {
        case 32:
            entry.arcName = "T_g_key";
            break;
        case 38:
            entry.arcName = "T_g_bkey";
            break;
        case 40:
            entry.arcName = "O_g_SWA";
            break;
        case 42:
            entry.arcName = "T_g_SHB";
            break;
        case 49:
            entry.arcName = "O_g_ZORA";
            break;
        case 63:
            entry.arcName = "O_gD_SWB";
            break;
        case 72:
            entry.arcName = "T_g_kt";
            break;
        case 130:
            entry.arcName = "O_wood";
            break;
        case 248:
            entry.arcName = "T_g_kt";
            break;
        case 254:
            entry.arcName = "T_g_key";
            break;
        }

        res.push(entry);
    }

    return res;
}

export function getItemInfo(globals: dGlobals): dItem_itemInfo[] {
    const buffer = globals.findExtraSymbolData(`d_item_data.o`, `item_info__10dItem_data`);
    const res: dItem_itemInfo[] = [];

    let offs = 0x00;
    for (let i = 0; i < 255; i++) {
        const entry = new dItem_itemInfo();
        offs += entry.parse(buffer.slice(offs));
        res.push(entry);
    }

    return res;
}

export const enum ItemNo {
    GREEN_RUPEE = 1,
    BLUE_RUPEE,
    YELLOW_RUPEE,
    RED_RUPEE,
    PURPLE_RUPEE,
    ORANGE_RUPEE,
    SILVER_RUPEE,
}