
// "DolZel Background"

// Collision data for objects and rooms.

import { vec3 } from "gl-matrix";
import { cBgD_t } from "./d_bg";

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
export function raycast(closestHit: vec3, dzb: cBgD_t, origin: vec3, direction: vec3, outNormal?: vec3): boolean {
    vec3.copy(pdir, direction);
    vec3.add(porig, origin, dzb.pos);

    let ci0 = 0, ci1 = 0, ci2 = 0;

    let closestDist = Infinity;
    for (let i = 0; i < dzb.triTbl.length; i++) {
        const i0 = dzb.triTbl[i].vtxIdx0;
        const i1 = dzb.triTbl[i].vtxIdx1;
        const i2 = dzb.triTbl[i].vtxIdx2;

        // Degenerate triangle.
        if (i0 === i1 || i1 === i2 || i0 === i2) continue;

        vec3.copy(pt0, dzb.vtxTbl[i0]);
        vec3.sub(pt0, pt0, porig);
        vec3.copy(pt1, dzb.vtxTbl[i1]);
        vec3.sub(pt1, pt1, porig);
        vec3.copy(pt2, dzb.vtxTbl[i2]);
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
            vec3.copy(pt0, dzb.vtxTbl[ci0]);
            vec3.copy(pt1, dzb.vtxTbl[ci1]);
            vec3.copy(pt2, dzb.vtxTbl[ci2]);

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
