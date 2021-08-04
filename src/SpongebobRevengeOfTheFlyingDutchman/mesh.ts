import { assert } from "../util";
import { readTHeader } from "./archive";
import { DataStream } from "./util";

function readStrip(data: DataStream) {
    return {
        vertex_ids: data.readArrayDynamic(data.readUint32, data.readUint16),
        material_index: data.readUint32(),
        tri_order: data.readUint32(),
    }
}

export function readMesh(data: DataStream) {
    const header = readTHeader(data);
    let coords = {
        vertices: data.readArrayDynamic(data.readUint32, data.readVec3),
        texcoords: data.readArrayDynamic(data.readUint32, data.readVec2),
        normals: data.readArrayDynamic(data.readUint32, data.readVec3),
    };
    const numStrips = data.readUint32();
    const strips = data.readArrayStatic(readStrip, numStrips);
    if ((header.flags & 4) !== 0) {
        data.skip(4 * numStrips); // skip vertex groups (I think?)
    }
    assert(numStrips === data.readUint32(), "Strip has incorrect number of stripext");
    const stripsFull = strips.map((strip) => ({
        elements: (() => {
            const numElements = data.readUint32();
            assert(numElements === strip.vertex_ids.length, "Bad elements >:(");
            return strip.vertex_ids.map((vertex_id) => ([
                vertex_id,// POSITION
                data.readUint16(),// UV
                data.readUint16(),// NORMAL
            ]));
        })(),
        material_index: strip.material_index,
        tri_order: strip.tri_order,
    }));
    return {
        header,
        ...coords,
        strips: stripsFull,
        materials: data.readArrayDynamic(data.readUint32, data.readInt32),
        // Rest doesn't matter
        // sphere_shapes:
        // cuboid_shapes:
        // cylinder_shapes:
        // unk_shapes:
        // strip_order:
    };
}

export type MeshObject = ReturnType<typeof readMesh>;