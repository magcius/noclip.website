use deku::prelude::*;

// https://github.com/AssetRipper/TypeTreeDumps/blob/main/StructsDump/release/2021.3.27f1.dump
// e.g. A Short Hike

use crate::unity::common::{CharArray, PPtr, UnityArray, Vec4};

// hack: just re-export all older types until we need to override one w/ changes
pub use super::v2019_4_39f1::*;

#[derive(DekuRead, Clone, Debug)]
pub struct MeshRenderer {
    pub game_object: PPtr<GameObject>,
    pub enabled: u8,
    pub cast_shadows: u8,
    pub receive_shadows: u8,
    pub dynamic_occludee: u8,
    pub static_shadow_caster: u8,
    pub motion_vectors: u8,
    pub light_probe_usage: u8,
    pub reflection_probe_usage: u8,
    pub ray_tracing_mode: u8,
    pub ray_trace_procedural: u8,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment: Vec<u8>,
    pub rendering_layer_mask: u32,
    pub renderer_priority: i32,
    pub lightmap_index: u16,
    pub lightmap_index_dynamic: u16,
    pub lightmap_tiling_offset: Vec4,
    pub lightmap_tiling_offset_dynamic: Vec4,
    pub materials: UnityArray<PPtr<Material>>,
    pub static_batch_info: StaticBatchInfo,
    pub static_batch_root: PPtr<Transform>,
    pub probe_anchor: PPtr<Transform>,
    pub light_probe_volume_override: PPtr<GameObject>,
    pub sorting_layer_id: i32,
    pub sorting_layer: i16,
    pub sorting_order: i16,
    pub additional_vertex_streams: PPtr<Mesh>,
    pub enlighten_vertex_streams: PPtr<Mesh>,
}

#[derive(DekuRead, Clone, Debug)]
pub struct StreamingInfo {
    pub offset: u64,
    pub size: u32,
    pub path: CharArray,
}
