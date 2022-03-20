
use wasm_bindgen::prelude::wasm_bindgen;
use crate::unity::asset::*;
use crate::unity::reader::*;

#[wasm_bindgen(getter_with_clone)]
#[derive(Debug)]
pub struct UnityMaterial {
    pub name: String,
    pub shader: PPtr,
}

impl Deserialize for UnityMaterial {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        let name = reader.read_char_array()?;
        let shader = PPtr::deserialize(reader, asset)?;

        Ok(UnityMaterial {
            name,
            shader,
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

#[derive(Debug)]
struct UnityShaderSerializedTextureProperty {
    pub name: String,
    pub dimension: u32,
}

impl Deserialize for UnityShaderSerializedTextureProperty {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<UnityShaderSerializedTextureProperty> {
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
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<UnityShaderSerializedProperty> {
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
