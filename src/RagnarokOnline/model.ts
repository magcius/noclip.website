
// Builds a flat, per-texture-grouped mesh from an RSM model's node hierarchy.
// RO's fixed-function math is row-vector (v' = v * M, transforms compose
// left-to-right); gl-matrix is column-vector (v' = M * v, compose right-to-left).
// We rebuild the same transforms in column-major form by reversing the source
// order — e.g. row-vector L = S * R * P (scale, then rotate, then translate)
// becomes the column-major sequence T * R * S built via post-multiplying helpers.
// Per-placement world matrix is applied at draw time, not baked here.

import { mat4, quat, vec3 } from "gl-matrix";
import { AABB } from "../Geometry.js";
import { RsmModel, RsmNode } from "./rsm.js";
import { RswVec3 } from "./rsw.js";

// L_node (column-major) for "v' = v_row * S * R * P" (apply scale, rotate, translate).
// In column-vector form that's T(p) * R * S * v, so we build T*R*S via post-multiplies.
function nodeLocal(n: RsmNode, out: mat4): void {
    mat4.fromTranslation(out, [n.position.x, n.position.y, n.position.z]);
    mat4.rotate(out, out, n.rotAngle, [n.rotAxis.x, n.rotAxis.y, n.rotAxis.z]);
    mat4.scale(out, out, [n.scale.x, n.scale.y, n.scale.z]);
}

// Build column-major L from explicit S/R/P parts (used by the animated path).
function nodeLocalFromParts(scale: vec3, rot: mat4, pos: vec3, out: mat4): void {
    mat4.fromTranslation(out, pos);
    mat4.multiply(out, out, rot);
    mat4.scale(out, out, scale);
}

// Node's baked offset transform: vertices go through this before the node's
// accumulated transform. RSM stores offsetMatrix as 3x3 row-major; convert to
// the column-vector equivalent (transpose) and pack the translation column.
// `m_col[col*4+row] = m_row[col*3+row]` because row-vector m_row 3x3 in
// row-major storage `m[row*3+col]` is the same data as col-vector m_col in
// column-major storage `m_col[col*4+row]` — they're the same buffer.
function nodeOffset(n: RsmNode, out: mat4): void {
    const m = n.offsetMatrix;
    out[0]  = m[0]; out[1]  = m[1]; out[2]  = m[2]; out[3]  = 0;
    out[4]  = m[3]; out[5]  = m[4]; out[6]  = m[5]; out[7]  = 0;
    out[8]  = m[6]; out[9]  = m[7]; out[10] = m[8]; out[11] = 0;
    out[12] = n.offsetTranslation.x;
    out[13] = n.offsetTranslation.y;
    out[14] = n.offsetTranslation.z;
    out[15] = 1;
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
    bbox: AABB;
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
        vec3.set(v1, a.x, a.y, a.z);
        vec3.set(v2, b.x, b.y, b.z);
        vec3.set(v3, c.x, c.y, c.z);
        vec3.sub(e1, v3, v2);
        vec3.sub(e2, v3, v1);
        vec3.cross(fn, e1, e2);
        const len = vec3.length(fn);
        if (len > 0)
            vec3.scale(fn, fn, 1 / len);
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

// Transforms a direction by the linear part of `m` (column-major mat4) and
// normalizes. Uses mat3.fromMat4 to extract the upper-left 3x3.
function transformNormalMat4(m: mat4, x: number, y: number, z: number, out: vec3): void {
    // Column-major mat4: linear at indices 0,1,2,4,5,6,8,9,10.
    out[0] = x * m[0] + y * m[4] + z * m[8];
    out[1] = x * m[1] + y * m[5] + z * m[9];
    out[2] = x * m[2] + y * m[6] + z * m[10];
    const len = Math.hypot(out[0], out[1], out[2]);
    if (len > 0) {
        out[0] /= len; out[1] /= len; out[2] /= len;
    }
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

// Topologically order nodes parent-before-child; resolveParents guarantees no
// cycles (dangling/self-parents become -1).
function topoOrder(parentIdx: Int32Array): Int32Array {
    const n = parentIdx.length;
    const order = new Int32Array(n);
    const depth = new Int32Array(n).fill(-1);
    const computeDepth = (i: number): number => {
        if (depth[i] !== -1) return depth[i];
        const p = parentIdx[i];
        depth[i] = p === -1 ? 0 : computeDepth(p) + 1;
        return depth[i];
    };
    for (let i = 0; i < n; i++) computeDepth(i);
    const idx = new Int32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    // Stable sort by depth so siblings keep input order.
    const arr = Array.from(idx).sort((a, b) => depth[a] - depth[b]);
    for (let i = 0; i < n; i++) order[i] = arr[i];
    return order;
}

// Composes M_node = M_parent (column-major) * L_node, iterating parent-first.
// Row-vector hierarchy `M_node_row = L_node_row * M_parent_row` transposes to
// the column-major form `M_node_col = M_parent_col * L_node_col`.
function composeNodeMatrices(nodeCount: number, parentIdx: Int32Array, local: (idx: number, out: mat4) => void): mat4[] {
    const nodeMat: mat4[] = new Array(nodeCount);
    for (let i = 0; i < nodeCount; i++) nodeMat[i] = mat4.create();
    const order = topoOrder(parentIdx);
    const tmp = mat4.create();
    for (let oi = 0; oi < order.length; oi++) {
        const i = order[oi];
        local(i, tmp);
        const p = parentIdx[i];
        if (p === -1)
            mat4.copy(nodeMat[i], tmp);
        else
            mat4.multiply(nodeMat[i], nodeMat[p], tmp);
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
    const bbox = new AABB();

    if (nodeCount === 0) {
        bbox.set(0, 0, 0, 0, 0, 0);
        return {
            vertexData: new ArrayBuffer(0),
            indexData: new Uint32Array(0),
            groups: [],
            textureNames: model.textures.slice(),
            bbox,
        };
    }

    const parentIdx = resolveParents(model);
    const nodeMat = composeNodeMatrices(nodeCount, parentIdx, (idx, out) => nodeLocal(model.nodes[idx], out));

    const out = vec3.create();
    const nrm = vec3.create();
    const vt = mat4.create();
    const offset = mat4.create();
    for (let ni = 0; ni < nodeCount; ni++) {
        const n = model.nodes[ni];
        const M = nodeMat[ni];

        // Row-vector: v = v_raw * offset * M_node. Column-vector equivalent:
        // vt_col = M_col * offset_col.
        nodeOffset(n, offset);
        mat4.multiply(vt, M, offset);

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
                vec3.set(out, px, py, pz);
                vec3.transformMat4(out, out, vt);
                vx.push(out[0]); vy.push(out[1]); vz.push(out[2]);
                bbox.unionPoint(out);

                let u = 0, v = 0;
                if (ti < n.texCoords.length) {
                    u = n.texCoords[ti].u;
                    v = n.texCoords[ti].v;
                }
                vu.push(u); vv.push(v);

                const cn = nodeNormals[faceIdx * 3 + k];
                transformNormalMat4(vt, cn[0], cn[1], cn[2], nrm);
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

    if (vx.length === 0)
        bbox.set(0, 0, 0, 0, 0, 0);

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
        bbox,
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
    bbox: AABB,
    pos: RswVec3, rot: RswVec3, scale: RswVec3,
    mapOffX: number, mapOffZ: number,
    out: mat4,
): void {
    const offX = -(bbox.min[0] + bbox.max[0]) * 0.5;
    const offY = -bbox.max[1];
    const offZ = -(bbox.min[2] + bbox.max[2]) * 0.5;

    const deg = Math.PI / 180;
    // Row-vector source: T(off) * S * Ry * Rx * Rz * T(pos). Column-major
    // equivalent (transpose, reverse): T(pos) * Rz * Rx * Ry * S * T(off).
    mat4.fromTranslation(out, [pos.x, pos.y, pos.z]);
    mat4.rotateZ(out, out, rot.z * deg);
    mat4.rotateX(out, out, rot.x * deg);
    mat4.rotateY(out, out, rot.y * deg);
    mat4.scale(out, out, [scale.x, scale.y, scale.z]);
    mat4.translate(out, out, [offX, offY, offZ]);

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
    offset: mat4;
    // Static channel values, reused when a channel has no keyframes.
    staticRot: mat4;
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
    bbox: AABB;
}

// Bbox is taken over the rest pose (frame 0) so the placement matrix anchors
// the model exactly as the static path would at start.
export function buildAnimatedModelMesh(model: RsmModel): AnimatedModelMesh {
    const nodeCount = model.nodes.length;
    const parentIdx = resolveParents(model);

    const nodes: AnimatedNode[] = new Array(nodeCount);
    for (let i = 0; i < nodeCount; i++) {
        const n = model.nodes[i];
        const offset = mat4.create();
        nodeOffset(n, offset);
        const staticRot = mat4.create();
        mat4.fromRotation(staticRot, n.rotAngle, [n.rotAxis.x, n.rotAxis.y, n.rotAxis.z]);
        nodes[i] = {
            parentIdx: parentIdx[i],
            offset,
            staticRot,
            staticPos: vec3.fromValues(n.position.x, n.position.y, n.position.z),
            staticScale: vec3.fromValues(n.scale.x, n.scale.y, n.scale.z),
            posKeyframes: n.posKeyframes.map((k) => ({ frame: k.frame, p: vec3.fromValues(k.p.x, k.p.y, k.p.z) })),
            rotKeyframes: n.rotKeyframes.map((k) => ({ frame: k.frame, q: quat.fromValues(k.q[0], k.q[1], k.q[2], k.q[3]) })),
            scaleKeyframes: n.scaleKeyframes.map((k) => ({ frame: k.frame, s: vec3.fromValues(k.s.x, k.s.y, k.s.z) })),
        };
    }

    // Rest-pose locals for bbox (uses first keyframe value where present).
    const restRot = mat4.create();
    const restScale = vec3.create();
    const restPos = vec3.create();
    const restLocal = (idx: number, out: mat4): void => {
        const an = nodes[idx];
        if (an.scaleKeyframes.length > 0)
            vec3.copy(restScale, an.scaleKeyframes[0].s);
        else
            vec3.copy(restScale, an.staticScale);
        if (an.rotKeyframes.length > 0)
            mat4.fromQuat(restRot, an.rotKeyframes[0].q);
        else
            mat4.copy(restRot, an.staticRot);
        if (an.posKeyframes.length > 0)
            vec3.copy(restPos, an.posKeyframes[0].p);
        else
            vec3.copy(restPos, an.staticPos);
        nodeLocalFromParts(restScale, restRot, restPos, out);
    };
    const restNodeMat = composeNodeMatrices(nodeCount, parentIdx, restLocal);

    const vx: number[] = [], vy: number[] = [], vz: number[] = [];
    const vu: number[] = [], vv: number[] = [];
    const vnx: number[] = [], vny: number[] = [], vnz: number[] = [];
    const vcol: number[] = [];

    const bbox = new AABB();

    const groups: AnimatedDrawGroup[] = [];
    const groupKey = new Map<string, number[]>();
    const groupMeta = new Map<string, { nodeIndex: number, textureId: number }>();

    const localOut = vec3.create();
    const restOut = vec3.create();
    const nrm = vec3.create();
    const restVT = mat4.create();
    for (let ni = 0; ni < nodeCount; ni++) {
        const n = model.nodes[ni];
        const offset = nodes[ni].offset;          // node-local: raw * offset only
        // Row-vector: restVT = offset * restNodeMat. Column-vector: restNodeMat * offset.
        mat4.multiply(restVT, restNodeMat[ni], offset);

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
                vec3.set(localOut, px, py, pz);
                vec3.transformMat4(localOut, localOut, offset);
                vx.push(localOut[0]); vy.push(localOut[1]); vz.push(localOut[2]);

                vec3.set(restOut, px, py, pz);
                vec3.transformMat4(restOut, restOut, restVT);
                bbox.unionPoint(restOut);

                let u = 0, v = 0;
                if (ti < n.texCoords.length) {
                    u = n.texCoords[ti].u;
                    v = n.texCoords[ti].v;
                }
                vu.push(u); vv.push(v);

                // Node-local normal; shader rotates by the node's animated mat.
                const cn = nodeNormals[faceIdx * 3 + k];
                transformNormalMat4(offset, cn[0], cn[1], cn[2], nrm);
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

    if (vx.length === 0)
        bbox.set(0, 0, 0, 0, 0, 0);

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
        bbox,
    };
}

// Interpolates a node's keyframes at `frame` (wrapped into [0, animLength)).
// Channels without keyframes fall back to their static value.
function animatedLocal(an: AnimatedNode, frame: number, scratchQ: quat, scratchRot: mat4, out: mat4): void {
    if (an.rotKeyframes.length > 0) {
        const kfs = an.rotKeyframes;
        if (kfs.length === 1) {
            mat4.fromQuat(scratchRot, kfs[0].q);
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
            mat4.fromQuat(scratchRot, scratchQ);
        }
    } else {
        mat4.copy(scratchRot, an.staticRot);
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

    // Row-vector L = S * R * P -> column-major T(p) * R * S.
    mat4.fromTranslation(out, [px, py, pz]);
    mat4.multiply(out, out, scratchRot);
    mat4.scale(out, out, [sx, sy, sz]);
}

export class AnimatedPose {
    private scratchQ = quat.create();
    private scratchRot = mat4.create();

    constructor(private mesh: AnimatedModelMesh) {
    }

    public evaluate(frame: number, out: mat4[]): void {
        const nodes = this.mesh.nodes;
        const nodeCount = nodes.length;
        while (out.length < nodeCount)
            out.push(mat4.create());

        const local: mat4[] = new Array(nodeCount);
        for (let i = 0; i < nodeCount; i++) {
            local[i] = mat4.create();
            animatedLocal(nodes[i], frame, this.scratchQ, this.scratchRot, local[i]);
        }

        const parents = new Int32Array(nodeCount);
        for (let i = 0; i < nodeCount; i++) parents[i] = nodes[i].parentIdx;
        const nodeMat = composeNodeMatrices(nodeCount, parents, (idx, dst) => mat4.copy(dst, local[idx]));

        for (let i = 0; i < nodeCount; i++)
            mat4.copy(out[i], nodeMat[i]);
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
