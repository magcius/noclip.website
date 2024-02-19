import { Color } from "../Color.js";
import { RwEngine } from "./rw/rwcore.js";

const DEFAULT_NEAR_CLIP = 0.05; // sCameraNearClip
const DEFAULT_FAR_CLIP = 400.0; // sCameraFarClip

export interface HIFogParams {
    start: number;
    stop: number;
    fogcolor: Color;
    bgcolor: Color;
}

export class HICamera {
    public fog?: HIFogParams;

    public begin(rw: RwEngine) {
        if (this.fog) {
            rw.camera.clearColor = this.fog.bgcolor;
        }
        rw.camera.nearPlane = DEFAULT_NEAR_CLIP;
        rw.camera.farPlane = DEFAULT_FAR_CLIP;
        rw.camera.begin(rw);
    }

    public end(rw: RwEngine) {
        rw.camera.end(rw);
    }

    public setFogRenderStates(rw: RwEngine) {
        if (this.fog) {
            rw.renderState.fogEnable = true;
            rw.renderState.fogColor = this.fog.fogcolor;
            rw.camera.fogPlane = this.fog.start;
            rw.camera.farPlane = this.fog.stop;
        } else {
            rw.renderState.fogEnable = false;
            rw.camera.farPlane = DEFAULT_FAR_CLIP;
        }
    }
}