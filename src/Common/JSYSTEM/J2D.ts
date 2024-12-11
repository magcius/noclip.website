import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { JSystemFileReaderHelper } from "./J3D/J3DLoader.js";
import { align, assert, readString } from "../../util.js";
import { Color, colorNewFromRGBA8 } from "../../Color.js";

export interface PaneBase {
    parent: PaneBase | null
}

//#region  Helpers
interface ResRef {
    type: number;
    name: string;
}

function parseResourceReference(dst: ResRef, buffer: ArrayBufferSlice, offset: number): number {
    const dataView = buffer.createDataView();
    dst.type = dataView.getUint8(offset + 0);
    const nameLen = dataView.getUint8(offset + 1);
    dst.name = readString(buffer, offset + 2, nameLen);

    if (dst.type == 2 || dst.type == 3 || dst.type == 4) {
        dst.name = "";
    }

    return nameLen + 2;
}
//#endregion

//#region INF1
export interface INF1 {
    width: number;
    height: number;
    color: Color
}

function readINF1Chunk(buffer: ArrayBufferSlice): INF1 {
    const view = buffer.createDataView();
    const width = view.getUint16(8);
    const height = view.getUint16(10);
    const color = view.getUint32(12);
    return {width, height, color: colorNewFromRGBA8(color)};
}
//#endregion

//#region J2DPicture
interface PIC1 extends PAN1 {
    timg: ResRef;
    tlut: ResRef;
    binding: number;
    flags: number;
    colorBlack: Color;
    colorWhite: Color;
    colorCorner: Color;
}

function readPIC1Chunk(buffer: ArrayBufferSlice, parent: PaneBase | null): PIC1 {
    const view = buffer.createDataView();
    
    const pane = readPAN1Chunk(buffer, parent);

    let dataCount = view.getUint8(pane.offset + 0);
    let offset = pane.offset + 1;

    const timg = { type: 0, name: "" };
    const tlut = { type: 0, name: "" };
    offset += parseResourceReference(timg, buffer, offset);
    offset += parseResourceReference(tlut, buffer, offset);
    const binding = view.getUint8(offset);
    offset += 1;
    dataCount -= 3;

    let flags = 0;
    if (dataCount > 0) {
        flags = view.getUint8(offset);
        offset += 1;
        dataCount -= 1;
    }

    if (dataCount > 0) {
        offset += 1;
        dataCount -= 1;
    }

    let colorBlack = 0x0;
    if (dataCount > 0) {
        colorBlack = view.getUint32(offset);
        offset += 4;
        dataCount -= 1;
    }

    let colorWhite = 0xFFFFFFFF;
    if (dataCount > 0) {
        colorWhite = view.getUint32(offset);
        offset += 4;
        dataCount -= 1;
    }

    let colorCorner = 0xFFFFFFFF;
    if (dataCount > 0) {
        colorCorner = view.getUint32(offset);
        offset += 4;
        dataCount -= 1;
    }

    return {...pane, timg, tlut, binding, flags, colorBlack: colorNewFromRGBA8(colorBlack), 
        colorWhite: colorNewFromRGBA8(colorWhite), colorCorner: colorNewFromRGBA8(colorCorner) };
}
//#endregion J2DPicture

//#region J2Pane
interface PAN1 extends PaneBase {
    visible: boolean;
    tag: string;
    x: number;
    y: number;
    w: number;
    h: number;
    rot: number;
    basePos: number;
    alpha: number;
    inheritAlpha: boolean;
    
    offset: number; // For parsing only
}

function readPAN1Chunk(buffer: ArrayBufferSlice, parent: PaneBase | null): PAN1 {
    const view = buffer.createDataView();
    let offset = 8;

    let dataCount = view.getUint8(offset + 0);

    const visible = !!view.getUint8(offset + 1);
    const tag = readString(buffer, offset + 4, 4);
    const x = view.getInt16(offset + 8);
    const y = view.getInt16(offset + 10);
    const w = view.getInt16(offset + 12);
    const h = view.getInt16(offset + 14);
    dataCount -= 6;
    offset += 16;

    let rot = 0;
    if(dataCount > 0) {
        rot = view.getUint16(offset);
        offset += 2;
        dataCount -= 1;
    }

    let basePos = 0;
    if(dataCount > 0) {
        basePos = view.getUint8(offset);
        offset += 1;
        dataCount -= 1;
    }

    let alpha = 0;
    if(dataCount > 0) {
        alpha = view.getUint8(offset);
        offset += 1;
        dataCount -= 1;
    }

    let inheritAlpha = true;
    if(dataCount > 0) {
        inheritAlpha = !!view.getUint8(offset);
        offset += 1;
        dataCount -= 1;
    }

    offset = align(offset, 4);
    return { parent, visible, tag, x, y, w, h, rot, basePos, alpha, inheritAlpha, offset };
}
//#endregion J2Pane

//#region J2Screen
export interface SCRN {
    inf1: INF1;
    panes: PaneBase[];
}

export class BLO {
    public static parse(buffer: ArrayBufferSlice): SCRN {
        const j2d = new JSystemFileReaderHelper(buffer);
        assert(j2d.magic === 'SCRNblo1');
        
        const inf1 = readINF1Chunk(j2d.nextChunk('INF1'))
        const panes: PaneBase[] = [];

        let parentStack: (PaneBase | null)[] = [null];
        let shouldContinue = true;
        while(shouldContinue) {
            const magic = readString(buffer, j2d.offs, 4);
            const chunkSize = j2d.view.getUint32(j2d.offs + 4);

            switch(magic) {
                // Panel Types
                case 'PAN1': panes.push(readPAN1Chunk(j2d.nextChunk('PAN1'), parentStack[parentStack.length - 1])); break;
                case 'PIC1': panes.push(readPIC1Chunk(j2d.nextChunk('PIC1'), parentStack[parentStack.length - 1])); break;
                // case 'WIN1': readWIN1Chunk(j2d.nextChunk('WIN1')); break;
                // case 'TBX1': readTBX1Chunk(j2d.nextChunk('TBX1')); break;

                // Hierarchy
                case 'EXT1': shouldContinue = false; break;
                case 'BGN1': j2d.offs += chunkSize; parentStack.push(panes[panes.length - 1]); break;
                case 'END1': j2d.offs += chunkSize; parentStack.pop(); break;

                default:
                    console.warn('Unsupported SCRN block:', magic);
                    j2d.offs += chunkSize;
                    break;
            }
        }

        return { inf1, panes };
    }
}

//#endregion J2Screen