
import { mat4, quat, vec3 } from "gl-matrix";
import { computeViewSpaceDepthFromWorldSpacePoint } from "../Camera.js";
import { Color, colorNewCopy, Magenta } from "../Color.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { scaleMatrix } from "../MathHelpers.js";
import { leftPad } from "../util.js";
import { Asset_Type, Lightmap_Asset, Mesh_Asset } from "./Assets.js";
import { TheWitnessGlobals } from "./Globals.js";
import { Mesh_Instance } from "./Render.js";

export class Entity_Manager {
    public flat_entity_list: Entity[] = [];
    public entity_list: Entity[] = [];
    public universe_name = `save`;

    public load_world(globals: TheWitnessGlobals): void {
        const world = globals.asset_manager.load_asset(Asset_Type.World, this.universe_name)!;

        for (let i = 0; i < world.length; i++) {
            const entity = world[i];
            this.flat_entity_list.push(entity);
            this.entity_list[entity.portable_id] = entity;
        }

        // Set up groups & initial group visibility

        // Go through and register clusters.
        for (let i = 0; i < this.flat_entity_list.length; i++)
            if (this.flat_entity_list[i] instanceof Entity_Cluster)
                (this.flat_entity_list[i] as Entity_Cluster).validate(globals);

        // Initialize groups & group visibility
        for (let i = 0; i < this.flat_entity_list.length; i++)
            if (this.flat_entity_list[i] instanceof Entity_Group)
                (this.flat_entity_list[i] as Entity_Group).initialize(globals);

        // Finalize actor creation.
        for (let i = 0; i < this.flat_entity_list.length; i++)
            this.flat_entity_list[i].transport_create_hook(globals);

        globals.occlusion_manager.init(globals);
        globals.light_manager.init(globals);
        globals.entity_render_list.init(globals);
    }
}

export class Entity_Render_List {
    public clusters: Entity_Cluster[] = [];
    public unclustered_entities: Entity[] = [];

    public init(globals: TheWitnessGlobals): void {
        for (let i = 0; i < globals.entity_manager.flat_entity_list.length; i++) {
            const entity = globals.entity_manager.flat_entity_list[i];
            if (entity instanceof Entity_Cluster)
                this.clusters.push(entity);
            else if (entity.cluster_id === undefined)
                this.unclustered_entities.push(entity);
        }

        // Biggest first. Only so many entities may build their assets in a frame, and walking
        // the world in the order it was written spends that on whatever happened to come first
        // -- a shrub as readily as the sea. Sorting by size puts the terrain, the water and the
        // headlands at the front, so the shape of the island arrives before its clutter.
        const by_size = (a: Entity, b: Entity) => b.bounding_radius_world - a.bounding_radius_world;
        this.clusters.sort(by_size);
        this.unclustered_entities.sort(by_size);

        // The elements inside each cluster get the same treatment. This runs after the transport
        // hooks, which is where an entity works out how big it is.
        for (let i = 0; i < this.clusters.length; i++) {
            this.clusters[i].elements.sort((a, b) => {
                const entity_a = globals.entity_manager.entity_list[a], entity_b = globals.entity_manager.entity_list[b];
                return (entity_b !== undefined ? entity_b.bounding_radius_world : 0.0) - (entity_a !== undefined ? entity_a.bounding_radius_world : 0.0);
            });
        }
    }
}

export interface Portable {
    portable_id: number;
    revision_number: number;
    type_name: string;
    [k: string]: any;
}

function get_lightmap_page_name(base: string, state: number): string {
    const numChars = state < 0x101 ? 2 : 8;
    return `${base}_${leftPad('' + state.toString(16).toUpperCase(), numChars)}`;
}

export class Lightmap_Table {
    public dependency_array: number[];
    public state_array: number[];
    public lightmap_page_array: (Lightmap_Asset | null)[] = [];

    public current_page: Lightmap_Asset | null = null;
    public next_page: Lightmap_Asset | null = null;
    public blend: number = 1.0;

    public load_pages(globals: TheWitnessGlobals, entity: Entity): void {
        const lightmap_page_name_base = `${globals.entity_manager.universe_name}_${entity.portable_id}`;
        for (let i = 0; i < this.state_array.length; i++) {
            const state = this.state_array[i];
            const lightmap_page_name = get_lightmap_page_name(lightmap_page_name_base, state);
            this.lightmap_page_array[i] = globals.asset_manager.load_asset(Asset_Type.Lightmap, lightmap_page_name);
        }
        this.update();
    }

    public update(): void {
        // TODO(jstpierre): Update from dependencies.
        this.current_page = this.lightmap_page_array[0];
        this.next_page = null;
    }
}

enum Entity_Flags {
    LodsToNothing   = 0x00001000,
    Invisible       = 0x00008000,
    DoNotCull       = 0x20000000,
}

export class Entity implements Portable {
    public visible = true; // debug visible flag
    public layer_active = true; // layer/group visible flag
    public type_name: string;
    public debug_color = colorNewCopy(Magenta);

    public entity_manager: Entity_Manager;

    public position: vec3;
    public scale: number;
    public orientation: quat;
    public entity_flags: Entity_Flags;
    public entity_name: string;
    public group_id: number;
    public mount_parent_id: number;
    public mount_position?: vec3;
    public mount_scale?: number;
    public mount_orientation?: quat;
    public mount_bone_name?: string;
    public version: number;
    public root_z: number;
    public cluster_id?: number;
    public lod_distance: number;
    public lightmap_table: Lightmap_Table | null;
    public bounding_radius: number;
    public bounding_center: vec3;

    public bounding_center_world = vec3.create();
    public bounding_radius_world = 0;

    public mesh_instance: Mesh_Instance | null = null;

    // Culling Data
    private lod_distance_squared: number = Infinity;
    private cull_distance_squared: number = Infinity;
    private assets_loaded: boolean = false;

    // Mesh_Render_Params
    public model_matrix = mat4.create();
    public color: Color | null;
    public mesh_lod: number = 0;
    // The lights that reach this entity. Neither they nor it ever move, so this is worked out
    // the first time it draws and then kept; see Light_Manager.
    public light_set: Entity_Light[] | null = null;

    constructor(public portable_id: number, public revision_number: number) {
    }

    public transport_create_hook(globals: TheWitnessGlobals): void {
        this.visible = !(this.entity_flags & Entity_Flags.Invisible);

        this.updateModelMatrix();
    }

    // A world holds tens of thousands of entities, and the meshes, textures and lightmaps for
    // all of them at once are far more than a renderer process can hold -- creating them up
    // front runs it out of memory. Each entity's assets are created the first time it is about
    // to be drawn instead, which keeps only what the camera has seen resident.
    // Roughly how much of the screen this entity stands to cover: the nearer and the larger it
    // is, the sooner it deserves to be built. The world holds far more than a frame can afford,
    // so this is what decides the order things appear in.
    public asset_load_priority(squared_distance: number): number {
        return (this.bounding_radius_world * this.bounding_radius_world) / Math.max(squared_distance, 0.01);
    }

    public assets_are_loaded(): boolean {
        return this.assets_loaded;
    }

    public ensure_assets_loaded(globals: TheWitnessGlobals): void {
        if (this.assets_loaded)
            return;

        // Only a few entities may load in any one frame. Doing a whole visible world at once
        // builds gigabytes of intermediate buffers with no chance to collect them in between,
        // which is enough to lose the renderer process; the rest arrive over the next frames.
        if (globals.asset_loads_remaining <= 0)
            return;
        globals.asset_loads_remaining--;

        this.assets_loaded = true;
        this.load_assets(globals);
    }

    protected load_assets(globals: TheWitnessGlobals): void {
        if (this.lightmap_table !== null)
            this.lightmap_table.load_pages(globals, this);
    }

    protected updateModelMatrix(): void {
        mat4.fromRotationTranslation(this.model_matrix, this.orientation, this.position);
        scaleMatrix(this.model_matrix, this.model_matrix, this.scale);
        vec3.add(this.bounding_center_world, this.bounding_center, this.position);
        this.bounding_radius_world = this.bounding_radius * this.scale;
    }

    private compute_lod_distance_squared(globals: TheWitnessGlobals): number {
        let lod_distance = this.lod_distance;
        if (lod_distance < 0.0) {
            lod_distance = globals.render_settings.lod_distance;
            // TODO(jstpierre): grass fade
        }

        if (!(this.entity_flags & Entity_Flags.LodsToNothing)) {
            // If we aren't LODing to nothing, and our mesh only has one LOD, then never switch.
            if (this.mesh_instance !== null && this.mesh_instance.mesh_asset.max_lod_count <= 1)
                return Infinity;

            lod_distance = Math.min(lod_distance, globals.render_settings.cluster_distance * 0.75);
        }

        if (lod_distance === 0.0)
            return 0.0;

        lod_distance += this.bounding_radius_world;
        return lod_distance ** 2.0;
    }

    private compute_cull_distance_squared(globals: TheWitnessGlobals): number {
        // noclip change: since we don't have a LOD transition animation, LodsToNothing just becomes our LOD distance
        if (!!(this.entity_flags & Entity_Flags.LodsToNothing))
            return this.lod_distance_squared;

        if (this.entity_flags & (Entity_Flags.DoNotCull | Entity_Flags.LodsToNothing))
            return Infinity;

        // TODO(jstpierre): Check for cluster
        // TODO(jstpierre): grass fade

        if (false /*this.is_detail*/) {
            let cull_distance = globals.render_settings.detail_cull_distance + this.bounding_radius_world;
            return cull_distance ** 2.0;
        }

        let cull_distance_squared = (this.bounding_radius_world ** 2.0) / (globals.render_settings.cull_threshold * 0.02);
        if (this.lod_distance > 0.0)
            cull_distance_squared = Math.max(cull_distance_squared, (this.lod_distance * 2.0 + this.bounding_radius_world) ** 2.0);
        return cull_distance_squared;
    }

    private update_lod_settings(globals: TheWitnessGlobals): void {
        this.lod_distance_squared = this.compute_lod_distance_squared(globals);
        this.cull_distance_squared = this.compute_cull_distance_squared(globals);
    }

    protected create_mesh_instance(globals: TheWitnessGlobals, mesh_asset: Mesh_Asset | null): void {
        if (mesh_asset === null) {
            this.mesh_instance = null;
            return;
        }

        this.mesh_instance = new Mesh_Instance(globals, mesh_asset);
        this.update_lod_settings(globals);
    }

    public prepareToRender(globals: TheWitnessGlobals, renderInstManager: GfxRenderInstManager): void {
        if (!this.visible || !this.layer_active)
            return;

        const squared_distance = vec3.squaredDistance(globals.viewpoint.cameraPos, this.bounding_center_world);
        if (globals.render_settings.cull_distance_enabled && squared_distance >= this.cull_distance_squared)
            return;

        if (this.mesh_instance === null) {
            // Don't spend the frame's asset budget on an entity the camera can't see; a world's
            // worth of them off screen would otherwise starve the ones in front of us. A radius
            // of zero means the entity never said how big it is, so let those through.
            if (this.bounding_radius_world > 0.0 && !globals.viewpoint.frustum.containsSphere(this.bounding_center_world, this.bounding_radius_world))
                return;

            if (this.asset_load_priority(squared_distance) < globals.asset_load_priority_floor) {
                globals.asset_loads_deferred++;
                return;
            }

            this.ensure_assets_loaded(globals);

            if (this.mesh_instance === null)
                return;
        }

        // A mesh can carry up to seven levels of detail -- the lake tiles that make up the sea
        // do -- and picking only between the first two leaves the coarse ones unused, drawing
        // the whole ocean at its finest. Each step out covers twice the distance of the one
        // before it, and the mesh's own count says how far the chain goes.
        this.mesh_lod = 0;
        if (globals.render_settings.lod_distance_enabled && squared_distance >= this.lod_distance_squared) {
            const max_lod_count = this.mesh_instance !== null ? this.mesh_instance.mesh_asset.max_lod_count : 1;
            const steps = 1 + Math.floor(0.5 * Math.log2(squared_distance / this.lod_distance_squared));
            this.mesh_lod = Math.min(steps, max_lod_count - 1);
        }

        if (this.light_set === null)
            this.light_set = globals.light_manager.gather(this.bounding_center_world, this.bounding_radius_world);

        const depth = computeViewSpaceDepthFromWorldSpacePoint(globals.viewpoint.viewFromWorldMatrix, this.bounding_center_world);
        this.mesh_instance.prepareToRender(globals, renderInstManager, this, depth);
    }
}

export class Entity_Inanimate extends Entity {
    public mesh_name: string = '';
    public color_override: number = 0;

    public override transport_create_hook(globals: TheWitnessGlobals): void {
        super.transport_create_hook(globals);

        if (!this.color_override)
            this.color = null;
    }

    protected override load_assets(globals: TheWitnessGlobals): void {
        super.load_assets(globals);

        if (this.mesh_name) {
            const mesh_asset = globals.asset_manager.load_asset(Asset_Type.Mesh, this.mesh_name);
            this.create_mesh_instance(globals, mesh_asset);
        }
    }
}

// A Light is a point light: a colour, an intensity, and a radius it carries that far and no
// further. The bakes hold the island's daylight, but they are only as fine as their texels and
// they carry none of the game's interior lamps, so the caves and the huts are lit by these.
//
// The colour is read into `color`, which on every other entity is the material colour override
// -- and Entity_Inanimate's hook clears that one. So the light takes its own copy first.
export class Entity_Light extends Entity_Inanimate {
    public intensity: number = 0.0;
    public radius: number = 0.0;

    public light_color = vec3.fromValues(1.0, 1.0, 1.0);
    public light_strength: number = 0.0;

    public override transport_create_hook(globals: TheWitnessGlobals): void {
        const unpacked = this.color as unknown as vec3 | null;
        if (unpacked !== null && unpacked !== undefined && unpacked.length === 3)
            vec3.copy(this.light_color, unpacked);

        super.transport_create_hook(globals);

        this.light_strength = Math.max(this.light_color[0], this.light_color[1], this.light_color[2]) * this.intensity;
    }

    public lights_anything(): boolean {
        return this.radius > 0.0 && this.light_strength > 0.0;
    }

    // Has to agree with the shader, which is what actually shades by it; see Render.ts.
    public falloff_at(squared_distance: number): number {
        let window = 1.0 - squared_distance / (this.radius * this.radius);
        if (window <= 0.0)
            return 0.0;
        window *= window;
        return window / (squared_distance + 1.0);
    }
}

// At most this many lights shade any one entity. The world holds 37 and a handful of rooms have
// several, but past four the nearest ones have swamped the rest anyway.
export const MAX_LIGHTS_PER_ENTITY = 4;

// Which lights reach a given entity never changes -- the lights are static and so is everything
// they light -- so it is worked out once, the first time the entity is drawn, and then kept.
export class Light_Manager {
    public lights: Entity_Light[] = [];

    public init(globals: TheWitnessGlobals): void {
        for (let i = 0; i < globals.entity_manager.flat_entity_list.length; i++) {
            const entity = globals.entity_manager.flat_entity_list[i];
            if (entity instanceof Entity_Light && entity.lights_anything())
                this.lights.push(entity);
        }
    }

    // The lights that reach this sphere, strongest first. Measured at the nearest point of the
    // sphere to each light, which is the brightest the entity can be lit anywhere on it.
    public gather(center: vec3, radius: number): Entity_Light[] {
        for (let i = 0; i < this.lights.length; i++) {
            const light = this.lights[i];
            const distance = Math.max(vec3.distance(center, light.position) - radius, 0.0);
            scratch_influence[i] = light.falloff_at(distance * distance) * light.light_strength;
        }

        const reached: Entity_Light[] = [];
        for (let n = 0; n < MAX_LIGHTS_PER_ENTITY; n++) {
            let best = -1;
            for (let i = 0; i < this.lights.length; i++)
                if (scratch_influence[i] > 0.0 && (best < 0 || scratch_influence[i] > scratch_influence[best]))
                    best = i;

            if (best < 0)
                break;

            reached.push(this.lights[best]);
            scratch_influence[best] = 0.0;
        }
        return reached;
    }
}

const scratch_influence: number[] = [];

export class Entity_Lake extends Entity {
    protected override load_assets(globals: TheWitnessGlobals): void {
        super.load_assets(globals);

        // A lake's surface is a mesh named after the entity, the same convention clusters use.
        const mesh_name = `${globals.entity_manager.universe_name}_${this.portable_id}`;
        this.create_mesh_instance(globals, globals.asset_manager.load_asset(Asset_Type.Mesh, mesh_name));
    }
}

export class Entity_Cluster extends Entity {
    public elements: number[];
    public elements_static: number[];
    public elements_detail: number[];
    public elements_combined_meshes: number[];
    public override bounding_radius: number;
    public override bounding_center: vec3;
    public cluster_flags: number;
    public occlusion_visible: boolean = true;

    public cluster_mesh_data: Mesh_Asset | null = null;
    public cluster_mesh_instance: Mesh_Instance | null = null;

    protected override load_assets(globals: TheWitnessGlobals): void {
        super.load_assets(globals);

        // The cluster's package holds the meshes and lightmaps for everything inside it, so it
        // has to be in the asset manager before any of its elements load theirs.
        if (!(this.cluster_flags & 0x02))
            globals.asset_manager.load_package(`${globals.entity_manager.universe_name}_${this.portable_id}`);

        const mesh_name = `${globals.entity_manager.universe_name}_${this.portable_id}`;
        const mesh_data = globals.asset_manager.load_asset(Asset_Type.Mesh, mesh_name);
        this.cluster_mesh_data = mesh_data;
        if (mesh_data !== null && mesh_data.device_mesh_array.length > 0)
            this.cluster_mesh_instance = new Mesh_Instance(globals, mesh_data);
    }

    public validate(globals: TheWitnessGlobals): void {
        if (!!(this.cluster_flags & 0x02))
            return;

        for (let i = 0; i < this.elements.length; i++) {
            // An element can be missing if we couldn't unpack that entity; see load_entities.
            const entity = globals.entity_manager.entity_list[this.elements[i]];
            if (entity === undefined)
                continue;
            entity.cluster_id = this.portable_id;
        }
    }
}

export class Entity_Group extends Entity {
    public elements: number[] = [];
    public child_groups: number[] = [];
    public initial_group_visibility = true;
    public current_group_visibility = true;

    public initialize(globals: TheWitnessGlobals): void {
        this.current_group_visibility = this.initial_group_visibility;
        this.update_elements(globals);
        this.update_visibility(globals);
    }

    public update_elements(globals: TheWitnessGlobals): void {
        this.elements.length = 0;

        for (let i = 0; i < globals.entity_manager.flat_entity_list.length; i++) {
            const entity = globals.entity_manager.flat_entity_list[i];
            if (entity.group_id === this.portable_id) {
                this.elements.push(entity.portable_id);
                if (entity instanceof Entity_Group)
                    this.child_groups.push(entity.portable_id);
            }
        }
    }

    public update_visibility(globals: TheWitnessGlobals): void {
        const visible = this.visible && this.layer_active && this.current_group_visibility;

        for (let i = 0; i < this.elements.length; i++) {
            const entity = globals.entity_manager.entity_list[this.elements[i]];
            if (entity === undefined)
                continue;
            entity.layer_active = visible;
        }

        for (let i = 0; i < this.child_groups.length; i++) {
            const entity = globals.entity_manager.entity_list[this.child_groups[i]] as Entity_Group;
            if (entity === undefined)
                continue;
            entity.update_visibility(globals);
        }
    }

    public set_group_visible(globals: TheWitnessGlobals, v: boolean): void {
        this.current_group_visibility = v;
        this.update_visibility(globals);
    }
}

export class Entity_Pattern_Point extends Entity {
}

export class Entity_Power_Cable extends Entity_Inanimate {
}

export class Entity_World extends Entity {
    public world_center: vec3;
    public world_z_min: number;
    public world_z_max: number;
    public shadow_render_count: number;
}
