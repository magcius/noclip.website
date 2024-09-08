use std::collections::{HashMap, HashSet};

use deku::prelude::*;
use super::common::*;
use deku::bitvec::{BitVec, BitSlice, Msb0};
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
#[deku(type = "u32")]
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

fn bitslice_to_u32(bits: &BitSlice<u8, Msb0>, bit_offset: usize, num_bits: usize) -> u32 {
    let mut result: u32 = 0;
    for bit_num in bit_offset..bit_offset + num_bits {
        let byte_index = bit_num >> 3;
        let bit_index = 7 - (bit_num % 8);
        if bits[byte_index * 8 + bit_index] {
            result |= 1 << (bit_num - bit_offset);
        }
    }
    result
}

fn from_u32<T>(v: u32) -> Result<T, DekuError>
    where for<'a> T: DekuRead<'a, ()>
{
    let v_bytes = v.to_le_bytes();
    let (_, result) = T::read(BitSlice::from_slice(&v_bytes), ())?;
    Ok(result)
}

impl Wdc4Db2File {
    pub fn print_palettes(&self) {
        for field_index in 0..self.field_storage_info.len() {
            let info = &self.field_storage_info[field_index];
            println!("{:?}", info);
            for palette_index in 0..info.additional_data_size / 4 {
                let palette_u32 = self.get_palette_data(field_index, palette_index as usize);
                println!("  {}: {} {}", palette_index, palette_u32, from_u32::<f32>(palette_u32).unwrap());
            }
        }
    }

    pub fn read_vec<'a, T>(&self, input: &'a BitSlice<u8, Msb0>, _bit_offset: usize, field_number: usize) -> Result<(&'a BitSlice<u8, Msb0>, Vec<T>), DekuError>
        where for<'b> T: DekuRead<'b, ()>
    {
        let field_offset = self.field_storage_info[field_number].field_offset_bits as usize;
        let field_size = self.field_storage_info[field_number].field_size_bits as usize;
        let _field_bits = &input[field_offset..field_offset + field_size];
        let result = match &self.field_storage_info[field_number].storage_type {
            StorageType::BitpackedIndexedArray { offset_bits: _, size_bits: _, array_count } => {
                let index = bitslice_to_u32(input, field_offset, field_size);
                let mut result: Vec<T> = Vec::with_capacity(*array_count as usize);
                for _ in 0..*array_count as usize {
                    let palette_element = self.get_palette_data(field_number, index as usize);
                    result.push(from_u32(palette_element)?);
                }
                result
            },
            _ => panic!("called read_vec() on field {}, which is a non-BitpackedIndexedArray type. call read_field instead", field_number),
        };
        Ok((&input[field_offset + field_size..], result))
    }

    pub fn read_string_helper<'a>(&self, input: &'a BitSlice<u8, Msb0>, string_data: &'a BitSlice<u8, Msb0>) -> Result<(&'a BitSlice<u8, Msb0>, String), DekuError>
    {
        let mut string = String::new();
        let mut rest = string_data;
        loop {
            let (new_rest, byte) = u8::read(rest, ())?;
            rest = new_rest;
            if byte == 0 {
                return Ok((input, string));
            }
            string.push(byte as char);
            if string.len() > 100 {
                panic!("bad string data: {}", string);
            }
        }
    }

    pub fn read_string_direct<'a>(&self, input: &'a BitSlice<u8, Msb0>) -> Result<(&'a BitSlice<u8, Msb0>, String), DekuError>
    {
        let (field_rest, string_offset) = u32::read(input, ())?;
        let string_rest = &input[string_offset as usize * 8..];
        self.read_string_helper(field_rest, string_rest)
    }

    pub fn read_string<'a>(&self, input: &'a BitSlice<u8, Msb0>, bit_offset: usize, field_number: usize) -> Result<(&'a BitSlice<u8, Msb0>, String), DekuError>
    {
        let (field_rest, string_offset) = self.read_field::<u32>(input, bit_offset, field_number)?;
        let string_rest = &input[string_offset as usize * 8..];
        self.read_string_helper(field_rest, string_rest)
    }

    pub fn read_field<'a, T>(&self, input: &'a BitSlice<u8, Msb0>, _bit_offset: usize, field_number: usize) -> Result<(&'a BitSlice<u8, Msb0>, T), DekuError>
        where for<'b> T: DekuRead<'b, ()>
    {
        let field_offset = self.field_storage_info[field_number].field_offset_bits as usize;
        let field_size = self.field_storage_info[field_number].field_size_bits as usize;
        let field_bits = &input[field_offset..field_offset + field_size];
        let result = match &self.field_storage_info[field_number].storage_type {
            StorageType::None { .. } => {
                let (_, result) = T::read(field_bits, ())?;
                result
            },
            StorageType::Bitpacked { offset_bits: _, size_bits, flags: _ } => {
                let size_bits = *size_bits as usize;
                from_u32(bitslice_to_u32(input, field_offset, size_bits))?
            },
            StorageType::CommonData { default_value, .. } => {
                let default = from_u32(*default_value)?;
                let index = bitslice_to_u32(input, field_offset, field_size);
                let common_element = self.get_common_data(field_number, index).unwrap_or(default);
                from_u32(common_element)?
            },
            StorageType::BitpackedIndexed {   .. } => {
                let index = bitslice_to_u32(input, field_offset, field_size);
                let palette_element = self.get_palette_data(field_number, index as usize);
                from_u32(palette_element)?
            },
            StorageType::BitpackedIndexedArray { offset_bits: _, size_bits: _, array_count: _ } => {
                panic!("read_value() called on field {}, which is a BitpackedIndexedArray type. use read_vec() instead", field_number)
            },
            StorageType::BitpackedSigned { offset_bits: _, size_bits, flags: _ } => {
                let size_bits = *size_bits as usize;
                from_u32(bitslice_to_u32(input, field_offset, size_bits))?
            },
        };
        Ok((&input[field_offset + field_size..], result))
    }

    fn get_common_data(&self, field_number: usize, needle: u32) -> Option<u32> {
        let mut offset = 0;
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
}

impl<T> DatabaseTable<T> {
    pub fn new(data: &[u8]) -> Result<DatabaseTable<T>, String>
        where for<'a> T: DekuRead<'a, Wdc4Db2File>
    {
        let (_, db2) = Wdc4Db2File::from_bytes((&data, 0))
            .map_err(|e| format!("{:?}", e))?;
        let mut records: Vec<T> = Vec::with_capacity(db2.header.record_count as usize);
        let mut ids: Vec<u32> = Vec::with_capacity(db2.header.record_count as usize);
        let records_start = db2.section_headers[0].file_offset as usize;
        let bitvec = BitVec::from_slice(&data[records_start..]);
        let mut rest = bitvec.as_bitslice();
        let mut id = db2.header.min_id;
        for _ in 0..db2.header.record_count {
            let (new_rest, value) = T::read(rest, db2.clone())
                .map_err(|e| format!("{:?}", e))?;
            records.push(value);
            ids.push(id);
            id += 1;
            let bits_read = rest.len() - new_rest.len();
            assert_eq!(db2.header.record_size as usize * 8, bits_read);
            rest = new_rest;
        }
        let strings_start = records_start + (db2.header.record_count * db2.header.record_size) as usize;

        // if a list of IDs is provided, correct our auto-generated IDs
        let id_list_start = strings_start + db2.header.string_table_size as usize;
        let id_list_size = db2.section_headers[0].id_list_size as usize;
        if id_list_size > 0 {
            let mut bitslice = BitSlice::from_slice(&data[id_list_start..]);
            assert_eq!(id_list_size, records.len() * 4);
            for i in 0..records.len() {
                (rest, id) = u32::read(bitslice, ())
                    .map_err(|e| format!("{:?}", e))?;
                bitslice = rest;
                ids[i] = id;
            }
        }
        Ok(DatabaseTable {
            records,
            ids,
        })
    }

    pub fn get_record(&self, needle: u32) -> Option<&T> {
        let index = self.ids.iter().position(|haystack| *haystack == needle)?;
        Some(&self.records[index])
    }
}

#[derive(DekuRead, Debug, Clone)]
#[wasm_bindgen(js_name = "WowLightParamsRecord")]
#[deku(ctx = "db2: Wdc4Db2File")]
pub struct LightParamsRecord {
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 0)")]
    _celestial_overrides: Vec3,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 1)")]
    pub light_data_id: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 2)")]
    pub highlight_sky: bool,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 3)")]
    pub skybox_id: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 5)")]
    pub glow: f32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 6)")]
    pub water_shallow_alpha: f32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 7)")]
    pub water_deep_alpha: f32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 8)")]
    pub ocean_shallow_alpha: f32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 9)")]
    pub ocean_deep_alpha: f32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 10)", pad_bits_after = "1")]
    pub flags: f32,
}

#[derive(DekuRead, Debug, Clone)]
#[deku(ctx = "db2: Wdc4Db2File")]
struct LightDataRecord {
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 0)")]
    pub light_param_id: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 1)")]
    pub time: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 2)")]
    pub direct_color: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 3)")]
    pub ambient_color: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 4)")]
    pub sky_top_color: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 5)")]
    pub sky_middle_color: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 6)")]
    pub sky_band1_color: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 7)")]
    pub sky_band2_color: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 8)")]
    pub sky_smog_color: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 9)")]
    pub sky_fog_color: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 10)")]
    pub sun_color: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 11)")]
    pub cloud_sun_color: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 12)")]
    pub cloud_emissive_color: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 13)")]
    pub cloud_layer1_ambient_color: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 14)")]
    pub cloud_layer2_ambient_color: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 15)")]
    pub ocean_close_color: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 16)")]
    pub ocean_far_color: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 17)")]
    pub river_close_color: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 18)")]
    pub river_far_color: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 19)")]
    pub shadow_opacity: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 20)")]
    pub fog_end: f32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 21)", pad_bits_after = "40")]
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
}

#[derive(DekuRead, Debug, Clone)]
#[wasm_bindgen(js_name = "WowLightRecord")]
#[deku(ctx = "_: Wdc4Db2File")]
pub struct LightRecord {
    pub coords: Vec3,
    pub falloff_start: f32,
    pub falloff_end: f32,
    pub map_id: u16,
    light_param_ids: [u16; 8],
    pub unk: u16,
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
        // sort lightboxes by weight, highest to lowest
        result.sort_by(|a, b| b.weight.partial_cmp(&a.weight).unwrap());
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
    #[deku(reader = "db2.read_string(deku::input_bits, deku::bit_offset, 0)")]
    pub name: String,
    #[deku(reader = "db2.read_string_direct(deku::rest)")]
    pub tex0: String,
    #[deku(reader = "db2.read_string_direct(deku::rest)")]
    pub tex1: String,
    #[deku(reader = "db2.read_string_direct(deku::rest)")]
    pub tex2: String,
    #[deku(reader = "db2.read_string_direct(deku::rest)")]
    pub tex3: String,
    #[deku(reader = "db2.read_string_direct(deku::rest)")]
    pub tex4: String,
    #[deku(reader = "db2.read_string_direct(deku::rest)")]
    pub tex5: String,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 2)")]
    pub flags: u16,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 3)")]
    pub _sound_bank: u8,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 4)")]
    pub _sound_id: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 5)")]
    pub _f6: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 6)")]
    pub _max_darken_depth: f32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 7)")]
    pub _fog_darken_intensity: f32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 8)")]
    pub _ambient_darken_intensity: f32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 9)")]
    pub _dir_darken_intensity: f32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 10)")]
    pub _light_id: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 11)")]
    pub _particle_scale: f32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 12)")]
    pub _particle_movement: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 13)")]
    pub _particle_tex_slots: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 14)")]
    pub _particle_material_id: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 15)")]
    pub _minimap_colors: u32,
    #[deku(reader = "db2.read_vec(deku::input_bits, deku::bit_offset, 16)")]
    pub _unknown_colors: Vec<u32>,
    #[deku(reader = "db2.read_vec(deku::input_bits, deku::bit_offset, 17)")]
    pub _shader_color: Vec<u32>,
    #[deku(reader = "db2.read_vec(deku::input_bits, deku::bit_offset, 18)")]
    pub _shader_f32_params: Vec<f32>,
    #[deku(reader = "db2.read_vec(deku::input_bits, deku::bit_offset, 19)")]
    pub _shader_int_params: Vec<u32>,
    #[deku(reader = "db2.read_vec(deku::input_bits, deku::bit_offset, 20)", pad_bits_after = "5")]
    pub _coeffecients: Vec<u32>,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "db2: Wdc4Db2File")]
pub struct LightSkyboxRecord {
    #[deku(reader = "db2.read_string(deku::input_bits, deku::bit_offset, 0)")]
    pub name: String,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 1)")]
    pub flags: u16,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 2)")]
    pub _skybox_file_data_id: u32,
    #[deku(reader = "db2.read_field(deku::input_bits, deku::bit_offset, 3)", pad_bits_after = "26")]
    pub _celestial_skybox_file_data_id: u32,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "_: Wdc4Db2File")]
pub struct LiquidObject {
    pub _flow_direction: f32,
    pub _flow_speed: f32,
    pub _liquid_type_id: u32,
}

#[derive(DekuRead, Clone, Debug)]
#[deku(ctx = "_: Wdc4Db2File")]
pub struct LiquidTexture {
    pub _file_data_id: u32,
    pub _order_index: u32,
    pub _liquid_type_id: u32,
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

#[wasm_bindgen(js_name = "WowDatabase")]
pub struct Database {
    lights: DatabaseTable<LightRecord>,
    light_data: DatabaseTable<LightDataRecord>,
    light_params: DatabaseTable<LightParamsRecord>,
    light_skyboxes: DatabaseTable<LightSkyboxRecord>,
    liquid_types: DatabaseTable<LiquidType>,
}

#[wasm_bindgen(js_class = "WowDatabase")]
impl Database {
    pub fn new(
        lights_db: &[u8],
        light_data_db: &[u8],
        light_params_db: &[u8],
        liquid_types_db: &[u8],
        light_skybox_db: &[u8],
    ) -> Result<Database, String> {
        let lights = DatabaseTable::new(lights_db)?;
        let light_data = DatabaseTable::new(light_data_db)?;
        let light_params = DatabaseTable::new(light_params_db)?;
        let liquid_types = DatabaseTable::new(liquid_types_db)?;
        let light_skyboxes = DatabaseTable::new(light_skybox_db)?;
        Ok(Self {
            lights,
            light_data,
            light_params,
            liquid_types,
            light_skyboxes,
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

        let light_param = self.light_params.get_record(id as u32)?;
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

        let current_light_data = current_light_data.unwrap();
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

    pub fn get_lighting_data(&self, map_id: u16, x: f32, y: f32, z: f32, time: u32) -> LightResult {
        let mut outer_lights: Vec<(LightResult, f32)> = Vec::new();
        let coord = Vec3 { x, y, z };
        let default_light = self.get_default_light(map_id, time);

        for light in &self.lights.records {
            if light.map_id == map_id {
                match light.distance(&coord) {
                    DistanceResult::Inner => return self.get_light_result(light, time).unwrap_or(default_light),
                    DistanceResult::Outer(distance) => {
                        if let Some(outer_light) = self.get_light_result(light, time) {
                            let alpha = 1.0 - (distance - light.falloff_start) / (light.falloff_end - light.falloff_start);
                            outer_lights.push((outer_light, alpha));
                        }
                    },
                    DistanceResult::None => {},
                }
            }
        }

        if outer_lights.is_empty() {
            return default_light;
        }

        outer_lights.sort_unstable_by(|(_, alpha_a), (_, alpha_b)| {
            alpha_b.partial_cmp(alpha_a).unwrap()
        });

        let mut result = LightResult::default();
        let mut total_alpha = 0.0;
        for (outer_result, mut alpha) in &outer_lights {
            if total_alpha >= 1.0 {
                break;
            }

            if total_alpha + alpha >= 1.0 {
                alpha = 1.0 - total_alpha;
            }
            result.add_scaled(outer_result, alpha);
            total_alpha += alpha;
        }
        if total_alpha < 1.0 {
            result.add_scaled(&default_light, 1.0 - total_alpha);
        }

        result
    }

    pub fn get_all_skyboxes(&self, map_id: u16) -> Vec<SkyboxMetadata> {
        let mut names: HashSet<&str> = HashSet::new();
        let mut result = Vec::new();
        for light in &self.lights.records {
            if light.map_id == map_id {
                let id = light.light_param_ids[0];
                assert!(id != 0);
                let Some(light_param) = self.light_params.get_record(id as u32) else {
                    continue;
                };
                if let Some(skybox) = self.light_skyboxes.get_record(light_param.skybox_id) {
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
        }
        result
    }
}

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
    fn test_bitslicing() {
        let slice = BitSlice::from_slice(&[
            0, 0, 0, 0,
            0, 0, 0, 0,
            0, 0, 0, 0,
            0x01, 0x18, 0x00, 0x00,
        ]);
        assert_eq!(bitslice_to_u32(slice, 96, 10), 1);
        assert_eq!(bitslice_to_u32(slice, 106, 1), 0);
        assert_eq!(bitslice_to_u32(slice, 107, 2), 3);
        assert_eq!(bitslice_to_u32(slice, 109, 4), 0);
        assert_eq!(bitslice_to_u32(slice, 113, 3), 0);
        assert_eq!(bitslice_to_u32(slice, 116, 2), 0);
        assert_eq!(bitslice_to_u32(slice, 118, 3), 0);
        assert_eq!(bitslice_to_u32(slice, 121, 2), 0);
        let slice = BitSlice::from_slice(&[
            0, 0, 0, 0,
            0, 0, 0, 0,
            0, 0, 0, 0,
            0x02, 0x38, 0x0, 0x0,
        ]);
        assert_eq!(bitslice_to_u32(slice, 96, 10), 2);
        assert_eq!(bitslice_to_u32(slice, 106, 1), 0);
        assert_eq!(bitslice_to_u32(slice, 107, 2), 3);
        assert_eq!(bitslice_to_u32(slice, 109, 4), 1);
        assert_eq!(bitslice_to_u32(slice, 113, 3), 0);
        assert_eq!(bitslice_to_u32(slice, 116, 2), 0);
        assert_eq!(bitslice_to_u32(slice, 118, 3), 0);
        assert_eq!(bitslice_to_u32(slice, 121, 2), 0);
    }

    #[test]
    fn test() {
        let sheep_path = "../data/WorldOfWarcraft/sheep0";
        let d1 = SheepfileManager::load_file_id_data(sheep_path, 1375579).unwrap(); // lightDbData
        let d2 = SheepfileManager::load_file_id_data(sheep_path, 1375580).unwrap(); // lightDataDbData
        let d3 = SheepfileManager::load_file_id_data(sheep_path, 1334669).unwrap(); // lightParamsDbData
        let d4 = SheepfileManager::load_file_id_data(sheep_path, 1371380).unwrap(); // liquidTypes
        let d5 = SheepfileManager::load_file_id_data(sheep_path, 1308501).unwrap(); // lightSkyboxData
        let db = Database::new(&d1, &d2, &d3, &d4, &d5).unwrap();
        let result = db.get_lighting_data(0, -8693.8720703125, 646.1775512695312, 125.26680755615234, 1440);
        dbg!(result);
    }

    #[test]
    fn test_liquid_type() {
        let d5 = std::fs::read("../data/wotlk/dbfilesclient/liquidtype.db2").unwrap();
        let db: DatabaseTable<LiquidType> = DatabaseTable::new(&d5).unwrap();
        dbg!(&db.get_record(20).unwrap().name);
        dbg!(&db.get_record(21).unwrap().name);
        dbg!(&db.get_record(22));
        dbg!(&db.get_record(41).unwrap().name);
    }

    #[test]
    fn test_skybox() {
        let d5 = std::fs::read("../data/wotlk/dbfilesclient/lightskybox.db2").unwrap();
        let db: DatabaseTable<LightSkyboxRecord> = DatabaseTable::new(&d5).unwrap();
        dbg!(&db.records[0..4]);
    }
}
