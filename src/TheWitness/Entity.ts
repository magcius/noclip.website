
import { vec3, quat } from "gl-matrix";

export class Entity_Manager {
    public entity_list: Entity[] = [];

    public register_entity(entity: Entity): void {
    }

    public register_portable(entity: Entity): void {
        this.entity_list.push(entity);
    }
}

export interface Portable {
    portable_id: number;
    revision_number: number;
    [k: string]: any;
}

type Lightmap_Page = {};
export class Lightmap_Table {
    public dependency_array: number[];
    public state_array: number[];
    public lightmap_page_array: (Lightmap_Page | null)[] = [];
}

export class Entity implements Portable {
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

    constructor(public portable_id: number, public revision_number: number) {
    }

    public transport_create_hook(): void {
    }
}

export class Entity_Inanimate extends Entity {
    public transport_create_hook(): void {
    }
}

export class Entity_Pattern_Point extends Entity {
}

export function register_entities(manager: Entity_Manager, entities: Entity[]): void {
    for (let i = 0; i < entities.length; i++)
        manager.register_portable(entities[i]);
}
