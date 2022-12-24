use std::{io::{Cursor, Seek, SeekFrom}, convert::TryFrom};


use wasm_bindgen::prelude::*;
use byteorder::LittleEndian;
use byteorder::ReadBytesExt;
use num_enum::TryFromPrimitive;
use super::tag::*;
use super::common::*;

#[derive(Debug, Clone)]
pub struct ShaderTransparentChicago {
    // shader properties
    pub radiosity_flags: u16,
    pub radiosity_detail_level: RadiosityDetailLevel,
    pub radiosity_light_power: f32,
    pub radiosity_light_color: ColorRGB,
    pub radiosity_tint_color: ColorRGB,

    pub numeric_counter_limit: u8,
    pub flags: u8,
    pub first_map_type: ShaderTransparentGenericMapType,
    pub framebuffer_blend_function: FramebufferBlendFunction,
    pub framebuffer_fade_mode: FramebufferFadeMode,
    pub framebuffer_fade_source: FunctionSource,
    pub lens_flare_spacing: f32,
    pub lens_flare: TagDependency,
    pub extra_layers: Block<TagDependency>, // only chicago transparent shaders allowed here
    pub maps: Block<ShaderTransparentChicagoMap>, // max of 4
}

impl Deserialize for ShaderTransparentChicago {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let mut start = data.position();
        let radiosity_flags = data.read_u16::<LittleEndian>()?;
        let radiosity_detail_level = RadiosityDetailLevel::try_from(data.read_u16::<LittleEndian>()?)?;
        let radiosity_light_power = data.read_f32::<LittleEndian>()?;
        let radiosity_light_color = ColorRGB::deserialize(data)?;
        let radiosity_tint_color = ColorRGB::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 40))?;
        start = data.position();
        let numeric_counter_limit = data.read_u8()?;
        let flags = data.read_u8()?;
        let first_map_type = ShaderTransparentGenericMapType::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let framebuffer_blend_function = FramebufferBlendFunction::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let framebuffer_fade_mode = FramebufferFadeMode::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let framebuffer_fade_source = FunctionSource::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        data.seek(SeekFrom::Start(start + 12))?;
        let lens_flare_spacing = data.read_f32::<LittleEndian>()?;
        let lens_flare = TagDependency::deserialize(data)?;
        let extra_layers: Block<TagDependency> = Block::deserialize(data)?;
        let maps: Block<ShaderTransparentChicagoMap> = Block::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 66))?;
        Ok(ShaderTransparentChicago { radiosity_flags, radiosity_detail_level, radiosity_light_power, radiosity_light_color, radiosity_tint_color, numeric_counter_limit, flags, first_map_type, framebuffer_blend_function, framebuffer_fade_mode, framebuffer_fade_source, lens_flare_spacing, lens_flare, extra_layers, maps })
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, TryFromPrimitive)]
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

#[derive(Debug, Clone)]
pub struct ShaderTransparentChicagoMap {
    pub flags: u16,
    pub color_function: ShaderTransparentChicagoColorFunction,
    pub alpha_function: ShaderTransparentChicagoColorFunction,
    pub map_u_scale: f32,
    pub map_v_scale: f32,
    pub map_u_offset: f32,
    pub map_v_offset: f32,
    pub map_rotation: f32,
    pub mipmap_bias: f32,
    pub map: TagDependency,
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

impl Deserialize for ShaderTransparentChicagoMap {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let start = data.position();
        let flags = data.read_u16::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 44))?;
        let color_function = ShaderTransparentChicagoColorFunction::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let alpha_function = ShaderTransparentChicagoColorFunction::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        data.seek(SeekFrom::Start(start + 84))?;
        let map_u_scale = data.read_f32::<LittleEndian>()?;
        let map_v_scale = data.read_f32::<LittleEndian>()?;
        let map_u_offset = data.read_f32::<LittleEndian>()?;
        let map_v_offset = data.read_f32::<LittleEndian>()?;
        let map_rotation = data.read_f32::<LittleEndian>()?;
        let mipmap_bias = data.read_f32::<LittleEndian>()?;
        let map = TagDependency::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 164))?;
        let u_animation_source = FunctionSource::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let u_animation_function = AnimationFunction::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let u_animation_period = data.read_f32::<LittleEndian>()?;
        let u_animation_phase = data.read_f32::<LittleEndian>()?;
        let u_animation_scale = data.read_f32::<LittleEndian>()?;
        let v_animation_source = FunctionSource::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let v_animation_function = AnimationFunction::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let v_animation_period = data.read_f32::<LittleEndian>()?;
        let v_animation_phase = data.read_f32::<LittleEndian>()?;
        let v_animation_scale = data.read_f32::<LittleEndian>()?;
        let rotation_animation_source = FunctionSource::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let rotation_animation_function = AnimationFunction::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let rotation_animation_period = data.read_f32::<LittleEndian>()?;
        let rotation_animation_phase = data.read_f32::<LittleEndian>()?;
        let rotation_animation_scale = data.read_f32::<LittleEndian>()?;
        let rotation_animation_center = Point2D::deserialize(data)?;
        Ok(ShaderTransparentChicagoMap {
            flags,
            color_function,
            alpha_function,
            map_u_scale,
            map_v_scale,
            map_u_offset,
            map_v_offset,
            map_rotation,
            mipmap_bias,
            map,
            u_animation_source,
            u_animation_function,
            u_animation_period,
            u_animation_phase,
            u_animation_scale,
            v_animation_source,
            v_animation_function,
            v_animation_period,
            v_animation_phase,
            v_animation_scale,
            rotation_animation_source,
            rotation_animation_function,
            rotation_animation_period,
            rotation_animation_phase,
            rotation_animation_scale,
            rotation_animation_center,
        })
    }
}

#[derive(Debug, Clone)]
pub struct ShaderTransparentGeneric {
    // shader properties
    pub radiosity_flags: u16,
    pub radiosity_detail_level: RadiosityDetailLevel,
    pub radiosity_light_power: f32,
    pub radiosity_light_color: ColorRGB,
    pub radiosity_tint_color: ColorRGB,

    pub numeric_counter_limit: u8,
    pub flags: u8,
    pub first_map_type: ShaderTransparentGenericMapType,
    pub framebuffer_blend_function: FramebufferBlendFunction,
    pub framebuffer_fade_mode: FramebufferFadeMode,
    pub framebuffer_fade_source: FunctionSource,
    pub lens_flare_spacing: f32,
    pub lens_flare: TagDependency,
    pub extra_layers: Block<TagDependency>, // max of 4
    pub maps: Block<ShaderTransparentGenericMap>, // max of 4
    pub stages: Block<ShaderTransparentGenericStage>, // max of 7
}

impl Deserialize for ShaderTransparentGeneric {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let mut start = data.position();
        let radiosity_flags = data.read_u16::<LittleEndian>()?;
        let radiosity_detail_level = RadiosityDetailLevel::try_from(data.read_u16::<LittleEndian>()?)?;
        let radiosity_light_power = data.read_f32::<LittleEndian>()?;
        let radiosity_light_color = ColorRGB::deserialize(data)?;
        let radiosity_tint_color = ColorRGB::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 40))?;
        start = data.position();
        let numeric_counter_limit = data.read_u8()?;
        let flags = data.read_u8()?;
        let first_map_type = ShaderTransparentGenericMapType::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let framebuffer_blend_function = FramebufferBlendFunction::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let framebuffer_fade_mode = FramebufferFadeMode::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let framebuffer_fade_source = FunctionSource::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        data.seek(SeekFrom::Start(start + 12))?;
        let lens_flare_spacing = data.read_f32::<LittleEndian>()?;
        let lens_flare = TagDependency::deserialize(data)?;
        let extra_layers: Block<TagDependency> = Block::deserialize(data)?;
        let maps: Block<ShaderTransparentGenericMap> = Block::deserialize(data)?;
        let stages: Block<ShaderTransparentGenericStage> = Block::deserialize(data)?;
        Ok(ShaderTransparentGeneric { radiosity_flags, radiosity_detail_level, radiosity_light_power, radiosity_light_color, radiosity_tint_color, numeric_counter_limit, flags, first_map_type, framebuffer_blend_function, framebuffer_fade_mode, framebuffer_fade_source, lens_flare_spacing, lens_flare, extra_layers, maps, stages })
    }
}

#[derive(Debug, Clone)]
pub struct ShaderTransparentGenericMap {
    pub flags: u16,
    pub map_u_scale: f32,
    pub map_v_scale: f32,
    pub map_u_offset: f32,
    pub map_v_offset: f32,
    pub map_rotation: f32,
    pub mipmap_bias: f32,
    pub map: TagDependency,
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

impl Deserialize for ShaderTransparentGenericMap {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let start = data.position();
        let flags = data.read_u16::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 4))?;
        let map_u_scale = data.read_f32::<LittleEndian>()?;
        let map_v_scale = data.read_f32::<LittleEndian>()?;
        let map_u_offset = data.read_f32::<LittleEndian>()?;
        let map_v_offset = data.read_f32::<LittleEndian>()?;
        let map_rotation = data.read_f32::<LittleEndian>()?;
        let map_bias = data.read_f32::<LittleEndian>()?;
        let map = TagDependency::deserialize(data)?;
        let u_animation_source = FunctionSource::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let u_animation_function = AnimationFunction::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let u_animation_period = data.read_f32::<LittleEndian>()?;
        let u_animation_phase = data.read_f32::<LittleEndian>()?;
        let u_animation_scale = data.read_f32::<LittleEndian>()?;
        let v_animation_source = FunctionSource::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let v_animation_function = AnimationFunction::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let v_animation_period = data.read_f32::<LittleEndian>()?;
        let v_animation_phase = data.read_f32::<LittleEndian>()?;
        let v_animation_scale = data.read_f32::<LittleEndian>()?;
        let rotation_animation_source = FunctionSource::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let rotation_animation_function = AnimationFunction::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let rotation_animation_period = data.read_f32::<LittleEndian>()?;
        let rotation_animation_phase = data.read_f32::<LittleEndian>()?;
        let rotation_animation_scale = data.read_f32::<LittleEndian>()?;
        let rotation_animation_center = Point2D::deserialize(data)?;
        Ok(ShaderTransparentGenericMap {
            flags,
            map_u_scale,
            map_v_scale,
            map_u_offset,
            map_v_offset,
            map_rotation,
            mipmap_bias: map_bias,
            map,
            u_animation_source,
            u_animation_function,
            u_animation_period,
            u_animation_phase,
            u_animation_scale,
            v_animation_source,
            v_animation_function,
            v_animation_period,
            v_animation_phase,
            v_animation_scale,
            rotation_animation_source,
            rotation_animation_function,
            rotation_animation_period,
            rotation_animation_phase,
            rotation_animation_scale,
            rotation_animation_center,
        })
    }
}

#[derive(Debug, Clone)]
pub struct ShaderTransparentGenericStage {
    pub flags: u16,
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

impl Deserialize for ShaderTransparentGenericStage {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let start = data.position();
        let flags = data.read_u16::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 4))?;
        let color0_source = FunctionSource::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let color0_animation_function = AnimationFunction::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let color0_animation_period = data.read_f32::<LittleEndian>()?;
        let color0_animation_lower_bound = ColorARGB::deserialize(data)?;
        let color0_animation_upper_bound = ColorARGB::deserialize(data)?;
        let color1 = ColorARGB::deserialize(data)?;
        let input_a = ShaderInput::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let input_a_mapping = ShaderMapping::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let input_b = ShaderInput::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let input_b_mapping = ShaderMapping::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let input_c = ShaderInput::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let input_c_mapping = ShaderMapping::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let input_d = ShaderInput::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let input_d_mapping = ShaderMapping::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let output_ab = ShaderOutput::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let output_ab_function = ShaderOutputFunction::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let output_cd = ShaderOutput::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let output_cd_function = ShaderOutputFunction::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let output_ab_cd_mux_sum = ShaderOutput::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let output_mapping_color = ShaderOutputMapping::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let input_a_alpha = ShaderAlphaInput::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let input_a_mapping_alpha = ShaderMapping::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let input_b_alpha = ShaderAlphaInput::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let input_b_mapping_alpha = ShaderMapping::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let input_c_alpha = ShaderAlphaInput::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let input_c_mapping_alpha = ShaderMapping::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let input_d_alpha = ShaderAlphaInput::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let input_d_mapping_alpha = ShaderMapping::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let output_ab_alpha = ShaderOutput::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let output_cd_alpha = ShaderOutput::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let output_ab_cd_mux_sum_alpha = ShaderOutput::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        let output_mapping_alpha = ShaderOutputMapping::try_from_primitive(data.read_u16::<LittleEndian>()?)?;
        Ok(ShaderTransparentGenericStage { flags, color0_source, color0_animation_function, color0_animation_period, color0_animation_lower_bound, color0_animation_upper_bound, color1, input_a, input_a_mapping, input_b, input_b_mapping, input_c, input_c_mapping, input_d, input_d_mapping, output_ab, output_ab_function, output_cd, output_cd_function, output_ab_cd_mux_sum, output_mapping_color, input_a_alpha, input_a_mapping_alpha, input_b_alpha, input_b_mapping_alpha, input_c_alpha, input_c_mapping_alpha, input_d_alpha, input_d_mapping_alpha, output_ab_alpha, output_cd_alpha, output_ab_cd_mux_sum_alpha, output_mapping_alpha })
    }
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone, TryFromPrimitive)]
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
#[derive(Debug, Copy, Clone, TryFromPrimitive)]
#[repr(u16)]
pub enum ShaderOutputFunction {
    Multiply = 0,
    DotProduct = 1,
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone, TryFromPrimitive)]
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
#[derive(Debug, Copy, Clone, TryFromPrimitive)]
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
#[derive(Debug, Copy, Clone, TryFromPrimitive)]
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
#[derive(Debug, Copy, Clone, TryFromPrimitive)]
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
#[derive(Debug, Copy, Clone, TryFromPrimitive)]
#[repr(u16)]
pub enum FramebufferFadeMode {
    None = 0,
    FadeWhenPerpendicular = 1,
    FadeWhenParallel = 2,
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone, TryFromPrimitive)]
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
#[derive(Debug, Copy, Clone, TryFromPrimitive)]
#[repr(u16)]
pub enum ShaderTransparentGenericMapType {
    Map2D = 0,
    ReflectionCubeMap = 1,
    ObjectCenteredCubeMap = 2,
    ViewerCenteredCubeMap = 3,
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone, TryFromPrimitive)]
#[repr(u16)]
pub enum RadiosityDetailLevel {
    High = 0,
    Medium = 1,
    Low = 2,
    Turd = 3, // smh
}

#[derive(Debug, Clone)]
pub struct ShaderModel {
    // shader properties
    pub radiosity_flags: u16,
    pub radiosity_detail_level: RadiosityDetailLevel,
    pub radiosity_light_power: f32,
    pub radiosity_light_color: ColorRGB,
    pub radiosity_tint_color: ColorRGB,
    
    // shader model properties
    pub flags: u16,
    pub translucency: f32,
    pub animation_function: AnimationFunction,
    pub animation_period: f32,
    pub animation_color_lower_bound: ColorRGB,
    pub animation_color_upper_bound: ColorRGB,
    pub map_u_scale: f32,
    pub map_v_scale: f32,
    pub base_map: TagDependency,
    pub multipurpose_map: TagDependency,
    pub detail_function: DetailBitmapFunction,
    pub detail_mask: DetailBitmapMask,
    pub detail_map_scale: f32,
    pub detail_map: TagDependency,
    pub detail_map_v_scale: f32,
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
    pub reflection_falloff_distance: f32,
    pub reflection_cutoff_distance: f32,
    pub perpendicular_brightness: f32,
    pub perpendicular_tint_color: ColorRGB,
    pub parallel_brightness: f32,
    pub parallel_tint_color: ColorRGB,
    pub reflection_cube_map: TagDependency,
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone, TryFromPrimitive)]
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
#[derive(Debug, Copy, Clone, TryFromPrimitive)]
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
#[derive(Debug, Copy, Clone, TryFromPrimitive)]
#[repr(u16)]
pub enum FunctionSource {
    None = 0,
    A = 1,
    B = 2,
    C = 3,
    D = 4,
}

impl Deserialize for ShaderModel {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let mut start = data.position();
        let radiosity_flags = data.read_u16::<LittleEndian>()?;
        let radiosity_detail_level = RadiosityDetailLevel::try_from(data.read_u16::<LittleEndian>()?)?;
        let radiosity_light_power = data.read_f32::<LittleEndian>()?;
        let radiosity_light_color = ColorRGB::deserialize(data)?;
        let radiosity_tint_color = ColorRGB::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 40))?;
        start = data.position();
        let flags = data.read_u16::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 16))?;
        let translucency = data.read_f32::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 74))?;
        let animation_function = AnimationFunction::try_from(data.read_u16::<LittleEndian>()?)?;
        let animation_period = data.read_f32::<LittleEndian>()?;
        let animation_color_lower_bound = ColorRGB::deserialize(data)?;
        let animation_color_upper_bound = ColorRGB::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 116))?;
        let map_u_scale = data.read_f32::<LittleEndian>()?;
        let map_v_scale = data.read_f32::<LittleEndian>()?;
        let base_map = TagDependency::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 148))?;
        let multipurpose_map = TagDependency::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 172))?;
        let detail_function = DetailBitmapFunction::try_from(data.read_u16::<LittleEndian>()?)?;
        let detail_mask = DetailBitmapMask::try_from(data.read_u16::<LittleEndian>()?)?;
        let detail_map_scale = data.read_f32::<LittleEndian>()?;
        let detail_map = TagDependency::deserialize(data)?;
        let detail_map_v_scale = data.read_f32::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 212))?;
        let u_animation_source = FunctionSource::try_from(data.read_u16::<LittleEndian>()?)?;
        let u_animation_function = AnimationFunction::try_from(data.read_u16::<LittleEndian>()?)?;
        let u_animation_period = data.read_f32::<LittleEndian>()?;
        let u_animation_phase = data.read_f32::<LittleEndian>()?;
        let u_animation_scale = data.read_f32::<LittleEndian>()?;
        let v_animation_source = FunctionSource::try_from(data.read_u16::<LittleEndian>()?)?;
        let v_animation_function = AnimationFunction::try_from(data.read_u16::<LittleEndian>()?)?;
        let v_animation_period = data.read_f32::<LittleEndian>()?;
        let v_animation_phase = data.read_f32::<LittleEndian>()?;
        let v_animation_scale = data.read_f32::<LittleEndian>()?;
        let rotation_animation_source = FunctionSource::try_from(data.read_u16::<LittleEndian>()?)?;
        let rotation_animation_function = AnimationFunction::try_from(data.read_u16::<LittleEndian>()?)?;
        let rotation_animation_period = data.read_f32::<LittleEndian>()?;
        let rotation_animation_phase = data.read_f32::<LittleEndian>()?;
        let rotation_animation_scale = data.read_f32::<LittleEndian>()?;
        let rotation_animation_center = Point2D::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 276))?;
        let reflection_falloff_distance = data.read_f32::<LittleEndian>()?;
        let reflection_cutoff_distance = data.read_f32::<LittleEndian>()?;
        let perpendicular_brightness = data.read_f32::<LittleEndian>()?;
        let perpendicular_tint_color = ColorRGB::deserialize(data)?;
        let parallel_brightness = data.read_f32::<LittleEndian>()?;
        let parallel_tint_color = ColorRGB::deserialize(data)?;
        let reflection_cube_map = TagDependency::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 400))?;
        Ok(ShaderModel {
            radiosity_flags,
            radiosity_detail_level,
            radiosity_light_power,
            radiosity_light_color,
            radiosity_tint_color,
            flags,
            translucency,
            animation_function,
            animation_period,
            animation_color_lower_bound,
            animation_color_upper_bound,
            map_u_scale,
            map_v_scale,
            base_map,
            multipurpose_map,
            detail_function,
            detail_mask,
            detail_map_scale,
            detail_map,
            detail_map_v_scale,
            u_animation_source,
            u_animation_function,
            u_animation_period,
            u_animation_phase,
            u_animation_scale,
            v_animation_source,
            v_animation_function,
            v_animation_period,
            v_animation_phase,
            v_animation_scale,
            rotation_animation_source,
            rotation_animation_function,
            rotation_animation_period,
            rotation_animation_phase,
            rotation_animation_scale,
            rotation_animation_center,
            reflection_falloff_distance,
            reflection_cutoff_distance,
            perpendicular_brightness,
            perpendicular_tint_color,
            parallel_brightness,
            parallel_tint_color,
            reflection_cube_map,
        })
    }
}

#[derive(Debug, Clone)]
pub struct ShaderEnvironment {
    // shader properties
    pub radiosity_flags: u16,
    pub radiosity_detail_level: RadiosityDetailLevel,
    pub radiosity_light_power: f32,
    pub radiosity_light_color: ColorRGB,
    pub radiosity_tint_color: ColorRGB,

    // shader environment properties
    pub flags: u16,
    pub shader_environment_type: ShaderEnvironmentType,
    pub lens_flare_spacing: f32,
    pub lens_flare: TagDependency,
    pub diffuse_flags: u16,
    pub base_bitmap: TagDependency,
    pub detail_bitmap_function: DetailBitmapFunction,
    pub primary_detail_bitmap_scale: f32,
    pub primary_detail_bitmap: TagDependency,
    pub secondary_detail_bitmap_scale: f32,
    pub secondary_detail_bitmap: TagDependency,
    pub micro_detail_scale: f32,
    pub micro_detail_bitmap_function: DetailBitmapFunction,
    pub micro_detail_bitmap: TagDependency,
    pub material_color: ColorRGB,
    pub bump_map_scale: f32,
    pub bump_map: TagDependency,
    pub specular_flags: u16,
    pub brightness: f32,
    pub perpendicular_color: ColorRGB,
    pub parallel_color: ColorRGB,
    pub reflection_flags: u16,
    pub reflection_type: ShaderEnvironmentReflectionType,
    pub lightmap_brightness_scale: f32,
    pub perpendicular_brightness: f32,
    pub parallel_brightness: f32,
    pub reflection_cube_map: TagDependency,
}

#[wasm_bindgen]
#[derive(Copy, Clone, Debug, TryFromPrimitive)]
#[repr(u16)]
pub enum ShaderEnvironmentReflectionType {
    BumpedCubeMap = 0,
    FlatCubeMap = 1,
    BumpedRadiosity = 2,
}

impl Deserialize for ShaderEnvironment {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let mut start = data.position();
        let radiosity_flags = data.read_u16::<LittleEndian>()?;
        let radiosity_detail_level = RadiosityDetailLevel::try_from(data.read_u16::<LittleEndian>()?)?;
        let radiosity_light_power = data.read_f32::<LittleEndian>()?;
        let radiosity_light_color = ColorRGB::deserialize(data)?;
        let radiosity_tint_color = ColorRGB::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 40))?;
        start = data.position();
        let flags = data.read_u16::<LittleEndian>()?;
        let shader_environment_type = ShaderEnvironmentType::try_from(data.read_u16::<LittleEndian>()?)?;
        let lens_flare_spacing = data.read_f32::<LittleEndian>()?;
        let lens_flare = TagDependency::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 68))?;
        let diffuse_flags = data.read_u16::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 96))?;
        let base_bitmap = TagDependency::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 136))?;
        let detail_bitmap_function = DetailBitmapFunction::try_from(data.read_u16::<LittleEndian>()?)?;
        data.seek(SeekFrom::Start(start + 140))?;
        let primary_detail_bitmap_scale = data.read_f32::<LittleEndian>()?;
        let primary_detail_bitmap = TagDependency::deserialize(data)?;
        let secondary_detail_bitmap_scale = data.read_f32::<LittleEndian>()?;
        let secondary_detail_bitmap = TagDependency::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 204))?;
        let micro_detail_bitmap_function = DetailBitmapFunction::try_from(data.read_u16::<LittleEndian>()?)?;
        data.seek(SeekFrom::Start(start + 208))?;
        let micro_detail_scale = data.read_f32::<LittleEndian>()?;
        let micro_detail_bitmap = TagDependency::deserialize(data)?;
        let material_color = ColorRGB::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 252))?;
        let bump_map_scale = data.read_f32::<LittleEndian>()?;
        let bump_map = TagDependency::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 596))?;
        let specular_flags = data.read_u16::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 616))?;
        let brightness = data.read_f32::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 640))?;
        let perpendicular_color = ColorRGB::deserialize(data)?;
        let parallel_color = ColorRGB::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 680))?;
        let reflection_flags = data.read_u16::<LittleEndian>()?;
        let reflection_type = ShaderEnvironmentReflectionType::try_from(data.read_u16::<LittleEndian>()?)?;
        let lightmap_brightness_scale = data.read_f32::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 716))?;
        let perpendicular_brightness = data.read_f32::<LittleEndian>()?;
        let parallel_brightness = data.read_f32::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 764))?;
        let reflection_cube_map = TagDependency::deserialize(data)?;
        Ok(ShaderEnvironment {
            radiosity_flags,
            radiosity_detail_level,
            radiosity_light_power,
            radiosity_light_color,
            radiosity_tint_color,
            flags,
            shader_environment_type,
            lens_flare_spacing,
            lens_flare,
            diffuse_flags,
            base_bitmap,
            detail_bitmap_function,
            primary_detail_bitmap_scale,
            primary_detail_bitmap,
            secondary_detail_bitmap_scale,
            secondary_detail_bitmap,
            micro_detail_scale,
            micro_detail_bitmap_function,
            micro_detail_bitmap,
            material_color,
            bump_map_scale,
            bump_map,
            specular_flags,
            brightness,
            perpendicular_color,
            parallel_color,
            reflection_flags,
            reflection_type,
            lightmap_brightness_scale,
            perpendicular_brightness,
            parallel_brightness,
            reflection_cube_map,
        })
    }
}

#[wasm_bindgen]
#[derive(Debug, TryFromPrimitive, Copy, Clone)]
#[repr(u16)]
pub enum DetailBitmapFunction {
    DoubleBiasedMultiply = 0,
    Multiply = 1,
    DoubleBiasedAdd = 2,
}

#[wasm_bindgen]
#[derive(Debug, TryFromPrimitive, Copy, Clone)]
#[repr(u16)]
pub enum ShaderEnvironmentType {
    Normal = 0,
    Blended = 1,
    BlendedBaseSpecular = 2,
}

#[derive(Debug, Clone)]
pub struct ShaderTransparentWaterRipple {
    pub contribution_factor: f32,
    pub animation_angle: f32,
    pub animation_velocity: f32,
    pub map_u_offset: f32,
    pub map_v_offset: f32,
    pub map_repeats: u16,
    pub map_index: u16,
}

impl Deserialize for ShaderTransparentWaterRipple {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        data.seek(SeekFrom::Current(2 + 2))?;
        let contribution_factor = data.read_f32::<LittleEndian>()?;
        data.seek(SeekFrom::Current(32))?;
        let animation_angle = data.read_f32::<LittleEndian>()?;
        let animation_velocity = data.read_f32::<LittleEndian>()?;
        let map_u_offset = data.read_f32::<LittleEndian>()?;
        let map_v_offset = data.read_f32::<LittleEndian>()?;
        let map_repeats = data.read_u16::<LittleEndian>()?;
        let map_index = data.read_u16::<LittleEndian>()?;
        data.seek(SeekFrom::Current(16))?;
        Ok(ShaderTransparentWaterRipple {
            contribution_factor,
            animation_angle,
            animation_velocity,
            map_u_offset,
            map_v_offset,
            map_repeats,
            map_index,
        })
    }
}

#[derive(Debug, Clone)]
pub struct ShaderTransparentWater {
    // shader properties
    pub radiosity_flags: u16,
    pub radiosity_detail_level: RadiosityDetailLevel,
    pub radiosity_light_power: f32,
    pub radiosity_light_color: ColorRGB,
    pub radiosity_tint_color: ColorRGB,

    pub flags: u16,
    pub base_bitmap: TagDependency,
    pub view_perpendicular_brightness: f32,
    pub view_perpendicular_tint_color: ColorRGB,
    pub view_parallel_brightness: f32,
    pub view_parallel_tint_color: ColorRGB,
    pub reflection_bitmap: TagDependency,
    pub ripple_animation_angle: f32,
    pub ripple_animation_velocity: f32,
    pub ripple_scale: f32,
    pub ripple_bitmap: TagDependency,
    pub ripple_mipmap_levels: u16,
    pub ripple_mipmap_fade_factor: f32,
    pub ripple_mipmap_detail_bias: f32,
    pub ripples: Block<ShaderTransparentWaterRipple>, // max of 4
}

impl Deserialize for ShaderTransparentWater {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let start = data.position();
        let radiosity_flags = data.read_u16::<LittleEndian>()?;
        let radiosity_detail_level = RadiosityDetailLevel::try_from(data.read_u16::<LittleEndian>()?)?;
        let radiosity_light_power = data.read_f32::<LittleEndian>()?;
        let radiosity_light_color = ColorRGB::deserialize(data)?;
        let radiosity_tint_color = ColorRGB::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 40))?;
        let flags = dbg!(data.read_u16::<LittleEndian>()?);
        data.seek(SeekFrom::Current(2 + 32))?;
        let base_bitmap = dbg!(TagDependency::deserialize(data)?);
        data.seek(SeekFrom::Current(16))?;
        let view_perpendicular_brightness = data.read_f32::<LittleEndian>()?;
        let view_perpendicular_tint_color = ColorRGB::deserialize(data)?;
        let view_parallel_brightness = data.read_f32::<LittleEndian>()?;
        let view_parallel_tint_color = ColorRGB::deserialize(data)?;
        data.seek(SeekFrom::Current(16))?;
        let reflection_bitmap = TagDependency::deserialize(data)?;
        data.seek(SeekFrom::Current(16))?;
        let ripple_animation_angle = data.read_f32::<LittleEndian>()?;
        let ripple_animation_velocity = data.read_f32::<LittleEndian>()?;
        let ripple_scale = data.read_f32::<LittleEndian>()?;
        let ripple_bitmap = TagDependency::deserialize(data)?;
        let ripple_mipmap_levels = data.read_u16::<LittleEndian>()?;
        data.seek(SeekFrom::Current(2))?;
        let ripple_mipmap_fade_factor = data.read_f32::<LittleEndian>()?;
        let ripple_mipmap_detail_bias = data.read_f32::<LittleEndian>()?;
        data.seek(SeekFrom::Current(64))?;
        let ripples: Block<ShaderTransparentWaterRipple> = Block::deserialize(data)?;
        data.seek(SeekFrom::Current(16))?;
        Ok(ShaderTransparentWater {
            radiosity_flags,
            radiosity_detail_level,
            radiosity_light_power,
            radiosity_light_color,
            radiosity_tint_color,
            flags,
            base_bitmap,
            view_perpendicular_brightness,
            view_perpendicular_tint_color,
            view_parallel_brightness,
            view_parallel_tint_color,
            reflection_bitmap,
            ripple_animation_angle,
            ripple_animation_velocity,
            ripple_scale,
            ripple_bitmap,
            ripple_mipmap_levels,
            ripple_mipmap_fade_factor,
            ripple_mipmap_detail_bias,
            ripples,
        })
    }
}
