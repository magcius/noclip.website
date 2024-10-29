use core::f32;
use std::collections::{HashMap, HashSet};

use deku::prelude::*;
use js_sys::Array;
use nalgebra_glm::{make_vec3, vec3, Vec2, Vec3};
use wasm_bindgen::prelude::*;

use crate::{
    geometry::{project_vec3_to_vec2, point_inside_polygon, Axis, ConvexHull, Plane, AABB},
    wow::common::{parse, parse_array, ChunkedData},
};

use super::{
    adt::UNIT_SIZE,
    common::{AABBox, Bgra, Plane as WowPlane, Quat, Rgba, Vec3 as WowVec3},
};

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
#[derive(Debug, Clone)]
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
    flags: WmoHeaderFlags,
    group_text: Vec<String>,
    doodad_sets: Vec<DoodadSet>,
    global_ambient_volumes: Vec<AmbientVolume>,
    portals: Vec<PortalData>,
    portal_refs: Vec<PortalRef>,
    ambient_volumes: Vec<AmbientVolume>,
    groups: HashMap<u32, WmoGroup>, // maps file_id to group
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
        let mut maybe_portals: Option<Vec<Portal>> = None;
        let mut maybe_portal_refs: Option<Vec<PortalRef>> = None;
        let mut group_text = Vec::new();
        let mut maybe_portal_vertices: Option<Vec<f32>> = None;
        let mut skybox_name: Option<String> = None;
        let mut mods: Vec<DoodadSet> = Vec::new();
        let mut mosi: Option<Mosi> = None;
        for (chunk, chunk_data) in &mut chunked_data {
            match &chunk.magic {
                b"TMOM" => momt = Some(parse_array(chunk_data, 0x40)?),
                b"IGOM" => mogi = Some(parse_array(chunk_data, 0x20)?),
                b"DDOM" => modd = Some(parse_array(chunk_data, 40)?),
                b"GOFM" => mfog = Some(parse_array(chunk_data, 48)?),
                b"VPOM" => maybe_portal_vertices = Some(parse_array(chunk_data, 4)?),
                b"NGOM" => {
                    for s in chunk_data.split(|n| *n == 0) {
                        group_text.push(String::from_utf8_lossy(s).to_string());
                    }
                }
                b"TPOM" => maybe_portals = Some(parse_array(chunk_data, 20)?),
                b"RPOM" => maybe_portal_refs = Some(parse_array(chunk_data, 8)?),
                b"IDOM" => modi = Some(parse_array(chunk_data, 4)?),
                b"DIFG" => {
                    let ids: Vec<u32> = parse_array(chunk_data, 4)?;
                    dbg!(ids.len(), header.get_flags().lod, header.num_lod);
                    gfid = Some(ids);
                }
                b"DVAM" => mavd = parse_array(chunk_data, 0x30)?,
                b"GVAM" => mavg = parse_array(chunk_data, 0x30)?,
                b"ISOM" => mosi = Some(parse(chunk_data)?),
                b"BSOM" => {
                    let chars = chunk_data
                        .split(|n| *n == 0)
                        .next()
                        .expect("skybox name had no data");
                    skybox_name = Some(String::from_utf8_lossy(chars).to_string());
                }
                b"SDOM" => mods = parse_array(chunk_data, 0x20)?,
                _ => println!("skipping {} chunk", chunk.magic_str()),
            }
        }
        let portal_vertices = maybe_portal_vertices.expect("WMO didn't have portal refs");
        let portals = maybe_portals
            .expect("WMO didn't have portals")
            .iter()
            .map(|portal| PortalData::new(&portal, &portal_vertices))
            .collect();
        Ok(Wmo {
            flags: WmoHeaderFlags::new(header.flags),
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
            portal_refs: maybe_portal_refs.expect("WMO didn't have portal refs"),
            portals,
            group_text,
            global_ambient_volumes: mavg,
            ambient_volumes: mavd,
            groups: HashMap::new(),
        })
    }

    pub fn append_group(&mut self, file_id: u32, data: &[u8]) -> Result<(), String> {
        self.groups.insert(file_id, WmoGroup::new(data)?);
        Ok(())
    }

    pub fn take_liquid_data(&mut self, group_id: u32) -> Vec<LiquidResult> {
        let group = self.groups.get_mut(&group_id).unwrap();
        if let Some(mut liquids) = group.take_liquid_data() {
            for liquid in &mut liquids {
                liquid.liquid_type = liquid.recalculate_liquid_type(&self.flags, group);
            }
            return liquids;
        }
        vec![]
    }

    pub fn find_visible_groups(&self, group_id: u32, point_slice: &[f32], frustum: &ConvexHull, exterior_frustums_js: &Array) -> Vec<u32> {
        let eye = Vec3::from_column_slice(point_slice);
        let mut visible_set = HashSet::new();
        let mut visited_set = HashSet::new();
        let mut exterior_frustums = Vec::new();
        self.traverse_portals(&eye, frustum, group_id, &mut visible_set, &mut visited_set, &mut exterior_frustums);
        for frustum in exterior_frustums {
            exterior_frustums_js.push(&frustum.into());
        }
        visible_set.into_iter().collect()
    }

    fn traverse_portals(
        &self,
        eye: &Vec3,
        frustum: &ConvexHull,
        group_id: u32,
        visible_set: &mut HashSet<u32>,
        visited_set: &mut HashSet<u32>,
        exterior_frustums: &mut Vec<ConvexHull>,
    ) {
        if visited_set.contains(&group_id) {
            return;
        }
        visible_set.insert(group_id);
        let group = self.get_group(group_id);
        for (portal_ref, portal) in self.group_portals(group) {
            let other_group_id = self.group_file_ids[portal_ref.group_index as usize];
            if !portal.is_facing_us(eye, portal_ref.side) {
                continue;
            }

            if portal.in_frustum(frustum) || portal.aabb_contains_point(eye) {
                let portal_frustum = portal.clip_frustum(eye, frustum);
                let other_group = self.get_group(other_group_id);
                // if this portal causes us to look outside, save its frustum for culling the outdoors
                if !group.flags.exterior && other_group.flags.exterior {
                    exterior_frustums.push(portal_frustum.clone());
                }
                // create a new visited_set just for this uniquely clipped frustum
                let mut visited_local = visited_set.clone();
                visited_local.insert(group_id);
                self.traverse_portals(eye, &portal_frustum, other_group_id, visible_set, &mut visited_local, exterior_frustums);
            }
        }
    }

    fn get_group(&self, file_id: u32) -> &WmoGroup {
        self.groups.get(&file_id).expect(&format!("couldn't find group with file_id {}", file_id))
    }

    pub fn find_group_for_modelspace_point(&self, point_slice: &[f32]) -> Option<u32> {
        let p = make_vec3(point_slice);
        let mut closest_group_id = None;
        let mut min_dist = f32::INFINITY;
        for (group_id, group) in &self.groups {
            if group.flags.unreachable || group.flags.antiportal || group.flags.unk_skip_membership_check {
                continue;
            }
            let aabb: AABB = group.header.bounding_box.into();
            if group.flags.exterior {
                if !aabb.contains_point_ignore_max_z(&p) {
                    continue;
                }
            } else {
                if !aabb.contains_point(&p) {
                    continue;
                }
            }

            let mut nodes = vec![];
            group.bsp_tree.query(&p, &mut nodes, 0);
            if group.bsp_tree.bounding_box_for_nodes(&nodes).contains_point(&p) {
                if let Some(bsp_result) = group.bsp_tree.pick_closest_tri_neg_z(&p, &nodes) {
                    if bsp_result.distance < min_dist {
                        min_dist = bsp_result.distance;
                        closest_group_id = Some(*group_id);
                    }
                }
            }

            if let Some(t) = self.modelspace_point_above_group_portals(group, &p) {
                if t < min_dist {
                    min_dist = t;
                    closest_group_id = Some(*group_id);
                }
            }
        }
        closest_group_id
    }

    fn group_portals(&self, group: &WmoGroup) -> PortalIter {
        PortalIter::new(group, self)
    }

    fn modelspace_point_above_group_portals(&self, group: &WmoGroup, p: &Vec3) -> Option<f32> {
        let neg_z = vec3(0.0, 0.0, -1.0);
        for (portal_ref, portal) in self.group_portals(group) {
            if portal.plane.normal.z.abs() < 0.001 {
                continue;
            }
            if !portal.is_facing_us(p, portal_ref.side) {
                continue;
            }

            let t = portal.plane.intersect_line(p, &neg_z);
            if t < 0.0 {
                continue;
            }

            let test_point = p + t * neg_z;
            let (projected_verts, axis) = portal.project_vertices_to_2d();
            let projected_test_point = project_vec3_to_vec2(&test_point, axis);
            if point_inside_polygon(&projected_test_point, &projected_verts) {
                return Some(t);
            }
        }
        None
    }

    pub fn get_vertex_color_for_modelspace_point(&self, group_id: u32, point_slice: &[f32]) -> Option<Vec<f32>> {
        let p = Vec3::from_column_slice(point_slice);
        let group = self.groups.get(&group_id).unwrap();
        // apparently this happens?
        if group.colors.len() == 0 {
            return None;
        }
        let mut nodes = vec![];
        group.bsp_tree.query(&p, &mut nodes, 0);
        let bsp_result = group.bsp_tree.pick_closest_tri_neg_z(&p, &nodes)?;
        let bary = vec3(bsp_result.bary_x, bsp_result.bary_y, bsp_result.bary_z);
        let mut components = Vec::new();
        for i in 0..4 {
            components.push(vec3(
                group.colors[4 * bsp_result.vert_index_0 + i] as f32 / 255.0,
                group.colors[4 * bsp_result.vert_index_1 + i] as f32 / 255.0,
                group.colors[4 * bsp_result.vert_index_2 + i] as f32 / 255.0,
            ));
        }
        Some(vec![
            components[0].dot(&bary),
            components[1].dot(&bary),
            components[2].dot(&bary),
            components[3].dot(&bary),
        ])
    }

    pub fn get_doodad_refs(&mut self, group_id: u32) -> Vec<u16> {
        let group = self.get_group(group_id);
        group.doodad_refs.clone()
    }

    pub fn group_in_modelspace_frustum(&self, group_id: u32, frustum: &ConvexHull) -> bool {
        let group = self.get_group(group_id);
        let aabb: AABB = group.header.bounding_box.into();
        frustum.contains_aabb(&aabb)
    }

    pub fn get_group_text(&self, index: usize) -> Option<String> {
        self.group_text.get(index).cloned()
    }

    pub fn dbg_get_portal_verts(&self, group_id: u32) -> Vec<f32> {
        let mut result = vec![];
        for (_, portal) in self.group_portals(self.get_group(group_id)) {
            result.push(portal.vertices.len() as f32);
            for v in &portal.vertices {
                result.extend(v);
            }
        }
        result
    }

    pub fn get_group_ambient_color(&self, group_id: u32, doodad_set_id: u16) -> Vec<f32> {
        let group = self.groups.get(&group_id).unwrap();
        if false && !group.flags.exterior && !group.flags.exterior_lit {
            if let Some(color) = group.replacement_for_header_color {
                return vec![
                    color.r as f32 / 255.0,
                    color.g as f32 / 255.0,
                    color.b as f32 / 255.0,
                    1.0,
                ];
            }
            let mut wmo_color = self.get_ambient_color(doodad_set_id);
            wmo_color[3] = 1.0;
            return wmo_color;
        }
        vec![0.0; 4]
    }

    pub fn get_group_batches(&self, group_id: u32) -> Vec<MaterialBatch> {
        let group = self.get_group(group_id);
        group.batches.clone()
    }

    pub fn get_group_descriptor(&self, group_id: u32) -> WmoGroupDescriptor {
        let group = self.get_group(group_id);
        WmoGroupDescriptor {
            group_id,
            interior: group.flags.interior,
            exterior: group.flags.exterior,
            antiportal: group.flags.antiportal,
            always_draw: group.flags.always_draw,
            exterior_lit: group.flags.exterior_lit,
            show_skybox: group.flags.show_skybox,
            vertex_buffer_offset: group.vertex_buffer_offset,
            index_buffer_offset: group.index_buffer_offset,
            num_vertices: group.num_vertices,
            num_uv_bufs: group.num_uv_bufs,
            num_color_bufs: group.num_color_bufs,
        }
    }

    pub fn get_ambient_color(&self, doodad_set_id: u16) -> Vec<f32> {
        let color = if self.global_ambient_volumes.len() > 0 {
            match self
                .global_ambient_volumes
                .iter()
                .find(|av| av.doodad_set_id == doodad_set_id)
            {
                Some(av) => av.get_color(),
                None => self.global_ambient_volumes[0].get_color(),
            }
        } else if self.ambient_volumes.len() > 0 {
            self.ambient_volumes[0].get_color()
        } else {
            self.header.ambient_color
        };
        vec![
            color.r as f32 / 255.0,
            color.g as f32 / 255.0,
            color.b as f32 / 255.0,
            color.a as f32 / 255.0,
        ]
    }

    pub fn get_doodad_set_refs(&self, mut doodad_set_id: usize) -> Vec<u32> {
        let default_set = &self.doodad_sets[0];
        if doodad_set_id >= self.doodad_sets.len() {
            doodad_set_id = 0;
        }
        let mut refs: Vec<u32> =
            (default_set.start_index..default_set.start_index + default_set.count).collect();
        if doodad_set_id != 0 {
            let set = &self.doodad_sets[doodad_set_id];
            refs.extend(set.start_index..set.start_index + set.count);
        }
        refs
    }

    pub fn get_doodad_defs(&self) -> Vec<DoodadDef> {
        self.doodad_defs.clone()
    }

    pub fn take_vertex_data(&mut self) -> Vec<u8> {
        let mut data = Vec::new();
        for group in self.groups.values_mut() {
            group.vertex_buffer_offset = Some(data.len());
            for v in group.vertices.drain(..) {
                data.extend(v.to_le_bytes());
            }
            data.extend(group.normals.drain(..));
            data.extend(&group.colors);
            data.extend(group.uvs.drain(..));
        }
        data
    }

    pub fn take_indices(&mut self) -> Vec<u16> {
        let mut indices = Vec::new();
        for group in self.groups.values_mut() {
            group.index_buffer_offset = Some(2 * indices.len()); // in bytes
            indices.extend(group.indices.drain(..));
        }
        indices
    }
}

#[derive(DekuRead, Debug, Clone)]
pub struct Portal {
    pub start_vertex: u16,
    pub count: u16,
    pub plane: WowPlane,
}

#[derive(Debug, Clone)]
pub struct PortalData {
    vertices: Vec<Vec3>,
    plane: Plane,
    aabb: AABB,
}

impl PortalData {
    pub fn new(portal: &Portal, portal_vertices: &[f32]) -> PortalData {
        let plane: Plane = (&portal.plane).into();

        let verts_start = 3 * portal.start_vertex as usize;
        let verts_end = verts_start + 3 * portal.count as usize;
        let verts = &portal_vertices[verts_start..verts_end];
        let mut vertices = Vec::new();
        for i in 0..verts.len() / 3 {
            let v = Vec3::from_column_slice(&verts[i * 3..i * 3 + 3]);
            // Some portals have duplicate vertices???
            if vertices.iter().any(|existing: &Vec3| existing.eq(&v)) {
                continue;
            }
            vertices.push(v);
        }

        // make sure vertices are in a consistent order around the planar polygon
        let major_axis = plane.major_axis();
        let mut centroid: Vec3 = vertices.iter().sum();
        centroid /= vertices.len() as f32;
        let centroid_proj = project_vec3_to_vec2(&centroid, major_axis);
        vertices.sort_by(|a, b| {
            let a_proj = project_vec3_to_vec2(a, major_axis) - centroid_proj;
            let b_proj = project_vec3_to_vec2(b, major_axis) - centroid_proj;
            let a_angle = f32::atan2(a_proj.y, a_proj.x);
            let b_angle = f32::atan2(b_proj.y, b_proj.x);
            a_angle.partial_cmp(&b_angle).unwrap()
        });

        let mut aabb = AABB::default();
        aabb.set_from_points(&vertices);

        PortalData {
            vertices,
            aabb,
            plane,
        }
    }

    // projects the portal vertices onto a 2D plane determined by the portal's plane. returns
    // a tuple of the projected points, as well as which axis the points were projected along
    fn project_vertices_to_2d(&self) -> (Vec<Vec2>, Axis) {
        let mut result = Vec::with_capacity(self.vertices.len());
        let major_axis = self.plane.major_axis();
        for v in &self.vertices {
            result.push(project_vec3_to_vec2(v, major_axis));
        }

        (result, major_axis)
    }

    pub fn in_frustum(&self, frustum: &ConvexHull) -> bool {
        frustum.contains_aabb(&self.aabb)
    }

    fn clip_frustum(&self, eye: &Vec3, frustum: &ConvexHull) -> ConvexHull {
        let mut result = frustum.clone();
        for i in 0..self.vertices.len() {
            let a = &self.vertices[i];
            let b = if i == self.vertices.len() - 1 {
                &self.vertices[0]
            } else {
                &self.vertices[i + 1]
            };
            let test_point = if i == 0 {
                &self.vertices[self.vertices.len() - 1]
            } else {
                &self.vertices[i - 1]
            };

            let mut plane = Plane::default();
            plane.set_tri(eye, &a, &b);
            if plane.distance(&test_point) < 0.0 {
                plane.negate();
            }
            assert!(plane.distance(&test_point) >= 0.0);
            result.planes.push(plane);
        }
        result
    }

    fn aabb_contains_point(&self, p: &Vec3) -> bool {
        self.aabb.contains_point(p)
    }

    fn is_facing_us(&self, eye: &Vec3, side: i16) -> bool {
        let dist = self.plane.distance(eye);
        if side < 0 && dist.is_sign_positive() {
            return false;
        } else if side > 0 && dist.is_sign_negative() {
            return false;
        }
        return true;
    }
}

#[derive(DekuRead, Debug, Clone)]
pub struct PortalRef {
    pub portal_index: u16, // into MOPT
    pub group_index: u16,
    #[deku(pad_bytes_after = "2")]
    pub side: i16,
}

struct PortalIter<'a> {
    refs_end: usize,
    i: usize,
    portals: &'a [PortalData],
    portal_refs: &'a [PortalRef],
}

impl<'a> PortalIter<'a> {
    pub fn new(group: &WmoGroup, wmo: &'a Wmo) -> Self {
        let refs_start = group.header.portal_start as usize;
        let refs_end = refs_start + group.header.portal_count as usize;
        PortalIter {
            refs_end,
            i: refs_start,
            portals: wmo.portals.as_slice(),
            portal_refs: &wmo.portal_refs.as_slice(),
        }
    }
}

impl<'a> Iterator for PortalIter<'a> {
    type Item = (&'a PortalRef, &'a PortalData);

    fn next(&mut self) -> Option<Self::Item> {
        if self.i == self.refs_end {
            return None;
        }
        let portal_ref = &self.portal_refs[self.i];
        let portal = &self.portals[portal_ref.portal_index as usize];
        self.i += 1;
        Some((portal_ref, portal))
    }
}

#[derive(DekuRead)]
pub struct Mosi {
    pub skybox_file_id: u32,
}

#[wasm_bindgen(js_name = "WowWmoGroupDescriptor")]
pub struct WmoGroupDescriptor {
    pub group_id: u32,
    pub interior: bool,
    pub exterior: bool,
    pub antiportal: bool,
    pub always_draw: bool,
    pub exterior_lit: bool,
    pub show_skybox: bool,
    pub vertex_buffer_offset: Option<usize>,
    pub index_buffer_offset: Option<usize>,
    pub num_vertices: usize,
    pub num_uv_bufs: usize,
    pub num_color_bufs: usize,
}

#[derive(Debug, Clone)]
pub struct WmoGroup {
    pub header: WmoGroupHeader,
    pub vertex_buffer_offset: Option<usize>,
    pub index_buffer_offset: Option<usize>,
    flags: WmoGroupFlags,
    indices: Vec<u16>,
    vertices: Vec<f32>,
    normals: Vec<u8>,
    uvs: Vec<u8>,
    colors: Vec<u8>,
    doodad_refs: Vec<u16>,
    bsp_tree: BspTree,
    pub num_vertices: usize,
    pub num_uv_bufs: usize,
    pub num_color_bufs: usize,
    pub batches: Vec<MaterialBatch>,
    pub replacement_for_header_color: Option<Rgba>,
    liquids: Option<Vec<WmoLiquid>>,
}

impl WmoGroup {
    pub fn new(data: &[u8]) -> Result<WmoGroup, String> {
        let mut chunked_data = ChunkedData::new(data);
        let (mver, _) = chunked_data.next().unwrap();
        assert_eq!(mver.magic_str(), "REVM");
        let (_, mhdr_data) = chunked_data.next().unwrap();
        let header: WmoGroupHeader = parse(mhdr_data)?;
        let flags = WmoGroupFlags::new(header.flags);
        let mut maybe_indices: Option<Vec<u16>> = None;
        let mut maybe_vertices: Option<Vec<f32>> = None;
        let mut maybe_normals: Option<Vec<u8>> = None;
        let mut uvs: Vec<u8> = Vec::new();
        let mut num_uv_bufs = 0;
        let mut liquids: Vec<WmoLiquid> = Vec::new();
        let mut colors: Vec<u8> = Vec::new();
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
                    let vertices = parse_array(chunk_data, 4)?;
                    num_vertices = vertices.len() / 3;
                    maybe_vertices = Some(vertices);
                }
                b"RNOM" => maybe_normals = Some(chunk_data.to_vec()),
                b"VTOM" => {
                    num_uv_bufs += 1;
                    uvs.extend(chunk_data.to_vec());
                }
                b"VCOM" => {
                    colors.extend(chunk_data.to_vec());
                    num_color_bufs += 1;
                }
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
            flags,
            vertex_buffer_offset: None,
            index_buffer_offset: None,
            indices,
            vertices,
            num_vertices,
            normals: maybe_normals.ok_or("WMO group didn't have normals")?,
            liquids: maybe_liquids,
            replacement_for_header_color,
            uvs,
            num_uv_bufs,
            bsp_tree,
            colors,
            num_color_bufs,
            batches: batches.unwrap_or_default(),
            doodad_refs: doodad_refs.unwrap_or_default(),
        })
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

#[derive(Debug, Clone)]
pub struct BspTree {
    nodes: Vec<BspNode>,
    face_indices: Vec<u16>,
    vertex_indices: Vec<u16>,
    vertices: Vec<f32>,
}

pub struct BspTreeResult {
    pub distance: f32,
    pub bary_x: f32,
    pub bary_y: f32,
    pub bary_z: f32,
    pub vert_index_0: usize,
    pub vert_index_1: usize,
    pub vert_index_2: usize,
}

fn neg_z_line_intersection(
    p: &nalgebra_glm::Vec3,
    (vertex0, vertex1, vertex2): (nalgebra_glm::Vec3, nalgebra_glm::Vec3, nalgebra_glm::Vec3),
) -> Option<(f32, nalgebra_glm::Vec3)> {
    // check that the ray will intersect in the xy plane
    let min_x = vertex0[0].min(vertex1[0]).min(vertex2[0]);
    let max_x = vertex0[0].max(vertex1[0]).max(vertex2[0]);
    if p.x < min_x || p.x > max_x {
        return None;
    }

    let min_y = vertex0[1].min(vertex1[1]).min(vertex2[1]);
    let max_y = vertex0[1].max(vertex1[1]).max(vertex2[1]);
    if p.y < min_y || p.y > max_y {
        return None;
    }

    // check that the ray is above on z
    let min_z = vertex0[2].min(vertex1[2]).min(vertex2[2]);
    if p.z < min_z {
        return None;
    }

    // inlined rayTriangleIntersect, assuming that axis = negative z
    let ab = vertex1 - vertex0;
    let ac = vertex2 - vertex0;
    let n = ab.cross(&ac);

    if n[2] < 0.0001 {
        return None;
    }

    let temp = p - vertex0;
    let t = temp.dot(&n) / n[2];
    if t <= 0.0 {
        return None;
    }

    // inlined cross assuming dir = negative z
    let ex = -temp[1];
    let ey = temp[0];
    let v = (ac[0] * ex + ac[1] * ey) / n[2];
    if v < 0.0 || v > 1.0 {
        return None;
    }

    let w = (ab[0] * ex + ab[1] * ey) / -n[2];
    if w < 0.0 || v + w > 1.0 {
        return None;
    }

    Some((t, vec3(v, w, 1.0 - v - w)))
}

impl BspTree {
    pub fn pick_closest_tri_neg_z(&self, p: &Vec3, nodes: &[&BspNode]) -> Option<BspTreeResult> {
        let mut min_dist = f32::INFINITY;
        let mut min_bsp_index: Option<usize> = None;
        let mut result_bary = vec3(0.0, 0.0, 0.0);

        for node in nodes {
            let start = node.faces_start as usize;
            let end = start + node.num_faces as usize;
            for i in start..end {
                if let Some((t, bary)) = neg_z_line_intersection(p, self.get_face_vertices(i)) {
                    if t < min_dist {
                        min_dist = t;
                        min_bsp_index = Some(i);
                        result_bary = bary;
                    }
                }
            }
        }

        let face_index = self.face_indices[min_bsp_index?] as usize;
        let indices = self.get_face_indices(face_index);
        Some(BspTreeResult {
            distance: min_dist,
            bary_x: result_bary.x,
            bary_y: result_bary.y,
            bary_z: result_bary.z,
            vert_index_0: indices.0,
            vert_index_1: indices.1,
            vert_index_2: indices.2,
        })
    }

    fn get_face_vertices(
        &self,
        bsp_face_index: usize,
    ) -> (nalgebra_glm::Vec3, nalgebra_glm::Vec3, nalgebra_glm::Vec3) {
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

    fn bounding_box_for_nodes(&self, nodes: &[&BspNode]) -> AABB {
        let mut aabb = AABB::default();
        for node in nodes {
            let start = node.faces_start as usize;
            let end = start + node.num_faces as usize;
            for i in start..end {
                let (v0, v1, v2) = self.get_face_vertices(i);
                aabb.union_point(&v0);
                aabb.union_point(&v1);
                aabb.union_point(&v2);
            }
        }
        aabb
    }

    fn query<'a>(&'a self, p: &Vec3, nodes: &mut Vec<&'a BspNode>, i: i16) {
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
            self.query(p, nodes, node.negative_child);
            self.query(p, nodes, node.positive_child);
        } else {
            let component = if matches!(axis, BspAxisType::X) {
                p.x
            } else {
                p.y
            };
            if component < node.plane_distance {
                self.query(p, nodes, node.negative_child);
            } else {
                self.query(p, nodes, node.positive_child);
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

const FIRST_NONBASIC_LIQUID_TYPE: u32 = 21;
const GREEN_LAVA: u32 = 15;
const MASKED_OCEAN: u32 = 1;
const MASKED_MAGMA: u32 = 2;
const MASKED_SLIME: u32 = 3;
const LIQUID_WMO_MAGMA: u32 = 19;
const LIQUID_WMO_OCEAN: u32 = 14;
const LIQUID_WMO_WATER: u32 = 13;
const LIQUID_WMO_SLIME: u32 = 20;

impl LiquidResult {
    pub fn recalculate_liquid_type(&mut self, flags: &WmoHeaderFlags, group: &WmoGroup) -> u32 {
        let liquid_to_convert;
        if flags.use_liquid_type_dbc_id {
            if group.header.group_liquid < FIRST_NONBASIC_LIQUID_TYPE {
                liquid_to_convert = group.header.group_liquid - 1;
            } else {
                return group.header.group_liquid;
            }
        } else {
            if group.header.group_liquid == GREEN_LAVA {
                liquid_to_convert = self.liquid_type;
            } else if group.header.group_liquid < FIRST_NONBASIC_LIQUID_TYPE {
                liquid_to_convert = group.header.group_liquid;
            } else {
                return group.header.group_liquid + 1;
            }
        }
        let masked_liquid = liquid_to_convert & 0x3;
        if masked_liquid == MASKED_OCEAN {
            return LIQUID_WMO_OCEAN;
        } else if masked_liquid == MASKED_MAGMA {
            return LIQUID_WMO_MAGMA;
        } else if masked_liquid == MASKED_SLIME {
            return LIQUID_WMO_SLIME;
        } else if group.flags.water_is_ocean {
            return LIQUID_WMO_OCEAN;
        } else {
            return LIQUID_WMO_WATER;
        }
    }
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
    pub _data: u32,
    pub height: f32,
}

#[derive(DekuRead, Debug, Clone)]
pub struct LiquidTile {
    #[deku(bits = 1)]
    pub _fishable: u8,
    #[deku(bits = 1)]
    pub _shared: u8,
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
#[allow(dead_code)] // width and height are used as part of the deku(count) but for some reason Rust still complaints they're unused
pub struct WmoLiquid {
    width: u32,
    height: u32,
    tile_width: u32,
    tile_height: u32,
    pub position: WowVec3,
    pub material_id: u16,
    #[deku(count = "width * height")]
    vertices: Vec<LiquidVertex>,
    #[deku(count = "tile_width * tile_height")]
    tiles: Vec<LiquidTile>,
}

impl WmoLiquid {
    pub fn get_render_result(&self, header: &WmoGroupHeader) -> LiquidResult {
        let width = self.tile_width as usize;
        let height = self.tile_height as usize;
        let mut vertex_prototypes = Vec::new();
        let mut indices = Vec::new();
        let mut extents = AABBox::default();
        let flags = WmoGroupFlags::new(header.flags);
        let depth = if flags.exterior { 1000.0 } else { 0.0 };
        for y in 0..height + 1 {
            for x in 0..width + 1 {
                let vertex = &self.vertices[y * (width + 1) + x];
                let pos_x = self.position.x + UNIT_SIZE * x as f32;
                let pos_y = self.position.y + UNIT_SIZE * y as f32;
                let pos_z = vertex.height;
                vertex_prototypes.push([
                    pos_x, pos_y, pos_z, x as f32, y as f32, depth,
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
                    continue;
                }

                let p = y * (width + 1) + x;
                for v_i in [p, p + 1, p + width + 1 + 1, p + width + 1] {
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
    _name: [u8; 0x14],
    pub start_index: u32,
    #[deku(pad_bytes_after = "4")]
    pub count: u32,
}

#[derive(DekuRead, Debug, Clone)]
pub struct BspNode {
    pub flags: u16,
    pub negative_child: i16,
    pub positive_child: i16,
    pub num_faces: u16,
    pub faces_start: u32,
    pub plane_distance: f32,
}

pub enum BspAxisType {
    X,
    Y,
    Z,
}

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
    _position: WowVec3,
    _start: f32,
    _end: f32,
    pub color1: Bgra,
    _color2: Bgra,
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
    (
        VertexShader::DiffuseCompTerrain,
        PixelShader::TwoLayerTerrain,
    ),
    (VertexShader::DiffuseComp, PixelShader::DiffuseEmissive),
    (VertexShader::None, PixelShader::None),
    (VertexShader::DiffuseT1EnvT2, PixelShader::MaskedEnvMetal),
    (VertexShader::DiffuseT1EnvT2, PixelShader::EnvMetalEmissive),
    (
        VertexShader::DiffuseComp,
        PixelShader::TwoLayerDiffuseOpaque,
    ),
    (VertexShader::None, PixelShader::None),
    (
        VertexShader::DiffuseComp,
        PixelShader::TwoLayerDiffuseEmissive,
    ),
    (VertexShader::DiffuseT1, PixelShader::Diffuse),
    (
        VertexShader::DiffuseT1EnvT2,
        PixelShader::AdditiveMaskedEnvMetal,
    ),
    (
        VertexShader::DiffuseCompAlpha,
        PixelShader::TwoLayerDiffuseMod2x,
    ),
    (
        VertexShader::DiffuseComp,
        PixelShader::TwoLayerDiffuseMod2xNA,
    ),
    (
        VertexShader::DiffuseCompAlpha,
        PixelShader::TwoLayerDiffuseAlpha,
    ),
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

#[derive(DekuRead, Debug, Clone)]
pub struct WmoGroupHeader {
    pub group_name: u32,             // offset to MOGN
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
#[derive(Debug, Clone, Copy)]
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
    pub always_draw: bool,
    pub unreachable: bool,
    pub unk_skip_membership_check: bool,
}

impl WmoGroupFlags {
    pub fn new(x: u32) -> Self {
        Self {
            has_bsp_tree: x & 0x1 > 0,
            has_light_map: x & 0x2 > 0,
            has_vertex_colors: x & 0x4 > 0,
            exterior: x & 0x8 > 0,
            exterior_lit: x & 0x40 > 0,
            unreachable: x & 0x80 > 0,
            show_exterior_sky: x & 0x100 > 0,
            has_lights: x & 0x200 > 0,
            has_doodads: x & 0x800 > 0,
            has_water: x & 0x1000 > 0,
            interior: x & 0x2000 > 0,
            always_draw: x & 0x10000 > 0,
            show_skybox: x & 0x40000 > 0,
            unk_skip_membership_check: x & 0x400000 > 0,
            water_is_ocean: x & 0x80000 > 0,
            antiportal: x & 0x4000000 > 0,
        }
    }
}

#[wasm_bindgen(js_name = "WowWmoFog")]
#[derive(DekuRead, Debug, Clone)]
pub struct Fog {
    pub flags: u32,
    pub position: WowVec3,
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
    pub position: WowVec3,
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
            unlit: (x & (1 << 0)) > 0,
            unfogged: (x & (1 << 1)) > 0,
            unculled: (x & (1 << 2)) > 0,
            exterior_light: (x & (1 << 3)) > 0,
            sidn: (x & (1 << 4)) > 0,
            window: (x & (1 << 5)) > 0,
            clamp_s: (x & (1 << 6)) > 0,
            clamp_t: (x & (1 << 7)) > 0,
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
