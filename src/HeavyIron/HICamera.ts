import { mat4, vec3 } from "gl-matrix";
import { Color } from "../Color.js";
import { RpAtomic } from "./rw/rpworld.js";
import { RwEngine } from "./rw/rwcore.js";

const DEFAULT_NEAR_CLIP = 0.05; // sCameraNearClip
const DEFAULT_FAR_CLIP = 400.0; // sCameraFarClip

export interface HIFogParams {
    start: number;
    stop: number;
    fogcolor: Color;
    bgcolor: Color;
}

const scratchVec3 = vec3.create();

export class HICamera {
    public fog?: HIFogParams;
    public disableFogHack = false;
    public disableFrustumCullHack = false;

    public begin(rw: RwEngine) {
        if (this.fog) {
            rw.camera.clearColor = this.fog.bgcolor;
        }

        rw.camera.nearPlane = DEFAULT_NEAR_CLIP;
        if (this.fog && !this.disableFogHack) {
            rw.camera.farPlane = this.fog.stop;
        } else {
            rw.camera.farPlane = DEFAULT_FAR_CLIP;
        }

        rw.camera.begin(rw);
    }

    public end(rw: RwEngine) {
        rw.camera.end(rw);
    }

    public setFogRenderStates(rw: RwEngine) {
        if (this.fog && !this.disableFogHack) {
            rw.renderState.setFogEnabled(true);
            rw.renderState.setFogColor(this.fog.fogcolor);
            rw.camera.fogPlane = this.fog.start;
            rw.camera.farPlane = this.fog.stop;
        } else {
            rw.renderState.setFogEnabled(false);
            rw.camera.farPlane = DEFAULT_FAR_CLIP;
        }
    }

    public cullModel(model: RpAtomic, mat: mat4, rw: RwEngine) {
        if (this.disableFrustumCullHack) return false;
        
        const sph = model.geometry.morphTargets[0].boundingSphere;
    
        const scale = scratchVec3;
        mat4.getScaling(scale, mat);
        const radius = sph[3] * Math.max(scale[0], scale[1], scale[2]);
    
        const center = scratchVec3;
        vec3.set(center, sph[0], sph[1], sph[2]);
        vec3.transformMat4(center, center, mat);
    
        return !rw.camera.frustumContainsSphere(center, radius, rw);
    }
}