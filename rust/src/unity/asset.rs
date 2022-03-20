use wasm_bindgen::prelude::wasm_bindgen;
use crate::unity::version::UnityVersion;
use crate::unity::reader::{ AssetReader, Deserialize, Result as ReaderResult };

#[wasm_bindgen]
#[derive(Debug)]
pub struct AssetInfo {
    #[wasm_bindgen(skip)]
    pub header: AssetHeader,
    #[wasm_bindgen(skip)]
    pub metadata: AssetMetadata,
    #[wasm_bindgen(skip)]
    pub objects: Vec<UnityObject>,
    #[wasm_bindgen(skip)]
    pub script_types: Vec<ScriptType>,
    #[wasm_bindgen(skip)]
    pub externals: Vec<External>,
    #[wasm_bindgen(skip)]
    pub ref_types: Vec<SerializedType>,
    #[wasm_bindgen(skip)]
    pub user_information: String,
}

#[wasm_bindgen]
pub struct UnityObjectArray {
    pub length: usize,
    data: Vec<UnityObject>,
}

#[wasm_bindgen]
impl UnityObjectArray {
    pub fn get(&self, i: usize) -> UnityObject {
        self.data[i].clone()
    }
}

#[wasm_bindgen]
impl AssetInfo {
    pub fn deserialize(data: Vec<u8>) -> Result<AssetInfo, String> {
        AssetReader::new(data).read_asset_info()
            .map_err(|err| format!("{:?}", err))
    }

    pub fn get_external_path(&self, file_index: u32) -> Option<String> {
        let idx = (file_index as usize) - 1;
        if idx >= self.externals.len() {
            return None;
        }
        Some(self.externals[idx].path_name.clone())
    }

    pub fn get_objects(&self) -> UnityObjectArray {
        UnityObjectArray {
            length: self.objects.len(),
            data: self.objects.clone(),
        }
    }
}

#[derive(Debug)]
pub struct External {
    pub guid: Vec<u8>,
    pub ext_type: i32,
    pub path_name: String,
}

#[derive(Debug)]
pub struct ScriptType {
    pub local_serialized_file_index: i32,
    pub local_identifier_in_file: i32,
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct UnityObject {
    pub path_id: i32,
    pub byte_start: i64,
    pub byte_size: u32,
    pub type_id: i32,
    #[wasm_bindgen(skip)]
    pub serialized_type: SerializedType,
    pub class_id: i32,
}

#[derive(Debug, Clone)]
pub struct TypeTreeNode {
    pub level: usize,
    pub type_str: String,
    pub name: String,
    pub byte_size: usize,
    pub index: i32,
    pub type_flags: i32,
    pub version: i32,
    pub meta_flag: u32,
}

#[derive(Debug, Copy, Clone, PartialEq)]
pub enum Endianness {
    Big,
    Little,
}

#[wasm_bindgen]
#[derive(Debug)]
pub struct AssetHeader {
    pub metadata_size: usize,
    pub file_size: usize,
    pub version: u8,
    pub data_offset: usize,
    #[wasm_bindgen(skip)]
    pub endianness: Endianness,
}

#[wasm_bindgen]
impl AssetHeader {
    pub fn deserialize(data: Vec<u8>) -> AssetHeader {
        let mut reader = AssetReader::new(data);
        reader.read_header().unwrap()
    }
}

#[derive(Debug, Default, Clone)]
pub struct TypeTree {
    pub nodes: Vec<TypeTreeNode>,
    pub class_name: Option<String>,
    pub name_space: Option<String>,
    pub asm_name: Option<String>,
    pub type_dependencies: Option<Vec<i32>>,
}

#[derive(Debug, Clone)]
pub struct SerializedType {
    pub class_id: i32,
    pub is_stripped_type: bool,
    pub script_type_index: i16,
    pub type_tree: Option<TypeTree>,
    pub script_id: Vec<u8>,
    pub old_type_hash: Vec<u8>,
    pub type_dependencies: Vec<u32>,
    pub class_name: String,
    pub name_space: String,
    pub asm_name: String,
}

#[derive(Debug)]
pub struct AssetMetadata {
    pub unity_version: UnityVersion,
    pub target_platform: u32,
    pub enable_type_tree: bool,
    pub types: Vec<SerializedType>,
}

#[wasm_bindgen(getter_with_clone)]
#[derive(Debug, Clone)]
pub struct UnityStreamingInfo {
    pub size: u32,
    pub offset: u32,
    pub path: String,
}

impl Deserialize for UnityStreamingInfo {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> ReaderResult<Self> {
        let unity2020 = UnityVersion { major: 2020, ..Default::default() };
        let offset = if asset.metadata.unity_version > unity2020 {
            reader.read_i64()? as u32
        } else {
            reader.read_u32()?
        };
        let size = reader.read_u32()?;
        let path = reader.read_char_array()?;
        Ok(UnityStreamingInfo {
            size: size,
            offset: offset,
            path: path,
        })
    }
}
