import ArrayBufferSlice from "../ArrayBufferSlice";
import { DataFetcher } from "../DataFetcher";
import { DataStream } from "./util";
import * as CRC32 from "crc-32";
import { assert } from "../util";
import { mat3, mat4, quat, vec2, vec3 } from "gl-matrix";
import { Color } from "../Color";

export const FileType = {
    ANIMATION: CRC32.bstr("ANIMATION"),
    BITMAP: CRC32.bstr("BITMAP"),
    CAMERA: CRC32.bstr("CAMERA"),
    CAMERAZONE: CRC32.bstr("CAMERAZONE"),
    COLLISIONVOL: CRC32.bstr("COLLISIONVOL"),
    GAMEOBJ: CRC32.bstr("GAMEOBJ"),
    HFOG: CRC32.bstr("HFOG"),
    LIGHT: CRC32.bstr("LIGHT"),
    LOD: CRC32.bstr("LOD"),
    MATERIAL: CRC32.bstr("MATERIAL"),
    MATERIALANIM: CRC32.bstr("MATERIALANIM"),
    MATERIALOBJ: CRC32.bstr("MATERIALOBJ"),
    MESH: CRC32.bstr("MESH"),
    NODE: CRC32.bstr("NODE"),
    OCCLUDER: CRC32.bstr("OCCLUDER"),
    OMNI: CRC32.bstr("OMNI"),
    PARTICLES: CRC32.bstr("PARTICLES"),
    ROTSHAPE: CRC32.bstr("ROTSHAPE"),
    RTC: CRC32.bstr("RTC"),
    SKIN: CRC32.bstr("SKIN"),
    SOUND: CRC32.bstr("SOUND"),
    SPLINE: CRC32.bstr("SPLINE"),
    SURFACE: CRC32.bstr("SURFACE"),
    TXT: CRC32.bstr("TXT"),
    USERDEFINE: CRC32.bstr("USERDEFINE"),
    WARP: CRC32.bstr("WARP"),
    WORLD: CRC32.bstr("WORLD"),
}

/******************\
|* READ UTILITIES *|
\******************/

export type THeader = {
    floats_unk: number[];
    transform: mat4;
    junk: void;
    type: number;
    flags: number;
}

export function readTHeader(data: DataStream): THeader {
    return {
        floats_unk: data.readArrayStatic(data.readFloat32, 4),
        transform: data.readMat4(),
        junk: data.readJunk(16),
        type: data.readUint16(),
        flags: data.readUint16(),
    }
}

/*****************\
|* READ MATERIAL *|
\*****************/

export function readMaterial(data: DataStream) {
    return {
        color: data.readRGBA(),
        emission: data.readRGB(),
        unk2: data.readFloat32(),
        transform: data.readMat3(),
        rotation: data.readFloat32(),
        offset: data.readVec2(),
        scale: data.readVec2(),
        unk4: data.readJunk(13),
        texture_id: data.readInt32(),
        reflection_id: data.readInt32(),
    }
}

/*************\
|* READ NODE *|
\*************/

export function readNode(data: DataStream) {
    return {
        node_parent_id: data.readInt32(),
        node_unk_ids: data.readArrayStatic(data.readInt32, 3),
        resource_id: data.readInt32(),
        node_data: readNodeData(data),
        light_id: data.readInt32(),
        hfog_id: data.readInt32(),
        userdefine_id: data.readInt32(),
        floatv1: data.readArrayStatic(data.readFloat32, 9),
        floatv2: data.readArrayStatic(data.readFloat32, 9),
        local_transform: data.readMat4(),
        local_translation: data.readVec3(),
        junk1: data.readUint32(),
        local_rotation: data.readQuat(),
        local_scale: data.readVec3(),
        junk2: data.readUint32(),
        unk1: data.readArrayStatic(data.readFloat32, 2),
        unk2: data.readArrayStatic(data.readUint32, 8),
        unk3: data.readArrayStatic(data.readFloat32, 4),
        unk4: data.readArrayStatic(data.readUint16, 2),
        global_transform: data.readMat4(),
        global_transform_inverse: data.readMat4(),
    }
}

// node union
const T_ROTSHAPEDATA = 733875652;
const T_MESHDATA = -1724712303;
const T_SKEL = 1985457034;
const T_SURFACEDATAS = 413080818;
const T_LODDATA = -141015160;
const T_PARTICLESDATA = -241612565;
// extra data union
const E_USERDATA = -1879206489;

function readNodeData(data: DataStream) {
    const invariant = data.readInt32();
    switch (invariant) {
        case T_LODDATA: return {
            type: T_LODDATA,
            path_id: data.readInt32(),
            subtype_id: data.readInt32(),
            unk1: data.readArrayStatic(data.readFloat32, 5),
            data: ((): void => {
                // If I actually need this data,
                // I can add a return type to readNodeData later.
                data.readArrayDynamic(data.readUint32, readNodeData);
            })(),
            unk2: data.readArrayStatic(data.readUint8, 100), 
            node_id: data.readInt32(),
            light1_id: data.readInt32(),
            light2_id: data.readInt32(),
            nodes: data.readArrayDynamic(data.readUint32, data.readInt32),
            unk3: data.readArrayDynamic(data.readUint32, data.readUint32),
        };
        case T_SKEL: return {
            type: T_SKEL,
            path_id: data.readInt32(),
            subtype_id: data.readInt32(),
            unk1: data.readArrayStatic(data.readFloat32, 5),
            unk2: data.readArrayDynamic(data.readUint32, readNodeSkinUnk2),
            unk3_id: data.readInt32(),
            materials: data.readArrayDynamic(data.readUint32, readNodeSkinMaterial),
            unk4: data.readArrayDynamic(data.readUint32, readNodeSkinUnk),
            unk5: data.readArrayDynamic(data.readUint32, readNodeSkinUnk),
            unk6: data.readArrayDynamic(data.readUint32, readNodeSkinUnk),
            unk7: ((): void => {
                // If I actually need this data,
                // I can add a return type to readNodeData later.
                const size = data.readUint32();
                let ret: {
                    ids: number[],
                    data: ReturnType<typeof readNodeData>
                }[] = [];
                for (let i = 0; i < size; i++) {
                    ret.push({
                        data: readNodeData(data),
                        ids: [],
                    });
                }
                for (let i = 0; i < size; i++) {
                    let ids = ret[i].ids;
                    let idlen = data.readUint32();
                    for (let i = 0; i < idlen; i++) {
                        ids.push(data.readInt32());
                    }
                }
            })()
        };
        case T_SURFACEDATAS: return {
            type: T_SURFACEDATAS,
            data_id: data.readInt32(),
            subtype_id: data.readInt32(),
            data: data.readArrayStatic(data.readFloat32, 5),
            unk1: data.readArrayDynamic(data.readUint32, readNodeDataSurfaceUnk),
            unk2: data.readUint32(),
            unk3: data.readUint32(),
        };
        case T_ROTSHAPEDATA: return {
            type: T_ROTSHAPEDATA,
            data_id: data.readInt32(),
            subtype_id: data.readInt32(),
            unk1: data.readArrayStatic(data.readUint32, 6),
            unk2: data.readUint16(),
            junk: data.readJunk(28),
        };
        case T_MESHDATA: return {
            type: T_MESHDATA,
            data_id: data.readInt32(),
            subtype_id: data.readInt32(),
            data: data.readArrayStatic(data.readFloat32, 5),
        };
        case T_PARTICLESDATA: return {
            type: T_PARTICLESDATA,
            data_id: data.readInt32(),
            subtype_id: data.readInt32(),
            unk1: data.readArrayStatic(data.readFloat32, 5),
            unk2: data.readUint16(),
        };
        default: return { type: 0 };
    }
}

function readNodeDataSurfaceUnk(data: DataStream) {
    return {
        data: data.readSlice(104),
    }
}

function readNodeSkinUnk2(data: DataStream) {
    return {
        unk_ids: data.readArrayStatic(data.readInt32, 5),
        extra_data: readNodeSkinUnk2ExtraDataUnion(data),
        local_translaction: data.readVec3(),
        junk1: data.readJunk(4),
        local_rotation: data.readQuat(),
        local_scale: data.readVec3(),
        floatv1: data.readArrayStatic(data.readFloat32, 9),
        floatv2: data.readArrayStatic(data.readFloat32, 9),
        tx1: data.readMat4(),
        tx2: data.readMat4(),
    }
}

function readNodeSkinMaterial(data: DataStream) {
    return {
        filetype_id: data.readInt32(),
        filename_id: data.readInt32(),
        subtype_id: data.readInt32(),
        material: readMaterial(data),
    }
}

function readNodeSkinUnk(data: DataStream) {
    return {
        unk1: data.readArrayStatic(data.readFloat32, 4),
        unk2_id: data.readInt32(),
        unk3_id: data.readInt32(),
    }
}

function readNodeSkinUnk2ExtraDataUnion(data: DataStream) {
    const invariant = data.readInt32();
    switch (invariant) {
        case E_USERDATA: return {
            type: E_USERDATA,
            type1: data.readInt32(),
            type2: data.readInt32(),
            data: data.readSliceDynamic(data.readUint32),
        }
        default: return { type: 0 }
    }
}

/*************\
|* READ MESH *|
\*************/

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
            return strip.vertex_ids.map((vertex_id) => ({
                vertex_id,
                texcoord_id: data.readUint16(),
                normal_id: data.readUint16(),
            }));
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

/****************\
|* READ SURFACE *|
\****************/

function readSurfaceSingle(data: DataStream) {
    return {
        texcoords: data.readArrayStatic(data.readVec2, 4),
        unk2: data.readArrayStatic(data.readFloat32, 12),
        normal_indices: data.readArrayStatic(data.readUint16, 4),
        curve_indices: data.readArrayStatic(data.readUint16, 4),
        curve_order: data.readUint32(),
        unk3: data.readJunk(32),
        index_n6: data.readUint32(),
        materialanim_id: data.readInt32(),
    }
}

function readCurve(data: DataStream) {
    return {
        p1: data.readUint16(),
        p2: data.readUint16(),
        p1_t: data.readUint16(),
        p2_t: data.readUint16(),
    }
}

export function readSurface(data: DataStream) {
    return {
        header: readTHeader(data),
        vertices: data.readArrayDynamic(data.readUint32, data.readVec3),
        unk0: data.readArrayDynamic(data.readUint32, (data) => data.readJunk(24)),
        unk1: data.readArrayDynamic(data.readUint32, (data) => data.readJunk(24)),
        surfaces: data.readArrayDynamic(data.readUint32, readSurfaceSingle),
        curves: data.readArrayDynamic(data.readUint32, readCurve),
        normals: data.readArrayDynamic(data.readUint32, data.readVec3),
        // rest doesn't matter (for now?)
    }
}

/****************\
|* READ ARCHIVE *|
\****************/

const dataBasePath = "rotfd";

export class TotemFile {
    constructor(
        public readonly data: ArrayBufferSlice,
        public readonly nameHash: number,
        public readonly typeHash: number,
        public readonly flags: number,
    ) { }
}

export class TotemArchive {
    private data = new Map<number, TotemFile>();

    addFile(fileNameHash: number, file: TotemFile) {
        this.data.set(fileNameHash, file);
    }

    getFile(fileNameHash: number): TotemFile | undefined {
        return this.data.get(fileNameHash);
    }
    
    *iterFilesOfType(typeHash: number) {
        for (const [key, file] of this.data.entries()) {
            if (file.typeHash === typeHash) {
                yield file;
            }
        }
    }
}

export async function loadArchive(dataFetcher: DataFetcher, path: string): Promise<TotemArchive> {
    const dgc = await dataFetcher.fetchData(`${dataBasePath}/${path}.DGC`);
    // const ngc = await dataFetcher.fetchData(`${path}.NGC`);
    const dstream = new DataStream(dgc, 256, false);
    const chunkSize = dstream.readUint32();
    dstream.offs = 2048;
    let archive = new TotemArchive();
    while (dstream.offs < dstream.buffer.byteLength) {
        const nextpos = dstream.offs + chunkSize;
        const numFiles = dstream.readUint32();
        for (let i = 0; i < numFiles; i++) {
            const fileSize = dstream.readUint32();
            const fileTypeHash = dstream.readInt32();
            const fileNameHash = dstream.readInt32();
            const fileFlags = dstream.readUint32();
            const data = dstream.readSlice(fileSize - 16);
            archive.addFile(fileNameHash, new TotemFile(data, fileNameHash, fileTypeHash, fileFlags));
        }
        dstream.offs = nextpos;
    }
    return archive;
}