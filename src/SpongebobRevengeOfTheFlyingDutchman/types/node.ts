import { readMaterial } from "./material";
import { DataStream } from "../util";
import * as CRC32 from "crc-32";

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
const T_ROTSHAPEDATA = CRC32.bstr("ROTSHAPEDATA");
const T_MESHDATA = CRC32.bstr("MESHDATA");
const T_SKEL = CRC32.bstr("SKEL");
const T_SURFACEDATAS = CRC32.bstr("SURFACEDATAS");
const T_LODDATA = CRC32.bstr("LODDATA");
const T_PARTICLESDATA = CRC32.bstr("PARTICLESDATA");
// extra data union
const E_USERDATA = CRC32.bstr("USERDEFINE");

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

export type TotemNode = ReturnType<typeof readNode>;