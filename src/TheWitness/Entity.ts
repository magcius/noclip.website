
import { mat4, quat, vec3 } from "gl-matrix";
import { computeViewSpaceDepthFromWorldSpacePoint } from "../Camera";
import { Color, colorNewCopy, Magenta } from "../Color";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { scaleMatrix } from "../MathHelpers";
import { leftPad } from "../util";
import { Asset_Type, Lightmap_Asset } from "./Assets";
import { TheWitnessGlobals } from "./Globals";
import { Mesh_Instance } from "./Render";

export class Entity_Manager {
    public entity_list: Entity[] = [];
    public universe_name = `save`;

    public register_portable(entity: Entity): void {
        this.entity_list.push(entity);
    }

    public load_world(globals: TheWitnessGlobals): void {
        const world = globals.asset_manager.load_asset(Asset_Type.World, this.universe_name)!;
        for (let i = 0; i < world.length; i++)
            this.register_portable(world[i]);
        for (let i = 0; i < this.entity_list.length; i++)
            this.entity_list[i].transport_create_hook(globals);
    }
}

export interface Portable {
    portable_id: number;
    revision_number: number;
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

export class Entity implements Portable {
    public visible = true;
    public debug_color = colorNewCopy(Magenta);

    public entity_manager: Entity_Manager;

    public position: vec3;
    public scale: number;
    public orientation: quat;
    public entity_flags: number;
    public entity_name: string;
    public group_id: number;
    public mount_parent_id: number;
    public mount_position?: vec3;
    public mount_scale?: number;
    public mount_orientation?: quat;
    public mount_bone_name?: string;
    public version: number;
    public root_z: number;
    public cluster_id: number;
    public lod_distance: number;
    public lightmap_table: Lightmap_Table | null;
    public bounding_radius: number;
    public bounding_center: vec3;

    public model_matrix = mat4.create();
    public bounding_center_world = vec3.create();
    public bounding_radius_world = 0;

    constructor(public portable_id: number, public revision_number: number) {
    }

    public transport_create_hook(globals: TheWitnessGlobals): void {
        if (this.lightmap_table !== null)
            this.lightmap_table.load_pages(globals, this);

        this.updateModelMatrix();
    }

    protected updateModelMatrix(): void {
        mat4.fromRotationTranslation(this.model_matrix, this.orientation, this.position);
        scaleMatrix(this.model_matrix, this.model_matrix, this.scale);
        vec3.add(this.bounding_center_world, this.bounding_center, this.position);
        this.bounding_radius_world = this.bounding_radius * this.scale;
    }

    public prepareToRender(globals: TheWitnessGlobals, renderInstManager: GfxRenderInstManager): void {
    }
}

export class Entity_Inanimate extends Entity {
    public mesh_instance: Mesh_Instance | null = null;
    public mesh_name: string = '';
    public color_override: number = 0;
    public color: Color | null;

    public transport_create_hook(globals: TheWitnessGlobals): void {
        super.transport_create_hook(globals);

        if (!(this.color_override))
            this.color = null;

        if (this.mesh_name) {
            const mesh_data = globals.asset_manager.load_asset(Asset_Type.Mesh, this.mesh_name);
            if (mesh_data !== null)
                this.mesh_instance = new Mesh_Instance(globals, mesh_data);
        }
    }

    public prepareToRender(globals: TheWitnessGlobals, renderInstManager: GfxRenderInstManager): void {
        if (!this.visible)
            return;

        const depth = computeViewSpaceDepthFromWorldSpacePoint(globals.viewpoint.viewFromWorldMatrix, this.bounding_center_world);
        if (this.mesh_instance !== null)
            this.mesh_instance.prepareToRender(globals, renderInstManager, this, depth);
    }
}

export class Entity_Pattern_Point extends Entity {
}

export class Entity_Power_Cable extends Entity_Inanimate {
}

export function register_entities(manager: Entity_Manager, entities: Entity[]): void {
    for (let i = 0; i < entities.length; i++)
        manager.register_portable(entities[i]);
}
