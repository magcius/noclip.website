use std::{collections::{HashMap, HashSet}, io::{Cursor, Seek, SeekFrom}};

use deku::{ctx::Order, prelude::*};
use nalgebra_glm::Vec2;
use crate::geometry::{point_dist_to_polygon, point_inside_polygon};

use super::common::*;
use wasm_bindgen::prelude::*;

#[derive(DekuRead, Debug, Clone)]
#[deku(magic = b"WDC4")]
pub struct Wdc4Db2Header {
    pub record_count: u32,
    pub field_count: u32,
    pub record_size: u32,
    pub string_table_size: u32,
    pub table_hash: u32,
    pub layout_hash: u32,
    pub min_id: u32,
    pub max_id: u32,
    pub locale: u32,
    pub flags: u16,
    pub id_index: u16,
    pub total_field_count: u32,
    pub bitpacked_data_offset: u32,
    pub lookup_column_count: u32,
    pub field_storage_info_size: u32,
    pub common_data_size: u32,
    pub palette_data_size: u32,
    pub section_count: u32,
}

#[derive(DekuRead, Debug, Clone)]
pub struct Wdc4Db2SectionHeader {
    pub tact_key_hash: u64,
    pub file_offset: u32,
    pub record_count: u32,
    pub string_table_size: u32,
    pub offset_records_end: u32,
    pub id_list_size: u32,
    pub relationship_data_size: u32,
    pub offset_map_id_count: u32,
    pub copy_table_count: u32,
}

#[derive(DekuRead, Debug, Clone)]
#[deku(id_type = "u32")]
pub enum StorageType {
    #[deku(id = "0")]
    None {
        unk1: u32,
        unk2: u32,
        unk3: u32,
    },
    #[deku(id = "1")]
    Bitpacked {
        offset_bits: u32,
        size_bits: u32,
        flags: u32,
    },
    #[deku(id = "2")]
    CommonData {
        default_value: u32,
        unk1: u32,
        unk2: u32,
    },
    #[deku(id = "3")]
    BitpackedIndexed {
        offset_bits: u32,
        size_bits: u32,
        unk1: u32,
    },
    #[deku(id = "4")]
    BitpackedIndexedArray {
        offset_bits: u32,
        size_bits: u32,
        array_count: u32,
    },
    #[deku(id = "5")]
    BitpackedSigned {
        offset_bits: u32,
        size_bits: u32,
        flags: u32,
    },
}

#[derive(DekuRead, Debug, Clone)]
pub struct Wdc4Db2FieldStruct {
    pub size: i16,
    pub position: u16,
}

#[derive(DekuRead, Debug, Clone)]
pub struct Wdc4Db2FieldInfo {
    pub field_offset_bits: u16,
    pub field_size_bits: u16,
    pub additional_data_size: u32,
    pub storage_type: StorageType,
}

#[derive(DekuRead, Debug, Clone)]
pub struct Wdc4Db2File {
    pub header: Wdc4Db2Header,
    #[deku(count = "header.section_count")]
    pub section_headers: Vec<Wdc4Db2SectionHeader>,
    #[deku(count = "header.total_field_count")]
    pub field_structs: Vec<Wdc4Db2FieldStruct>,
    #[deku(bytes_read = "header.field_storage_info_size")]
    pub field_storage_info: Vec<Wdc4Db2FieldInfo>,
    #[deku(count = "header.palette_data_size")]
    pub palette_data: Vec<u8>,
    #[deku(count = "header.common_data_size")]
    pub common_data: Vec<u8>,
}

impl Wdc4Db2File {
    pub fn print_table_debug_info(&self) {
        assert_eq!(self.field_structs.len(), self.field_storage_info.len());
        println!("Number of fields: {}", self.field_structs.len());
        for i in 0..self.field_structs.len() {
            let field_struct = &self.field_structs[i];
            let field_storage = &self.field_storage_info[i];
            println!("Field {}", i+1);
            println!("  - Offset (bits): {}", field_storage.field_offset_bits);
            println!("  - Size (bits): {}", field_storage.field_size_bits);
            println!("  - Position?: {}", field_struct.position);
            println!("  - Storage type: {:?}", field_storage.storage_type);
            println!("  - Additional data size: {}", field_storage.additional_data_size);
        }
    }
}

fn from_u32<T>(v: u32) -> Result<T, DekuError>
    where for<'a> T: DekuReader<'a, ()>
{
    let v_bytes = v.to_le_bytes();
    let mut cursor = Cursor::new(v_bytes);
    let mut reader = Reader::new(&mut cursor);
    T::from_reader_with_ctx(&mut reader, ())
}

fn read_field_to_u32<R: std::io::Read + std::io::Seek>(reader: &mut Reader<R>, field_offset_bits: usize, field_size_bits: usize) -> Result<u32, DekuError> {
    // Assumes the reader points to the start of the record
    let old = reader.seek(std::io::SeekFrom::Current(0))
        .map_err(|err| DekuError::Io(err.kind()))?;

    // This is somewhat annoying. Deku uses Msb0 ordering, while we want Lsb0 ordering.
    // Do the math ourselves rather than using Deku's read_bits.
    // Deku trunk supports Lsb0 ordering, but that's not released yet.
    let field_offset_bytes = field_offset_bits >> 3;
    reader.seek(std::io::SeekFrom::Current(field_offset_bytes as i64))
        .map_err(|err| DekuError::Io(err.kind()))?;

    let shift = field_offset_bits & 7;
    let field_size_bytes = (field_size_bits + 7 + shift) >> 3;
    assert!(field_size_bits <= 32);

    let mut buf = [0x00; 4];
    reader.read_bytes(field_size_bytes, &mut buf, Order::Msb0)?;
    let v = u32::from_le_bytes(buf);

    let result = if field_size_bits == 32 {
        v
    } else {
        let mask = (1 << field_size_bits) - 1;
        (v >> shift) & mask
    };

    reader.seek(std::io::SeekFrom::Start(old))
        .map_err(|err| DekuError::Io(err.kind()))?;
    Ok(result)
}

impl Wdc4Db2File {
    pub fn print_palettes(&self) {
        for field_index in 0..self.field_storage_info.len() {
            let info = &self.field_storage_info[field_index];
            println!("{:?}", info);
            for palette_index in 0..info.additional_data_size / 4 {
                let palette_u32 = self.get_palette_data(field_index, palette_index as usize);
                println!("  {}: {} {}", palette_index, palette_u32, f32::from_bits(palette_u32));
            }
        }
    }

    pub fn read_vec<'a, T, R: std::io::Read + std::io::Seek>(&self, reader: &mut Reader<R>, field_number: usize) -> Result<Vec<T>, DekuError>
        where for<'b> T: DekuReader<'b, ()>
    {
        let field_offset = self.field_storage_info[field_number].field_offset_bits as usize;
        let field_size = self.field_storage_info[field_number].field_size_bits as usize;
        let result = match &self.field_storage_info[field_number].storage_type {
            StorageType::BitpackedIndexedArray { offset_bits: _, size_bits: _, array_count } => {
                let index = read_field_to_u32(reader, field_offset, field_size)?;
                let mut result: Vec<T> = Vec::with_capacity(*array_count as usize);
                for _ in 0..*array_count as usize {
                    let palette_element = self.get_palette_data(field_number, index as usize);
                    result.push(from_u32(palette_element)?);
                }
                result
            },
            _ => panic!("called read_vec() on field {}, which is a non-BitpackedIndexedArray type. call read_field instead", field_number),
        };
        Ok(result)
    }

    pub fn read_string_helper<'a, R: std::io::Read + std::io::Seek>(&self, reader: &mut Reader<R>, string_offset: u32) -> Result<String, DekuError> {
        let mut string = String::new();
        let old = reader.seek(std::io::SeekFrom::Current(0))
            .map_err(|err| DekuError::Io(err.kind()))?;
        reader.seek(std::io::SeekFrom::Current(string_offset as i64))
            .map_err(|err| DekuError::Io(err.kind()))?;

        loop {
            let byte = u8::from_reader_with_ctx(reader, ())?;
            if byte == 0 {
                break;
            }
            string.push(byte as char);
            if string.len() > 100 {
                panic!("bad string data: {}", string);
            }
        }

        reader.seek(std::io::SeekFrom::Start(old))
            .map_err(|err| DekuError::Io(err.kind()))?;
        Ok(string)
    }

    pub fn read_string_direct<'a, R: std::io::Read + std::io::Seek>(&self, reader: &mut Reader<R>, field_number: usize, extra_offset: usize) -> Result<String, DekuError> {
        let field_offset = (self.field_storage_info[field_number].field_offset_bits as usize) + (extra_offset * 8);
        let old = reader.seek(std::io::SeekFrom::Current(0))
            .map_err(|err| DekuError::Io(err.kind()))?;
        reader.skip_bits(field_offset)?;
        let string_offset = u32::from_reader_with_ctx(reader, ())?;
        let v = if string_offset != 0 { self.read_string_helper(reader, string_offset - 4) } else { Ok("".into()) };
        reader.seek(std::io::SeekFrom::Start(old))
            .map_err(|err| DekuError::Io(err.kind()))?;
        v
    }

    pub fn read_string<'a, R: std::io::Read + std::io::Seek>(&self, reader: &mut Reader<R>, field_number: usize) -> Result<String, DekuError> {
        let string_offset = self.read_field::<u32, R>(reader, field_number)?;
        self.read_string_helper(reader, string_offset)
    }

    pub fn read_field<'a, T, R: std::io::Read + std::io::Seek>(&self, reader: &mut Reader<R>, field_number: usize) -> Result<T, DekuError>
        where for<'b> T: DekuReader<'b, ()>
    {
        let field_offset = self.field_storage_info[field_number].field_offset_bits as usize;
        let field_size = self.field_storage_info[field_number].field_size_bits as usize;
        let result = match &self.field_storage_info[field_number].storage_type {
            StorageType::None { .. } => {
                let old = reader.seek(std::io::SeekFrom::Current(0i64))
                    .map_err(|err| DekuError::Io(err.kind()))?;
                reader.skip_bits(field_offset)?;
                let v = T::from_reader_with_ctx(reader, ())?;
                reader.seek(std::io::SeekFrom::Start(old))
                    .map_err(|err| DekuError::Io(err.kind()))?;
                v
            },
            StorageType::Bitpacked { offset_bits: _, size_bits, flags: _ } | StorageType::BitpackedSigned { offset_bits: _, size_bits, flags: _ } => {
                let size_bits = *size_bits as usize;
                let v = read_field_to_u32(reader, field_offset, size_bits)?;
                from_u32(v)?
            },
            StorageType::CommonData { default_value, .. } => {
                let default = from_u32(*default_value)?;
                let index = read_field_to_u32(reader, field_offset, field_size)?;
                let common_element = self.get_common_data(field_number, index).unwrap_or(default);
                from_u32(common_element)?
            },
            StorageType::BitpackedIndexed { .. } => {
                let index = read_field_to_u32(reader, field_offset, field_size)?;
                let palette_element = self.get_palette_data(field_number, index as usize);
                from_u32(palette_element)?
            },
            StorageType::BitpackedIndexedArray { offset_bits: _, size_bits: _, array_count: _ } => {
                panic!("read_value() called on field {}, which is a BitpackedIndexedArray type. use read_vec() instead", field_number)
            },
        };
        Ok(result)
    }

    fn get_common_data(&self, field_number: usize, needle: u32) -> Option<u32> {
        let mut offset: usize = 0;
        for field_number_i in 0..field_number {
            match &self.field_storage_info[field_number_i].storage_type {
                StorageType::CommonData {..} => {
                    offset += self.field_storage_info[field_number_i].additional_data_size as usize;
                },
                _ => {},
            }
        }
        for item_idx in 0..self.field_storage_info[field_number].additional_data_size as usize / 8 {
            let item_offset = offset + item_idx * 8;
            let haystack = u32::from_le_bytes([
                self.common_data[item_offset],
                self.common_data[item_offset + 1],
                self.common_data[item_offset + 2],
                self.common_data[item_offset + 3],
            ]);
            if needle == haystack {
                return Some(u32::from_le_bytes([
                    self.common_data[item_offset + 4],
                    self.common_data[item_offset + 5],
                    self.common_data[item_offset + 6],
                    self.common_data[item_offset + 7],
                ]));
            }
        }
        None
    }

    fn get_palette_data(&self, field_number: usize, palette_index: usize) -> u32 {
        let mut offset = 0;
        for field_number_i in 0..field_number {
            match &self.field_storage_info[field_number_i].storage_type {
                StorageType::BitpackedIndexed {..} | StorageType::BitpackedIndexedArray {..} => {
                    offset += self.field_storage_info[field_number_i].additional_data_size as usize;
                },
                _ => {},
            }
        }
        let start_index = offset + palette_index * 4;
        u32::from_le_bytes([
            self.palette_data[start_index],
            self.palette_data[start_index + 1],
            self.palette_data[start_index + 2],
            self.palette_data[start_index + 3],
        ])
    }
}

#[derive(Debug)]
pub struct DatabaseTable<T> {
    records: Vec<T>,
    ids: Vec<u32>,
    foreign_keys: Option<Vec<u32>>,
    copies: HashMap<u32, u32>,
}

impl<T> DatabaseTable<T> {
    pub fn new(data: &[u8]) -> Result<DatabaseTable<T>, String>
        where for<'a> T: DekuReader<'a, Wdc4Db2File>
    {
        let (_, db2) = Wdc4Db2File::from_bytes((&data, 0))
            .map_err(|e| format!("{:?}", e))?;
        assert!(db2.section_headers.len() == 1);
        let mut records: Vec<T> = Vec::with_capacity(db2.header.record_count as usize);
        let mut ids: Vec<u32> = Vec::with_capacity(db2.header.record_count as usize);
        let records_start = db2.section_headers[0].file_offset as usize;
        let mut cursor = Cursor::new(&data);
        let mut reader = Reader::new(&mut cursor);

        reader.seek(std::io::SeekFrom::Start(records_start as u64))
            .map_err(|err| err.to_string())?;
        let mut id = db2.header.min_id;
        for _ in 0..db2.header.record_count {
            let value = T::from_reader_with_ctx(&mut reader, db2.clone())
                .map_err(|e| format!("{:?}", e))?;
            // our abuse of Deku in the database system always puts the cursor back where it started, so advance to the next record manually
            reader.seek(std::io::SeekFrom::Current(db2.header.record_size as i64))
                .map_err(|err| err.to_string())?;
            records.push(value);
            ids.push(id);
            id += 1;
        }
        let strings_start = records_start + (db2.header.record_count * db2.header.record_size) as usize;

        // if a list of IDs is provided, correct our auto-generated IDs
        let id_list_start: usize = strings_start + db2.header.string_table_size as usize;
        let id_list_size: usize = db2.section_headers[0].id_list_size as usize;
        if id_list_size > 0 {
            reader.seek(std::io::SeekFrom::Start(id_list_start as u64))
                .map_err(|err| err.to_string())?;
            assert_eq!(id_list_size, records.len() * 4);
            for i in 0..records.len() {
                id = u32::from_reader_with_ctx(&mut reader, ())
                    .map_err(|e| format!("{:?}", e))?;
                ids[i] = id;
            }
        }

        let mut foreign_keys = None;
        let relationship_start = id_list_start + id_list_size + 12; // idk
        if db2.section_headers[0].relationship_data_size > 0 {
            let mut keys = vec![0; records.len()];
            reader.seek(SeekFrom::Start(relationship_start as u64))
                .map_err(|err| err.to_string())?;
            for _ in 0..records.len() {
                let foreign_key = u32::from_reader_with_ctx(&mut reader, ())
                    .map_err(|e| format!("{:?}", e))?;
                let id = u32::from_reader_with_ctx(&mut reader, ())
                    .map_err(|e| format!("{:?}", e))?;
                keys[id as usize] = foreign_key;
            }
            foreign_keys = Some(keys);
        }

        let mut copies = HashMap::new();
        for _ in 0..db2.section_headers[0].copy_table_count {
            let id_of_new_row = u32::from_reader_with_ctx(&mut reader, ())
                .map_err(|e| format!("{:?}", e))?;
            let id_of_old_row = u32::from_reader_with_ctx(&mut reader, ())
                .map_err(|e| format!("{:?}", e))?;
            copies.insert(id_of_new_row, id_of_old_row);
        }

        Ok(DatabaseTable {
            records,
            ids,
            foreign_keys,
            copies,
        })
    }

    pub fn get_record(&self, mut needle: u32) -> Option<&T> {
        if let Some(id) = self.copies.get(&needle) {
            needle = *id;
        }
        let index = self.ids.iter().position(|haystack| *haystack == needle)?;
        Some(&self.records[index])
    }
}

#[derive(DekuRead, Debug, Clone)]
#[deku(ctx = "db2: Wdc4Db2File")]
struct ZoneLightRecord {
    #[deku(reader = "db2.read_field(deku::reader, 0)")]
    pub _unk_1: u32,
    #[deku(reader = "db2.read_field(deku::reader, 1)")]
    pub map_id: u16,
    #[deku(reader = "db2.read_field(deku::reader, 2)")]
    pub light_id: u16,
    #[deku(reader = "db2.read_field(deku::reader, 3)")]
    pub _light_flags: u8,
    #[deku(reader = "db2.read_field(deku::reader, 4)")]
    pub z_min: f32,
    #[deku(reader = "db2.read_field(deku::reader, 5)")]
    pub z_max: f32,
    #[deku(reader = "db2.read_field(deku::reader, 6)")]
    pub _unk_2: u32,
}

#[derive(DekuRead, Debug, Clone)]
#[deku(ctx = "db2: Wdc4Db2File")]
struct ZoneLightPointRecord {
    #[deku(reader = "db2.read_field(deku::reader, 0)")]
    pub coords: [f32; 2],
    #[deku(reader = "db2.read_field(deku::reader, 1)")]
    pub _point_order: u32,
}

#[derive(DekuRead, Debug, Clone)]
#[wasm_bindgen(js_name = "WowLightParamsRecord")]
#[deku(ctx = "db2: Wdc4Db2File")]
pub struct LightParamsRecord {
    #[deku(reader = "db2.read_field(deku::reader, 0)")]
    _celestial_overrides: Vec3,
    #[deku(reader = "db2.read_field(deku::reader, 1)")]
    pub id: u32,
    #[deku(reader = "db2.read_field(deku::reader, 2)")]
    pub highlight_sky: bool,
    #[deku(reader = "db2.read_field(deku::reader, 3)")]
    pub skybox_id: u32,
    #[deku(reader = "db2.read_field(deku::reader, 5)")]
    pub glow: f32,
    #[deku(reader = "db2.read_field(deku::reader, 6)")]
    pub water_shallow_alpha: f32,
    #[deku(reader = "db2.read_field(deku::reader, 7)")]
    pub water_deep_alpha: f32,
    #[deku(reader = "db2.read_field(deku::reader, 8)")]
    pub ocean_shallow_alpha: f32,
    #[deku(reader = "db2.read_field(deku::reader, 9)")]
    pub ocean_deep_alpha: f32,
    #[deku(reader = "db2.read_field(deku::reader, 10)")]
    pub flags: f32,
    #[deku(reader = "db2.read_field(deku::reader, 11)")]
    pub unk: u32,
}

#[derive(DekuRead, Debug, Clone)]
#[deku(ctx = "db2: Wdc4Db2File")]
struct LightDataRecord {
    #[deku(reader = "db2.read_field(deku::reader, 0)")]
    pub light_param_id: u32,
    #[deku(reader = "db2.read_field(deku::reader, 1)")]
    pub time: u32,
    #[deku(reader = "db2.read_field(deku::reader, 2)")]
    pub direct_color: u32,
    #[deku(reader = "db2.read_field(deku::reader, 3)")]
    pub ambient_color: u32,
    #[deku(reader = "db2.read_field(deku::reader, 4)")]
    pub sky_top_color: u32,
    #[deku(reader = "db2.read_field(deku::reader, 5)")]
    pub sky_middle_color: u32,
    #[deku(reader = "db2.read_field(deku::reader, 6)")]
    pub sky_band1_color: u32,
    #[deku(reader = "db2.read_field(deku::reader, 7)")]
    pub sky_band2_color: u32,
    #[deku(reader = "db2.read_field(deku::reader, 8)")]
    pub sky_smog_color: u32,
    #[deku(reader = "db2.read_field(deku::reader, 9)")]
    pub sky_fog_color: u32,
    #[deku(reader = "db2.read_field(deku::reader, 10)")]
    pub sun_color: u32,
    #[deku(reader = "db2.read_field(deku::reader, 11)")]
    pub cloud_sun_color: u32,
    #[deku(reader = "db2.read_field(deku::reader, 12)")]
    pub cloud_emissive_color: u32,
    #[deku(reader = "db2.read_field(deku::reader, 13)")]
    pub cloud_layer1_ambient_color: u32,
    #[deku(reader = "db2.read_field(deku::reader, 14)")]
    pub cloud_layer2_ambient_color: u32,
    #[deku(reader = "db2.read_field(deku::reader, 15)")]
    pub ocean_close_color: u32,
    #[deku(reader = "db2.read_field(deku::reader, 16)")]
    pub ocean_far_color: u32,
    #[deku(reader = "db2.read_field(deku::reader, 17)")]
    pub river_close_color: u32,
    #[deku(reader = "db2.read_field(deku::reader, 18)")]
    pub river_far_color: u32,
    #[deku(reader = "db2.read_field(deku::reader, 19)")]
    pub shadow_opacity: u32,
    #[deku(reader = "db2.read_field(deku::reader, 20)")]
    pub fog_end: f32,
    #[deku(reader = "db2.read_field(deku::reader, 21)")]
    pub fog_scaler: f32,
}

#[wasm_bindgen(js_name = "WowLightResult", getter_with_clone)]
#[derive(Debug, Clone, Default)]
pub struct LightResult {
    pub glow: f32,
    pub water_shallow_alpha: f32,
    pub water_deep_alpha: f32,
    pub ocean_shallow_alpha: f32,
    pub ocean_deep_alpha: f32,
    pub highlight_sky: bool,
    pub direct_color: Vec3,
    pub ambient_color: Vec3,
    pub sky_top_color: Vec3,
    pub sky_middle_color: Vec3,
    pub sky_band1_color: Vec3,
    pub sky_band2_color: Vec3,
    pub sky_smog_color: Vec3,
    pub sky_fog_color: Vec3,
    pub sun_color: Vec3,
    pub cloud_sun_color: Vec3,
    pub cloud_emissive_color: Vec3,
    pub cloud_layer1_ambient_color: Vec3,
    pub cloud_layer2_ambient_color: Vec3,
    pub ocean_close_color: Vec3,
    pub ocean_far_color: Vec3,
    pub river_close_color: Vec3,
    pub river_far_color: Vec3,
    pub shadow_opacity: Vec3,
    pub fog_end: f32,
    pub fog_scaler: f32,
    skyboxes: HashMap<String, (u16, f32)>,
    total_alpha: f32,
}

#[derive(DekuRead, Debug, Clone)]
#[wasm_bindgen(js_name = "WowLightRecord")]
#[deku(ctx = "db2: Wdc4Db2File")]
pub struct LightRecord {
    #[deku(reader = "db2.read_field(deku::reader, 0)")]
    pub coords: Vec3,
    #[deku(reader = "db2.read_field(deku::reader, 1)")]
    pub falloff_start: f32,
    #[deku(reader = "db2.read_field(deku::reader, 2)")]
    pub falloff_end: f32,
    #[deku(reader = "db2.read_field(deku::reader, 3)")]
    pub map_id: u16,
    #[deku(reader = "db2.read_field(deku::reader, 4)")]
    light_param_ids: [u16; 8],
}

enum DistanceResult {
    Inner,
    Outer(f32),
    None,
}

impl LightRecord {
    fn distance(&self, other: &Vec3) -> DistanceResult {
        let distance = (
            (self.coords.x - other.x).powi(2) +
            (self.coords.y - other.y).powi(2) +
            (self.coords.z - other.z).powi(2)
        ).sqrt();
        if distance < self.falloff_start {
            DistanceResult::Inner
        } else if distance < self.falloff_end {
            DistanceResult::Outer(distance)
        } else {
            DistanceResult::None
        }
    }
}

fn u32_to_color(color: u32) -> Vec3 {
    Vec3 {
        z: (color & 0xff) as f32 / 255.0,
        y: ((color >> 8) & 0xff) as f32 / 255.0,
        x: ((color >> 16) & 0xff) as f32 / 255.0,
    }
}

#[wasm_bindgen(js_class = "WowLightResult")]
impl LightResult {
    pub fn get_skyboxes(&self) -> Vec<SkyboxMetadata> {
        let mut result = Vec::new();
        for (name, (flags, weight)) in self.skyboxes.iter() {
            result.push(SkyboxMetadata {
                name: name.clone(),
                flags: *flags,
                weight: *weight,
            });
        }
        // sort lightboxes by name for consistent rendering during tweening
        result.sort_by(|a, b| {
            a.name.partial_cmp(&b.name).unwrap()
        });
        result
    }
}

impl LightResult {
    fn new(data: &LightDataRecord, params: &LightParamsRecord, maybe_skybox: Option<&LightSkyboxRecord>) -> Self {
        let mut skyboxes = HashMap::new();
        if let Some(skybox) = maybe_skybox {
            skyboxes.insert(skybox.name.clone(), (skybox.flags, 1.0));
        }
        LightResult {
            total_alpha: 1.0,
            glow: params.glow,
            water_shallow_alpha: params.water_shallow_alpha,
            water_deep_alpha: params.water_deep_alpha,
            ocean_shallow_alpha: params.ocean_shallow_alpha,
            ocean_deep_alpha: params.ocean_deep_alpha,
            highlight_sky: params.highlight_sky,
            direct_color: u32_to_color(data.direct_color),
            ambient_color: u32_to_color(data.ambient_color),
            sky_top_color: u32_to_color(data.sky_top_color),
            sky_middle_color: u32_to_color(data.sky_middle_color),
            sky_band1_color: u32_to_color(data.sky_band1_color),
            sky_band2_color: u32_to_color(data.sky_band2_color),
            sky_smog_color: u32_to_color(data.sky_smog_color),
            sky_fog_color: u32_to_color(data.sky_fog_color),
            sun_color: u32_to_color(data.sun_color),
            cloud_sun_color: u32_to_color(data.cloud_sun_color),
            cloud_emissive_color: u32_to_color(data.cloud_emissive_color),
            cloud_layer1_ambient_color: u32_to_color(data.cloud_layer1_ambient_color),
            cloud_layer2_ambient_color: u32_to_color(data.cloud_layer2_ambient_color),
            ocean_close_color: u32_to_color(data.ocean_close_color),
            ocean_far_color: u32_to_color(data.ocean_far_color),
            river_close_color: u32_to_color(data.river_close_color),
            river_far_color: u32_to_color(data.river_far_color),
            shadow_opacity: u32_to_color(data.shadow_opacity),
            fog_end: data.fog_end,
            fog_scaler: data.fog_scaler,
            skyboxes,
        }
    }

    fn add_scaled(&mut self, other: &LightResult, t: f32) {
        self.total_alpha += t;
        self.glow += other.glow * t;
        self.water_shallow_alpha += other.water_shallow_alpha * t;
        self.water_deep_alpha += other.water_deep_alpha * t;
        self.ocean_shallow_alpha += other.ocean_shallow_alpha * t;
        self.ocean_deep_alpha += other.ocean_deep_alpha * t;
        self.ambient_color += other.ambient_color * t;
        self.direct_color += other.direct_color * t;
        self.sky_top_color += other.sky_top_color * t;
        self.sky_middle_color += other.sky_middle_color * t;
        self.sky_band1_color += other.sky_band1_color * t;
        self.sky_band2_color += other.sky_band2_color * t;
        self.sky_smog_color += other.sky_smog_color * t;
        self.sky_fog_color += other.sky_fog_color * t;
        self.sun_color += other.sun_color * t;
        self.cloud_sun_color += other.cloud_sun_color * t;
        self.cloud_emissive_color += other.cloud_emissive_color * t;
        self.cloud_layer1_ambient_color += other.cloud_layer1_ambient_color * t;
        self.cloud_layer2_ambient_color += other.cloud_layer2_ambient_color * t;
        self.ocean_close_color += other.ocean_close_color * t;
        self.ocean_far_color += other.ocean_far_color * t;
        self.river_close_color += other.river_close_color * t;
        self.river_far_color += other.river_far_color * t;
        self.shadow_opacity += other.shadow_opacity * t;
        self.fog_end += other.fog_end * t;
        self.fog_scaler += other.fog_scaler * t;

        for (name, (flags, value)) in other.skyboxes.iter() {
            if let Some(existing_entry) = self.skyboxes.get_mut(name) {
                existing_entry.1 += value * t;
            } else {
                self.skyboxes.insert(name.clone(), (*flags, value * t));
            }
        }
    }

    fn normalize(&mut self, default_light: &LightResult) {
        if self.total_alpha < 1.0 {
            self.add_scaled(default_light, 1.0 - self.total_alpha);
        } else if self.total_alpha > 1.0 {
            self.divide(self.total_alpha);
        }
    }

    fn divide(&mut self, t: f32) {
        self.glow /= t;
        self.water_shallow_alpha /= t;
        self.water_deep_alpha /= t;
        self.ocean_shallow_alpha /= t;
        self.ocean_deep_alpha /= t;
        self.ambient_color /= t;
        self.direct_color /= t;
        self.sky_top_color /= t;
        self.sky_middle_color /= t;
        self.sky_band1_color /= t;
        self.sky_band2_color /= t;
        self.sky_smog_color /= t;
        self.sky_fog_color /= t;
        self.sun_color /= t;
        self.cloud_sun_color /= t;
        self.cloud_emissive_color /= t;
        self.cloud_layer1_ambient_color /= t;
        self.cloud_layer2_ambient_color /= t;
        self.ocean_close_color /= t;
        self.ocean_far_color /= t;
        self.river_close_color /= t;
        self.river_far_color /= t;
        self.shadow_opacity /= t;
        self.fog_end /= t;
        self.fog_scaler /= t;

        for entry in self.skyboxes.values_mut() {
            entry.1 /= t;
        }
    }
}

impl Lerp for LightResult {
    fn lerp(self, other: Self, t: f32) -> Self {
        let mut skyboxes = self.skyboxes.clone();
        for (name, (flags, value)) in other.skyboxes.iter() {
            if let Some(existing_entry) = skyboxes.get_mut(name) {
                existing_entry.1.lerp(*value, t);
            } else {
                skyboxes.insert(name.clone(), (*flags, value * t));
            }
        }

        LightResult {
            total_alpha: self.total_alpha.lerp(other.total_alpha, t),
            glow: self.glow.lerp(other.glow, t),
            water_shallow_alpha: self.water_shallow_alpha.lerp(other.water_shallow_alpha, t),
            water_deep_alpha: self.water_deep_alpha.lerp(other.water_deep_alpha, t),
            ocean_shallow_alpha: self.ocean_shallow_alpha.lerp(other.ocean_shallow_alpha, t),
            ocean_deep_alpha: self.ocean_deep_alpha.lerp(other.ocean_deep_alpha, t),
            direct_color: self.direct_color.lerp(other.direct_color, t),
            ambient_color: self.ambient_color.lerp(other.ambient_color, t),
            sky_top_color: self.sky_top_color.lerp(other.sky_top_color, t),
            sky_middle_color: self.sky_middle_color.lerp(other.sky_middle_color, t),
            sky_band1_color: self.sky_band1_color.lerp(other.sky_band1_color, t),
            sky_band2_color: self.sky_band2_color.lerp(other.sky_band2_color, t),
            sky_smog_color: self.sky_smog_color.lerp(other.sky_smog_color, t),
            sky_fog_color: self.sky_fog_color.lerp(other.sky_fog_color, t),
            sun_color: self.sun_color.lerp(other.sun_color, t),
            cloud_sun_color: self.cloud_sun_color.lerp(other.cloud_sun_color, t),
            cloud_emissive_color: self.cloud_emissive_color.lerp(other.cloud_emissive_color, t),
            cloud_layer1_ambient_color: self.cloud_layer1_ambient_color.lerp(other.cloud_layer1_ambient_color, t),
            cloud_layer2_ambient_color: self.cloud_layer2_ambient_color.lerp(other.cloud_layer2_ambient_color, t),
            ocean_close_color: self.ocean_close_color.lerp(other.ocean_close_color, t),
            ocean_far_color: self.ocean_far_color.lerp(other.ocean_far_color, t),
            river_close_color: self.river_close_color.lerp(other.river_close_color, t),
            river_far_color: self.river_far_color.lerp(other.river_far_color, t),
            shadow_opacity: self.shadow_opacity.lerp(other.shadow_opacity, t),
            fog_end: self.fog_end.lerp(other.fog_end, t),
            fog_scaler: self.fog_scaler.lerp(other.fog_scaler, t),
            highlight_sky: self.highlight_sky,
            skyboxes
        }
    }
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "db2: Wdc4Db2File")]
pub struct LiquidType {
    #[deku(reader = "db2.read_string(deku::reader, 0)")]
    pub name: String,
    #[deku(reader = "db2.read_string_direct(deku::reader, 1, 0)")]
    pub tex0: String,
    #[deku(reader = "db2.read_string_direct(deku::reader, 1, 4)")]
    pub tex1: String,
    #[deku(reader = "db2.read_string_direct(deku::reader, 1, 8)")]
    pub tex2: String,
    #[deku(reader = "db2.read_string_direct(deku::reader, 1, 12)")]
    pub tex3: String,
    #[deku(reader = "db2.read_string_direct(deku::reader, 1, 16)")]
    pub tex4: String,
    #[deku(reader = "db2.read_string_direct(deku::reader, 1, 20)")]
    pub tex5: String,
    #[deku(reader = "db2.read_field(deku::reader, 2)")]
    pub flags: u16,
    #[deku(reader = "db2.read_field(deku::reader, 3)")]
    pub _sound_bank: u8,
    #[deku(reader = "db2.read_field(deku::reader, 4)")]
    pub _sound_id: u32,
    #[deku(reader = "db2.read_field(deku::reader, 5)")]
    pub _f6: u32,
    #[deku(reader = "db2.read_field(deku::reader, 6)")]
    pub _max_darken_depth: f32,
    #[deku(reader = "db2.read_field(deku::reader, 7)")]
    pub _fog_darken_intensity: f32,
    #[deku(reader = "db2.read_field(deku::reader, 8)")]
    pub _ambient_darken_intensity: f32,
    #[deku(reader = "db2.read_field(deku::reader, 9)")]
    pub _dir_darken_intensity: f32,
    #[deku(reader = "db2.read_field(deku::reader, 10)")]
    pub _light_id: u32,
    #[deku(reader = "db2.read_field(deku::reader, 11)")]
    pub _particle_scale: f32,
    #[deku(reader = "db2.read_field(deku::reader, 12)")]
    pub _particle_movement: u32,
    #[deku(reader = "db2.read_field(deku::reader, 13)")]
    pub _particle_tex_slots: u32,
    #[deku(reader = "db2.read_field(deku::reader, 14)")]
    pub _particle_material_id: u32,
    #[deku(reader = "db2.read_field(deku::reader, 15)")]
    pub _minimap_colors: u32,
    #[deku(reader = "db2.read_vec(deku::reader, 16)")]
    pub _unknown_colors: Vec<u32>,
    #[deku(reader = "db2.read_vec(deku::reader, 17)")]
    pub _shader_color: Vec<u32>,
    #[deku(reader = "db2.read_vec(deku::reader, 18)")]
    pub _shader_f32_params: Vec<f32>,
    #[deku(reader = "db2.read_vec(deku::reader, 19)")]
    pub _shader_int_params: Vec<u32>,
    #[deku(reader = "db2.read_vec(deku::reader, 20)")]
    pub _coeffecients: Vec<u32>,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "db2: Wdc4Db2File")]
pub struct LightSkyboxRecord {
    #[deku(reader = "db2.read_string(deku::reader, 0)")]
    pub name: String,
    #[deku(reader = "db2.read_field(deku::reader, 1)")]
    pub flags: u16,
    #[deku(reader = "db2.read_field(deku::reader, 2)")]
    pub _skybox_file_data_id: u32,
    #[deku(reader = "db2.read_field(deku::reader, 3)")]
    pub _celestial_skybox_file_data_id: u32,
}

#[wasm_bindgen(js_name = "WowLiquidResult", getter_with_clone)]
#[derive(Debug, Clone)]
pub struct LiquidResult {
    pub flags: u16,
    pub name: String,
    pub tex0: String,
    pub tex1: String,
    pub tex2: String,
    pub tex3: String,
    pub tex4: String,
    pub tex5: String,
}

struct ZoneLightLookup {
    zone_lights: DatabaseTable<ZoneLightRecord>,
    points: HashMap<u32, Vec<Vec2>>, // zone light id -> points
}

impl ZoneLightLookup {
    fn new(
        zone_lights: DatabaseTable<ZoneLightRecord>,
        zone_light_points: DatabaseTable<ZoneLightPointRecord>,
    ) -> Self {
        let mut points = HashMap::new();
        for i in 0..zone_light_points.records.len() {
            let record = &zone_light_points.records[i];
            let zone_light_id = zone_light_points.foreign_keys.as_ref().unwrap()[i];
            let pt = Vec2::new(record.coords[0], record.coords[1]);
            points.entry(zone_light_id)
                .or_insert(Vec::new())
                .push(pt);
        }
        ZoneLightLookup {
            zone_lights,
            points,
        }
    }

    pub fn lookup_light_id(&self, map_id: u16, x: f32, y: f32, z: f32) -> Option<(u16, f32)> {
        let p = Vec2::new(x, y);
        for i in 0..self.zone_lights.records.len() {
            let record = &self.zone_lights.records[i];
            let zone_light_id = self.zone_lights.ids[i];
            if record.map_id == map_id && z >= record.z_min && z <= record.z_max {
                let points = self.points.get(&zone_light_id).unwrap();
                if point_inside_polygon(&p, points) {
                    let dist = point_dist_to_polygon(&p, points);
                    return Some((record.light_id, dist));
                }
            }
        }
        None
    }
}

#[wasm_bindgen(js_name = "WowDatabase")]
pub struct Database {
    lights: DatabaseTable<LightRecord>,
    light_data: DatabaseTable<LightDataRecord>,
    light_params: DatabaseTable<LightParamsRecord>,
    light_skyboxes: DatabaseTable<LightSkyboxRecord>,
    liquid_types: DatabaseTable<LiquidType>,
    zone_light_lookup: ZoneLightLookup,
}

#[wasm_bindgen(js_class = "WowDatabase")]
impl Database {
    pub fn new(
        lights_db: &[u8],
        light_data_db: &[u8],
        light_params_db: &[u8],
        liquid_types_db: &[u8],
        light_skybox_db: &[u8],
        zone_lights_db: &[u8],
        zone_light_points_db: &[u8],
    ) -> Result<Database, String> {
        let lights = DatabaseTable::new(lights_db)?;
        let light_data = DatabaseTable::new(light_data_db)?;
        let light_params = DatabaseTable::new(light_params_db)?;
        let liquid_types = DatabaseTable::new(liquid_types_db)?;
        let light_skyboxes = DatabaseTable::new(light_skybox_db)?;
        let zone_lights = DatabaseTable::new(zone_lights_db)?;
        let zone_light_points = DatabaseTable::new(zone_light_points_db)?;
        let zone_light_lookup = ZoneLightLookup::new(zone_lights, zone_light_points);
        Ok(Self {
            lights,
            light_data,
            light_params,
            liquid_types,
            light_skyboxes,
            zone_light_lookup,
        })
    }

    fn get_default_light(&self, map_id: u16, time: u32) -> LightResult {
        let origin = Vec3::new(0.0);
        let default_light = self.lights.records.iter()
            .find(|light| light.map_id == map_id && light.coords == origin)
            .unwrap_or(self.lights.get_record(1).unwrap());
        self.get_light_result(default_light, time).unwrap()
    }

    fn get_light_result(&self, light: &LightRecord, time: u32) -> Option<LightResult> {
        // TODO: select based on weather conditions
        let id = light.light_param_ids[0];
        assert!(id != 0);

        let light_param = self.get_light_param(id as u32)?;
        let skybox = self.light_skyboxes.get_record(light_param.skybox_id);

        // based on the given time, find the current and next LightDataRecord
        let mut current_light_data: Option<&LightDataRecord> = None;
        let mut next_light_data: Option<&LightDataRecord> = None;
        for light_data in &self.light_data.records {
            if light_data.light_param_id != id as u32 {
                continue;
            }
            if light_data.time <= time {
                if let Some(current) = current_light_data {
                    if light_data.time > current.time {
                        current_light_data = Some(light_data);
                    }
                } else {
                    current_light_data = Some(light_data);
                }
            } else if let Some(next) = next_light_data {
                if light_data.time < next.time {
                    next_light_data = Some(light_data);
                }
            } else {
                next_light_data = Some(light_data);
            }
        }

        let current_light_data = current_light_data?;
        let mut final_result = LightResult::new(current_light_data, light_param, skybox);
        if current_light_data.time != std::u32::MAX {
            if let Some(next) = next_light_data {
                let next_full = LightResult::new(next, light_param, skybox);
                let t = 1.0 - (next.time - time) as f32 / (next.time - current_light_data.time) as f32;
                final_result = final_result.lerp(next_full.clone(), t);
            }
        }

        Some(final_result)
    }

    pub fn get_liquid_type(&self, liquid_type: u32) -> Option<LiquidResult> {
        let liquid = self.liquid_types.get_record(liquid_type)?;
        Some(LiquidResult {
            flags: liquid.flags,
            name: liquid.name.clone(),
            tex0: liquid.tex0.clone(),
            tex1: liquid.tex1.clone(),
            tex2: liquid.tex2.clone(),
            tex3: liquid.tex3.clone(),
            tex4: liquid.tex4.clone(),
            tex5: liquid.tex5.clone(),
        })
    }

    fn get_light_param(&self, needle: u32) -> Option<&LightParamsRecord> {
        self.light_params.records.iter()
            .find(|param| param.id == needle)
    }

    fn lookup_zone_light(&self, map_id: u16, x: f32, y: f32, z:f32, time: u32) -> Option<(LightResult, f32)> {
        let (zone_light, dist) = self.zone_light_lookup.lookup_light_id(map_id, x, y, z)?;
        let light = self.lights.get_record(zone_light as u32)?;
        Some((self.get_light_result(light, time)?, dist))
    }

    pub fn get_lighting_data(&self, map_id: u16, x: f32, y: f32, z: f32, time: u32) -> LightResult {
        let coord = Vec3 { x, y, z };
        let mut result = LightResult::default();

        for light in &self.lights.records {
            if light.map_id == map_id {
                match light.distance(&coord) {
                    DistanceResult::Inner => {
                        if let Some(outer_light) = self.get_light_result(light, time) {
                            result.add_scaled(&outer_light, 1.0);
                        }
                    },
                    DistanceResult::Outer(distance) => {
                        if let Some(outer_light) = self.get_light_result(light, time) {
                            let alpha = 1.0 - (distance - light.falloff_start) / (light.falloff_end - light.falloff_start);
                            result.add_scaled(&outer_light, alpha);
                        }
                    },
                    DistanceResult::None => {},
                }
            }
        }

        // zone lights are defined by polygonal zones, and are only used in WOTLK
        if let Some((zone_light, dist)) = self.lookup_zone_light(map_id, x, y, z, time) {
            let threshold = 100.0;
            // if we're approaching the border of another zone, smoothly taper off to the non-zone lighting
            if dist < threshold {
                result.add_scaled(&zone_light, dist / threshold);
            } else if result.total_alpha < 1.0 {
                // otherwise, just accept whatever alpha hasn't been taken by spherical lights
                result.add_scaled(&zone_light, 1.0 - result.total_alpha);
            }
        }

        result.normalize(&self.get_default_light(map_id, time));

        result
    }

    pub fn get_all_skyboxes(&self, map_id: u16) -> Vec<SkyboxMetadata> {
        let mut light_ids = Vec::new();
        let mut names: HashSet<&str> = HashSet::new();
        let mut result = Vec::new();
        for i in 0..self.lights.records.len() {
            let light = &self.lights.records[i];
            if light.map_id == map_id {
                light_ids.push(self.lights.ids[i]);
            }
        }

        for zone_light in &self.zone_light_lookup.zone_lights.records {
            light_ids.push(zone_light.light_id as u32);
        }

        let mut skybox_ids = HashSet::new();
        for light_id in light_ids {
            let light = self.lights.get_record(light_id).unwrap();
            for param_id in light.light_param_ids {
                if param_id == 0 { continue; }
                let light_param = self.get_light_param(param_id as u32).unwrap();
                skybox_ids.insert(light_param.skybox_id);
            }
        }

        for skybox_id in skybox_ids {
            if let Some(skybox) = self.light_skyboxes.get_record(skybox_id) {
                if !names.contains(skybox.name.as_str()) {
                    result.push(SkyboxMetadata {
                        name: skybox.name.clone(),
                        flags: skybox.flags,
                        weight: 1.0,
                    });
                    names.insert(&skybox.name);
                }
            }
        }
        result
    }
}

#[derive(Debug)]
#[wasm_bindgen(js_name = "WowSkyboxMetadata", getter_with_clone)]
pub struct SkyboxMetadata {
    pub name: String,
    pub flags: u16,
    pub weight: f32,
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::wow::sheep::SheepfileManager;

    #[test]
    fn test_lighting_data() {
        let sheep_path = "../data/WorldOfWarcraft/sheep0";
        let d1 = SheepfileManager::load_file_id_data(sheep_path, 1375579).unwrap(); // lightDbData
        let d2 = SheepfileManager::load_file_id_data(sheep_path, 1375580).unwrap(); // lightDataDbData
        let d3 = SheepfileManager::load_file_id_data(sheep_path, 1334669).unwrap(); // lightParamsDbData
        let d4 = SheepfileManager::load_file_id_data(sheep_path, 1371380).unwrap(); // liquidTypes
        let d5 = SheepfileManager::load_file_id_data(sheep_path, 1308501).unwrap(); // lightSkyboxData
        let d6: Vec<u8> = SheepfileManager::load_file_id_data(sheep_path, 1310253).unwrap(); // zoneLight
        let d7: Vec<u8> = SheepfileManager::load_file_id_data(sheep_path, 1310256).unwrap(); // zoneLightPoint
        let db = Database::new(&d1, &d2, &d3, &d4, &d5, &d6, &d7).unwrap();
        dbg!(db.get_lighting_data(530, 2167.899169921875, 1723.90673828125, 299.3044738769531, 1440));
    }

    #[test]
    fn test_liquid_type() {
        let sheep_path = "../data/WorldOfWarcraft/sheep0";
        let d4 = SheepfileManager::load_file_id_data(sheep_path, 1371380).unwrap(); // liquidTypes
        let db: DatabaseTable<LiquidType> = DatabaseTable::new(&d4).unwrap();
        dbg!(&db.get_record(20).unwrap().name);
        dbg!(&db.get_record(21).unwrap().name);
        dbg!(&db.get_record(22));
        dbg!(&db.get_record(41).unwrap().name);
    }

    #[test]
    fn test_skybox() {
        let sheep_path = "../data/WorldOfWarcraft/sheep0";
        let d5 = SheepfileManager::load_file_id_data(sheep_path, 1308501).unwrap(); // lightSkyboxData
        let db: DatabaseTable<LightSkyboxRecord> = DatabaseTable::new(&d5).unwrap();
        dbg!(&db.records[0..4]);
    }
}
