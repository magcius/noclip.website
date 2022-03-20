
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

#[wasm_bindgen(getter_with_clone)]
#[derive(Debug)]
pub struct UnityShader {
    pub name: String,
}

impl Deserialize for UnityShader {
    fn deserialize(reader: &mut AssetReader, _asset: &AssetInfo) -> Result<Self> {
        let name = reader.read_char_array()?;

        Ok(UnityShader {
            name,
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
