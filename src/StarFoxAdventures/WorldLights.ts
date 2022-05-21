
import { ReadonlyVec3, vec3 } from "gl-matrix";
import { Color, colorCopy, colorNewCopy, White } from '../Color';
import { SceneRenderContext } from "./render";
import { ObjectInstance } from "./objects";
import { AABB } from "../Geometry";
import { spliceBisectRight } from "../util";
import { clamp, transformVec3Mat4w1 } from "../MathHelpers";

const scratchVec0 = vec3.create();
const scratchVec1 = vec3.create();
const scratchVec2 = vec3.create();
const scratchBox0 = new AABB();

export const enum LightType {
    POINT = 0x2,
    DIRECTIONAL = 0x4,
    PROJECTED = 0x8,
}

export class Light {
    public type: LightType = 0;
    private position: vec3 = vec3.create();
    public direction: vec3 = vec3.create();
    public refDistance: number = 0;
    public radius: number = 0;
    public color: Color = colorNewCopy(White);
    public distAtten: vec3 = vec3.create();
    public obj?: ObjectInstance;
    public affectsMap: boolean = false;

    // Used only when probing lights
    public probedInfluence: number = 0;

    public getPosition(dst: vec3) {
        if (this.obj !== undefined)
            transformVec3Mat4w1(dst, this.obj.getSRTForChildren(), this.position);
        else
            vec3.copy(dst, this.position);
    }

    public setPosition(v: ReadonlyVec3) {
        vec3.copy(this.position, v);
    }

    public setDistanceAndRadius(refDistance: number, radius: number) {
        this.refDistance = refDistance;
        this.radius = radius;
        
        // Distance attenuation values are calculated by GXInitLightDistAttn with GX_DA_MEDIUM mode
        // TODO: Some types of light use other formulae
        const refBrightness = 0.75;
        const kfactor = 0.5 * (1.0 - refBrightness);
        vec3.set(this.distAtten,
            1.0,
            kfactor / (refBrightness * refDistance),
            kfactor / (refBrightness * refDistance * refDistance)
            );
    }
}

export function createPointLight(position: ReadonlyVec3, color: Color, refDistance: number, radius: number): Light {
    const light = new Light();
    light.type = LightType.POINT;
    light.setPosition(position);
    colorCopy(light.color, color);
    light.setDistanceAndRadius(refDistance, radius);
    return light;
}

export function createDirectionalLight(direction: ReadonlyVec3, color: Color): Light {    const light = new Light();
    light.type = LightType.DIRECTIONAL;
    vec3.copy(light.direction, direction);
    vec3.normalize(light.direction, light.direction);
    light.refDistance = 1000000.0; // TODO
    light.radius = 1000000.0; // TODO
    colorCopy(light.color, color);
    return light;
}

export function calcLightInfluenceOnObject(light: Light, obj: ObjectInstance): number {
    const objPos = scratchVec0;
    const lightToObj = scratchVec1;
    const lightPos = scratchVec2;

    obj.getPosition(objPos);
    light.getPosition(lightPos);
    vec3.sub(lightToObj, objPos, lightPos);

    let dist = vec3.length(lightToObj);
    dist -= obj.cullRadius * obj.scale;
    if (dist > 1000.0 || dist > light.radius)
        return 0.0;

    let result = 1.0;
    if (dist >= light.refDistance)
        result = 1.0 - (dist - light.refDistance) / (light.radius - light.refDistance);

    // TODO: adjust result for directional lights

    return result;
}

function applyColorToInfluence(influence: number, color: Color): number {
    const rInfluence = clamp(influence * color.r, 0, 1);
    const gInfluence = clamp(influence * color.g, 0, 1);
    const bInfluence = clamp(influence * color.b, 0, 1);
    return Math.max(rInfluence, gInfluence, bInfluence);
}

export class WorldLights {
    public lights: Set<Light> = new Set();

    public addLight(light: Light) {
        this.lights.add(light);
    }

    public removeLight(light: Light) {
        this.lights.delete(light);
    }

    public probeLightsOnObject(obj: ObjectInstance, sceneCtx: SceneRenderContext, typeMask: LightType, maxLights: number): Light[] {
        const probedLights: Light[] = [];

        for (let light of this.lights) {
            if (!(light.type & typeMask))
                continue;

            if (light.type == LightType.DIRECTIONAL)
                // Sun and moon get massive influence
                light.probedInfluence = 1000.0;
            else {
                light.probedInfluence = calcLightInfluenceOnObject(light, obj);
                light.probedInfluence = applyColorToInfluence(light.probedInfluence, light.color);
                if (light.probedInfluence <= 0.0)
                    continue;
            }

            spliceBisectRight(probedLights, light, (a, b) => b.probedInfluence - a.probedInfluence);

            if (probedLights.length >= maxLights)
                probedLights.pop();
        }

        return probedLights;
    }

    public probeLightsOnMapBox(aabb: AABB, typeMask: LightType, maxLights: number): Light[] {
        const center = scratchVec0;
        const lightPos = scratchVec1;
        const lightBox = scratchBox0;

        aabb.centerPoint(center);

        const probedLights: Light[] = [];

        for (let light of this.lights) {
            if (!(light.type & typeMask))
                continue;
            
            if (!light.affectsMap)
                continue;

            if (light.radius <= 0)
                continue;
                
            light.getPosition(lightPos);
            lightBox.set(lightPos[0] - light.radius, lightPos[1] - light.radius, lightPos[2] - light.radius,
                lightPos[0] + light.radius, lightPos[1] + light.radius, lightPos[2] + light.radius);
            if (!AABB.intersect(lightBox, aabb))
                continue;

            const dist = vec3.dist(lightPos, center);

            light.probedInfluence = 1.0 / (light.distAtten[0] + light.distAtten[1] * dist + light.distAtten[2] * dist * dist);
            light.probedInfluence = applyColorToInfluence(light.probedInfluence, light.color);
            if (light.probedInfluence <= 0.0)
                continue;

            spliceBisectRight(probedLights, light, (a, b) => b.probedInfluence - a.probedInfluence);

            if (probedLights.length >= maxLights)
                probedLights.pop();
        }

        return probedLights;
    }
}