
use wasm_bindgen::prelude::wasm_bindgen;
use crate::unity::asset::*;
use crate::unity::mesh::{ Vec2f };
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
struct UnityShaderSerializedTextureProperty {
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
struct UnityShaderSerializedProperty {
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

pub struct UnityShaderSerializedSubShader {
}

#[wasm_bindgen(getter_with_clone)]
#[derive(Debug)]
pub struct UnityShader {
    pub name: String,
    _props: Vec<UnityShaderSerializedProperty>,
}

impl Deserialize for UnityShader {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        let name = reader.read_char_array()?;

        // SerializedShader
        let props = UnityShaderSerializedProperty::deserialize_array(reader, asset)?;
        // let sub_shaders = UnityShaderSerializedSubShader::deserialize_array(reader, asset)?;
        // let keyword_data = UnityShaderKeywordNames::deserialize(reader, asset)?;

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
