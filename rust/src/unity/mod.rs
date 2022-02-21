use wasm_bindgen::prelude::wasm_bindgen;

use crate::unity::reader::AssetReader;
use crate::unity::asset::AssetInfo;

pub mod asset;
pub mod reader;
pub mod mesh;
pub mod version;
pub mod bitstream;

#[wasm_bindgen]
pub struct MeshMetadataArray {
    pub length: usize,
    data: Vec<MeshMetadata>,
}

#[wasm_bindgen]
impl MeshMetadataArray {
    pub fn get(&self, i: usize) -> MeshMetadata {
        self.data[i].clone()
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct MeshMetadata {
    pub offset: usize,
    pub size: usize,
    name: String,
}

#[wasm_bindgen]
impl MeshMetadata {
    pub fn get_name(&self) -> String {
        self.name.clone()
    }
}

#[wasm_bindgen]
pub fn get_mesh_metadata(asset: &AssetInfo, data: Vec<u8>) -> MeshMetadataArray {
    let mut reader = AssetReader::new(data);
    reader.set_endianness(asset.header.endianness);
    let mut mesh_data: Vec<MeshMetadata> = asset.objects.iter()
        .filter(|obj| obj.class_id == 43)
        .map(|obj| MeshMetadata {
            offset: obj.byte_start as usize,
            size: obj.byte_size as usize,
            name: String::new(),
        })
        .collect();
    for mesh in mesh_data.iter_mut() {
        reader.seek(std::io::SeekFrom::Start(mesh.offset as u64)).unwrap();
        mesh.name = reader.read_char_array().unwrap();
    }
    MeshMetadataArray {
        length: mesh_data.len(),
        data: mesh_data,
    }
}
