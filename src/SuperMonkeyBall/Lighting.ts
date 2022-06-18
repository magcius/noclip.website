import { vec3 } from "gl-matrix";
import { Color, colorCopy, colorNewCopy } from "../Color";
import { SpotFunction } from "../gx/gx_enum";
import * as GX_Material from "../gx/gx_material";
import {
    transformVec3Mat4w0, Vec3Zero
} from "../MathHelpers";
import * as Viewer from "../viewer";
import { BgInfo } from "./StageInfo";
import { S16_TO_RADIANS } from "./Utils";

export class Lighting {
    public ambientColor: Color;
    public infLightViewSpace: GX_Material.Light;

    private infLightWorldSpace: GX_Material.Light;

    constructor(bgInfo: BgInfo) {
        this.ambientColor = colorNewCopy(bgInfo.ambientColor);

        this.infLightWorldSpace = new GX_Material.Light();
        this.infLightViewSpace = new GX_Material.Light();

        colorCopy(this.infLightWorldSpace.Color, bgInfo.infLightColor);

        vec3.set(this.infLightWorldSpace.Position, 0, 0, -1);
        vec3.rotateX(
            this.infLightWorldSpace.Position,
            this.infLightWorldSpace.Position,
            Vec3Zero,
            S16_TO_RADIANS * bgInfo.infLightRotX
        );
        vec3.rotateY(
            this.infLightWorldSpace.Position,
            this.infLightWorldSpace.Position,
            Vec3Zero,
            S16_TO_RADIANS * bgInfo.infLightRotY
        );
        // Move point light far away to emulate directional light
        vec3.scale(this.infLightWorldSpace.Position, this.infLightWorldSpace.Position, 10000);

        GX_Material.lightSetSpot(this.infLightWorldSpace, 0, SpotFunction.OFF);

        this.infLightViewSpace.copy(this.infLightWorldSpace);
    }

    public update(viewerInput: Viewer.ViewerRenderInput) {
        transformVec3Mat4w0(
            this.infLightViewSpace.Position,
            viewerInput.camera.viewMatrix,
            this.infLightWorldSpace.Position
        );
    }
}
