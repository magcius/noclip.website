import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, assert } from "../util";
import { vec3 } from "gl-matrix";

export interface MSB {
    mapID: string;
    models: Model[];
    parts: Part[];
}

export interface Model {
    name: string;
    type: number;
    filename: string;
    flverPath: string;
}

const enum PartType {
    MapPiece  = 0x00,
    Object    = 0x01,
    Entity    = 0x02,
    Collision = 0x05,
};

export interface Part {
    name: string;
    type: PartType;
    modelIndex: number;
    translation: vec3;
    rotation: vec3;
    scale: vec3;
}

export function parse(buffer: ArrayBufferSlice, mapID: string): MSB {
    const view = buffer.createDataView();
    let offs = 0;

    function readModel(offs: number): Model {
        let idx = offs;

        const nameOffs = view.getUint32(idx, true);
        idx += 0x04;
        const name = readString(buffer, offs + nameOffs, -1, true);

        const type = view.getUint32(idx, true);
        idx += 0x04;

        // unk
        idx += 0x04;

        const filenameOffs = view.getUint32(idx, true);
        const filename = readString(buffer, offs + filenameOffs, -1, true);

        const mapIDBase = mapID.slice(0, 6); // "m10_00"
        const mapIDFirstPart = mapIDBase.slice(1, 3);
        const flverPath = `/map/${mapIDBase}_00_00/${name}A${mapIDFirstPart}.flver.dcx`;
        return { name, type, filename, flverPath };
    }

    assert(view.getUint32(offs, true) == 0);
    offs += 0x04;
    assert(readString(buffer, view.getUint32(offs, true), -1, true) == 'MODEL_PARAM_ST');
    offs += 0x04;
    const modelCount = view.getUint32(offs, true) - 1;
    offs += 0x04;

    const models: Model[] = [];
    for (let i = 0; i < modelCount; i++) {
        const modelOffs = view.getUint32(offs, true);
        offs += 0x04;
        models.push(readModel(modelOffs));
    }

    // Chain to next chunk.
    offs = view.getUint32(offs, true);

    assert(view.getUint32(offs, true) == 0);
    offs += 0x04;
    assert(readString(buffer, view.getUint32(offs, true), -1, true) == 'EVENT_PARAM_ST');
    offs += 0x04;
    const eventCount = view.getUint32(offs, true) - 1;
    offs += 0x04;

    for (let i = 0; i < eventCount; i++) {
        const eventOffs = view.getUint32(offs, true);
        offs += 0x04;
    }

    // Chain to next chunk.
    offs = view.getUint32(offs, true);

    assert(view.getUint32(offs, true) == 0);
    offs += 0x04;
    assert(readString(buffer, view.getUint32(offs, true), -1, true) == 'POINT_PARAM_ST');
    offs += 0x04;
    const pointCount = view.getUint32(offs, true) - 1;
    offs += 0x04;
    for (let i = 0; i < pointCount; i++) {
        const pointOffs = view.getUint32(offs, true);
        offs += 0x04;
    }

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

        return { name, type, modelIndex, translation, rotation, scale };
    }

    // Chain to next chunk.
    offs = view.getUint32(offs, true);

    assert(view.getUint32(offs, true) == 0);
    offs += 0x04;

    assert(readString(buffer, view.getUint32(offs, true), -1, true) == 'PARTS_PARAM_ST');
    offs += 0x04;
    const partCount = view.getUint32(offs, true) - 1;
    offs += 0x04;
    const parts: Part[] = [];
    for (let i = 0; i < partCount; i++) {
        const partOffs = view.getUint32(offs, true);
        offs += 0x04;
        parts.push(readPart(partOffs));
    }

    return { mapID, models, parts };
}
