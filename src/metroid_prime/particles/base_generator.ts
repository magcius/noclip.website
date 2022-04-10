import { InputStream } from '../stream';
import { ReadonlyMat4, ReadonlyVec3, vec3 } from 'gl-matrix';
import { clamp } from '../../MathHelpers';
import { AABB } from '../../Geometry';
import { GfxDevice } from '../../gfx/platform/GfxPlatform';
import * as Viewer from '../../viewer';
import { ResourceSystem } from '../resource';
import { assert } from '../../util';
import { CMDL } from '../cmdl';
import { noclipSpaceFromPrimeSpace } from '../render';
import { Color, colorNewFromRGBA } from '../../Color';
import { ElementGenerator, ElementGeneratorMaterialHelper } from './element_generator';
import * as GX_Material from '../../gx/gx_material';
import { RetroSceneRenderer } from '../scenes';

const scratchAABB = new AABB();

export interface NumberHolder {
    value: number;
}

export class Particle {
    public endFrame: NumberHolder = { value: 0 };
    public pos: vec3 = vec3.create();
    public prevPos: vec3 = vec3.create();
    public vel: vec3 = vec3.create();
    public startFrame: number = 0;
    public lineLengthOrSize: NumberHolder = { value: 0 };
    public lineWidthOrRota: NumberHolder = { value: 0 };
    public color: Color = colorNewFromRGBA(1.0, 1.0, 1.0, 1.0);
}

export class ParticleGlobals {
    public emitterTime: number = 0;
    public particleLifetimePercentage: number = 0;
    public particleLifetimePercentageRemainder: number = 0;
    public particleLifetime: number = 0;
    public currentParticleSystem: ElementGenerator;
    public currentParticle: Particle;
    public particleAccessParameters: NumberHolder[] | null = null;
    public particleAccessParametersGroup: number;

    public UpdateParticleLifetimeTweenValues(frame: number): void {
        const lt = this.particleLifetime !== 0 ? this.particleLifetime : 1.0;
        this.particleLifetimePercentage = 100.0 * frame / lt;
        this.particleLifetimePercentageRemainder = this.particleLifetimePercentage - Math.trunc(this.particleLifetimePercentage);
        this.particleLifetimePercentage = Math.trunc(clamp(this.particleLifetimePercentage, 0, 100));
    }
}

export const defaultParticleGlobals = new ParticleGlobals();

export class Warp {
    public UpdateWarp(): boolean {
        return false;
    }

    public ModifyParticles(particles: Particle[]): void {

    }
}

export interface Light {
    gxLight: GX_Material.Light;
    custom: boolean;
}

export abstract class BaseGenerator {
    public modifierList: Warp[] = [];

    public abstract Update(device: GfxDevice, dt: number): boolean;
    public abstract Render(renderer: RetroSceneRenderer, viewerInput: Viewer.ViewerRenderInput): void;
    public abstract SetGlobalTranslation(translation: ReadonlyVec3): void;
    public abstract GetGlobalTranslation(): ReadonlyVec3;
    public abstract SetGlobalOrientation(orientation: ReadonlyMat4): void;
    public abstract GetGlobalOrientation(): ReadonlyMat4;
    public abstract SetGlobalScale(scale: ReadonlyVec3): void;
    public abstract GetGlobalScale(): ReadonlyVec3;
    public abstract SetTranslation(translation: ReadonlyVec3): void;
    public abstract GetTranslation(): ReadonlyVec3;
    public abstract SetOrientation(orientation: ReadonlyMat4): void;
    public abstract GetOrientation(): ReadonlyMat4;
    public abstract SetLocalScale(scale: ReadonlyVec3): void;
    public abstract SetParticleEmission(emission: boolean): void;
    public abstract SetModulationColor(color: Color): void;
    public abstract GetModulationColor(): Color;
    public abstract SetGeneratorRate(rate: number): void;
    public abstract GetGeneratorRate(): number;
    public abstract IsSystemDeletable(): boolean;
    public abstract GetBounds(): AABB | null;
    public abstract SystemHasLight(): boolean;
    public abstract GetLight(): Light;
    public abstract GetParticleCount(): number;
    public abstract DestroyParticles(): void;
    public abstract Destroy(device: GfxDevice): void;

    public AddModifier(mod: Warp): void {
        this.modifierList.push(mod);
    }

    private static isInBoundsInternal(bounds: AABB, viewerInput: Viewer.ViewerRenderInput): boolean {
        scratchAABB.transform(bounds, noclipSpaceFromPrimeSpace);
        return viewerInput.camera.frustum.contains(scratchAABB);
    }

    public isInBoundsForUpdate(viewerInput: Viewer.ViewerRenderInput): boolean {
        const bounds = this.GetBounds();
        if (!bounds) {
            return true;
        }
        return BaseGenerator.isInBoundsInternal(bounds, viewerInput);
    }

    public isInBoundsForRender(viewerInput: Viewer.ViewerRenderInput): boolean {
        const bounds = this.GetBounds();
        if (bounds) {
            return BaseGenerator.isInBoundsInternal(bounds, viewerInput);
        }
        return false;
    }

    public prepareToRender(renderer: RetroSceneRenderer, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.isInBoundsForRender(viewerInput))
            this.Render(renderer, viewerInput);
    }
}

export function GetBool(stream: InputStream): boolean {
    const type = stream.readFourCC();
    assert(type === 'CNST');
    return stream.readBool();
}

export function GetFlags(stream: InputStream): number {
    const type = stream.readFourCC();
    assert(type === 'CNST');
    const dtype = stream.readFourCC();
    const byteCount = stream.readUint32();
    if (dtype === 'BITF') {
        return stream.readUint32();
    }
    stream.skip(byteCount);
    return 0;
}

export function GetModel(stream: InputStream, resourceSystem: ResourceSystem): CMDL | null {
    const type = stream.readFourCC();
    if (type === 'NONE')
        return null;
    const cmdlId = stream.readAssetID();
    return resourceSystem.loadAssetByID<CMDL>(cmdlId, 'CMDL');
}

export class GeneratorMaterialHelpers {
    public elementHelper: ElementGeneratorMaterialHelper = new ElementGeneratorMaterialHelper();
}
