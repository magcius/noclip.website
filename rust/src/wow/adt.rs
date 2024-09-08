use deku::bitvec::Lsb0;
use deku::{bitvec::BitSlice, prelude::*};
use deku::ctx::ByteSize;
use wasm_bindgen::prelude::*;

use super::common::{Chunk, parse, parse_array, parse_with_byte_size, ChunkedData, Vec3, AABBox};

pub const TILE_SIZE: f32 = 1600.0 / 3.0;
pub const CHUNK_SIZE: f32 = TILE_SIZE / 16.0;
pub const UNIT_SIZE: f32 = CHUNK_SIZE / 8.0;

#[wasm_bindgen(js_name = "WowAdt", getter_with_clone)]
#[derive(Debug, Clone)]
pub struct Adt {
    map_chunks: Vec<MapChunk>,
    doodads: Vec<Doodad>,
    height_tex_ids: Option<HeightTexIds>,
    diffuse_tex_ids: Option<DiffuseTexIds>,
    map_object_defs: Vec<WmoDefinition>,
    lod_doodads: Vec<Doodad>,
    lod_doodad_extents: Vec<LodExtent>,
    lod_map_object_defs: Vec<WmoDefinition>,
    lod_levels: Option<LodLevels>,
    liquids: Vec<Option<LiquidData>>,
}

#[wasm_bindgen(js_class = "WowAdt")]
impl Adt {
    pub fn new(data: &[u8]) -> Result<Adt, String> {
        let mut chunked_data = ChunkedData::new(data);
        let mut map_chunks: Vec<MapChunk> = Vec::with_capacity(256);
        let mut liquid_data: Option<(LiquidHeader, &[u8])> = None;
        for (chunk, chunk_data) in &mut chunked_data {
            match &chunk.magic {
                b"KNCM" => map_chunks.push(MapChunk::new(chunk, chunk_data)?),
                b"O2HM" => {
                    assert!(liquid_data.is_none());
                    let header: LiquidHeader = parse(chunk_data)?;
                    // save this for later parsing, since map chunks might not
                    // have been parsed yet
                    liquid_data = Some((header, chunk_data));
                },
                _ => println!("skipping {}", std::str::from_utf8(&chunk.magic).unwrap()),
            }
        }

        let adt_base_pos = &map_chunks[0].header.position;
        let mut liquids: Vec<Option<LiquidData>> = Vec::new();
        if let Some((liquid_header, data)) = liquid_data {
            let mut instance_chunks: Vec<(Vec<LiquidInstance>, Vec<usize>)> = Vec::with_capacity(liquid_header.chunks.len());
            let mut instance_offsets: Vec<usize> = Vec::new();
            for i in 0..liquid_header.chunks.len() {
                let instance_header = &liquid_header.chunks[i];
                if instance_header.attributes_offset > 0 {
                    instance_offsets.push(instance_header.attributes_offset as usize);
                }
                let start = instance_header.instances_offset as usize;
                let end = start + instance_header.layer_count as usize * 0x18;
                let instances: Vec<LiquidInstance> = parse_array(&data[start..end], 0x18)?;
                for instance in &instances {
                    if instance.bitmask_offset > 0 {
                        instance_offsets.push(instance.bitmask_offset as usize);
                    }
                    if instance.vertex_data_offset > 0 {
                        instance_offsets.push(instance.vertex_data_offset as usize);
                    }
                }
                instance_chunks.push((instances, Vec::new()));
            }
            instance_offsets.push(data.len());
            instance_offsets.sort();

            // calculate the size of each instance's vertex attributes section
            // to determine its format (see https://wowdev.wiki/ADT/v18#instance_vertex_data)
            for (instances, ref mut vertex_data_sizes) in instance_chunks.iter_mut() {
                for instance in instances {
                    if instance.vertex_data_offset == 0 {
                        vertex_data_sizes.push(0);
                        continue;
                    }
                    let height = instance.height as usize;
                    let width = instance.width as usize;
                    let next_offset_index = instance_offsets.iter().position(|offset| *offset == instance.vertex_data_offset as usize).unwrap() + 1;
                    let size = instance_offsets[next_offset_index] - instance.vertex_data_offset as usize;
                    let n_vertices = (height + 1) * (width + 1);
                    assert_eq!(size % n_vertices, 0);
                    assert!([1, 5, 8, 9].contains(&(size / n_vertices)));
                    vertex_data_sizes.push(size / n_vertices);
                }
            }

            for (i, (instances, vertex_data_sizes)) in instance_chunks.drain(..).enumerate() {
                let x_chunk = (i / 16) as f32;
                let y_chunk = (i % 16) as f32;
                let x_coord = adt_base_pos.x - x_chunk * CHUNK_SIZE; 
                let y_coord = adt_base_pos.y - y_chunk * CHUNK_SIZE;
                let liquid = LiquidData::parse(instances, vertex_data_sizes, x_coord, y_coord, data)?;
                liquids.push(liquid);
            }
        }
        
        Ok(Adt {
            map_chunks,
            doodads: vec![],
            map_object_defs: vec![],
            lod_doodads: vec![],
            lod_doodad_extents: vec![],
            lod_map_object_defs: vec![],
            height_tex_ids: None,
            diffuse_tex_ids: None,
            lod_levels: None,
            liquids,
        })
    }

    pub fn take_chunk_liquid_data(&mut self, chunk_index: usize) -> Option<Vec<LiquidLayer>> {
        if chunk_index >= self.liquids.len() {
            return None;
        }
        self.liquids.push(None);
        let liquid_data = self.liquids.swap_remove(chunk_index)?;
        Some(liquid_data.layers)
    }

    pub fn get_texture_file_ids(&self) -> Vec<u32> {
        let mut ids = Vec::new();
        if let Some(tex) = self.height_tex_ids.as_ref() { ids.extend(&tex.file_data_ids) }
        if let Some(tex) = self.diffuse_tex_ids.as_ref() { ids.extend(&tex.file_data_ids) }
        ids.retain(|&id| id != 0);
        ids
    }

    pub fn get_model_file_ids(&self, lod_level: usize) -> Vec<u32> {
        assert!(lod_level <= 1);
        if lod_level == 0 {
            self.doodads.iter().map(|doodad| doodad.name_id).collect()
        } else if let Some(lod_levels) = &self.lod_levels {
            let offset = lod_levels.m2_lod_offset[2] as usize;
            let length = lod_levels.m2_lod_length[2] as usize;
            self.lod_doodads[offset..offset+length].iter()
                .map(|doodad| doodad.name_id)
                .collect()
        } else {
            vec![]
        }
    }

    pub fn get_doodads(&self, lod_level: usize) -> Vec<Doodad> {
        assert!(lod_level <= 1);
        if lod_level == 0 {
            self.doodads.clone()
        } else if let Some(lod_levels) = &self.lod_levels {
            let offset = lod_levels.m2_lod_offset[2] as usize;
            let length = lod_levels.m2_lod_length[2] as usize;
            self.lod_doodads[offset..offset+length].to_vec()
        } else {
            vec![]
        }
    }

    pub fn get_wmo_defs(&self, lod_level: usize) -> Vec<WmoDefinition> {
        assert!(lod_level <= 1);
        if lod_level == 0 {
            self.map_object_defs.clone()
        } else if let Some(lod_levels) = &self.lod_levels {
            let offset = lod_levels.wmo_lod_offset[2] as usize;
            let length = lod_levels.wmo_lod_length[2] as usize;
            self.lod_map_object_defs[offset..offset+length].to_vec()
        } else {
            vec![]
        }
    }

    pub fn append_lod_obj_adt(&mut self, data: &[u8]) -> Result<(), String> {
        let mut chunked_data = ChunkedData::new(data);
        let mut lod_wmos: Option<Vec<LodWmoDefinition>> = None;
        let mut lod_wmo_extents: Option<Vec<LodExtent>> = None;
        for (chunk, chunk_data) in &mut chunked_data {
            match &chunk.magic {
                b"DFLM" => self.lod_levels = Some(parse(chunk_data)?),
                b"DDLM" => self.lod_doodads = parse_array(chunk_data, 0x24)?,
                b"XDLM" => self.lod_doodad_extents = parse_array(chunk_data, 0x1c)?,
                b"DMLM" => lod_wmos = Some(parse_array(chunk_data, 0x28)?),
                b"XMLM" => lod_wmo_extents = Some(parse_array(chunk_data, 0x1c)?),
                _ => println!("skipping {}", std::str::from_utf8(&chunk.magic).unwrap()),
            }
        }
        assert_eq!(self.lod_doodads.len(), self.lod_doodad_extents.len());
        match (lod_wmos, lod_wmo_extents) {
            (Some(wmos), Some(wmo_extents)) => {
                assert_eq!(wmos.len(), wmo_extents.len());
                for i in 0..wmos.len() {
                    self.lod_map_object_defs.push(WmoDefinition {
                        name_id: wmos[i].name_id,
                        unique_id: wmos[i].unique_id,
                        position: wmos[i].position,
                        rotation: wmos[i].rotation,
                        flags: wmos[i].flags,
                        doodad_set: wmos[i].doodad_set,
                        name_set: wmos[i].name_set,
                        scale: wmos[i].scale,
                        extents: wmo_extents[i].extents,
                    });
                }
            },
            (None, None) => {},
            (_, _) => return Err("lod adt was missing some lod components".to_string()),
        }
        Ok(())
    }

    pub fn append_obj_adt(&mut self, data: &[u8]) -> Result<(), String> {
        let mut chunked_data = ChunkedData::new(data);
        let mut map_chunk_idx = 0;
        for (chunk, chunk_data) in &mut chunked_data {
            match &chunk.magic {
                b"FDDM" => {
                    let mddf: DoodadChunk = parse_with_byte_size(chunk_data)?;
                    self.doodads = mddf.doodads;
                },
                b"KNCM" => {
                    self.map_chunks[map_chunk_idx].append_obj_chunk(chunk, chunk_data)?;
                    map_chunk_idx += 1;
                }
                b"FDOM" => self.map_object_defs = parse_array(chunk_data, 0x40)?,
                _ => println!("skipping {}", std::str::from_utf8(&chunk.magic).unwrap()),
            }
        }
        Ok(())
    }

    pub fn append_tex_adt(&mut self, data: &[u8]) -> Result<(), String> {
        let mut chunked_data = ChunkedData::new(data);
        let mut map_chunk_idx = 0;
        for (chunk, chunk_data) in &mut chunked_data {
            match &chunk.magic {
                b"KNCM" => {
                    self.map_chunks[map_chunk_idx].append_tex_chunk(chunk, chunk_data)?;
                    map_chunk_idx += 1;
                }
                b"DIHM" => self.height_tex_ids = Some(parse_with_byte_size(chunk_data)?),
                b"DIDM" => self.diffuse_tex_ids = Some(parse_with_byte_size(chunk_data)?),
                _ => println!("skipping {}", std::str::from_utf8(&chunk.magic).unwrap()),
            }
        }
        Ok(())
    }

    fn chunk_index_to_coords(index: usize) -> (f32, f32) {
        let mut x = (index / 17) as f32;
        let mut y = (index as f32) % 17.0;

        if y > 8.01 {
            x += 0.5;
            y -= 8.5;
        }
        (x, y)
    }

    fn get_vertex_buffer_and_extents(&self) -> (Vec<f32>, AABBox) {
        let mut result = Vec::with_capacity(256 * ADT_VBO_INFO.stride);
        let mut aabb = AABBox::default();
        for mcnk in &self.map_chunks {
            for j in 0..(9*9 + 8*8) {
                result.push(j as f32); // add the chunk index

                // position
                let (x, y) = Adt::chunk_index_to_coords(j);
                let x_coord = mcnk.header.position.x - (x * UNIT_SIZE); 
                let y_coord = mcnk.header.position.y - (y * UNIT_SIZE);
                let z_coord = mcnk.header.position.z + mcnk.heightmap.heightmap[j];
                result.push(x_coord);
                result.push(y_coord);
                result.push(z_coord);

                // update aabb
                aabb.update(x_coord, y_coord, z_coord);

                // normals
                let normals = &mcnk.normals.normals[j*3..];
                result.push(normals[0] as f32 / 127.0);
                result.push(normals[1] as f32 / 127.0);
                result.push(normals[2] as f32 / 127.0);

                let vertex_colors = match mcnk.vertex_colors.as_ref() {
                    Some(mccv) => &mccv.vertex_colors[j*4..],
                    None => &[127, 127, 127, 127],
                };
                result.push(vertex_colors[2] as f32 / 255.0); // r
                result.push(vertex_colors[1] as f32 / 255.0); // g
                result.push(vertex_colors[0] as f32 / 255.0); // b
                result.push(vertex_colors[3] as f32 / 255.0); // a

                let vertex_lighting = match mcnk.vertex_lighting.as_ref() {
                    Some(mclv) => &mclv.vertex_lighting[j*4..],
                    None => &[0, 0, 0, 0],
                };
                result.push(vertex_lighting[2] as f32 / 255.0); // r
                result.push(vertex_lighting[1] as f32 / 255.0); // g
                result.push(vertex_lighting[0] as f32 / 255.0); // b
                result.push(vertex_lighting[3] as f32 / 255.0); // a
            }
        }
        (result, aabb)
    }

    fn get_index_buffer_and_descriptors(&self, adt_has_big_alpha: bool, adt_has_height_texturing: bool) -> (Vec<u16>, Vec<ChunkDescriptor>) {
        let mut index_buffer = Vec::new();
        let mut descriptors = Vec::with_capacity(256);
        for (i, mcnk) in self.map_chunks.iter().enumerate() {
            let offset = (i as u16) * (9*9 + 8*8);
            let texture_layers = match (&mcnk.texture_layers, &self.diffuse_tex_ids) {
                (layers, Some(mdid)) => layers.iter()
                    .map(|layer| mdid.file_data_ids[layer.texture_index as usize])
                    .collect(),
                _ => vec![],
            };
            let mut index_count = 0;
            let index_offset = index_buffer.len();
            for y in 0..8 {
                for x in 0..8 {
                    if mcnk.header.is_hole(x, y) {
                        continue;
                    }
                    for k in 0..12 {
                        index_buffer.push(offset + SQUARE_INDICES_TRIANGLE[k] + 17 * (y as u16) + (x as u16));
                        index_count += 1;
                    }
                }
            }
            let alpha_texture = mcnk.build_alpha_texture(adt_has_big_alpha, adt_has_height_texturing);
            let shadow_texture = mcnk.build_shadow_texture();
            descriptors.push(ChunkDescriptor {
                texture_layers,
                index_offset,
                alpha_texture,
                shadow_texture,
                index_count,
            });
        }
        (index_buffer, descriptors)
    }

    pub fn get_render_result(&self, adt_has_big_alpha: bool, adt_has_height_texturing: bool) -> AdtRenderResult {
        let (vertex_buffer, extents) = self.get_vertex_buffer_and_extents();
        let (index_buffer, chunks) = self.get_index_buffer_and_descriptors(adt_has_big_alpha, adt_has_height_texturing);
        AdtRenderResult {
            vertex_buffer: Some(vertex_buffer),
            index_buffer: Some(index_buffer),
            chunks,
            extents,
        }
    }

    pub fn get_vbo_info() -> AdtVBOInfo {
        ADT_VBO_INFO.clone()
    }
}

#[derive(Debug, DekuRead, Clone)]
pub struct LodLevels {
    pub m2_lod_offset: [u32; 3],
    pub m2_lod_length: [u32; 3],
    pub wmo_lod_offset: [u32; 3],
    pub wmo_lod_length: [u32; 3],
}

#[wasm_bindgen(js_name = "WowAdtRenderResult", getter_with_clone)]
pub struct AdtRenderResult {
    pub vertex_buffer: Option<Vec<f32>>,
    pub index_buffer: Option<Vec<u16>>,
    pub chunks: Vec<ChunkDescriptor>,
    pub extents: AABBox,
}

#[wasm_bindgen(js_class = "WowAdtRenderResult")]
impl AdtRenderResult {
    pub fn take_vertex_buffer(&mut self) -> Vec<f32> {
        self.vertex_buffer.take().expect("ADT RenderResult vertex buffer already taken")
    }

    pub fn take_index_buffer(&mut self) -> Vec<u16> {
        self.index_buffer.take().expect("ADT RenderResult index buffer already taken")
    }
}

#[wasm_bindgen(js_name = "WowAdtChunkDescriptor", getter_with_clone)]
#[derive(Debug, Clone)]
pub struct ChunkDescriptor {
    pub texture_layers: Vec<u32>,
    pub alpha_texture: Option<Vec<u8>>,
    pub shadow_texture: Option<Vec<u8>>,
    pub index_offset: usize,
    pub index_count: usize,
}

static SQUARE_INDICES_TRIANGLE: &[u16] = &[
    9, 0, 17,
    9, 1, 0,
    9, 18, 1,
    9, 17, 18,
];

pub static ADT_VBO_INFO: AdtVBOInfo = AdtVBOInfo {
    stride:          (1 + 3 + 3 + 4 + 4) * 4,
    vertex_offset:   4,
    normal_offset:   (1 + 3) * 4,
    color_offset:    (1 + 3 + 3) * 4,
    lighting_offset: (1 + 3 + 3 + 4) * 4,
};

#[wasm_bindgen(js_name = "WowAdtVBOInfo")]
#[derive(Clone)]
pub struct AdtVBOInfo {
    pub stride: usize,
    pub vertex_offset: usize,
    pub normal_offset: usize,
    pub color_offset: usize,
    pub lighting_offset: usize,
}

#[derive(DekuRead, Debug, Clone)]
pub struct MapChunkFlags {
    #[deku(bits = 1)] pub _has_mcsh: bool,
    #[deku(bits = 1)] pub _impass: bool,
    #[deku(bits = 1)] pub _lq_river: bool,
    #[deku(bits = 1)] pub _lq_ocean: bool,
    #[deku(bits = 1)] pub _lq_magma: bool,
    #[deku(bits = 1)] pub _lq_slime: bool,
    #[deku(bits = 1)] pub _has_mccv: bool,
    #[deku(bits = 1, pad_bits_after = "7")] pub _unknown: bool,
    #[deku(bits = 1)] pub _do_not_fix_alpha_map: bool,
    #[deku(bits = 1, pad_bits_after = "15")] pub _high_res_holes: bool,
}

#[derive(DekuRead, Debug, Clone)]
pub struct MapChunkHeader {
    pub flags: u32,
    pub _index_x: u32,
    pub _index_y: u32,
    pub _n_layers: u32,
    pub _n_doodad_refs: u32,
    pub holes_high_res: u64,
    pub _ofs_layer: u32,
    pub _ofs_refs: u32,
    pub _ofs_alpha: u32,
    pub _size_alpha: u32,
    pub _ofs_shadow: u32,
    pub _size_shadow: u32,
    pub _area_id: u32,
    pub _n_map_obj_refs: u32,
    pub holes_low_res: u16,
    pub _unknown_but_used: u16,
    pub _low_quality_texture_map: [u16; 8],
    pub _no_effect_doodad: [u8; 8],
    pub _ofs_snd_emitters: u32,
    pub _n_snd_emitters: u32,
    pub _ofs_liquid: u32,
    pub _size_liquid: u32,
    pub position: Vec3,
    pub _mccv_offset: u32,
    pub _mclv_offset: u32,
    pub _unused: u32,
}

impl MapChunkHeader {
    pub fn is_hole(&self, x: usize, y: usize) -> bool {
        if (self.flags & 0x10000) > 0 {
            let hole_bytes = self.holes_high_res.to_le_bytes();
            ((hole_bytes[y] >> x) & 1) > 0
        } else {
            let holetab_h: [u16; 4] = [0x1111, 0x2222, 0x4444, 0x8888];
            let holetab_v: [u16; 4] = [0x000F, 0x00F0, 0x0F00, 0xF000];
            let i = x >> 1;
            let j = y >> 1;
            (self.holes_low_res & holetab_h[i] & holetab_v[j]) != 0
        }
    }
}

#[derive(Debug, Clone)]
pub struct MapChunk {
    pub header: MapChunkHeader,
    pub heightmap: HeightmapChunk,
    pub normals: NormalChunk,
    pub shadows: Option<ShadowMapChunk>,
    pub vertex_colors: Option<VertexColors>,
    pub vertex_lighting: Option<VertexLighting>,
    pub texture_layers: Vec<MapChunkTextureLayer>,
    pub alpha_map: Option<Vec<u8>>,
}

impl MapChunk {
    pub fn new(_chunk: Chunk, chunk_data: &[u8]) -> Result<Self, String> {
        let header = parse(chunk_data)?;

        let mut mcvt: Option<HeightmapChunk> = None;
        let mut mcnr: Option<NormalChunk> = None;
        let mut chunked_data = ChunkedData::new(&chunk_data[0x80..]);
        for (subchunk, subchunk_data) in &mut chunked_data {
            match &subchunk.magic {
                b"TVCM" => mcvt = Some(parse(subchunk_data)?),
                b"RNCM" => mcnr = Some(parse(subchunk_data)?),
                //_ => println!("skipping subchunk {}", subchunk.magic_str()),
                _ => {},
            }
        }

        Ok(MapChunk {
            header,
            normals: mcnr.ok_or("MapChunk had no MCNR chunk".to_string())?,
            heightmap: mcvt.ok_or("MapChunk had no MCVT chunk".to_string())?,

            // these will be appended in separate ADT files
            shadows: None,
            vertex_colors: None,
            vertex_lighting: None,
            alpha_map: None,
            texture_layers: vec![],
        })
    }

    pub fn build_shadow_texture(&self) -> Option<Vec<u8>> {
        let shadow_map = &self.shadows.as_ref()?.shadow_map;
        let mut result = vec![0; 64 * 64];
        for i in 0..64 {
            let row = shadow_map[i];
            for j in 0..64 {
                let sample = row & (1 << (j));
                if sample > 0 {
                    result[i * 64 + j] = 0xFF;
                } else {
                    result[i * 64 + j] = 0;
                }
            }
        }
        Some(result)
    }

    // These two flags come from the WDT definition block flags
    pub fn build_alpha_texture(&self, adt_has_big_alpha: bool, adt_has_height_texturing: bool) -> Option<Vec<u8>> {
        let alpha_map = &self.alpha_map.as_ref()?;
        assert!(!self.texture_layers.is_empty());
        let mut result = vec![0; (64 * 4) * 64];
        for layer_idx in 0..self.texture_layers.len() {
            let layer = &self.texture_layers[layer_idx];
            let mut alpha_offset = layer.offset_in_mcal as usize;
            let mut off_o = layer_idx;
            let settings = MapChunkTextureLayerSettings::from(layer.settings);
            if !settings.use_alpha_map {
                for i in 0..4096 {
                    result[off_o + i*4] = 255;
                }
            } else if settings.alpha_map_compressed {
                let mut read_this_layer = 0;
                while read_this_layer < 4096 {
                    let fill = (alpha_map[alpha_offset] & 0x80) > 0;
                    let n = alpha_map[alpha_offset] & 0x7F;
                    alpha_offset += 1;

                    for _ in 0..n {
                        if read_this_layer >= 4096 {
                            break;
                        }
                        result[off_o] = alpha_map[alpha_offset];
                        read_this_layer += 1;
                        off_o += 4;

                        if !fill {
                            alpha_offset += 1;
                        }
                    }
                    if fill {
                        alpha_offset += 1;
                    }
                }
            } else if adt_has_big_alpha || adt_has_height_texturing {
                // uncompressed (4096)
                for _ in 0..4096 {
                    result[off_o] = alpha_map[alpha_offset];
                    off_o += 4;
                    alpha_offset += 1;
                }
            } else {
                // uncompressed (2048)
                for _ in 0..2048 {
                    result[off_o] = (alpha_map[alpha_offset] & 0x0f) * 17;
                    off_o += 4;
                    result[off_o] = ((alpha_map[alpha_offset] & 0xf0) >> 4) * 17;
                    off_o += 4;
                    alpha_offset += 1;
                }
            }
        }
        Some(result)
    }

    fn append_obj_chunk(&mut self, _chunk: Chunk, chunk_data: &[u8]) -> Result<(), String> {
        let mut chunked_data = ChunkedData::new(chunk_data);
        for (subchunk, subchunk_data) in &mut chunked_data {
            match &subchunk.magic {
                b"VCCM" => self.vertex_colors = Some(parse(subchunk_data)?),
                b"VLCM" => self.vertex_lighting = Some(parse(subchunk_data)?),
                _ => {},
            }
        }
        Ok(())
    }

    fn append_tex_chunk(&mut self, _chunk: Chunk, chunk_data: &[u8]) -> Result<(), String> {
        let mut chunked_data = ChunkedData::new(chunk_data);
        for (subchunk, subchunk_data) in &mut chunked_data {
            match &subchunk.magic {
                b"YLCM" => self.texture_layers = parse_array(subchunk_data, 16)?,
                b"LACM" => self.alpha_map = Some(subchunk_data.to_vec()),
                b"HSCM" => self.shadows = Some(parse(subchunk_data)?),
                _ => {},
            }
        }
        Ok(())
    }
}

#[wasm_bindgen(js_name = "WowAdtChunkTextureLayer")]
#[derive(Clone, DekuRead)]
pub struct MapChunkTextureLayer {
    pub texture_index: u32, // index into MDID?
    pub settings: u32,
    pub offset_in_mcal: u32,
    pub effect_id: u32,
}

impl std::fmt::Debug for MapChunkTextureLayer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MapChunkTextureLayer")
            .field("texture_index", &self.texture_index)
            .field("settings", &MapChunkTextureLayerSettings::from(self.settings))
            .field("offset_in_mcal", &self.offset_in_mcal)
            .field("effect_id", &self.effect_id)
            .finish()
    }
}

#[wasm_bindgen(js_class = "WowAdtChunkTextureLayer")]
impl MapChunkTextureLayer {
    pub fn get_settings(&self) -> MapChunkTextureLayerSettings {
        MapChunkTextureLayerSettings::from(self.settings)
    }
}

#[wasm_bindgen(js_name = "WowAdtChunkTextureLayerSettings")]
#[derive(Debug, Clone, Copy)]
pub struct MapChunkTextureLayerSettings {
    pub use_cube_map_reflection: bool,
    pub alpha_map_compressed: bool,
    pub use_alpha_map: bool,
    pub overbright: bool,
    pub animation_enabled: bool,
    pub animation_speed: u32,
    pub animation_rotation: u32,
}

impl From<u32> for MapChunkTextureLayerSettings {
    fn from(value: u32) -> Self {
        MapChunkTextureLayerSettings {
            animation_rotation:       value & 0b00000000111,
            animation_speed:          value & 0b00000111000,
            animation_enabled:       (value & 0b00001000000) > 0,
            overbright:              (value & 0b00010000000) > 0,
            use_alpha_map:           (value & 0b00100000000) > 0,
            alpha_map_compressed:    (value & 0b01000000000) > 0,
            use_cube_map_reflection: (value & 0b10000000000) > 0,
        }
    }
}

#[derive(Debug, Clone, DekuRead)]
pub struct VertexColors {
    pub vertex_colors: [u8; 4 * (9*9 + 8*8)],
}

#[derive(Debug, Clone, DekuRead)]
pub struct VertexLighting {
    pub vertex_lighting: [u8; 4 * (9*9 + 8*8)],
}

#[derive(Debug, DekuRead)]
#[deku(ctx = "ByteSize(size): ByteSize")]
pub struct DoodadChunk {
    #[deku(count = "size / 0x24")]
    doodads: Vec<Doodad>
}

#[derive(Debug, Clone, DekuRead)]
#[deku(ctx = "ByteSize(size): ByteSize")]
pub struct DiffuseTexIds {
    #[deku(count = "size / 4")]
    pub file_data_ids: Vec<u32>
}

#[derive(Debug, Clone, DekuRead)]
#[deku(ctx = "ByteSize(size): ByteSize")]
pub struct HeightTexIds {
    #[deku(count = "size / 4")]
    pub file_data_ids: Vec<u32>
}

#[wasm_bindgen(js_name = "WowDoodad")]
#[derive(Debug, DekuRead, Clone)]
pub struct Doodad {
    pub name_id: u32,
    pub unique_id: u32,
    pub position: Vec3,
    pub rotation: Vec3,
    pub scale: u16,
    pub flags: u16
}

#[wasm_bindgen(js_name = "WowAdtWmoDefinition")]
#[derive(Debug, DekuRead, Clone)]
pub struct WmoDefinition {
    pub name_id: u32,
    pub unique_id: u32,
    pub position: Vec3,
    pub rotation: Vec3,
    pub extents: AABBox,
    pub flags: u16,
    pub doodad_set: u16,
    pub name_set: u16,
    pub scale: u16,
}

#[derive(Debug, Clone)]
pub struct LiquidData {
    layers: Vec<LiquidLayer>,
}

#[derive(DekuRead, Debug, Clone)]
struct LiquidUVMapEntry {
    pub x: u16,
    pub y: u16,
}

struct LiquidVertexAttributes<'a> {
    instance: &'a LiquidInstance,
    width: usize,
    height: usize,
    pub maybe_heightmap: Option<Vec<f32>>,
    pub maybe_depthmap: Option<Vec<u8>>,
    pub maybe_uv_map: Option<Vec<LiquidUVMapEntry>>,
}

impl<'a> LiquidVertexAttributes<'a> {
    pub fn parse(instance: &'a LiquidInstance, data: &[u8], size_per_attribute: usize) -> Result<Self, String> {
        let width = instance.width as usize + 1;
        let height = instance.height as usize + 1;

        let mut attribute_offset = instance.vertex_data_offset as usize;

        let maybe_heightmap = match size_per_attribute {
            5 | 8 | 9 => {
                let start = attribute_offset;
                let end = attribute_offset + 4 * width * height;
                let heightmap = parse_array(&data[start..end], 4)?;
                attribute_offset = end;
                Some(heightmap)
            },
            1 | 0 => None,
            _ => panic!("invalid size_per_attribute {}", size_per_attribute),
        };

        let maybe_depthmap = match size_per_attribute {
            5 | 1 | 9 => {
                let start = attribute_offset;
                let end = attribute_offset + width * height;
                let depthmap = parse_array(&data[start..end], 1)?;
                attribute_offset = end;
                Some(depthmap)
            },
            8 | 0 => None,
            _ => panic!("invalid size_per_attribute {}", size_per_attribute),
        };
        let maybe_uv_map = match size_per_attribute {
            8 | 9 => {
                let start = attribute_offset;
                let end = attribute_offset + 4 * width * height;
                let uv_map = parse_array(&data[start..end], 4)?;
                Some(uv_map)
            },
            1 | 5 | 0 => None,
            _ => panic!("invalid size_per_attribute {}", size_per_attribute),
        };

        Ok(Self {
            instance,
            width,
            height,
            maybe_depthmap,
            maybe_heightmap,
            maybe_uv_map,
        })
    }

    pub fn get_heightmap_value(&self, x: usize, y: usize) -> f32 {
        if let Some(heights) = self.maybe_heightmap.as_ref() {
            heights[y * self.width + x]
        } else {
            self.instance.min_height_level
        }
    }

    pub fn get_depthmap_value(&self, x: usize, y: usize) -> f32 {
        if let Some(depths) = self.maybe_depthmap.as_ref() {
            depths[y * self.width + x] as f32
        } else {
            1000.0 // default to pretty deep (since oceans don't have depthmaps)
        }
    }

    pub fn get_uv_value(&self, x: usize, y: usize) -> (f32, f32) {
        if let Some(uvs) = self.maybe_uv_map.as_ref() {
            let uv = &uvs[y * self.width + x];
            (uv.x as f32 / 8.0, uv.y as f32 / 8.0)
        } else {
            (y as f32 / (self.height - 1) as f32, x as f32 / (self.width - 1) as f32)
        }
    }
}

impl LiquidData {
    pub fn parse(mut instances: Vec<LiquidInstance>, vertex_data_sizes: Vec<usize>, chunk_x: f32, chunk_y: f32, data: &[u8]) -> Result<Option<Self>, String> {
        if instances.len() == 0 {
            return Ok(None);
        }
        assert_eq!(instances.len(), vertex_data_sizes.len());

        let mut layers: Vec<LiquidLayer> = Vec::with_capacity(instances.len());
        for (instance, vertex_data_size) in instances.drain(..).zip(vertex_data_sizes.iter()) {
            let mut liquid_bitmask_data: &[u8] = &[0xFF; 8];
            if instance.bitmask_offset > 0 && instance.height > 0 {
                let num_mask_bytes = ((instance.height as f32 * instance.width as f32) / 8.0).ceil() as usize;
                assert!(num_mask_bytes <= 8);
                let start = instance.bitmask_offset as usize;
                let end = start + num_mask_bytes;
                liquid_bitmask_data = &data[start..end];
            }
            let liquid_bitmask = BitSlice::<_, Lsb0>::from_slice(liquid_bitmask_data);

            let height = instance.height as usize + 1;
            let width = instance.width as usize + 1;

            let vertex_attributes = LiquidVertexAttributes::parse(&instance, &data, *vertex_data_size)
                .map_err(|e| format!("{:?}", e))?;

            let mut extents = AABBox::default();
            let mut vertices: Vec<f32> = Vec::with_capacity(5 * height * width);
            for y in 0..height {
                for x in 0..width {
                    let x_pos = chunk_x - (y as f32 + instance.x_offset as f32) * UNIT_SIZE;
                    let y_pos = chunk_y - (x as f32 + instance.y_offset as f32) * UNIT_SIZE;
                    let z_pos = vertex_attributes.get_heightmap_value(x, y);
                    let (u, v) = vertex_attributes.get_uv_value(x, y);
                    let depth = vertex_attributes.get_depthmap_value(x, y);

                    vertices.push(x_pos);
                    vertices.push(y_pos);
                    vertices.push(z_pos);
                    vertices.push(u);
                    vertices.push(v);
                    vertices.push(depth);
                    extents.update(x_pos, y_pos, z_pos);
                }
            }

            let mut bit_offset = 0;
            let mut indices: Vec<u16> = Vec::new();
            for y in 0..height - 1 {
                for x in 0..width - 1 {
                    if *liquid_bitmask.get(bit_offset).as_deref().unwrap_or(&false) {
                        let vert_indices = [
                            y * width + x,
                            y * width + x + 1,
                            (y + 1) * width + x,
                            (y + 1) * width + x + 1,
                        ];
                        indices.push(vert_indices[0] as u16);
                        indices.push(vert_indices[1] as u16);
                        indices.push(vert_indices[2] as u16);

                        indices.push(vert_indices[1] as u16);
                        indices.push(vert_indices[3] as u16);
                        indices.push(vert_indices[2] as u16);
                    }
                    bit_offset += 1;
                }
            }
            layers.push(LiquidLayer {
                instance,
                extents,
                vertices: Some(vertices),
                indices: Some(indices),
            });
        }
        Ok(Some(LiquidData {
            layers,
        }))
    }
}

#[wasm_bindgen(js_name = "WowAdtLiquidLayer", getter_with_clone)]
#[derive(Debug, Clone)]
pub struct LiquidLayer {
    instance: LiquidInstance,
    pub extents: AABBox,
    vertices: Option<Vec<f32>>,
    indices: Option<Vec<u16>>,
}

#[wasm_bindgen(js_class = "WowAdtLiquidLayer")]
impl LiquidLayer {
    pub fn get_liquid_type(&self) -> u16 {
        self.instance.liquid_type
    }

    pub fn get_liquid_object_id(&self) -> u16 {
        self.instance.liquid_object_or_lvf
    }

    pub fn take_vertices(&mut self) -> Vec<f32> {
        self.vertices.take().expect("vertices already taken")
    }

    pub fn take_indices(&mut self) -> Vec<u16> {
        self.indices.take().expect("indices already taken")
    }
}

#[derive(DekuRead, Debug, Clone)]
pub struct LiquidHeader {
    #[deku(count = "256")]
    pub chunks: Vec<LiquidChunkHeader>,
}

#[derive(DekuRead, Debug, Clone)]
pub struct LiquidChunkHeader {
    pub instances_offset: u32,
    pub layer_count: u32,
    pub attributes_offset: u32,
}

#[derive(DekuRead, Debug, Clone)]
pub struct LiquidChunkAttributes {
    // These are both 8x8 bitmasks
    pub _fishable: [u8; 8],
    pub _deep: [u8; 8],
}

#[derive(DekuRead, Debug, Clone)]
pub struct LiquidInstance {
    pub liquid_type: u16,
    pub liquid_object_or_lvf: u16,
    pub min_height_level: f32,
    pub _max_height_level: f32,
    pub x_offset: u8,
    pub y_offset: u8,
    pub width: u8,
    pub height: u8,
    pub bitmask_offset: u32,
    pub vertex_data_offset: u32,
}

#[derive(Debug, DekuRead, Clone)]
pub struct LodWmoDefinition {
    pub name_id: u32,
    pub unique_id: u32,
    pub position: Vec3,
    pub rotation: Vec3,
    pub flags: u16,
    pub doodad_set: u16,
    pub name_set: u16,
    pub scale: u16,
}

#[derive(Debug, DekuRead, Clone)]
pub struct LodExtent {
    pub extents: AABBox,
    pub _radius: f32,
}

#[derive(DekuRead, Debug, Clone)]
pub struct HeightmapChunk {
    // the heightmap stores a row of 9 height values, then 8 LOD height values,
    // then back to 9, and so on
    pub heightmap: [f32; 9*9 + 8*8],
}

#[derive(DekuRead, Debug, Clone)]
pub struct NormalChunk {
    pub normals: [i8; 3 * (9*9 + 8*8)],
}

#[derive(DekuRead, Debug, Clone)]
pub struct ShadowMapChunk {
    pub shadow_map: [u64; 64],
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wow::sheep::SheepfileManager;

    #[test]
    fn test() {
        let data = SheepfileManager::load_file_id_data("../data/WorldOfWarcraft/sheep1", 778432).unwrap();
        let _adt = Adt::new(&data).unwrap();
    }
}
