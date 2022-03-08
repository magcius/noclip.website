import * as Viewer from '../viewer';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';

import { ReadonlyVec3, vec3, quat, mat4 } from "gl-matrix";

import { GloverShadowRenderer } from './sprite';
import * as Textures from './textures';


export class ConstantShadowSize {
    constructor(public size: number) {}
}

export interface ShadowCaster {
    getPosition: () => vec3;
    shadowSize: number | ConstantShadowSize;
    shadow: Shadow | null;
    visible: boolean;
}

export interface Collision {
    position: vec3;
    normal: vec3;
}

export interface Collidable {
    // TODO: bbox coordinates
    collides: (rayOrigin: ReadonlyVec3, rayVector: ReadonlyVec3, boundingSphereCheck: boolean) => Collision | null;
    isSelf: (obj: Object) => boolean;
}

export class Shadow {
    private position: vec3 | null = null;
    private normal: vec3;
    private static scratchQuat: quat = quat.create();

    private static renderer: GloverShadowRenderer | null = null;

    public visible: boolean = true;

    // TODO: track the object that the shadow was
    //       cast onto. have a protocol such that
    //       when said object changes its draw matrix,
    //       it calls updatePosition() here

    constructor(private source: ShadowCaster, public terrain: Collidable[], public dynamic: boolean) {
        this.source.shadow = this;
        this.updatePosition();
    }

    public updatePosition(): void {
        let collision = projectOntoTerrain(this.source.getPosition(), this.source, this.terrain);
        if (collision !== null) {
            this.position = collision.position;
            this.normal = collision.normal;
            vec3.scaleAndAdd(this.position, this.position, this.normal, 1.5);
        } else {
            this.position = null;
        }
    }

    public static initializeRenderer(device: GfxDevice, cache: GfxRenderCache, textures: Textures.GloverTextureHolder) {
        if (Shadow.renderer === null) {
            Shadow.renderer = new GloverShadowRenderer(device, cache, textures);
        }
    }

    public static destroyRenderer(device: GfxDevice) {
        if (Shadow.renderer !== null) {
            Shadow.renderer.destroy(device);
            Shadow.renderer = null;
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.dynamic) {
            this.updatePosition();
        }

        if (Shadow.renderer === null || this.position === null) {
            return;
        }        

        if (!this.visible) {
            return;
        }


        let scaleVal = 1/3;
        if (this.source.shadowSize instanceof ConstantShadowSize) {
            // NB: engine expects sprite size to be 10x10 when using a constant
            //     size factor, so we have to scale here
            scaleVal *= this.source.shadowSize.size * 10;
        } else {
            // NB: engine expects shadows sized this way to have a sprite sized 1x1
            const castDist = vec3.dist(this.position, this.source.getPosition()); // TODO: cache value
            const shadowScalar = Math.min(this.source.shadowSize, this.source.shadowSize * Math.sqrt(this.source.shadowSize / castDist));
            scaleVal *= (shadowScalar * 7.0 + this.source.shadowSize);
        }
        quat.rotationTo(Shadow.scratchQuat, this.normal, [0,0,-1]);
        quat.conjugate(Shadow.scratchQuat, Shadow.scratchQuat);
        mat4.fromRotationTranslationScale(Shadow.renderer.drawMatrix,
            Shadow.scratchQuat,
            this.position,
            [scaleVal, scaleVal, scaleVal] 
        );
        Shadow.renderer.prepareToRender(device, renderInstManager, viewerInput);
    }
}

///////////////////////////////////////////////////////
// Möller–Trumbore intersection
// Adapted to typescript from:
//  https://en.wikipedia.org/wiki/M%C3%B6ller%E2%80%93Trumbore_intersection_algorithm
const edge1 = vec3.create();
const edge2 = vec3.create();
const h = vec3.create();
const s = vec3.create();
const q = vec3.create();
export function rayTriangleIntersection (rayOrigin: ReadonlyVec3, rayVector: ReadonlyVec3,
    triangle: vec3[]): vec3 | null
{
    const EPSILON = 0.0000001;
    vec3.sub(edge1, triangle[1], triangle[0]);
    vec3.sub(edge2, triangle[2], triangle[0]);
    vec3.cross(h, rayVector, edge2);
    let a = vec3.dot(edge1, h);
    if (a > -EPSILON && a < EPSILON) {
        // This ray is parallel to this triangle.
        return null;
    }
    let f = 1.0/a;
    vec3.sub(s, rayOrigin, triangle[0]);
    let u = f * vec3.dot(s, h);
    if (u < 0.0 || u > 1.0) {
        return null;
    }
    vec3.cross(q, s, edge1);
    let v = f * vec3.dot(rayVector, q);
    if (v < 0.0 || u + v > 1.0) {
        return null;
    }
    // At this stage we can compute t to find out where the intersection point is on the line.
    let t = f * vec3.dot(edge2, q);
    if (t > EPSILON) {
        let intersection = vec3.create();
        vec3.scaleAndAdd(intersection, rayOrigin, rayVector, t);
        return intersection;
    } else {
        // This means that there is a line intersection but not a ray intersection.
        return null;
    }
}
//
///////////////////////////////////////////////////////

const downwardRay: ReadonlyVec3 = vec3.fromValues(0, -1, 0);

export function projectOntoTerrain(sourcePos: vec3, sourceObj: Object | null, terrain: readonly Collidable[], ray: ReadonlyVec3 = downwardRay, boundingSphereCheck: boolean = true) : Collision | null {
    let closestIntersectionDist = Infinity;
    let closestCollision: Collision | null = null;
    for (let terrainPiece of terrain) {
        if (sourceObj !== null && terrainPiece.isSelf(sourceObj)) {
            continue;
        }
        const collision = terrainPiece.collides(sourcePos, ray, boundingSphereCheck);
        if (collision === null) {
            continue;
        } else {
            const dist = vec3.dist(collision.position, sourcePos);
            if (dist < closestIntersectionDist) {
                closestIntersectionDist = dist;
                closestCollision = collision
            }
        }
    } 
    return closestCollision;
}


