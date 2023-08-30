
use wasm_bindgen::prelude::wasm_bindgen;
use crate::unity::asset::*;
use crate::unity::mesh::Vec2f;
use crate::unity::reader::*;

#[wasm_bindgen(getter_with_clone)]
#[derive(Debug)]
pub struct UnityMaterial {
    pub name: String,
    pub shader: PPtr,
    pub keywords: String,
    pub saved_properties: UnityPropertySheet,
}

impl Deserialize for UnityMaterial {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        let name = reader.read_char_array()?;
        let shader = PPtr::deserialize(reader, asset)?;
        let keywords = reader.read_char_array()?;

        let _lightmap_flags = reader.read_u32()?;
        let _enable_instancing_variants = reader.read_bool()?;
        let _double_sided_gi = reader.read_bool()?;
        reader.align()?;

        let _custom_render_queue = reader.read_i32()?;

        type StringTagMap = Map<String, String>;
        let _string_tag_map = StringTagMap::deserialize(reader, asset)?;
        let _disabled_shader_passes = String::deserialize_array(reader, asset)?;

        let saved_properties = UnityPropertySheet::deserialize(reader, asset)?;

        Ok(UnityMaterial {
            name, shader, keywords, saved_properties,
        })
    }
}

#[wasm_bindgen]
impl UnityMaterial {
    pub fn from_bytes(data: Vec<u8>, asset: &AssetInfo) -> std::result::Result<UnityMaterial, String> {
        let mut reader = AssetReader::new(data);
        reader.set_endianness(asset.header.endianness);
        UnityMaterial::deserialize(&mut reader, asset).map_err(|err| format!("{:?}", err))
    }
}

#[derive(Debug, Clone)]
#[wasm_bindgen]
pub struct ColorRGBAf {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

impl Deserialize for ColorRGBAf {
    fn deserialize(reader: &mut AssetReader, _asset: &AssetInfo) -> Result<Self> {
        Ok(ColorRGBAf{
            r: reader.read_f32()?,
            g: reader.read_f32()?,
            b: reader.read_f32()?,
            a: reader.read_f32()?,
        })
    }
}

#[derive(Debug, Clone)]
#[wasm_bindgen]
pub struct UnityTexEnv {
    pub texture: PPtr,
    pub scale: Vec2f,
    pub offset: Vec2f,
}

impl Deserialize for UnityTexEnv {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        let texture = PPtr::deserialize(reader, asset)?;
        let scale = Vec2f::deserialize(reader, asset)?;
        let offset = Vec2f::deserialize(reader, asset)?;
        Ok(UnityTexEnv{ texture, offset, scale })
    }
}

#[derive(Debug, Clone)]
#[wasm_bindgen]
pub struct UnityPropertySheet {
    tex_envs: Map<String, UnityTexEnv>,
    floats: Map<String, f32>,
    colors: Map<String, ColorRGBAf>,
}

#[wasm_bindgen]
impl UnityPropertySheet {
    pub fn get_tex_env_count(&self) -> usize {
        self.tex_envs.keys.len()
    }

    pub fn get_tex_env_name(&self, idx: usize) -> String {
        self.tex_envs.keys[idx].clone()
    }

    pub fn get_tex_env(&self, idx: usize) -> Option<UnityTexEnv> {
        Some(self.tex_envs.vals[idx].clone())
    }

    pub fn find_tex_env(&self, name: String) -> Option<UnityTexEnv> {
        self.tex_envs.find(name)
    }

    pub fn get_float_count(&self) -> usize {
        self.floats.keys.len()
    }

    pub fn get_float_name(&self, idx: usize) -> String {
        self.floats.keys[idx].clone()
    }

    pub fn get_float(&self, idx: usize) -> f32 {
        self.floats.vals[idx]
    }

    pub fn get_color_count(&self) -> usize {
        self.colors.keys.len()
    }

    pub fn get_color_name(&self, idx: usize) -> String {
        self.colors.keys[idx].clone()
    }

    pub fn get_color(&self, idx: usize) -> ColorRGBAf {
        self.colors.vals[idx].clone()
    }
}

impl Deserialize for UnityPropertySheet {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        type TexEnvMap = Map<String, UnityTexEnv>;
        let tex_envs = TexEnvMap::deserialize(reader, asset)?;

        type FloatMap = Map<String, f32>;
        let floats = FloatMap::deserialize(reader, asset)?;

        type ColorMap = Map<String, ColorRGBAf>;
        let colors = ColorMap::deserialize(reader, asset)?;
        Ok(UnityPropertySheet{ tex_envs, floats, colors })
    }
}

#[derive(Debug)]
pub struct UnityShaderSerializedTextureProperty {
    pub name: String,
    pub dimension: u32,
}

impl Deserialize for UnityShaderSerializedTextureProperty {
    fn deserialize(reader: &mut AssetReader, _asset: &AssetInfo) -> Result<Self> {
        let name = reader.read_char_array()?;
        let dimension = reader.read_u32()?;

        Ok(UnityShaderSerializedTextureProperty {
            name, dimension,
        })
    }
}

#[derive(Debug)]
pub struct UnityShaderSerializedProperty {
    pub name: String,
    pub description: String,
    pub attributes: Vec<String>,
    pub prop_type: u32,
    pub flags: u32,
    pub def_value: [f32; 4],
    pub def_texture: UnityShaderSerializedTextureProperty,
}

impl Deserialize for UnityShaderSerializedProperty {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        let name = reader.read_char_array()?;
        let description = reader.read_char_array()?;
        let attributes = String::deserialize_array(reader, asset)?;
        let prop_type = reader.read_u32()?;
        let flags = reader.read_u32()?;
        let def_value = [reader.read_f32()?, reader.read_f32()?, reader.read_f32()?, reader.read_f32()?];
        let def_texture = UnityShaderSerializedTextureProperty::deserialize(reader, asset)?;

        Ok(UnityShaderSerializedProperty {
            name, description, attributes, prop_type, flags, def_value, def_texture,
        })
    }
}

#[derive(Debug)]
pub struct UnityHash128 {
    pub hash: [u32; 4],
}

impl Deserialize for UnityHash128 {
    fn deserialize(reader: &mut AssetReader, _asset: &AssetInfo) -> Result<Self> {
        let hash = [
            reader.read_u32()?,
            reader.read_u32()?,
            reader.read_u32()?,
            reader.read_u32()?,
        ];
        Ok(UnityHash128{ hash })
    }
}

#[derive(Debug)]
pub struct UnityShaderSerializedFloatValue {
    pub value: f32,
    pub name: String,
}

impl Deserialize for UnityShaderSerializedFloatValue {
    fn deserialize(reader: &mut AssetReader, _asset: &AssetInfo) -> Result<Self> {
        let value = reader.read_f32()?;
        let name = reader.read_char_array()?;
        Ok(UnityShaderSerializedFloatValue { value, name })
    }
}

#[derive(Debug)]
pub struct UnityShaderSerializedVectorValue {
    pub x: UnityShaderSerializedFloatValue,
    pub y: UnityShaderSerializedFloatValue,
    pub z: UnityShaderSerializedFloatValue,
    pub w: UnityShaderSerializedFloatValue,
    pub name: String,
}

impl Deserialize for UnityShaderSerializedVectorValue {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        let x = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let y = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let z = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let w = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let name = reader.read_char_array()?;
        Ok(UnityShaderSerializedVectorValue { x, y, z, w, name })
    }
}

pub struct UnityShaderSerializedStencilOp {
    pub pass: UnityShaderSerializedFloatValue,
    pub fail: UnityShaderSerializedFloatValue,
    pub z_fail: UnityShaderSerializedFloatValue,
    pub comp: UnityShaderSerializedFloatValue,
}

impl Deserialize for UnityShaderSerializedStencilOp {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        let pass = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let fail = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let z_fail = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let comp = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        Ok(UnityShaderSerializedStencilOp { pass, fail, z_fail, comp })
    }
}

#[derive(Debug)]
pub struct UnityShaderRTBlendState {
    pub src_blend: UnityShaderSerializedFloatValue,
    pub dst_blend: UnityShaderSerializedFloatValue,
    pub src_blend_alpha: UnityShaderSerializedFloatValue,
    pub dst_blend_alpha: UnityShaderSerializedFloatValue,
    pub blend_op: UnityShaderSerializedFloatValue,
    pub blend_op_alpha: UnityShaderSerializedFloatValue,
    pub color_mask: UnityShaderSerializedFloatValue,
}

impl Deserialize for UnityShaderRTBlendState {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        let src_blend = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let dst_blend = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let src_blend_alpha = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let dst_blend_alpha = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let blend_op = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let blend_op_alpha = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let color_mask = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        Ok(UnityShaderRTBlendState {
            src_blend, dst_blend, src_blend_alpha, dst_blend_alpha, blend_op, blend_op_alpha, color_mask,
        })
    }
}

#[derive(Debug)]
pub struct UnityShaderBindChannel {
    pub source: i8,
    pub target: i8,
}

impl Deserialize for UnityShaderBindChannel {
    fn deserialize(reader: &mut AssetReader, _asset: &AssetInfo) -> Result<Self> {
        let source = reader.read_i8()?;
        let target = reader.read_i8()?;
        Ok(UnityShaderBindChannel { source, target })
    }
}

#[derive(Debug)]
pub struct UnityShaderVectorParameter {
    pub name_index: i32,
    pub index: i32,
    pub array_size: i32,
    pub type_: i8,
    pub dim: i8,
}

impl Deserialize for UnityShaderVectorParameter {
    fn deserialize(reader: &mut AssetReader, _asset: &AssetInfo) -> Result<Self> {
        let name_index = reader.read_i32()?;
        let index = reader.read_i32()?;
        let array_size = reader.read_i32()?;
        let type_ = reader.read_i8()?;
        let dim = reader.read_i8()?;
        Ok(UnityShaderVectorParameter { name_index, index, array_size, type_, dim })
    }
}

#[derive(Debug)]
pub struct UnityShaderMatrixParameter {
    pub name_index: i32,
    pub index: i32,
    pub array_size: i32,
    pub type_: i8,
    pub row_count: i8,
}

impl Deserialize for UnityShaderMatrixParameter {
    fn deserialize(reader: &mut AssetReader, _asset: &AssetInfo) -> Result<Self> {
        let name_index = reader.read_i32()?;
        let index = reader.read_i32()?;
        let array_size = reader.read_i32()?;
        let type_ = reader.read_i8()?;
        let row_count = reader.read_i8()?;
        Ok(UnityShaderMatrixParameter { name_index, index, array_size, type_, row_count })
    }
}

#[derive(Debug)]
pub struct UnityShaderTextureParameter {
    pub name_index: i32,
    pub index: i32,
    pub sampler_index: i32,
    pub multi_sampled: bool,
    pub dim: i8,
}

impl Deserialize for UnityShaderTextureParameter {
    fn deserialize(reader: &mut AssetReader, _asset: &AssetInfo) -> Result<Self> {
        let name_index = reader.read_i32()?;
        let index = reader.read_i32()?;
        let sampler_index = reader.read_i32()?;
        let multi_sampled = reader.read_bool()?;
        let dim = reader.read_i8()?;
        Ok(UnityShaderTextureParameter { name_index, index, sampler_index, multi_sampled, dim })
    }
}

#[derive(Debug)]
pub struct UnityShaderBufferBinding {
    pub name_index: i32,
    pub index: i32,
    pub array_size: i32,
}

impl Deserialize for UnityShaderBufferBinding {
    fn deserialize(reader: &mut AssetReader, _asset: &AssetInfo) -> Result<Self> {
        let name_index = reader.read_i32()?;
        let index = reader.read_i32()?;
        let array_size = reader.read_i32()?;
        Ok(UnityShaderBufferBinding { name_index, index, array_size })
    }
}

#[derive(Debug)]
pub struct UnityShaderStructParameter {
    pub name_index: i32,
    pub index: i32,
    pub array_size: i32,
    pub struct_size: i32,
    pub vector_members: Vec<UnityShaderVectorParameter>,
    pub matrix_members: Vec<UnityShaderMatrixParameter>,
}

impl Deserialize for UnityShaderStructParameter {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        let name_index = reader.read_i32()?;
        let index = reader.read_i32()?;
        let array_size = reader.read_i32()?;
        let struct_size = reader.read_i32()?;
        let vector_members = UnityShaderVectorParameter::deserialize_array(reader, asset)?;
        let matrix_members = UnityShaderMatrixParameter::deserialize_array(reader, asset)?;
        Ok(UnityShaderStructParameter { name_index, index, array_size, struct_size, vector_members, matrix_members, })
    }
}

#[derive(Debug)]
pub struct UnityShaderConstantBuffer {
    pub name_index: i32,
    pub matrix_params: Vec<UnityShaderMatrixParameter>,
    pub vector_params: Vec<UnityShaderVectorParameter>,
    pub struct_params: Vec<UnityShaderStructParameter>,
    pub size: i32,
    pub is_partial_cb: bool,
}

impl Deserialize for UnityShaderConstantBuffer {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        let name_index = reader.read_i32()?;
        let matrix_params = UnityShaderMatrixParameter::deserialize_array(reader, asset)?;
        let vector_params = UnityShaderVectorParameter::deserialize_array(reader, asset)?;
        let struct_params = UnityShaderStructParameter::deserialize_array(reader, asset)?;
        let size = reader.read_i32()?;
        let is_partial_cb = reader.read_bool()?;
        Ok(UnityShaderConstantBuffer { name_index, matrix_params, vector_params, struct_params, size, is_partial_cb, })
    }
}

#[derive(Debug)]
pub struct UnityShaderUAVParameter {
    pub name_index: i32,
    pub index: i32,
    pub original_index: i32,
}

impl Deserialize for UnityShaderUAVParameter {
    fn deserialize(reader: &mut AssetReader, _asset: &AssetInfo) -> Result<Self> {
        let name_index = reader.read_i32()?;
        let index = reader.read_i32()?;
        let original_index = reader.read_i32()?;
        Ok(UnityShaderUAVParameter { name_index, index, original_index })
    }
}

#[derive(Debug)]
pub struct UnityShaderSamplerParameter {
    pub sampler: u32,
    pub bind_point: i32,
}

impl Deserialize for UnityShaderSamplerParameter {
    fn deserialize(reader: &mut AssetReader, _asset: &AssetInfo) -> Result<Self> {
        let sampler = reader.read_u32()?;
        let bind_point = reader.read_i32()?;
        Ok(UnityShaderSamplerParameter { sampler, bind_point })
    }
}

#[derive(Debug)]
pub struct UnityShaderSerializedProgramParameters {
    pub vector_params: Vec<UnityShaderVectorParameter>,
    pub matrix_params: Vec<UnityShaderMatrixParameter>,
    pub texture_params: Vec<UnityShaderTextureParameter>,
    pub buffer_params: Vec<UnityShaderBufferBinding>,
    pub constant_buffers: Vec<UnityShaderConstantBuffer>,
    pub constant_buffer_bindings: Vec<UnityShaderBufferBinding>,
    pub uav_params: Vec<UnityShaderUAVParameter>,
    pub samplers: Vec<UnityShaderSamplerParameter>,
}

impl Deserialize for UnityShaderSerializedProgramParameters {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        let vector_params = UnityShaderVectorParameter::deserialize_array(reader, asset)?;
        let matrix_params = UnityShaderMatrixParameter::deserialize_array(reader, asset)?;
        let texture_params = UnityShaderTextureParameter::deserialize_array(reader, asset)?;
        let buffer_params = UnityShaderBufferBinding::deserialize_array(reader, asset)?;
        let constant_buffers = UnityShaderConstantBuffer::deserialize_array(reader, asset)?;
        let constant_buffer_bindings = UnityShaderBufferBinding::deserialize_array(reader, asset)?;
        let uav_params = UnityShaderUAVParameter::deserialize_array(reader, asset)?;
        let samplers = UnityShaderSamplerParameter::deserialize_array(reader, asset)?;
        Ok(UnityShaderSerializedProgramParameters { vector_params, matrix_params, texture_params, buffer_params, constant_buffers, constant_buffer_bindings, uav_params, samplers, })
    }
}

#[derive(Debug)]
pub struct UnityShaderSerializedSubProgram {
}

impl Deserialize for UnityShaderSerializedSubProgram {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        let _blob_index = reader.read_u32();
        let _channels = UnityShaderBindChannel::deserialize_array(reader, asset)?;
        let _channel_source_map = reader.read_i32()?;
        let _global_keyword_indices = i16::deserialize_array(reader, asset)?;
        let _local_keyword_indices = i16::deserialize_array(reader, asset)?;
        let _shader_hardware_tier = reader.read_i8()?;
        let _gpu_program_type = reader.read_i8()?;
        reader.align()?;
        let _parameters = UnityShaderSerializedProgramParameters::deserialize(reader, asset)?;
        let _shader_requirements = reader.read_i32()?;
        Ok(UnityShaderSerializedSubProgram { })
    }
}

#[derive(Debug)]
pub struct UnityShaderSerializedProgram {
}

impl Deserialize for UnityShaderSerializedProgram {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        let _sub_programs = UnityShaderSerializedSubProgram::deserialize_array(reader, asset)?;
        let _common_parameters = UnityShaderSerializedProgramParameters::deserialize(reader, asset)?;
        Ok(UnityShaderSerializedProgram { })
    }
}

#[derive(Debug)]
pub struct UnityShaderSerializedPass {
    pub shader_type: i32,
    pub use_name: String,
    pub name: String,
    pub texture_name: String,
}

impl Deserialize for UnityShaderSerializedPass {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        let _editor_data_hash = UnityHash128::deserialize_array(reader, asset)?;
        let _platforms = reader.read_byte_array()?;
        reader.align()?;

        let _local_keyword_mask = u16::deserialize_array(reader, asset)?;
        let _global_keyword_mask = u16::deserialize_array(reader, asset)?;

        type NameIndicesMap = Map<String, i32>;
        let _name_indices = NameIndicesMap::deserialize(reader, asset)?;
        let shader_type = reader.read_i32()?;

        // SerializedShaderState
        let _shader_state_name = reader.read_char_array()?;

        let _rt_blend_state = [
            UnityShaderRTBlendState::deserialize(reader, asset)?,
            UnityShaderRTBlendState::deserialize(reader, asset)?,
            UnityShaderRTBlendState::deserialize(reader, asset)?,
            UnityShaderRTBlendState::deserialize(reader, asset)?,
            UnityShaderRTBlendState::deserialize(reader, asset)?,
            UnityShaderRTBlendState::deserialize(reader, asset)?,
            UnityShaderRTBlendState::deserialize(reader, asset)?,
            UnityShaderRTBlendState::deserialize(reader, asset)?,
        ];
        let _rt_separate_blend = reader.read_bool()?;
        reader.align()?;
        let _z_clip = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let _z_test = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let _z_write = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let _culling = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let _conservative = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let _offset_factor = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let _offset_units = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let _alpha_to_mask = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let _stencil_op = UnityShaderSerializedStencilOp::deserialize(reader, asset)?;
        let _stencil_op_front = UnityShaderSerializedStencilOp::deserialize(reader, asset)?;
        let _stencil_op_back = UnityShaderSerializedStencilOp::deserialize(reader, asset)?;
        let _stencil_read_mask = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let _stencil_write_mask = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let _stencil_ref = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let _fog_start = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let _fog_end = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let _fog_density = UnityShaderSerializedFloatValue::deserialize(reader, asset)?;
        let _fog_color = UnityShaderSerializedVectorValue::deserialize(reader, asset)?;
        let _fog_mode = reader.read_i32()?;
        let _gpu_program_id = reader.read_i32()?;

        type StringTagMap = Map<String, String>;
        let _shader_state_tags = StringTagMap::deserialize(reader, asset)?;
        let _shader_state_lod = reader.read_i32()?;
        let _shader_state_lighting = reader.read_bool()?;
        reader.align()?;

        let _program_mask = reader.read_i32()?;
        let _program_vertex = UnityShaderSerializedProgram::deserialize(reader, asset)?;
        let _program_fragment = UnityShaderSerializedProgram::deserialize(reader, asset)?;
        let _program_geometry = UnityShaderSerializedProgram::deserialize(reader, asset)?;
        let _program_hull = UnityShaderSerializedProgram::deserialize(reader, asset)?;
        let _program_domain = UnityShaderSerializedProgram::deserialize(reader, asset)?;
        let _program_rt = UnityShaderSerializedProgram::deserialize(reader, asset)?;
        let _has_instancing_variant = reader.read_bool()?;
        let _has_procedural_instancing_variant = reader.read_bool()?;
        reader.align()?;
        let use_name = reader.read_char_array()?;
        let name = reader.read_char_array()?;
        let texture_name = reader.read_char_array()?;
        let _tags = StringTagMap::deserialize(reader, asset)?;

        Ok(UnityShaderSerializedPass { shader_type, use_name, name, texture_name })
    }
}

pub struct UnityShaderSerializedSubShader {
}

impl Deserialize for UnityShaderSerializedSubShader {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        let _passes = UnityShaderSerializedPass::deserialize_array(reader, asset)?;

        type StringTagMap = Map<String, String>;
        let _tags = StringTagMap::deserialize(reader, asset)?;
        let _lod = reader.read_i32()?;

        Ok(UnityShaderSerializedSubShader { })
    }
}

pub struct UnityShaderDependency {
    pub from: String,
    pub to: String,
}

impl Deserialize for UnityShaderDependency {
    fn deserialize(reader: &mut AssetReader, _asset: &AssetInfo) -> Result<Self> {
        let from = reader.read_char_array()?;
        let to = reader.read_char_array()?;
        Ok(UnityShaderDependency { from, to })
    }
}

#[wasm_bindgen(getter_with_clone)]
#[derive(Debug)]
pub struct UnityShader {
    pub name: String,
    _props: Vec<UnityShaderSerializedProperty>,
}

impl Deserialize for UnityShader {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        let _name = reader.read_char_array()?; // This is a fake name. The real name is from the SerializedShader.

        // SerializedShader m_ParsedForm
        let props = UnityShaderSerializedProperty::deserialize_array(reader, asset)?;
        let _sub_shaders = UnityShaderSerializedSubShader::deserialize_array(reader, asset)?;
        let name = reader.read_char_array()?;
        let _custom_editor_name = reader.read_char_array()?;
        let _fallback_name = reader.read_char_array()?;
        let _dependencies = UnityShaderDependency::deserialize_array(reader, asset)?;

        // Platforms, Offsets, CompressedLengths, DecompressedLengths, CompressedBlob, Dependencies, NonModifiabletextures, ShaderIsBaked

        Ok(UnityShader {
            name,
            _props: props,
        })
    }
}

#[wasm_bindgen]
impl UnityShader {
    pub fn from_bytes(data: Vec<u8>, asset: &AssetInfo) -> std::result::Result<UnityShader, String> {
        let mut reader = AssetReader::new(data);
        reader.set_endianness(asset.header.endianness);
        UnityShader::deserialize(&mut reader, asset).map_err(|err| format!("{:?}", err))
    }
}
