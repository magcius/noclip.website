use deku::{prelude::*};
use wasm_bindgen::prelude::*;

use super::common::{ChunkedData, AABBox, Vec3, parse};

#[wasm_bindgen(js_name = "WowWdt", getter_with_clone)]
pub struct Wdt {
    pub header: Mphd,
    area_infos: Vec<AreaInfo>,
    map_filedata_ids: Vec<MapFileDataIDs>,
    pub global_wmo: Option<GlobalWmoDefinition>,
}

#[wasm_bindgen(js_class = "WowWdt")]
impl Wdt {
    pub fn new(data: &[u8]) -> Result<Wdt, String> {
        let mut chunked_data = ChunkedData::new(data);
        let mut header: Option<Mphd> = None;
        let mut area_infos: Vec<AreaInfo> = Vec::with_capacity(4096);
        let mut map_filedata_ids: Vec<MapFileDataIDs> = Vec::with_capacity(4096);
        let mut global_wmo: Option<GlobalWmoDefinition> = None;
        for (chunk, chunk_data) in &mut chunked_data {
            match &chunk.magic {
                b"NIAM" => {
                    let size = 2 * 4;
                    for i in 0..4096 {
                        area_infos.push(parse(&chunk_data[i*size..(i+1)*size])?)
                    }
                },
                b"DIAM" => {
                    let size = 8 * 4;
                    for i in 0..4096 {
                        map_filedata_ids.push(parse(&chunk_data[i*size..(i+1)*size])?)
                    }
                },
                b"DHPM" => header = Some(parse(chunk_data)?),
                b"FDOM" => global_wmo = Some(parse(chunk_data)?),
                _ => println!("skipping {}", chunk.magic_str()),
            }
        }
        if area_infos.is_empty() || map_filedata_ids.is_empty() {
            return Err("WDT file has no map filedata!".to_string());
        }
        Ok(Wdt {
            header: header.ok_or("WDT has no header chunk!".to_string())?,
            area_infos,
            map_filedata_ids,
            global_wmo,
        })
    }

    pub fn wdt_uses_global_map_obj(&self) -> bool { (self.header.flags & 0x0001) > 0 }
    pub fn adt_has_mccv(&self) -> bool { (self.header.flags & 0x0002) > 0 }
    pub fn adt_has_big_alpha(&self) -> bool { (self.header.flags & 0x0004) > 0 }
    pub fn adt_has_height_texturing(&self) -> bool { (self.header.flags & 0x0080) > 0 }

    pub fn get_loaded_map_data(&self) -> Vec<MapFileDataIDs> {
        let mut result = Vec::new();
        for i in 0..self.area_infos.len() {
            if self.area_infos[i].flags != 2 {
                result.push(self.map_filedata_ids[i].clone());
            }
        }
        result
    }

    pub fn get_all_map_data(&self) -> Vec<MapFileDataIDs> {
        self.map_filedata_ids.clone()
    }
}

#[wasm_bindgen(js_name = "WowGlobalWmoDefinition")]
#[derive(DekuRead, Debug, Clone)]
pub struct GlobalWmoDefinition {
    pub name_id: u32,
    pub unique_id: u32,
    pub position: Vec3,
    pub rotation: Vec3,
    pub extents: AABBox,
    pub flags: u16,
    pub doodad_set: u16,
    #[deku(pad_bytes_after = "2")]
    pub name_set: u16,
}

#[wasm_bindgen(js_name = "WowAreaInfo")]
#[derive(Debug, DekuRead, Clone)]
pub struct AreaInfo {
    pub flags: u32,
    pub async_id: u32,
}

#[wasm_bindgen(js_class = "WowAreaInfo")]
impl AreaInfo {
    pub fn is_all_water(&self) -> bool {
        (self.flags & 0b01) == 1
    }

    pub fn is_loaded(&self) -> bool {
        (self.flags & 0b10) == 1
    }
}

#[wasm_bindgen(js_name = "WowMphd")]
#[derive(Debug, DekuRead, Clone, Copy)]
pub struct Mphd {
    pub flags: u32,
    pub lgt_file_data_id: u32,
    pub occ_file_data_id: u32,
    pub fogs_file_data_id: u32,
    pub mpv_file_data_id: u32,
    pub tex_file_data_id: u32,
    pub wdl_file_data_id: u32,
    pub pd4_file_data_id: u32,
}

#[wasm_bindgen(js_name = "WowMapFileDataIDs")]
#[derive(DekuRead, Debug, Clone)]
pub struct MapFileDataIDs {
    pub root_adt: u32, // reference to fdid of mapname_xx_yy.adt
    pub obj0_adt: u32, // reference to fdid of mapname_xx_yy_obj0.adt
    pub obj1_adt: u32, // reference to fdid of mapname_xx_yy_obj1.adt
    pub tex0_adt: u32, // reference to fdid of mapname_xx_yy_tex0.adt
    pub lod_adt: u32,  // reference to fdid of mapname_xx_yy_lod.adt
    pub map_texture: u32, // reference to fdid of mapname_xx_yy.blp
    pub map_texture_n: u32, // reference to fdid of mapname_xx_yy_n.blp
    pub minimap_texture: u32, // reference to fdid of mapxx_yy.blp
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test() {
        let data = std::fs::read("../data/wotlk/world/maps/tanarisinstance/tanarisinstance.wdt").unwrap();
        dbg!(Wdt::new(&data).unwrap().header.flags);
    }
}
