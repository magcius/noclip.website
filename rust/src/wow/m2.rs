
use deku::prelude::*;
use deku::ctx::ByteSize;

use wasm_bindgen::prelude::*;
use crate::wow::animation::*;

use super::common::{
    parse_array,
    ChunkedData,
    WowArray,
    WowCharArray,
    AABBox,
    Vec3,
    Vec2,
    Quat,
};

// if it's an MD21 chunk, all pointers are relative to the end of that chunk
#[derive(Debug, DekuRead)]
pub struct M2HeaderBlock {
    pub header: M2Header,
}

#[derive(Debug, DekuRead, Clone)]
#[deku(magic = b"MD20")]
pub struct M2Header {
    pub version: u32,
    name: WowCharArray,
    pub flags: u32,
    global_sequence_durations: WowArray<u32>,
    sequences: WowArray<M2Sequence>,
    _sequence_lookups: WowArray<u16>,
    bones: WowArray<M2CompBoneUnallocated>,
    _key_bone_lookup: WowArray<u16>,
    vertices: WowArray<()>,
    pub num_skin_profiles: u32,
    colors: WowArray<M2ColorUnallocated>,
    textures: WowArray<M2Texture>,
    texture_weights: WowArray<M2TrackUnallocated<u16>>,
    texture_transforms: WowArray<M2TextureTransformUnallocated>,
    _replacable_texture_lookup: WowArray<u8>,
    materials: WowArray<M2Material>,
    bone_lookup_table: WowArray<u16>,
    texture_lookup_table: WowArray<u16>,
    _texture_unit_lookup_table: WowArray<u16>,
    transparency_lookup_table: WowArray<u16>,
    texture_transforms_lookup_table: WowArray<u16>,
    pub bounding_box: AABBox,
    pub bounding_sphere_radius: f32,
    pub collision_box: AABBox,
    pub collision_sphere_radius: f32,
    _collision_triangles: WowArray<u16>,
    _collision_vertices: WowArray<Vec3>,
    _collision_normals: WowArray<Vec3>,
    _attachments: WowArray<()>,
    _attachment_lookup_table: WowArray<u16>,
    _events: WowArray<()>,
    lights: WowArray<M2LightUnallocated>,
    _cameras: WowArray<()>,
    _camera_lookup_table: WowArray<u16>,
    _ribbon_emitters: WowArray<()>,
    _particle_emitters: WowArray<()>,
    _blend_map_overrides: WowArray<u16>,
}

impl M2Header {
    fn get_name(&self, m2_data: &[u8]) -> Result<String, String> {
        self.name.to_string(m2_data)
            .map_err(|e| format!("{:?}", e))
    }

    fn get_materials(&self, m2_data: &[u8]) -> Result<Vec<M2Material>, String> {
        self.materials.to_vec(m2_data)
            .map_err(|e| format!("{:?}", e))
    }

    fn get_vertex_colors(&self, m2_data: &[u8]) -> Result<Vec<M2Color>, String> {
        let colors = self.colors.to_vec(m2_data)
            .map_err(|e| format!("{:?}", e))?;

        let mut result = Vec::with_capacity(colors.len());
        for c in colors {
            result.push(M2Color {
                color: c.color.to_allocated(m2_data).map_err(|e| format!("{:?}", e))?,
                alpha: c.alpha.to_allocated(m2_data).map_err(|e| format!("{:?}", e))?,
            });
        }
        Ok(result)
    }

    fn get_textures(&self, m2_data: &[u8]) -> Result<Vec<M2Texture>, String> {
        self.textures.to_vec(m2_data)
            .map_err(|e| format!("{:?}", e))
    }

    fn get_texture_transforms(&self, m2_data: &[u8]) -> Result<Vec<M2TextureTransform>, String> {
        let texture_transforms = self.texture_transforms.to_vec(m2_data)
            .map_err(|e| format!("{:?}", e))?;

        let mut result = Vec::with_capacity(texture_transforms.len());
        for tex in texture_transforms {
            result.push(M2TextureTransform {
                translation: tex.translation.to_allocated(m2_data).map_err(|e| format!("{:?}", e))?,
                rotation: tex.rotation.to_allocated(m2_data).map_err(|e| format!("{:?}", e))?,
                scaling: tex.scaling.to_allocated(m2_data).map_err(|e| format!("{:?}", e))?,
            });
        }
        Ok(result)
    }

    fn get_bones(&self, m2_data: &[u8]) -> Result<Vec<M2CompBone>, String> {
        let bones = self.bones.to_vec(m2_data)
            .map_err(|e| format!("{:?}", e))?;

        let mut result = Vec::with_capacity(bones.len());
        for bone in bones {
            let rotation16 = bone.rotation.to_allocated(m2_data).map_err(|e| format!("{:?}", e))?;
            let mut quat_values = Vec::new();
            for quats in rotation16.values {
                let mut values = Vec::new();
                for quat16 in quats {
                    values.push(Quat::from(quat16));
                }
                quat_values.push(values);
            }
            let rotation: M2Track<Quat> = M2Track {
                interpolation_type: rotation16.interpolation_type,
                global_sequence: rotation16.global_sequence,
                timestamps: rotation16.timestamps,
                values: quat_values,
            };
            result.push(M2CompBone {
                translation: bone.translation.to_allocated(m2_data).map_err(|e| format!("{:?}", e))?,
                rotation,
                scaling: bone.scaling.to_allocated(m2_data).map_err(|e| format!("{:?}", e))?,
                key_bone_id: bone.key_bone_id,
                flags: bone.flags,
                parent_bone: bone.parent_bone,
                submesh_id: bone.submesh_id,
                pivot: bone.pivot,
            });
        }
        Ok(result)
    }

    fn get_texture_weights(&self, m2_data: &[u8]) -> Result<Vec<M2TextureWeight>, String> {
        let weights = self.texture_weights.to_vec(m2_data)
            .map_err(|e| format!("{:?}", e))?;

        let mut result = Vec::with_capacity(weights.len());
        for weight in weights {
            result.push(M2TextureWeight {
                weights: weight.to_allocated(m2_data).map_err(|e| format!("{:?}", e))?,
            });
        }
        Ok(result)
    }

    fn get_vertex_data(&self, m2_data: &[u8]) -> Result<Vec<u8>, String> {
        let vertex_data_start = self.vertices.offset as usize;
        let vertex_data_size = self.vertices.count as usize * M2::get_vertex_stride();
        let vertex_data_end = vertex_data_start + vertex_data_size;
        Ok(m2_data[vertex_data_start..vertex_data_end].to_vec())
    }

    fn get_texture_lookup_table(&self, m2_data: &[u8]) -> Result<Vec<u16>, String> {
        self.texture_lookup_table.to_vec(m2_data)
            .map_err(|e| format!("{:?}", e))
    }

    fn get_bone_lookup_table(&self, m2_data: &[u8]) -> Result<Vec<u16>, String> {
        self.bone_lookup_table.to_vec(m2_data)
            .map_err(|e| format!("{:?}", e))
    }

    fn get_texture_transforms_lookup_table(&self, m2_data: &[u8]) -> Result<Vec<u16>, String> {
        self.texture_transforms_lookup_table.to_vec(m2_data)
            .map_err(|e| format!("{:?}", e))
    }

    fn get_transparency_lookup_table(&self, m2_data: &[u8]) -> Result<Vec<u16>, String> {
        self.transparency_lookup_table.to_vec(m2_data)
            .map_err(|e| format!("{:?}", e))
    }

    fn get_lights(&self, m2_data: &[u8]) -> Result<Vec<M2Light>, String> {
        let lights_unallocated = self.lights.to_vec(m2_data)
            .map_err(|e| format!("{:?}", e))?;
        let mut result = Vec::with_capacity(lights_unallocated.len());
        for light in lights_unallocated {
            result.push(M2Light {
                bone: light.bone,
                position: light.position,
                ambient_color: light.ambient_color.to_allocated(m2_data).map_err(|e| format!("{:?}", e))?,
                ambient_intensity: light.ambient_intensity.to_allocated(m2_data).map_err(|e| format!("{:?}", e))?,
                diffuse_color: light.diffuse_color.to_allocated(m2_data).map_err(|e| format!("{:?}", e))?,
                diffuse_intensity: light.diffuse_intensity.to_allocated(m2_data).map_err(|e| format!("{:?}", e))?,
                attenuation_start: light.attenuation_start.to_allocated(m2_data).map_err(|e| format!("{:?}", e))?,
                attenuation_end: light.attenuation_end.to_allocated(m2_data).map_err(|e| format!("{:?}", e))?,
                visibility: light.visibility.to_allocated(m2_data).map_err(|e| format!("{:?}", e))?,
            });
        }
        Ok(result)
    }
}

#[wasm_bindgen(js_name = "WowM2", getter_with_clone)]
#[derive(Debug, Clone)]
pub struct M2 {
    header: M2Header,
    pub texture_ids: Vec<u32>,
    pub skin_ids: Vec<u32>,
    pub name: String,
    pub materials: Vec<M2Material>,
    legacy_textures: Option<Vec<LegacyTexture>>,
    vertex_data: Option<Vec<u8>>,
    texture_lookup_table: Option<Vec<u16>>,
    bone_lookup_table: Option<Vec<u16>>,
    texture_transforms_lookup_table: Option<Vec<u16>>,
    transparency_lookup_table: Option<Vec<u16>>,
    animation_manager: Option<AnimationManager>,
}

#[wasm_bindgen(js_class = "WowM2")]
impl M2 {
    pub fn new(data: &[u8]) -> Result<M2, String> {
        let mut chunked_data = ChunkedData::new(data);
        let (header_chunk, chunk_data) = chunked_data.next()
            .ok_or("no header chunk".to_string())?;
        assert_eq!(&header_chunk.magic, b"MD21");
        let (_, header) = M2Header::from_bytes((chunk_data, 0))
            .map_err(|e| format!("{:?}", e))?;

        let mut txid: Option<Vec<u32>> = None;
        let mut sfid: Option<Vec<u32>> = None;
        for (chunk, chunk_data) in &mut chunked_data {
            match &chunk.magic {
                b"TXID" => {
                    dbg!(&chunk_data);
                    txid = Some(parse_array(chunk_data, 4)?);
                },
                b"SFID" => sfid = Some(parse_array(chunk_data, 4)?),
                _ => {},
            }
        }

        // M2 pointers are relative to the end of the MD21 block, which seems to
        // always be 16 bytes in
        let m2_data = &data[8..];
        let animation_manager = Some(AnimationManager::new(
            header.global_sequence_durations.to_vec(m2_data).map_err(|e| format!("{:?}", e))?,
            header.sequences.to_vec(m2_data).map_err(|e| format!("{:?}", e))?,
            header.get_texture_weights(m2_data)?,
            header.get_texture_transforms(m2_data)?,
            header.get_vertex_colors(m2_data)?,
            header.get_bones(m2_data)?,
            header.get_lights(m2_data)?
        ));

        let mut legacy_textures = Vec::new();
        for tex in header.get_textures(m2_data)? {
            let filename = tex.filename.to_string(m2_data)
                .map_err(|e| format!("{:?}", e))?;
            legacy_textures.push(LegacyTexture {
                filename,
                flags: tex.flags,
            });
        }

        Ok(M2 {
            texture_ids: txid.unwrap_or_default(),
            skin_ids: sfid.ok_or("M2 didn't have SFID chunk!".to_string())?,
            animation_manager,
            name: header.get_name(m2_data)?,
            materials: header.get_materials(m2_data)?,
            vertex_data: Some(header.get_vertex_data(m2_data)?),
            texture_lookup_table: Some(header.get_texture_lookup_table(m2_data)?),
            bone_lookup_table: Some(header.get_bone_lookup_table(m2_data)?),
            legacy_textures: Some(legacy_textures),
            texture_transforms_lookup_table: Some(header.get_texture_transforms_lookup_table(m2_data)?),
            transparency_lookup_table: Some(header.get_transparency_lookup_table(m2_data)?),
            header,
        })
    }

    pub fn take_animation_manager(&mut self) -> AnimationManager {
        self.animation_manager.take().expect("M2 AnimationManager already taken")
    }

    pub fn get_bounding_box(&self) -> AABBox {
        self.header.bounding_box
    }

    pub fn take_legacy_textures(&mut self) -> Vec<LegacyTexture> {
        self.legacy_textures.take().expect("M2 legacy textures already taken")
    }

    pub fn take_texture_lookup(&mut self) -> Vec<u16> {
        self.texture_lookup_table.take().expect("M2 texture lookup table already taken")
    }

    pub fn take_bone_lookup(&mut self) -> Vec<u16> {
        self.bone_lookup_table.take().expect("M2 bone lookup table already taken")
    }

    pub fn take_texture_transform_lookup(&mut self) -> Vec<u16> {
        self.texture_transforms_lookup_table.take().expect("M2 texture transform lookup table already taken")
    }

    pub fn take_texture_transparency_lookup(&mut self) -> Vec<u16> {
        self.transparency_lookup_table.take().expect("M2 transparency lookup table already taken")
    }

    pub fn get_vertex_stride() -> usize {
        // position + bone weights + bone indices + normal + texture coords
        12 + 4 + 4 + 12 + 2 * 8
    }

    pub fn take_vertex_data(&mut self) -> Vec<u8> {
        self.vertex_data.take().expect("M2 vertex data already taken")
    }
}

#[derive(DekuRead, Debug, Clone)]
struct M2LightUnallocated {
    pub _light_type: u16, // should be 1 (point light) in all cases except the login screen
    pub bone: i16,
    pub position: Vec3,
    pub ambient_color: M2TrackUnallocated<Vec3>,
    pub ambient_intensity: M2TrackUnallocated<f32>,
    pub diffuse_color: M2TrackUnallocated<Vec3>,
    pub diffuse_intensity: M2TrackUnallocated<f32>,
    pub attenuation_start: M2TrackUnallocated<f32>,
    pub attenuation_end: M2TrackUnallocated<f32>,
    pub visibility: M2TrackUnallocated<u8>,
}

#[derive(Debug, Clone)]
pub struct M2Light {
    pub bone: i16,
    pub position: Vec3,
    pub ambient_color: M2Track<Vec3>,
    pub ambient_intensity: M2Track<f32>,
    pub diffuse_color: M2Track<Vec3>,
    pub diffuse_intensity: M2Track<f32>,
    pub attenuation_start: M2Track<f32>,
    pub attenuation_end: M2Track<f32>,
    pub visibility: M2Track<u8>,
}

#[wasm_bindgen(js_name = "WowM2Material")]
#[derive(DekuRead, Debug, Clone)]
pub struct M2Material {
    pub flags: u16,
    pub blending_mode: M2BlendingMode,
}

#[wasm_bindgen(js_name = "WowM2BlendingMode")]
#[derive(DekuRead, Debug, Copy, Clone)]
#[deku(type = "u16")]
pub enum M2BlendingMode {
    Opaque = 0,
    AlphaKey = 1,
    Alpha = 2,
    NoAlphaAdd = 3, // unused
    Add = 4,
    Mod = 5,
    Mod2x = 6,
    BlendAdd = 7, // unused
}

#[wasm_bindgen(js_name = "WowM2BoneFlags")]
pub struct M2BoneFlags {
    pub ignore_parent_translate: bool,
    pub ignore_parent_scale: bool,
    pub ignore_parent_rotation: bool,
    pub spherical_billboard: bool,
    pub cylindrical_billboard_lock_x: bool,
    pub cylindrical_billboard_lock_y: bool,
    pub cylindrical_billboard_lock_z: bool,
}

#[wasm_bindgen(js_class = "WowM2BoneFlags")]
impl M2BoneFlags {
    pub fn new(x: u32) -> Self {
        Self {
            ignore_parent_translate:      (x & 0x01) > 0,
            ignore_parent_scale:          (x & 0x02) > 0,
            ignore_parent_rotation:       (x & 0x04) > 0,
            spherical_billboard:          (x & 0x08) > 0,
            cylindrical_billboard_lock_x: (x & 0x10) > 0,
            cylindrical_billboard_lock_y: (x & 0x20) > 0,
            cylindrical_billboard_lock_z: (x & 0x40) > 0,
        }
    }
}

#[wasm_bindgen(js_name = "WowM2MaterialFlags")]
pub struct M2MaterialFlags {
    pub unlit: bool,
    pub unfogged: bool,
    pub two_sided: bool,
    pub depth_tested: bool,
    pub depth_write: bool,
}

#[wasm_bindgen(js_class = "WowM2MaterialFlags")]
impl M2MaterialFlags {
    pub fn new(x: u16) -> Self {
        Self {
            unlit:        (x & 0x01) > 0,
            unfogged:     (x & 0x02) > 0,
            two_sided:    (x & 0x04) > 0,
            depth_tested: (x & 0x08) == 0,
            depth_write:  (x & 0x10) == 0,
        }
    }
}

#[derive(Debug, DekuRead, Clone)]
#[deku(ctx = "ByteSize(size): ByteSize")]
pub struct Txid {
    #[deku(count = "size / 4")]
    pub file_data_ids: Vec<u32>,
}

#[derive(Debug, DekuRead)]
pub struct M2Vertex {
    pub position: Vec3,
    pub bone_weights: [u8; 4],
    pub bone_indices: [u8; 4],
    pub normal: Vec3,
    pub texture_coords: [Vec2; 2],
}

#[derive(Debug, Clone)]
#[wasm_bindgen(js_name = "WowM2LegacyTexture", getter_with_clone)]
pub struct LegacyTexture {
    pub filename: String,
    pub flags: u32,
}

#[derive(Debug, DekuRead, Clone)]
pub struct M2Texture {
    pub type_: u32,
    pub flags: u32,
    pub filename: WowCharArray,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test() {
        //let data = std::fs::read("../data/wow/world/critter/birds/bird02.m2").unwrap();
        //let data = std::fs::read("../data/wow/world/generic/nightelf/passive doodads/magicalimplements/nemagicimplement06.m2").unwrap();
        let data = std::fs::read("../data/wotlk/world/azeroth/redridge/passivedoodads/rowboat/rowboat01.m2").unwrap();
        //let data = std::fs::read("../data/wow/world/kalimdor/kalidar/passivedoodads/kalidartrees/kalidartree01.m2").unwrap();
        let _m2 = M2::new(&data).unwrap();
    }
}
