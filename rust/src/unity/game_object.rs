use wasm_bindgen::prelude::wasm_bindgen;

use crate::unity::reader::*;
use crate::unity::asset::AssetInfo;

#[wasm_bindgen]
struct Component {
    pub file_index: u32,
    pub path_id: u64,
}

impl Deserialize for Component {
    fn deserialize(reader: &mut AssetReader, _asset: &AssetInfo) -> Result<Self> {
        let file_index = reader.read_u32()?;
        assert_eq!(file_index, 0); // not sure what this means if > 0

        let path_id = reader.read_u64()?;
        Ok(Component { file_index, path_id })
    }
}

#[wasm_bindgen]
struct GameObject {
    components: Vec<Component>,
    pub layer: u32,
    name: String,
    pub is_active: bool,
}

impl Deserialize for GameObject {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        Ok(GameObject {
            components: Component::deserialize_array(reader, asset)?,
            layer: reader.read_u32()?,
            name: reader.read_char_array()?,
            is_active: reader.read_bool()?,
        })
    }
}

#[wasm_bindgen]
impl GameObject {
    pub fn get_name(&self) -> String {
        self.name.clone()
    }
}