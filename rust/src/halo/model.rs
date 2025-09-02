use deku::prelude::*;
use crate::halo::common::*;
use crate::halo::tag::*;
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, DekuRead)]
pub struct SkyAnimations {
    pub animation_index: i16,
    pub period: f32,
}

#[wasm_bindgen(js_name = "HaloSky")]
#[derive(Debug, Clone, DekuRead)]
pub struct Sky {
    pub model: TagDependency,
    pub animation_graph: TagDependency,
    #[deku(pad_bytes_before = "24")]
    pub indoor_ambient_radiosity_color: ColorRGB,
    pub indoor_ambient_radiosity_power: f32,
    pub outdoor_ambient_radiosity_color: ColorRGB,
    pub outdoor_ambient_radiosity_power: f32,
    pub outdoor_fog_color: ColorRGB,
    #[deku(pad_bytes_before = "8")]
    pub outdoor_fog_max_density: f32,
    pub outdoor_fog_start_distance: f32,
    pub outdoor_fog_opaque_distance: f32,
    pub indoor_fog_color: ColorRGB,
    #[deku(pad_bytes_before = "8")]
    pub indoor_fog_max_density: f32,
    pub indoor_fog_start_distance: f32,
    #[deku(pad_bytes_after = "56")]
    pub indoor_fog_opaque_distance: f32,
}

#[wasm_bindgen(js_name = "HaloModel")]
#[derive(Debug, Clone, DekuRead)]
pub struct GbxModel {
    #[deku(pad_bytes_before = "48")]
    pub base_bitmap_u_scale: f32,
    pub base_bitmap_v_scale: f32,
    #[deku(pad_bytes_before = "152")]
    pub(crate) geometries: Block<GbxModelGeometry>,
    pub(crate) shaders: Block<GbxModelShader>,
}

#[derive(Debug, Clone, DekuRead)]
pub struct GbxModelGeometry {
    #[deku(pad_bytes_before = "36")]
    pub parts: Block<GbxModelPart>,
}

#[wasm_bindgen(js_name = "HaloModelPart")]
#[derive(Debug, Clone, DekuRead)]
pub struct GbxModelPart {
    #[deku(pad_bytes_before = "4")]
    pub shader_index: u16,
    #[deku(pad_bytes_before = "14")]
    pub centroid: Point3D,
    #[deku(pad_bytes_before = "40")]
    pub off_by_two_tri_count: u32, // always off by 2
    pub tri_offset: u32,
    #[deku(pad_bytes_before = "8")]
    pub vert_count: u32,
    #[deku(pad_bytes_before = "8", pad_bytes_after = "28")]
    pub vert_offset: u32,
}

#[wasm_bindgen(js_class = "HaloModelPart")]
impl GbxModelPart {
    pub fn tri_count(&self) -> u32 {
        self.off_by_two_tri_count + 2
    }
}

#[derive(Debug, Clone, DekuRead)]
pub struct GbxModelShader {
    pub shader: TagDependency,
    #[deku(pad_bytes_after = "14")]
    pub permutation: u16,
}

#[wasm_bindgen(js_name = "HaloScenery")]
#[derive(Debug, Clone, DekuRead)]
pub struct Scenery {
    #[deku(pad_bytes_before = "2")]
    pub flags: u16,
    pub bounding_radius: f32,
    pub bounding_offset: Point3D,
    pub origin_offset: Point3D,
    #[deku(assert = "model.tag_class == TagClass::GbxModel", pad_bytes_before = "8")]
    pub(crate) model: TagDependency,
    #[deku(assert = "modifier_shader.tag_class == TagClass::Shader", pad_bytes_before = "88")]
    pub modifier_shader: TagDependency,
}
