
import { Entity, Entity_Manager } from "./Entity";
import { Asset_Manager } from "./Assets";
import { GfxClipSpaceNearZ, GfxDevice } from "../gfx/platform/GfxPlatform";
import { mat4, vec3 } from "gl-matrix";
import { Frustum } from "../Geometry";
import { getMatrixTranslation } from "../MathHelpers";
import { Camera } from "../Camera";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";

const noclipSpaceFromTheWitnessSpace = mat4.fromValues(
    1, 0,  0, 0,
    0, 0, -1, 0,
    0, 1,  0, 0,
    0, 0,  0, 1,
);

export class Viewpoint {
    // aka viewMatrix
    public viewFromWorldMatrix = mat4.create();
    // aka worldMatrix
    public worldFromViewMatrix = mat4.create();
    public clipFromWorldMatrix = mat4.create();
    // aka projectionMatrix
    public clipFromViewMatrix = mat4.create();

    public clipSpaceNearZ: GfxClipSpaceNearZ;

    // The current camera position, in The Witness world space.
    public cameraPos = vec3.create();

    // Frustum is stored in The Witness world space.
    public frustum = new Frustum();

    public finishSetup(): void {
        mat4.invert(this.worldFromViewMatrix, this.viewFromWorldMatrix);
        mat4.mul(this.clipFromWorldMatrix, this.clipFromViewMatrix, this.viewFromWorldMatrix);
        getMatrixTranslation(this.cameraPos, this.worldFromViewMatrix);
        this.frustum.updateClipFrustum(this.clipFromWorldMatrix, this.clipSpaceNearZ);
        this.frustum.newFrame();
    }

    public setupFromCamera(camera: Camera): void {
        this.clipSpaceNearZ = camera.clipSpaceNearZ;
        mat4.mul(this.viewFromWorldMatrix, camera.viewMatrix, noclipSpaceFromTheWitnessSpace);
        mat4.copy(this.clipFromViewMatrix, camera.projectionMatrix);
        this.finishSetup();
    }
}

export class TheWitnessGlobals {
    public entity_manager = new Entity_Manager();
    public asset_manager: Asset_Manager;
    public viewpoint = new Viewpoint();
    public cache: GfxRenderCache;

    constructor(public device: GfxDevice) {
        this.cache = new GfxRenderCache(this.device);
    }

    public destroy(device: GfxDevice): void {
        this.asset_manager.destroy(device);
    }
}
