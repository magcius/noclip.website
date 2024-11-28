use deku::prelude::*;

// https://github.com/AssetRipper/TypeTreeDumps/blob/main/StructsDump/release/2019.4.39f1.dump
// e.g. Outer Wilds

use super::common::{CharArray, ColorRGBA, Map, Matrix4x4, PPtr, Packedf32Vec, Packedi32Vec, Quaternion, UnityArray, Vec2, Vec3, Vec4, AABB, UnityVersion};

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "_version: UnityVersion")]
pub struct GameObject {
    pub components: UnityArray<PPtr<Component>>,
    pub layer: u32,
    pub name: CharArray,
    pub tag: u16,
    pub is_active: u8,
}

#[derive(DekuRead, Clone, Debug)]
pub struct Component {
    pub game_object: PPtr<GameObject>,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "_version: UnityVersion")]
pub struct Transform {
    pub game_object: PPtr<GameObject>,
    pub local_rotation: Quaternion,
    pub local_position: Vec3,
    pub local_scale: Vec3,
    pub children: UnityArray<PPtr<Transform>>,
    pub parent: PPtr<Transform>,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "version: UnityVersion")]
pub struct Material {
    pub name: CharArray,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment0: Vec<u8>,
    pub shader: PPtr<()>,
    #[deku(cond = "version < UnityVersion::V2021_3_27f1")]
    pub shader_keywords: Option<CharArray>,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment1: Vec<u8>,
    #[deku(cond = "version >= UnityVersion::V2021_3_27f1")]
    pub valid_keywords: Option<UnityArray<CharArray>>,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment2: Vec<u8>,
    #[deku(cond = "version >= UnityVersion::V2021_3_27f1")]
    pub invalid_keywords: Option<UnityArray<CharArray>>,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment3: Vec<u8>,
    pub lightmap_flags: u32,
    pub enable_instancing_variants: u8,
    pub double_sided_gi: u8,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment4: Vec<u8>,
    pub custom_render_queue: u32,
    pub string_tag_map: Map<CharArray, CharArray>,
    pub disabled_shader_passes: UnityArray<CharArray>,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment5: Vec<u8>,
    pub tex_envs: Map<CharArray, TexEnv>,
    #[deku(cond = "version >= UnityVersion::V2021_3_27f1")]
    pub ints: Option<Map<CharArray, i32>>,
    pub floats: Map<CharArray, f32>,
    pub colors: Map<CharArray, ColorRGBA>,
    #[deku(cond = "version >= UnityVersion::V2020_3_16f1")]
    pub build_texture_stacks: Option<UnityArray<BuildTextureStackReference>>,
}

#[derive(DekuRead, Clone, Debug)]
pub struct BuildTextureStackReference {
    pub group_name: CharArray,
    pub item_name: CharArray,
}

#[derive(DekuRead, Clone, Debug)]
pub struct TexEnv {
    pub texture: PPtr<Texture>,
    pub scale: Vec2,
    pub offset: Vec2,
}

#[derive(DekuRead, Clone, Debug)]
pub struct Texture {
    pub name: CharArray,
    pub forced_fallback_format: i32,
    pub downscale_fallback: u8,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "version: UnityVersion")]
pub struct MeshRenderer {
    pub game_object: PPtr<GameObject>,
    pub enabled: u8,
    pub cast_shadows: u8,
    pub receive_shadows: u8,
    pub dynamic_occludee: u8,
    #[deku(cond = "version >= UnityVersion::V2021_3_27f1")]
    pub static_shadow_caster: Option<u8>,
    pub motion_vectors: u8,
    pub light_probe_usage: u8,
    pub reflection_probe_usage: u8,
    pub ray_tracing_mode: u8,
    #[deku(cond = "version >= UnityVersion::V2020_3_16f1")]
    pub ray_trace_procedural: Option<u8>,
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
    #[deku(cond = "version >= UnityVersion::V2021_3_27f1")]
    pub enlighten_vertex_streams: Option<PPtr<Mesh>>,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "version: UnityVersion")]
pub struct Mesh {
    pub name: CharArray,
    pub submeshes: UnityArray<SubMesh>,
    pub shapes: BlendShapeData,
    pub bind_pose: UnityArray<Matrix4x4>,
    pub bone_name_hashes: UnityArray<u32>,
    pub root_bone_name_hash: u32,
    pub bones_aabb: UnityArray<AABB>,
    pub variable_bone_count_weights: UnityArray<u32>,
    pub mesh_compression: MeshCompression,
    pub is_readable: u8,
    pub keep_vertices: u8,
    pub keep_indices: u8,
    pub index_format: IndexFormat,
    pub index_buffer: UnityArray<u8>,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment2: Vec<u8>,
    #[deku(ctx = "version")]
    pub vertex_data: VertexData,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment3: Vec<u8>,
    pub compressed_mesh: CompressedMesh,
    pub local_aabb: AABB,
    pub mesh_usage_flags: i32,
    pub baked_convex_collision_mesh: UnityArray<u8>,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment4: Vec<u8>,
    pub baked_triangle_collision_mesh: UnityArray<u8>,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment5: Vec<u8>,
    pub mesh_metrics: [f32; 2],
    #[deku(ctx = "version")]
    pub streaming_info: StreamingInfo,
}

#[derive(DekuRead, Clone, Copy, Debug)]
#[deku(type = "i32")]
pub enum IndexFormat {
    UInt16 = 0,
    UInt32 = 1,
}

#[derive(DekuRead, Clone, Copy, Debug)]
#[deku(type = "u8")]
pub enum MeshCompression {
    Off = 0,
    Low = 1,
    Medium = 2,
    High = 3,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "version: UnityVersion")]
pub struct StreamingInfo {
    #[deku(ctx = "version")]
    pub offset: StreamingInfoOffset,
    pub size: u32,
    pub path: CharArray,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "version: UnityVersion", id = "version")]
pub enum StreamingInfoOffset {
    #[deku(id_pat = "UnityVersion::V2019_4_39f1")]
    Small(u32),
    #[deku(id_pat = "_")]
    Big(u64),
}

impl From<StreamingInfoOffset> for u64 {
    fn from(value: StreamingInfoOffset) -> Self {
        match value {
            StreamingInfoOffset::Small(v) => v as u64,
            StreamingInfoOffset::Big(v) => v,
        }
    }
}

#[derive(DekuRead, Clone, Debug)]
pub struct SubMesh {
    pub first_byte: u32,
    pub index_count: u32,
    pub topology: i32,
    pub base_vertex: u32,
    pub first_vertex: u32,
    pub vertex_count: u32,
    pub local_aabb: AABB,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "_version: UnityVersion")]
pub struct VertexData {
    pub vertex_count: u32,
    pub channels: UnityArray<ChannelInfo>,
    pub data: UnityArray<u8>,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment: Vec<u8>,
}

#[derive(DekuRead, Clone, Debug)]
pub struct CompressedMesh {
    pub vertices: Packedf32Vec,
    pub uv: Packedf32Vec,
    pub normals: Packedf32Vec,
    pub tangents: Packedf32Vec,
    pub weights: Packedi32Vec,
    pub normal_signs: Packedi32Vec,
    pub tangent_signs: Packedi32Vec,
    pub float_colors: Packedf32Vec,
    pub bone_indices: Packedi32Vec,
    pub triangles: Packedi32Vec,
    pub uv_info: u32,
}

#[derive(DekuRead, Clone, Debug)]
pub struct ChannelInfo {
    pub stream: u8,
    pub offset: u8,
    pub format: VertexFormat,
    #[deku(bits = "1", pad_bits_after = "4")]
    pub instance_data: u8,
    #[deku(bits = "3")]
    pub dimension: u8,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(type = "u8")]
pub enum VertexFormat {
    #[deku(id = "0")] Float,
    #[deku(id = "1")] Float16,
    #[deku(id = "2")] UNorm8,
    #[deku(id = "3")] SNorm8,
    #[deku(id = "4")] UNorm16,
    #[deku(id = "5")] SNorm16,
    #[deku(id = "6")] UInt8,
    #[deku(id = "7")] SInt8,
    #[deku(id = "8")] UInt16,
    #[deku(id = "9")] SInt16,
    #[deku(id = "10")] UInt32,
    #[deku(id = "11")] SInt32,
}

#[derive(DekuRead, Clone, Debug)]
pub struct BlendShapeData {
    pub vertices: UnityArray<BlendShapeVertex>,
    pub shapes: UnityArray<MeshBlendShape>,
    pub channels: UnityArray<MeshBlendShapeChannel>,
    pub full_weights: UnityArray<f32>,
}

#[derive(DekuRead, Clone, Debug)]
pub struct MeshBlendShape {
    pub first_vertex: u32,
    pub vertex_count: u32,
    pub has_normals: u8,
    pub has_tangents: u8,
    _padding: u16,
}

#[derive(DekuRead, Clone, Debug)]
pub struct MeshBlendShapeChannel {
    pub name: CharArray,
    pub name_hash: i32,
    pub frame_index: i32,
    pub frame_count: i32,
}

#[derive(DekuRead, Clone, Debug)]
pub struct BlendShapeVertex {
    pub vertex: Vec3,
    pub normal: Vec3,
    pub tangent: Vec3,
    pub index: u32,
}

#[derive(DekuRead, Clone, Debug)]
pub struct StaticBatchInfo {
    pub first_submesh: u16,
    pub submesh_count: u16,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "version: UnityVersion")]
pub struct Texture2D {
    pub name: CharArray,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment0: Vec<u8>,
    pub forced_fallback_format: i32,
    pub downscale_fallback: u8,
    #[deku(cond = "version >= UnityVersion::V2020_3_16f1")]
    pub is_alpha_channel_optional: u8,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment1: Vec<u8>,
    pub width: i32,
    pub height: i32,
    pub complete_image_size: u32,
    #[deku(cond = "version >= UnityVersion::V2020_3_16f1")]
    pub mips_stripped: Option<i32>,
    pub texture_format: TextureFormat,
    pub mip_count: i32,
    #[deku(ctx = "version")]
    pub settings: TextureBooleanSettings,
    pub streaming_mipmaps_priority: i32,
    pub image_count: i32,
    pub texture_dimension: i32,
    pub texture_settings: GLTextureSettings,
    pub lightmap_format: i32,
    pub color_space: ColorSpace,
    #[deku(cond = "version >= UnityVersion::V2020_3_16f1")]
    pub platform_blob: UnityArray<u8>,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment2: Vec<u8>,
    pub data: UnityArray<u8>,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment3: Vec<u8>,
    #[deku(ctx = "version")]
    pub streaming_info: StreamingInfo,
}

#[derive(DekuRead, Debug, Clone)]
#[deku(ctx = "version: UnityVersion", id = "version")]
pub enum TextureBooleanSettings {
    #[deku(id_pat = "UnityVersion::V2019_4_39f1")]
    V2019 {
        is_readable: u8,
        ignore_master_texture_limit: u8,
        is_preprocessed: u8,
        streaming_mipmaps: u8,
    },
    #[deku(id_pat = "_")]
    V2020 {
        is_readable: u8,
        is_preprocessed: u8,
        ignore_master_texture_limit: u8,
        streaming_mipmaps: u8,
    }
}

#[derive(DekuRead, Clone, Debug)]
pub struct GLTextureSettings {
    pub filter_mode: TextureFilterMode,
    pub aniso: i32,
    pub mip_bias: f32,
    pub wrap_u: TextureWrapMode,
    pub wrap_v: TextureWrapMode,
    pub wrap_w: TextureWrapMode,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(type = "i32")]
pub enum TextureFilterMode {
    Nearest = 0,
    Bilinear = 1,
    Trilinear = 2,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(type = "i32")]
pub enum TextureWrapMode {
    Repeat = 0,
    Clamp = 1,
    Mirror = 2,
    MirrorOnce = 3,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(type = "i32")]
pub enum TextureFormat {
    Alpha8       = 0x01,
    RGB24        = 0x03,
    RGBA32       = 0x04,
    ARGB32       = 0x05,
    BC1          = 0x0A,
    BC2          = 0x0B,
    BC3          = 0x0C,
    BC6H         = 0x18,
    BC7          = 0x19,
    DXT1Crunched = 0x1C,
    DXT5Crunched = 0x1D,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(type = "i32")]
pub enum ColorSpace {
    Linear = 0x00,
    SRGB   = 0x01,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "_version: UnityVersion")]
pub struct MeshFilter {
    pub game_object: PPtr<GameObject>,
    pub mesh: PPtr<Mesh>,
}
