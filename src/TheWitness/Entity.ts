
import { mat4, quat, vec3 } from "gl-matrix";
import { computeViewSpaceDepthFromWorldSpacePoint } from "../Camera";
import { Color, colorNewCopy, Magenta } from "../Color";
import { drawWorldSpaceAABB, drawWorldSpaceCircle, drawWorldSpacePoint, getDebugOverlayCanvas2D } from "../DebugJunk";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { scaleMatrix, Vec3UnitY } from "../MathHelpers";
import { leftPad } from "../util";
import { Asset_Type, Lightmap_Asset, Mesh_Asset } from "./Assets";
import { TheWitnessGlobals } from "./Globals";
import { Mesh_Instance } from "./Render";

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

const enum Entity_Flags {
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

    // Mesh_Render_Params
    public model_matrix = mat4.create();
    public color: Color | null;
    public mesh_lod: number = 0;

    constructor(public portable_id: number, public revision_number: number) {
    }

    public transport_create_hook(globals: TheWitnessGlobals): void {
        if (this.lightmap_table !== null)
            this.lightmap_table.load_pages(globals, this);

        this.visible = !(this.entity_flags & Entity_Flags.Invisible);

        this.updateModelMatrix();
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

        if (this.mesh_instance === null)
            return;

        if (this.cluster_id !== undefined && !globals.occlusion_manager.clusterIsVisible(this.cluster_id))
            return;

        const squared_distance = vec3.squaredDistance(globals.viewpoint.cameraPos, this.bounding_center_world);
        if (globals.render_settings.cull_distance_enabled && squared_distance >= this.cull_distance_squared)
            return;

        this.mesh_lod = (globals.render_settings.lod_distance_enabled && squared_distance >= this.lod_distance_squared) ? 1 : 0;

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

        if (this.mesh_name) {
            const mesh_asset = globals.asset_manager.load_asset(Asset_Type.Mesh, this.mesh_name);
            this.create_mesh_instance(globals, mesh_asset);
        }
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

    public cluster_mesh_data: Mesh_Asset | null = null;
    public cluster_mesh_instance: Mesh_Instance | null = null;

    public override transport_create_hook(globals: TheWitnessGlobals): void {
        super.transport_create_hook(globals);

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
            const entity = globals.entity_manager.entity_list[this.elements[i]];
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
            entity.layer_active = visible;
        }

        for (let i = 0; i < this.child_groups.length; i++) {
            const entity = globals.entity_manager.entity_list[this.child_groups[i]] as Entity_Group;
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
