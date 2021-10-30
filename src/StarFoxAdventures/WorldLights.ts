import { mat4, ReadonlyVec3, vec3 } from "gl-matrix";
import * as GX_Material from '../gx/gx_material';
import { colorNewFromRGBA, Color, colorCopy, White, colorNewCopy } from '../Color';
import { ModelRenderContext } from "./models";
import { computeViewMatrix } from "../Camera";
import { mat4SetTranslation } from "./util";
import { SceneRenderContext } from "./render";

export const enum LightType {
    POINT = 0x2,
    DIRECTIONAL = 0x4,
}

export interface Light {
    type: LightType;
    position: vec3;
    direction: vec3;
    color: Color;
    distAtten: vec3;
    // TODO: flags and other parameters...
}

export function createPointLight(position: ReadonlyVec3, color: Color, distAtten: ReadonlyVec3): Light {
    return {
        type: LightType.POINT,
        position: vec3.clone(position),
        direction: vec3.create(),
        color: colorNewCopy(color),
        distAtten: vec3.clone(distAtten),
    };
}

export function createDirectionalLight(direction: ReadonlyVec3, color: Color): Light {
    return {
        type: LightType.DIRECTIONAL,
        position: vec3.create(), // unused
        direction: vec3.clone(direction),
        color: colorNewCopy(color),
        distAtten: vec3.create(), // unused
    };
}

const scratchMtx0 = mat4.create();
const scratchMtx1 = mat4.create();

export class WorldLights {
    private lights: Set<Light> = new Set();

    public addLight(light: Light) {
        this.lights.add(light);
    }

    public removeLight(light: Light) {
        this.lights.delete(light);
    }
    
    public setupLights(lights: GX_Material.Light[], sceneCtx: SceneRenderContext, typeMask: LightType) {
        let i = 0;

        const worldView = scratchMtx0;
        computeViewMatrix(worldView, sceneCtx.viewerInput.camera);
        const worldViewSR = scratchMtx1;
        mat4.copy(worldViewSR, worldView);
        mat4SetTranslation(worldViewSR, 0, 0, 0);

        for (let light of this.lights) {
            if (light.type & typeMask) {
                // TODO: The correct way to setup lights is to use the 8 closest lights to the model. Distance cutoff, material flags, etc. also come into play.
                // TODO: some types of light are specified in view-space, not world-space.

                lights[i].reset();
                if (light.type === LightType.DIRECTIONAL) {
                    vec3.scale(lights[i].Position, light.direction, -100000.0);
                    vec3.transformMat4(lights[i].Position, lights[i].Position, worldViewSR);
                    colorCopy(lights[i].Color, light.color);
                    vec3.set(lights[i].CosAtten, 1.0, 0.0, 0.0);
                    vec3.set(lights[i].DistAtten, 1.0, 0.0, 0.0);
                } else { // LightType.POINT
                    vec3.transformMat4(lights[i].Position, light.position, worldView);
                    // drawWorldSpacePoint(getDebugOverlayCanvas2D(), sceneCtx.viewerInput.camera.clipFromWorldMatrix, light.position);
                    // TODO: use correct parameters
                    colorCopy(lights[i].Color, light.color);
                    vec3.set(lights[i].CosAtten, 1.0, 0.0, 0.0); // TODO
                    vec3.copy(lights[i].DistAtten, light.distAtten);
                }

                i++;
                if (i >= 8)
                    break;
            }
        }

        for (; i < 8; i++)
            lights[i].reset();
    }
}