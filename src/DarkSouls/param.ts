
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assert, assertExists, readString } from "../util.js";

export interface ParamDefField {
    displayName: string;
    type: string;
    description: string | null;
    name: string;
    byteCount: number;
    fieldOffs: number;
}

export interface ParamDef {
    fields: ParamDefField[];
    rowByteCount: number;
}

export function parseParamDef(buffer: ArrayBufferSlice): ParamDef {
    const view = buffer.createDataView();

    const length = view.getUint32(0x00, true);
    const version = view.getUint16(0x04, true);
    const entryCount = view.getUint16(0x08, true);
    const entryLength = view.getUint16(0x0A, true);
    const id = readString(buffer, 0x0C, 0x20);

    const fields: ParamDefField[] = [];
    let offs = 0x30;
    let fieldOffs = 0x00;
    for (let i = 0; i < entryCount; i++, offs += entryLength) {
        const displayName = readString(buffer, offs + 0x00, 0x40, true, 'sjis');
        const type = readString(buffer, offs + 0x40, 0x08, true, 'sjis');
        const format = readString(buffer, offs + 0x48, 0x08, true, 'sjis');
        const defaultValue = view.getFloat32(offs + 0x50, true);
        const minValue = view.getFloat32(offs + 0x54, true);
        const maxValue = view.getFloat32(offs + 0x58, true);
        const increment = view.getFloat32(offs + 0x5C, true);
        const displayMode = view.getInt32(offs + 0x60, true);
        const byteCount = view.getInt32(offs + 0x64, true);

        const descriptionOffs = view.getUint32(offs + 0x68, true);
        const description = descriptionOffs >= 0 ? readString(buffer, descriptionOffs, -1, true, 'sjis') : null;

        const internalValueType = readString(buffer, offs + 0x6C, 0x20);
        const name = readString(buffer, offs + 0x8C, 0x20);
        const id = view.getInt32(offs + 0x90, true);
        fields.push({ displayName, type, description, name, byteCount, fieldOffs });

        fieldOffs += byteCount;
    }

    const rowByteCount = fieldOffs;
    return { fields, rowByteCount };
}

export class ParamFile {
    private view: DataView;
    private name: string;
    private names: string[] = [];
    private dataOffs: number[] = [];

    constructor(private buffer: ArrayBufferSlice, private def: ParamDef) {
        this.view = this.buffer.createDataView();

        const view = this.view;
        const stringOffs = view.getUint32(0x00, true);
        const dataOffs = view.getUint16(0x04, true);
        const rowCount = view.getUint16(0x0A, true);
        this.name = readString(buffer, 0x0C, 0x20);

        let offs = 0x30;
        for (let i = 0; i < rowCount; i++, offs += 0x0C) {
            const rowID = view.getUint32(offs + 0x00, true);
            const dataOffs = view.getUint32(offs + 0x04, true);
            const nameOffs = view.getUint32(offs + 0x08, true);
            this.dataOffs.push(dataOffs);
            this.names.push(readString(buffer, nameOffs, -1, true, 'sjis'));
        }
    }

    public getName(i: number): string {
        return this.names[i];
    }

    public getNum(): number {
        return this.names.length;
    }

    public get(row: number, name: string): number {
        const field = assertExists(this.def.fields.find((field) => field.name === name));
        if (field.type === 'f32')
            return this.view.getFloat32(this.dataOffs[row] + field.fieldOffs, true);
        else if (field.type === 's16')
            return this.view.getInt16(this.dataOffs[row] + field.fieldOffs, true);
        else if (field.type === 's8')
            return this.view.getInt8(this.dataOffs[row] + field.fieldOffs);
        else if (field.type === 'u8')
            return this.view.getUint8(this.dataOffs[row] + field.fieldOffs);
        else
            throw "whoops";
    }
}
