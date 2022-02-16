use wasm_bindgen::prelude::wasm_bindgen;

use crate::unity::mesh::*;
use crate::unity::reader::*;
use crate::unity::asset::*;

pub mod asset;
pub mod reader;
pub mod mesh;
pub mod version;
pub mod bitstream;

#[wasm_bindgen]
pub struct MeshDatabase {
    reader: AssetReader,
    asset: Option<Asset>,
    mesh_offsets: Option<Vec<u64>>,
}

#[wasm_bindgen]
impl MeshDatabase {
    pub fn new(asset_data: Vec<u8>) -> MeshDatabase {
        MeshDatabase {
            reader: AssetReader::new(asset_data),
            asset: None,
            mesh_offsets: None,
        }
    }

    pub fn read(&mut self) {
        self.asset = Some(self.reader.read_asset().unwrap());
        self.mesh_offsets = Some(self.get_mesh_offsets())
    }

    fn get_mesh_offsets(&self) -> Vec<u64> {
        match self.asset.as_ref() {
            Some(asset) => asset.objects.iter()
                .filter(|obj| obj.class_id == 43) // Mesh = 43
                .map(|obj| obj.byte_start as u64)
                .collect(),
            None => vec![],
        }
    }
 
    pub fn count_meshes(&self) -> usize {
        self.mesh_offsets.as_ref().unwrap().len()
    }

    pub fn get_mesh_name(&mut self, i: usize) -> String {
        let offs = self.mesh_offsets.as_ref().unwrap()[i];
        self.reader.seek(std::io::SeekFrom::Start(offs as u64)).unwrap();
        self.reader.read_char_array().unwrap()
    }

    pub fn load_mesh(&mut self, i: usize) -> Mesh {
        let offs = self.mesh_offsets.as_ref().unwrap()[i];
        self.reader.seek(std::io::SeekFrom::Start(offs as u64)).unwrap();
        Mesh::deserialize(&mut self.reader, &self.asset.as_ref().unwrap()).unwrap()
    }
}