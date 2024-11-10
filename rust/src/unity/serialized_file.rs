use deku::{bitvec::{BitSlice, BitVec}, prelude::*};
use wasm_bindgen::prelude::*;

use crate::unity::common::NullTerminatedAsciiString;
use super::types::object::WasmFriendlyPPtr;

use super::{class_id::ClassID, common::UnityArray};

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
            let byte_start = match obj.small_file_byte_start {
                Some(start) => start as u64,
                None => obj.large_file_byte_start.unwrap() as u64,
            };
            let obj_type = &metadata.type_tree[obj.serialized_type_index as usize];
            let class_id = obj_type.header.raw_type_id;
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
            .map(|external_file| (&external_file.asset_path_ascii).into())
    }
}

#[wasm_bindgen(js_name = "UnityAssetFileObject")]
pub struct AssetFileObject {
    pub file_id: i64,
    pub byte_start: u64,
    pub byte_size: usize,
    pub class_id: ClassID,
}

// Supports v21, v22, and above

#[derive(DekuRead, Clone, Debug)]
#[deku(endian = "big")]
struct SerializedFileHeader {
    pub metadata_size: i32,
    pub file_size: u32,
    pub version: i32,
    pub data_offset: u32,
    #[deku(pad_bytes_after = "3")]
    pub endianness: u8,
    #[deku(cond = "*version >= 22")]
    pub large_files_metadata_size: Option<u32>,
    #[deku(cond = "*version >= 22")]
    pub large_files_file_size: Option<i64>,
    #[deku(cond = "*version >= 22")]
    pub large_files_data_offset: Option<i64>,
    #[deku(cond = "*version >= 22")]
    _unk0: Option<i64>,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "version: i32")]
struct SerializedFileMetadata {
    pub version_ascii: NullTerminatedAsciiString,
    pub target_platform: u32,
    pub enable_type_tree: u8,
    type_tree_count: i32,
    #[deku(count = "*type_tree_count", ctx = "*enable_type_tree > 0")]
    pub type_tree: Vec<SerializedType>,
    object_count: i32,
    #[deku(ctx = "version", count = "*object_count")]
    pub objects: Vec<ObjectInfo>,

    // align to the nearest 4 byte boundary
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment: Vec<u8>,

    pub script_types: UnityArray<LocalSerializedObjectIdentifier>,
    pub externals: UnityArray<FileIdentifier>,
    ref_types_count: i32,
    #[deku(count = "*ref_types_count", ctx = "*enable_type_tree > 0")]
    pub ref_types: Vec<SerializedTypeReference>,
    pub user_information: NullTerminatedAsciiString,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "version: i32")]
struct ObjectInfo {
    pub file_id: i64,
    #[deku(cond = "version <= 21")]
    pub small_file_byte_start: Option<u32>,
    #[deku(cond = "version >= 22")]
    pub large_file_byte_start: Option<i64>,
    pub byte_size: i32,
    pub serialized_type_index: i32,
}

#[derive(DekuRead, Clone, Debug)]
struct LocalSerializedObjectIdentifier {
    pub local_serialized_file_index: i32,
    pub local_identifier_in_file: i64,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "has_type_tree: bool")]
struct SerializedTypeHeader {
    pub raw_type_id: ClassID,
    pub is_stripped_type: u8,
    pub script_type_index: i16,
    #[deku(cond = "*raw_type_id == ClassID::MonoBehavior")]
    pub script_id: Option<[u8; 16]>,
    pub old_type_hash: [u8; 16],
    #[deku(cond = "has_type_tree")]
    pub old_type: Option<OldSerializedType>,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "has_type_tree: bool")]
struct SerializedType {
    #[deku(ctx = "has_type_tree")]
    pub header: SerializedTypeHeader,
    #[deku(cond = "has_type_tree", default = "0")]
    type_dependencies_count: i32,
    #[deku(count = "*type_dependencies_count")]
    pub type_dependencies: Vec<i32>,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "has_type_tree: bool")]
struct SerializedTypeReference {
    #[deku(ctx = "has_type_tree")]
    pub header: SerializedTypeHeader,
    #[deku(cond = "has_type_tree", default = "0")]
    type_dependencies_count: i32,
    #[deku(count = "*type_dependencies_count")]
    pub type_dependencies: Vec<i32>,
}

#[derive(DekuRead, Clone, Debug)]
struct SerializedTypeReferenceDependency {
    pub class_name: NullTerminatedAsciiString,
    pub namespace: NullTerminatedAsciiString,
    pub asm_name: NullTerminatedAsciiString,
}

#[derive(DekuRead, Clone, Debug)]
struct OldSerializedType {
    nodes_count: i32,
    string_buffer_size: i32,
    #[deku(count = "*nodes_count")]
    nodes: Vec<TreeTypeNode>,
    #[deku(count = "*string_buffer_size")]
    string_buffer: Vec<u8>,
}

#[derive(DekuRead, Clone, Debug)]
struct TreeTypeNode {
    version: u16,
    level: u8,
    type_flags: u8,
    type_string_offset: u32,
    name_string_offset: u32,
    byte_size: i32,
    index: i32,
    meta_flags: u32,
    ref_type_hash: u64,
}

#[derive(DekuRead, Clone, Debug)]
struct Guid {
    pub data0: u32,
    pub data1: u32,
    pub data2: u32,
    pub data3: u32,
}

#[derive(DekuRead, Clone, Debug)]
struct FileIdentifier {
    pub asset_path_ascii: NullTerminatedAsciiString,
    pub guid: Guid,
    pub file_type: i32,
    pub path_name_ascii: NullTerminatedAsciiString,
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::unity::types::object::{GameObject, Mesh, MeshFilter, MeshRenderer, Transform, UnityVersion};
    use crate::unity::class_id::ClassID;

    use super::*;
    use env_logger;
    use deku::bitvec::BitVec;

    #[test]
    fn test() {
        let data = std::fs::read("M:\\Development\\NITRO_BMD\\data\\AShortHike\\level2").unwrap();
        let version = UnityVersion::V2019_4_39f1;
        let mut asset_file = AssetFile::initialize_with_header_chunk(&data).unwrap();
        dbg!(&asset_file.header);
        asset_file.append_metadata_chunk(&data).unwrap();
        let metadata = asset_file.metadata.as_ref().unwrap();

        let mut objects = HashMap::new();
        let mut object_infos = HashMap::new();
        for obj in &metadata.objects {
            object_infos.insert(obj.file_id, obj);
            let obj_type = &metadata.type_tree[obj.serialized_type_index as usize];
            if !matches!(obj_type.header.raw_type_id, ClassID::GameObject) {
                continue;
            }
            let byte_start = asset_file.get_data_offset() as usize + match obj.small_file_byte_start {
                Some(start) => start as usize,
                None => obj.large_file_byte_start.unwrap() as usize,
            };
            let byte_size = obj.byte_size as usize;
            let data = &data[byte_start..byte_start + byte_size];
            let game_object = GameObject::create(version, data).unwrap();
            objects.insert(obj.file_id, game_object);
        }

        for obj in objects.values() {
            for component_ptr in &obj.components {
                if component_ptr.file_index != 0 {
                    dbg!(component_ptr);
                    continue;
                }
                let obj: &&ObjectInfo = object_infos.get(&component_ptr.path_id).unwrap();
                let obj_type = &metadata.type_tree[obj.serialized_type_index as usize];
                let byte_start = asset_file.get_data_offset() as usize + match obj.small_file_byte_start {
                    Some(start) => start as usize,
                    None => obj.large_file_byte_start.unwrap() as usize,
                };
                let byte_size = obj.byte_size as usize;
                let bigdata = &data;
                let data = &data[byte_start..byte_start + byte_size];

                match obj_type.header.raw_type_id {
                    ClassID::Transform => {Transform::create(version, data).unwrap();},
                    ClassID::RectTransform => {Transform::create(version, data).unwrap();},
                    ClassID::MeshFilter => {
                        let filter = MeshFilter::create(version, data).unwrap();
                        let obj = object_infos.get(&filter.mesh.path_id).unwrap();
                        let byte_start = asset_file.get_data_offset() as usize + match obj.small_file_byte_start {
                            Some(start) => start as usize,
                            None => obj.large_file_byte_start.unwrap() as usize,
                        };
                        let byte_size = obj.byte_size as usize;
                        let data = &bigdata[byte_start..byte_start + byte_size];

                        if (filter.mesh.path_id == 42) {
                            let _mesh = Mesh::create(version, data).unwrap();
                        }
                    },
                    ClassID::MeshRenderer => {MeshRenderer::create(version, data).unwrap();},
                    s => {},
                }
            }
        }
    }
}
