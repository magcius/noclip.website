use deku::bitvec::BitSlice;
use deku::{DekuContainerRead, DekuRead};
use wasm_bindgen::prelude::*;

use crate::unity::types::wasm::WasmFriendlyPPtr;
use crate::unity::types::class_id::ClassID;
use crate::unity::types::serialized_file::{SerializedFileHeader, SerializedFileMetadata};

#[wasm_bindgen(js_name = "UnityAssetFile")]
pub struct AssetFile {
    header: SerializedFileHeader,
    metadata_offset: usize,
    metadata: Option<SerializedFileMetadata>,
}

#[wasm_bindgen(js_class = "UnityAssetFile")]
impl AssetFile {
    pub fn initialize_with_header_chunk(data: &[u8]) -> Result<AssetFile, String> {
        match SerializedFileHeader::from_bytes((data, 0)) {
            Ok(((rest, _), header)) => {
                let header_size = data.len() - rest.len();
                assert_eq!(header.endianness, 0); // we're always expecting little endian files
                Ok(Self {
                    header,
                    metadata_offset: header_size,
                    metadata: None,
                })
            },
            Err(err) => Err(format!("failed to parse header: {:?}", err)),
        }
    }

    pub fn get_data_offset(&self) -> u64 {
        match self.header.large_files_data_offset {
            Some(offset) => offset as u64,
            None => self.header.data_offset as u64,
        }
    }

    pub fn append_metadata_chunk(&mut self, data: &[u8]) -> Result<(), String> {
        // data will be the file from bytes 0..data_offset, so skip to where the metadata starts
        let bitslice = BitSlice::from_slice(data);
        let (rest, _) = SerializedFileHeader::read(&bitslice, ()).unwrap();
        match SerializedFileMetadata::read(rest, self.header.version) {
            Ok((_, metadata)) => self.metadata = Some(metadata),
            Err(err) => return Err(format!("failed to parse metadata: {:?}", err)),
        }
        Ok(())
    }

    pub fn get_version_string(&self) -> String {
        self.get_metadata().version_ascii.clone().into()
    }

    fn get_metadata(&self) -> &SerializedFileMetadata {
        self.metadata.as_ref().expect("must call AssetFile.append_metadata_chunk()")
    }

    pub fn get_objects(&self) -> Vec<AssetFileObject> {
        let metadata = self.get_metadata();
        let mut result = Vec::new();
        for obj in &metadata.objects {
            let byte_start = self.get_data_offset() as i64 + obj.get_byte_start();
            let class_id = if obj.serialized_type_index >= 0 {
                match metadata.type_tree.get(obj.serialized_type_index as usize) {
                    Some(obj_type) => {
                        // println!("{}: got actual type {:?}", obj.file_id, obj_type.header.raw_type_id);
                        obj_type.header.raw_type_id
                    },
                    None => {
                        println!("{}: bogus type: index {}, len {}", obj.file_id, obj.serialized_type_index, metadata.type_tree.len());
                        ClassID::UnknownType
                    }
                }
            } else {
                println!("{}: type defaulting to MonoBehavior", obj.file_id);
                ClassID::MonoBehavior
            };
            result.push(AssetFileObject {
                file_id:obj.file_id,
                byte_start,
                byte_size: obj.byte_size as usize,
                class_id,
            });
        }
        result
    }

    pub fn get_external_path(&self, pptr: &WasmFriendlyPPtr) -> Option<String> {
        let idx = pptr.file_index as usize - 1;
        let metadata = self.get_metadata();
        metadata.externals.values
            .get(idx)
            .map(|external_file| (&external_file.path_name_ascii).into())
    }
}

#[wasm_bindgen(js_name = "UnityAssetFileObject")]
pub struct AssetFileObject {
    pub file_id: i64,
    pub byte_start: i64,
    pub byte_size: usize,
    pub class_id: ClassID,
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::str::FromStr;

    use crate::unity::types::common::UnityVersion;
    use crate::unity::types::wasm::{Texture2D, Mesh, MeshFilter, MeshRenderer, Transform, Material};

    use super::*;

    #[test]
    fn test() {
        let base_path = PathBuf::from_str("C:\\Users\\ifnsp\\dev\\noclip.website\\data\\AShortHike").unwrap();
        let data = std::fs::read(&base_path.join("resources.assets")).unwrap();
        let version = UnityVersion::V2021_3_27f1;
        let mut asset_file = AssetFile::initialize_with_header_chunk(&data).unwrap();
        dbg!(&asset_file.header);
        asset_file.append_metadata_chunk(&data).unwrap();
        let metadata = asset_file.metadata.as_ref().unwrap();

        let mut ext_files = Vec::new();
        for ext in &metadata.externals.values {
            let ext_name: String = ext.path_name_ascii.clone().into();
            let ext_path = base_path.join(&ext_name);
            let Ok(ext_data) = std::fs::read(&ext_path) else {
                println!("couldn't read {:?}", ext_path);
                continue;
            };
            let mut ext_file = AssetFile::initialize_with_header_chunk(&ext_data).unwrap();
            ext_file.append_metadata_chunk(&ext_data).unwrap();
            println!("{:?}: v{}", ext_path, ext_file.header.version);
            ext_file.get_objects();
            println!("successfully read {:?}", ext_path);
            ext_files.push(ext_file);
        }

        for obj in asset_file.get_objects() {
            let data = &data[obj.byte_start as usize..obj.byte_start as usize + obj.byte_size];
            match obj.class_id {
                ClassID::Transform => {
                    Transform::create(version, data).unwrap();
                },
                ClassID::RectTransform => {
                    Transform::create(version, data).unwrap();
                },
                ClassID::MeshFilter => {
                    MeshFilter::create(version, data).unwrap();
                },
                ClassID::Mesh => {
                    Mesh::create(version, data).unwrap();
                },
                ClassID::MeshRenderer => {
                    MeshRenderer::create(version, data).unwrap();
                },
                ClassID::Material => {
                    Material::create(version, data).unwrap();
                },
                ClassID::Texture2D => {
                    println!("parsing Texture2D {}", obj.file_id);
                    Texture2D::create(version, data).unwrap();
                },
                _ => {},
            }
        }
    }
}
