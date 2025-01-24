use std::collections::HashMap;
use std::io::Cursor;

use deku::reader::Reader;
use deku::DekuContainerRead;
use noclip_macros::{FromStructPerField, FromEnumPerVariant, from};
use wasm_bindgen::prelude::*;
use deku::DekuReader;

use crate::unity::types::common::CharArray;
use super::common::{ColorRGBA, Matrix4x4, PPtr, Quaternion, Vec2, Vec3, Vec4, AABB, UnityVersion};
use super::binary;

macro_rules! define_create {
    ($t:ident, $u:expr) => {
        #[wasm_bindgen(js_class = $u)]
        impl $t {
            pub fn create(version: UnityVersion, data: &[u8]) -> Result<$t, String> {
                let mut cursor = Cursor::new(data);
                let mut reader = Reader::new(&mut cursor);
                match binary::$t::from_reader_with_ctx(&mut reader, version) {
                    Ok(value) => Ok(value.into()),
                    Err(err) => return Err(format!("Couldn't create {}: {:?}", $u, err)),
                }
            }
        }
    };
}

#[wasm_bindgen(js_name = "UnityPPtr")]
#[derive(PartialEq, Eq, Hash, Debug, Copy, Clone)]
pub struct WasmFriendlyPPtr {
    pub file_index: u32,
    pub path_id: i64,
}

impl<T> From<PPtr<T>> for WasmFriendlyPPtr {
    fn from(value: PPtr<T>) -> Self {
        Self {
            file_index: value.file_index,
            path_id: value.path_id,
        }
    }
}

#[wasm_bindgen(js_name = "UnityComponent")]
#[derive(FromStructPerField)]
#[from(binary::Component)]
pub struct Component {
    pub game_object: WasmFriendlyPPtr,
}

#[wasm_bindgen(js_name = "UnityGameObject", getter_with_clone)]
#[derive(Debug, FromStructPerField)]
#[from(binary::GameObject)]
pub struct GameObject {
    pub components: Vec<WasmFriendlyPPtr>,
    pub layer: u32,
    pub name: String,
    pub tag: u16,
    pub is_active: u8,
}

#[wasm_bindgen(js_name = "UnityTransform", getter_with_clone)]
#[derive(FromStructPerField, Debug)]
#[from(binary::Transform)]
pub struct Transform {
    pub game_object: WasmFriendlyPPtr,
    pub local_rotation: Quaternion,
    pub local_position: Vec3,
    pub local_scale: Vec3,
    pub children: Vec<WasmFriendlyPPtr>,
    pub parent: WasmFriendlyPPtr,
}

#[wasm_bindgen(js_name = "UnityMaterial", getter_with_clone)]
#[derive(Debug, Clone)]
pub struct Material {
    pub name: String,
    pub shader: WasmFriendlyPPtr,
    pub shader_keywords: Option<String>,
    pub valid_keywords: Option<Vec<String>>,
    pub invalid_keywords: Option<Vec<String>>,
    pub lightmap_flags: u32,
    pub enable_instancing_variants: u8,
    pub double_sided_gi: u8,
    pub custom_render_queue: u32,
    string_tag_map: HashMap<String, String>,
    pub disabled_shader_passes: Vec<String>,
    tex_envs: HashMap<String, TexEnv>,
    floats: HashMap<String, f32>,
    colors: HashMap<String, ColorRGBA>,
}

impl From<binary::Material> for Material {
    fn from(value: binary::Material) -> Self {
        Self {
            name: value.name.into(),
            shader: value.shader.into(),
            shader_keywords: match value.shader_keywords {
                Some(v) => Some(v.into()),
                None => None,
            },
            valid_keywords: match value.valid_keywords {
                Some(v) => Some(v.into()),
                None => None,
            },
            invalid_keywords: match value.invalid_keywords {
                Some(v) => Some(v.into()),
                None => None,
            },
            lightmap_flags: value.lightmap_flags.into(),
            enable_instancing_variants: value.enable_instancing_variants.into(),
            double_sided_gi: value.double_sided_gi.into(),
            custom_render_queue: value.custom_render_queue.into(),
            string_tag_map: value.string_tag_map.into(),
            disabled_shader_passes: value.disabled_shader_passes.into(),
            tex_envs: value.tex_envs.into(),
            floats: value.floats.into(),
            colors: value.colors.into(),
        }
    }
}

#[wasm_bindgen(js_class = "UnityMaterial")]
impl Material {
    pub fn get_tex_env_keys(&self) -> Vec<String> {
        self.tex_envs.keys().cloned().collect()
    }

    pub fn get_tex_env_by_key(&self, key: &str) -> Option<TexEnv> {
        self.tex_envs.get(key).cloned()
    }

    pub fn get_float_keys(&self) -> Vec<String> {
        self.floats.keys().cloned().collect()
    }

    pub fn get_float_by_key(&self, key: &str) -> Option<f32> {
        self.floats.get(key).cloned()
    }

    pub fn get_color_keys(&self) -> Vec<String> {
        self.colors.keys().cloned().collect()
    }

    pub fn get_color_by_key(&self, key: &str) -> Option<ColorRGBA> {
        self.colors.get(key).cloned()
    }
}

// Note: the actual Shader type is insanely complicated, so we don't want to
// actually implement a binary reader for it unless we're trying to actually
// recreate Unity's shader compilation pipeline. Instead, let's just read in the
// name to be identifiable in noclip.
#[wasm_bindgen(js_name = "UnityShader", getter_with_clone)]
#[derive(Debug, Clone)]
pub struct Shader {
    pub name: String,
}

#[wasm_bindgen(js_class = "UnityShader")]
impl Shader {
    pub fn create(_version: UnityVersion, data: &[u8]) -> Result<Self, String> {
        let (_, name) = CharArray::from_bytes((data, 0))
            .map_err(|err| format!("{:?}", err))?;
        Ok(Shader {
            name: name.into(),
        })
    }
}

#[wasm_bindgen(js_name = "UnityTexEnv")]
#[derive(FromStructPerField, Debug, Clone)]
#[from(binary::TexEnv)]
pub struct TexEnv {
    pub texture: WasmFriendlyPPtr,
    pub scale: Vec2,
    pub offset: Vec2,
}

#[wasm_bindgen(js_name = "UnityMesh", getter_with_clone)]
#[derive(Debug, Clone, FromStructPerField)]
#[from(binary::Mesh)]
pub struct Mesh {
    pub name: String,
    pub submeshes: Vec<SubMesh>,
    // pub shapes: Vec<BlendShapeData>,
    pub bind_pose: Vec<Matrix4x4>,
    pub bone_name_hashes: Vec<u32>,
    pub root_bone_name_hash: u32,
    pub bones_aabb: Vec<AABB>,
    pub variable_bone_count_weights: Vec<u32>,
    pub mesh_compression: MeshCompression,
    pub is_readable: u8,
    pub keep_vertices: u8,
    pub keep_indices: u8,
    pub index_format: IndexFormat,
    pub index_buffer: Vec<u8>,
    pub vertex_data: VertexData,
    pub compressed_mesh: CompressedMesh,
    pub local_aabb: AABB,
    pub mesh_usage_flags: i32,
    pub baked_convex_collision_mesh: Vec<u8>,
    pub baked_triangle_collision_mesh: Vec<u8>,
    pub streaming_info: StreamingInfo,
}

#[wasm_bindgen(js_class = "UnityMesh")]
impl Mesh {
    pub fn set_vertex_data(&mut self, data: Vec<u8>) {
        self.vertex_data.data = data;
    }

    pub fn unpack_vertices(&self) -> Option<Vec<f32>> {
        match self.mesh_compression {
            MeshCompression::Off => None,
            _ => Some(self.compressed_mesh.vertices.clone())
        }
    }

    pub fn unpack_normals(&self) -> Option<Vec<f32>> {
        match self.mesh_compression {
            MeshCompression::Off => None,
            _ => Some(self.compressed_mesh.unpack_normals())
        }
    }

    pub fn unpack_indices(&self) -> Option<Vec<i32>> {
        match self.mesh_compression {
            MeshCompression::Off => None,
            _ => Some(self.compressed_mesh.triangles.clone())
        }
    }

    pub fn get_vertex_data(&self) -> Vec<u8> {
        self.vertex_data.data.clone()
    }

    pub fn get_index_data(&self) -> Vec<u8> {
        self.index_buffer.clone()
    }

    pub fn get_channel_count(&self) -> usize {
        self.vertex_data.channels.len()
    }

    pub fn get_channels(&self) -> Vec<ChannelInfo> {
        self.vertex_data.channels.clone()
    }

    pub fn get_streams(&self) -> Vec<VertexStreamInfo> {
        VertexStreamInfo::from_channels(&self.vertex_data.channels, self.vertex_data.vertex_count as usize)
    }
}

#[wasm_bindgen(js_name = "UnityIndexFormat")]
#[derive(FromEnumPerVariant, Debug, Clone, Copy)]
#[from(binary::IndexFormat)]
pub enum IndexFormat {
    UInt16,
    UInt32,
}

#[wasm_bindgen(js_name = "UnityMeshCompression")]
#[derive(FromEnumPerVariant, Debug, Clone, Copy)]
#[from(binary::MeshCompression)]
pub enum MeshCompression {
    Off = 0,
    Low = 1,
    Medium = 2,
    High = 3,
}

#[wasm_bindgen(js_name = "UnityCompressedMesh", getter_with_clone)]
#[derive(Clone, Debug, FromStructPerField)]
#[from(binary::CompressedMesh)]
pub struct CompressedMesh {
    pub vertices: Vec<f32>,
    pub uv: Vec<f32>,
    pub normals: Vec<f32>,
    pub tangents: Vec<f32>,
    pub weights: Vec<i32>,
    pub normal_signs: Vec<i32>,
    pub tangent_signs: Vec<i32>,
    pub float_colors: Vec<f32>,
    pub bone_indices: Vec<i32>,
    pub triangles: Vec<i32>,
    pub uv_info: u32,
}

impl CompressedMesh {
    pub fn unpack_normals(&self) -> Vec<f32> {
        let n = self.normals.len() / 2;
        let mut result = vec![0.0; 3 * n];
        for i in 0..n {
            let x = self.normals[2*i];
            let y = self.normals[2*i + 1];
            result[3*i + 0] = x;
            result[3*i + 1] = y;
            let zsqr = 1.0 - x*x - y*y;
            if zsqr >= 0.0 {
                result[3*i + 2] = zsqr.sqrt();
            } else {
                result[3*i + 2] = 0.0;
            }

            if self.normal_signs.len() > 0 && self.normal_signs[i] == 0 {
                result[3*i + 2] *= -1.0;
            }
        }
        result
    }
}

#[wasm_bindgen(js_name = "UnityVertexData", getter_with_clone)]
#[derive(Clone, Debug, FromStructPerField)]
#[from(binary::VertexData)]
pub struct VertexData {
    pub vertex_count: u32,
    pub channels: Vec<ChannelInfo>,
    pub data: Vec<u8>,
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct VertexStreamInfo {
    pub channel_mask: u32,
    pub offset: u32,
    pub stride: u32,
    pub divider_op: u8,
    pub frequency: u32,
}

impl VertexStreamInfo {
    pub fn from_channels(channels: &[ChannelInfo], vertex_count: usize) -> Vec<VertexStreamInfo> {
        let mut n_streams = 0;
        for c in channels {
            if c.stream > n_streams {
                n_streams = c.stream;
            }
        }
        n_streams += 1;
        let mut result = Vec::with_capacity(n_streams as usize);
        let mut offset = 0;
        for s in 0..n_streams {
            let mut channel_mask = 0;
            let mut stride = 0;
            for chn in 0..channels.len() {
                let channel = &channels[chn];
                if channel.stream == s {
                    if channel.dimension > 0 {
                        channel_mask |= 1 << chn;
                        stride += channel.dimension as usize * channel.get_format_size();
                    }
                }
            }

            result.push(VertexStreamInfo {
                channel_mask,
                offset,
                stride: stride as u32,
                divider_op: 0,
                frequency: 0,
            });
            offset += (vertex_count * stride) as u32;
            offset = (offset + 0x0F) & !0x0F;
        }
        return result;
    }
}

#[wasm_bindgen(js_name = "UnityChannelInfo")]
#[derive(Clone, Debug, FromStructPerField)]
#[from(binary::ChannelInfo)]
pub struct ChannelInfo {
    pub stream: u8,
    pub offset: u8,
    pub format: VertexFormat,
    pub dimension: u8,
}

impl ChannelInfo {
    pub fn get_format_size(&self) -> usize {
        match self.format {
            VertexFormat::Float |
            VertexFormat::UInt32 |
            VertexFormat::SInt32 => 4,

            VertexFormat::Float16 |
            VertexFormat::UNorm16 |
            VertexFormat::SNorm16 |
            VertexFormat::UInt16 |
            VertexFormat::SInt16 => 2,

            VertexFormat::UNorm8 |
            VertexFormat::SNorm8 |
            VertexFormat::UInt8 |
            VertexFormat::SInt8 => 1,
        }
    }
}

#[wasm_bindgen(js_name = "UnityVertexFormat")]
#[derive(FromEnumPerVariant, Debug, Clone, Copy)]
#[from(binary::VertexFormat)]
pub enum VertexFormat {
    Float,
    Float16,
    UNorm8,
    SNorm8,
    UNorm16,
    SNorm16,
    UInt8,
    SInt8,
    UInt16,
    SInt16,
    UInt32,
    SInt32,
}

#[wasm_bindgen(js_name = "UnitySubMesh")]
#[derive(Clone, Debug, FromStructPerField)]
#[from(binary::SubMesh)]
pub struct SubMesh {
    pub first_byte: u32,
    pub index_count: u32,
    pub topology: i32,
    pub base_vertex: u32,
    pub first_vertex: u32,
    pub vertex_count: u32,
    pub local_aabb: AABB,
}

#[wasm_bindgen(js_name = "UnityStreamingInfo", getter_with_clone)]
#[derive(Clone, Debug, FromStructPerField)]
#[from(binary::StreamingInfo)]
pub struct StreamingInfo {
    pub offset: u64,
    pub size: u32,
    pub path: String,
}

#[wasm_bindgen(js_name = "UnityTexture2D", getter_with_clone)]
pub struct Texture2D {
    pub name: String,
    pub forced_fallback_format: i32,
    pub downscale_fallback: u8,
    pub width: i32,
    pub height: i32,
    pub complete_image_size: u32,
    pub texture_format: TextureFormat,
    pub mip_count: i32,
    pub is_readable: u8,
    pub ignore_master_texture_limit: u8,
    pub is_preprocessed: u8,
    pub streaming_mipmaps: u8,
    pub streaming_mipmaps_priority: i32,
    pub image_count: i32,
    pub texture_dimension: i32,
    pub texture_settings: GLTextureSettings,
    pub lightmap_format: i32,
    pub color_space: ColorSpace,
    pub data: Vec<u8>,
    pub streaming_info: StreamingInfo,
}

impl From<binary::Texture2D> for Texture2D {
    fn from(value: binary::Texture2D) -> Self {
        let s = value.settings;
        let (is_readable,
            ignore_master_texture_limit,
            is_preprocessed,
            streaming_mipmaps) = match s {
                binary::TextureBooleanSettings::V2019 { is_readable: a, ignore_master_texture_limit: b, is_preprocessed: c, streaming_mipmaps: d } => (a, b, c, d),
                binary::TextureBooleanSettings::V2020 { is_readable: a, ignore_master_texture_limit: b, is_preprocessed: c, streaming_mipmaps: d } => (a, b, c, d),
            };
        Self {
            name: value.name.into(),
            forced_fallback_format: value.forced_fallback_format.into(),
            downscale_fallback: value.downscale_fallback.into(),
            width: value.width.into(),
            height: value.height.into(),
            complete_image_size: value.complete_image_size.into(),
            texture_format: value.texture_format.into(),
            mip_count: value.mip_count.into(),
            is_readable,
            ignore_master_texture_limit,
            is_preprocessed,
            streaming_mipmaps,
            streaming_mipmaps_priority: value.streaming_mipmaps_priority.into(),
            image_count: value.image_count.into(),
            texture_dimension: value.texture_dimension.into(),
            texture_settings: value.texture_settings.into(),
            lightmap_format: value.lightmap_format.into(),
            color_space: value.color_space.into(),
            data: value.data.into(),
            streaming_info: value.streaming_info.into(),
        }
    }
}

#[wasm_bindgen(js_name = "UnityGLTextureSettings", getter_with_clone)]
#[derive(Clone, Debug, FromStructPerField)]
#[from(binary::GLTextureSettings)]
pub struct GLTextureSettings {
    pub filter_mode: TextureFilterMode,
    pub aniso: i32,
    pub mip_bias: f32,
    pub wrap_u: TextureWrapMode,
    pub wrap_v: TextureWrapMode,
    pub wrap_w: TextureWrapMode,
}

#[wasm_bindgen(js_name = "UnityTextureFilterMode")]
#[derive(FromEnumPerVariant, Clone, Copy, Debug)]
#[from(binary::TextureFilterMode)]
pub enum TextureFilterMode {
    Nearest = 0,
    Bilinear = 1,
    Trilinear = 2,
}

#[wasm_bindgen(js_name = "UnityTextureWrapMode")]
#[derive(FromEnumPerVariant, Clone, Copy, Debug)]
#[from(binary::TextureWrapMode)]
pub enum TextureWrapMode {
    Repeat = 0,
    Clamp = 1,
    Mirror = 2,
    MirrorOnce = 3,
}

#[wasm_bindgen(js_name = "UnityTextureFormat")]
#[derive(FromEnumPerVariant, Clone, Copy, Debug)]
#[from(binary::TextureFormat)]
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

#[wasm_bindgen(js_name = "UnityTextureColorSpace")]
#[derive(FromEnumPerVariant, Clone, Copy, Debug)]
#[from(binary::ColorSpace)]
pub enum ColorSpace {
    Linear = 0x00,
    SRGB   = 0x01,
}

#[wasm_bindgen(js_name = "UnityMeshFilter", getter_with_clone)]
#[derive(Clone, Debug, FromStructPerField)]
#[from(binary::MeshFilter)]
pub struct MeshFilter {
    pub game_object: WasmFriendlyPPtr,
    pub mesh: WasmFriendlyPPtr,
}

#[wasm_bindgen(js_name = "UnityMeshRenderer", getter_with_clone)]
#[derive(Clone, Debug, FromStructPerField)]
#[from(binary::MeshRenderer)]
pub struct MeshRenderer {
    pub game_object: WasmFriendlyPPtr,
    pub enabled: u8,
    pub cast_shadows: u8,
    pub receive_shadows: u8,
    pub dynamic_occludee: u8,
    pub motion_vectors: u8,
    pub light_probe_usage: u8,
    pub reflection_probe_usage: u8,
    pub ray_tracing_mode: u8,
    pub rendering_layer_mask: u32,
    pub renderer_priority: i32,
    pub lightmap_index: u16,
    pub lightmap_index_dynamic: u16,
    pub lightmap_tiling_offset: Vec4,
    pub lightmap_tiling_offset_dynamic: Vec4,
    pub materials: Vec<WasmFriendlyPPtr>,
    pub static_batch_info: StaticBatchInfo,
    pub static_batch_root: WasmFriendlyPPtr,
    pub probe_anchor: WasmFriendlyPPtr,
    pub light_probe_volume_override: WasmFriendlyPPtr,
    pub sorting_layer_id: i32,
    pub sorting_layer: i16,
    pub sorting_order: i16,
    pub additional_vertex_streams: WasmFriendlyPPtr,
}

#[wasm_bindgen(js_name = "UnityStaticBatchInfo", getter_with_clone)]
#[derive(Clone, Debug, FromStructPerField)]
#[from(binary::StaticBatchInfo)]
pub struct StaticBatchInfo {
    pub first_submesh: u16,
    pub submesh_count: u16,
}

#[wasm_bindgen(js_name = "UnityScriptMapper")]
#[derive(Clone, Debug, FromStructPerField)]
#[from(binary::ScriptMapper)]
pub struct ScriptMapper {
    shader_to_name_map: HashMap<WasmFriendlyPPtr, String>,
}

#[wasm_bindgen(js_class = "UnityScriptMapper")]
impl ScriptMapper {
    pub fn get_shader_pointers(&self) -> Vec<WasmFriendlyPPtr> {
        self.shader_to_name_map.keys().cloned().collect()
    }

    pub fn get_shader_names(&self) -> Vec<String> {
        self.shader_to_name_map.values().cloned().collect()
    }
}

define_create!(GameObject, "UnityGameObject");
define_create!(Transform, "UnityTransform");
define_create!(Material, "UnityMaterial");
define_create!(Mesh, "UnityMesh");
define_create!(VertexData, "UnityVertexData");
define_create!(Texture2D, "UnityTexture2D");
define_create!(MeshFilter, "UnityMeshFilter");
define_create!(MeshRenderer, "UnityMeshRenderer");
define_create!(ScriptMapper, "UnityScriptMapper");
