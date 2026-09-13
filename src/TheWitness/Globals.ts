
import { Entity_Manager, Entity_Render_List, Light_Manager } from "./Entity.js";
import { Shadow_Map } from "./Shadow_Map.js";
import { Asset_Manager, Asset_Type } from "./Assets.js";
import { GfxClipSpaceNearZ, GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { mat4, vec3 } from "gl-matrix";
import { Frustum } from "../Geometry.js";
import { getMatrixTranslation } from "../MathHelpers.js";
import { Camera } from "../Camera.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager.js";
import { assert, decodeString } from "../util.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { Occlusion_Manager } from "./Occlusion.js";
import { Render_Material_Cache as Device_Material_Cache } from "./Render.js";
import { DebugDraw } from "../gfx/helpers/DebugDraw.js";

export const noclipSpaceFromTheWitnessSpace = mat4.fromValues(
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
            let [name, tok] = line.split(' ');
            let value: typeof currentCategory[string];

            if (tok.startsWith('"')) {
                // parse quotes
                value = tok.slice(1, -1);
            } else if (tok === 'false' || tok === 'true') {
                value = tok === 'true';
            } else {
                if (tok.endsWith('f'))
                    tok = tok.slice(0, -1);
                value = Number(tok);
                assert(!Number.isNaN(value));
            }

            currentCategory[name] = value;
        }
    }
    return dst;
}

class Render_Settings {
    public grass_fade_begin = 48.0;
    public lod_distance = 64.0;
    public cluster_distance = 128.0;
    public cull_threshold = 0.004;
    public detail_cull_distance = 96.0;

    // debug
    public lod_distance_enabled = true;
    public cull_distance_enabled = true;
}

export class TheWitnessGlobals {
    public entity_manager = new Entity_Manager();
    public entity_render_list = new Entity_Render_List();
    public light_manager = new Light_Manager();
    public viewpoint = new Viewpoint();
    public renderCache: GfxRenderCache;
    public debug_draw: DebugDraw;
    public all_variables: Variables;
    public sky_variables: Variables;
    public shadow_map: Shadow_Map | null = null;
    public occlusion_manager: Occlusion_Manager;
    public device_material_cache: Device_Material_Cache;
    public render_settings = new Render_Settings();
    public scene_time = 0.0;
    // How many more entities may create their assets this frame; see Entity.ensure_assets_loaded.
    public asset_loads_remaining = 0;
    // Entities below this much of the screen don't get to load yet, so the budget goes to what
    // fills the view. It moves with how much is waiting; see TheWitnessRenderer.prepareToRender.
    public asset_load_priority_floor = 0.0;
    public asset_loads_deferred = 0;
    // Water is drawn in a pass of its own, after the scene it looks through; see Render.ts.
    public water_render_inst_list: GfxRenderInstList | null = null;

    constructor(public device: GfxDevice, public asset_manager: Asset_Manager) {
        this.renderCache = new GfxRenderCache(this.device);
        this.occlusion_manager = new Occlusion_Manager(this.device);
        this.device_material_cache = new Device_Material_Cache();

        this.all_variables = parse_variables(this.asset_manager.load_asset(Asset_Type.Raw, `All.variables`)!);
        this.sky_variables = parse_variables(this.asset_manager.load_asset(Asset_Type.Raw, `sky.variables`)!);

        // Bloom and tone mapping are not in All.variables; they ship as files of their own, and
        // they declare the very categories the post process asks for -- render/bloom and
        // render/tone_mapping. Not loading them left it falling back on constants that had been
        // copied out of these same files by hand, and on invented exposure limits in place of
        // the luminance band they state.
        for (const name of [`bloom.variables`, `tone_mapping.variables`]) {
            const contents = this.asset_manager.load_asset(Asset_Type.Raw, name);
            if (contents === null)
                continue;
            for (const [category, values] of Object.entries(parse_variables(contents)))
                this.all_variables[category] = Object.assign(this.all_variables[category] ?? {}, values);
        }
    }

    public destroy(device: GfxDevice): void {
        this.asset_manager.destroy(device);
        this.occlusion_manager.destroy(device);
        this.device_material_cache.destroy(device);
        this.renderCache.destroy();
    }
}
