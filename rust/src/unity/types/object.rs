use std::collections::HashMap;

use crate::unity::common::{ColorRGBA, Matrix4x4, PPtr, Quaternion, Vec2, Vec3, AABB};

use super::v2019_4_39f1;
use wasm_bindgen::prelude::*;
use deku::DekuContainerRead;

macro_rules! define_create {
    ($t:ident, $u:expr) => {
        #[wasm_bindgen(js_class = $u)]
        impl $t {
            pub fn create(version: UnityVersion, data: &[u8]) -> Result<$t, String> {
                match version {
                    UnityVersion::V2019_4_39f1 => {
                        match v2019_4_39f1::$t::from_bytes((data, 0)) {
                            Ok((_, value)) => Ok(value.into()),
                            Err(err) => return Err(format!("{:?}", err)),
                        }
                    }
                }
            }
        }
    };
}

#[wasm_bindgen(js_name = "UnityVersion")]
pub enum UnityVersion {
    V2019_4_39f1,
}

#[wasm_bindgen(js_name = "UnityPPtr")]
#[derive(Debug, Copy, Clone)]
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
pub struct Component {
    pub game_object: WasmFriendlyPPtr,
}

impl From<v2019_4_39f1::Component> for Component {
    fn from(value: v2019_4_39f1::Component) -> Self {
        Self {
            game_object: value.game_object.into(),
        }
    }
}

#[wasm_bindgen(js_name = "UnityGameObject")]
pub struct GameObject {
    components: Vec<WasmFriendlyPPtr>,
    layer: u32,
    name: String,
    tag: u16,
    is_active: bool,
}

impl From<v2019_4_39f1::GameObject> for GameObject {
    fn from(value: v2019_4_39f1::GameObject) -> Self {
        Self {
            components: value.components.into(),
            layer: value.layer,
            name: value.name.into(),
            tag: value.tag,
            is_active: value.is_active > 0,
        }
    }
}

#[wasm_bindgen(js_name = "UnityTransform", getter_with_clone)]
pub struct Transform {
    pub game_object_ptr: WasmFriendlyPPtr,
    pub local_rotation: Quaternion,
    pub local_position: Vec3,
    pub local_scale: Vec3,
    pub children: Vec<WasmFriendlyPPtr>,
    pub parent: WasmFriendlyPPtr,
}

impl From<v2019_4_39f1::Transform> for Transform {
    fn from(value: v2019_4_39f1::Transform) -> Self {
        Self {
            game_object_ptr: value.game_object.into(),
            local_rotation: value.local_rotation,
            local_position: value.local_position,
            local_scale: value.local_scale,
            children: value.children.into(),
            parent: value.parent.into(),
        }
    }
}

#[wasm_bindgen(js_name = "UnityMaterial", getter_with_clone)]
pub struct Material {
    pub name: String,
    pub shader: WasmFriendlyPPtr,
    pub shader_keywords: String,
    pub lightmap_flags: u32,
    pub enable_instancing_variants: bool,
    pub double_sided_gi: bool,
    pub custom_render_queue: u32,
    string_tag_map: HashMap<String, String>,
    pub disabled_shader_passes: Vec<String>,
    tex_envs: HashMap<String, TexEnv>,
    floats: HashMap<String, f32>,
    colors: HashMap<String, ColorRGBA>,
}

impl From<v2019_4_39f1::Material> for Material {
    fn from(value: v2019_4_39f1::Material) -> Self {
        Self {
            name: value.name.into(),
            shader: value.shader.into(),
            shader_keywords: value.shader_keywords.into(),
            lightmap_flags: value.lightmap_flags,
            enable_instancing_variants: value.enable_instancing_variants > 0,
            double_sided_gi: value.double_sided_gi > 0,
            custom_render_queue: value.custom_render_queue,
            string_tag_map: value.string_tag_map.into(),
            disabled_shader_passes: value.disabled_shader_passes.into(),
            tex_envs: value.tex_envs.into(),
            floats: value.floats.into(),
            colors: value.colors.into(),
        }
    }
}

#[wasm_bindgen(js_name = "UnityTexEnv")]
pub struct TexEnv {
    pub texture: WasmFriendlyPPtr,
    pub scale: Vec2,
    pub offset: Vec2,
}

impl From<v2019_4_39f1::TexEnv> for TexEnv {
    fn from(value: v2019_4_39f1::TexEnv) -> Self {
        Self {
            texture: value.texture.into(),
            scale: value.scale,
            offset: value.offset,
        }
    }
}

#[wasm_bindgen(js_name = "UnityMesh", getter_with_clone)]
#[derive(Debug, Clone)]
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
    pub is_readable: bool,
    pub keep_vertices: bool,
    pub keep_indices: bool,
    pub index_format: i32,
    pub index_buffer: Vec<u8>,
    pub vertex_data: VertexData,
    pub compressed_mesh: CompressedMesh,
    pub local_aabb: AABB,
    pub mesh_usage_flags: i32,
    pub baked_convex_collision_mesh: Vec<u8>,
    pub baked_triangle_collision_mesh: Vec<u8>,
    pub stream_data: StreamingInfo,
}

#[wasm_bindgen(js_class = "UnityMesh")]
impl Mesh {
    pub fn set_vertex_data(&mut self, data: VertexData) {
        self.vertex_data = data;
    }

    pub fn unpack_vertices(&self) -> Vec<u8> {
        todo!();
    }

    pub fn unpack_normals(&self) -> Vec<u8> {
        todo!();
    }

    pub fn unpack_indices(&self) -> Vec<u8> {
        todo!();
    }
}

impl From<v2019_4_39f1::Mesh> for Mesh {
    fn from(value: v2019_4_39f1::Mesh) -> Self {
        Self {
            name: value.name.into(),
            submeshes: value.submeshes.into(),
            bind_pose: value.bind_pose.into(),
            bone_name_hashes: value.bone_name_hashes.into(),
            root_bone_name_hash: value.root_bone_name_hash.into(),
            bones_aabb: value.bones_aabb.into(),
            variable_bone_count_weights: value.variable_bone_count_weights.into(),
            mesh_compression: value.mesh_compression.into(),
            is_readable: value.is_readable > 0,
            keep_vertices: value.keep_vertices > 0,
            keep_indices: value.keep_indices > 0,
            index_format: value.index_format,
            index_buffer: value.index_buffer.into(),
            vertex_data: value.vertex_data.into(),
            compressed_mesh: value.compressed_mesh.into(),
            local_aabb: value.local_aabb,
            mesh_usage_flags: value.mesh_usage_flags,
            baked_convex_collision_mesh: value.baked_convex_collision_mesh.into(),
            baked_triangle_collision_mesh: value.baked_triangle_collision_mesh.into(),
            stream_data: value.stream_data.into(),

        }
    }
}

#[wasm_bindgen(js_name = "UnityMeshCompression")]
#[derive(Debug, Clone, Copy)]
pub enum MeshCompression {
    Off = 0,
    Low = 1,
    Medium = 2,
    High = 3,
}

impl From<v2019_4_39f1::MeshCompression> for MeshCompression {
    fn from(value: v2019_4_39f1::MeshCompression) -> Self {
        match value {
            v2019_4_39f1::MeshCompression::Off => MeshCompression::Off,
            v2019_4_39f1::MeshCompression::Low => MeshCompression::Low,
            v2019_4_39f1::MeshCompression::Medium => MeshCompression::Medium,
            v2019_4_39f1::MeshCompression::High => MeshCompression::High,
        }
    }
}

#[wasm_bindgen(js_name = "UnityCompressedMesh", getter_with_clone)]
#[derive(Clone, Debug)]
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

impl From<v2019_4_39f1::CompressedMesh> for CompressedMesh {
    fn from(value: v2019_4_39f1::CompressedMesh) -> Self {
        Self {
            vertices: value.vertices.data.into(),
            uv: value.uv.data.into(),
            normals: value.normals.data.into(),
            tangents: value.tangents.data.into(),
            weights: value.weights.data.into(),
            normal_signs: value.normal_signs.data.into(),
            tangent_signs: value.tangent_signs.data.into(),
            float_colors: value.float_colors.data.into(),
            bone_indices: value.bone_indices.data.into(),
            triangles: value.triangles.data.into(),
            uv_info: value.uv_info,
        }
    }
}

#[wasm_bindgen(js_name = "UnityVertexData", getter_with_clone)]
#[derive(Clone, Debug)]
pub struct VertexData {
    pub vertex_count: u32,
    pub channels: Vec<ChannelInfo>,
    pub data: Vec<u8>,
}

impl From<v2019_4_39f1::VertexData> for VertexData {
    fn from(value: v2019_4_39f1::VertexData) -> Self {
        Self {
            vertex_count: value.vertex_count,
            channels: value.channels.into(),
            data: value.data.into(),
        }
    }
}

#[wasm_bindgen(js_name = "UnityChannelInfo")]
#[derive(Clone, Debug)]
pub struct ChannelInfo {
    pub stream: u8,
    pub offset: u8,
    pub format: VertexFormat,
    pub dimension: u8,
}

impl From<v2019_4_39f1::ChannelInfo> for ChannelInfo {
    fn from(value: v2019_4_39f1::ChannelInfo) -> Self {
        Self {
            stream: value.stream,
            offset: value.offset,
            format: value.format.into(),
            dimension: value.dimension,
        }
    }
}

#[wasm_bindgen(js_name = "UnityVertexFormat")]
#[derive(Debug, Clone, Copy)]
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

impl From<v2019_4_39f1::VertexFormat> for VertexFormat {
    fn from(value: v2019_4_39f1::VertexFormat) -> Self {
        match value {
            v2019_4_39f1::VertexFormat::Float => VertexFormat::Float,
            v2019_4_39f1::VertexFormat::Float16 => VertexFormat::Float16,
            v2019_4_39f1::VertexFormat::UNorm8 => VertexFormat::UNorm8,
            v2019_4_39f1::VertexFormat::SNorm8 => VertexFormat::SNorm8,
            v2019_4_39f1::VertexFormat::UNorm16 => VertexFormat::UNorm16,
            v2019_4_39f1::VertexFormat::SNorm16 => VertexFormat::SNorm16,
            v2019_4_39f1::VertexFormat::UInt8 => VertexFormat::UInt8,
            v2019_4_39f1::VertexFormat::SInt8 => VertexFormat::SInt8,
            v2019_4_39f1::VertexFormat::UInt16 => VertexFormat::UInt16,
            v2019_4_39f1::VertexFormat::SInt16 => VertexFormat::SInt16,
            v2019_4_39f1::VertexFormat::UInt32 => VertexFormat::UInt32,
            v2019_4_39f1::VertexFormat::SInt32 => VertexFormat::SInt32,
        }
    }
}

#[wasm_bindgen(js_name = "UnitySubMesh")]
#[derive(Debug, Clone)]
pub struct SubMesh {
    pub first_byte: u32,
    pub index_count: u32,
    pub topology: i32,
    pub base_vertex: u32,
    pub first_vertex: u32,
    pub vertex_count: u32,
    pub local_aabb: AABB,
}

impl From<v2019_4_39f1::SubMesh> for SubMesh {
    fn from(value: v2019_4_39f1::SubMesh) -> Self {
        Self {
            first_byte: value.first_byte,
            index_count: value.index_count,
            topology: value.topology,
            base_vertex: value.base_vertex,
            first_vertex: value.first_vertex,
            vertex_count: value.vertex_count,
            local_aabb: value.local_aabb.into(),
        }
    }
}

#[wasm_bindgen(js_name = "UnityStreamingInfo", getter_with_clone)]
#[derive(Clone, Debug)]
pub struct StreamingInfo {
    pub offset: u32,
    pub size: u32,
    pub path: String,
}

impl From<v2019_4_39f1::StreamingInfo> for StreamingInfo {
    fn from(value: v2019_4_39f1::StreamingInfo) -> Self {
        Self {
            offset: value.offset,
            size: value.size,
            path: value.path.into(),
        }
    }
}

#[wasm_bindgen(js_name = "UnityTexture2D", getter_with_clone)]
#[derive(Clone, Debug)]
pub struct Texture2D {
    pub name: String,
    pub forced_fallback_format: i32,
    pub downscale_fallback: u8,
    pub width: i32,
    pub height: i32,
    pub complete_image_size: i32,
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
    pub stream_data: StreamingInfo,
}

#[wasm_bindgen(js_name = "UnityGLTextureSettings", getter_with_clone)]
#[derive(Clone, Debug)]
pub struct GLTextureSettings {
    pub filter_mode: TextureFilterMode,
    pub aniso: i32,
    pub mip_bias: f32,
    pub wrap_u: TextureWrapMode,
    pub wrap_v: TextureWrapMode,
    pub wrap_w: TextureWrapMode,
}

#[wasm_bindgen(js_name = "UnityTextureFilterMode")]
#[derive(Clone, Copy, Debug)]
pub enum TextureFilterMode {
    Nearest = 0,
    Bilinear = 1,
    Trilinear = 2,
}

#[wasm_bindgen(js_name = "UnityTextureWrapMode")]
#[derive(Copy, Clone, Debug)]
pub enum TextureWrapMode {
    Repeat = 0,
    Clamp = 1,
    Mirror = 2,
    MirrorOnce = 3,
}

#[wasm_bindgen(js_name = "UnityTextureFormat")]
#[derive(Copy, Clone, Debug)]
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

#[wasm_bindgen(js_name = "UnityTextureColorSpace")]
#[derive(Copy, Clone, Debug)]
pub enum ColorSpace {
    Linear = 0x00,
    SRGB   = 0x01,
}

define_create!(GameObject, "UnityGameObject");
define_create!(Transform, "UnityTransform");
define_create!(Material, "UnityMaterial");
define_create!(Mesh, "UnityMesh");
define_create!(VertexData, "UnityVertexData");
define_create!(Texture2D, "UnityTexture2D");
