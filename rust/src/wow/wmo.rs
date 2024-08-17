use deku::{prelude::*, ctx::ByteSize};
use js_sys::{Float32Array, Uint16Array};
use nalgebra_glm::vec3;
use wasm_bindgen::prelude::*;

use crate::wow::common::{parse, parse_array, ChunkedData};

use super::{adt::UNIT_SIZE, common::{AABBox, Bgra, Plane, Quat, Rgba, Vec3}};

#[wasm_bindgen(js_name = "WowWmoHeader")]
#[derive(DekuRead, Debug, Copy, Clone)]
pub struct WmoHeader {
    pub num_textures: u32,
    pub num_groups: u32,
    pub num_portals: u32,
    pub num_lights: u32,
    pub num_doodad_names: u32,
    pub num_doodad_defs: u32,
    pub num_doodad_sets: u32,
    pub ambient_color: Bgra,
    pub wmo_id: u32,
    pub bounding_box: AABBox,
    pub flags: u16,
    pub num_lod: u16,
}

#[wasm_bindgen(js_class = "WowWmoHeader")]
impl WmoHeader {
    pub fn get_flags(&self) -> WmoHeaderFlags {
        WmoHeaderFlags::new(self.flags)
    }
}

#[wasm_bindgen(js_name = "WowWmoHeaderFlags")]
pub struct WmoHeaderFlags {
    pub attenuate_vertices_based_on_distance_to_portal: bool,
    pub skip_base_color: bool,
    pub use_liquid_type_dbc_id: bool,
    pub lighten_interiors: bool,
    pub lod: bool,
    pub default_max_lod: bool,
}

impl WmoHeaderFlags {
    pub fn new(x: u16) -> Self {
        Self {
            attenuate_vertices_based_on_distance_to_portal: x & 0x01 > 0,
            skip_base_color: x & 0x02 > 0,
            use_liquid_type_dbc_id: x & 0x04 > 0,
            lighten_interiors: x & 0x08 > 0,
            lod: x & 0x10 > 0,
            default_max_lod: x & 0x20 > 0,
        }
    }
}

#[wasm_bindgen(js_name = "WowWmo", getter_with_clone)]
#[derive(Debug, Clone)]
pub struct Wmo {
    pub header: WmoHeader,
    pub textures: Vec<WmoMaterial>,
    pub group_infos: Vec<GroupInfo>,
    pub group_file_ids: Vec<u32>,
    pub doodad_defs: Vec<DoodadDef>,
    pub doodad_file_ids: Vec<u32>,
    pub fogs: Vec<Fog>,
    pub skybox_file_id: Option<u32>,
    pub skybox_name: Option<String>,
    group_text: Vec<String>,
    doodad_sets: Vec<DoodadSet>,
    global_ambient_volumes: Vec<AmbientVolume>,
    portals: Option<Vec<Portal>>,
    portal_refs: Option<Vec<PortalRef>>,
    portal_vertices: Option<Vec<f32>>,
    ambient_volumes: Vec<AmbientVolume>,
}

#[wasm_bindgen(js_class = "WowWmo")]
impl Wmo {
    pub fn new(data: &[u8]) -> Result<Wmo, String> {
        let mut chunked_data = ChunkedData::new(data);
        let (mver, _) = chunked_data.next().unwrap();
        assert_eq!(mver.magic_str(), "REVM");
        let (mhdr, mhdr_data) = chunked_data.next().unwrap();
        assert_eq!(mhdr.magic_str(), "DHOM");
        let header: WmoHeader = parse(mhdr_data)?;
        let mut momt: Option<Vec<WmoMaterial>> = None;
        let mut mogi: Option<Vec<GroupInfo>> = None;
        let mut modd: Option<Vec<DoodadDef>> = None;
        let mut mfog: Option<Vec<Fog>> = None;
        let mut modi: Option<Vec<u32>> = None;
        let mut gfid: Option<Vec<u32>> = None;
        let mut mavg: Vec<AmbientVolume> = Vec::new();
        let mut mavd: Vec<AmbientVolume> = Vec::new();
        let mut portals: Option<Vec<Portal>> = None;
        let mut portal_refs: Option<Vec<PortalRef>> = None;
        let mut group_text = Vec::new();
        let mut portal_vertices: Option<Vec<f32>> = None;
        let mut skybox_name: Option<String> = None;
        let mut mods: Vec<DoodadSet> = Vec::new();
        let mut mosi: Option<Mosi> = None;
        for (chunk, chunk_data) in &mut chunked_data {
            match &chunk.magic {
                b"TMOM" => momt = Some(parse_array(chunk_data, 0x40)?),
                b"IGOM" => mogi = Some(parse_array(chunk_data, 0x20)?),
                b"DDOM" => modd = Some(parse_array(chunk_data, 40)?),
                b"GOFM" => mfog = Some(parse_array(chunk_data, 48)?),
                b"VPOM" => portal_vertices = Some(parse_array(chunk_data, 4)?),
                b"NGOM" => {
                    for s in chunk_data.split(|n| *n == 0) {
                        group_text.push(String::from_utf8_lossy(s)
                            .to_string());
                    }
                },
                b"TPOM" => portals = Some(parse_array(chunk_data, 20)?),
                b"RPOM" => portal_refs = Some(parse_array(chunk_data, 8)?),
                b"IDOM" => modi = Some(parse_array(chunk_data, 4)?),
                b"DIFG" => {
                    let ids: Vec<u32> = parse_array(chunk_data, 4)?;
                    dbg!(ids.len(), header.get_flags().lod, header.num_lod);
                    gfid = Some(ids);
                },
                b"DVAM" => mavd = parse_array(chunk_data, 0x30)?,
                b"GVAM" => mavg = parse_array(chunk_data, 0x30)?,
                b"ISOM" => mosi = Some(parse(chunk_data)?),
                b"BSOM" => {
                    let chars = chunk_data.split(|n| *n == 0).next()
                        .expect("skybox name had no data");
                    skybox_name = Some(String::from_utf8_lossy(chars).to_string());
                },
                b"SDOM" => mods = parse_array(chunk_data, 0x20)?,
                _ => println!("skipping {} chunk", chunk.magic_str()),
            }
        }
        Ok(Wmo {
            header,
            textures: momt.ok_or("WMO file didn't have MOMT chunk")?,
            group_infos: mogi.ok_or("WMO file didn't have MOGI chunk")?,
            doodad_defs: modd.ok_or("WMO file didn't have MODD chunk")?,
            doodad_file_ids: modi.unwrap_or_default(),
            fogs: mfog.ok_or("WMO file didn't have MFOG chunk")?,
            group_file_ids: gfid.ok_or("WMO file didn't have group ids")?,
            skybox_file_id: mosi.map(|m| m.skybox_file_id),
            skybox_name,
            doodad_sets: mods,
            portal_refs,
            portal_vertices,
            portals,
            group_text,
            global_ambient_volumes: mavg,
            ambient_volumes: mavd,
        })
    }

    pub fn take_portals(&mut self) -> Vec<Portal>{
        self.portals.take().expect("portals already taken")
    }

    pub fn take_portal_refs(&mut self) -> Vec<PortalRef>{
        self.portal_refs.take().expect("portals already taken")
    }

    pub fn take_portal_vertices(&mut self) -> Vec<f32>{
        self.portal_vertices.take().expect("portals already taken")
    }

    pub fn get_group_text(&self, index: usize) -> Option<String> {
        self.group_text.get(index).cloned()
    }

    pub fn get_ambient_color(&self, doodad_set_id: u16) -> Bgra {
        if self.global_ambient_volumes.len() > 0 {
            match self.global_ambient_volumes.iter().find(|av| av.doodad_set_id == doodad_set_id) {
                Some(av) => av.get_color(),
                None => self.global_ambient_volumes[0].get_color(),
            }
        } else if self.ambient_volumes.len() > 0 {
            self.ambient_volumes[0].get_color()
        } else {
            self.header.ambient_color
        }
    }

    pub fn get_doodad_set_refs(&self, mut doodad_set_id: usize) -> Vec<u32> {
        let default_set = &self.doodad_sets[0];
        if doodad_set_id >= self.doodad_sets.len() {
            doodad_set_id = 0;
        }
        let mut refs: Vec<u32> = (default_set.start_index..default_set.start_index + default_set.count).collect();
        if doodad_set_id != 0 {
            let set = &self.doodad_sets[doodad_set_id];
            refs.extend(set.start_index..set.start_index + set.count);
        }
        refs
    }

    pub fn get_doodad_defs(&self) -> Vec<DoodadDef> {
        self.doodad_defs.clone()
    }
}

#[wasm_bindgen(js_name = "WowWmoPortal", getter_with_clone)]
#[derive(DekuRead, Debug, Clone)]
pub struct Portal {
    pub start_vertex: u16,
    pub count: u16,
    pub plane: Plane,
}

#[wasm_bindgen(js_name = "WowWmoPortalRef")]
#[derive(DekuRead, Debug, Clone)]
pub struct PortalRef {
    pub portal_index: u16, // into MOPT
    pub group_index: u16,
    #[deku(pad_bytes_after = "2")]
    pub side: i16,
}

#[derive(DekuRead)]
pub struct Mosi {
    pub skybox_file_id: u32,
}

#[wasm_bindgen(js_name = "WowWmoGroup", getter_with_clone)]
#[derive(Debug, Clone)]
pub struct WmoGroup {
    pub header: WmoGroupHeader,
    indices: Option<Vec<u16>>,
    vertices: Option<Vec<f32>>,
    normals: Option<Vec<u8>>,
    uvs: Option<Vec<u8>>,
    colors: Option<Vec<u8>>,
    doodad_refs: Option<Vec<u16>>,
    bsp_tree: Option<BspTree>,
    pub num_vertices: usize,
    pub num_uv_bufs: usize,
    pub num_color_bufs: usize,
    pub first_color_buf_len: Option<usize>,
    pub batches: Vec<MaterialBatch>,
    pub replacement_for_header_color: Option<Rgba>,
    liquids: Option<Vec<WmoLiquid>>,
}

#[wasm_bindgen(js_class = "WowWmoGroup")]
impl WmoGroup {
    pub fn new(data: &[u8]) -> Result<WmoGroup, String> {
        let mut chunked_data = ChunkedData::new(data);
        let (mver, _) = chunked_data.next().unwrap();
        assert_eq!(mver.magic_str(), "REVM");
        let (_, mhdr_data) = chunked_data.next().unwrap();
        let header: WmoGroupHeader = parse(mhdr_data)?;
        let mut maybe_indices: Option<Vec<u16>> = None;
        let mut maybe_vertices: Option<Vec<f32>> = None;
        let mut maybe_normals: Option<Vec<u8>> = None;
        let mut uvs: Vec<u8> = Vec::new();
        let mut num_uv_bufs = 0;
        let mut liquids: Vec<WmoLiquid> = Vec::new();
        let mut colors: Vec<u8> = Vec::new();
        let mut first_color_buf_len: Option<usize> = None;
        let mut num_vertices = 0;
        let mut num_color_bufs = 0;
        let mut bsp_indices: Vec<u16> = Vec::new();
        let mut bsp_nodes: Vec<BspNode> = Vec::new();
        let mut batches: Option<Vec<MaterialBatch>> = None;
        let mut replacement_for_header_color: Option<Rgba> = None;
        let mut doodad_refs: Option<Vec<u16>> = None;
        let mut chunked_data = ChunkedData::new(&data[0x58..]);
        for (chunk, chunk_data) in &mut chunked_data {
            match &chunk.magic {
                b"IVOM" => maybe_indices = Some(parse_array(chunk_data, 2)?),
                b"LADM" => replacement_for_header_color = Some(parse(chunk_data)?),
                b"QILM" => liquids.push(parse(chunk_data)?),
                b"RBOM" => bsp_indices = parse_array(chunk_data, 2)?,
                b"NBOM" => bsp_nodes = parse_array(chunk_data, 0x10)?,
                b"TVOM" => {
                    num_vertices = chunk_data.len();
                    maybe_vertices = Some(parse_array(chunk_data, 4)?);
                },
                b"RNOM" => maybe_normals = Some(chunk_data.to_vec()),
                b"VTOM" => {
                    num_uv_bufs += 1;
                    uvs.extend(chunk_data.to_vec());
                },
                b"VCOM" => {
                    colors.extend(chunk_data.to_vec());
                    if first_color_buf_len.is_none() {
                        first_color_buf_len = Some(colors.len() / 4);
                    }
                    num_color_bufs += 1;
                },
                b"ABOM" => batches = Some(parse_array(chunk_data, 24)?),
                b"RDOM" => doodad_refs = Some(parse_array(chunk_data, 2)?),
                _ => println!("skipping {}", chunk.magic_str()),
            }
        }

        let mut maybe_liquids: Option<Vec<WmoLiquid>> = None;
        if !liquids.is_empty() {
            maybe_liquids = Some(liquids);
        }

        let vertices = maybe_vertices.ok_or("WMO group didn't have vertices")?;
        let indices = maybe_indices.ok_or("WMO group didn't have indices")?;

        let bsp_tree = BspTree {
            nodes: bsp_nodes,
            face_indices: bsp_indices,
            vertex_indices: indices.clone(),
            vertices: vertices.clone(),
        };

        Ok(WmoGroup {
            header,
            indices: Some(indices),
            vertices: Some(vertices),
            num_vertices,
            normals: Some(maybe_normals.ok_or("WMO group didn't have normals")?),
            liquids: maybe_liquids,
            replacement_for_header_color,
            first_color_buf_len,
            uvs: Some(uvs),
            num_uv_bufs,
            bsp_tree: Some(bsp_tree),
            colors: Some(colors),
            num_color_bufs,
            batches: batches.unwrap_or_default(),
            doodad_refs: Some(doodad_refs.unwrap_or_default()),
        })
    }

    pub fn take_bsp_tree(&mut self) -> BspTree {
        self.bsp_tree.take().expect("WmoGroup BSP tree already taken")
    }

    pub fn take_vertices(&mut self) -> Vec<f32> {
        self.vertices.take().expect("WmoGroup vertices already taken")
    }

    pub fn take_colors(&mut self) -> Vec<u8> {
        self.colors.take().expect("WmoGroup vertices already taken")
    }

    pub fn take_uvs(&mut self) -> Vec<u8> {
        self.uvs.take().expect("WmoGroup vertices already taken")
    }

    pub fn take_normals(&mut self) -> Vec<u8> {
        self.normals.take().expect("WmoGroup vertices already taken")
    }

    pub fn take_indices(&mut self) -> Vec<u16> {
        self.indices.take().expect("WmoGroup vertices already taken")
    }

    pub fn take_doodad_refs(&mut self) -> Vec<u16> {
        self.doodad_refs.take().expect("WmoGroup doodad_refs already taken")
    }

    pub fn take_liquid_data(&mut self) -> Option<Vec<LiquidResult>> {
        let liquids = self.liquids.take()?;
        let mut result = Vec::new();
        for liquid in liquids {
            result.push(liquid.get_render_result(&self.header));
        }
        Some(result)
    }
}

#[wasm_bindgen(js_name = "WowBspTree")]
#[derive(Debug, Clone)]
pub struct BspTree {
    nodes: Vec<BspNode>,
    face_indices: Vec<u16>,
    vertex_indices: Vec<u16>,
    vertices: Vec<f32>,
}

#[wasm_bindgen(js_name = "WowBspTreeResult")]
pub struct BspTreeResult {
    pub bary_x: f32,
    pub bary_y: f32,
    pub bary_z: f32,
    pub vert_index_0: usize,
    pub vert_index_1: usize,
    pub vert_index_2: usize,
}

#[wasm_bindgen(js_class = "WowBspTree")]
impl BspTree {
    pub fn contains_point(&self, x: f32, y: f32, z: f32) -> bool {
        self.pick_closest_tri_neg_z(x, y, z).is_some()
    }

    pub fn pick_closest_tri_neg_z(&self, x: f32, y: f32, z: f32) -> Option<BspTreeResult> {
        let mut min_dist = f32::INFINITY;
        let mut min_bsp_index: Option<usize> = None;
        let mut bary = vec3(0.0, 0.0, 0.0);

        let mut nodes = Vec::new();
        self.query(x, y, z, &mut nodes, 0);
        for node in nodes {
            let start = node.faces_start as usize;
            let end = start + node.num_faces as usize;
            for i in start..end {
                let (vertex0, vertex1, vertex2) = self.get_face_vertices(i);

                // check that the ray will intersect in the xy plane
                let min_x = vertex0[0].min(vertex1[0]).min(vertex2[0]);
                let max_x = vertex0[0].max(vertex1[0]).max(vertex2[0]);
                if x < min_x || x > max_x {
                    continue;
                }

                let min_y = vertex0[1].min(vertex1[1]).min(vertex2[1]);
                let max_y = vertex0[1].max(vertex1[1]).max(vertex2[1]);
                if y < min_y || y > max_y {
                    continue;
                }

                // check that the ray is above on z
                let min_z = vertex0[2].min(vertex1[2]).min(vertex2[2]);
                if z < min_z {
                    continue; // ray starts below triangle
                }

                // inlined rayTriangleIntersect, assuming that axis = negative z
                let ab = vertex1 - vertex0;
                let ac = vertex2 - vertex0;
                let n = ab.cross(&ac);

                if n[2] < 0.0001 {
                    continue; // backfacing triangle
                }

                let p = vec3(x, y, z);
                let temp = p - vertex0;
                let t = temp.dot(&n) / n[2];
                if t <= 0.0 || t >= min_dist {
                    continue;
                }

                // inlined cross assuming dir = negative z
                let ex = -temp[1];
                let ey = temp[0];
                let v = (ac[0]*ex + ac[1]*ey) / n[2];
                if v < 0.0 || v > 1.0 {
                    continue;
                }

                let w = (ab[0]*ex + ab[1]*ey) / -n[2];
                if w < 0.0 || v + w > 1.0 {
                    continue;
                }

                min_dist = t;
                min_bsp_index = Some(i);
                bary.x = v;
                bary.y = w;
                bary.z = 1.0 - v - w;
            }
        }

        let face_index = self.face_indices[min_bsp_index?] as usize;
        let indices = self.get_face_indices(face_index);
        Some(BspTreeResult {
            bary_x: bary.x,
            bary_y: bary.y,
            bary_z: bary.z,
            vert_index_0: indices.0,
            vert_index_1: indices.1,
            vert_index_2: indices.2,
        })
    }

    fn get_face_vertices(&self, bsp_face_index: usize) -> (nalgebra_glm::Vec3, nalgebra_glm::Vec3, nalgebra_glm::Vec3) {
        let face_index = self.face_indices[bsp_face_index] as usize;
        let (index0, index1, index2) = self.get_face_indices(face_index);
        let vertex0 = vec3(
            self.vertices[3 * index0 + 0],
            self.vertices[3 * index0 + 1],
            self.vertices[3 * index0 + 2],
        );
        let vertex1 = vec3(
            self.vertices[3 * index1 + 0],
            self.vertices[3 * index1 + 1],
            self.vertices[3 * index1 + 2],
        );
        let vertex2 = vec3(
            self.vertices[3 * index2 + 0],
            self.vertices[3 * index2 + 1],
            self.vertices[3 * index2 + 2],
        );
        (vertex0, vertex1, vertex2)
    }

    fn query<'a>(&'a self, x: f32, y: f32, z: f32, nodes: &mut Vec<&'a BspNode>, i: i16) {
        if i < 0 || self.nodes.is_empty() {
            return;
        }
        let node = &self.nodes[i as usize];
        if node.is_leaf() {
            nodes.push(node);
            return;
        }
        let axis = node.get_axis_type();
        if matches!(axis, BspAxisType::Z) {
            self.query(x, y, z, nodes, node.negative_child);
            self.query(x, y, z, nodes, node.positive_child);
        } else {
            let component = if matches!(axis, BspAxisType::X) { x } else { y };
            if component < node.plane_distance {
                self.query(x, y, z, nodes, node.negative_child);
            } else {
                self.query(x, y, z, nodes, node.positive_child);
            }
        }
    }

    fn get_face_indices(&self, face_index: usize) -> (usize, usize, usize) {
        (
            self.vertex_indices[3 * face_index + 0] as usize,
            self.vertex_indices[3 * face_index + 1] as usize,
            self.vertex_indices[3 * face_index + 2] as usize,
        )
    }
}

#[wasm_bindgen(js_name = "WowWmoLiquidResult")]
pub struct LiquidResult {
    vertices: Option<Vec<f32>>,
    indices: Option<Vec<u16>>,
    pub material_id: u16,
    pub extents: AABBox,
    pub liquid_type: u32,
}

#[wasm_bindgen(js_class = "WowWmoLiquidResult")]
impl LiquidResult {
    pub fn take_vertices(&mut self) -> Vec<f32> {
        self.vertices.take().expect("vertices already taken")
    }

    pub fn take_indices(&mut self) -> Vec<u16> {
        self.indices.take().expect("indices already taken")
    }
}

#[derive(DekuRead, Debug, Clone)]
pub struct LiquidVertex {
    pub data: u32,
    pub height: f32,
}

#[derive(DekuRead, Debug, Clone)]
pub struct LiquidTile {
    #[deku(bits = 1)]
    pub fishable: u8,
    #[deku(bits = 1)]
    pub shared: u8,
    #[deku(bits = 1)]
    pub _unknown_1: u8,
    #[deku(bits = 1)]
    pub _unknown_2: u8,
    #[deku(bits = 4)]
    pub data: u8,
}

impl LiquidTile {
    pub fn is_visible(&self) -> bool {
        self.data & 0x8 == 0
    }
}

#[derive(DekuRead, Debug, Clone)]
pub struct WmoLiquid {
    pub width: u32,
    pub height: u32,
    pub tile_width: u32,
    pub tile_height: u32,
    pub position: Vec3,
    pub material_id: u16,
    #[deku(count = "width * height")]
    vertices: Vec<LiquidVertex>,
    #[deku(count = "tile_width * tile_height")]
    tiles: Vec<LiquidTile>,
}

impl WmoLiquid {
    pub fn get_render_result(&self, _header: &WmoGroupHeader) -> LiquidResult {
        let width = self.tile_width as usize;
        let height = self.tile_height as usize;
        let mut vertex_prototypes = Vec::new();
        let mut indices = Vec::new();
        let mut extents = AABBox::default();
        for y in 0..height + 1 {
            for x in 0..width + 1 {
                let vertex = &self.vertices[y * (width + 1) + x];
                let pos_x = self.position.x + UNIT_SIZE * x as f32;
                let pos_y = self.position.y + UNIT_SIZE * y as f32;
                let pos_z = vertex.height;
                vertex_prototypes.push([
                    pos_x, pos_y, pos_z,
                    x as f32, y as f32,
                    1000.0, // default to deep, unsure if there's a better way
                ]);
                extents.update(pos_x, pos_y, pos_z);
            }
        }

        let mut vertices = Vec::new();
        let mut index = 0;
        let mut last_tile_liquid: Option<u8> = None;
        for y in 0..height {
            for x in 0..width {
                let tile_i = y * width + x;
                let tile = &self.tiles[tile_i];
                if !tile.is_visible() {
                    continue
                }

                let p = y * (width + 1) + x;
                for v_i in [p, p+1, p+width+1+1, p+width+1] {
                    for value in vertex_prototypes[v_i] {
                        vertices.push(value);
                    }
                }
                indices.push(index);
                indices.push(index + 1);
                indices.push(index + 2);

                indices.push(index + 2);
                indices.push(index + 3);
                indices.push(index);
                index += 4;

                if last_tile_liquid.is_none() {
                    last_tile_liquid = Some(tile.data);
                }
            }
        }
        LiquidResult {
            vertices: Some(vertices),
            indices: Some(indices),
            material_id: self.material_id,
            liquid_type: last_tile_liquid.unwrap() as u32,
            extents,
        }
    }
}

#[derive(DekuRead, Debug, Clone)]
pub struct DoodadSet {
    pub name: [u8; 0x14],
    pub start_index: u32,
    #[deku(pad_bytes_after = "4")]
    pub count: u32,
}

#[wasm_bindgen(js_name = "WowWmoBspNode")]
#[derive(DekuRead, Debug, Clone)]
pub struct BspNode {
    pub flags: u16,
    pub negative_child: i16,
    pub positive_child: i16,
    pub num_faces: u16,
    pub faces_start: u32,
    pub plane_distance: f32,
}

#[wasm_bindgen(js_name = "WowWmoBspAxisType")]
pub enum BspAxisType {
    X,
    Y,
    Z,
}

#[wasm_bindgen(js_class = "WowWmoBspNode")]
impl BspNode {
    pub fn get_axis_type(&self) -> BspAxisType {
        match self.flags & 0b111 {
            0 => BspAxisType::X,
            1 => BspAxisType::Y,
            2 => BspAxisType::Z,
            _ => panic!("invalid BSP node flags: {}", self.flags),
        }
    }

    pub fn is_leaf(&self) -> bool {
        self.flags & 0x4 > 0
    }
}

#[derive(DekuRead, Debug, Clone)]
pub struct AmbientVolume {
    pub position: Vec3,
    pub start: f32,
    pub end: f32,
    pub color1: Bgra,
    pub color2: Bgra,
    pub color3: Bgra,
    pub flags: u32,
    #[deku(pad_bytes_after = "10")]
    pub doodad_set_id: u16,
}

impl AmbientVolume {
    pub fn get_color(&self) -> Bgra {
        if self.flags & 1 > 0 {
            self.color3
        } else {
            self.color1
        }
    }
}

#[wasm_bindgen(js_name = "WowWmoMaterialPixelShader")]
#[derive(Copy, Clone, Debug)]
pub enum PixelShader {
    Diffuse = 0,
    Specular = 1,
    Metal = 2,
    Env = 3,
    Opaque = 4,
    EnvMetal = 5,
    TwoLayerDiffuse = 6, //MapObjComposite
    TwoLayerEnvMetal = 7,
    TwoLayerTerrain = 8,
    DiffuseEmissive = 9,
    MaskedEnvMetal = 10,
    EnvMetalEmissive = 11,
    TwoLayerDiffuseOpaque = 12,
    TwoLayerDiffuseEmissive = 13,
    AdditiveMaskedEnvMetal = 14,
    TwoLayerDiffuseMod2x = 15,
    TwoLayerDiffuseMod2xNA = 16,
    TwoLayerDiffuseAlpha = 17,
    Lod = 18,
    Parallax = 19,
    UnkShader = 20,
    None = 21,
}

#[wasm_bindgen(js_name = "WowWmoMaterialVertexShader")]
#[derive(Copy, Clone, Debug)]
pub enum VertexShader {
    DiffuseT1 = 0,
    DiffuseT1Refl = 1,
    DiffuseT1EnvT2 = 2,
    SpecularT1 = 3,
    DiffuseComp = 4,
    DiffuseCompRefl = 5,
    DiffuseCompTerrain = 6,
    DiffuseCompAlpha = 7,
    Parallax = 8,
    None = 9,
}

static STATIC_SHADERS: [(VertexShader, PixelShader); 24] = [
    (VertexShader::DiffuseT1, PixelShader::Diffuse),
    (VertexShader::SpecularT1, PixelShader::Specular),
    (VertexShader::SpecularT1, PixelShader::Metal),
    (VertexShader::DiffuseT1Refl, PixelShader::Env),
    (VertexShader::DiffuseT1, PixelShader::Opaque),
    (VertexShader::DiffuseT1Refl, PixelShader::EnvMetal),
    (VertexShader::DiffuseComp, PixelShader::TwoLayerDiffuse),
    (VertexShader::DiffuseT1, PixelShader::TwoLayerEnvMetal),
    (VertexShader::DiffuseCompTerrain, PixelShader::TwoLayerTerrain),
    (VertexShader::DiffuseComp, PixelShader::DiffuseEmissive),
    (VertexShader::None, PixelShader::None),
    (VertexShader::DiffuseT1EnvT2, PixelShader::MaskedEnvMetal),
    (VertexShader::DiffuseT1EnvT2, PixelShader::EnvMetalEmissive),
    (VertexShader::DiffuseComp, PixelShader::TwoLayerDiffuseOpaque),
    (VertexShader::None, PixelShader::None),
    (VertexShader::DiffuseComp, PixelShader::TwoLayerDiffuseEmissive),
    (VertexShader::DiffuseT1, PixelShader::Diffuse),
    (VertexShader::DiffuseT1EnvT2, PixelShader::AdditiveMaskedEnvMetal),
    (VertexShader::DiffuseCompAlpha, PixelShader::TwoLayerDiffuseMod2x),
    (VertexShader::DiffuseComp, PixelShader::TwoLayerDiffuseMod2xNA),
    (VertexShader::DiffuseCompAlpha, PixelShader::TwoLayerDiffuseAlpha),
    (VertexShader::DiffuseT1, PixelShader::Lod),
    (VertexShader::Parallax, PixelShader::Parallax),
    (VertexShader::DiffuseT1, PixelShader::UnkShader),
];

#[wasm_bindgen(js_name = "WowWmoMaterialBatch")]
#[derive(DekuRead, Debug, Clone)]
pub struct MaterialBatch {
    _unknown: [u8; 0xA],
    pub material_id_large: u16,
    pub start_index: u32,
    pub index_count: u16,
    pub first_vertex: u16,
    pub last_vertex: u16,
    pub use_material_id_large: u8,
    pub material_id: u8,
}

#[wasm_bindgen(js_name = "WowWmoGroupHeader", getter_with_clone)]
#[derive(DekuRead, Debug, Clone)]
pub struct WmoGroupHeader {
    pub group_name: u32, // offset to MOGN
    pub descriptive_group_name: u32, // offset to MOGN
    pub flags: u32,
    pub bounding_box: AABBox,
    pub portal_start: u16,
    pub portal_count: u16,
    pub trans_batch_count: u16,
    pub int_batch_count: u16,
    pub ext_batch_count: u16,
    pub padding_or_batch_type_d: u16,
    _fog_ids: [u8; 4],
    pub group_liquid: u32,
    pub group_flags2: u32,
    pub parent_or_first_child_split_group_index: u16,
    pub next_split_child_group_index: u16,
}

#[wasm_bindgen(js_name = "WowWmoGroupFlags")]
pub struct WmoGroupFlags {
    pub has_bsp_tree: bool,
    pub has_light_map: bool,
    pub has_vertex_colors: bool,
    pub exterior: bool,
    pub exterior_lit: bool, // do not use local diffuse lighting
    pub show_exterior_sky: bool,
    pub has_lights: bool,
    pub has_doodads: bool,
    pub has_water: bool,
    pub interior: bool,
    pub water_is_ocean: bool,
    pub antiportal: bool,
    pub show_skybox: bool,
}

#[wasm_bindgen(js_class = "WowWmoGroupFlags")]
impl WmoGroupFlags {
    pub fn new(x: u32) -> Self {
        Self {
            has_bsp_tree: x & 0x1 > 0,
            has_light_map: x & 0x2 > 0,
            has_vertex_colors: x & 0x4 > 0,
            exterior: x & 0x8 > 0,
            exterior_lit: x & 0x40 > 0,
            show_exterior_sky: x & 0x100 > 0,
            has_lights: x & 0x200 > 0,
            has_doodads: x & 0x800 > 0,
            has_water: x & 0x1000 > 0,
            interior: x & 0x2000 > 0,
            show_skybox: x & 0x40000 > 0,
            water_is_ocean: x & 0x80000 > 0,
            antiportal: x & 0x4000000 > 0,
        }
    }
}

#[derive(DekuRead, Debug)]
#[deku(ctx = "ByteSize(size): ByteSize")]
pub struct DoodadIds {
    #[deku(count = "size / 4")]
    pub file_ids: Vec<u32>,
}

#[wasm_bindgen(js_name = "WowWmoFog")]
#[derive(DekuRead, Debug, Clone)]
pub struct Fog {
    pub flags: u32,
    pub position: Vec3,
    pub smaller_radius: f32,
    pub larger_radius: f32,
    pub fog_end: f32,
    pub fog_start_scalar: f32,
    pub fog_color: Rgba,
    pub uw_fog_end: f32,
    pub uw_fog_start_scalar: f32,
    pub uw_fog_color: Bgra,
}

#[wasm_bindgen(js_name = "WowDoodadDef")]
#[derive(DekuRead, Debug, Clone)]
pub struct DoodadDef {
    pub name_index: i16,
    pub flags: u16,
    pub position: Vec3,
    pub orientation: Quat,
    pub scale: f32,
    pub color: Bgra,
}

#[wasm_bindgen(js_name = "WowWmoGroupInfo")]
#[derive(DekuRead, Debug, Clone)]
pub struct GroupInfo {
    pub flags: u32,
    pub bounding_box: AABBox,
    pub name_offset: i32, // offset in the MOGN chunk
}

#[wasm_bindgen(js_name = "WowWmoMaterialFlags")]
#[derive(Debug, Clone)]
pub struct WmoMaterialFlags {
    pub unlit: bool,
    pub unfogged: bool,
    pub unculled: bool,
    pub exterior_light: bool,
    pub sidn: bool,
    pub window: bool,
    pub clamp_s: bool,
    pub clamp_t: bool,
}

#[wasm_bindgen(js_class = "WowWmoMaterialFlags")]
impl WmoMaterialFlags {
    pub fn new(x: u32) -> Self {
        Self {
            unlit:          (x & (1 << 0)) > 0,
            unfogged:       (x & (1 << 1)) > 0,
            unculled:       (x & (1 << 2)) > 0,
            exterior_light: (x & (1 << 3)) > 0,
            sidn:           (x & (1 << 4)) > 0,
            window:         (x & (1 << 5)) > 0,
            clamp_s:        (x & (1 << 6)) > 0,
            clamp_t:        (x & (1 << 7)) > 0,
        }
    }
}

#[wasm_bindgen(js_name = "WowWmoMaterial")]
#[derive(DekuRead, Debug, Clone, Copy)]
pub struct WmoMaterial {
    pub flags: u32,
    pub shader_index: u32,
    pub blend_mode: u32,
    pub texture_1: u32,
    pub sidn_color: Bgra,
    pub frame_sidn_color: Bgra,
    pub texture_2: u32,
    pub diff_color: Bgra,
    pub ground_type: u32,
    pub texture_3: u32,
    pub color_2: Rgba,
    pub flags_2: u32,
    _runtime_data: [u32; 4],
}

#[wasm_bindgen(js_class = "WowWmoMaterial")]
impl WmoMaterial {
    pub fn get_vertex_shader(&self) -> VertexShader {
        STATIC_SHADERS[self.shader_index as usize].0
    }

    pub fn get_pixel_shader(&self) -> PixelShader {
        STATIC_SHADERS[self.shader_index as usize].1
    }
}
