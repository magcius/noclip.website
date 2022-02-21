

extern crate console_error_panic_hook;

use wasm_bindgen::prelude::wasm_bindgen;

use crate::unity::reader::AssetReader;
use crate::unity::asset::AssetInfo;

pub mod asset;
pub mod reader;
pub mod mesh;
pub mod version;
pub mod bitstream;
pub mod texture2d;

#[wasm_bindgen]
pub struct AssetMetadataArray {
    pub length: usize,
    data: Vec<AssetMetadata>,
}

#[wasm_bindgen]
impl AssetMetadataArray {
    pub fn get(&self, i: usize) -> AssetMetadata {
        self.data[i].clone()
    }
}

#[wasm_bindgen(getter_with_clone)]
#[derive(Debug, Clone)]
pub struct AssetMetadata {
    pub offset: usize,
    pub size: usize,
    pub name: String,
}

#[wasm_bindgen]
pub fn get_asset_metadata(asset: &AssetInfo, data: Vec<u8>, class_id: i32) -> AssetMetadataArray {
    console_error_panic_hook::set_once();

    let mut reader = AssetReader::new(data);
    reader.set_endianness(asset.header.endianness);
    let mut asset_metadatas: Vec<AssetMetadata> = asset.objects.iter()
        .filter(|obj| obj.class_id == class_id)
        .map(|obj| AssetMetadata {
            offset: obj.byte_start as usize,
            size: obj.byte_size as usize,
            name: String::new(),
        })
        .collect();
    for asset in asset_metadatas.iter_mut() {
        reader.seek(std::io::SeekFrom::Start(asset.offset as u64)).unwrap();
        asset.name = reader.read_char_array().unwrap();
    }
    AssetMetadataArray {
        length: asset_metadatas.len(),
        data: asset_metadatas,
    }
}
