use wasm_bindgen::prelude::wasm_bindgen;

use crate::unity::reader::*;
use crate::unity::asset::AssetInfo;
use crate::unity::mesh::Vec3f;
use crate::unity::version::{ UnityVersion, VersionType };

#[wasm_bindgen]
#[derive(Debug, Copy, Clone)]
pub struct PPtr {
    pub file_index: u32,
    pub path_id: i64,
}

impl Deserialize for PPtr {
    fn deserialize(reader: &mut AssetReader, _asset: &AssetInfo) -> Result<Self> {
        let file_index = reader.read_u32()?;
        assert_eq!(file_index, 0); // not sure what this means if > 0

        let path_id = reader.read_i64()?;
        Ok(PPtr { file_index, path_id })
    }
}

#[wasm_bindgen]
pub struct GameObject {
    #[wasm_bindgen(skip)]
    pub components: Vec<PPtr>,
    #[wasm_bindgen(skip)]
    pub transform: Option<Transform>,
    #[wasm_bindgen(skip)]
    pub mesh_filter: Option<MeshFilter>,
    // TODO: MeshRenderer
    pub layer: u32,
    name: String,
    pub is_active: bool,
}

impl Deserialize for GameObject {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        Ok(GameObject {
            components: PPtr::deserialize_array(reader, asset)?,
            transform: None,
            mesh_filter: None,
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

pub struct GameObjectTree {
    obj: GameObject,
    children: Vec<GameObject>,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct Quaternion {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub w: f32,
}

impl Deserialize for Quaternion {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        Ok(Quaternion {
            x: reader.read_f32()?,
            y: reader.read_f32()?,
            z: reader.read_f32()?,
            w: reader.read_f32()?,
        })
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct Transform {
    pub game_object: PPtr,
    pub local_rotation: Quaternion,
    pub local_position: Vec3f,
    pub local_scale: Vec3f,
    #[wasm_bindgen(skip)]
    pub children: Vec<PPtr>, // pointer to Transforms
    #[wasm_bindgen(skip)]
    pub parent: PPtr, // pointer to Transform
}

impl Deserialize for Transform {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        let game_object = PPtr::deserialize(reader, asset)?;
        let local_rotation = Quaternion::deserialize(reader, asset)?;
        let local_position = Vec3f::deserialize(reader, asset)?;
        let local_scale = Vec3f::deserialize(reader, asset)?;
        let v2021_2 = UnityVersion { major: 2021, minor: 2, ..Default::default() };
        if asset.metadata.unity_version >= v2021_2 {
            if asset.metadata.unity_version.version_type == VersionType::Final {
                reader.read_bool()?;
            }
            reader.align()?;
        }
        let children = PPtr::deserialize_array(reader, asset)?;
        let parent = PPtr::deserialize(reader, asset)?;
        Ok(Transform {
            game_object,
            local_position,
            local_rotation,
            local_scale,
            children,
            parent,
        })
    }
}

#[wasm_bindgen]
impl Transform {
    pub fn from_bytes(data: Vec<u8>, asset: &AssetInfo) -> std::result::Result<Transform, String> {
        let mut reader = AssetReader::new(data);
        reader.set_endianness(asset.header.endianness);
        Transform::deserialize(&mut reader, asset).map_err(|err| format!("{:?}", err))
    }
}

pub struct MeshFilter {
    pub game_object: PPtr,
    pub mesh_ptr: PPtr,
}