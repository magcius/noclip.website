
// Builds a flat, per-texture-grouped mesh from an RSM model's node hierarchy.
// RO's fixed-function math is row-vector (v' = v * M, transforms compose
// left-to-right); we mirror that with a small Affine type, then convert to a
// gl-matrix column-major mat4 for upload. Per-placement world matrix is
// applied at draw time, not baked here.

import { mat4, quat, vec3 } from "gl-matrix";
import { RsmModel, RsmNode } from "./rsm.js";

// Row-vector affine: 3x3 linear part `r` (row-major, r[row*3+col]) + translation.
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

// out = v * M.
function affineTransform(m: Affine, x: number, y: number, z: number, out: vec3): void {
    out[0] = x * m.r[0] + y * m.r[3] + z * m.r[6] + m.t[0];
    out[1] = x * m.r[1] + y * m.r[4] + z * m.r[7] + m.t[1];
    out[2] = x * m.r[2] + y * m.r[5] + z * m.r[8] + m.t[2];
}

// L_node = scale * rot * pos (row-vector order).
function nodeLocal(n: RsmNode): Affine {
    const s = affineScale(n.scale.x, n.scale.y, n.scale.z);
    const r = affineRotAxisAngle(n.rotAxis, n.rotAngle);
    const p = affineTranslate(n.position.x, n.position.y, n.position.z);
    return affineMultiply(affineMultiply(s, r), p);
}

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

// Row-vector v*M equals column-vector M_col*v with M_col = transpose of the
// linear part.
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

// position (3 f32) + UV (2 f32) + normal (3 f32) + color (4 u8) = 36 bytes.
export const MODEL_VERTEX_STRIDE_BYTES = 3 * 4 + 2 * 4 + 3 * 4 + 4;

// Per-node smooth-shaded normals, mirroring the engine's RSM lighting:
//   shadeType 0 (none): unused, zeroed.
//   shadeType 1 (flat): every corner of a face takes the face's normal.
//   shadeType 2 (gouraud): a vertex's normal sums the face normals of all
//     faces in the SAME smoothing group touching that vertex, then normalize.
// Returns one normal per face-corner (3 per face), in node-local space.
function computeNodeNormals(n: RsmNode, shadeType: number): vec3[] {
    const faceCount = n.faces.length;
    const out: vec3[] = new Array(faceCount * 3);

    // Geometric face normal = cross(v3-v2, v3-v1), normalized (matches engine).
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
        for (let i = 0; i < faceCount; i++)
            for (let k = 0; k < 3; k++)
                out[i * 3 + k] = vec3.clone(faceNormal[i]);
        return out;
    }

    // Gouraud: accumulate per smoothing group.
    const vertCount = n.vertices.length;
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

// out = n * R (row-vector), then normalized.
function affineTransformNormal(m: Affine, x: number, y: number, z: number, out: vec3): void {
    out[0] = x * m.r[0] + y * m.r[3] + z * m.r[6];
    out[1] = x * m.r[1] + y * m.r[4] + z * m.r[7];
    out[2] = x * m.r[2] + y * m.r[5] + z * m.r[8];
    const len = Math.hypot(out[0], out[1], out[2]);
    if (len > 0) {
        out[0] /= len; out[1] /= len; out[2] /= len;
    }
}

// Node's baked offset transform: vertices go through this before the node's
// accumulated transform.
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

// parentIdx[i] = -1 means root (empty parent, self-parent, or dangling parent).
// First occurrence wins for duplicate node names.
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

// Composes M_node = L_node * M_parent (row-vector hierarchy). Memoized up the
// chain and cycle-guarded so each node is computed once. Used both at build
// time (static locals) and per-frame (animated locals).
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
    const nodeMat = composeNodeMatrices(nodeCount, (idx) => parentIdx[idx], (idx) => nodeLocal(model.nodes[idx]));

    const out = vec3.create();
    const nrm = vec3.create();
    for (let ni = 0; ni < nodeCount; ni++) {
        const n = model.nodes[ni];
        const M = nodeMat[ni];

        // v = v_raw * offset * M_node.
        const vt = affineMultiply(nodeOffset(n), M);

        const nodeNormals = computeNodeNormals(n, model.shadeType);

        let faceIdx = 0;
        for (const f of n.faces) {
            // Resolve face's per-node texture slot to a model-level index.
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

                const cn = nodeNormals[faceIdx * 3 + k];
                affineTransformNormal(vt, cn[0], cn[1], cn[2], nrm);
                vnx.push(nrm[0]); vny.push(nrm[1]); vnz.push(nrm[2]);

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

    // Interleaved vertex: pos(3) + uv(2) + normal(3) + color(1 u32) = 9 32-bit
    // words = 36 bytes per vertex.
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

// Builds per-placement world matrix in the terrain's render frame, mirroring
// the engine's actor-matrix build:
//   wtm = T(boxOffset) * S * Ry * Rx * Rz * T(pos)   (row-vector order)
// then mapped to render frame: render = (ro.x + offX, -ro.y, ro.z + offZ).
// boxOffset anchors the model by its object-space bbox (X/Z centered, Y
// pinned to box top). mapOffX/mapOffZ are half the map extent: the RSW frame
// is map-centered while the terrain is corner-origin (see coord.ts).
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
    out[1] = -out[1]; out[5] = -out[5]; out[9] = -out[9]; out[13] = -out[13];
    out[12] += mapOffX;
    out[14] += mapOffZ;

    // Mirror X about the map centre (W = 2*mapOffX): RO is left-handed, this
    // renderer right-handed, so the whole world is mirrored (matching the
    // terrain mesh and sun direction; see coord.ts).
    out[0] = -out[0]; out[4] = -out[4]; out[8] = -out[8];
    out[12] = 2 * mapOffX - out[12];
}

type RswVec3Like = { x: number, y: number, z: number };

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

// Keyframe-animated models: nodes with rotation/position/scale tracks. Such
// models can't be baked statically — geometry stays in NODE-LOCAL space and is
// grouped per (node, texture); the renderer composes M_node(t) per frame.

export function modelIsAnimated(model: RsmModel): boolean {
    return model.nodes.some((n) =>
        n.rotKeyframes.length > 0 || n.posKeyframes.length > 0 || n.scaleKeyframes.length > 0);
}

export interface AnimatedDrawGroup {
    nodeIndex: number;
    textureId: number;
    indexOffset: number;
    indexCount: number;
}

export interface AnimatedNode {
    parentIdx: number;
    offset: Affine;
    // Static channel values, reused when a channel has no keyframes.
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

// Bbox is taken over the rest pose (frame 0) so the placement matrix anchors
// the model exactly as the static path would at start.
export function buildAnimatedModelMesh(model: RsmModel): AnimatedModelMesh {
    const nodeCount = model.nodes.length;
    const parentIdx = resolveParents(model);

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

    // Rest-pose locals for bbox (uses first keyframe value where present).
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

    const groups: AnimatedDrawGroup[] = [];
    const groupKey = new Map<string, number[]>();
    const groupMeta = new Map<string, { nodeIndex: number, textureId: number }>();

    const localOut = vec3.create();
    const restOut = vec3.create();
    const nrm = vec3.create();
    for (let ni = 0; ni < nodeCount; ni++) {
        const n = model.nodes[ni];
        const offset = nodes[ni].offset;       // node-local: raw * offset only
        const restVT = affineMultiply(offset, restNodeMat[ni]); // for bbox only

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

                // Node-local normal; shader rotates by the node's animated mat.
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

// Interpolates a node's keyframes at `frame` (wrapped into [0, animLength)).
// Channels without keyframes fall back to their static value.
function animatedLocal(an: AnimatedNode, frame: number, scratchQ: quat): Affine {
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

    // Scale: original takes the first scale key (or static) and does not
    // interpolate across keyframes.
    let sx = an.staticScale[0], sy = an.staticScale[1], sz = an.staticScale[2];
    if (an.scaleKeyframes.length > 0) {
        const k = an.scaleKeyframes[0];
        sx = k.s[0]; sy = k.s[1]; sz = k.s[2];
    }

    const s = affineScale(sx, sy, sz);
    const p = affineTranslate(px, py, pz);
    return affineMultiply(affineMultiply(s, rot), p);
}

export class AnimatedPose {
    private scratchQ = quat.create();

    constructor(private mesh: AnimatedModelMesh) {
    }

    public evaluate(frame: number, out: mat4[]): void {
        const nodes = this.mesh.nodes;
        const nodeCount = nodes.length;
        while (out.length < nodeCount)
            out.push(mat4.create());

        const local: Affine[] = new Array(nodeCount);
        for (let i = 0; i < nodeCount; i++)
            local[i] = animatedLocal(nodes[i], frame, this.scratchQ);

        const nodeMat = composeNodeMatrices(nodeCount, (idx) => nodes[idx].parentIdx, (idx) => local[idx]);

        for (let i = 0; i < nodeCount; i++)
            affineToMat4(nodeMat[i], out[i]);
    }
}

// Drives an animated model's frame clock off real elapsed time. The C++ client
// advances m_curMotion += animSpeed * 100 per game tick; we fold the tick rate
// into a per-second cursor rate so playback is identical at any render rate.
//
// TICK_RATE: empirically ~10 Hz against a live iRO server (alberta's pickaxes
// loop ~2.5x slower than the C++ 60 Hz formula would predict). Also matches
// the canonical roBrowser/BrowEdit rate. anim_speed is scaled by 4/3 (engine
// applies this when building a map actor); 0 stays 0 (frozen at frame 0).
export class ModelAnimator {
    private static readonly TICK_RATE = 10;

    private frame = 0;
    private framesPerSecond: number;

    constructor(private animLength: number, animSpeed: number) {
        if (this.animLength < 1)
            this.animLength = 1;
        const effectiveSpeed = animSpeed !== 0 ? animSpeed * (4 / 3) : 0;
        this.framesPerSecond = effectiveSpeed * 100 * ModelAnimator.TICK_RATE;
    }

    public update(dtSeconds: number): void {
        if (this.framesPerSecond === 0)
            return;

        // Clamp dt so a long stall (backgrounded tab) can't leap the cursor.
        const dt = dtSeconds > 1.0 ? 1.0 : dtSeconds;
        this.frame += this.framesPerSecond * dt;
        if (this.frame >= this.animLength)
            this.frame -= this.animLength * Math.floor(this.frame / this.animLength);
    }

    public get currentFrame(): number {
        return this.frame;
    }
}
