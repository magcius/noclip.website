import { DataStream } from "./util";

export function readWarp(data: DataStream) {
    return {
        size: data.readFloat32(),
        material_ids: data.readArrayStatic(data.readInt32, 6),
        vertices: data.readArrayStatic(data.readVec3, 8),
        texcoords: data.readArrayStatic(data.readVec2, 4),
    }
}

export type TotemWarp = ReturnType<typeof readWarp>;

const _warp_faces = [ 
	[4, 7, 5, 6], // +Y (top)
	[1, 2, 0, 3], // -Y (bottom)
	[5, 6, 1, 2], // -Z (front)
	[4, 5, 0, 1], // -X (left)
	[6, 7, 2, 3], // +X (right)
	[7, 4, 3, 0], // +Z (back)
]

const _warp_normals = [
    [ 0, -1,  0],
    [ 0,  1,  0],
    [ 0,  0,  1],
    [ 1,  0,  0],
    [-1,  0,  0],
    [ 0,  0, -1],
]

export function *iterWarpSkybox(warp: TotemWarp) {
    for (let i = 0; i < 6; i++) {
        yield {
            normal: _warp_normals[i],
            positions: _warp_faces[i].map(j => warp.vertices[j]),
            texcoords: warp.texcoords,
            material: warp.material_ids[i],
        }
    }
}