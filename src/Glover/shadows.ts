
import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import * as Viewer from '../viewer.js';
import { ReadonlyVec3, mat4, quat, vec3 } from "gl-matrix";
import { Vec3NegY, Vec3NegZ } from '../MathHelpers.js';
import { GloverShadowRenderer } from './sprite.js';
import * as Textures from './textures.js';

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
        quat.rotationTo(Shadow.scratchQuat, this.normal, Vec3NegZ);
        quat.conjugate(Shadow.scratchQuat, Shadow.scratchQuat);
        mat4.fromRotationTranslationScale(Shadow.renderer.drawMatrix,
            Shadow.scratchQuat,
            this.position,
            [scaleVal, scaleVal, scaleVal]
        );
        Shadow.renderer.prepareToRender(device, renderInstManager, viewerInput);
    }
}

export function projectOntoTerrain(sourcePos: vec3, sourceObj: Object | null, terrain: readonly Collidable[], ray: ReadonlyVec3 = Vec3NegY, boundingSphereCheck: boolean = true) : Collision | null {
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


