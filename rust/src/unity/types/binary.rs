
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
    pub index_buffer: ByteArray,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment2: Vec<u8>,
    #[deku(ctx = "version")]
    pub vertex_data: VertexData,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment3: Vec<u8>,
    pub compressed_mesh: CompressedMesh,
    pub local_aabb: AABB,
    pub mesh_usage_flags: i32,
    pub baked_convex_collision_mesh: ByteArray,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment4: Vec<u8>,
    pub baked_triangle_collision_mesh: ByteArray,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment5: Vec<u8>,
    pub mesh_metrics: [f32; 2],
    #[deku(ctx = "version")]
    pub streaming_info: StreamingInfo,
}

#[derive(DekuRead, Clone, Copy, Debug)]
#[deku(id_type = "i32")]
pub enum IndexFormat {
    UInt16 = 0,
    UInt32 = 1,
}

#[derive(DekuRead, Clone, Copy, Debug)]
#[deku(id_type = "u8")]
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
    pub data: ByteArray,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment: Vec<u8>,
}

#[derive(Default, Debug, Clone)]
pub struct ByteArray {
    pub data: Vec<u8>,
}

impl<'a, Ctx> DekuReader<'a, Ctx> for ByteArray where Ctx: Copy {
    fn from_reader_with_ctx<R: std::io::Read + std::io::Seek>(reader: &mut Reader<R>, _ctx: Ctx) -> Result<Self, DekuError> {
        let count = i32::from_reader_with_ctx(reader, ())? as usize;
        let mut buf = vec![0x00; count];
        reader.read_bytes(count, &mut buf)?;
        Ok(ByteArray{ data: buf })
    }
}

impl From<ByteArray> for Vec<u8> {
    fn from(value: ByteArray) -> Self {
        value.data
    }
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
#[deku(id_type = "u8")]
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
    pub platform_blob: ByteArray,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment2: Vec<u8>,
    pub data: ByteArray,
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
#[deku(id_type = "i32")]
pub enum TextureFilterMode {
    Nearest = 0,
    Bilinear = 1,
    Trilinear = 2,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(id_type = "i32")]
pub enum TextureWrapMode {
    Repeat = 0,
    Clamp = 1,
    Mirror = 2,
    MirrorOnce = 3,
}

// copied from https://github.com/Unity-Technologies/UnityCsReference/blob/129a67089d125df5b95b659d3535deaf9968e86c/Editor/Mono/AssetPipeline/TextureImporterEnums.cs#L37
#[derive(DekuRead, Clone, Debug)]
#[deku(id_type = "i32")]
pub enum TextureFormat {
    // Alpha 8 bit texture format.
    Alpha8 = 1,
    // RGBA 16 bit texture format.
    ARGB16 = 2,
    // RGB 24 bit texture format.
    RGB24 = 3,
    // RGBA 32 bit texture format.
    RGBA32 = 4,
    // ARGB 32 bit texture format.
    ARGB32 = 5,
    // RGB 16 bit texture format.
    RGB16 = 7,
    // Red 16 bit texture format.
    R16 = 9,
    // DXT1 compressed texture format.
    DXT1 = 10,
    // DXT5 compressed texture format.
    DXT5 = 12,
    // RGBA 16 bit (4444) texture format.
    RGBA16 = 13,

    // R 16 bit texture format.
    RHalf = 15,
    // RG 32 bit texture format.
    RGHalf = 16,
    // RGBA 64 bit texture format.
    RGBAHalf = 17,

    // R 32 bit texture format.
    RFloat = 18,
    // RG 64 bit texture format.
    RGFloat = 19,
    // RGBA 128 bit texture format.
    RGBAFloat = 20,

    // RGB 32 bit packed float format.
    RGB9E5 = 22,

    // R BC4 compressed texture format.
    BC4 = 26,
    // RG BC5 compressed texture format.
    BC5 = 27,
    // HDR RGB BC6 compressed texture format.
    BC6H = 24,
    // RGBA BC7 compressed texture format.
    BC7 = 25,

    // DXT1 crunched texture format.
    DXT1Crunched = 28,
    // DXT5 crunched texture format.
    DXT5Crunched = 29,
    // ETC (GLES2.0) 4 bits/pixel compressed RGB texture format.
    EtcRGB4 = 34,
    // EAC 4 bits/pixel compressed 16-bit R texture format
    EacR = 41,
    // EAC 4 bits/pixel compressed 16-bit signed R texture format
    EacRSigned = 42,
    // EAC 8 bits/pixel compressed 16-bit RG texture format
    EacRG = 43,
    // EAC 8 bits/pixel compressed 16-bit signed RG texture format
    EacRGSigned = 44,

    // ETC2 (GLES3.0) 4 bits/pixel compressed RGB texture format.
    Etc2RGB4 = 45,
    // ETC2 (GLES3.0) 4 bits/pixel compressed RGB + 1-bit alpha texture format.
    Etc2RGB4PunchthroughAlpha = 46,
    // ETC2 (GLES3.0) 8 bits/pixel compressed RGBA texture format.
    Etc2RGBA8 = 47,

    // ASTC uses 128bit block of varying sizes (we use only square blocks). It does not distinguish RGB/RGBA
    Astc4x4 = 48,
    Astc5x5 = 49,
    Astc6x6 = 50,
    Astc8x8 = 51,
    Astc10x10 = 52,
    Astc12x12 = 53,

    // RG 16 bit texture format.
    RG16 = 62,
    // Red 8 bit texture format.
    R8 = 63,
    // ETC1 crunched texture format.
    EtcRGB4Crunched = 64,
    // ETC2_RGBA8 crunched texture format.
    Etc2RGBA8Crunched = 65,

    // ASTC (block size 4x4) compressed HDR RGB(A) texture format.
    AstcHdr4x4 = 66,
    // ASTC (block size 5x5) compressed HDR RGB(A)  texture format.
    AstcHdr5x5 = 67,
    // ASTC (block size 4x6x6) compressed HDR RGB(A) texture format.
    AstcHdr6x6 = 68,
    // ASTC (block size 8x8) compressed HDR RGB(A) texture format.
    AstcHdr8x8 = 69,
    // ASTC (block size 10x10) compressed HDR RGB(A) texture format.
    AstcHdr10x10 = 70,
    // ASTC (block size 12x12) compressed HDR RGB(A) texture format.
    AstcHdr12x12 = 71,

    RG32 = 72,
    RGB48 = 73,
    RGBA64 = 74,
    R8Signed = 75,
    RG16Signed = 76,
    RGB24Signed = 77,
    RGBA32Signed = 78,
    R16Signed = 79,
    RG32Signed = 80,
    RGB48Signed = 81,
    RGBA64Signed = 82,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(id_type = "i32")]
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

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "_version: UnityVersion")]
pub struct ScriptMapper {
    pub shader_to_name_map: Map<PPtr<()>, CharArray>,
    pub preload_shaders: bool,
}
