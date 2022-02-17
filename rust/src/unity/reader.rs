use wasm_bindgen::prelude::wasm_bindgen;

use std::convert::TryFrom;
use std::io::prelude::*;
use std::io::Cursor;
use std::convert::From;
use byteorder::{BigEndian, LittleEndian, ReadBytesExt};
use std::io::SeekFrom;
use std::marker::Sized;

use crate::unity::asset::*;
use crate::unity::version::*;

#[derive(Debug)]
pub enum AssetReaderError {
    MissingType(i32),
    IO(std::io::Error),
    UnsupportedFileVersion(u32),
    UnsupportedUnityVersion(UnityVersion),
    UnsupportedFeature(String),
    InvalidVersion(VersionParseError),
    DeserializationError(String),
}

impl From<VersionParseError> for AssetReaderError {
    fn from(err: VersionParseError) -> Self {
        AssetReaderError::InvalidVersion(err)
    }
}

impl From<std::io::Error> for AssetReaderError {
    fn from(err: std::io::Error) -> Self {
        AssetReaderError::IO(err)
    }
}

pub type Result<T> = std::result::Result<T, AssetReaderError>;

pub trait Deserialize {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> where Self: Sized;

    fn deserialize_array(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Vec<Self>> where Self: Sized {
        let n = reader.read_i32()?;
        let mut result = Vec::new();
        for _ in 0..n {
            result.push(Self::deserialize(reader, asset)?);
        }
        // do we need to align the reader here?
        reader.align()?;
        Ok(result)
    }
}

#[wasm_bindgen]
pub struct AssetReader {
    data: Cursor<Vec<u8>>,
    endianness: Endianness,
}

// This only supports asset format versions 20, 21, and 22
impl AssetReader {
    pub fn new(data: Vec<u8>) -> AssetReader {
        AssetReader {
            data: Cursor::new(data),
            endianness: Endianness::Big,
        }
    }

    pub fn read_asset_info(&mut self) -> Result<AssetInfo> {
        let header = self.read_header()?;
        self.set_endianness(header.endianness);
        let metadata = self.read_metadata()?;
        let objects = self.read_objects(&header, &metadata)?;
        let script_types = self.read_script_types()?;
        let externals = self.read_externals()?;
        let ref_types = self.read_ref_types(&metadata)?;
        let user_information = self.read_null_terminated_string()?;
        Ok(AssetInfo {
            header,
            metadata,
            objects,
            script_types,
            externals,
            ref_types,
            user_information,
        })
    }

    // align to nearest 4 byte boundary
    pub fn align(&mut self) -> Result<()> {
        let idx = self.data.stream_position()?;
        self.seek(SeekFrom::Start((idx + 3) & !3))?;
        Ok(())
    }

    pub fn current_pos(&mut self) -> Result<u64> {
        Ok(self.data.stream_position()?)
    }

    pub fn seek_to_object(&mut self, obj: &UnityObject) -> Result<u64> {
        self.seek(SeekFrom::Start(obj.byte_start as u64))
    }

    pub fn seek(&mut self, seek: SeekFrom) -> Result<u64> {
        Ok(self.data.seek(seek)?)
    }

    pub fn set_endianness(&mut self, endianness: Endianness) {
        self.endianness = endianness;
    }

    pub fn read_u8(&mut self) -> Result<u8> {
        Ok(self.data.read_u8()?)
    }

    pub fn read_u16(&mut self) -> Result<u16> {
        match self.endianness {
            Endianness::Big => Ok(self.data.read_u16::<BigEndian>()?),
            Endianness::Little => Ok(self.data.read_u16::<LittleEndian>()?),
        }
    }

    pub fn read_i16(&mut self) -> Result<i16> {
        match self.endianness {
            Endianness::Big => Ok(self.data.read_i16::<BigEndian>()?),
            Endianness::Little => Ok(self.data.read_i16::<LittleEndian>()?),
        }
    }

    pub fn read_i64(&mut self) -> Result<i64> {
        match self.endianness {
            Endianness::Big => Ok(self.data.read_i64::<BigEndian>()?),
            Endianness::Little => Ok(self.data.read_i64::<LittleEndian>()?),
        }
    }

    pub fn read_i32(&mut self) -> Result<i32> {
        match self.endianness {
            Endianness::Big => Ok(self.data.read_i32::<BigEndian>()?),
            Endianness::Little => Ok(self.data.read_i32::<LittleEndian>()?),
        }
    }

    pub fn read_u32(&mut self) -> Result<u32> {
        match self.endianness {
            Endianness::Big => Ok(self.data.read_u32::<BigEndian>()?),
            Endianness::Little => Ok(self.data.read_u32::<LittleEndian>()?),
        }
    }

    pub fn read_f32(&mut self) -> Result<f32> {
        match self.endianness {
            Endianness::Big => Ok(self.data.read_f32::<BigEndian>()?),
            Endianness::Little => Ok(self.data.read_f32::<LittleEndian>()?),
        }
    }

    pub fn read_char_array(&mut self) -> Result<String> {
        let bytes = self.read_byte_array()?;
        let mut res = String::with_capacity(bytes.len());
        for byte in bytes {
            res.push(byte as char);
        }
        self.align()?;
        Ok(res)
    }

    pub fn read_null_terminated_string(&mut self) -> Result<String> {
        let mut res = String::new();
        loop {
            match self.data.read_u8()? {
                0 => break,
                x => res.push(x as char),
            }
        }
        Ok(res)
    }

    pub fn read_bool(&mut self) -> Result<bool> {
        Ok(self.data.read_u8()? == 1)
    }

    pub fn read_byte_array(&mut self) -> Result<Vec<u8>> {
        let count = self.read_u32()? as usize;
        self.read_bytes(count)
    }

    // possibly just return a &[u8]
    pub fn read_bytes(&mut self, n: usize) -> Result<Vec<u8>> {
        let mut buf = Vec::with_capacity(n);
        unsafe {
            buf.set_len(n);
        }
        self.data.read_exact(&mut buf)?;
        Ok(buf)
    }

    pub fn read_header(&mut self) -> Result<AssetHeader> {
        let mut metadata_size = self.read_u32()?;
        let mut file_size = self.read_u32()? as i64;
        let version = self.read_u32()?;
        if ![20, 21, 22].contains(&version) {
            return Err(AssetReaderError::UnsupportedFileVersion(version));
        }
        let mut data_offset = self.read_u32()? as i64;
        let endianness = match self.data.read_u8()? {
            0 => Endianness::Little,
            _ => Endianness::Big,
        };
        self.seek(std::io::SeekFrom::Current(3))?; // skip reserved fields

        if version >= 22 {
            metadata_size = self.read_u32()?;
            file_size = self.read_i64()?;
            data_offset = self.read_i64()?;
            self.read_i64()?; // unknown
        }

        Ok(AssetHeader {
            metadata_size: metadata_size as usize,
            file_size: file_size as usize,
            version: version as u8,
            data_offset: data_offset as usize,
            endianness,
        })
    }

    fn read_metadata(&mut self) -> Result<AssetMetadata> {
        let unity_version = UnityVersion::try_from(self.read_null_terminated_string()?.as_str())?;
        let target_platform = self.read_u32()?;
        let enable_type_tree = self.read_bool()?;
        let type_count = self.read_u32()?;
        let mut types: Vec<SerializedType> = Vec::with_capacity(type_count as usize);
        for _ in 0..type_count {
            types.push(self.read_unity_type(false, enable_type_tree)?);
        }
        Ok(AssetMetadata {
            unity_version,
            target_platform,
            enable_type_tree,
            types,
        })
    }

    fn read_unity_type(&mut self, is_ref_type: bool, enable_type_tree: bool) -> Result<SerializedType> {
        let class_id = self.read_i32()?;
        let is_stripped_type = self.read_bool()?;
        let script_type_index = self.read_i16()?;
        let mut script_id = Vec::new();
        if (is_ref_type && script_type_index >= 0) || class_id < 0 || class_id == 114 {
            script_id = self.read_bytes(16)?;
        }
        let old_type_hash = self.read_bytes(16)?;
        let type_dependencies = Vec::new();
        let class_name = String::new();
        let name_space = String::new();
        let asm_name = String::new();
        if enable_type_tree {
            todo!();
        }

        Ok(SerializedType {
            class_id,
            is_stripped_type,
            script_type_index,
            script_id,
            old_type_hash,
            type_dependencies,
            type_tree: None,
            class_name,
            name_space,
            asm_name,
        })
    }

    fn read_objects(&mut self, hdr: &AssetHeader, metadata: &AssetMetadata) -> Result<Vec<UnityObject>> {
        let n_objects = self.read_i32()?;
        let mut objects = Vec::new();
        for _ in 0..n_objects {
            objects.push(self.read_object(hdr, metadata)?)
        }
        Ok(objects)
    }

    fn read_object(&mut self, hdr: &AssetHeader, metadata: &AssetMetadata) -> Result<UnityObject> {
        self.align()?;
        let path_id = self.read_i64()?;
        let mut byte_start = match hdr.version {
            22 => self.read_i64()?,
            _ => self.read_u32()? as i64,
        };
        byte_start += hdr.data_offset as i64;
        let byte_size = self.read_u32()?;
        let type_id = self.read_i32()?;
        let serialized_type = match metadata.types.get(type_id as usize) {
            Some(serialized_type) => serialized_type.clone(),
            None => return Err(AssetReaderError::MissingType(type_id)),
        };
        let class_id = serialized_type.class_id;
        Ok(UnityObject {
            path_id,
            byte_start,
            byte_size,
            type_id,
            serialized_type,
            class_id,
        })
    }

    fn read_script_types(&mut self) -> Result<Vec<ScriptType>> {
        let n_script_types = self.read_i32()?;
        let mut result = Vec::new();
        for _ in 0..n_script_types {
            let local_serialized_file_index = self.read_i32()?;
            self.align()?;
            let local_identifier_in_file = self.read_i64()?;
            result.push(ScriptType { local_identifier_in_file, local_serialized_file_index });
        }
        Ok(result)
    }

    fn read_externals(&mut self) -> Result<Vec<External>> {
        let n_externals = self.read_i32()?;
        let mut result = Vec::new();
        for _ in 0..n_externals {
            let _empty = self.read_null_terminated_string()?;
            let guid = self.read_bytes(16)?;
            let ext_type = self.read_i32()?;
            let path_name = self.read_null_terminated_string()?;
            result.push(External {
                guid,
                ext_type,
                path_name,
            })
        }
        Ok(result)
    }

    fn read_ref_types(&mut self, metadata: &AssetMetadata) -> Result<Vec<SerializedType>> {
        let n_ref_types = self.read_i32()?;
        let mut result = Vec::new();
        for _ in 0..n_ref_types {
            result.push(self.read_unity_type(true, metadata.enable_type_tree)?);
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_test_asset() -> AssetReader {
        // from Subnautica
        let data = std::fs::read("test_data/unity_assets/v20/sharedassets0.assets").unwrap();
        AssetReader::new(data)
    }

    #[test]
    fn test_header() {
        let mut reader = read_test_asset();
        let hdr = reader.read_header().unwrap();
        assert_eq!(hdr.metadata_size, 2493);
        assert_eq!(hdr.file_size, 17649856);
        assert_eq!(hdr.version, 20);
        assert_eq!(hdr.data_offset, 4096);
    }

    #[test]
    fn test_metadata() {
        let mut reader = read_test_asset();
        let hdr = reader.read_header().unwrap();
        reader.set_endianness(hdr.endianness);
        let metadata = reader.read_metadata().unwrap();
        assert_eq!(metadata.unity_version, UnityVersion::try_from("2019.2.17f1").unwrap());
    }

    #[test]
    fn test_objects() {
        use std::collections::HashMap;

        let mut reader = read_test_asset();
        let hdr = reader.read_header().unwrap();
        reader.set_endianness(hdr.endianness);
        let metadata = reader.read_metadata().unwrap();
        let objects = reader.read_objects(&hdr, &metadata).unwrap();
        assert_eq!(objects.len(), 56);

        // count how many objects there are per type
        let mut stats: HashMap<i32, usize> = HashMap::new();
        for obj in objects {
            *stats.entry(obj.class_id).or_insert(0) += 1;
        }
        assert_eq!(stats.get(&150), Some(&1)); // PreloadData
        assert_eq!(stats.get(&21), Some(&10)); // Material
        assert_eq!(stats.get(&28), Some(&12)); // Texture2D
        assert_eq!(stats.get(&128), Some(&9)); // Font
        assert_eq!(stats.get(&213), Some(&1)); // Sprite
        assert_eq!(stats.get(&1), Some(&1)); // GameObject
        assert_eq!(stats.get(&4), Some(&1)); // Transform
        assert_eq!(stats.get(&114), Some(&21)); // MonoBehaviour
    }

    #[test]
    fn test_script_types() {
        let mut reader = read_test_asset();
        let hdr = reader.read_header().unwrap();
        reader.set_endianness(hdr.endianness);
        let metadata = reader.read_metadata().unwrap();
        let _ = reader.read_objects(&hdr, &metadata).unwrap();
        let _script_types = reader.read_script_types().unwrap();
    }

    #[test]
    fn test_externals() {
        let mut reader = read_test_asset();
        let hdr = reader.read_header().unwrap();
        reader.set_endianness(hdr.endianness);
        let metadata = reader.read_metadata().unwrap();
        let _ = reader.read_objects(&hdr, &metadata).unwrap();
        let _script_types = reader.read_script_types().unwrap();
        let externals = reader.read_externals().unwrap();
        assert_eq!(externals.len(), 2);
        assert_eq!(&externals[0].path_name, "globalgamemanagers.assets");
        assert_eq!(&externals[1].path_name, "library/unity default resources");
    }

    #[test]
    fn test_ref_types() {
        let mut reader = read_test_asset();
        let hdr = reader.read_header().unwrap();
        reader.set_endianness(hdr.endianness);
        let metadata = reader.read_metadata().unwrap();
        let _ = reader.read_objects(&hdr, &metadata).unwrap();
        let _ = reader.read_script_types().unwrap();
        let _ = reader.read_externals().unwrap();
        let ref_types = reader.read_ref_types(&metadata).unwrap();
        assert_eq!(ref_types.len(), 0);
    }

    #[test]
    fn test_all_together() {
        let mut reader = read_test_asset();
        let _asset = reader.read_asset_info().unwrap();
    }

    #[test]
    fn test_v22() {
        let data = std::fs::read("test_data/unity_assets/v22/sharedassets0.assets").unwrap();
        let mut reader = AssetReader::new(data);
        let _asset = reader.read_asset_info().unwrap();
    }
}