use wasm_bindgen::prelude::wasm_bindgen;

use crate::unity::reader::AssetReader;
use crate::unity::asset::Asset;

pub mod asset;
pub mod reader;
pub mod mesh;
pub mod version;
pub mod bitstream;

#[wasm_bindgen]
pub struct MeshDataArray {
    pub length: usize,
    data: Vec<MeshData>,
}

#[wasm_bindgen]
impl MeshDataArray {
    pub fn get(&self, i: usize) -> MeshData {
        self.data[i].clone()
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct MeshData {
    pub offset: usize,
    pub size: usize,
    name: String,
}

#[wasm_bindgen]
impl MeshData {
    pub fn get_name(&self) -> String {
        self.name.clone()
    }
}

#[wasm_bindgen]
pub fn get_mesh_data(asset: &Asset, data: Vec<u8>) -> MeshDataArray {
    let mut reader = AssetReader::new(data);
    let mut mesh_data: Vec<MeshData> = asset.objects.iter()
        .filter(|obj| obj.class_id == 43)
        .map(|obj| MeshData {
            offset: obj.byte_start as usize,
            size: obj.byte_size as usize,
            name: String::new(),
        })
        .collect();
    for mesh in mesh_data.iter_mut() {
        reader.seek(std::io::SeekFrom::Start(mesh.offset as u64)).unwrap();
        mesh.name = reader.read_char_array().unwrap();
    }
    MeshDataArray {
        length: mesh_data.len(),
        data: mesh_data,
    }
}