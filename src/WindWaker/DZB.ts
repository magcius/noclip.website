
// "DolZel Background"

// Collision data for objects and rooms.

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert } from "../util";
import { vec3 } from "gl-matrix";
import { Endianness } from "../endian";

const enum OctreeNodeType {
    BRANCH = 0x00,
    LEAF = 0x01,
}

interface OctreeBranchNode {
    nodeType: OctreeNodeType.BRANCH;
    children: (OctreeNode | null)[];
}

interface OctreeLeafNode {
    nodeType: OctreeNodeType.LEAF;
    faceStart: number;
    faceCount: number;
}

type OctreeNode = OctreeBranchNode | OctreeLeafNode;

export interface DZB {
    pos: vec3;
    octreeRoot: OctreeNode;
    vertexData: Float32Array;
    faceData: Uint16Array;
    faceCount: number;
}

export function parse(buffer: ArrayBufferSlice): DZB {
    const view = buffer.createDataView();

    const vertexCount = view.getUint32(0x00);
    const vertexOffs = view.getUint32(0x04);
    const triCount = view.getUint32(0x08);
    const triOffs = view.getUint32(0x0C);
    const blkCount = view.getUint32(0x10);
    const blkOffs = view.getUint32(0x14);
    const nodeTreeCount = view.getUint32(0x18);
    const nodeTreeOffs = view.getUint32(0x1C);
    const groupCount = view.getUint32(0x20);
    const groupOffs = view.getUint32(0x24);
    const triInfoCount = view.getUint32(0x28);
    const triInfoOffs = view.getUint32(0x2C);

    function parseOctreeNodeMaybe(index: number): OctreeNode | null {
        if (index >= 0)
            return parseOctreeNode(index);
        else
            return null;
    }

    function parseOctreeNode(index: number): OctreeNode {
        assert(index < nodeTreeCount);
        const offs = nodeTreeOffs + (index * 0x14);
        assert(view.getUint8(offs + 0x00) === 0x01);

        const nodeType: OctreeNodeType = view.getUint8(offs + 0x01);
        const parentNodeIndex: number = view.getInt16(offs + 0x02);

        if (nodeType === OctreeNodeType.BRANCH) {
            const children: (OctreeNode | null)[] = [];
            children.push(parseOctreeNodeMaybe(view.getInt16(offs + 0x04)));
            children.push(parseOctreeNodeMaybe(view.getInt16(offs + 0x06)));
            children.push(parseOctreeNodeMaybe(view.getInt16(offs + 0x08)));
            children.push(parseOctreeNodeMaybe(view.getInt16(offs + 0x0A)));
            children.push(parseOctreeNodeMaybe(view.getInt16(offs + 0x0C)));
            children.push(parseOctreeNodeMaybe(view.getInt16(offs + 0x0E)));
            children.push(parseOctreeNodeMaybe(view.getInt16(offs + 0x10)));
            children.push(parseOctreeNodeMaybe(view.getInt16(offs + 0x12)));
            return { nodeType, children };
        } else if (nodeType === OctreeNodeType.LEAF) {
            const faceMapIndex = view.getUint16(offs + 0x04);
            assert(faceMapIndex < blkCount);
            const faceStart = view.getUint16(blkOffs + faceMapIndex * 0x02);
            assert(faceStart < triCount);
            const faceEnd = (faceMapIndex + 1) < blkCount ? view.getUint16(blkOffs + (faceMapIndex + 1) * 0x02) : triCount;
            const faceCount_ = faceEnd - faceStart;
            assert(faceCount_ > 0);
            return { nodeType, faceStart, faceCount: faceCount_ };
        } else {
            throw "whoops";
        }
    }

    const vertexData = buffer.createTypedArray(Float32Array, vertexOffs, vertexCount * 3, Endianness.BIG_ENDIAN);
    const faceData = buffer.createTypedArray(Uint16Array, triOffs, triCount * 5, Endianness.BIG_ENDIAN);
    const octreeRoot = parseOctreeNode(0);
    const pos = vec3.create();

    return { pos, octreeRoot, vertexData, faceData, faceCount: triCount };
}

const scratchVec3 = vec3.create();
function scalarTriple(a: vec3, b: vec3, c: vec3): number {
    return vec3.dot(a, vec3.cross(scratchVec3, b, c));
}

function intersectTriangle(bary: vec3, dir: vec3, t0: vec3, t1: vec3, t2: vec3): boolean {
    let u = scalarTriple(dir, t2, t1);
    if (u < 0) return false;
    let v = scalarTriple(dir, t0, t2);
    if (v < 0) return false;
    let w = scalarTriple(dir, t1, t0);
    if (w < 0) return false;

    const denom = 1 / (u+v+w);
    u *= denom;
    v *= denom;
    w *= denom;
    vec3.set(bary, u, v, w);
    return true;
}

const porig = vec3.create();
const pdir = vec3.create();
const pt0 = vec3.create();
const pt1 = vec3.create();
const pt2 = vec3.create();
const bary = vec3.create();
export function raycast(closestHit: vec3, dzb: DZB, origin: vec3, direction: vec3, outNormal?: vec3): boolean {
    vec3.copy(pdir, direction);
    vec3.add(porig, origin, dzb.pos);

    let ci0 = 0, ci1 = 0, ci2 = 0;

    let closestDist = Infinity;
    for (let i = 0; i < dzb.faceCount; i++) {
        const i0 = dzb.faceData[i*5 + 0];
        const i1 = dzb.faceData[i*5 + 1];
        const i2 = dzb.faceData[i*5 + 2];

        // Degenerate triangle.
        if (i0 === i1 || i1 === i2 || i0 === i2) continue;

        vec3.set(pt0, dzb.vertexData[i0*3+0], dzb.vertexData[i0*3+1], dzb.vertexData[i0*3+2]);
        vec3.sub(pt0, pt0, porig);
        vec3.set(pt1, dzb.vertexData[i1*3+0], dzb.vertexData[i1*3+1], dzb.vertexData[i1*3+2]);
        vec3.sub(pt1, pt1, porig);
        vec3.set(pt2, dzb.vertexData[i2*3+0], dzb.vertexData[i2*3+1], dzb.vertexData[i2*3+2]);
        vec3.sub(pt2, pt2, porig);

        if (!intersectTriangle(bary, pdir, pt0, pt1, pt2))
            continue;

        const rx = pt0[0]*bary[0] + pt1[0]*bary[1] + pt2[0]*bary[2];
        const ry = pt0[1]*bary[0] + pt1[1]*bary[1] + pt2[1]*bary[2];
        const rz = pt0[2]*bary[0] + pt1[2]*bary[1] + pt2[2]*bary[2];

        const sqdist = rx*rx + ry*ry + rz*rz;
        if (sqdist >= closestDist)
            continue;

        vec3.set(closestHit, rx, ry, rz);
        ci0 = i0;
        ci1 = i1;
        ci2 = i2;

        closestDist = sqdist;
    }

    if (closestDist < Infinity) {
        vec3.add(closestHit, closestHit, origin);

        if (outNormal) {
            vec3.set(pt0, dzb.vertexData[ci0*3+0], dzb.vertexData[ci0*3+1], dzb.vertexData[ci0*3+2]);
            vec3.set(pt1, dzb.vertexData[ci1*3+0], dzb.vertexData[ci1*3+1], dzb.vertexData[ci1*3+2]);
            vec3.set(pt2, dzb.vertexData[ci2*3+0], dzb.vertexData[ci2*3+1], dzb.vertexData[ci2*3+2]);

            const v0 = vec3.sub(pdir, pt1, pt0);
            const v1 = vec3.sub(bary, pt2, pt0);
            vec3.cross(outNormal, v0, v1);
            vec3.normalize(outNormal, outNormal);
        }

        return true;
    } else {
        return false;
    }
}
