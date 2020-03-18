
import ArrayBufferSlice from "../ArrayBufferSlice";
import { vec3 } from "gl-matrix";
import { assertExists, nArray } from "../util";
import { isNearZero } from "../MathHelpers";
import { JMapInfoIter, createCsvParser } from "./JMapInfo";

export class KC_PrismData {
    public length: number = 0.0;
    public posIdx: number = 0;
    public faceNrmIdx: number = 0;
    public edge0NrmIdx: number = 0;
    public edge1NrmIdx: number = 0;
    public edge2NrmIdx: number = 0;
    public attrib: number = 0;
}

class KC_PrismHit {
    // Galaxy effectively never uses this.
    // public classification: number = -1;

    public dist: number = -1;
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec3d = vec3.create();

class SearchBlockResult {
    public prismListOffs: number = -1;
    public shiftR: number = -1;
}

export class CheckArrowResult {
    // Galaxy effectively never uses this.
    // public bestPrism: KC_PrismData | null = null;

    public prisms: (KC_PrismData | null)[] = nArray(32, () => null);
    public distances: number[] = nArray(32, () => -1);

    public reset(): void {
        for (let i = 0; i < this.prisms.length; i++)
            this.prisms[i] = null;
        for (let i = 0; i < this.distances.length; i++)
            this.distances[i] = -1;
    }
}

const searchBlockScratch = new SearchBlockResult();
const prismHitScratch = new KC_PrismHit();

export class KCollisionServer {
    private blocksTrans = vec3.create();

    private view: DataView;

    private positionsOffs: number;
    private normalsOffs: number;
    private prisms: KC_PrismData[] = [];
    private blocksOffs: number;
    private maxDistMul: number;

    private maskX: number;
    private maskY: number;
    private maskZ: number;

    private shiftR: number;
    private shiftLY: number;
    private shiftLZ: number;

    private params: JMapInfoIter | null = null;

    constructor(buffer: ArrayBufferSlice, paramsData: ArrayBufferSlice | null) {
        this.view = buffer.createDataView();

        this.positionsOffs = this.view.getUint32(0x00);
        this.normalsOffs = this.view.getUint32(0x04);
        const prismsOffs = this.view.getUint32(0x08);
        this.blocksOffs = this.view.getUint32(0x0C);
        this.maxDistMul = this.view.getFloat32(0x10);

        // Ignore the first prism.
        for (let offs = prismsOffs + 0x10; offs < this.blocksOffs; offs += 0x10) {
            const prism = new KC_PrismData();
            prism.length = this.view.getFloat32(offs + 0x00);
            prism.posIdx = this.view.getUint16(offs + 0x04);
            prism.faceNrmIdx = this.view.getUint16(offs + 0x06);
            prism.edge0NrmIdx = this.view.getUint16(offs + 0x08);
            prism.edge1NrmIdx = this.view.getUint16(offs + 0x0A);
            prism.edge2NrmIdx = this.view.getUint16(offs + 0x0C);
            prism.attrib = this.view.getUint16(offs + 0x0E);
            this.prisms.push(prism);
        }

        const blocksTransX = this.view.getFloat32(0x14);
        const blocksTransY = this.view.getFloat32(0x18);
        const blocksTransZ = this.view.getFloat32(0x1C);
        vec3.set(this.blocksTrans, blocksTransX, blocksTransY, blocksTransZ);

        this.maskX = this.view.getUint32(0x20);
        this.maskY = this.view.getUint32(0x24);
        this.maskZ = this.view.getUint32(0x28);

        this.shiftR = this.view.getInt32(0x2C);
        this.shiftLY = this.view.getInt32(0x30);
        this.shiftLZ = this.view.getInt32(0x34);

        if (paramsData !== null)
            this.params = createCsvParser(paramsData);
    }

    public getAttributes(idx: number): JMapInfoIter | null {
        if (this.params !== null) {
            this.params.setRecord(this.prisms[idx].attrib);
            return this.params;
        } else {
            return null;
        }
    }

    public toIndex(prism: KC_PrismData): number {
        return this.prisms.indexOf(prism);
    }

    public getPrismData(idx: number): KC_PrismData {
        return this.prisms[idx];
    }

    public getFaceNormal(dst: vec3, prism: KC_PrismData): void {
        this.loadNormal(dst, prism.faceNrmIdx);
    }

    public getEdgeNormal1(dst: vec3, prism: KC_PrismData): void {
        this.loadNormal(dst, prism.edge0NrmIdx);
    }

    public getEdgeNormal2(dst: vec3, prism: KC_PrismData): void {
        this.loadNormal(dst, prism.edge1NrmIdx);
    }

    public getEdgeNormal3(dst: vec3, prism: KC_PrismData): void {
        this.loadNormal(dst, prism.edge2NrmIdx);
    }

    public getPos(dst: vec3, prism: KC_PrismData, which: number): void {
        if (which === 0) {
            this.loadPosition(dst, prism.posIdx);
        } else {
            if (which === 1) {
                this.loadNormal(scratchVec3a, prism.edge1NrmIdx);
                this.loadNormal(scratchVec3b, prism.faceNrmIdx);
            } else if (which === 2) {
                this.loadNormal(scratchVec3a, prism.faceNrmIdx);
                this.loadNormal(scratchVec3b, prism.edge0NrmIdx);
            }
            vec3.cross(scratchVec3a, scratchVec3a, scratchVec3b);

            this.loadNormal(scratchVec3b, prism.edge2NrmIdx);
            const dist = prism.length / vec3.dot(scratchVec3a, scratchVec3b);

            this.loadPosition(scratchVec3b, prism.posIdx);
            vec3.scaleAndAdd(dst, scratchVec3b, scratchVec3a, dist);
        }
    }

    private loadPosition(dst: vec3, idx: number): void {
        const offs = this.positionsOffs + idx * 0x0C;
        dst[0] = this.view.getFloat32(offs + 0x00);
        dst[1] = this.view.getFloat32(offs + 0x04);
        dst[2] = this.view.getFloat32(offs + 0x08);
    }

    private loadNormal(dst: vec3, idx: number): void {
        const offs = this.normalsOffs + idx * 0x0C;
        dst[0] = this.view.getFloat32(offs + 0x00);
        dst[1] = this.view.getFloat32(offs + 0x04);
        dst[2] = this.view.getFloat32(offs + 0x08);
    }

    private loadPrismListIdx(offs: number): KC_PrismData | null {
        const prismIdx = this.view.getUint16(offs);
        if (prismIdx > 0)
            return assertExists(this.prisms[prismIdx - 1]);
        else
            return null;
    }

    public checkPoint(dst: KC_PrismHit, v: vec3, maxDist: number): boolean {
        maxDist *= this.maxDistMul;

        const x = (v[0] - this.blocksTrans[0]) | 0;
        const y = (v[1] - this.blocksTrans[1]) | 0;
        const z = (v[2] - this.blocksTrans[2]) | 0;

        if ((x & this.maskX) !== 0 || (y & this.maskY) !== 0 || (z & this.maskZ) !== 0)
            return false;

        this.searchBlock(searchBlockScratch, x, y, z);
        let prismListIdx = searchBlockScratch.prismListOffs;

        while (true) {
            prismListIdx += 0x02;

            const prism = this.loadPrismListIdx(prismListIdx);
            if (prism === null)
                return false;

            if (prism.length <= 0.0) {
                // TODO(jstpierre): When would this happen?
                continue;
            }

            this.loadPosition(scratchVec3a, prism.posIdx);

            // Local position.
            vec3.sub(scratchVec3a, v, scratchVec3a);

            this.loadNormal(scratchVec3b, prism.edge0NrmIdx);
            if (vec3.dot(scratchVec3a, scratchVec3b) < 0)
                continue;

            this.loadNormal(scratchVec3b, prism.edge1NrmIdx);
            if (vec3.dot(scratchVec3a, scratchVec3b) < 0)
                continue;

            this.loadNormal(scratchVec3b, prism.edge2NrmIdx);
            if (vec3.dot(scratchVec3a, scratchVec3b) < prism.length)
                continue;

            this.loadNormal(scratchVec3b, prism.faceNrmIdx);
            const dist = -vec3.dot(scratchVec3b, v);
            if (dist < 0.0 || dist > maxDist)
                continue;

            // Passed all the checks.
            dst.dist = dist;
            return true;
        }
    }

    private isInsideMinMaxInLocalSpace(v: vec3): boolean {
        const x = (v[0] | 0), y = (v[1] | 0), z = (v[2] | 0);
        return (x & this.maskX) === 0 && (y & this.maskY) === 0 && (z & this.maskZ) === 0;
    }

    private KCHitArrow(dst: KC_PrismHit, prism: KC_PrismData, origin: vec3, arrowDir: vec3): boolean {
        this.loadNormal(scratchVec3c, prism.faceNrmIdx);

        // Local space.
        this.loadPosition(scratchVec3d, prism.posIdx);
        vec3.sub(scratchVec3d, origin, scratchVec3d);

        const proj = vec3.dot(scratchVec3c, scratchVec3d);
        if (proj < 0.0)
            return false;

        const projDir = vec3.dot(scratchVec3c, arrowDir);
        if (proj + projDir >= 0.0)
            return false;

        const dist = proj / -projDir;
        vec3.scaleAndAdd(scratchVec3c, scratchVec3d, arrowDir, dist);

        this.loadNormal(scratchVec3d, prism.edge0NrmIdx);
        const dotNrm0 = vec3.dot(scratchVec3c, scratchVec3d);
        if (dotNrm0 >= 0.01)
            return false;

        this.loadNormal(scratchVec3d, prism.edge1NrmIdx);
        const dotNrm1 = vec3.dot(scratchVec3c, scratchVec3d);
        if (dotNrm1 >= 0.01)
            return false;

        this.loadNormal(scratchVec3d, prism.edge2NrmIdx);
        const dotNrm2 = vec3.dot(scratchVec3c, scratchVec3d);
        if (dotNrm2 >= 0.01 + prism.length)
            return false;

        // TODO(jstpierre): Classification.

        dst.dist = dist;
        return true;
    }

    public checkArrow(dst: CheckArrowResult, maxResults: number, origin: vec3, arrowDir: vec3): boolean {
        const blkArrowDir = vec3.copy(scratchVec3a, arrowDir);
        const blkOrigin = vec3.copy(scratchVec3b, origin);

        let arrowLength = vec3.length(blkArrowDir);
        vec3.normalize(blkArrowDir, blkArrowDir);

        // Put in local space.
        vec3.sub(blkOrigin, blkOrigin, this.blocksTrans);

        // Origin is outside, test if the arrow goes inside...
        if (!this.isInsideMinMaxInLocalSpace(blkOrigin) && blkArrowDir[0] !== 0.0) {
            const bounds = (blkArrowDir[0] > 0.0) ? 0.0 : ((~this.maskX) >>> 0);
            const length = (bounds - blkOrigin[0]) / blkArrowDir[0];
            if (length >= 0.0 && length <= arrowLength) {
                // Clip ray origin to intersection point.
                vec3.scaleAndAdd(blkOrigin, blkOrigin, blkArrowDir, length);
                arrowLength -= length;
            } else {
                return false;
            }
        }

        if (!this.isInsideMinMaxInLocalSpace(blkOrigin) && blkArrowDir[1] !== 0.0) {
            const bounds = (blkArrowDir[1] > 0.0) ? 0.0 : ((~this.maskY) >>> 0);
            const length = (bounds - blkOrigin[1]) / blkArrowDir[1];
            if (length >= 0.0 && length <= arrowLength) {
                vec3.scaleAndAdd(blkOrigin, blkOrigin, blkArrowDir, length);
                arrowLength -= length;
            } else {
                return false;
            }
        }

        if (!this.isInsideMinMaxInLocalSpace(blkOrigin) && blkArrowDir[2] !== 0.0) {
            const bounds = (blkArrowDir[2] > 0.0) ? 0.0 : ((~this.maskZ) >>> 0);
            const length = (bounds - blkOrigin[2]) / blkArrowDir[2];
            if (length >= 0.0 && length <= arrowLength) {
                vec3.scaleAndAdd(blkOrigin, blkOrigin, blkArrowDir, length);
                arrowLength -= length;
            } else {
                return false;
            }
        }

        let dstPrismCount = 0;
        while (true) {
            if (arrowLength < 0)
                return false;

            if (!this.isInsideMinMaxInLocalSpace(blkOrigin))
                return false;

            let x = (blkOrigin[0] | 0), y = (blkOrigin[1] | 0), z = (blkOrigin[2] | 0);

            this.searchBlock(searchBlockScratch, x, y, z);
            let prismListIdx = searchBlockScratch.prismListOffs;

            let bestDist = 1.0;
            while (true) {
                prismListIdx += 0x02;

                const prism = this.loadPrismListIdx(prismListIdx);
                if (prism === null)
                    break;

                if (this.KCHitArrow(prismHitScratch, prism, origin, arrowDir)) {
                    if (prismHitScratch.dist < bestDist) {
                        bestDist = prismHitScratch.dist;
                        // dst.bestPrism = prism;
                        // dst.classification = prismHitScratch.classification;
                    }

                    if (dst.prisms !== null) {
                        dst.distances[dstPrismCount] = prismHitScratch.dist;
                        dst.prisms[dstPrismCount] = prism;
                        dstPrismCount++;

                        if (dstPrismCount >= maxResults) {
                            // We've filled in all the prisms. We're done.
                            return true;
                        }
                    }
                }
            }

            // If we're only looking for one prism, and we got it, we're done.
            if (dst.prisms === null /* && dst.bestPrism !== null */) {
                return true;
            } else {
                // Otherwise, continue our search along the octree to the next block.
                const mask = (1 << searchBlockScratch.shiftR) - 1;

                let minLength = 1.0E9;

                if (!isNearZero(blkArrowDir[0], 0.001)) {
                    let bounds: number;
                    if (blkArrowDir[0] >= 0.0) {
                        bounds = ((mask + 1) - (x & mask)) + 1;
                    } else {
                        bounds = -(x & mask) - 1;
                    }

                    const length = bounds / blkArrowDir[0];
                    if (length < minLength)
                        minLength = length;
                }

                if (!isNearZero(blkArrowDir[1], 0.001)) {
                    let bounds: number;
                    if (blkArrowDir[1] >= 0.0) {
                        bounds = ((mask + 1) - (y & mask)) + 1;
                    } else {
                        bounds = -(y & mask) - 1;
                    }

                    const length = bounds / blkArrowDir[1];
                    if (length < minLength)
                        minLength = length;
                }

                if (!isNearZero(blkArrowDir[2], 0.001)) {
                    let bounds: number;
                    if (blkArrowDir[2] >= 0.0) {
                        bounds = ((mask + 1) - (z & mask)) + 1;
                    } else {
                        bounds = -(z & mask) - 1;
                    }

                    const length = bounds / blkArrowDir[2];
                    if (length < minLength)
                        minLength = length;
                }

                vec3.scaleAndAdd(blkOrigin, blkOrigin, blkArrowDir, minLength);
                arrowLength -= minLength;
            }
        }
    }

    private searchBlock(dst: SearchBlockResult, x: number, y: number, z: number): void {
        let blockIdx: number;

        dst.shiftR = this.shiftR;

        if (this.shiftLY === -1 && this.shiftLZ === -1) {
            blockIdx = 0;
        } else {
            blockIdx = (((x >>> dst.shiftR) | ((y >> dst.shiftR) << this.shiftLY)) | ((z >> dst.shiftR) << this.shiftLZ));
        }

        let blocksOffs = this.blocksOffs;
        while (true) {
            const res = this.view.getInt32(blocksOffs + blockIdx * 0x04);

            if (res < -1) {
                // Found result, we're good.
                dst.prismListOffs = blocksOffs + (res & 0x7FFFFFFF);
                return;
            } else {
                // Otherwise, walk further down octree.
                dst.shiftR--;

                blocksOffs += res;
                blockIdx = ((x >>> dst.shiftR) & 1) | ((((y >>> dst.shiftR) & 1) << 1)) | ((((z >>> dst.shiftR) & 1) << 2));
            }
        }
    }
}
