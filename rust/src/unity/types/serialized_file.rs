use std::fmt::Debug;
use deku::prelude::*;

use crate::unity::types::common::{NullTerminatedAsciiString, UnityArray};
use crate::unity::types::class_id::ClassID;

// Supports v21, v22, and above

#[derive(DekuRead, Clone, Debug)]
#[deku(endian = "big")]
pub struct SerializedFileHeader {
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
pub struct SerializedFileMetadata {
    pub version_ascii: NullTerminatedAsciiString,
    pub target_platform: u32,
    pub enable_type_tree: u8,
    type_tree_count: i32,
    #[deku(count = "*type_tree_count", ctx = "*enable_type_tree > 0")]
    pub type_tree: Vec<SerializedType>,
    object_count: i32,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment: Vec<u8>,
    #[deku(ctx = "version", count = "*object_count")]
    pub objects: Vec<ObjectInfo>,
    pub script_types: UnityArray<LocalSerializedObjectIdentifier>,
    pub externals: UnityArray<FileIdentifier>,
    ref_types_count: i32,
    #[deku(count = "*ref_types_count", ctx = "*enable_type_tree > 0")]
    pub ref_types: Vec<SerializedTypeReference>,
    pub user_information: NullTerminatedAsciiString,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "version: i32")]
pub struct ObjectInfo {
    pub file_id: i64,
    #[deku(cond = "version <= 21")]
    pub small_file_byte_start: Option<u32>,
    #[deku(cond = "version >= 22")]
    pub large_file_byte_start: Option<i64>,
    pub byte_size: i32,
    pub serialized_type_index: i32,
}

impl ObjectInfo {
    pub fn get_byte_start(&self) -> i64 {
        match self.small_file_byte_start {
            Some(v) => v as i64,
            None => self.large_file_byte_start.unwrap(),
        }
    }
}

#[derive(DekuRead, Clone, Debug)]
pub struct LocalSerializedObjectIdentifier {
    pub local_serialized_file_index: i32,
    pub local_identifier_in_file: i64,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "has_type_tree: bool")]
pub struct SerializedTypeHeader {
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
pub struct SerializedType {
    #[deku(ctx = "has_type_tree")]
    pub header: SerializedTypeHeader,
    #[deku(cond = "has_type_tree", default = "0")]
    type_dependencies_count: i32,
    #[deku(count = "*type_dependencies_count")]
    pub type_dependencies: Vec<i32>,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "has_type_tree: bool")]
pub struct SerializedTypeReference {
    #[deku(ctx = "has_type_tree")]
    pub header: SerializedTypeHeader,
    #[deku(cond = "has_type_tree", default = "0")]
    type_dependencies_count: i32,
    #[deku(count = "*type_dependencies_count")]
    pub type_dependencies: Vec<i32>,
}

#[derive(DekuRead, Clone, Debug)]
pub struct SerializedTypeReferenceDependency {
    pub class_name: NullTerminatedAsciiString,
    pub namespace: NullTerminatedAsciiString,
    pub asm_name: NullTerminatedAsciiString,
}

#[derive(DekuRead, Clone, Debug)]
pub struct OldSerializedType {
    nodes_count: i32,
    string_buffer_size: i32,
    #[deku(count = "*nodes_count")]
    nodes: Vec<TreeTypeNode>,
    #[deku(count = "*string_buffer_size")]
    string_buffer: Vec<u8>,
}

#[derive(DekuRead, Clone, Debug)]
pub struct TreeTypeNode {
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
pub struct Guid {
    pub data0: u32,
    pub data1: u32,
    pub data2: u32,
    pub data3: u32,
}

#[derive(DekuRead, Clone, Debug)]
pub struct FileIdentifier {
    pub asset_path_ascii: NullTerminatedAsciiString,
    pub guid: Guid,
    pub file_type: i32,
    pub path_name_ascii: NullTerminatedAsciiString,
}
