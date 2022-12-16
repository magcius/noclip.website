use std::{io::{Cursor, Seek, SeekFrom, Read}, convert::{TryFrom, TryInto}};
use num_enum::{IntoPrimitive, TryFromPrimitive, TryFromPrimitiveError};

use crate::halo::common::*;
use crate::halo::util::*;
use crate::halo::tag::*;
use crate::halo::bitmap::*;
use crate::halo::scenario::*;

use byteorder::{LittleEndian, ReadBytesExt};

use super::shader::ShaderEnvironment;

const BASE_MEMORY_ADDRESS: Pointer = 0x50000000;

pub struct MapManager {
    reader: MapReader,
    header: Header,
    tag_index_header: TagIndexHeader,
    bitmaps_reader: ResourceMapReader,
    bitmaps_header: ResourcesHeader,
    tag_headers: Vec<TagHeader>,
}

impl MapManager {
    pub fn new(map: Vec<u8>, bitmaps: Vec<u8>) -> Result<Self> {
        let mut reader = MapReader::new(map);
        let header = reader.read_header()?;
        let mut bitmaps_reader = ResourceMapReader::new(bitmaps);
        let bitmaps_header = bitmaps_reader.read_header()?;

        let tag_index_header = reader.read_tag_index_header(&header)?;
        let tag_headers = reader.read_tag_headers(&header, &tag_index_header)?;

        Ok(MapManager {
            reader,
            header,
            tag_index_header,
            bitmaps_reader,
            bitmaps_header,
            tag_headers,
        })
    }

    fn get_tag_data_offset(&self) -> i64 {
        self.header.tag_data_offset as i64 - BASE_MEMORY_ADDRESS as i64
    }

    pub fn read_tag(&mut self, tag_header: &TagHeader) -> Result<Tag> {
        self.read_tag_at_offset(tag_header, self.get_tag_data_offset())
    }

    pub fn read_map_bytes(&mut self, offset: u64, size: usize) -> Result<Vec<u8>> {
        self.reader.data.seek(SeekFrom::Start(offset))?;
        let mut buf = vec![0; size];
        self.reader.data.read_exact(&mut buf)?;
        Ok(buf)
    }

    fn read_tag_at_offset(&mut self, tag_header: &TagHeader, offset: i64) -> Result<Tag> {
        let tag_pointer = offset + tag_header.tag_data as i64;
        if tag_pointer < 0 {
            panic!("invalid tag pointer {} for header {:?}", tag_pointer, tag_header)
        }
        self.reader.data.seek(SeekFrom::Start(tag_pointer as u64))?;
        let data = match tag_header.primary_class {
            TagClass::Bitmap => {
                let mut bitmap = Bitmap::deserialize(&mut self.reader.data)?;
                bitmap.bitmap_group_sequence.read_items(&mut self.reader.data, offset)?;
                bitmap.data.read_items(&mut self.reader.data, offset)?;
                TagData::Bitmap(bitmap)
            },
            TagClass::Scenario => {
                let mut scenario = Scenario::deserialize(&mut self.reader.data)?;
                scenario.structure_bsp_references.read_items(&mut self.reader.data, offset)?;
                TagData::Scenario(scenario)
            },
            TagClass::ScenarioStructureBsp => {
                let mut bsp = BSP::deserialize(&mut self.reader.data)?;
                bsp.surfaces.read_items(&mut self.reader.data, offset)?;
                bsp.lightmaps.read_items(&mut self.reader.data, offset)?;
                for lightmap in bsp.lightmaps.items.as_mut().unwrap() {
                    lightmap.materials.read_items(&mut self.reader.data, offset)?;
                }
                TagData::BSP(bsp)
            },
            TagClass::ShaderEnvironment => {
                let shader = ShaderEnvironment::deserialize(&mut self.reader.data)?;
                TagData::ShaderEnvironment(shader)
            }
            _ => return Err(MapReaderError::UnimplementedTag(format!("can't yet read {:?}", tag_header))),
        };
        Ok(Tag { header: tag_header.clone(), data })
    }

    pub fn get_scenario(&mut self) -> Result<Tag> {
        let header = self.tag_headers.iter().find(|header| match header.primary_class {
            TagClass::Scenario => true,
            _ => false,
        }).unwrap().clone();
        self.read_tag(&header)
    }

    pub fn resolve_dependency(&self, dependency: &TagDependency) -> Option<&TagHeader> {
        self.tag_headers.iter().find(|header| header.tag_id == dependency.tag_id)
    }

    pub fn get_scenario_bsps(&mut self, tag: &Tag) -> Result<Vec<Tag>> {
        if let TagData::Scenario(scenario) = &tag.data {
            if let Some(bsp_references) = &scenario.structure_bsp_references.items {
                let bsp_refs_and_headers: Vec<(&ScenarioStructureBSPReference, TagHeader)> = bsp_references.iter()
                    .map(|bsp_ref| (bsp_ref, self.resolve_dependency(&bsp_ref.structure_bsp).unwrap().clone()))
                    .collect();
                let mut result = Vec::new();
                for (bsp_ref, mut header) in bsp_refs_and_headers {
                    self.reader.data.seek(SeekFrom::Start(bsp_ref.start as u64))?;
                    let bsp_header = BSPHeader::deserialize(&mut self.reader.data)?;
                    let offset = bsp_ref.start as i64 - bsp_ref.address as i64;
                    header.tag_data = bsp_header.bsp_offset;
                    let mut tag = self.read_tag_at_offset(&header, offset).unwrap();
                    if let TagData::BSP(bsp) = &mut tag.data {
                        bsp.header = Some(bsp_header);
                    }
                    result.push(tag);
                }
                return Ok(result);
            }
            return Err(MapReaderError::InvalidTag(format!("scenario has no bsp references")))
        }
        Err(MapReaderError::InvalidTag(format!("expected scenario tag, got {:?}", tag.header.primary_class)))
    }

    pub fn get_bitmaps(&mut self) -> Result<Vec<Tag>> {
        let bitmap_headers: Vec<TagHeader> = self.tag_headers.iter()
            .filter(|header| match header.primary_class {
                TagClass::Bitmap => true,
                _ => false,
            })
            .cloned()
            .collect();
        let mut result = Vec::new();
        for hdr in &bitmap_headers {
            result.push(self.read_tag(&hdr)?);
        }
        Ok(result)
    }

    pub fn read_bitmap_data(&mut self, bitmap: &Bitmap, index: usize) -> Result<Vec<u8>> {
        if let Some(bitmap_data) = &bitmap.data.items {
                let data = &bitmap_data[index];
                let mut result = vec![0; data.pixel_data_size as usize];
                self.bitmaps_reader.data.seek(SeekFrom::Start(data.pixel_data_offset as u64))?;
                self.bitmaps_reader.data.read_exact(&mut result)?;
                return Ok(result);
        }
        return Err(MapReaderError::InvalidTag(format!("bitmap has no BitmapData")));
    }
}

struct ResourceMapReader {
    pub data: Cursor<Vec<u8>>,
}

impl ResourceMapReader {
    fn new(data: Vec<u8>) -> ResourceMapReader {
        ResourceMapReader { data: Cursor::new(data) }
    }

    fn read_header(&mut self) -> Result<ResourcesHeader> {
        ResourcesHeader::deserialize(&mut self.data)
    }
}

struct MapReader {
    pub data: Cursor<Vec<u8>>,
}

impl MapReader {
    fn new(data: Vec<u8>) -> MapReader {
        MapReader { data: Cursor::new(data) }
    }

    fn read_header(&mut self) -> Result<Header> {
        self.data.seek(SeekFrom::Start(0))?;
        Header::deserialize(&mut self.data)
    }

    fn read_tag_index_header(&mut self, header: &Header) -> Result<TagIndexHeader> {
        self.data.seek(SeekFrom::Start(header.tag_data_offset as u64))?;
        TagIndexHeader::deserialize(&mut self.data)
    }

    fn read_tag_headers(&mut self, header: &Header, tag_index_header: &TagIndexHeader) -> Result<Vec<TagHeader>> {
        let mut result = Vec::with_capacity(tag_index_header.tag_count as usize);
        for i in 0..tag_index_header.tag_count {
            let data_offset = header.tag_data_offset + 40 + (i * 32);
            self.data.seek(SeekFrom::Start(data_offset as u64))?;
            let mut tag_header = TagHeader::deserialize(&mut self.data)?;
            let path_offset = header.tag_data_offset + tag_header.tag_path - BASE_MEMORY_ADDRESS;
            self.data.seek(SeekFrom::Start(path_offset as u64))?;
            let path = read_null_terminated_string(&mut self.data)?;
            tag_header.path = path;
            result.push(tag_header);
        }
        Ok(result)
    }
}

#[derive(Debug)]
struct Header {
    pub uncompressed_file_size: u32,
    pub tag_data_offset: Pointer,
    pub tag_data_size: u32,
    pub scenario_name: String,
    pub scenario_type: ScenarioType,
}

#[derive(Debug, Copy, Clone)]
enum ResourceType {
    Bitmaps = 0x1,
    Sounds = 0x2,
    Localization = 0x3,
}

#[derive(Debug)]
struct ResourcesHeader {
    resource_type: ResourceType,
    paths_offset: Pointer,
    resources_offset: Pointer,
    resource_count: u32,
}

#[derive(Debug)]
struct ResourceHeader {
    path_offset: Pointer,
    size: u32,
    data_offset: Pointer,
    path: Option<String>,
}

impl Deserialize for ResourceHeader {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(ResourceHeader {
            path_offset: data.read_u32::<LittleEndian>()? as Pointer,
            size: data.read_u32::<LittleEndian>()?,
            data_offset: data.read_u32::<LittleEndian>()? as Pointer,
            path: None,
        })
    }
}

impl Deserialize for ResourcesHeader {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(ResourcesHeader {
            resource_type: match data.read_u32::<LittleEndian>()? {
                0x1 => ResourceType::Bitmaps,
                0x2 => ResourceType::Sounds,
                0x3 => ResourceType::Localization,
                x => return Err(MapReaderError::IO(format!("invalid enum {}", x))),
            },
            paths_offset: data.read_u32::<LittleEndian>()? as Pointer,
            resources_offset: data.read_u32::<LittleEndian>()? as Pointer,
            resource_count: data.read_u32::<LittleEndian>()?,
        })
    }
}

fn convert_vpointer(pointer: Pointer) -> Pointer {
    pointer - BASE_MEMORY_ADDRESS
}

#[derive(Debug, Copy, Clone, TryFromPrimitive)]
#[repr(u16)]
pub enum ScenarioType {
    Singleplayer = 0,
    Multiplayer = 1,
    UserInterface = 2,
}

impl Deserialize for Header {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        assert_eq!(data.read_u32::<LittleEndian>()?, 1751474532); // magic
        assert_eq!(data.read_u32::<LittleEndian>()?, 0xD); // MCC
        let uncompressed_file_size = data.read_u32::<LittleEndian>()?;
        let _padding_length = data.read_u32::<LittleEndian>()?;
        let tag_data_offset = data.read_u32::<LittleEndian>()?;
        let tag_data_size = data.read_u32::<LittleEndian>()?;
        data.seek(SeekFrom::Current(0x8))?;
        let scenario_name = read_null_terminated_string_with_size(data, 32)?;
        let _build_version = read_null_terminated_string_with_size(data, 32)?;
        let scenario_type = ScenarioType::try_from(data.read_u16::<LittleEndian>()?)?;
        data.seek(SeekFrom::Current(0x2))?;
        let _checksum = data.read_u32::<LittleEndian>()?;
        data.seek(SeekFrom::Current(0x794))?;
        assert_eq!(data.read_u32::<LittleEndian>()?, 1718579060);
        Ok(Header{
            uncompressed_file_size,
            tag_data_offset,
            tag_data_size,
            scenario_name,
            scenario_type,
        })
    }
}

#[derive(Debug)]
struct TagIndexHeader {
    pub tag_count: u32,
    pub tag_array_pointer: Pointer,
    pub model_part_count: u32,
    pub model_data_file_offset: Pointer,
    pub vertex_data_size: u32,
    pub scenario_tag_id: u32,
    pub model_data_size: u32,
}

impl Deserialize for TagIndexHeader {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let tag_array_pointer = data.read_u32::<LittleEndian>()?;
        let _checksum = data.read_u32::<LittleEndian>()?;
        let scenario_tag_id = data.read_u32::<LittleEndian>()?;
        let tag_count = data.read_u32::<LittleEndian>()?;
        let model_part_count = data.read_u32::<LittleEndian>()?;
        let model_data_file_offset = data.read_u32::<LittleEndian>()?;
        let _model_part_count_pc = data.read_u32::<LittleEndian>()?;
        let vertex_data_size = data.read_u32::<LittleEndian>()?;
        let model_data_size = data.read_u32::<LittleEndian>()?;
        assert_eq!(data.read_u32::<LittleEndian>()?, 1952540531);
        Ok(TagIndexHeader {
            tag_count,
            tag_array_pointer,
            model_part_count,
            model_data_file_offset,
            scenario_tag_id,
            vertex_data_size,
            model_data_size,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::convert::TryInto;

    use crate::halo::shader;

    use super::*;

    fn read_bloodgulch() -> Vec<u8> {
        std::fs::read("test_data/bloodgulch.map").unwrap()
    }

    fn read_a10() -> Vec<u8> {
        std::fs::read("test_data/a10.map").unwrap()
    }

    fn read_bitmaps() -> Vec<u8> {
        std::fs::read("test_data/bitmaps.map").unwrap()
    }

    #[test]
    fn test() {
        let mut mgr = MapManager::new(read_bloodgulch(), read_bitmaps()).unwrap();
        for tag in &mgr.tag_headers.clone() {
            if tag.primary_class == TagClass::Scenery {
                dbg!(mgr.read_tag(&tag));
                break;
            }
        }
    }

    #[test]
    fn test2() {
        let mut mgr = crate::halo::wasm::HaloSceneManager::new(read_a10(), read_bitmaps());
    }
}