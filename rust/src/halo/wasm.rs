use js_sys::{Uint16Array, Array};
use wasm_bindgen::prelude::*;

use crate::halo::map::*;
use crate::halo::scenario::*;
use crate::halo::common::*;
use crate::halo::shader::*;
use crate::halo::bitmap::*;
use crate::halo::bitmap_utils::*;
use crate::halo::tag::*;
use crate::halo::model::*;

#[wasm_bindgen]
pub struct HaloSceneManager {
    mgr: MapManager,
}

#[wasm_bindgen]
pub struct HaloBitmapReader {
    inner: ResourceMapReader,
}

#[wasm_bindgen]
impl HaloBitmapReader {
    pub fn new(data: Vec<u8>) -> Self {
        HaloBitmapReader { inner: ResourceMapReader::new(data) }
    }

    pub fn get_and_convert_bitmap_data(&mut self, bitmap: &HaloBitmap, submap: usize) -> Vec<u8> {
        let bitmap_data = &bitmap.inner.data.items.as_ref().unwrap()[submap];
        get_and_convert_bitmap_data(self.inner.data.get_ref(), bitmap_data)
    }

    pub fn destroy(self) {}
}

fn get_and_convert_bitmap_data(bytes: &[u8], bitmap_data: &BitmapData) -> Vec<u8> {
    let offset = bitmap_data.pixel_data_offset as usize;
    let length = bitmap_data.pixel_data_size as usize;
    let byte_range = &bytes[offset..offset+length];
    match bitmap_data.format {
        BitmapFormat::P8 | BitmapFormat::P8Bump => convert_p8_data(byte_range),
        BitmapFormat::A8r8g8b8 => convert_a8r8g8b8_data(byte_range),
        BitmapFormat::X8r8g8b8 => convert_x8r8g8b8_data(byte_range),
        BitmapFormat::A8 => convert_a8_data(byte_range),
        BitmapFormat::Y8 => convert_y8_data(byte_range),
        BitmapFormat::A8y8 => convert_a8y8_data(byte_range),
        _ => Vec::from(byte_range),
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloSky {
    inner: Sky,
    model: Option<GbxModel>,
}

#[wasm_bindgen]
impl HaloSky {
    #[wasm_bindgen(getter)] pub fn outdoor_fog_color(&self) -> ColorRGB { self.inner.outdoor_fog_color }
    #[wasm_bindgen(getter)] pub fn outdoor_fog_max_density(&self) -> f32 { self.inner.outdoor_fog_max_density }
    #[wasm_bindgen(getter)] pub fn outdoor_fog_start_distance(&self) -> f32 { self.inner.outdoor_fog_start_distance }
    #[wasm_bindgen(getter)] pub fn outdoor_fog_opaque_distance(&self) -> f32 { self.inner.outdoor_fog_opaque_distance }
    #[wasm_bindgen(getter)] pub fn indoor_fog_color(&self) -> ColorRGB { self.inner.indoor_fog_color }
    #[wasm_bindgen(getter)] pub fn indoor_fog_max_density(&self) -> f32 { self.inner.indoor_fog_max_density }
    #[wasm_bindgen(getter)] pub fn indoor_fog_start_distance(&self) -> f32 { self.inner.indoor_fog_start_distance }
    #[wasm_bindgen(getter)] pub fn indoor_fog_opaque_distance(&self) -> f32 { self.inner.indoor_fog_opaque_distance }
    pub fn get_model(&self) -> Option<HaloModel> {
        self.model.as_ref().map(|model| HaloModel { inner: model.clone() })
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloMaterial {
    inner: BSPMaterial,
}

#[wasm_bindgen]
impl HaloMaterial {
    fn new(material: &BSPMaterial) -> HaloMaterial {
        HaloMaterial {
            inner: material.clone(),
        }
    }

    pub fn get_num_indices(&self) -> i32 {
        self.inner.surface_count * 3
    }

    pub fn get_index_offset(&self) -> i32 {
        self.inner.surfaces * 3
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloModel {
    inner: GbxModel
}

#[wasm_bindgen]
impl HaloModel {
    pub fn get_base_bitmap_u_scale(&self) -> f32 {
        self.inner.base_bitmap_u_scale
    }

    pub fn get_base_bitmap_v_scale(&self) -> f32 {
        self.inner.base_bitmap_v_scale
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloSceneryInstance {
    inner: ScenarioScenery,
}

#[wasm_bindgen]
impl HaloSceneryInstance {
    #[wasm_bindgen(getter)] pub fn scenery_type(&self) -> u16 { self.inner.scenery_type }
    #[wasm_bindgen(getter)] pub fn not_placed(&self) -> u32 { self.inner.not_placed }
    #[wasm_bindgen(getter)] pub fn position(&self) -> Point3D { self.inner.position }
    #[wasm_bindgen(getter)] pub fn rotation(&self) -> Euler3D { self.inner.rotation }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloScenery {
    inner: Scenery,
}

#[wasm_bindgen]
impl HaloScenery {
    #[wasm_bindgen(getter)] pub fn flags(&self) -> u16 { self.inner.flags }
    #[wasm_bindgen(getter)] pub fn bounding_radius(&self) -> f32 { self.inner.bounding_radius }
    #[wasm_bindgen(getter)] pub fn bounding_offset(&self) -> Point3D { self.inner.bounding_offset }
    #[wasm_bindgen(getter)] pub fn origin_offset(&self) -> Point3D { self.inner.origin_offset }

    fn new(inner: &Scenery) -> HaloScenery {
        HaloScenery { inner: inner.clone() }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloModelPart {
    inner: GbxModelPart,
}

#[wasm_bindgen]
impl HaloModelPart {
    #[wasm_bindgen(getter)] pub fn shader_index(&self) -> u16 { self.inner.shader_index }
    #[wasm_bindgen(getter)] pub fn centroid(&self) -> Point3D { self.inner.centroid }
    #[wasm_bindgen(getter)] pub fn tri_count(&self) -> u32 { self.inner.tri_count }
    #[wasm_bindgen(getter)] pub fn tri_offset(&self) -> u32 { self.inner.tri_offset }
    #[wasm_bindgen(getter)] pub fn vert_count(&self) -> u32 { self.inner.vert_count }
    #[wasm_bindgen(getter)] pub fn vert_offset(&self) -> u32 { self.inner.vert_offset }

    fn new(inner: &GbxModelPart) -> HaloModelPart {
        HaloModelPart { inner: inner.clone() }
    }

    pub fn update_tri_count(&mut self, new_count: u32) {
        self.inner.tri_count = new_count;
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloShaderTransparentChicagoMap {
    inner: ShaderTransparentChicagoMap,
}

#[wasm_bindgen]
impl HaloShaderTransparentChicagoMap {
    #[wasm_bindgen(getter)] pub fn flags(&self) -> u16 { self.inner.flags }
    #[wasm_bindgen(getter)] pub fn color_function(&self) -> ShaderTransparentChicagoColorFunction { self.inner.color_function }
    #[wasm_bindgen(getter)] pub fn alpha_function(&self) -> ShaderTransparentChicagoColorFunction { self.inner.alpha_function }
    #[wasm_bindgen(getter)] pub fn map_u_scale(&self) -> f32 { self.inner.map_u_scale }
    #[wasm_bindgen(getter)] pub fn map_v_scale(&self) -> f32 { self.inner.map_v_scale }
    #[wasm_bindgen(getter)] pub fn map_u_offset(&self) -> f32 { self.inner.map_u_offset }
    #[wasm_bindgen(getter)] pub fn map_v_offset(&self) -> f32 { self.inner.map_v_offset }
    #[wasm_bindgen(getter)] pub fn map_rotation(&self) -> f32 { self.inner.map_rotation }
    #[wasm_bindgen(getter)] pub fn mipmap_bias(&self) -> f32 { self.inner.mipmap_bias }
    #[wasm_bindgen(getter)] pub fn u_animation_source(&self) -> FunctionSource { self.inner.u_animation_source }
    #[wasm_bindgen(getter)] pub fn u_animation_function(&self) -> AnimationFunction { self.inner.u_animation_function }
    #[wasm_bindgen(getter)] pub fn u_animation_period(&self) -> f32 { self.inner.u_animation_period }
    #[wasm_bindgen(getter)] pub fn u_animation_phase(&self) -> f32 { self.inner.u_animation_phase }
    #[wasm_bindgen(getter)] pub fn u_animation_scale(&self) -> f32 { self.inner.u_animation_scale }
    #[wasm_bindgen(getter)] pub fn v_animation_source(&self) -> FunctionSource { self.inner.v_animation_source }
    #[wasm_bindgen(getter)] pub fn v_animation_function(&self) -> AnimationFunction { self.inner.v_animation_function }
    #[wasm_bindgen(getter)] pub fn v_animation_period(&self) -> f32 { self.inner.v_animation_period }
    #[wasm_bindgen(getter)] pub fn v_animation_phase(&self) -> f32 { self.inner.v_animation_phase }
    #[wasm_bindgen(getter)] pub fn v_animation_scale(&self) -> f32 { self.inner.v_animation_scale }
    #[wasm_bindgen(getter)] pub fn rotation_animation_source(&self) -> FunctionSource { self.inner.rotation_animation_source }
    #[wasm_bindgen(getter)] pub fn rotation_animation_function(&self) -> AnimationFunction { self.inner.rotation_animation_function }
    #[wasm_bindgen(getter)] pub fn rotation_animation_period(&self) -> f32 { self.inner.rotation_animation_period }
    #[wasm_bindgen(getter)] pub fn rotation_animation_phase(&self) -> f32 { self.inner.rotation_animation_phase }
    #[wasm_bindgen(getter)] pub fn rotation_animation_scale(&self) -> f32 { self.inner.rotation_animation_scale }
    #[wasm_bindgen(getter)] pub fn rotation_animation_center(&self) -> Point2D { self.inner.rotation_animation_center }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloShaderTransparencyChicago {
    inner: ShaderTransparentChicago,
    path: String,
    maps: Vec<HaloShaderTransparentChicagoMap>,
    bitmaps: Vec<Option<Bitmap>>,
}

#[wasm_bindgen]
impl HaloShaderTransparencyChicago {
    #[wasm_bindgen(getter)] pub fn radiosity_flags(&self) -> u16 { self.inner.radiosity_flags }
    #[wasm_bindgen(getter)] pub fn radiosity_detail_level(&self) -> RadiosityDetailLevel { self.inner.radiosity_detail_level }
    #[wasm_bindgen(getter)] pub fn radiosity_light_power(&self) -> f32 { self.inner.radiosity_light_power }
    #[wasm_bindgen(getter)] pub fn radiosity_light_color(&self) -> ColorRGB { self.inner.radiosity_light_color }
    #[wasm_bindgen(getter)] pub fn radiosity_tint_color(&self) -> ColorRGB { self.inner.radiosity_tint_color }
    #[wasm_bindgen(getter)] pub fn numeric_counter_limit(&self) -> u8 { self.inner.numeric_counter_limit }
    #[wasm_bindgen(getter)] pub fn flags(&self) -> u8 { self.inner.flags }
    #[wasm_bindgen(getter)] pub fn first_map_type(&self) -> ShaderTransparentGenericMapType { self.inner.first_map_type }
    #[wasm_bindgen(getter)] pub fn framebuffer_blend_function(&self) -> FramebufferBlendFunction { self.inner.framebuffer_blend_function }
    #[wasm_bindgen(getter)] pub fn framebuffer_fade_mode(&self) -> FramebufferFadeMode { self.inner.framebuffer_fade_mode }
    #[wasm_bindgen(getter)] pub fn framebuffer_fade_source(&self) -> FunctionSource { self.inner.framebuffer_fade_source }
    #[wasm_bindgen(getter)] pub fn lens_flare_spacing(&self) -> f32 { self.inner.lens_flare_spacing }
    #[wasm_bindgen(getter)] pub fn path(&self) -> String { self.path.clone() }

    pub fn get_bitmap(&self, i: usize) -> Option<HaloBitmap> {
        match self.bitmaps.get(i) {
            Some(maybe_bitmap) => maybe_bitmap.as_ref().map(|b| HaloBitmap { inner: b.clone() }),
            None => None,
        }
    }

    pub fn get_map(&self, i: usize) -> Option<HaloShaderTransparentChicagoMap> {
        self.maps.get(i).cloned()
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloShaderTransparentGenericMap {
    inner: ShaderTransparentGenericMap,
}

#[wasm_bindgen]
impl HaloShaderTransparentGenericMap {
    #[wasm_bindgen(getter)] pub fn flags(&self) -> u16 { self.inner.flags }
    #[wasm_bindgen(getter)] pub fn map_u_scale(&self) -> f32 { self.inner.map_u_scale }
    #[wasm_bindgen(getter)] pub fn map_v_scale(&self) -> f32 { self.inner.map_v_scale }
    #[wasm_bindgen(getter)] pub fn map_u_offset(&self) -> f32 { self.inner.map_u_offset }
    #[wasm_bindgen(getter)] pub fn map_v_offset(&self) -> f32 { self.inner.map_v_offset }
    #[wasm_bindgen(getter)] pub fn map_rotation(&self) -> f32 { self.inner.map_rotation }
    #[wasm_bindgen(getter)] pub fn mipmap_bias(&self) -> f32 { self.inner.mipmap_bias }
    #[wasm_bindgen(getter)] pub fn u_animation_source(&self) -> FunctionSource { self.inner.u_animation_source }
    #[wasm_bindgen(getter)] pub fn u_animation_function(&self) -> AnimationFunction { self.inner.u_animation_function }
    #[wasm_bindgen(getter)] pub fn u_animation_period(&self) -> f32 { self.inner.u_animation_period }
    #[wasm_bindgen(getter)] pub fn u_animation_phase(&self) -> f32 { self.inner.u_animation_phase }
    #[wasm_bindgen(getter)] pub fn u_animation_scale(&self) -> f32 { self.inner.u_animation_scale }
    #[wasm_bindgen(getter)] pub fn v_animation_source(&self) -> FunctionSource { self.inner.v_animation_source }
    #[wasm_bindgen(getter)] pub fn v_animation_function(&self) -> AnimationFunction { self.inner.v_animation_function }
    #[wasm_bindgen(getter)] pub fn v_animation_period(&self) -> f32 { self.inner.v_animation_period }
    #[wasm_bindgen(getter)] pub fn v_animation_phase(&self) -> f32 { self.inner.v_animation_phase }
    #[wasm_bindgen(getter)] pub fn v_animation_scale(&self) -> f32 { self.inner.v_animation_scale }
    #[wasm_bindgen(getter)] pub fn rotation_animation_source(&self) -> FunctionSource { self.inner.rotation_animation_source }
    #[wasm_bindgen(getter)] pub fn rotation_animation_function(&self) -> AnimationFunction { self.inner.rotation_animation_function }
    #[wasm_bindgen(getter)] pub fn rotation_animation_period(&self) -> f32 { self.inner.rotation_animation_period }
    #[wasm_bindgen(getter)] pub fn rotation_animation_phase(&self) -> f32 { self.inner.rotation_animation_phase }
    #[wasm_bindgen(getter)] pub fn rotation_animation_scale(&self) -> f32 { self.inner.rotation_animation_scale }
    #[wasm_bindgen(getter)] pub fn rotation_animation_center(&self) -> Point2D { self.inner.rotation_animation_center }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloShaderTransparentGenericStage {
    inner: ShaderTransparentGenericStage,
}

#[wasm_bindgen]
impl HaloShaderTransparentGenericStage {
    #[wasm_bindgen(getter)] pub fn flags(&self) -> u16 { self.inner.flags }
    #[wasm_bindgen(getter)] pub fn color0_source(&self) -> FunctionSource { self.inner.color0_source }
    #[wasm_bindgen(getter)] pub fn color0_animation_function(&self) -> AnimationFunction { self.inner.color0_animation_function }
    #[wasm_bindgen(getter)] pub fn color0_animation_period(&self) -> f32 { self.inner.color0_animation_period }
    #[wasm_bindgen(getter)] pub fn color0_animation_lower_bound(&self) -> ColorARGB { self.inner.color0_animation_lower_bound }
    #[wasm_bindgen(getter)] pub fn color0_animation_upper_bound(&self) -> ColorARGB { self.inner.color0_animation_upper_bound }
    #[wasm_bindgen(getter)] pub fn color1(&self) -> ColorARGB { self.inner.color1 }
    #[wasm_bindgen(getter)] pub fn input_a(&self) -> ShaderInput { self.inner.input_a }
    #[wasm_bindgen(getter)] pub fn input_a_mapping(&self) -> ShaderMapping { self.inner.input_a_mapping }
    #[wasm_bindgen(getter)] pub fn input_b(&self) -> ShaderInput { self.inner.input_b }
    #[wasm_bindgen(getter)] pub fn input_b_mapping(&self) -> ShaderMapping { self.inner.input_b_mapping }
    #[wasm_bindgen(getter)] pub fn input_c(&self) -> ShaderInput { self.inner.input_c }
    #[wasm_bindgen(getter)] pub fn input_c_mapping(&self) -> ShaderMapping { self.inner.input_c_mapping }
    #[wasm_bindgen(getter)] pub fn input_d(&self) -> ShaderInput { self.inner.input_d }
    #[wasm_bindgen(getter)] pub fn input_d_mapping(&self) -> ShaderMapping { self.inner.input_d_mapping }
    #[wasm_bindgen(getter)] pub fn output_ab(&self) -> ShaderOutput { self.inner.output_ab }
    #[wasm_bindgen(getter)] pub fn output_ab_function(&self) -> ShaderOutputFunction { self.inner.output_ab_function }
    #[wasm_bindgen(getter)] pub fn output_cd(&self) -> ShaderOutput { self.inner.output_cd }
    #[wasm_bindgen(getter)] pub fn output_cd_function(&self) -> ShaderOutputFunction { self.inner.output_cd_function }
    #[wasm_bindgen(getter)] pub fn output_ab_cd_mux_sum(&self) -> ShaderOutput { self.inner.output_ab_cd_mux_sum }
    #[wasm_bindgen(getter)] pub fn output_mapping_color(&self) -> ShaderOutputMapping { self.inner.output_mapping_color }
    #[wasm_bindgen(getter)] pub fn input_a_alpha(&self) -> ShaderAlphaInput { self.inner.input_a_alpha }
    #[wasm_bindgen(getter)] pub fn input_a_mapping_alpha(&self) -> ShaderMapping { self.inner.input_a_mapping_alpha }
    #[wasm_bindgen(getter)] pub fn input_b_alpha(&self) -> ShaderAlphaInput { self.inner.input_b_alpha }
    #[wasm_bindgen(getter)] pub fn input_b_mapping_alpha(&self) -> ShaderMapping { self.inner.input_b_mapping_alpha }
    #[wasm_bindgen(getter)] pub fn input_c_alpha(&self) -> ShaderAlphaInput { self.inner.input_c_alpha }
    #[wasm_bindgen(getter)] pub fn input_c_mapping_alpha(&self) -> ShaderMapping { self.inner.input_c_mapping_alpha }
    #[wasm_bindgen(getter)] pub fn input_d_alpha(&self) -> ShaderAlphaInput { self.inner.input_d_alpha }
    #[wasm_bindgen(getter)] pub fn input_d_mapping_alpha(&self) -> ShaderMapping { self.inner.input_d_mapping_alpha }
    #[wasm_bindgen(getter)] pub fn output_ab_alpha(&self) -> ShaderOutput { self.inner.output_ab_alpha }
    #[wasm_bindgen(getter)] pub fn output_cd_alpha(&self) -> ShaderOutput { self.inner.output_cd_alpha }
    #[wasm_bindgen(getter)] pub fn output_ab_cd_mux_sum_alpha(&self) -> ShaderOutput { self.inner.output_ab_cd_mux_sum_alpha }
    #[wasm_bindgen(getter)] pub fn output_mapping_alpha(&self) -> ShaderOutputMapping { self.inner.output_mapping_alpha }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloShaderTransparencyGeneric {
    inner: ShaderTransparentGeneric,
    path: String,
    maps: Vec<HaloShaderTransparentGenericMap>,
    stages: Vec<HaloShaderTransparentGenericStage>,
    bitmaps: Vec<Bitmap>,
}

#[wasm_bindgen]
impl HaloShaderTransparencyGeneric {
    #[wasm_bindgen(getter)] pub fn radiosity_flags(&self) -> u16 { self.inner.radiosity_flags }
    #[wasm_bindgen(getter)] pub fn radiosity_detail_level(&self) -> RadiosityDetailLevel { self.inner.radiosity_detail_level }
    #[wasm_bindgen(getter)] pub fn radiosity_light_power(&self) -> f32 { self.inner.radiosity_light_power }
    #[wasm_bindgen(getter)] pub fn radiosity_light_color(&self) -> ColorRGB { self.inner.radiosity_light_color }
    #[wasm_bindgen(getter)] pub fn radiosity_tint_color(&self) -> ColorRGB { self.inner.radiosity_tint_color }
    #[wasm_bindgen(getter)] pub fn numeric_counter_limit(&self) -> u8 { self.inner.numeric_counter_limit }
    #[wasm_bindgen(getter)] pub fn flags(&self) -> u8 { self.inner.flags }
    #[wasm_bindgen(getter)] pub fn first_map_type(&self) -> ShaderTransparentGenericMapType { self.inner.first_map_type }
    #[wasm_bindgen(getter)] pub fn framebuffer_blend_function(&self) -> FramebufferBlendFunction { self.inner.framebuffer_blend_function }
    #[wasm_bindgen(getter)] pub fn framebuffer_fade_mode(&self) -> FramebufferFadeMode { self.inner.framebuffer_fade_mode }
    #[wasm_bindgen(getter)] pub fn framebuffer_fade_source(&self) -> FunctionSource { self.inner.framebuffer_fade_source }
    #[wasm_bindgen(getter)] pub fn lens_flare_spacing(&self) -> f32 { self.inner.lens_flare_spacing }
    #[wasm_bindgen(getter)] pub fn path(&self) -> String { self.path.clone() }

    pub fn get_bitmap(&self, i: usize) -> Option<HaloBitmap> {
        self.bitmaps.get(i).map(|b| HaloBitmap { inner: b.clone() })
    }

    pub fn get_map(&self, i: usize) -> Option<HaloShaderTransparentGenericMap> {
        self.maps.get(i).cloned()
    }

    pub fn get_stage(&self, i: usize) -> Option<HaloShaderTransparentGenericStage> {
        self.stages.get(i).cloned()
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloShaderModel {
    inner: ShaderModel,
    base_bitmap: Option<Bitmap>,
    multipurpose_map: Option<Bitmap>,
    detail_bitmap: Option<Bitmap>,
    reflection_cube_map: Option<Bitmap>,
}

#[wasm_bindgen]
impl HaloShaderModel {
    #[wasm_bindgen(getter)] pub fn flags(&self) -> u16 { self.inner.flags }
    #[wasm_bindgen(getter)] pub fn translucency(&self) -> f32 { self.inner.translucency }
    #[wasm_bindgen(getter)] pub fn animation_function(&self) -> AnimationFunction { self.inner.animation_function }
    #[wasm_bindgen(getter)] pub fn animation_period(&self) -> f32 { self.inner.animation_period }
    #[wasm_bindgen(getter)] pub fn animation_color_lower_bound(&self) -> ColorRGB { self.inner.animation_color_lower_bound }
    #[wasm_bindgen(getter)] pub fn animation_color_upper_bound(&self) -> ColorRGB { self.inner.animation_color_upper_bound }
    #[wasm_bindgen(getter)] pub fn map_u_scale(&self) -> f32 { self.inner.map_u_scale }
    #[wasm_bindgen(getter)] pub fn map_v_scale(&self) -> f32 { self.inner.map_v_scale }
    #[wasm_bindgen(getter)] pub fn detail_function(&self) -> DetailBitmapFunction { self.inner.detail_function }
    #[wasm_bindgen(getter)] pub fn detail_mask(&self) -> DetailBitmapMask { self.inner.detail_mask }
    #[wasm_bindgen(getter)] pub fn detail_bitmap_scale(&self) -> f32 { self.inner.detail_map_scale }
    #[wasm_bindgen(getter)] pub fn detail_bitmap_v_scale(&self) -> f32 { self.inner.detail_map_v_scale }
    #[wasm_bindgen(getter)] pub fn u_animation_source(&self) -> FunctionSource { self.inner.u_animation_source }
    #[wasm_bindgen(getter)] pub fn u_animation_function(&self) -> AnimationFunction { self.inner.u_animation_function }
    #[wasm_bindgen(getter)] pub fn u_animation_period(&self) -> f32 { self.inner.u_animation_period }
    #[wasm_bindgen(getter)] pub fn u_animation_phase(&self) -> f32 { self.inner.u_animation_phase }
    #[wasm_bindgen(getter)] pub fn u_animation_scale(&self) -> f32 { self.inner.u_animation_scale }
    #[wasm_bindgen(getter)] pub fn v_animation_source(&self) -> FunctionSource { self.inner.v_animation_source }
    #[wasm_bindgen(getter)] pub fn v_animation_function(&self) -> AnimationFunction { self.inner.v_animation_function }
    #[wasm_bindgen(getter)] pub fn v_animation_period(&self) -> f32 { self.inner.v_animation_period }
    #[wasm_bindgen(getter)] pub fn v_animation_phase(&self) -> f32 { self.inner.v_animation_phase }
    #[wasm_bindgen(getter)] pub fn v_animation_scale(&self) -> f32 { self.inner.v_animation_scale }
    #[wasm_bindgen(getter)] pub fn rotation_animation_source(&self) -> FunctionSource { self.inner.rotation_animation_source }
    #[wasm_bindgen(getter)] pub fn rotation_animation_function(&self) -> AnimationFunction { self.inner.rotation_animation_function }
    #[wasm_bindgen(getter)] pub fn rotation_animation_period(&self) -> f32 { self.inner.rotation_animation_period }
    #[wasm_bindgen(getter)] pub fn rotation_animation_phase(&self) -> f32 { self.inner.rotation_animation_phase }
    #[wasm_bindgen(getter)] pub fn rotation_animation_scale(&self) -> f32 { self.inner.rotation_animation_scale }
    #[wasm_bindgen(getter)] pub fn rotation_animation_center(&self) -> Point2D { self.inner.rotation_animation_center }
    #[wasm_bindgen(getter)] pub fn reflection_falloff_distance(&self) -> f32 { self.inner.reflection_falloff_distance }
    #[wasm_bindgen(getter)] pub fn reflection_cutoff_distance(&self) -> f32 { self.inner.reflection_cutoff_distance }
    #[wasm_bindgen(getter)] pub fn perpendicular_brightness(&self) -> f32 { self.inner.perpendicular_brightness }
    #[wasm_bindgen(getter)] pub fn perpendicular_tint_color(&self) -> ColorRGB { self.inner.perpendicular_tint_color }
    #[wasm_bindgen(getter)] pub fn parallel_brightness(&self) -> f32 { self.inner.parallel_brightness }
    #[wasm_bindgen(getter)] pub fn parallel_tint_color(&self) -> ColorRGB { self.inner.parallel_tint_color }
    #[wasm_bindgen(getter)] pub fn has_base_bitmap(&self) -> bool { self.base_bitmap.is_some() }
    #[wasm_bindgen(getter)] pub fn has_detail_bitmap(&self) -> bool { self.detail_bitmap.is_some() }
    #[wasm_bindgen(getter)] pub fn has_multipurpose_map(&self) -> bool { self.multipurpose_map.is_some() }
    #[wasm_bindgen(getter)] pub fn has_reflection_cube_map(&self) -> bool { self.reflection_cube_map.is_some() }

    pub fn get_base_bitmap(&self) -> Option<HaloBitmap> {
        self.base_bitmap.as_ref()
            .map(|map| HaloBitmap::new(map.clone()))
    }
    pub fn get_detail_bitmap(&self) -> Option<HaloBitmap> {
        self.detail_bitmap.as_ref()
            .map(|map| HaloBitmap::new(map.clone()))
    }
    pub fn get_multipurpose_map(&self) -> Option<HaloBitmap> {
        self.multipurpose_map.as_ref()
            .map(|map| HaloBitmap::new(map.clone()))
    }
    pub fn get_reflection_cube_map(&self) -> Option<HaloBitmap> {
        self.reflection_cube_map.as_ref()
            .map(|map| HaloBitmap::new(map.clone()))
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloShaderEnvironment {
    inner: ShaderEnvironment,
    path: String,
    base_bitmap: Bitmap,
    bump_map: Option<Bitmap>,
    primary_detail_bitmap: Option<Bitmap>,
    secondary_detail_bitmap: Option<Bitmap>,
    micro_detail_bitmap: Option<Bitmap>,
    reflection_cube_map: Option<Bitmap>,
}

#[wasm_bindgen]
impl HaloShaderEnvironment {
    #[wasm_bindgen(getter)] pub fn flags(&self) -> u16 { self.inner.flags }
    #[wasm_bindgen(getter)] pub fn shader_environment_type(&self) -> ShaderEnvironmentType { self.inner.shader_environment_type }
    #[wasm_bindgen(getter)] pub fn diffuse_flags(&self) -> u16 { self.inner.diffuse_flags }
    #[wasm_bindgen(getter)] pub fn specular_flags(&self) -> u16 { self.inner.specular_flags }
    #[wasm_bindgen(getter)] pub fn brightness(&self) -> f32 { self.inner.brightness }
    #[wasm_bindgen(getter)] pub fn primary_detail_bitmap_scale(&self) -> f32 { self.inner.primary_detail_bitmap_scale }
    #[wasm_bindgen(getter)] pub fn detail_bitmap_function(&self) -> DetailBitmapFunction { self.inner.detail_bitmap_function }
    #[wasm_bindgen(getter)] pub fn secondary_detail_bitmap_scale(&self) -> f32 { self.inner.secondary_detail_bitmap_scale }
    #[wasm_bindgen(getter)] pub fn micro_detail_bitmap_scale(&self) -> f32 { self.inner.micro_detail_scale }
    #[wasm_bindgen(getter)] pub fn micro_detail_bitmap_function(&self) -> DetailBitmapFunction { self.inner.micro_detail_bitmap_function }
    #[wasm_bindgen(getter)] pub fn bump_map_scale(&self) -> f32 { self.inner.bump_map_scale }
    #[wasm_bindgen(getter)] pub fn has_primary_detail_bitmap(&self) -> bool { self.primary_detail_bitmap.is_some() }
    #[wasm_bindgen(getter)] pub fn has_secondary_detail_bitmap(&self) -> bool { self.secondary_detail_bitmap.is_some() }
    #[wasm_bindgen(getter)] pub fn has_micro_detail_bitmap(&self) -> bool { self.micro_detail_bitmap.is_some() }
    #[wasm_bindgen(getter)] pub fn has_bump_map(&self) -> bool { self.bump_map.is_some() }
    #[wasm_bindgen(getter)] pub fn has_reflection_cube_map(&self) -> bool { self.reflection_cube_map.is_some() }
    #[wasm_bindgen(getter)] pub fn perpendicular_color(&self) -> ColorRGB { self.inner.perpendicular_color }
    #[wasm_bindgen(getter)] pub fn parallel_color(&self) -> ColorRGB { self.inner.parallel_color }
    #[wasm_bindgen(getter)] pub fn reflection_flags(&self) -> u16 { self.inner.reflection_flags }
    #[wasm_bindgen(getter)] pub fn reflection_type(&self) -> ShaderEnvironmentReflectionType { self.inner.reflection_type }
    #[wasm_bindgen(getter)] pub fn lightmap_brightness_scale(&self) -> f32 { self.inner.lightmap_brightness_scale }
    #[wasm_bindgen(getter)] pub fn perpendicular_brightness(&self) -> f32 { self.inner.perpendicular_brightness }
    #[wasm_bindgen(getter)] pub fn parallel_brightness(&self) -> f32 { self.inner.parallel_brightness }
    #[wasm_bindgen(getter)] pub fn path(&self) -> String { self.path.clone() }

    pub fn get_base_bitmap(&self) -> HaloBitmap {
        HaloBitmap::new(self.base_bitmap.clone())
    }

    pub fn get_primary_detail_bitmap(&self) -> Option<HaloBitmap> {
        self.primary_detail_bitmap.as_ref()
            .map(|map| HaloBitmap::new(map.clone()))
    }

    pub fn get_bump_map(&self) -> Option<HaloBitmap> {
        self.bump_map.as_ref()
            .map(|map| HaloBitmap::new(map.clone()))
    }

    pub fn get_secondary_detail_bitmap(&self) -> Option<HaloBitmap> {
        self.secondary_detail_bitmap.as_ref()
            .map(|map| HaloBitmap::new(map.clone()))
    }

    pub fn get_micro_detail_bitmap(&self) -> Option<HaloBitmap> {
        self.micro_detail_bitmap.as_ref()
            .map(|map| HaloBitmap::new(map.clone()))
    }

    pub fn get_reflection_cube_map(&self) -> Option<HaloBitmap> {
        self.reflection_cube_map.as_ref()
            .map(|map| HaloBitmap::new(map.clone()))
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloShaderTransparentWaterRipple {
    inner: ShaderTransparentWaterRipple,
}

#[wasm_bindgen]
impl HaloShaderTransparentWaterRipple {
    pub fn contribution_factor(&self) -> f32 { self.inner.contribution_factor }
    pub fn animation_angle(&self) -> f32 { self.inner.animation_angle }
    pub fn animation_velocity(&self) -> f32 { self.inner.animation_velocity }
    pub fn map_u_offset(&self) -> f32 { self.inner.map_u_offset }
    pub fn map_v_offset(&self) -> f32 { self.inner.map_v_offset }
    pub fn map_repeats(&self) -> u16 { self.inner.map_repeats }
    pub fn map_index(&self) -> u16 { self.inner.map_index }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloShaderTransparentWater {
    inner: ShaderTransparentWater,
    path: String,
    base_bitmap: Bitmap,
    reflection_bitmap: Option<Bitmap>,
    ripple_bitmap: Option<Bitmap>,
    ripples: Vec<HaloShaderTransparentWaterRipple>,
}

#[wasm_bindgen]
impl HaloShaderTransparentWater {
    #[wasm_bindgen(getter)] pub fn flags(&self) -> u16 { self.inner.flags }
    #[wasm_bindgen(getter)] pub fn view_perpendicular_brightness(&self) -> f32 { self.inner.view_perpendicular_brightness }
    #[wasm_bindgen(getter)] pub fn view_perpendicular_tint_color(&self) -> ColorRGB { self.inner.view_perpendicular_tint_color }
    #[wasm_bindgen(getter)] pub fn view_parallel_brightness(&self) -> f32 { self.inner.view_parallel_brightness }
    #[wasm_bindgen(getter)] pub fn view_parallel_tint_color(&self) -> ColorRGB { self.inner.view_parallel_tint_color }
    #[wasm_bindgen(getter)] pub fn ripple_animation_angle(&self) -> f32 { self.inner.ripple_animation_angle }
    #[wasm_bindgen(getter)] pub fn ripple_animation_velocity(&self) -> f32 { self.inner.ripple_animation_velocity }
    #[wasm_bindgen(getter)] pub fn ripple_scale(&self) -> f32 { self.inner.ripple_scale }
    #[wasm_bindgen(getter)] pub fn ripple_mipmap_levels(&self) -> u16 { self.inner.ripple_mipmap_levels }
    #[wasm_bindgen(getter)] pub fn ripple_mipmap_fade_factor(&self) -> f32 { self.inner.ripple_mipmap_fade_factor }
    #[wasm_bindgen(getter)] pub fn ripple_mipmap_detail_bias(&self) -> f32 { self.inner.ripple_mipmap_detail_bias }
    #[wasm_bindgen(getter)] pub fn path(&self) -> String { self.path.clone() }

    pub fn get_base_bitmap(&self) -> HaloBitmap {
        HaloBitmap::new(self.base_bitmap.clone())
    }

    pub fn get_reflection_bitmap(&self) -> Option<HaloBitmap> {
        self.reflection_bitmap.as_ref()
            .map(|map| HaloBitmap::new(map.clone()))
    }

    pub fn get_ripple_bitmap(&self) -> Option<HaloBitmap> {
        self.ripple_bitmap.as_ref()
            .map(|map| HaloBitmap::new(map.clone()))
    }

    pub fn get_ripple(&self, i: usize) -> Option<HaloShaderTransparentWaterRipple> {
        self.ripples.get(i).cloned()
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloLightmap {
    inner: BSPLightmap,
}

#[wasm_bindgen]
impl HaloLightmap {
    fn new(lightmap: &BSPLightmap) -> HaloLightmap {
        HaloLightmap {
            inner: lightmap.clone(),
        }
    }

    pub fn get_bitmap_index(&self) -> u16 {
        self.inner.bitmap
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloBSP {
    inner: BSP,
    lightmaps_bitmap: Option<Bitmap>,
}

#[wasm_bindgen]
impl HaloBSP {
    fn new(bsp: BSP, lightmaps_bitmap: Option<Bitmap>) -> HaloBSP {
        HaloBSP { inner: bsp, lightmaps_bitmap }
    }

    pub fn get_lightmaps_bitmap(&self) -> Option<HaloBitmap> {
        self.lightmaps_bitmap.as_ref().map(|bitmap| HaloBitmap::new(bitmap.clone()))
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloBitmap {
    inner: Bitmap,
}

#[wasm_bindgen]
impl HaloBitmap {
    fn new(inner: Bitmap) -> Self {
        HaloBitmap { inner }
    }

    #[wasm_bindgen(getter)] pub fn mipmap_count(&self) -> u16 { self.inner.mipmap_count }

    pub fn get_metadata_for_index(&self, index: usize) -> HaloBitmapMetadata {
        HaloBitmapMetadata::new(&self.inner.data.items.as_ref().unwrap()[index])
    }

    pub fn get_tag_id(&self) -> u32 {
        self.inner.data.items.as_ref().unwrap()[0].bitmap_tag_id
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloBitmapMetadata {
    inner: BitmapData
}

#[wasm_bindgen]
impl HaloBitmapMetadata {
    fn new(inner: &BitmapData) -> Self {
        HaloBitmapMetadata { inner: inner.clone() }
    }

    #[wasm_bindgen(getter)] pub fn width(&self) -> u16 { self.inner.width }
    #[wasm_bindgen(getter)] pub fn height(&self) -> u16 { self.inner.height }
    #[wasm_bindgen(getter)] pub fn depth(&self) -> u16 { self.inner.depth }
    #[wasm_bindgen(getter)] pub fn bitmap_type(&self) -> BitmapDataType { self.inner.bitmap_type }
    #[wasm_bindgen(getter)] pub fn bitmap_tag_id(&self) -> u32 { self.inner.bitmap_tag_id }
    #[wasm_bindgen(getter)] pub fn format(&self) -> BitmapFormat { self.inner.format }
    #[wasm_bindgen(getter)] pub fn flags(&self) -> u16 { self.inner.flags }
    #[wasm_bindgen(getter)] pub fn mipmap_count(&self) -> u16 { self.inner.mipmap_count }

    pub fn is_external(&self) -> bool {
        self.inner.is_external()
    }
}

#[wasm_bindgen]
impl HaloSceneManager {
    pub fn new(map_data: Vec<u8>) -> Self {
        let mgr = MapManager::new(map_data).unwrap();
        HaloSceneManager { mgr }
    }

    fn get_shader(&mut self, shader_hdr: TagHeader) -> JsValue {
        match self.mgr.read_tag(&shader_hdr) {
            Ok(tag) => match tag.data {
                TagData::ShaderEnvironment(s) => {
                    if s.base_bitmap.path_pointer != 0 {
                        JsValue::from(HaloShaderEnvironment {
                            base_bitmap: self.resolve_bitmap_dependency(&s.base_bitmap).unwrap(),
                            bump_map: self.resolve_bitmap_dependency(&s.bump_map),
                            primary_detail_bitmap: self.resolve_bitmap_dependency(&s.primary_detail_bitmap),
                            secondary_detail_bitmap: self.resolve_bitmap_dependency(&s.secondary_detail_bitmap),
                            micro_detail_bitmap: self.resolve_bitmap_dependency(&s.micro_detail_bitmap),
                            reflection_cube_map: self.resolve_bitmap_dependency(&s.reflection_cube_map),
                            path: shader_hdr.path.clone(),
                            inner: s.clone(),
                        })
                    } else {
                        JsValue::NULL
                    }
                },
                TagData::ShaderModel(s) => JsValue::from(HaloShaderModel {
                    base_bitmap: self.resolve_bitmap_dependency(&s.base_map),
                    detail_bitmap: self.resolve_bitmap_dependency(&s.detail_map),
                    multipurpose_map: self.resolve_bitmap_dependency(&s.multipurpose_map),
                    reflection_cube_map: self.resolve_bitmap_dependency(&s.reflection_cube_map),
                    inner: s,
                }),
                TagData::ShaderTransparentGeneric(s) => {
                    let mut maps = Vec::new();
                    let mut bitmaps = Vec::new();
                    let mut stages = Vec::new();
                    for map in s.maps.items.as_ref().unwrap() {
                        bitmaps.push(self.resolve_bitmap_dependency(&map.map).unwrap());
                        maps.push(HaloShaderTransparentGenericMap { inner: map.clone() });
                    }
                    for stage in s.stages.items.as_ref().unwrap() {
                        stages.push(HaloShaderTransparentGenericStage { inner: stage.clone() });
                    }
                    JsValue::from(HaloShaderTransparencyGeneric {
                        inner: s,
                        path: shader_hdr.path.clone(),
                        maps,
                        bitmaps,
                        stages,
                    })
                },
                TagData::ShaderTransparentChicago(s) => {
                    let mut maps = Vec::new();
                    let mut bitmaps = Vec::new();
                    for chicago_map in s.maps.items.as_ref().unwrap() {
                        bitmaps.push(self.resolve_bitmap_dependency(&chicago_map.map));
                        maps.push(HaloShaderTransparentChicagoMap { inner: chicago_map.clone() });
                    }
                    JsValue::from(HaloShaderTransparencyChicago {
                        inner: s,
                        path: shader_hdr.path.clone(),
                        maps,
                        bitmaps,
                    })
                },
                TagData::ShaderTransparentWater(s) => {
                    let mut ripples = Vec::new();
                    for ripple in s.ripples.items.as_ref().unwrap() {
                        ripples.push(HaloShaderTransparentWaterRipple { inner: ripple.clone() });
                    }
                    JsValue::from(HaloShaderTransparentWater {
                        path: shader_hdr.path.clone(),
                        base_bitmap: self.resolve_bitmap_dependency(&s.base_bitmap).unwrap(),
                        reflection_bitmap: self.resolve_bitmap_dependency(&s.reflection_bitmap),
                        ripple_bitmap: self.resolve_bitmap_dependency(&s.ripple_bitmap),
                        ripples,
                        inner: s,
                    })
                },
                _ => JsValue::NULL,
            },
            _ => JsValue::NULL,
        }
    }

    pub fn get_model_shaders(&mut self, model: &HaloModel) -> Array {
        let result = Array::new();
        for model_shader in model.inner.shaders.items.as_ref().unwrap() {
            // FIXME do we need the permutation value?
            let shader_hdr = self.mgr.resolve_dependency(&model_shader.shader).unwrap();
            let js_value = self.get_shader(shader_hdr);
            result.push(&js_value);
        }
        result
    }

    pub fn get_material_shader(&mut self, material: &HaloMaterial) -> JsValue {
        let shader_hdr = self.mgr.resolve_dependency(&material.inner.shader).unwrap();
        self.get_shader(shader_hdr)
    }

    pub fn get_model_parts(&mut self, model: &HaloModel) -> Array {
        let result = Array::new();
        for geometry in model.inner.geometries.items.as_ref().unwrap() {
            for part in geometry.parts.items.as_ref().unwrap() {
                result.push(&JsValue::from(HaloModelPart::new(part)));
            }
        }
        result
    }

    pub fn get_scenery_model(&mut self, scenery: &HaloScenery) -> Option<HaloModel> {
        self.resolve_model_dependency(&scenery.inner.model)
            .map(|model| HaloModel { inner: model })
    }

    pub fn get_scenery_palette(&mut self) -> Array {
        let scenario_tag = self.mgr.get_scenario().unwrap();
        let scenario = match scenario_tag.data {
            TagData::Scenario(s) => s,
            _ => unreachable!(),
        };
        let palette = Array::new();
        for palette_entry in scenario.scenery_palette.items.as_ref().unwrap() {
            let scenery_header = self.mgr.resolve_dependency(&palette_entry.obj).unwrap();
            let scenery_tag = self.mgr.read_tag(&scenery_header).unwrap();
            match scenery_tag.data {
                TagData::Scenery(s) => palette.push(&JsValue::from(HaloScenery::new(&s))),
                _ => unreachable!(),
            };
        }
        palette
    }

    pub fn get_scenery_instances(&mut self) -> Array {
        let scenario_tag = self.mgr.get_scenario().unwrap();
        let scenario = match scenario_tag.data {
            TagData::Scenario(s) => s,
            _ => unreachable!(),
        };
        let instances = Array::new();
        for scenery in scenario.scenery.items.as_ref().unwrap() {
            instances.push(&JsValue::from(HaloSceneryInstance { inner: scenery.clone() }));
        }
        instances
    }

    pub fn get_skies(&mut self) -> Array {
        let result = Array::new();
        let scenario_tag = self.mgr.get_scenario().unwrap();
        let scenario_data = match scenario_tag.data { TagData::Scenario(s) => s, _ => unreachable!(), };
        for dependency in scenario_data.skies.items.as_ref().unwrap() {
            let sky_header = self.mgr.resolve_dependency(dependency).unwrap();
            match self.mgr.read_tag(&sky_header).unwrap().data {
                TagData::Sky(s) => {
                    result.push(&JsValue::from(HaloSky {
                        model: self.resolve_model_dependency(&s.model),
                        inner: s,
                    }));
                },
                _ => unreachable!(),
            }
        }
        result
    }

    pub fn get_bsps(&mut self) -> Array {
        let scenario_tag = self.mgr.get_scenario().unwrap();
        let bsps: Vec<BSP> = self.mgr.get_scenario_bsps(&scenario_tag).unwrap().iter()
            .map(|tag| match &tag.data {
                TagData::BSP(bsp) => bsp.clone(),
                _ => unreachable!(),
            }).collect();
        let result = Array::new();
        for bsp in &bsps {
            let lightmaps_bitmap = self.resolve_bitmap_dependency(&bsp.lightmaps_bitmap);
            result.push(&JsValue::from(HaloBSP::new(bsp.clone(), lightmaps_bitmap)));
        }
        result
    }

    pub fn get_bsp_lightmaps(&self, bsp: &HaloBSP) -> Array {
        bsp.inner.lightmaps.items.as_ref().unwrap().iter()
            .map(|lightmap| JsValue::from(HaloLightmap::new(lightmap)))
            .collect()
    }

    pub fn get_lightmap_materials(&self, lightmap: &HaloLightmap) -> Array {
        lightmap.inner.materials.items.as_ref().unwrap().iter()
            .map(|material| JsValue::from(HaloMaterial::new(material)))
            .collect()
    }

    pub fn get_model_part_indices(&mut self, part: &HaloModelPart) -> Uint16Array {
        let offset = part.inner.tri_offset + self.mgr.tag_index_header.model_data_file_offset + self.mgr.tag_index_header.vertex_data_size;
        let count = part.inner.tri_count;
        let tri_data = self.mgr.read_map_u16s(offset as u64, count as usize).unwrap();
        Uint16Array::from(&tri_data[..])
    }

    pub fn get_model_part_vertices(&mut self, part: &HaloModelPart) -> Vec<u8> {
        let offset = part.inner.vert_offset + self.mgr.tag_index_header.model_data_file_offset;
        let count = part.inner.vert_count;
        let item_size = 68;
        self.mgr.read_map_bytes(offset as u64, item_size * count as usize).unwrap()
    }

    pub fn get_bsp_indices(&self, bsp: &HaloBSP) -> Vec<u16> {
        let mut indices = Vec::new();
        for tri in bsp.inner.surfaces.items.as_ref().unwrap() {
            indices.extend_from_slice(&[tri.v0, tri.v1, tri.v2]);
        }
        indices
    }

    fn resolve_model_dependency(&mut self, dependency: &TagDependency) -> Option<GbxModel> {
        let hdr = match self.mgr.resolve_dependency(dependency) {
            Some(hdr) => hdr,
            None => return None,
        };
        match self.mgr.read_tag(&hdr).unwrap().data {
            TagData::GbxModel(model) => Some(model),
            _ => unreachable!(),
        }
    }

    fn resolve_bitmap_dependency(&mut self, dependency: &TagDependency) -> Option<Bitmap> {
        let hdr = match self.mgr.resolve_dependency(dependency) {
            Some(hdr) => hdr,
            None => return None,
        };
        match self.mgr.read_tag(&hdr).unwrap().data {
            TagData::Bitmap(bitmap) => Some(bitmap),
            _ => unreachable!(),
        }
    }

    pub fn get_and_convert_bitmap_data(&mut self, bitmap: &HaloBitmap, submap: usize) -> Vec<u8> {
        let bitmap_data = &bitmap.inner.data.items.as_ref().unwrap()[submap];
        get_and_convert_bitmap_data(self.mgr.reader.data.get_ref(), bitmap_data)
    }

    pub fn get_material_vertex_data(&mut self, material: &HaloMaterial, bsp: &HaloBSP) -> Vec<u8> {
        let offset = bsp.inner.header.as_ref().unwrap().rendered_vertices_offset + material.inner.rendered_vertices.base_pointer;
        let count = material.inner.rendered_vertices.count;
        let item_size = 56; // position + normal + binormal + tangent + uv
        self.mgr.read_map_bytes(offset as u64, count * item_size).unwrap()
    }

    pub fn get_material_lightmap_data(&mut self, material: &HaloMaterial, bsp: &HaloBSP) -> Vec<u8> {
        let offset = bsp.inner.header.as_ref().unwrap().rendered_vertices_offset + material.inner.lightmap_vertices.base_pointer;
        let count = material.inner.rendered_vertices.count;
        let item_size = 20; // normal + uv
        self.mgr.read_map_bytes(offset as u64, count * item_size).unwrap()
    }
}