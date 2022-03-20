use wasm_bindgen::prelude::wasm_bindgen;
use crate::unity::version::UnityVersion;
use crate::unity::reader::{ AssetReader, Deserialize, Result as ReaderResult };
use crate::unity::game_object::{ GameObject };
use crate::unity::class_id::UnityClassID;

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

    pub fn get_mesh_metadata(&self, data: Vec<u8>) -> MeshMetadataArray {
        let mut reader = AssetReader::new(data);
        reader.set_endianness(self.header.endianness);
        let mut mesh_data: Vec<MeshMetadata> = self.objects.iter()
            .filter(|obj| obj.class_id == 43)
            .map(|obj| MeshMetadata {
                location: FileLocation::from_obj(obj),
                name: String::new(),
            })
            .collect();
        for mesh in mesh_data.iter_mut() {
            reader.seek(std::io::SeekFrom::Start(mesh.location.offset as u64)).unwrap();
            mesh.name = reader.read_char_array().unwrap();
        }
        MeshMetadataArray {
            length: mesh_data.len(),
            data: mesh_data,
        }
    }

    pub fn get_object_locations(&self, class_id: UnityClassID) -> FileLocationArray {
        let data: Vec<FileLocation> = self.objects.iter()
            .filter(|obj| obj.class_id == class_id.into())
            .map(|obj| FileLocation::from_obj(obj))
            .collect();
        FileLocationArray {
            length: data.len(),
            data,
        }
    }

    pub fn get_component_locations(&self, obj: &GameObject) -> FileLocationArray {
        let data: Vec<FileLocation> = obj.components.iter()
            .flat_map(|ptr| self.get_obj_location(ptr.path_id))
            .collect();
        FileLocationArray {
            length: data.len(),
            data,
        }
    }

    pub fn get_obj_location(&self, path_id: i32) -> Option<FileLocation> {
        match self.objects.iter().find(|obj| obj.path_id == path_id) {
            Some(obj) => Some(FileLocation::from_obj(obj)),
            None => None,
        }
    }
}

#[wasm_bindgen]
pub struct FileLocationArray {
    pub length: usize,
    data: Vec<FileLocation>,
}

#[wasm_bindgen]
impl FileLocationArray {
    pub fn get(&self, i: usize) -> FileLocation {
        self.data[i]
    }
}

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
#[derive(Debug, Copy, Clone)]
pub struct FileLocation {
    pub path_id: i32,
    pub offset: usize,
    pub size: usize,
}

impl FileLocation {
    fn from_obj(obj: &UnityObject) -> FileLocation {
        FileLocation {
            path_id: obj.path_id,
            offset: obj.byte_start as usize,
            size: obj.byte_size as usize,
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct MeshMetadata {
    pub location: FileLocation,
    name: String,
}

#[wasm_bindgen]
impl MeshMetadata {
    pub fn get_name(&self) -> String {
        self.name.clone()
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

#[derive(Debug)]
pub struct UnityObject {
    pub path_id: i32,
    pub byte_start: i64,
    pub byte_size: u32,
    pub type_id: i32,
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
