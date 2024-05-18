
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { Color, colorNewFromRGBA8 } from "../Color.js";
import { assert, readString } from "../util.js";

// ESM appears to be a RIFF-like

function FourCC(s: string): number {
    assert(s.length === 4);
    return s.charCodeAt(0) << 24 | s.charCodeAt(1) << 16 | s.charCodeAt(2) << 8 | s.charCodeAt(3);
}

function FourCCStr(n: number): string {
    return String.fromCharCode((n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, (n >>> 0) & 0xFF);
}

class RIFFField {
    public fourccStr: string;

    constructor(public fourcc: number, public data: ArrayBufferSlice) {
        this.fourccStr = FourCCStr(this.fourcc);
    }

    public getInt32(offset = 0x00): number { return this.data.createDataView().getInt32(offset, true); }
    public getFloat32(offset = 0x00): number { return this.data.createDataView().getFloat32(offset, true); }
    public getString(offset = 0x00): string { return readString(this.data, offset); }
    public getColor(offset = 0x00): Color { return colorNewFromRGBA8(this.data.createDataView().getInt32(offset, false)); }
}

class RIFFRecord {
    public fields: RIFFField[] = [];
    public fourccStr: string;

    constructor(public fourcc: number, public flags: number, buffer: ArrayBufferSlice) {
        this.fourccStr = FourCCStr(this.fourcc);
        const view = buffer.createDataView();
        for (let idx = 0x00; idx < buffer.byteLength;) {
            const fourcc = view.getUint32(idx + 0x00, false);
            const size = view.getUint32(idx + 0x04, true);
            const data = buffer.subarray(idx + 0x08, size, true);
            this.fields.push(new RIFFField(fourcc, data));
            idx += 0x08 + size;
        }
    }

    private _findField(fourcc: number): RIFFField | null {
        for (let i = 0; i < this.fields.length; i++)
            if (this.fields[i].fourcc === fourcc)
                return this.fields[i];
        return null;
    }

    public findField(fourcc: string): RIFFField | null {
        return this._findField(FourCC(fourcc));
    }

    private _findFields(fourcc: number): RIFFField[] {
        return this.fields.filter((f) => f.fourcc === fourcc);
    }

    public findFields(fourcc: string): RIFFField[] {
        return this._findFields(FourCC(fourcc));
    }
}

type RecordHandler = (record: RIFFRecord) => void;

function parseRIFF(buffer: ArrayBufferSlice, recordHandler: RecordHandler): void {
    const view = buffer.createDataView();
    for (let idx = 0x00; idx < buffer.byteLength;) {
        const fourcc = view.getUint32(idx + 0x00, false);
        const size = view.getUint32(idx + 0x04, true);
        const flags1 = view.getUint32(idx + 0x08, true); // unused
        const flags2 = view.getUint32(idx + 0x0C, true);
        const data = buffer.subarray(idx + 0x10, size, true);
        const record = new RIFFRecord(fourcc, flags2, data);
        recordHandler(record);
        idx += 0x10 + size;
    }
}

export class CELL {
    public name: string;
    public gridX: number;
    public gridY: number;
    public regionName: string | null = null;
    public interior: boolean;
    public land: LAND | null = null;
    public color: Color | null = null;
    public waterHeight = -1;
    public ambientColor: Color | null = null;
    public sunlightColor: Color | null = null;
    public fogColor: Color | null = null;
    public fogDensity: number = 0;

    constructor(record: RIFFRecord) {
        (this as any).record = record;

        for (let i = 0; i < record.fields.length; i++) {
            const field = record.fields[i];
            if (field.fourcc === FourCC('NAME')) {
                this.name = field.getString();
            } else if (field.fourcc === FourCC('DATA')) {
                const flags = field.getInt32(0x00);
                this.interior = !!(flags & 0x01);
                const hasWater = !!(flags & 0x02);
                const noSleep = !!(flags & 0x04);
                const fakeExterior = !!(flags & 0x08);

                this.gridX = field.getInt32(0x04);
                this.gridY = field.getInt32(0x08);
            } else if (field.fourcc === FourCC('RGNN')) {
                this.regionName = field.getString();
            } else if (field.fourcc === FourCC('NAM5')) {
                this.color = field.getColor();
            } else if (field.fourcc === FourCC('WHGT')) {
                this.waterHeight = field.getFloat32();
            } else if (field.fourcc === FourCC('AMBI')) {
                this.ambientColor = field.getColor(0x00);
                this.sunlightColor = field.getColor(0x04);
                this.fogColor = field.getColor(0x08);
                this.fogDensity = field.getFloat32(0x0C);
            } else if (field.fourcc === FourCC('FRMR')) {
                // XXX(jstpierre): Form Reference
                break;
            }
        }
    }
}

export class LAND {
    public sideLen = 65;
    public x: number;
    public y: number;
    public heightOffset = 0;
    public heightGradientData: Int8Array | null = null;
    public heightNormalData: Int8Array | null = null;
    public heightColorData: Uint8Array | null = null;
    public heightTexIdxData: Uint16Array | null = null;

    constructor(record: RIFFRecord) {
        for (let i = 0; i < record.fields.length; i++) {
            const field = record.fields[i];
            if (field.fourcc === FourCC('INTV')) {
                this.x = field.getInt32(0x00);
                this.y = field.getInt32(0x04);
            } else if (field.fourcc === FourCC('DATA')) {
                // flags
            } else if (field.fourcc === FourCC('VHGT')) {
                this.heightOffset = field.getFloat32(0x00);
                this.heightGradientData = field.data.createTypedArray(Int8Array, 0x04, this.sideLen * this.sideLen);
            } else if (field.fourcc === FourCC('VNML')) {
                this.heightGradientData = field.data.createTypedArray(Int8Array, 0x00, this.sideLen * this.sideLen * 3); // XYZXYZetc.
            } else if (field.fourcc === FourCC('VCLR')) {
                this.heightColorData = field.data.createTypedArray(Uint8Array, 0x00, this.sideLen * this.sideLen * 3); // RGBRGBetc.
            } else if (field.fourcc === FourCC('VTEX')) {
                this.heightTexIdxData = field.data.createTypedArray(Uint16Array, 0x00, 16 * 16);
            }
            // TODO(jstpierre): FRMR
        }
    }
}

function normalizeTexturePath(path: string): string {
    path = path.toLowerCase();
    if (!path.startsWith('textures\\'))
        path = `textures\\${path}`;
    if (!path.endsWith('.dds'))
        path = `${path.slice(0, -4)}.dds`;
    return path;
}

class LTEX {
    public name: string;
    public index: number;
    public filename: string;

    constructor(record: RIFFRecord) {
        this.name = record.findField('NAME')!.getString();
        this.index = record.findField('INTV')!.getInt32();
        this.filename = normalizeTexturePath(record.findField('DATA')!.getString());
    }
}

export class ESM {
    private records: RIFFRecord[] = []; // debug

    private recordHandler = new Map<number, RecordHandler>();
    public gameSettings = new Map<string, number | string>();
    public cell: CELL[] = [];
    public ltex = new Map<number, LTEX>();

    private currentCell: CELL | null = null; // parse state

    constructor(buffer: ArrayBufferSlice) {
        this.register('GMST', this.handleRecord_GMST);
        this.register('CELL', this.handleRecord_CELL);
        this.register('LAND', this.handleRecord_LAND);
        this.register('LTEX', this.handleRecord_LTEX);

        this.parse(buffer);
    }

    private register(fourcc: string, handler: RecordHandler): void {
        this.recordHandler.set(FourCC(fourcc), handler.bind(this));
    }

    private handleRecord_GMST(record: RIFFRecord): void {
        let field: RIFFField | null;
        const name = record.findField('NAME')!.getString();
        if ((field = record.findField('INTV')) !== null)
            this.gameSettings.set(name, field.getInt32());
        else if ((field = record.findField('FLTV')) !== null)
            this.gameSettings.set(name, field.getFloat32());
        else if ((field = record.findField('STRV')) !== null)
            this.gameSettings.set(name, field.getString());
    }

    private handleRecord_CELL(record: RIFFRecord): void {
        const cell = new CELL(record);
        this.cell.push(cell);
        this.currentCell = cell;
    }

    private handleRecord_LTEX(record: RIFFRecord): void {
        const ltex = new LTEX(record);
        this.ltex.set(ltex.index, ltex);
    }

    private handleRecord_LAND(record: RIFFRecord): void {
        const land = new LAND(record);
        this.currentCell!.land = land;
    }

    public parse(buffer: ArrayBufferSlice): void {
        parseRIFF(buffer, (record) => {
            const recordHandler = this.recordHandler.get(record.fourcc);
            if (recordHandler !== undefined)
                recordHandler(record);
            this.records.push(record);
        });

        this.currentCell = null;
    }
}
