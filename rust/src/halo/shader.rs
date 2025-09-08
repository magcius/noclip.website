use deku::prelude::*;
use wasm_bindgen::prelude::*;
use super::tag::*;
use super::common::*;

#[wasm_bindgen(js_name = "HaloShaderTransparencyChicago")]
#[derive(Debug, Clone, DekuRead)]
pub struct ShaderTransparentChicago {
    pub radiosity_flags: u16,
    pub radiosity_detail_level: RadiosityDetailLevel,
    pub radiosity_light_power: f32,
    pub radiosity_light_color: ColorRGB,
    pub radiosity_tint_color: ColorRGB,
    #[deku(pad_bytes_before = "8")]
    pub numeric_counter_limit: u8,
    pub flags: u8,
    pub first_map_type: ShaderTransparentGenericMapType,
    pub framebuffer_blend_function: FramebufferBlendFunction,
    pub framebuffer_fade_mode: FramebufferFadeMode,
    pub framebuffer_fade_source: FunctionSource,
    #[deku(pad_bytes_before = "2")]
    pub lens_flare_spacing: f32,
    pub lens_flare: TagDependency,
    pub(crate) extra_layers: Block<TagDependency>, // only chicago transparent shaders allowed here
    #[deku(pad_bytes_after = "10")]
    pub(crate) bitmaps: Block<ShaderTransparentChicagoBitmap>, // max of 4
}

#[wasm_bindgen(js_class = "HaloShaderTransparencyChicago")]
impl ShaderTransparentChicago {
    pub fn get_bitmaps(&self) -> Vec<ShaderTransparentChicagoBitmap> {
        self.bitmaps.items.as_ref().cloned().unwrap()
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum ShaderTransparentChicagoColorFunction {
    Current = 0,
    NextMap = 1,
    Multiply = 2,
    DoubleMultiply = 3,
    Add = 4,
    AddSignedCurrent = 5,
    AddSignedNextMap = 6,
    SubtractCurrent = 7,
    SubtractNextMap = 8,
    BlendCurrentAlpha = 9,
    BlendCurrentAlphaInverse = 10,
    BlendNextMapAlpha = 11,
    BlendNextMapAlphaInverse = 12,
}

#[wasm_bindgen(js_name = "HaloShaderTransparentChicagoBitmap")]
#[derive(Debug, Clone, DekuRead)]
pub struct ShaderTransparentChicagoBitmap {
    pub flags: u16,
    #[deku(pad_bytes_before = "42")]
    pub color_function: ShaderTransparentChicagoColorFunction,
    pub alpha_function: ShaderTransparentChicagoColorFunction,
    #[deku(pad_bytes_before = "36")]
    pub map_u_scale: f32,
    pub map_v_scale: f32,
    pub map_u_offset: f32,
    pub map_v_offset: f32,
    pub map_rotation: f32,
    pub mipmap_bias: f32,
    pub bitmap: TagDependency,
    #[deku(pad_bytes_before = "40")]
    pub u_animation_source: FunctionSource,
    pub u_animation_function: AnimationFunction,
    pub u_animation_period: f32,
    pub u_animation_phase: f32,
    pub u_animation_scale: f32,
    pub v_animation_source: FunctionSource,
    pub v_animation_function: AnimationFunction,
    pub v_animation_period: f32,
    pub v_animation_phase: f32,
    pub v_animation_scale: f32,
    pub rotation_animation_source: FunctionSource,
    pub rotation_animation_function: AnimationFunction,
    pub rotation_animation_period: f32,
    pub rotation_animation_phase: f32,
    pub rotation_animation_scale: f32,
    pub rotation_animation_center: Point2D,
}

#[wasm_bindgen(js_name = "HaloShaderTransparencyGeneric")]
#[derive(Debug, Clone, DekuRead)]
pub struct ShaderTransparentGeneric {
    pub radiosity_flags: u16,
    pub radiosity_detail_level: RadiosityDetailLevel,
    pub radiosity_light_power: f32,
    pub radiosity_light_color: ColorRGB,
    pub radiosity_tint_color: ColorRGB,
    #[deku(pad_bytes_before = "8")]
    pub numeric_counter_limit: u8,
    pub flags: u8,
    pub first_map_type: ShaderTransparentGenericMapType,
    pub framebuffer_blend_function: FramebufferBlendFunction,
    pub framebuffer_fade_mode: FramebufferFadeMode,
    pub framebuffer_fade_source: FunctionSource,
    #[deku(pad_bytes_before = "2")]
    pub lens_flare_spacing: f32,
    pub lens_flare: TagDependency,
    pub(crate) extra_layers: Block<TagDependency>, // max of 4
    pub(crate) bitmaps: Block<ShaderTransparentGenericBitmap>, // max of 4
    pub(crate) stages: Block<ShaderTransparentGenericStage>, // max of 7
}

#[wasm_bindgen(js_class = "HaloShaderTransparencyGeneric")]
impl ShaderTransparentGeneric {
    pub fn get_stages(&self) -> Vec<ShaderTransparentGenericStage> {
        self.stages.items.as_ref().cloned().unwrap()
    }

    pub fn get_bitmaps(&self) -> Vec<ShaderTransparentGenericBitmap> {
        self.bitmaps.items.as_ref().cloned().unwrap()
    }
}

#[wasm_bindgen(js_name = "HaloShaderTransparentGenericMap")]
#[derive(Debug, Clone, DekuRead)]
pub struct ShaderTransparentGenericBitmap {
    pub flags: u16,
    #[deku(pad_bytes_before = "2")]
    pub map_u_scale: f32,
    pub map_v_scale: f32,
    pub map_u_offset: f32,
    pub map_v_offset: f32,
    pub map_rotation: f32,
    pub mipmap_bias: f32,
    pub bitmap: TagDependency,
    pub u_animation_source: FunctionSource,
    pub u_animation_function: AnimationFunction,
    pub u_animation_period: f32,
    pub u_animation_phase: f32,
    pub u_animation_scale: f32,
    pub v_animation_source: FunctionSource,
    pub v_animation_function: AnimationFunction,
    pub v_animation_period: f32,
    pub v_animation_phase: f32,
    pub v_animation_scale: f32,
    pub rotation_animation_source: FunctionSource,
    pub rotation_animation_function: AnimationFunction,
    pub rotation_animation_period: f32,
    pub rotation_animation_phase: f32,
    pub rotation_animation_scale: f32,
    pub rotation_animation_center: Point2D,
}

#[wasm_bindgen(js_name = "HaloShaderTransparentGenericStage")]
#[derive(Debug, Clone, DekuRead)]
pub struct ShaderTransparentGenericStage {
    pub flags: u16,
    #[deku(pad_bytes_before = "2")]
    pub color0_source: FunctionSource,
    pub color0_animation_function: AnimationFunction,
    pub color0_animation_period: f32,
    pub color0_animation_lower_bound: ColorARGB,
    pub color0_animation_upper_bound: ColorARGB,
    pub color1: ColorARGB,
    pub input_a: ShaderInput,
    pub input_a_mapping: ShaderMapping,
    pub input_b: ShaderInput,
    pub input_b_mapping: ShaderMapping,
    pub input_c: ShaderInput,
    pub input_c_mapping: ShaderMapping,
    pub input_d: ShaderInput,
    pub input_d_mapping: ShaderMapping,
    pub output_ab: ShaderOutput,
    pub output_ab_function: ShaderOutputFunction,
    pub output_cd: ShaderOutput,
    pub output_cd_function: ShaderOutputFunction,
    pub output_ab_cd_mux_sum: ShaderOutput,
    pub output_mapping_color: ShaderOutputMapping,
    pub input_a_alpha: ShaderAlphaInput,
    pub input_a_mapping_alpha: ShaderMapping,
    pub input_b_alpha: ShaderAlphaInput,
    pub input_b_mapping_alpha: ShaderMapping,
    pub input_c_alpha: ShaderAlphaInput,
    pub input_c_mapping_alpha: ShaderMapping,
    pub input_d_alpha: ShaderAlphaInput,
    pub input_d_mapping_alpha: ShaderMapping,
    pub output_ab_alpha: ShaderOutput,
    pub output_cd_alpha: ShaderOutput,
    pub output_ab_cd_mux_sum_alpha: ShaderOutput,
    pub output_mapping_alpha: ShaderOutputMapping,
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum ShaderOutputMapping {
    Identity = 0,
    ScaleByHalf = 1,
    ScaleByTwo = 2,
    ScaleByFour = 3,
    BiasByHalf = 4,
    ExpandNormal = 5,
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum ShaderOutputFunction {
    Multiply = 0,
    DotProduct = 1,
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum ShaderOutput {
    Discard = 0,
    Scratch0 = 1,
    Scratch1 = 2,
    VertexColor0 = 3,
    VertexColor1 = 4,
    Texture0 = 5,
    Texture1 = 6,
    Texture2 = 7,
    Texture3 = 8,
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum ShaderMapping {
    UnsignedIdentity = 0,
    UnsignedInvert = 1,
    ExpandNormal = 2,
    ExpandNegate = 3,
    HalfbiasNormal = 4,
    HalfbiasNegate = 5,
    SignedIdentity = 6,
    SignedNegate = 7,
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum ShaderInput {
    Zero = 0x0,
    One = 0x1,
    OneHalf = 0x2,
    NegativeOne = 0x3,
    NegativeOneHalf = 0x4,
    Texture0Color = 0x5,
    Texture1Color = 0x6,
    Texture2Color = 0x7,
    Texture3Color = 0x8,
    VertexColor0Color = 0x9,
    VertexColor1Color = 0xA,
    Scratch0Color = 0xB,
    Scratch1Color = 0xC,
    Constant0Color = 0xD,
    Constant1Color = 0xE,
    Texture0Alpha = 0xF,
    Texture1Alpha = 0x10,
    Texture2Alpha = 0x11,
    Texture3Alpha = 0x12,
    VertexColor0Alpha = 0x13,
    VertexColor1Alpha = 0x14,
    Scratch0Alpha = 0x15,
    Scratch1Alpha = 0x16,
    Constant0Alpha = 0x17,
    Constant1Alpha = 0x18,
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum ShaderAlphaInput {
    Zero = 0,
    One = 1,
    OneHalf = 2,
    NegativeOne = 3,
    NegativeOneHalf = 4,
    Texture0Alpha = 5,
    Texture1Alpha = 6,
    Texture2Alpha = 7,
    Texture3Alpha = 8,
    VertexColor0Alpha = 9,
    VertexColor1Alpha = 10,
    Scratch0Alpha = 11,
    Scratch1Alpha = 12,
    Constant0Alpha = 13,
    Constant1Alpha = 14,
    Texture0Blue = 15,
    Texture1Blue = 16,
    Texture2Blue = 17,
    Texture3Blue = 18,
    VertexColor0Blue = 19,
    VertexColor1Blue = 20,
    Scratch0Blue = 21,
    Scratch1Blue = 22,
    Constant0Blue = 23,
    Constant1Blue = 24,
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum FramebufferFadeMode {
    None = 0,
    FadeWhenPerpendicular = 1,
    FadeWhenParallel = 2,
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum FramebufferBlendFunction {
    AlphaBlend = 0,
    Multiply = 1,
    DoubleMultiply = 2,
    Add = 3,
    Subtract = 4,
    ComponentMin = 5,
    ComponentMax = 6,
    AlphaMultiplyAdd = 7,
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum ShaderTransparentGenericMapType {
    Map2D = 0,
    ReflectionCubeMap = 1,
    ObjectCenteredCubeMap = 2,
    ViewerCenteredCubeMap = 3,
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum RadiosityDetailLevel {
    High = 0,
    Medium = 1,
    Low = 2,
    Turd = 3, // smh
}

#[wasm_bindgen(js_name = "HaloShaderModel")]
#[derive(Debug, Clone, DekuRead)]
pub struct ShaderModel {
    pub radiosity_flags: u16,
    pub radiosity_detail_level: RadiosityDetailLevel,
    pub radiosity_light_power: f32,
    pub radiosity_light_color: ColorRGB,
    pub radiosity_tint_color: ColorRGB,
    #[deku(pad_bytes_before = "8")]
    pub flags: u16,
    #[deku(pad_bytes_before = "14")]
    pub translucency: f32,
    #[deku(pad_bytes_before = "54")]
    pub animation_function: AnimationFunction,
    pub animation_period: f32,
    pub animation_color_lower_bound: ColorRGB,
    pub animation_color_upper_bound: ColorRGB,
    #[deku(pad_bytes_before = "12")]
    pub map_u_scale: f32,
    pub map_v_scale: f32,
    pub base_map: TagDependency,
    #[deku(pad_bytes_before = "8")]
    pub multipurpose_map: TagDependency,
    #[deku(pad_bytes_before = "8")]
    pub detail_function: DetailBitmapFunction,
    pub detail_mask: DetailBitmapMask,
    pub detail_map_scale: f32,
    pub detail_map: TagDependency,
    pub detail_map_v_scale: f32,
    #[deku(pad_bytes_before = "12")]
    pub u_animation_source: FunctionSource,
    pub u_animation_function: AnimationFunction,
    pub u_animation_period: f32,
    pub u_animation_phase: f32,
    pub u_animation_scale: f32,
    pub v_animation_source: FunctionSource,
    pub v_animation_function: AnimationFunction,
    pub v_animation_period: f32,
    pub v_animation_phase: f32,
    pub v_animation_scale: f32,
    pub rotation_animation_source: FunctionSource,
    pub rotation_animation_function: AnimationFunction,
    pub rotation_animation_period: f32,
    pub rotation_animation_phase: f32,
    pub rotation_animation_scale: f32,
    pub rotation_animation_center: Point2D,
    #[deku(pad_bytes_before = "8")]
    pub reflection_falloff_distance: f32,
    pub reflection_cutoff_distance: f32,
    pub perpendicular_brightness: f32,
    pub perpendicular_tint_color: ColorRGB,
    pub parallel_brightness: f32,
    pub parallel_tint_color: ColorRGB,
    #[deku(pad_bytes_after = "68")]
    pub reflection_cube_map: TagDependency,
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum AnimationFunction {
    One = 0x0,
    Zero = 0x1,
    Cosine = 0x2,
    CosineVariablePeriod = 0x3,
    DiagonalWave = 0x4,
    DiagonalWaveVariablePeriod = 0x5,
    Slide = 0x6,
    SlideVariablePeriod = 0x7,
    Noise = 0x8,
    Jitter = 0x9,
    Wander = 0xA,
    Spark = 0xB,
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum DetailBitmapMask {
    None = 0x0,
    ReflectionMaskInverse = 0x1,
    ReflectionMask = 0x2,
    SelfIlluminationMaskInverse = 0x3,
    SelfIlluminationMask = 0x4,
    ChangeColorMaskInverse = 0x5,
    ChangeColorMask = 0x6,
    AuxiliaryMaskInverse = 0x7,
    AuxiliaryMask = 0x8,
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum FunctionSource {
    None = 0,
    A = 1,
    B = 2,
    C = 3,
    D = 4,
}

#[wasm_bindgen(js_name = "HaloShaderEnvironment")]
#[derive(Debug, Clone, DekuRead)]
pub struct ShaderEnvironment {
    pub radiosity_flags: u16,
    pub radiosity_detail_level: RadiosityDetailLevel,
    pub radiosity_light_power: f32,
    pub radiosity_light_color: ColorRGB,
    pub radiosity_tint_color: ColorRGB,
    #[deku(pad_bytes_before = "8")]
    pub flags: u16,
    pub shader_environment_type: ShaderEnvironmentType,
    pub lens_flare_spacing: f32,
    pub lens_flare: TagDependency,
    #[deku(pad_bytes_before = "44")]
    pub diffuse_flags: u16,
    #[deku(pad_bytes_before = "26")]
    pub base_bitmap: TagDependency,
    #[deku(pad_bytes_before = "24")]
    pub detail_bitmap_function: DetailBitmapFunction,
    #[deku(pad_bytes_before = "2")]
    pub primary_detail_bitmap_scale: f32,
    pub primary_detail_bitmap: TagDependency,
    pub secondary_detail_bitmap_scale: f32,
    pub secondary_detail_bitmap: TagDependency,
    #[deku(pad_bytes_before = "24")]
    pub micro_detail_bitmap_function: DetailBitmapFunction,
    #[deku(pad_bytes_before = "2")]
    pub micro_detail_bitmap_scale: f32,
    pub micro_detail_bitmap: TagDependency,
    pub material_color: ColorRGB,
    #[deku(pad_bytes_before = "12")]
    pub bump_map_scale: f32,
    pub bump_map: TagDependency,
    #[deku(pad_bytes_before = "324")]
    pub specular_flags: u16,
    #[deku(pad_bytes_before = "18")]
    pub brightness: f32,
    #[deku(pad_bytes_before = "20")]
    pub perpendicular_color: ColorRGB,
    pub parallel_color: ColorRGB,
    #[deku(pad_bytes_before = "16")]
    pub reflection_flags: u16,
    pub reflection_type: ShaderEnvironmentReflectionType,
    pub lightmap_brightness_scale: f32,
    #[deku(pad_bytes_before = "28")]
    pub perpendicular_brightness: f32,
    pub parallel_brightness: f32,
    #[deku(pad_bytes_before = "40")]
    pub reflection_cube_map: TagDependency,
}

#[wasm_bindgen]
#[derive(Copy, Clone, Debug, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum ShaderEnvironmentReflectionType {
    BumpedCubeMap = 0,
    FlatCubeMap = 1,
    BumpedRadiosity = 2,
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum DetailBitmapFunction {
    DoubleBiasedMultiply = 0,
    Multiply = 1,
    DoubleBiasedAdd = 2,
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum ShaderEnvironmentType {
    Normal = 0,
    Blended = 1,
    BlendedBaseSpecular = 2,
}

#[wasm_bindgen(js_name = "HaloShaderTransparentWaterRipple")]
#[derive(Debug, Clone, DekuRead)]
pub struct ShaderTransparentWaterRipple {
    #[deku(pad_bytes_before = "4")]
    pub contribution_factor: f32,
    #[deku(pad_bytes_before = "32")]
    pub animation_angle: f32,
    pub animation_velocity: f32,
    pub map_u_offset: f32,
    pub map_v_offset: f32,
    pub map_repeats: u16,
    #[deku(pad_bytes_after = "16")]
    pub map_index: u16,
}

#[wasm_bindgen(js_name = "HaloShaderTransparentWater")]
#[derive(Debug, Clone, DekuRead)]
pub struct ShaderTransparentWater {
    pub radiosity_flags: u16,
    pub radiosity_detail_level: RadiosityDetailLevel,
    pub radiosity_light_power: f32,
    pub radiosity_light_color: ColorRGB,
    pub radiosity_tint_color: ColorRGB,
    #[deku(pad_bytes_before = "8")]
    pub flags: u16,
    #[deku(pad_bytes_before = "34")]
    pub base_bitmap: TagDependency,
    #[deku(pad_bytes_before = "16")]
    pub view_perpendicular_brightness: f32,
    pub view_perpendicular_tint_color: ColorRGB,
    pub view_parallel_brightness: f32,
    pub view_parallel_tint_color: ColorRGB,
    #[deku(pad_bytes_before = "16")]
    pub reflection_bitmap: TagDependency,
    #[deku(pad_bytes_before = "16")]
    pub ripple_animation_angle: f32,
    pub ripple_animation_velocity: f32,
    pub ripple_scale: f32,
    pub ripple_bitmap: TagDependency,
    pub ripple_mipmap_levels: u16,
    #[deku(pad_bytes_before = "2")]
    pub ripple_mipmap_fade_factor: f32,
    pub ripple_mipmap_detail_bias: f32,
    #[deku(pad_bytes_before = "64", pad_bytes_after = "16")]
    pub(crate) ripples: Block<ShaderTransparentWaterRipple>, // max of 4
}

#[wasm_bindgen(js_class = "HaloShaderTransparentWater")]
impl ShaderTransparentWater {
    pub fn get_ripples(&self) -> Vec<ShaderTransparentWaterRipple> {
        self.ripples.items.as_ref().cloned().unwrap()
    }
}
