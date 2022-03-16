use wasm_bindgen::prelude::wasm_bindgen;

use crate::unity::reader::*;
use crate::unity::asset::AssetInfo;
use crate::unity::mesh::Vec3f;
use crate::unity::version::{ UnityVersion, VersionType };

#[wasm_bindgen]
struct PathPtr {
    pub file_index: u32,
    pub path_id: i64,
}

impl Deserialize for PathPtr {
    fn deserialize(reader: &mut AssetReader, _asset: &AssetInfo) -> Result<Self> {
        let file_index = reader.read_u32()?;
        assert_eq!(file_index, 0); // not sure what this means if > 0

        let path_id = reader.read_i64()?;
        Ok(PathPtr { file_index, path_id })
    }
}

#[wasm_bindgen]
pub struct GameObject {
    components: Vec<PathPtr>,
    transform: Option<Transform>,
    mesh_filter: Option<MeshFilter>,
    // TODO: MeshRenderer
    pub layer: u32,
    name: String,
    pub is_active: bool,
}

impl Deserialize for GameObject {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        Ok(GameObject {
            components: PathPtr::deserialize_array(reader, asset)?,
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

#[wasm_bindgen]
#[derive(Clone, Copy)]
struct Quaternion {
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
struct Transform {
    pub local_rotation: Quaternion,
    pub local_position: Vec3f,
    pub local_scale: Vec3f,
    children: Vec<PathPtr>,
    parent: PathPtr,
}

impl Deserialize for Transform {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
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
        let children = PathPtr::deserialize_array(reader, asset)?;
        let parent = PathPtr::deserialize(reader, asset)?;
        Ok(Transform { local_position, local_rotation, local_scale, children, parent })
    }
}

struct MeshFilter {
    mesh_ptr: PathPtr,
}