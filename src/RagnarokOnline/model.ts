
// Builds a flat, per-texture-grouped mesh from an RSM model's node hierarchy.
//
// Each RSM node has a local transform (translation, axis-angle rotation, scale)
// and is parented to another node by name, forming a tree. A node's vertices are
// first put through its baked offset transform, then through the node's
// accumulated world-relative transform (its local transform composed up the
// parent chain), producing model-local positions. Faces are grouped by the
// model-level texture they resolve to, so each unique texture draws in one call
// — the same pattern the terrain renderer uses.
//
// RO's fixed-function math is row-vector (a point is v' = v * M, transforms
// compose left-to-right). We keep that convention here with a small affine type
// so the composition order matches the engine exactly, then convert to a
// gl-matrix column-major mat4 (transposing the linear part, translation in the
// last column) for GPU upload. The per-placement world matrix is applied
// separately at draw time, not baked here.

import { mat4, quat, vec3 } from "gl-matrix";
import { RsmModel, RsmNode } from "./rsm.js";

// Row-vector affine: 3x3 linear part `r` (row-major, r[row*3+col]) plus a
// translation `t`. Matches RO's fixed-function transform convention.
interface Affine {
    r: Float32Array; // length 9, row-major
    t: Float32Array; // length 3
}

function affineIdentity(): Affine {
    const r = new Float32Array(9);
    r[0] = r[4] = r[8] = 1;
    return { r, t: new Float32Array(3) };
}

// result = a * b (row-vector composition: applies `a` then `b`).
function affineMultiply(a: Affine, b: Affine): Affine {
    const r = new Float32Array(9);
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
            r[row * 3 + col] =
                a.r[row * 3 + 0] * b.r[0 * 3 + col] +
                a.r[row * 3 + 1] * b.r[1 * 3 + col] +
                a.r[row * 3 + 2] * b.r[2 * 3 + col];
        }
    }
    const t = new Float32Array(3);
    for (let col = 0; col < 3; col++) {
        t[col] =
            a.t[0] * b.r[0 * 3 + col] +
            a.t[1] * b.r[1 * 3 + col] +
            a.t[2] * b.r[2 * 3 + col] + b.t[col];
    }
    return { r, t };
}

function affineTranslate(x: number, y: number, z: number): Affine {
    const m = affineIdentity();
    m.t[0] = x; m.t[1] = y; m.t[2] = z;
    return m;
}

function affineScale(x: number, y: number, z: number): Affine {
    const r = new Float32Array(9);
    r[0] = x; r[4] = y; r[8] = z;
    return { r, t: new Float32Array(3) };
}

// Axis-angle rotation as a unit quaternion (q = (axis*sin(a/2), cos(a/2))),
// matching the engine's node-rotation matrix builder.
function affineRotAxisAngle(axis: RsmNodeAxis, angle: number): Affine {
    const omega = angle * 0.5;
    const s = Math.sin(omega);
    const qx = axis.x * s, qy = axis.y * s, qz = axis.z * s;
    const qw = Math.cos(omega);
    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2;
    const yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const r = new Float32Array(9);
    r[0] = 1 - (yy + zz); r[1] = xy + wz;       r[2] = xz - wy;
    r[3] = xy - wz;       r[4] = 1 - (xx + zz); r[5] = yz + wx;
    r[6] = xz + wy;       r[7] = yz - wx;       r[8] = 1 - (xx + yy);
    return { r, t: new Float32Array(3) };
}

type RsmNodeAxis = { x: number, y: number, z: number };

// Transforms a row-vector point: out = v * M.
function affineTransform(m: Affine, x: number, y: number, z: number, out: vec3): void {
    out[0] = x * m.r[0] + y * m.r[3] + z * m.r[6] + m.t[0];
    out[1] = x * m.r[1] + y * m.r[4] + z * m.r[7] + m.t[1];
    out[2] = x * m.r[2] + y * m.r[5] + z * m.r[8] + m.t[2];
}

// A node's local transform, composed L = scale * rot * pos (row-vector order).
function nodeLocal(n: RsmNode): Affine {
    const s = affineScale(n.scale.x, n.scale.y, n.scale.z);
    const r = affineRotAxisAngle(n.rotAxis, n.rotAngle);
    const p = affineTranslate(n.position.x, n.position.y, n.position.z);
    return affineMultiply(affineMultiply(s, r), p);
}

// A unit quaternion (x,y,z,w) as a row-vector rotation affine. Mirrors the
// matrix the engine builds from a node's axis-angle, but driven by an explicit
// quaternion (used for the interpolated keyframe rotation).
function affineRotQuat(qx: number, qy: number, qz: number, qw: number): Affine {
    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2;
    const yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const r = new Float32Array(9);
    r[0] = 1 - (yy + zz); r[1] = xy + wz;       r[2] = xz - wy;
    r[3] = xy - wz;       r[4] = 1 - (xx + zz); r[5] = yz + wx;
    r[6] = xz + wy;       r[7] = yz - wx;       r[8] = 1 - (xx + yy);
    return { r, t: new Float32Array(3) };
}

// Converts a row-vector affine to a gl-matrix column-major mat4. Row-vector
// v*M equals column-vector M_col*v with M_col = transpose of the linear part.
export function affineToMat4(m: Affine, out: mat4): void {
    mat4.identity(out);
    for (let col = 0; col < 3; col++)
        for (let row = 0; row < 3; row++)
            out[col * 4 + row] = m.r[col * 3 + row];
    out[12] = m.t[0];
    out[13] = m.t[1];
    out[14] = m.t[2];
}

export interface ModelDrawGroup {
    textureId: number;   // index into ModelMesh.textureNames
    indexOffset: number;
    indexCount: number;
}

export interface ModelMesh {
    vertexData: ArrayBuffer;
    indexData: Uint32Array;
    groups: ModelDrawGroup[];
    textureNames: string[];
    bboxMin: vec3;
    bboxMax: vec3;
}

// Per-vertex stride: position (3 f32), UV (2 f32), normal (3 f32), color (4 u8).
// 36 bytes.
export const MODEL_VERTEX_STRIDE_BYTES = 3 * 4 + 2 * 4 + 3 * 4 + 4;

// Per-node smooth-shaded normals, mirroring the engine's RSM lighting:
//   - Each face's geometric normal is cross(v3-v2, v3-v1), normalized.
//   - shadeType 0 (none): no lighting; the shader leaves the vertex full-bright,
//     so the stored normal is unused (zeroed here).
//   - shadeType 1 (flat): every vertex of a face takes that face's normal.
//   - shadeType 2 (gouraud): a vertex's normal is the sum of the face normals of
//     all faces in the SAME smoothing group that touch that vertex, normalized.
//     Faces in different smoothing groups never share a normal, so a hard edge
//     between two groups stays hard.
// Returns one normal per face-corner (3 per face), in the node's local vertex
// space (same space the positions are computed from), in face order.
function computeNodeNormals(n: RsmNode, shadeType: number): vec3[] {
    const faceCount = n.faces.length;
    const out: vec3[] = new Array(faceCount * 3);

    // Geometric face normals from the raw node vertices.
    const faceNormal: vec3[] = new Array(faceCount);
    const v1 = vec3.create(), v2 = vec3.create(), v3 = vec3.create();
    const e1 = vec3.create(), e2 = vec3.create();
    for (let i = 0; i < faceCount; i++) {
        const f = n.faces[i];
        const fn = vec3.create();
        const a = n.vertices[f.vertIdx[0]], b = n.vertices[f.vertIdx[1]], c = n.vertices[f.vertIdx[2]];
        if (a !== undefined && b !== undefined && c !== undefined) {
            vec3.set(v1, a.x, a.y, a.z);
            vec3.set(v2, b.x, b.y, b.z);
            vec3.set(v3, c.x, c.y, c.z);
            // cross(v3-v2, v3-v1), matching the engine.
            vec3.sub(e1, v3, v2);
            vec3.sub(e2, v3, v1);
            vec3.cross(fn, e1, e2);
            const len = vec3.length(fn);
            if (len > 0)
                vec3.scale(fn, fn, 1 / len);
        }
        faceNormal[i] = fn;
    }

    if (shadeType !== 2) {
        // shadeType 0/1: every corner uses the face normal (0 leaves it unused).
        for (let i = 0; i < faceCount; i++)
            for (let k = 0; k < 3; k++)
                out[i * 3 + k] = vec3.clone(faceNormal[i]);
        return out;
    }

    // Gouraud: accumulate per smoothing group. For each (group, vertex) sum the
    // group's touching face normals; each face corner then reads its vertex's
    // group-accumulated normal. A face belongs to exactly one group, so we
    // evaluate each face under its own group.
    const vertCount = n.vertices.length;
    // group -> (vertexIndex -> accumulated normal)
    const groupVertNormals = new Map<number, vec3[]>();
    for (let i = 0; i < faceCount; i++) {
        const g = n.faces[i].smoothGroup;
        let acc = groupVertNormals.get(g);
        if (acc === undefined) {
            acc = new Array(vertCount);
            for (let v = 0; v < vertCount; v++)
                acc[v] = vec3.create();
            groupVertNormals.set(g, acc);
        }
        const fn = faceNormal[i];
        const f = n.faces[i];
        for (let k = 0; k < 3; k++) {
            const vi = f.vertIdx[k];
            if (vi >= 0 && vi < vertCount)
                vec3.add(acc[vi], acc[vi], fn);
        }
    }
    // Normalize each accumulated normal once.
    for (const acc of groupVertNormals.values()) {
        for (let v = 0; v < vertCount; v++) {
            const len = vec3.length(acc[v]);
            if (len > 0)
                vec3.scale(acc[v], acc[v], 1 / len);
        }
    }
    for (let i = 0; i < faceCount; i++) {
        const f = n.faces[i];
        const acc = groupVertNormals.get(f.smoothGroup)!;
        for (let k = 0; k < 3; k++) {
            const vi = f.vertIdx[k];
            const vn = (vi >= 0 && vi < vertCount && vec3.length(acc[vi]) > 0) ? acc[vi] : faceNormal[i];
            out[i * 3 + k] = vec3.clone(vn);
        }
    }
    return out;
}

// Transforms a normal (direction) by an affine's linear part: out = n * R
// (row-vector), then normalized. Translation is irrelevant for directions.
function affineTransformNormal(m: Affine, x: number, y: number, z: number, out: vec3): void {
    out[0] = x * m.r[0] + y * m.r[3] + z * m.r[6];
    out[1] = x * m.r[1] + y * m.r[4] + z * m.r[7];
    out[2] = x * m.r[2] + y * m.r[5] + z * m.r[8];
    const len = Math.hypot(out[0], out[1], out[2]);
    if (len > 0) {
        out[0] /= len; out[1] /= len; out[2] /= len;
    }
}

// The node's baked offset transform. offsetMatrix is the row-major 3x3 linear
// part; offsetTranslation is its bottom-row translation. Vertices go through
// this before the node's accumulated transform.
function nodeOffset(n: RsmNode): Affine {
    return {
        r: new Float32Array([
            n.offsetMatrix[0], n.offsetMatrix[1], n.offsetMatrix[2],
            n.offsetMatrix[3], n.offsetMatrix[4], n.offsetMatrix[5],
            n.offsetMatrix[6], n.offsetMatrix[7], n.offsetMatrix[8],
        ]),
        t: new Float32Array([n.offsetTranslation.x, n.offsetTranslation.y, n.offsetTranslation.z]),
    };
}

// Resolves the parent tree by name. First occurrence wins for duplicate names.
// parentIdx[i] = -1 means root (empty parent, self-parent, or dangling parent).
function resolveParents(model: RsmModel): Int32Array {
    const nodeCount = model.nodes.length;
    const nameToIdx = new Map<string, number>();
    for (let i = 0; i < nodeCount; i++)
        if (!nameToIdx.has(model.nodes[i].name))
            nameToIdx.set(model.nodes[i].name, i);

    const parentIdx = new Int32Array(nodeCount).fill(-1);
    for (let i = 0; i < nodeCount; i++) {
        const n = model.nodes[i];
        if (n.parent === "" || n.parent === n.name) continue;
        const p = nameToIdx.get(n.parent);
        if (p === undefined || p === i) continue;
        parentIdx[i] = p;
    }
    return parentIdx;
}

// Composes each node's world-relative matrix M_node = L_node * M_parent
// (row-vector hierarchy), where L_node is supplied by `local(idx)` and the
// parent chain is followed via `parentOf(idx)` (-1 == no parent). Memoized up
// the chain and cycle-guarded so each node is computed once. Used both at
// build time (static locals + Int32Array parents) and per-frame (animated
// locals + nodes[].parentIdx).
function composeNodeMatrices(nodeCount: number, parentOf: (idx: number) => number, local: (idx: number) => Affine): Affine[] {
    const nodeMat: Affine[] = new Array(nodeCount);
    const state = new Uint8Array(nodeCount); // 0=unvisited, 1=in-progress, 2=done
    for (let start = 0; start < nodeCount; start++) {
        if (state[start] === 2) continue;
        const chain: number[] = [];
        let cur = start;
        while (cur !== -1 && state[cur] === 0) {
            state[cur] = 1;
            chain.push(cur);
            cur = parentOf(cur);
        }
        let base = (cur !== -1 && state[cur] === 2) ? nodeMat[cur] : affineIdentity();
        for (let i = chain.length - 1; i >= 0; i--) {
            const idx = chain[i];
            base = affineMultiply(local(idx), base);
            nodeMat[idx] = base;
            state[idx] = 2;
        }
    }
    return nodeMat;
}

export function buildModelMesh(model: RsmModel): ModelMesh {
    const nodeCount = model.nodes.length;

    const vx: number[] = [], vy: number[] = [], vz: number[] = [];
    const vu: number[] = [], vv: number[] = [];
    const vnx: number[] = [], vny: number[] = [], vnz: number[] = [];
    const vcol: number[] = []; // packed 0xAABBGGRR for the byte view

    const buckets = new Map<number, number[]>();
    const bboxMin = vec3.fromValues(Infinity, Infinity, Infinity);
    const bboxMax = vec3.fromValues(-Infinity, -Infinity, -Infinity);
    let haveBbox = false;

    if (nodeCount === 0) {
        vec3.set(bboxMin, 0, 0, 0);
        vec3.set(bboxMax, 0, 0, 0);
        return {
            vertexData: new ArrayBuffer(0),
            indexData: new Uint32Array(0),
            groups: [],
            textureNames: model.textures.slice(),
            bboxMin, bboxMax,
        };
    }

    const parentIdx = resolveParents(model);

    // Accumulate M_node = L_node * M_parent (row-vector hierarchy) from each
    // node's static local transform.
    const nodeMat = composeNodeMatrices(nodeCount, (idx) => parentIdx[idx], (idx) => nodeLocal(model.nodes[idx]));

    const out = vec3.create();
    const nrm = vec3.create();
    for (let ni = 0; ni < nodeCount; ni++) {
        const n = model.nodes[ni];
        const M = nodeMat[ni];

        // The offset transform baked into vertices at load: v = v_raw * offset,
        // then * M_node.
        const vt = affineMultiply(nodeOffset(n), M);

        // Per-corner normals in node-local vertex space, baked into the same
        // mesh frame as the positions (offset * node transform, rotation only).
        const nodeNormals = computeNodeNormals(n, model.shadeType);

        let faceIdx = 0;
        for (const f of n.faces) {
            // Resolve the face's per-node texture slot to a model-level index.
            let modelTex = 0;
            if (f.textureId < n.textureIds.length)
                modelTex = n.textureIds[f.textureId];
            else if (f.textureId < model.textures.length)
                modelTex = f.textureId;

            const baseIndex = vx.length;
            for (let k = 0; k < 3; k++) {
                const vi = f.vertIdx[k];
                const ti = f.texIdx[k];
                let px = 0, py = 0, pz = 0;
                if (vi < n.vertices.length) {
                    px = n.vertices[vi].x; py = n.vertices[vi].y; pz = n.vertices[vi].z;
                }
                affineTransform(vt, px, py, pz, out);
                vx.push(out[0]); vy.push(out[1]); vz.push(out[2]);

                if (!haveBbox) {
                    vec3.copy(bboxMin, out); vec3.copy(bboxMax, out); haveBbox = true;
                } else {
                    if (out[0] < bboxMin[0]) bboxMin[0] = out[0];
                    if (out[1] < bboxMin[1]) bboxMin[1] = out[1];
                    if (out[2] < bboxMin[2]) bboxMin[2] = out[2];
                    if (out[0] > bboxMax[0]) bboxMax[0] = out[0];
                    if (out[1] > bboxMax[1]) bboxMax[1] = out[1];
                    if (out[2] > bboxMax[2]) bboxMax[2] = out[2];
                }

                let u = 0, v = 0;
                if (ti < n.texCoords.length) {
                    u = n.texCoords[ti].u;
                    v = n.texCoords[ti].v;
                }
                vu.push(u); vv.push(v);

                // Bake the node-local corner normal into the mesh frame (the
                // linear part of offset * node transform).
                const cn = nodeNormals[faceIdx * 3 + k];
                affineTransformNormal(vt, cn[0], cn[1], cn[2], nrm);
                vnx.push(nrm[0]); vny.push(nrm[1]); vnz.push(nrm[2]);

                // White vertex color; the model's per-face/per-vertex tint is not
                // used by the reference fragment beyond a passthrough multiply.
                vcol.push(0xFFFFFFFF);
            }

            let bucket = buckets.get(modelTex);
            if (bucket === undefined) {
                bucket = [];
                buckets.set(modelTex, bucket);
            }
            bucket.push(baseIndex + 0, baseIndex + 1, baseIndex + 2);
            faceIdx++;
        }
    }

    if (!haveBbox) {
        vec3.set(bboxMin, 0, 0, 0);
        vec3.set(bboxMax, 0, 0, 0);
    }

    // Pack interleaved vertex data: pos(3) + uv(2) + normal(3) + color(1 u32) =
    // 9 32-bit words = 36 bytes per vertex.
    const vertexCount = vx.length;
    const vertexData = new ArrayBuffer(vertexCount * MODEL_VERTEX_STRIDE_BYTES);
    const fview = new Float32Array(vertexData);
    const uview = new Uint32Array(vertexData);
    for (let i = 0; i < vertexCount; i++) {
        const fo = i * 9;
        fview[fo + 0] = vx[i];
        fview[fo + 1] = vy[i];
        fview[fo + 2] = vz[i];
        fview[fo + 3] = vu[i];
        fview[fo + 4] = vv[i];
        fview[fo + 5] = vnx[i];
        fview[fo + 6] = vny[i];
        fview[fo + 7] = vnz[i];
        uview[fo + 8] = vcol[i] >>> 0;
    }

    // Concatenate index buckets (sorted by texture id) into one index buffer.
    const groups: ModelDrawGroup[] = [];
    const indices: number[] = [];
    const sortedIds = Array.from(buckets.keys()).sort((a, b) => a - b);
    for (const textureId of sortedIds) {
        const bucket = buckets.get(textureId)!;
        groups.push({ textureId, indexOffset: indices.length, indexCount: bucket.length });
        for (const idx of bucket)
            indices.push(idx);
    }

    return {
        vertexData,
        indexData: new Uint32Array(indices),
        groups,
        textureNames: model.textures.slice(),
        bboxMin, bboxMax,
    };
}

// Builds the per-placement world matrix in the terrain's render frame, mirroring
// the engine's actor-matrix build:
//   wtm = T(boxOffset) * S * Ry * Rx * Rz * T(pos)   (row-vector order)
// then mapped to the render frame: render = (ro.x + offX, -ro.y, ro.z + offZ).
// boxOffset anchors the model by its object-space bounding box (X/Z centered on
// the box center, Y pinned to the box top) before scale/rotation/placement.
//
// offX/offZ are half the map extent (center -> corner shift): the RSW frame is
// centered on the map while the terrain is built corner-origin with world Y =
// -height, so this shift + Y negate lands models in the exact terrain frame.
export function buildPlacementMatrix(
    bboxMin: vec3, bboxMax: vec3,
    pos: RswVec3Like, rot: RswVec3Like, scale: RswVec3Like,
    mapOffX: number, mapOffZ: number,
    out: mat4,
): void {
    const offX = -(bboxMin[0] + bboxMax[0]) * 0.5;
    const offY = -bboxMax[1];
    const offZ = -(bboxMin[2] + bboxMax[2]) * 0.5;

    const deg = Math.PI / 180;
    let wtm = affineTranslate(offX, offY, offZ);
    wtm = affineMultiply(wtm, affineScale(scale.x, scale.y, scale.z));
    wtm = affineMultiply(wtm, rotY(rot.y * deg));
    wtm = affineMultiply(wtm, rotX(rot.x * deg));
    wtm = affineMultiply(wtm, rotZ(rot.z * deg));
    wtm = affineMultiply(wtm, affineTranslate(pos.x, pos.y, pos.z));

    affineToMat4(wtm, out);

    // RO-frame -> render-frame: negate Y, shift X/Z by half the map extent.
    // Equivalent to ro_to_render * world, applied as a column-major pre-multiply.
    // ro_to_render only scales Y by -1 and adds (offX, 0, offZ) translation, so
    // we fold it in directly: row 1 (Y outputs) negate, then add the offsets.
    out[1] = -out[1]; out[5] = -out[5]; out[9] = -out[9]; out[13] = -out[13];
    out[12] += mapOffX;
    out[14] += mapOffZ;

    // Mirror X about the map centre (W = 2*mapOffX): RO is left-handed, this
    // renderer right-handed, so the whole world is mirrored to read correctly
    // (matching the terrain mesh and the sun direction; see coord.ts). Negating
    // the X-output row also flips the model's own geometry and normals, so the
    // prop's facade faces the right way; the sun's X is negated to match.
    out[0] = -out[0]; out[4] = -out[4]; out[8] = -out[8];
    out[12] = 2 * mapOffX - out[12];
}

type RswVec3Like = { x: number, y: number, z: number };

// Row-vector axis rotations matching the engine's fixed-function builders.
function rotX(angle: number): Affine {
    const c = Math.cos(angle), s = Math.sin(angle);
    const m = affineIdentity();
    m.r[4] = c; m.r[5] = s;
    m.r[7] = -s; m.r[8] = c;
    return m;
}
function rotY(angle: number): Affine {
    const c = Math.cos(angle), s = Math.sin(angle);
    const m = affineIdentity();
    m.r[0] = c; m.r[2] = -s;
    m.r[6] = s; m.r[8] = c;
    return m;
}
function rotZ(angle: number): Affine {
    const c = Math.cos(angle), s = Math.sin(angle);
    const m = affineIdentity();
    m.r[0] = c; m.r[1] = s;
    m.r[3] = -s; m.r[4] = c;
    return m;
}

// === Keyframe-animated models ============================================
//
// Some RSM nodes carry keyframe tracks (rotation, and from later versions
// position/scale) that spin or shift them over a looping animation. A model is
// "animated" if any node has any keyframe track. Such models can't be baked to
// one static mesh: each animated node's transform changes every frame.
//
// Geometry for animated models is therefore left in NODE-LOCAL space (raw
// vertices through the node's offset transform only, WITHOUT the composed node
// transform) and grouped per (node, texture). At draw time the renderer computes
// each node's animated world-relative matrix M_node(t) and draws that node's
// groups with u_WorldFromModel = placement * M_node(t). The static-mesh path is
// untouched; only models with keyframes take this branch.

// True if any node in the model carries any keyframe track.
export function modelIsAnimated(model: RsmModel): boolean {
    return model.nodes.some((n) =>
        n.rotKeyframes.length > 0 || n.posKeyframes.length > 0 || n.scaleKeyframes.length > 0);
}

// One draw group of an animated model: a run of indices belonging to a single
// (node, texture) pair, sharing the model's one vertex/index buffer.
export interface AnimatedDrawGroup {
    nodeIndex: number;
    textureId: number;   // index into textureNames
    indexOffset: number;
    indexCount: number;
}

// The static per-node data the renderer needs to evaluate M_node(t): the parent
// link, the baked offset transform, the static local transform (fallback for
// channels without keyframes), and the keyframe tracks.
export interface AnimatedNode {
    parentIdx: number;
    offset: Affine;
    // Static channel values, reused when a channel has no keyframes. staticRot is
    // the node's axis-angle rotation as a rotation-only affine.
    staticRot: Affine;
    staticPos: vec3;
    staticScale: vec3;
    posKeyframes: { frame: number, p: vec3 }[];
    rotKeyframes: { frame: number, q: quat }[];
    scaleKeyframes: { frame: number, s: vec3 }[];
}

export interface AnimatedModelMesh {
    vertexData: ArrayBuffer;
    indexData: Uint32Array;
    groups: AnimatedDrawGroup[];
    textureNames: string[];
    nodes: AnimatedNode[];
    animLength: number;  // loop length in frames (>= 1)
    bboxMin: vec3;
    bboxMax: vec3;
}

// Builds an animated model's geometry: per-(node,texture) groups with node-local
// vertices, plus the node metadata + loop length the renderer evaluates each
// frame. The bounding box is taken over the rest pose (frame 0) so the placement
// matrix anchors the model exactly as the static path would at start.
export function buildAnimatedModelMesh(model: RsmModel): AnimatedModelMesh {
    const nodeCount = model.nodes.length;
    const parentIdx = resolveParents(model);

    // Build the per-node runtime data. The static local stays as the engine's
    // scale*rot*pos so non-keyframed channels keep their rest value; the rotation
    // axis-angle is kept separately so a node without rotation keyframes still
    // rotates by its static rotation.
    const nodes: AnimatedNode[] = new Array(nodeCount);
    for (let i = 0; i < nodeCount; i++) {
        const n = model.nodes[i];
        nodes[i] = {
            parentIdx: parentIdx[i],
            offset: nodeOffset(n),
            staticRot: affineRotAxisAngle(n.rotAxis, n.rotAngle),
            staticPos: vec3.fromValues(n.position.x, n.position.y, n.position.z),
            staticScale: vec3.fromValues(n.scale.x, n.scale.y, n.scale.z),
            posKeyframes: n.posKeyframes.map((k) => ({ frame: k.frame, p: vec3.fromValues(k.p.x, k.p.y, k.p.z) })),
            rotKeyframes: n.rotKeyframes.map((k) => ({ frame: k.frame, q: quat.fromValues(k.q[0], k.q[1], k.q[2], k.q[3]) })),
            scaleKeyframes: n.scaleKeyframes.map((k) => ({ frame: k.frame, s: vec3.fromValues(k.s.x, k.s.y, k.s.z) })),
        };
    }

    // Rest-pose node matrices (frame 0) for the bounding box, mirroring the
    // composition the per-frame evaluator does.
    const restLocal = (idx: number): Affine => {
        const an = nodes[idx];
        let sx = an.staticScale[0], sy = an.staticScale[1], sz = an.staticScale[2];
        if (an.scaleKeyframes.length > 0) {
            const s0 = an.scaleKeyframes[0].s; sx = s0[0]; sy = s0[1]; sz = s0[2];
        }
        const rot = an.rotKeyframes.length > 0
            ? affineRotQuat(an.rotKeyframes[0].q[0], an.rotKeyframes[0].q[1], an.rotKeyframes[0].q[2], an.rotKeyframes[0].q[3])
            : an.staticRot;
        let px = an.staticPos[0], py = an.staticPos[1], pz = an.staticPos[2];
        if (an.posKeyframes.length > 0) {
            const p0 = an.posKeyframes[0].p; px = p0[0]; py = p0[1]; pz = p0[2];
        }
        return affineMultiply(affineMultiply(affineScale(sx, sy, sz), rot), affineTranslate(px, py, pz));
    };
    const restNodeMat = composeNodeMatrices(nodeCount, (idx) => parentIdx[idx], restLocal);

    const vx: number[] = [], vy: number[] = [], vz: number[] = [];
    const vu: number[] = [], vv: number[] = [];
    const vnx: number[] = [], vny: number[] = [], vnz: number[] = [];
    const vcol: number[] = [];

    const bboxMin = vec3.fromValues(Infinity, Infinity, Infinity);
    const bboxMax = vec3.fromValues(-Infinity, -Infinity, -Infinity);
    let haveBbox = false;

    // Index buckets keyed by node*K+texture so each (node, texture) is its own
    // contiguous group. Track insertion to keep groups stable & sorted by node.
    const groups: AnimatedDrawGroup[] = [];
    const groupKey = new Map<string, number[]>();   // key -> index list
    const groupMeta = new Map<string, { nodeIndex: number, textureId: number }>();

    const localOut = vec3.create();
    const restOut = vec3.create();
    const nrm = vec3.create();
    for (let ni = 0; ni < nodeCount; ni++) {
        const n = model.nodes[ni];
        const offset = nodes[ni].offset;       // node-local: raw * offset only
        const restVT = affineMultiply(offset, restNodeMat[ni]); // for bbox only

        // Node-local corner normals; the renderer transforms them by the node's
        // animated world matrix in the shader (positions stay node-local too).
        const nodeNormals = computeNodeNormals(n, model.shadeType);

        let faceIdx = 0;
        for (const f of n.faces) {
            let modelTex = 0;
            if (f.textureId < n.textureIds.length)
                modelTex = n.textureIds[f.textureId];
            else if (f.textureId < model.textures.length)
                modelTex = f.textureId;

            const baseIndex = vx.length;
            for (let k = 0; k < 3; k++) {
                const vi = f.vertIdx[k];
                const ti = f.texIdx[k];
                let px = 0, py = 0, pz = 0;
                if (vi < n.vertices.length) {
                    px = n.vertices[vi].x; py = n.vertices[vi].y; pz = n.vertices[vi].z;
                }
                // Stored position: node-local (raw * offset), no node transform.
                affineTransform(offset, px, py, pz, localOut);
                vx.push(localOut[0]); vy.push(localOut[1]); vz.push(localOut[2]);

                // Bounding box from the rest-pose world-relative position.
                affineTransform(restVT, px, py, pz, restOut);
                if (!haveBbox) {
                    vec3.copy(bboxMin, restOut); vec3.copy(bboxMax, restOut); haveBbox = true;
                } else {
                    if (restOut[0] < bboxMin[0]) bboxMin[0] = restOut[0];
                    if (restOut[1] < bboxMin[1]) bboxMin[1] = restOut[1];
                    if (restOut[2] < bboxMin[2]) bboxMin[2] = restOut[2];
                    if (restOut[0] > bboxMax[0]) bboxMax[0] = restOut[0];
                    if (restOut[1] > bboxMax[1]) bboxMax[1] = restOut[1];
                    if (restOut[2] > bboxMax[2]) bboxMax[2] = restOut[2];
                }

                let u = 0, v = 0;
                if (ti < n.texCoords.length) {
                    u = n.texCoords[ti].u;
                    v = n.texCoords[ti].v;
                }
                vu.push(u); vv.push(v);

                // Node-local normal (offset rotation only), to be rotated by the
                // node's animated world matrix in the shader.
                const cn = nodeNormals[faceIdx * 3 + k];
                affineTransformNormal(offset, cn[0], cn[1], cn[2], nrm);
                vnx.push(nrm[0]); vny.push(nrm[1]); vnz.push(nrm[2]);

                vcol.push(0xFFFFFFFF);
            }

            const key = `${ni}:${modelTex}`;
            let bucket = groupKey.get(key);
            if (bucket === undefined) {
                bucket = [];
                groupKey.set(key, bucket);
                groupMeta.set(key, { nodeIndex: ni, textureId: modelTex });
            }
            bucket.push(baseIndex + 0, baseIndex + 1, baseIndex + 2);
            faceIdx++;
        }
    }

    if (!haveBbox) {
        vec3.set(bboxMin, 0, 0, 0);
        vec3.set(bboxMax, 0, 0, 0);
    }

    // Pack vertex data (same layout as the static mesh: pos, uv, normal, color).
    const vertexCount = vx.length;
    const vertexData = new ArrayBuffer(vertexCount * MODEL_VERTEX_STRIDE_BYTES);
    const fview = new Float32Array(vertexData);
    const uview = new Uint32Array(vertexData);
    for (let i = 0; i < vertexCount; i++) {
        const fo = i * 9;
        fview[fo + 0] = vx[i];
        fview[fo + 1] = vy[i];
        fview[fo + 2] = vz[i];
        fview[fo + 3] = vu[i];
        fview[fo + 4] = vv[i];
        fview[fo + 5] = vnx[i];
        fview[fo + 6] = vny[i];
        fview[fo + 7] = vnz[i];
        uview[fo + 8] = vcol[i] >>> 0;
    }

    // Concatenate buckets ordered by (node, texture) into one index buffer.
    const indices: number[] = [];
    const keys = Array.from(groupKey.keys()).sort((a, b) => {
        const ma = groupMeta.get(a)!, mb = groupMeta.get(b)!;
        return ma.nodeIndex !== mb.nodeIndex ? ma.nodeIndex - mb.nodeIndex : ma.textureId - mb.textureId;
    });
    for (const key of keys) {
        const bucket = groupKey.get(key)!;
        const meta = groupMeta.get(key)!;
        groups.push({ nodeIndex: meta.nodeIndex, textureId: meta.textureId, indexOffset: indices.length, indexCount: bucket.length });
        for (const idx of bucket)
            indices.push(idx);
    }

    const animLength = Math.max(1, model.animLength);

    return {
        vertexData,
        indexData: new Uint32Array(indices),
        groups,
        textureNames: model.textures.slice(),
        nodes,
        animLength,
        bboxMin, bboxMax,
    };
}

// Interpolates a node's keyframe tracks at frame time `frame` (already wrapped
// into [0, animLength)) and returns its animated local transform. Channels
// without keyframes fall back to the static value: rotation to the node's static
// axis-angle, position/scale to their static values.
function animatedLocal(an: AnimatedNode, frame: number, scratchQ: quat): Affine {
    // Rotation: slerp between the bracketing keyframes.
    let rot: Affine;
    if (an.rotKeyframes.length > 0) {
        const kfs = an.rotKeyframes;
        if (kfs.length === 1) {
            const q = kfs[0].q;
            rot = affineRotQuat(q[0], q[1], q[2], q[3]);
        } else {
            let i = 0;
            while (i < kfs.length - 1 && kfs[i + 1].frame <= frame)
                i++;
            const a = kfs[i];
            const b = kfs[Math.min(i + 1, kfs.length - 1)];
            const span = b.frame - a.frame;
            const t = span > 0 ? (frame - a.frame) / span : 0;
            quat.slerp(scratchQ, a.q, b.q, Math.max(0, Math.min(1, t)));
            quat.normalize(scratchQ, scratchQ);
            rot = affineRotQuat(scratchQ[0], scratchQ[1], scratchQ[2], scratchQ[3]);
        }
    } else {
        rot = an.staticRot;
    }

    // Position: lerp between bracketing keyframes, else static.
    let px = an.staticPos[0], py = an.staticPos[1], pz = an.staticPos[2];
    if (an.posKeyframes.length > 0) {
        const kfs = an.posKeyframes;
        if (kfs.length === 1) {
            px = kfs[0].p[0]; py = kfs[0].p[1]; pz = kfs[0].p[2];
        } else {
            let i = 0;
            while (i < kfs.length - 1 && kfs[i + 1].frame <= frame)
                i++;
            const a = kfs[i], b = kfs[Math.min(i + 1, kfs.length - 1)];
            const span = b.frame - a.frame;
            const t = span > 0 ? Math.max(0, Math.min(1, (frame - a.frame) / span)) : 0;
            px = a.p[0] + (b.p[0] - a.p[0]) * t;
            py = a.p[1] + (b.p[1] - a.p[1]) * t;
            pz = a.p[2] + (b.p[2] - a.p[2]) * t;
        }
    }

    // Scale: the original takes the first scale key (or the static scale when
    // there are none) and does not interpolate scale across keyframes.
    let sx = an.staticScale[0], sy = an.staticScale[1], sz = an.staticScale[2];
    if (an.scaleKeyframes.length > 0) {
        const k = an.scaleKeyframes[0];
        sx = k.s[0]; sy = k.s[1]; sz = k.s[2];
    }

    const s = affineScale(sx, sy, sz);
    const p = affineTranslate(px, py, pz);
    return affineMultiply(affineMultiply(s, rot), p);
}

// Evaluates every node's animated world-relative matrix at frame time `frame`
// and writes them, as gl-matrix column-major mat4s, into `out` (one per node,
// resized as needed). The matrices are M_node(t) = L_node(t) * M_parent(t) in
// row-vector order; multiply a placement matrix on their left at draw time.
export class AnimatedPose {
    private scratchQ = quat.create();

    constructor(private mesh: AnimatedModelMesh) {
    }

    // Composes the node matrices at `frame` (in [0, animLength)) into `out`.
    public evaluate(frame: number, out: mat4[]): void {
        const nodes = this.mesh.nodes;
        const nodeCount = nodes.length;
        while (out.length < nodeCount)
            out.push(mat4.create());

        // Pre-evaluate per-node animated local so the shared compose walk
        // (also used by the build-time composition) can index it without
        // re-running animatedLocal up parent chains.
        const local: Affine[] = new Array(nodeCount);
        for (let i = 0; i < nodeCount; i++)
            local[i] = animatedLocal(nodes[i], frame, this.scratchQ);

        const nodeMat = composeNodeMatrices(nodeCount, (idx) => nodes[idx].parentIdx, (idx) => local[idx]);

        for (let i = 0; i < nodeCount; i++)
            affineToMat4(nodeMat[i], out[i]);
    }
}

// Drives an animated model's frame clock off real elapsed time, independent of
// the render rate. Map props always loop, wrapping at the model's loop length.
// The C++ client advances `m_curMotion += animSpeed * 100` once per game tick;
// we fold the tick rate into a per-second cursor rate and apply it smoothly
// per render frame (`frame += framesPerSecond * dt`), so playback is identical
// at any render rate and never snaps between updates.
//
// TICK_RATE is the effective per-second tick count we're modelling. The C++
// InitTimer(60) sets a 60 Hz target but g_frameskip=0 (default) means the
// game's actual tick rate is just the render rate. Empirically (compared
// against a live iRO server) prop animation lands at ~10 Hz — alberta's
// pickaxes loop ~2.5x slower than the C++ formula at 60 Hz would predict.
// This also matches the canonical roBrowser/BrowEdit rate (1000 cursor units
// per second for animSpeed=1, which equals animSpeed * (4/3) * 100 * 10 ≈
// 1333 units/sec with the engine's 4/3 prefactor).
//
// The RSW placement's anim_speed is scaled by 4/3 before use (the original
// applies this when building a map actor), and a speed of 0 means the prop
// never advances — it holds the rest pose (frame 0). The placement's anim_type
// field is not used for map props: they always loop.
export class ModelAnimator {
    private static readonly TICK_RATE = 10;

    private frame = 0;
    private framesPerSecond: number;

    constructor(private animLength: number, animSpeed: number) {
        if (this.animLength < 1)
            this.animLength = 1;
        // Map-actor speed scaling: 0 stays 0 (static), otherwise * 4/3. The 100
        // is the original per-tick cursor step; * TICK_RATE folds it into a
        // per-second rate applied continuously per frame.
        const effectiveSpeed = animSpeed !== 0 ? animSpeed * (4 / 3) : 0;
        this.framesPerSecond = effectiveSpeed * 100 * ModelAnimator.TICK_RATE;
    }

    public update(dtSeconds: number): void {
        if (this.framesPerSecond === 0)
            return; // anim_speed 0: frozen at the rest pose.

        // Clamp dt so a long stall (backgrounded tab) cannot leap the cursor
        // forward by an arbitrary amount.
        const dt = dtSeconds > 1.0 ? 1.0 : dtSeconds;
        this.frame += this.framesPerSecond * dt;
        if (this.frame >= this.animLength)
            this.frame -= this.animLength * Math.floor(this.frame / this.animLength);
    }

    public get currentFrame(): number {
        return this.frame;
    }
}
