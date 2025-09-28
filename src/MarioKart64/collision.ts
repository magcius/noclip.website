import { vec3 } from "gl-matrix";
import { F3DEX_GBI } from "../BanjoKazooie/f3dex.js";
import { assert, nArray } from "../util.js";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { Vec3Zero } from '../MathHelpers.js';
import { CourseId } from './scenes.js';
import { product2D } from './utils.js';
import { Mk64Globals } from "./courses.js";

export enum ColSurfaceType {
    SurfaceDefault = -1,   // Default surface
    Airborne = 0x00,
    Asphalt = 0x01,
    Dirt = 0x02,
    Sand = 0x03,
    Stone = 0x04,
    Snow = 0x05,
    Bridge = 0x06,
    SandOffroad = 0x07,
    Grass = 0x08,
    Ice = 0x09,
    WetSand = 0x0A,
    SnowOffroad = 0x0B,
    Cliff = 0x0C,
    DirtOffroad = 0x0D,
    TrainTrack = 0x0E,
    Cave = 0x0F,
    RopeBridge = 0x10,
    WoodBridge = 0x11,
    BoostRampWood = 0xFC,
    OutOfBounds = 0xFD,
    BoostRampAsphalt = 0xFE,
    Ramp = 0xFF
}

export enum ColTriFlags {
    IsDoubleSided = 1 << 9, //0x200
    IsSlope = 1 << 10, //0x400
    IsUnk0 = 1 << 11, //0x800
    IsShadow = 1 << 12, //0x1000
    IsFacingZ = 1 << 13, //0x2000
    IsFacingY = 1 << 14, //0x4000
    IsFacingX = 1 << 15, //0x8000
}

class CollisionGrid {
    triangleStartIndex: number = 0;
    numTriangles: number = 0;
}

class CollisionVertex {
    public x: number = 0;
    public y: number = 0;
    public z: number = 0;
    public flags: number = 0;
}

class CollisionTriangle {
    vtx1: CollisionVertex;
    vtx2: CollisionVertex;
    vtx3: CollisionVertex;
    normal: vec3 = vec3.create();
    distance: number = 0;
    surfaceType: number = 0;
    flags: number = 0;
    min: vec3 = vec3.create();
    max: vec3 = vec3.create();
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();

const GRID_SIZE = 32;
export class Collision {
    private static vertexCache: CollisionVertex[] = nArray(32, () => new CollisionVertex());
    private static collisionVertices: CollisionVertex[] = [];
    private static collisionTris: CollisionTriangle[] = [];
    private static gCollisionGrid: CollisionGrid[] = [];
    private static gCollisionIndices: number[] = [];

    private static isSectionFlatGround: boolean = false;
    private static isSectionWall: boolean = false;
    private static isSectionDoubleSided: boolean = false;

    public static courseMin: vec3 = vec3.create();
    public static courseMax: vec3 = vec3.create();

    /* 0x00 */ public hasCollisionZ: boolean = false;
    /* 0x02 */ public hasCollisionX: boolean = false;
    /* 0x04 */ public hasCollisionY: boolean = false;

    /* 0x06 */ public nearestTriIndexZ: number = 5000;
    /* 0x08 */ public nearestTriIndexX: number = 5000;
    /* 0x0A */ public nearestTriIndexY: number = 5000;

    /* 0x0C */ public surfaceDistZ: number = 0;
    /* 0x10 */ public surfaceDistX: number = 0;
    /* 0x14 */ public surfaceDistY: number = 0;

    /* 0x18 */ public normalZ: vec3 = vec3.fromValues(0, 0, 1);
    /* 0x24 */ public normalX: vec3 = vec3.fromValues(1, 0, 0);
    /* 0x30 */ public normalY: vec3 = vec3.fromValues(0, 1, 0);

    public static initCourseCollision(globals: Mk64Globals): void {
        assert(globals.segmentBuffers[4] !== undefined);

        Collision.collisionTris = [];
        Collision.collisionVertices = [];
        Collision.gCollisionGrid = [];
        Collision.gCollisionIndices = [];
        vec3.set(Collision.courseMin, 0, 0, 0);
        vec3.set(Collision.courseMax, 0, 0, 0);
        
        const segmentBuffers = globals.segmentBuffers;

        const vertexView = segmentBuffers[4].createDataView();
        for (let offs = 0; offs < segmentBuffers[4].byteLength; offs += 0x10) {
            const scratchVertex = new CollisionVertex();
            scratchVertex.x = vertexView.getInt16(offs + 0x00);
            scratchVertex.y = vertexView.getInt16(offs + 0x02);
            scratchVertex.z = vertexView.getInt16(offs + 0x04);
            scratchVertex.flags = vertexView.getInt16(offs + 0x06);
            Collision.collisionVertices.push(scratchVertex);
        }

        switch (globals.courseId) {
            case CourseId.MarioRaceway:
                this.genCollisionFromDL(segmentBuffers, 0x07001140); // Mushroom
                this.genCollisionFromDL(segmentBuffers, 0x070008E8); // Pipe
                this.parseTrackSections(segmentBuffers, 0x06009650);
                globals.waterLevel = Collision.courseMin[1] - 10;
                break;

            case CourseId.ChocoMountain:
                this.parseTrackSections(segmentBuffers, 0x060072D0);
                globals.waterLevel = -80;
                break;

            case CourseId.BowserCastle:
                this.parseTrackSections(segmentBuffers, 0x060093D8);
                globals.waterLevel = -50;
                break;

            case CourseId.BansheeBoardwalk:
                this.parseTrackSections(segmentBuffers, 0x0600B458);
                globals.waterLevel = -80;
                break;

            case CourseId.YoshiValley:
                this.parseTrackSections(segmentBuffers, 0x06018240);
                globals.waterLevel = Collision.courseMin[1] - 10;
                break;

            case CourseId.FrappeSnowland:
                this.parseTrackSections(segmentBuffers, 0x060079A0);
                globals.waterLevel = -50;
                break;

            case CourseId.KoopaBeach:
                this.parseTrackSections(segmentBuffers, 0x06018FD8);
                globals.waterLevel = 0;
                break;

            case CourseId.RoyalRaceway:
                this.parseTrackSections(segmentBuffers, 0x0600DC28);
                globals.waterLevel = -60;
                break;

            case CourseId.LuigiRaceway:
                this.parseTrackSections(segmentBuffers, 0x0600FF28);
                globals.waterLevel = Collision.courseMin[1] - 10;
                break;

            case CourseId.MooMooFarm:
                this.parseTrackSections(segmentBuffers, 0x060144B8);
                globals.waterLevel = Collision.courseMin[1] - 10;
                break;

            case CourseId.ToadsTurnpike:
                this.parseTrackSections(segmentBuffers, 0x06023B68);
                globals.waterLevel = Collision.courseMin[1] - 10;
                break;

            case CourseId.KalamariDesert:
                this.parseTrackSections(segmentBuffers, 0x06023070);
                globals.waterLevel = Collision.courseMin[1] - 10;
                break;

            case CourseId.SherbetLand:
                this.parseTrackSections(segmentBuffers, 0x06009C20);
                globals.waterLevel = -18;
                break;

            case CourseId.RainbowRoad:
                this.parseTrackSections(segmentBuffers, 0x06016440);
                globals.waterLevel = 0;
                break;

            case CourseId.WarioStadium:
                this.parseTrackSections(segmentBuffers, 0x0600CC38);
                globals.waterLevel = Collision.courseMin[1] - 10;
                break;

            case CourseId.BlockFort:
                this.genCollisionFromDL(segmentBuffers, 0x070015C0, ColSurfaceType.Asphalt);
                globals.waterLevel = Collision.courseMin[1] - 10;
                break;

            case CourseId.Skyscraper:
                this.genCollisionFromDL(segmentBuffers, 0x07001110, ColSurfaceType.Asphalt);
                this.genCollisionFromDL(segmentBuffers, 0x07000258, ColSurfaceType.Asphalt);
                globals.waterLevel = -480;
                break;

            case CourseId.DoubleDeck:
                this.genCollisionFromDL(segmentBuffers, 0x07000738, ColSurfaceType.Asphalt);
                globals.waterLevel = Collision.courseMin[1] - 10;
                break;

            case CourseId.DkJungle:
                this.parseTrackSections(segmentBuffers, 0x06014338);
                globals.waterLevel = -475;
                break;

            case CourseId.BigDonut:
                this.genCollisionFromDL(segmentBuffers, 0x07001018, ColSurfaceType.Bridge);
                this.genCollisionFromDL(segmentBuffers, 0x07000450, ColSurfaceType.Bridge);
                this.genCollisionFromDL(segmentBuffers, 0x07000AC0, ColSurfaceType.Bridge);
                this.genCollisionFromDL(segmentBuffers, 0x07000B58, ColSurfaceType.Bridge);
                this.genCollisionFromDL(segmentBuffers, 0x07000230, ColSurfaceType.Bridge);
                globals.waterLevel = 100;
                break;
        }

        this.generateGrid();
        Collision.collisionVertices = [];
    }

    private static generateGrid() {
        Collision.courseMax[0] += 20;
        Collision.courseMax[2] += 20;

        Collision.courseMin[0] -= 20;
        Collision.courseMin[1] -= 20;
        Collision.courseMin[2] -= 20;

        const courseLengthX = Collision.courseMax[0] - Collision.courseMin[0];
        const courseLengthZ = Collision.courseMax[2] - Collision.courseMin[2];
        const sectionX = Math.floor(courseLengthX / GRID_SIZE);
        const sectionZ = Math.floor(courseLengthZ / GRID_SIZE);

        let numTriangles = 0;
        Collision.gCollisionGrid = nArray(GRID_SIZE * GRID_SIZE, () => new CollisionGrid());

        for (let j = 0; j < GRID_SIZE; j++) {
            for (let k = 0; k < GRID_SIZE; k++) {
                const index = k + j * GRID_SIZE;

                const minX = (Collision.courseMin[0] + (sectionX * k)) - 20;
                const minZ = (Collision.courseMin[2] + (sectionZ * j)) - 20;
                const maxX = minX + sectionX + 40;
                const maxZ = minZ + sectionZ + 40;

                for (let i = 0; i < Collision.collisionTris.length; i++) {
                    const tri = Collision.collisionTris[i];

                    if (tri.max[2] < minZ ||
                        tri.min[2] > maxZ ||
                        tri.max[0] < minX ||
                        tri.min[0] > maxX) {
                        continue;
                    }

                    if (this.isTriIntersectingBoundingBox(minX, maxX, minZ, maxZ, tri)) {
                        if (Collision.gCollisionGrid[index].numTriangles === 0) {
                            Collision.gCollisionGrid[index].triangleStartIndex = numTriangles;
                        }
                        Collision.gCollisionGrid[index].numTriangles++;
                        Collision.gCollisionIndices.push(i);
                        numTriangles++;
                    }
                }
            }
        }
    }

    private static isLineIntersectingRectangle(minX: number, maxX: number, minZ: number, maxZ: number, x1: number, z1: number, x2: number, z2: number): boolean {
        const xOffset = x2 - x1;
        const zOffset = z2 - z1;

        if (xOffset === 0.0) {
            if (x1 < minX || x1 > maxX)
                return false;
            if (zOffset > 0.0) {
                return z1 < minZ && z2 > maxZ;
            } else {
                return z2 < minZ && z1 > maxZ;
            }
        }

        if (zOffset === 0) {
            if (z1 < minZ || z1 > maxZ)
                return false;
            if (xOffset > 0) {
                return x1 < minX && x2 > maxX;
            } else {
                return x2 < minX && x1 > maxX;
            }
        }

        let projectedPoint = ((xOffset / zOffset) * (minZ - z1)) + x1;
        if (projectedPoint >= minX && projectedPoint <= maxX) return true;

        projectedPoint = ((xOffset / zOffset) * (maxZ - z1)) + x1;
        if (projectedPoint >= minX && projectedPoint <= maxX) return true;

        projectedPoint = ((zOffset / xOffset) * (minX - x1)) + z1;
        if (projectedPoint >= minZ && projectedPoint <= maxZ) return true;

        projectedPoint = ((zOffset / xOffset) * (maxX - x1)) + z1;
        if (projectedPoint >= minZ && projectedPoint <= maxZ) return true;

        return false;
    }

    private static isTriIntersectingBoundingBox(minX: number, maxX: number, minZ: number, maxZ: number, triangle: CollisionTriangle): boolean {
        const x1 = triangle.vtx1.x;
        const z1 = triangle.vtx1.z;
        const x2 = triangle.vtx2.x;
        const z2 = triangle.vtx2.z;
        const x3 = triangle.vtx3.x;
        const z3 = triangle.vtx3.z;

        if ((x1 >= minX && x1 <= maxX && z1 >= minZ && z1 <= maxZ) ||
            (x2 >= minX && x2 <= maxX && z2 >= minZ && z2 <= maxZ) ||
            (x3 >= minX && x3 <= maxX && z3 >= minZ && z3 <= maxZ)) {
            return true;
        }

        if (this.isLineIntersectingRectangle(minX, maxX, minZ, maxZ, x1, z1, x2, z2) ||
            this.isLineIntersectingRectangle(minX, maxX, minZ, maxZ, x2, z2, x3, z3) ||
            this.isLineIntersectingRectangle(minX, maxX, minZ, maxZ, x3, z3, x1, z1)) {
            return true;
        }

        return false;
    }

    private static getTriangle(vtx1: CollisionVertex, vtx2: CollisionVertex, vtx3: CollisionVertex, surfaceType: number, sectionId: number): void {
        const triangle: CollisionTriangle = new CollisionTriangle();
        let maxX, maxY, maxZ, minX, minY, minZ;

        const flags1 = vtx1.flags;
        const flags2 = vtx2.flags;
        const flags3 = vtx3.flags;

        triangle.vtx1 = vtx1;
        triangle.vtx2 = vtx2;
        triangle.vtx3 = vtx3;

        if (flags1 === 4 && flags2 === 4 && flags3 === 4) {
            return;
        }

        const pos1: vec3 = [vtx1.x, vtx1.y, vtx1.z];
        const pos2: vec3 = [vtx2.x, vtx2.y, vtx2.z];
        const pos3: vec3 = [vtx3.x, vtx3.y, vtx3.z];

        if ((pos1[0] === pos2[0]) && pos1[2] === pos2[2]) {
            triangle.vtx1 = vtx1;
            triangle.vtx3 = vtx2;
            triangle.vtx2 = vtx3;
            vec3.set(pos2, vtx3.x, vtx3.y, vtx3.z);
            vec3.set(pos3, vtx2.x, vtx2.y, vtx2.z);
        }

        maxX = Math.max(pos1[0], pos2[0], pos3[0]);
        maxY = Math.max(pos1[1], pos2[1], pos3[1]);
        maxZ = Math.max(pos1[2], pos2[2], pos3[2]);

        minX = Math.min(pos1[0], pos2[0], pos3[0]);
        minY = Math.min(pos1[1], pos2[1], pos3[1]);
        minZ = Math.min(pos1[2], pos2[2], pos3[2]);


        // calc triangle normal
        vec3.sub(scratchVec3a, pos2, pos1);
        vec3.sub(scratchVec3b, pos3, pos1);
        const crossProduct = vec3.cross(scratchVec3a, scratchVec3a, scratchVec3b);
        const normal = vec3.normalize(scratchVec3c, crossProduct);
        const distance = -vec3.dot(normal, pos1);

        if (vec3.equals(normal, Vec3Zero)) {
            return;
        }

        if (Collision.isSectionWall) {
            if (normal[1] < -0.9 || normal[1] > 0.9) {
                return;
            }
        }

        if (Collision.isSectionFlatGround) {
            if (Math.abs(normal[1]) < 0.1) {
                return;
            }
        }

        vec3.set(triangle.min, minX, minY, minZ);
        vec3.set(triangle.max, maxX, maxY, maxZ);

        vec3.min(Collision.courseMin, Collision.courseMin, triangle.min);
        vec3.max(Collision.courseMax, Collision.courseMax, triangle.max);

        vec3.copy(triangle.normal, normal);
        triangle.distance = distance;
        triangle.surfaceType = surfaceType;

        vec3.mul(crossProduct, crossProduct, crossProduct);

        let flags = sectionId;

        if (flags1 === 1 && flags2 === 1 && flags3 === 1) {
            flags |= ColTriFlags.IsSlope;
        } else if (flags1 === 2 && flags2 === 2 && flags3 === 2) {
            flags |= ColTriFlags.IsUnk0;
        } else if (flags1 === 3 && flags2 === 3 && flags3 === 3) {
            flags |= ColTriFlags.IsShadow;
        } else if (Collision.isSectionDoubleSided) {
            flags |= ColTriFlags.IsDoubleSided;
        }

        triangle.flags = flags;

        if (crossProduct[0] <= crossProduct[1] && crossProduct[1] >= crossProduct[2]) {
            triangle.flags |= ColTriFlags.IsFacingY;
        } else if (crossProduct[0] > crossProduct[1] && crossProduct[0] >= crossProduct[2]) {
            triangle.flags |= ColTriFlags.IsFacingX
        } else {
            triangle.flags |= ColTriFlags.IsFacingZ;
        }
        Collision.collisionTris.push(triangle);
    }

    private getNearestTriIndex(posX: number, posY: number, posZ: number): number | null {
        let height: number;
        let heightOutput: number = -3000.0;
        let closestTriIndex: number | null = null

        const courseLengthX = Collision.courseMax[0] - Collision.courseMin[0];
        const courseLengthZ = Collision.courseMax[2] - Collision.courseMin[2];
        const sectionX = Math.floor(courseLengthX / GRID_SIZE);
        const sectionZ = Math.floor(courseLengthZ / GRID_SIZE);

        const sectionIndexX = Math.floor((posX - Collision.courseMin[0]) / sectionX);
        const sectionIndexZ = Math.floor((posZ - Collision.courseMin[2]) / sectionZ);

        if (sectionIndexX < 0 || sectionIndexZ < 0 || sectionIndexX >= GRID_SIZE || sectionIndexZ >= GRID_SIZE || Collision.collisionTris.length === 0) {
            return null;
        }

        const gridSection = sectionIndexX + (sectionIndexZ * GRID_SIZE);
        const numTriangles = Collision.gCollisionGrid[gridSection].numTriangles;
        let triStartIndex = Collision.gCollisionGrid[gridSection].triangleStartIndex;

        for (let i = 0; i < numTriangles; i++) {
            const index = Collision.gCollisionIndices[triStartIndex++];
            const triangle = Collision.collisionTris[index];

            if ((triangle.flags & ColTriFlags.IsFacingY) && this.checkPointInTriangleXZ(posX, posZ, index)) {

                height = this.calculateSurfaceHeight(posX, posY, posZ, index);

                if (height <= posY && heightOutput < height) {
                    heightOutput = height;
                    closestTriIndex = index;
                }
            }
        }

        return closestTriIndex;
    }

    private checkPointInTriangleXZ(posX: number, posZ: number, triIndex: number): boolean {
        const tri = Collision.collisionTris[triIndex];

        const pX1 = tri.vtx1.x, pZ1 = tri.vtx1.z;
        const pX2 = tri.vtx2.x, pZ2 = tri.vtx2.z;
        const pX3 = tri.vtx3.x, pZ3 = tri.vtx3.z;

        const c1 = product2D(pX1, pZ1, pX2, pZ2, posX, posZ);
        const c2 = product2D(pX2, pZ2, pX3, pZ3, posX, posZ);
        const c3 = product2D(pX3, pZ3, pX1, pZ1, posX, posZ);

        const isNeg = (c1 < 0) || (c2 < 0) || (c3 < 0);
        const isPos = (c1 > 0) || (c2 > 0) || (c3 > 0);

        return !(isNeg && isPos);
    }

    public getNearestTrackSectionId(pos: vec3): number {
        const index = this.getNearestTriIndex(pos[0], pos[1], pos[2]);

        if (!index) {
            return -1;
        }

        return this.getTrackSectionId(index);
    }

    public getSurfaceHeight(posX: number, posY: number, posZ: number): number {
        const index = this.getNearestTriIndex(posX, posY, posZ);

        if (!index) {
            return 3000.0;
        }

        return this.calculateSurfaceHeight(posX, posY, posZ, index);
    }

    public checkBoundingCollision(boundingBoxSize: number, pos: vec3): number {
        this.hasCollisionZ = false;
        this.hasCollisionX = false;
        this.hasCollisionY = false;
        this.surfaceDistZ = 1000;
        this.surfaceDistX = 1000;
        this.surfaceDistY = 1000;
        let flags = 0;

        const triangles = Collision.collisionTris;

        if (this.nearestTriIndexY < triangles.length) {
            if (this.checkTriY(boundingBoxSize, pos, this.nearestTriIndexY)) {
                flags |= ColTriFlags.IsFacingY;
            }
        }
        if (this.nearestTriIndexZ < triangles.length) {
            if (this.checkTriZ(boundingBoxSize, pos, this.nearestTriIndexZ)) {
                flags |= ColTriFlags.IsFacingZ;
            }
        }
        if (this.nearestTriIndexX < triangles.length) {
            if (this.checkTriX(boundingBoxSize, pos, this.nearestTriIndexX)) {
                flags |= ColTriFlags.IsFacingX;
            }
        }
        if (flags === (ColTriFlags.IsFacingY | ColTriFlags.IsFacingZ | ColTriFlags.IsFacingX)) {
            return flags;
        }

        const courseLengthX = Collision.courseMax[0] - Collision.courseMin[0];
        const courseLengthZ = Collision.courseMax[2] - Collision.courseMin[2];

        const sectionX = courseLengthX / GRID_SIZE;
        const sectionZ = courseLengthZ / GRID_SIZE;

        const sectionIndexX = Math.floor((pos[0] - Collision.courseMin[0]) / sectionX);
        const sectionIndexZ = Math.floor((pos[2] - Collision.courseMin[2]) / sectionZ);

        if (sectionIndexX < 0 || sectionIndexZ < 0 || sectionIndexX >= GRID_SIZE || sectionIndexZ >= GRID_SIZE) {
            return 0;
        }

        const gridIndex = sectionIndexX + sectionIndexZ * GRID_SIZE;
        const numTriangles = Collision.gCollisionGrid[gridIndex].numTriangles;
        let triStartIndex = Collision.gCollisionGrid[gridIndex].triangleStartIndex;

        if (numTriangles === 0) {
            return flags;
        }

        for (let j = 0; j < numTriangles; j++) {
            if (flags === (ColTriFlags.IsFacingX | ColTriFlags.IsFacingY | ColTriFlags.IsFacingZ)) {
                return flags;
            }

            const triIndex = Collision.gCollisionIndices[triStartIndex++];
            const triFlags = triangles[triIndex].flags;

            if ((triFlags & ColTriFlags.IsFacingY) && !(flags & ColTriFlags.IsFacingY)) {
                if (triIndex !== this.nearestTriIndexY && this.checkTriY(boundingBoxSize, pos, triIndex)) {
                    flags |= ColTriFlags.IsFacingY;
                    continue;
                }
            }

            if ((triFlags & ColTriFlags.IsFacingX) && !(flags & ColTriFlags.IsFacingX)) {
                if (triIndex !== this.nearestTriIndexX && this.checkTriX(boundingBoxSize, pos, triIndex)) {
                    flags |= ColTriFlags.IsFacingX;
                    continue;
                }
            }

            if ((triFlags & ColTriFlags.IsFacingZ) && !(flags & ColTriFlags.IsFacingZ)) {
                if (triIndex !== this.nearestTriIndexZ && this.checkTriZ(boundingBoxSize, pos, triIndex)) {
                    flags |= ColTriFlags.IsFacingZ;
                }
            }
        }

        return flags;
    }

    private checkTriY(boundingBoxSize: number, pos: vec3, index: number): boolean {
        const tri = Collision.collisionTris[index];

        if (tri.normal[1] < -0.9 ||
            tri.min[0] > pos[0] || tri.max[0] < pos[0] ||
            tri.min[2] > pos[2] || tri.max[2] < pos[2] ||
            tri.min[1] - (boundingBoxSize * 3.0) > pos[1]
        ) {
            return false;
        }

        const pX1 = tri.vtx1.x, pZ1 = tri.vtx1.z;
        const pX2 = tri.vtx2.x, pZ2 = tri.vtx2.z;
        const pX3 = tri.vtx3.x, pZ3 = tri.vtx3.z;

        const cross1 = product2D(pX1, pZ1, pX2, pZ2, pos[0], pos[2]);
        const cross2 = product2D(pX2, pZ2, pX3, pZ3, pos[0], pos[2]);
        const cross3 = product2D(pX3, pZ3, pX1, pZ1, pos[0], pos[2]);

        if ((cross1 === 0 && cross2 * cross3 < 0) ||
            (cross2 === 0 && cross1 * cross3 < 0) ||
            (cross3 === 0 && cross1 * cross2 < 0) ||
            (cross1 * cross2 < 0 || cross2 * cross3 < 0)
        ) {
            return false;
        }

        const distanceToSurface = (vec3.dot(tri.normal, pos) + tri.distance) - boundingBoxSize;

        if (distanceToSurface > 0) {
            if (this.surfaceDistY > distanceToSurface) {
                this.hasCollisionY = true;
                this.nearestTriIndexY = index;
                this.surfaceDistY = distanceToSurface;
                vec3.copy(this.normalY, tri.normal);
            }
            return false;
        }

        if (distanceToSurface > -16.0) {
            this.hasCollisionY = true;
            this.nearestTriIndexY = index;
            this.surfaceDistY = distanceToSurface;
            vec3.copy(this.normalY, tri.normal);
            return true;
        }

        return false;
    }

    private checkTriZ(boundingBoxSize: number, pos: vec3, index: number): boolean {
        const triangle = Collision.collisionTris[index];

        if (triangle.min[0] > pos[0] || triangle.max[0] < pos[0] ||
            triangle.max[1] < pos[1] || triangle.min[1] > pos[1] ||
            triangle.min[2] - (boundingBoxSize * 3.0) > pos[2] ||
            triangle.max[2] + (boundingBoxSize * 3.0) < pos[2]
        ) {
            return false;
        }

        const pX1 = triangle.vtx1.x, pY1 = triangle.vtx1.y;
        const pX2 = triangle.vtx2.x, pY2 = triangle.vtx2.y;
        const pX3 = triangle.vtx3.x, pY3 = triangle.vtx3.y;

        const cross1 = product2D(pX1, pY1, pX2, pY2, pos[0], pos[1]);
        const cross2 = product2D(pX2, pY2, pX3, pY3, pos[0], pos[1]);
        const cross3 = product2D(pX3, pY3, pX1, pY1, pos[0], pos[1]);

        if ((cross1 === 0 && cross2 * cross3 < 0) ||
            (cross2 === 0 && cross1 * cross3 < 0) ||
            (cross3 === 0 && cross1 * cross2 < 0) ||
            (cross1 * cross2 < 0 || cross2 * cross3 < 0)
        ) {
            return false;
        }


        const distanceToSurface = vec3.dot(triangle.normal, pos) + triangle.distance - boundingBoxSize;

        if (distanceToSurface > 0.0) {
            if (distanceToSurface < this.surfaceDistZ) {
                this.hasCollisionZ = true;
                this.nearestTriIndexZ = index;
                this.surfaceDistZ = distanceToSurface;
                vec3.copy(this.normalZ, triangle.normal);
            }
            return false;
        }

        if (distanceToSurface > -16.0) {
            this.hasCollisionZ = true;
            this.nearestTriIndexZ = index;
            this.surfaceDistZ = distanceToSurface;
            vec3.copy(this.normalZ, triangle.normal);
            return true;
        }

        return false;
    }

    private checkTriX(boundingBoxSize: number, pos: vec3, index: number): boolean {
        const tri = Collision.collisionTris[index];

        if (tri.min[2] > pos[2] || tri.max[2] < pos[2] ||
            tri.max[1] < pos[1] || tri.min[1] > pos[1] ||
            tri.min[0] - (boundingBoxSize * 3.0) > pos[0] ||
            tri.max[0] + (boundingBoxSize * 3.0) < pos[0]
        ) {
            return false;
        }

        const pZ1 = tri.vtx1.z, pY1 = tri.vtx1.y;
        const pZ2 = tri.vtx2.z, pY2 = tri.vtx2.y;
        const pZ3 = tri.vtx3.z, pY3 = tri.vtx3.y;

        const cross1 = product2D(pZ1, pY1, pZ2, pY2, pos[2], pos[1]);
        const cross2 = product2D(pZ2, pY2, pZ3, pY3, pos[2], pos[1]);
        const cross3 = product2D(pZ3, pY3, pZ1, pY1, pos[2], pos[1]);

        if ((cross1 === 0 && cross2 * cross3 < 0) ||
            (cross2 === 0 && cross1 * cross3 < 0) ||
            (cross3 === 0 && cross1 * cross2 < 0) ||
            (cross1 * cross2 < 0 || (cross3 !== 0 && cross2 * cross3 < 0))
        ) {
            return false;
        }

        const distanceToSurface = vec3.dot(tri.normal, pos) + tri.distance - boundingBoxSize;

        if (distanceToSurface > 0) {
            if (distanceToSurface < this.surfaceDistX) {
                this.hasCollisionX = true;
                this.nearestTriIndexX = index;
                this.surfaceDistX = distanceToSurface;
                vec3.copy(this.normalX, tri.normal);
            }
            return false;
        }

        if (distanceToSurface > -16.0) {
            this.hasCollisionX = true;
            this.nearestTriIndexX = index;
            this.surfaceDistX = distanceToSurface;
            vec3.copy(this.normalX, tri.normal);
            return true;
        }

        return false;
    }

    public calculateSurfaceHeight(x: number, y: number, z: number, triIndex: number): number {
        const triangle = Collision.collisionTris[triIndex];

        if (triangle.normal[1] === 0) {
            return y;
        }

        return ((triangle.normal[0] * x) + (triangle.normal[2] * z) + triangle.distance) / -triangle.normal[1];
    }

    public getTrackSectionId(triIndex: number): number {
        return Collision.collisionTris[triIndex].flags & 0xFF;
    }

    private static parseTrackSections(segmentBuffers: ArrayBufferSlice[], addr: number): void {
        const segment = segmentBuffers[(addr >>> 24)];
        const addrIdx = addr & 0x00FFFFFF;
        const view = segment.createDataView(addrIdx);

        let offs = 0;
        while (true) {

            const dlistAddr: number = view.getUint32(offs + 0x00);
            const surfaceType: ColSurfaceType = view.getUint8(offs + 0x04);
            const sectionId: number = view.getUint8(offs + 0x05);
            const sectionFlags: number = view.getUint16(offs + 0x06);

            if (dlistAddr === 0)
                break;

            Collision.isSectionWall = (sectionFlags & 0x8000) ? true : false;
            Collision.isSectionFlatGround = (sectionFlags & 0x2000) ? true : false;
            Collision.isSectionDoubleSided = (sectionFlags & 0x4000) ? true : false;

            this.genCollisionFromDL(segmentBuffers, dlistAddr, surfaceType, sectionId);

            offs += 8;
        }
    }

    private static genCollisionFromDL(segmentBuffers: ArrayBufferSlice[], addr: number, surfaceType: ColSurfaceType = ColSurfaceType.SurfaceDefault, sectionId = 0xFF): void {
        const segment = segmentBuffers[(addr >>> 24)];
        const addrIdx = addr & 0x00FFFFFF;
        const view = segment.createDataView(addrIdx);

        for (let i = 0; i < 0xFFFF; i += 8) {
            const w0 = view.getUint32(i + 0x00);
            const w1 = view.getUint32(i + 0x04);

            const cmd: F3DEX_GBI = w0 >>> 24;

            switch (cmd) {
                case F3DEX_GBI.G_ENDDL:
                    return;

                case F3DEX_GBI.G_DL:
                    this.genCollisionFromDL(segmentBuffers, w1, surfaceType, sectionId);
                    break;
                case F3DEX_GBI.G_VTX:
                    {
                        const v0 = ((w0 >>> 16) & 0xFF) / 2;
                        const n = (w0 >>> 10) & 0x3F;
                        const baseIndex = ((w1 & 0x00FFFFFF) / 0x10) >>> 0;

                        for (let i = 0; i < n; i++) {
                            Collision.vertexCache[v0 + i] = Collision.collisionVertices[baseIndex + i];
                        }
                    }
                    break;
                case F3DEX_GBI.G_TRI1:
                    {
                        const vtx1 = Collision.vertexCache[((w1 >>> 16) & 0xFF) / 2];
                        const vtx2 = Collision.vertexCache[((w1 >>> 8) & 0xFF) / 2];
                        const vtx3 = Collision.vertexCache[((w1 >>> 0) & 0xFF) / 2];
                        this.getTriangle(vtx1, vtx2, vtx3, surfaceType, sectionId);
                    }
                    break;
                case F3DEX_GBI.G_TRI2:
                    {
                        const vtx1 = Collision.vertexCache[((w0 >>> 16) & 0xFF) / 2];
                        const vtx2 = Collision.vertexCache[((w0 >>> 8) & 0xFF) / 2];
                        const vtx3 = Collision.vertexCache[((w0 >>> 0) & 0xFF) / 2];
                        this.getTriangle(vtx1, vtx2, vtx3, surfaceType, sectionId);
                    }
                    {
                        const vtx1 = Collision.vertexCache[((w1 >>> 16) & 0xFF) / 2];
                        const vtx2 = Collision.vertexCache[((w1 >>> 8) & 0xFF) / 2];
                        const vtx3 = Collision.vertexCache[((w1 >>> 0) & 0xFF) / 2];
                        this.getTriangle(vtx1, vtx2, vtx3, surfaceType, sectionId);
                    }
                    break;
            }
        }
    }
}