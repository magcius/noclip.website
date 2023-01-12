use std::{io::{Cursor, Seek, SeekFrom, Read}, convert::{TryFrom}};
use num_enum::{TryFromPrimitive};

use crate::halo::common::*;
use crate::halo::util::*;
use crate::halo::tag::*;
use crate::halo::bitmap::*;
use crate::halo::model::*;
use crate::halo::scenario::*;
use crate::halo::shader::*;

use byteorder::{LittleEndian, ReadBytesExt};

const BASE_MEMORY_ADDRESS: Pointer = 0x50000000;

pub struct MapManager {
    pub reader: MapReader,
    pub header: Header,
    pub tag_index_header: TagIndexHeader,
    pub tag_headers: Vec<TagHeader>,
}

impl MapManager {
    pub fn new(map: Vec<u8>) -> Result<Self> {
        let mut reader = MapReader::new(map);
        let header = reader.read_header()?;

        let tag_index_header = reader.read_tag_index_header(&header)?;
        let tag_headers = reader.read_tag_headers(&header, &tag_index_header)?;

        Ok(MapManager {
            reader,
            header,
            tag_index_header,
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

    pub fn read_map_u16s(&mut self, offset: u64, length: usize) -> Result<Vec<u16>> {
        self.reader.data.seek(SeekFrom::Start(offset))?;
        let mut buf = vec![0; length];
        for n in buf.iter_mut() {
            *n = self.reader.data.read_u16::<LittleEndian>()?;
        }
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
                scenario.skies.read_items(&mut self.reader.data, offset)?;
                scenario.scenery.read_items(&mut self.reader.data, offset)?;
                scenario.scenery_palette.read_items(&mut self.reader.data, offset)?;
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
            },
            TagClass::ShaderModel => {
                let shader = ShaderModel::deserialize(&mut self.reader.data)?;
                TagData::ShaderModel(shader)
            },
            TagClass::ShaderTransparentChicago => {
                let mut shader = ShaderTransparentChicago::deserialize(&mut self.reader.data)?;
                shader.extra_layers.read_items(&mut self.reader.data, offset)?;
                shader.maps.read_items(&mut self.reader.data, offset)?;
                TagData::ShaderTransparentChicago(shader)
            },
            TagClass::ShaderTransparentGeneric => {
                let mut shader = ShaderTransparentGeneric::deserialize(&mut self.reader.data)?;
                shader.extra_layers.read_items(&mut self.reader.data, offset)?;
                shader.maps.read_items(&mut self.reader.data, offset)?;
                shader.stages.read_items(&mut self.reader.data, offset)?;

                if shader.stages.count == 0 {
                    let fallback: Vec<ShaderTransparentGenericStage> = vec![
                        ShaderTransparentGenericStage {
                            flags: 0,
                            color0_source: FunctionSource::None,
                            color0_animation_function: AnimationFunction::Zero,
                            color0_animation_period: 0.0,
                            color0_animation_lower_bound: ColorARGB{ r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
                            color0_animation_upper_bound: ColorARGB{ r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
                            color1: ColorARGB{ r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
                            input_a: ShaderInput::Texture0Color, input_a_mapping: ShaderMapping::SignedIdentity,
                            input_b: ShaderInput::One, input_b_mapping: ShaderMapping::SignedIdentity,
                            input_c: ShaderInput::Zero, input_c_mapping: ShaderMapping::SignedIdentity,
                            input_d: ShaderInput::Zero, input_d_mapping: ShaderMapping::SignedIdentity,
                            input_a_alpha: ShaderAlphaInput::Texture0Alpha, input_a_mapping_alpha: ShaderMapping::SignedIdentity,
                            input_b_alpha: ShaderAlphaInput::One, input_b_mapping_alpha: ShaderMapping::SignedIdentity,
                            input_c_alpha: ShaderAlphaInput::Zero, input_c_mapping_alpha: ShaderMapping::SignedIdentity,
                            input_d_alpha: ShaderAlphaInput::Zero, input_d_mapping_alpha: ShaderMapping::SignedIdentity,

                            output_ab_function: ShaderOutputFunction::Multiply, output_cd_function: ShaderOutputFunction::Multiply,
                            output_ab: ShaderOutput::Scratch0, output_cd: ShaderOutput::Discard, output_ab_cd_mux_sum: ShaderOutput::Discard,
                            output_ab_alpha: ShaderOutput::Scratch0, output_cd_alpha: ShaderOutput::Discard, output_ab_cd_mux_sum_alpha: ShaderOutput::Discard,
                            output_mapping_color: ShaderOutputMapping::Identity, output_mapping_alpha: ShaderOutputMapping::Identity,
                        }
                    ];
                    shader.stages.items = Some(fallback);
                    shader.stages.count = 1;
                }
                TagData::ShaderTransparentGeneric(shader)
            },
            TagClass::ShaderTransparentWater => {
                let mut shader = ShaderTransparentWater::deserialize(&mut self.reader.data)?;
                shader.ripples.read_items(&mut self.reader.data, offset)?;
                TagData::ShaderTransparentWater(shader)
            },
            TagClass::Scenery => {
                let scenery = Scenery::deserialize(&mut self.reader.data)?;
                TagData::Scenery(scenery)
            },
            TagClass::Sky => {
                let sky = Sky::deserialize(&mut self.reader.data)?;
                TagData::Sky(sky)
            },
            TagClass::GbxModel => {
                let mut model = GbxModel::deserialize(&mut self.reader.data)?;
                model.geometries.read_items(&mut self.reader.data, offset)?;
                match &mut model.geometries.items {
                    Some(geometries) => {
                        for geometry in geometries {
                            geometry.parts.read_items(&mut self.reader.data, offset)?;
                        }
                    },
                    None => panic!("failed to load geometries for {:?}", model),
                }
                model.shaders.read_items(&mut self.reader.data, offset)?;
                TagData::GbxModel(model)
            },
            _ => return Err(MapReaderError::UnimplementedTag(format!("can't yet read {:?}", tag_header))),
        };
        Ok(Tag { header: tag_header.clone(), data })
    }

    pub fn get_scenario(&mut self) -> Result<Tag> {
        let header = self.tag_headers.iter()
            .find(|header| matches!(header.primary_class, TagClass::Scenario))
            .unwrap().clone();
        self.read_tag(&header)
    }

    pub fn resolve_dependency(&self, dependency: &TagDependency) -> Option<TagHeader> {
        self.tag_headers.iter()
            .find(|header| header.tag_id == dependency.tag_id)
            .cloned()
    }

    pub fn get_scenario_bsps(&mut self, tag: &Tag) -> Result<Vec<Tag>> {
        if let TagData::Scenario(scenario) = &tag.data {
            if let Some(bsp_references) = &scenario.structure_bsp_references.items {
                let bsp_refs_and_headers: Vec<(&ScenarioStructureBSPReference, TagHeader)> = bsp_references.iter()
                    .map(|bsp_ref| (bsp_ref, self.resolve_dependency(&bsp_ref.structure_bsp).unwrap()))
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
            return Err(MapReaderError::InvalidTag("scenario has no bsp references".to_string()))
        }
        Err(MapReaderError::InvalidTag(format!("expected scenario tag, got {:?}", tag.header.primary_class)))
    }

    pub fn get_bitmaps(&mut self) -> Result<Vec<Tag>> {
        let bitmap_headers: Vec<TagHeader> = self.tag_headers.iter()
            .filter(|header| matches!(header.primary_class, TagClass::Bitmap))
            .cloned()
            .collect();
        let mut result = Vec::new();
        for hdr in &bitmap_headers {
            result.push(self.read_tag(hdr)?);
        }
        Ok(result)
    }
}

pub struct ResourceMapReader {
    pub data: Cursor<Vec<u8>>,
}

impl ResourceMapReader {
    pub fn new(data: Vec<u8>) -> ResourceMapReader {
        ResourceMapReader { data: Cursor::new(data) }
    }

    pub fn read_header(&mut self) -> Result<ResourcesHeader> {
        ResourcesHeader::deserialize(&mut self.data)
    }
}

pub struct MapReader {
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
pub struct Header {
    pub uncompressed_file_size: u32,
    pub tag_data_offset: Pointer,
    pub tag_data_size: u32,
    pub scenario_name: String,
    pub scenario_type: ScenarioType,
}

#[derive(Debug, Copy, Clone)]
pub enum ResourceType {
    Bitmaps = 0x1,
    Sounds = 0x2,
    Localization = 0x3,
}

#[derive(Debug)]
pub struct ResourcesHeader {
    pub resource_type: ResourceType,
    pub paths_offset: Pointer,
    pub resources_offset: Pointer,
    pub resource_count: u32,
}

#[derive(Debug)]
pub struct ResourceHeader {
    pub path_offset: Pointer,
    pub size: u32,
    pub data_offset: Pointer,
    pub path: Option<String>,
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

#[derive(Debug, Clone)]
pub struct TagIndexHeader {
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
    use super::*;

    fn read_map(path: &str) -> Vec<u8> {
        std::fs::read(&format!("../data/Halo1/maps/{}", path)).unwrap()
    }

    #[test]
    fn test() {
        let mut mgr = MapManager::new(read_map("b30.map")).unwrap();
        for hdr in mgr.tag_headers.clone() {
            if hdr.path == "levels\\b30\\shaders\\waves" {
                let _ = dbg!(mgr.read_tag(&hdr));
            }
        }
    }

    #[test]
    fn test_waves() {
        let mut mgr = MapManager::new(read_map("b30.map")).unwrap();
        for hdr in mgr.tag_headers.clone() {
            if hdr.path == "levels\\b30\\shaders\\waves" {
                let _ = dbg!(mgr.read_tag(&hdr));
            }
        }
    }

    #[test]
    fn test_water() {
        let mut mgr = MapManager::new(read_map("b30.map")).unwrap();
        for hdr in mgr.tag_headers.clone() {
            if hdr.path == "levels\\b30\\shaders\\water" {
                let _ = dbg!(mgr.read_tag(&hdr));
            }
        }
    }

    #[test]
    fn test_shader_counts() {
        use std::collections::HashMap;
        let mut counts: HashMap<TagClass, usize> = HashMap::new();
        for file in std::fs::read_dir("../data/halo").unwrap() {
            let name = dbg!(file.unwrap().file_name());
            if name == "bitmaps.map" {
                continue;
            }
            let mgr = MapManager::new(read_map(&name.to_str().unwrap())).unwrap();
            for hdr in &mgr.tag_headers {
                if hdr.primary_class == TagClass::ShaderTransparentChicagoExtended {
                    dbg!(&hdr);
                }
                *counts.entry(hdr.primary_class).or_insert(0) += 1;
            }
        }
    
        dbg!(counts.get(&TagClass::Shader));
        dbg!(counts.get(&TagClass::ShaderTransparentWater));
        dbg!(counts.get(&TagClass::ShaderTransparentPlasma));
        dbg!(counts.get(&TagClass::ShaderTransparentGeneric));
        dbg!(counts.get(&TagClass::ShaderModel));
        dbg!(counts.get(&TagClass::ShaderTransparentMeter));
        dbg!(counts.get(&TagClass::ShaderEnvironment));
        dbg!(counts.get(&TagClass::ShaderTransparentChicagoExtended));
        dbg!(counts.get(&TagClass::ShaderTransparentChicago));
        dbg!(counts.get(&TagClass::ShaderTransparentGlass));
    }
}
