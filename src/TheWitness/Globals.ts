
import { Entity_Manager } from "./Entity";
import { Asset_Manager, Asset_Type } from "./Assets";
import { GfxClipSpaceNearZ, GfxDevice } from "../gfx/platform/GfxPlatform";
import { mat4, vec3 } from "gl-matrix";
import { Frustum } from "../Geometry";
import { getMatrixTranslation } from "../MathHelpers";
import { Camera } from "../Camera";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { assert, decodeString } from "../util";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { Occlusion_Manager } from "./Occlusion";

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

type Variables = { [k: string]: { [k: string]: string | number | boolean } };

function parse_variables(contents: ArrayBufferSlice): Variables {
    const lines = decodeString(contents).split('\n');

    const dst: ReturnType<typeof parse_variables> = {};
    let currentCategory: typeof dst[string] = {};
    for (let line of lines) {
        line = line.trim();
        if (line === '')
            continue;

        if (line.startsWith('#')) {
            // Comment
            continue;
        }

        if (line.startsWith(':/')) {
            // Category
            const categoryName = line.slice(2);
            if (dst[categoryName] === undefined)
                dst[categoryName] = {};
            currentCategory = dst[categoryName];
        } else {
            const [name, tok] = line.split(' ');
            let value: typeof currentCategory[string];

            if (tok.startsWith('"')) {
                // parse quotes
                value = tok.slice(1, -1);
            } else if (tok === 'false' || tok === 'true') {
                value = tok === 'true';
            } else {
                value = Number(tok);
                assert(!Number.isNaN(value));
            }

            currentCategory[name] = value;
        }
    }
    return dst;
}

export class TheWitnessGlobals {
    public entity_manager = new Entity_Manager();
    public viewpoint = new Viewpoint();
    public cache: GfxRenderCache;
    public all_variables: Variables;
    public sky_variables: Variables;
    public occlusion_manager: Occlusion_Manager;

    constructor(public device: GfxDevice, public asset_manager: Asset_Manager) {
        this.cache = new GfxRenderCache(this.device);
        this.occlusion_manager = new Occlusion_Manager(this.device);

        this.all_variables = parse_variables(this.asset_manager.load_asset(Asset_Type.Raw, `All.variables`)!);
        this.sky_variables = parse_variables(this.asset_manager.load_asset(Asset_Type.Raw, `sky.variables`)!);
    }

    public destroy(device: GfxDevice): void {
        this.asset_manager.destroy(device);
    }
}
