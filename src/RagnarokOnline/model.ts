import { mat4, quat, vec3 } from "gl-matrix";
import { AABB } from "../Geometry.js";
import { transformVec3Mat4w0 } from "../MathHelpers.js";
import { assert } from "../util.js";
import { RsmModel, RsmNode } from "./rsm.js";
import { RswVec3 } from "./rsw.js";

function nodeLocal(n: RsmNode, out: mat4): void {
    mat4.fromTranslation(out, [n.position.x, n.position.y, n.position.z]);
    mat4.rotate(out, out, n.rotAngle, [n.rotAxis.x, n.rotAxis.y, n.rotAxis.z]);
    mat4.scale(out, out, [n.scale.x, n.scale.y, n.scale.z]);
}

function nodeLocalFromParts(scale: vec3, rot: mat4, pos: vec3, out: mat4): void {
    mat4.fromTranslation(out, pos);
    mat4.multiply(out, out, rot);
    mat4.scale(out, out, scale);
}

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

function modelUsesRsm2Transforms(model: RsmModel): boolean {
    return model.major > 2 || (model.major === 2 && model.minor >= 2);
}

export interface ModelDrawGroup {
    textureId: number;
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

export const MODEL_VERTEX_STRIDE_BYTES = 3 * 4 + 2 * 4 + 3 * 4 + 4;

function computeNodeNormals(n: RsmNode, shadeType: number): vec3[] {
    const faceCount = n.faces.length;
    const out: vec3[] = new Array(faceCount * 3);

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

function transformNormalMat4(m: mat4, v: vec3, out: vec3): void {
    transformVec3Mat4w0(out, m, v);
    const len = Math.hypot(out[0], out[1], out[2]);
    if (len > 0) {
        out[0] /= len; out[1] /= len; out[2] /= len;
    }
}

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

function composeNodeMatrices(nodeCount: number, parentIdx: Int32Array, local: (idx: number, out: mat4) => void): mat4[] {
    const nodeMat: mat4[] = new Array(nodeCount);
    for (let i = 0; i < nodeCount; i++) nodeMat[i] = mat4.create();
    const tmp = mat4.create();
    for (let i = 0; i < nodeCount; i++) {
        assert(parentIdx[i] < i, `RSM node ${i} has parent ${parentIdx[i]} >= self`);
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
    const vcol: number[] = [];

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

    const parentIdx = modelUsesRsm2Transforms(model) ? new Int32Array(nodeCount).fill(-1) : resolveParents(model);
    const nodeMat = composeNodeMatrices(nodeCount, parentIdx, (idx, out) => nodeLocal(model.nodes[idx], out));

    const out = vec3.create();
    const nrm = vec3.create();
    const vt = mat4.create();
    const offset = mat4.create();
    for (let ni = 0; ni < nodeCount; ni++) {
        const n = model.nodes[ni];
        const M = nodeMat[ni];

        nodeOffset(n, offset);
        mat4.multiply(vt, M, offset);

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
                transformNormalMat4(vt, cn, nrm);
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

    mat4.fromTranslation(out, [pos.x, pos.y, pos.z]);
    mat4.rotateZ(out, out, rot.z * deg);
    mat4.rotateX(out, out, rot.x * deg);
    mat4.rotateY(out, out, rot.y * deg);
    mat4.scale(out, out, [scale.x, scale.y, scale.z]);
    mat4.translate(out, out, [offX, offY, offZ]);

    out[1] = -out[1]; out[5] = -out[5]; out[9] = -out[9]; out[13] = -out[13];
    out[12] += mapOffX;
    out[14] += mapOffZ;

    out[0] = -out[0]; out[4] = -out[4]; out[8] = -out[8];
    out[12] = 2 * mapOffX - out[12];
}

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
    animLength: number;
    modernRsm2: boolean;
    bbox: AABB;
}

export interface AnimatedPoseMesh {
    nodes: AnimatedNode[];
    modernRsm2: boolean;
}

function sampleRotationKeyframes(an: AnimatedNode, frame: number, scratchQ: quat, out: mat4): boolean {
    if (an.rotKeyframes.length === 0) {
        mat4.copy(out, an.staticRot);
        return false;
    }

    const kfs = an.rotKeyframes;
    if (kfs.length === 1) {
        mat4.fromQuat(out, kfs[0].q);
        return true;
    }

    let i = 0;
    while (i < kfs.length - 1 && kfs[i + 1].frame <= frame)
        i++;
    const a = kfs[i];
    const b = kfs[Math.min(i + 1, kfs.length - 1)];
    const span = b.frame - a.frame;
    const t = span > 0 ? (frame - a.frame) / span : 0;
    quat.slerp(scratchQ, a.q, b.q, Math.max(0, Math.min(1, t)));
    quat.normalize(scratchQ, scratchQ);
    mat4.fromQuat(out, scratchQ);
    return true;
}

function samplePositionKeyframes(an: AnimatedNode, frame: number, out: vec3): boolean {
    if (an.posKeyframes.length === 0) {
        vec3.copy(out, an.staticPos);
        return false;
    }

    const kfs = an.posKeyframes;
    if (kfs.length === 1) {
        vec3.copy(out, kfs[0].p);
        return true;
    }

    let i = 0;
    while (i < kfs.length - 1 && kfs[i + 1].frame <= frame)
        i++;
    const a = kfs[i], b = kfs[Math.min(i + 1, kfs.length - 1)];
    const span = b.frame - a.frame;
    const t = span > 0 ? Math.max(0, Math.min(1, (frame - a.frame) / span)) : 0;
    out[0] = a.p[0] + (b.p[0] - a.p[0]) * t;
    out[1] = a.p[1] + (b.p[1] - a.p[1]) * t;
    out[2] = a.p[2] + (b.p[2] - a.p[2]) * t;
    return true;
}

function sampleScaleKeyframes(an: AnimatedNode, out: vec3): boolean {
    if (an.scaleKeyframes.length === 0) {
        vec3.copy(out, an.staticScale);
        return false;
    }

    vec3.copy(out, an.scaleKeyframes[0].s);
    return true;
}

export function buildAnimatedModelMesh(model: RsmModel): AnimatedModelMesh {
    const nodeCount = model.nodes.length;
    const parentIdx = resolveParents(model);
    const modernRsm2 = modelUsesRsm2Transforms(model);

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

    let restNodeMat: mat4[];
    if (modernRsm2) {
        restNodeMat = new Array(nodeCount);
        for (let i = 0; i < nodeCount; i++)
            restNodeMat[i] = mat4.create();
        evaluateRsm2NodeMatrices(nodes, 0, restNodeMat, quat.create());
    } else {
        const restRot = mat4.create();
        const restScale = vec3.create();
        const restPos = vec3.create();
        const restQ = quat.create();
        const restLocal = (idx: number, out: mat4): void => {
            const an = nodes[idx];
            sampleScaleKeyframes(an, restScale);
            sampleRotationKeyframes(an, 0, restQ, restRot);
            samplePositionKeyframes(an, 0, restPos);
            nodeLocalFromParts(restScale, restRot, restPos, out);
        };
        restNodeMat = composeNodeMatrices(nodeCount, parentIdx, restLocal);
    }

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
        const offset = nodes[ni].offset;
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
                vec3.set(localOut, px, py, pz);
                if (!modernRsm2)
                    vec3.transformMat4(localOut, localOut, offset);
                vx.push(localOut[0]); vy.push(localOut[1]); vz.push(localOut[2]);

                vec3.set(restOut, px, py, pz);
                if (modernRsm2)
                    vec3.transformMat4(restOut, restOut, restNodeMat[ni]);
                else
                    vec3.transformMat4(restOut, restOut, restVT);
                bbox.unionPoint(restOut);

                let u = 0, v = 0;
                if (ti < n.texCoords.length) {
                    u = n.texCoords[ti].u;
                    v = n.texCoords[ti].v;
                }
                vu.push(u); vv.push(v);

                const cn = nodeNormals[faceIdx * 3 + k];
                if (modernRsm2) {
                    vnx.push(cn[0]); vny.push(cn[1]); vnz.push(cn[2]);
                } else {
                    transformNormalMat4(offset, cn, nrm);
                    vnx.push(nrm[0]); vny.push(nrm[1]); vnz.push(nrm[2]);
                }

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
        modernRsm2,
        bbox,
    };
}

function animatedLocal(an: AnimatedNode, frame: number, scratchQ: quat, scratchRot: mat4, scratchScale: vec3, scratchPos: vec3, out: mat4): void {
    sampleRotationKeyframes(an, frame, scratchQ, scratchRot);
    samplePositionKeyframes(an, frame, scratchPos);
    sampleScaleKeyframes(an, scratchScale);

    mat4.fromTranslation(out, scratchPos);
    mat4.multiply(out, out, scratchRot);
    mat4.scale(out, out, scratchScale);
}

function invertOrIdentity(out: mat4, m: mat4): void {
    if (mat4.invert(out, m) === null)
        mat4.identity(out);
}

function evaluateRsm2NodeMatrices(nodes: AnimatedNode[], frame: number, out: mat4[], scratchQ: quat): void {
    const nodeCount = nodes.length;
    while (out.length < nodeCount)
        out.push(mat4.create());

    const meshLinear: mat4[] = new Array(nodeCount);
    const chain: mat4[] = new Array(nodeCount);
    const local: mat4[] = new Array(nodeCount);
    const scratchRot = mat4.create();
    const scratchScale = vec3.create();
    const scratchPos = vec3.create();
    const parentInv = mat4.create();
    const delta = vec3.create();

    for (let i = 0; i < nodeCount; i++) {
        meshLinear[i] = mat4.create();
        chain[i] = mat4.create();
        local[i] = mat4.create();
    }

    for (let i = 0; i < nodeCount; i++) {
        const an = nodes[i];
        const p = an.parentIdx;
        const hasRot = sampleRotationKeyframes(an, frame, scratchQ, scratchRot);
        const hasScale = sampleScaleKeyframes(an, scratchScale);

        if (hasRot) {
            mat4.copy(meshLinear[i], scratchRot);
            mat4.scale(meshLinear[i], meshLinear[i], scratchScale);
        } else {
            if (p >= 0) {
                invertOrIdentity(parentInv, nodes[p].offset);
                mat4.multiply(meshLinear[i], parentInv, an.offset);
            } else {
                mat4.copy(meshLinear[i], an.offset);
            }
            if (hasScale)
                mat4.scale(meshLinear[i], meshLinear[i], scratchScale);
        }

        const hasPos = samplePositionKeyframes(an, frame, scratchPos);
        if (!hasPos && p >= 0) {
            vec3.subtract(delta, an.staticPos, nodes[p].staticPos);
            invertOrIdentity(parentInv, nodes[p].offset);
            vec3.transformMat4(scratchPos, delta, parentInv);
        }

        mat4.fromTranslation(local[i], scratchPos);
        mat4.multiply(local[i], local[i], meshLinear[i]);

        if (p >= 0)
            mat4.multiply(chain[i], chain[p], meshLinear[p]);
        else
            mat4.identity(chain[i]);

        mat4.multiply(out[i], chain[i], local[i]);
        if (p >= 0) {
            out[i][12] += out[p][12];
            out[i][13] += out[p][13];
            out[i][14] += out[p][14];
        }
    }
}

export class AnimatedPose {
    private scratchQ = quat.create();
    private scratchRot = mat4.create();
    private scratchScale = vec3.create();
    private scratchPos = vec3.create();

    constructor(private mesh: AnimatedPoseMesh) {
    }

    public evaluate(frame: number, out: mat4[]): void {
        const nodes = this.mesh.nodes;
        const nodeCount = nodes.length;
        while (out.length < nodeCount)
            out.push(mat4.create());

        if (this.mesh.modernRsm2) {
            evaluateRsm2NodeMatrices(nodes, frame, out, this.scratchQ);
            return;
        }

        const local: mat4[] = new Array(nodeCount);
        for (let i = 0; i < nodeCount; i++) {
            local[i] = mat4.create();
            animatedLocal(nodes[i], frame, this.scratchQ, this.scratchRot, this.scratchScale, this.scratchPos, local[i]);
        }
        const parents = new Int32Array(nodeCount);
        for (let i = 0; i < nodeCount; i++) parents[i] = nodes[i].parentIdx;
        const nodeMat = composeNodeMatrices(nodeCount, parents, (idx, dst) => mat4.copy(dst, local[idx]));

        for (let i = 0; i < nodeCount; i++)
            mat4.copy(out[i], nodeMat[i]);
    }
}

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

        const dt = dtSeconds > 1.0 ? 1.0 : dtSeconds;
        this.frame += this.framesPerSecond * dt;
        if (this.frame >= this.animLength)
            this.frame -= this.animLength * Math.floor(this.frame / this.animLength);
    }

    public get currentFrame(): number {
        return this.frame;
    }
}
