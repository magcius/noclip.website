
// Dark Souls MSB (Map Studio Binary)
// https://github.com/JKAnderson/SoulsFormats/blob/master/SoulsFormats/Formats/MTD.cs

import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, assert } from "../util";
import { vec3 } from "gl-matrix";
import BitMap from "../BitMap";

export interface MSB {
    mapID: string;
    models: Model[];
    parts: Part[];
}

const enum ModelType {
    MapPiece  = 0x00,
    Object    = 0x01,
    Enemy     = 0x02,
    Player    = 0x04,
    Collision = 0x05,
    Navmesh   = 0x06,
};

export interface Model {
    name: string;
    type: ModelType;
    id: number;
    filename: string;
    flverPath: string;
}

const enum PartType {
    MapPiece  = 0x00,
    Object    = 0x01,
    Enemy     = 0x02,
    Collision = 0x05,
};

export interface Part {
    name: string;
    type: PartType;
    modelIndex: number;
    translation: vec3;
    rotation: vec3;
    scale: vec3;
    drawGroupBitMap: BitMap;
    dispGroupBitMap: BitMap;
}

export function parse(buffer: ArrayBufferSlice, mapID: string): MSB {
    const view = buffer.createDataView();

    let paramTableIdx = 0x00;

    assert(view.getUint32(paramTableIdx + 0x00, true) == 0);
    assert(readString(buffer, view.getUint32(paramTableIdx + 0x04, true), -1, true) == 'MODEL_PARAM_ST');
    const modelTableCount = view.getUint32(paramTableIdx + 0x08, true) - 1;

    let modelTableIdx = paramTableIdx + 0x0C;
    const models: Model[] = [];
    for (let i = 0; i < modelTableCount; i++) {
        const modelOffs = view.getUint32(modelTableIdx + 0x00, true);

        const nameOffs = view.getUint32(modelOffs + 0x00, true);
        const name = readString(buffer, modelOffs + nameOffs, -1, true);

        const type: ModelType = view.getUint32(modelOffs + 0x04, true);
        const id = view.getUint32(modelOffs + 0x08, true);

        const filenameOffs = view.getUint32(modelOffs + 0x0C, true);
        const filename = readString(buffer, modelOffs + filenameOffs, -1, true);

        const instanceCount = view.getUint32(modelOffs + 0x10, true);

        const mapIDBase = mapID.slice(0, 6); // "m10_00"
        const mapIDFirstPart = mapIDBase.slice(1, 3);
        const flverPath = `/map/${mapIDBase}_00_00/${name}A${mapIDFirstPart}.flver.dcx`;

        models.push({ name, type, id, filename, flverPath });

        modelTableIdx += 0x04;
    }

    // Chain to next chunk
    paramTableIdx = view.getUint32(modelTableIdx + 0x00, true);

    assert(view.getUint32(paramTableIdx + 0x00, true) == 0);
    assert(readString(buffer, view.getUint32(paramTableIdx + 0x04, true), -1, true) == 'EVENT_PARAM_ST');
    const eventTableCount = view.getUint32(paramTableIdx + 0x08, true) - 1;

    let eventTableIdx = paramTableIdx + 0x0C;
    for (let i = 0; i < eventTableCount; i++) {
        const eventOffs = view.getUint32(eventTableIdx + 0x00, true);
        eventTableIdx += 0x04;
    }

    // Chain to next chunk.
    paramTableIdx = view.getUint32(eventTableIdx + 0x00, true);

    assert(view.getUint32(paramTableIdx + 0x00, true) == 0);
    assert(readString(buffer, view.getUint32(paramTableIdx + 0x04, true), -1, true) == 'POINT_PARAM_ST');
    const pointTableCount = view.getUint32(paramTableIdx + 0x08, true) - 1;

    let pointTableIdx = paramTableIdx + 0x0C;
    for (let i = 0; i < pointTableCount; i++) {
        const pointOffs = view.getUint32(pointTableIdx + 0x00, true);
        pointTableIdx += 0x04;
    }

    // Chain to next chunk.
    paramTableIdx = view.getUint32(pointTableIdx + 0x00, true);

    assert(view.getUint32(paramTableIdx + 0x00, true) == 0);
    assert(readString(buffer, view.getUint32(paramTableIdx + 0x04, true), -1, true) == 'PARTS_PARAM_ST');
    const partsTableCount = view.getUint32(paramTableIdx + 0x08, true) - 1;

    function readPart(offs: number): Part {
        const baseOffs = offs;

        const nameOffs = view.getUint32(offs, true);
        offs += 0x04;
        const name = readString(buffer, baseOffs + nameOffs, -1, true);

        const type = view.getUint32(offs, true);
        offs += 0x04;

        // An index into a group of things, but which things?
        const unkIdx = view.getUint32(offs, true);
        offs += 0x04;

        const modelIndex = view.getUint32(offs, true);
        offs += 0x04;

        const unk2 = view.getUint32(offs, true);
        offs += 0x04;

        function readVec3(): vec3 {
            const x = view.getFloat32(offs + 0x00, true);
            const y = view.getFloat32(offs + 0x04, true);
            const z = view.getFloat32(offs + 0x08, true);
            offs += 0x0C;
            return vec3.fromValues(x, y, z);
        }

        const translation = readVec3();
        const rotation = readVec3();
        const scale = readVec3();

        const drawGroup1 = view.getUint32(offs + 0x00, true);
        const drawGroup2 = view.getUint32(offs + 0x04, true);
        const drawGroup3 = view.getUint32(offs + 0x08, true);
        const drawGroup4 = view.getUint32(offs + 0x0C, true);
        offs += 0x10;

        const drawGroupBitMap = new BitMap(128);
        drawGroupBitMap.setWords([drawGroup1, drawGroup2, drawGroup3, drawGroup4]);

        const dispGroup1 = view.getUint32(offs + 0x00, true);
        const dispGroup2 = view.getUint32(offs + 0x04, true);
        const dispGroup3 = view.getUint32(offs + 0x08, true);
        const dispGroup4 = view.getUint32(offs + 0x0C, true);
        offs += 0x10;

        const dispGroupBitMap = new BitMap(128);
        dispGroupBitMap.setWords([dispGroup1, dispGroup2, dispGroup3, dispGroup4]);

        return { name, type, modelIndex, translation, rotation, scale, drawGroupBitMap, dispGroupBitMap };
    }

    let partsTableIdx = paramTableIdx + 0x0C;
    const parts: Part[] = [];
    for (let i = 0; i < partsTableCount; i++) {
        const partOffs = view.getUint32(partsTableIdx + 0x00, true);
        parts.push(readPart(partOffs));
        partsTableIdx += 0x04;
    }

    return { mapID, models, parts };
}
