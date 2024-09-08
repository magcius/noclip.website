
use std::marker::PhantomData;

use deku::prelude::*;

use wasm_bindgen::prelude::*;
use crate::wow::{animation::*, common::parse, particles::Emitter};

use super::common::{
    fixed_precision_6_9_to_f32, parse_array, AABBox, ChunkedData, Fixedi16, Quat, Vec2, Vec3, WowArray, WowCharArray
};

// if it's an MD21 chunk, all pointers are relative to the end of that chunk
#[derive(Debug, DekuRead)]
pub struct M2HeaderBlock {
    pub _header: M2Header,
}

#[derive(Debug, DekuRead, Clone)]
#[deku(magic = b"MD20")]
pub struct M2Header {
    pub _version: u32,
    name: WowCharArray,
    pub flags: u32,
    global_sequence_durations: WowArray<u32>,
    sequences: WowArray<M2Sequence>,
    _sequence_lookups: WowArray<u16>,
    bones: WowArray<M2CompBone>,
    _key_bone_lookup: WowArray<u16>,
    vertices: WowArray<()>,
    pub _num_skin_profiles: u32,
    colors: WowArray<M2Color>,
    textures: WowArray<M2Texture>,
    texture_weights: WowArray<M2Track<Fixedi16>>,
    texture_transforms: WowArray<M2TextureTransform>,
    _replacable_texture_lookup: WowArray<u8>,
    materials: WowArray<M2Material>,
    bone_lookup_table: WowArray<u16>,
    texture_lookup_table: WowArray<u16>,
    _texture_unit_lookup_table: WowArray<u16>,
    transparency_lookup_table: WowArray<u16>,
    texture_transforms_lookup_table: WowArray<u16>,
    pub bounding_box: AABBox,
    pub _bounding_sphere_radius: f32,
    pub _collision_box: AABBox,
    pub _collision_sphere_radius: f32,
    _collision_triangles: WowArray<u16>,
    _collision_vertices: WowArray<Vec3>,
    _collision_normals: WowArray<Vec3>,
    _attachments: WowArray<()>,
    _attachment_lookup_table: WowArray<u16>,
    _events: WowArray<()>,
    lights: WowArray<M2Light>,
    _cameras: WowArray<()>,
    _camera_lookup_table: WowArray<u16>,
    _ribbon_emitters: WowArray<()>,
    particle_emitters: WowArray<ParticleEmitter>,
    _blend_map_overrides: WowArray<u16>,
}

impl M2Header {
    fn get_name(&self, m2_data: &[u8]) -> Result<String, String> {
        self.name.to_string(m2_data)
    }

    fn get_materials(&self, m2_data: &[u8]) -> Result<Vec<M2Material>, String> {
        self.materials.to_vec(m2_data)
    }

    fn get_vertex_colors(&self, m2_data: &[u8]) -> Result<Vec<M2Color>, String> {
        let mut colors: Vec<M2Color> = self.colors.to_vec(m2_data)?;
        for color in colors.iter_mut() {
            color.color.allocate(m2_data)?;
            color.alpha.allocate(m2_data)?;
        }
        Ok(colors)
    }

    fn get_textures(&self, m2_data: &[u8]) -> Result<Vec<M2Texture>, String> {
        self.textures.to_vec(m2_data)
    }

    fn get_texture_transforms(&self, m2_data: &[u8]) -> Result<Vec<M2TextureTransform>, String> {
        let mut texture_transforms: Vec<M2TextureTransform> = self.texture_transforms.to_vec(m2_data)?;
        for tex in texture_transforms.iter_mut() {
            tex.translation.allocate(m2_data)?;
            tex.rotation.allocate(m2_data)?;
            tex.scaling.allocate(m2_data)?;
        }
        Ok(texture_transforms)
    }

    fn get_bones(&self, m2_data: &[u8]) -> Result<Vec<M2CompBone>, String> {
        let mut bones: Vec<M2CompBone> = self.bones.to_vec(m2_data)?;
        for bone in bones.iter_mut() {
            bone.rotation_quat16.allocate(m2_data)?;
            bone.translation.allocate(m2_data)?;
            bone.scaling.allocate(m2_data)?;

            // convert the quat16s into quats so we don't have to do the
            // math countless times per frame
            let mut quat_values = Vec::new();
            for quats in bone.rotation_quat16.values() {
                let mut values = Vec::new();
                for quat16 in quats {
                    values.push(Quat::from(*quat16));
                }
                quat_values.push(values);
            }

            bone.rotation = Some(M2Track {
                interpolation_type: bone.rotation_quat16.interpolation_type,
                global_sequence: bone.rotation_quat16.global_sequence,
                timestamps: Some(bone.rotation_quat16.timestamps().clone()),
                values: Some(quat_values),

                // hack: put in some fake pointers
                timestamps_unallocated: WowArray { count: 0, offset: 0, element_type: PhantomData },
                values_unallocated: WowArray { count: 0, offset: 0, element_type: PhantomData },
            });
        }
        Ok(bones)
    }

    fn get_texture_weights(&self, m2_data: &[u8]) -> Result<Vec<M2Track<Fixedi16>>, String> {
        let mut weights: Vec<M2Track<Fixedi16>> = self.texture_weights.to_vec(m2_data)?;

        for weight in weights.iter_mut() {
            weight.allocate(m2_data)?;
        }

        Ok(weights)
    }

    fn get_vertex_data(&self, m2_data: &[u8]) -> Result<Vec<u8>, String> {
        let vertex_data_start = self.vertices.offset as usize;
        let vertex_data_size = self.vertices.count as usize * M2::get_vertex_stride();
        let vertex_data_end = vertex_data_start + vertex_data_size;
        Ok(m2_data[vertex_data_start..vertex_data_end].to_vec())
    }

    fn get_texture_lookup_table(&self, m2_data: &[u8]) -> Result<Vec<u16>, String> {
        self.texture_lookup_table.to_vec(m2_data)
    }

    fn get_bone_lookup_table(&self, m2_data: &[u8]) -> Result<Vec<u16>, String> {
        self.bone_lookup_table.to_vec(m2_data)
    }

    fn get_texture_transforms_lookup_table(&self, m2_data: &[u8]) -> Result<Vec<u16>, String> {
        self.texture_transforms_lookup_table.to_vec(m2_data)
    }

    fn get_transparency_lookup_table(&self, m2_data: &[u8]) -> Result<Vec<u16>, String> {
        self.transparency_lookup_table.to_vec(m2_data)
    }

    fn get_lights(&self, m2_data: &[u8]) -> Result<Vec<M2Light>, String> {
        let mut lights: Vec<M2Light> = self.lights.to_vec(m2_data)?;
        for light in lights.iter_mut() {
            light.ambient_color.allocate(m2_data)?;
            light.ambient_intensity.allocate(m2_data)?;
            light.diffuse_color.allocate(m2_data)?;
            light.diffuse_intensity.allocate(m2_data)?;
            light.attenuation_start.allocate(m2_data)?;
            light.attenuation_end.allocate(m2_data)?;
            light.visibility.allocate(m2_data)?;
        }
        Ok(lights)
    }

    fn get_particle_emitters(&self, m2_data: &[u8]) -> Result<Vec<ParticleEmitter>, String> {
        let mut particle_emitters: Vec<ParticleEmitter> = self.particle_emitters.to_vec(m2_data)?;
        for emitter in particle_emitters.iter_mut() {
            emitter.emission_speed.allocate(m2_data)?;
            emitter.speed_variation.allocate(m2_data)?;
            emitter.vertical_range.allocate(m2_data)?;
            emitter.horizontal_range.allocate(m2_data)?;
            emitter.gravity.allocate(m2_data)?;
            emitter.lifespan.allocate(m2_data)?;
            emitter.emission_rate.allocate(m2_data)?;
            emitter.emission_area_length.allocate(m2_data)?;
            emitter.emission_area_width.allocate(m2_data)?;
            emitter.z_source.allocate(m2_data)?;
            emitter.color.allocate(m2_data)?;
            emitter.alpha.allocate(m2_data)?;
            emitter.scale.allocate(m2_data)?;
            emitter.head_cell.allocate(m2_data)?;
            emitter.enabled.allocate(m2_data)?;
            emitter.tail_cell.allocate(m2_data)?;
            emitter.geometry_model_filename = Some(emitter.geometry_model_filename_unallocated.to_string(m2_data)?);
            emitter.recursion_model_filename = Some(emitter.recursion_model_filename_unallocated.to_string(m2_data)?);
            emitter.spline_points = Some(emitter.spline_points_unallocated.to_vec(m2_data)?);
        }
        Ok(particle_emitters)
    }
}

#[wasm_bindgen(js_name = "WowM2", getter_with_clone)]
#[derive(Debug, Clone)]
pub struct M2 {
    header: M2Header,
    pub texture_ids: Vec<u32>,
    pub flags: u32,
    pub skin_ids: Vec<u32>,
    pub name: String,
    pub materials: Vec<M2Material>,
    txac: Option<Vec<u16>>, // seems to be used in some particle emitter shader logic
    legacy_textures: Option<Vec<LegacyTexture>>,
    vertex_data: Option<Vec<u8>>,
    texture_lookup_table: Option<Vec<u16>>,
    bone_lookup_table: Option<Vec<u16>>,
    texture_transforms_lookup_table: Option<Vec<u16>>,
    transparency_lookup_table: Option<Vec<u16>>,
    animation_manager: Option<AnimationManager>,
    particle_emitters: Option<Vec<Emitter>>,
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
        let mut txac: Option<Vec<u16>> = None;
        let mut exp2_unallocated: Option<WowArray<Exp2Record>> = None;
        for (chunk, chunk_data) in &mut chunked_data {
            match &chunk.magic {
                b"TXID" => txid = Some(parse_array(chunk_data, 4)?),
                b"SFID" => sfid = Some(parse_array(chunk_data, 4)?),
                b"TXAC" => txac = Some(parse_array(chunk_data, 2)?),
                b"EXP2" => exp2_unallocated = Some(parse(chunk_data)?),
                _ => {},
            }
        }

        // M2 pointers are relative to the end of the MD21 block, which seems to
        // always be 16 bytes in
        let m2_data = &data[8..];

        let mut exp2_allocated = None;
        if let Some(exp2_unallocated) = exp2_unallocated {
            exp2_allocated = Some(exp2_unallocated.to_vec(m2_data)?);
        }
        let mut particle_emitters = Vec::new();
        for (i, emitter) in header.get_particle_emitters(m2_data)?.drain(..).enumerate() {
            let mut emitter_txac = 0;
            if let Some(txac_values) = txac.as_ref() {
                emitter_txac = txac_values[i];
            }
            let mut emitter_z_source = None;
            if let Some(exp2) = exp2_allocated.as_ref() {
                emitter_z_source = Some(exp2[i].z_source);
            }
            particle_emitters.push(Emitter::new(emitter, emitter_txac, emitter_z_source));
        }

        let animation_manager = Some(AnimationManager::new(
            header.global_sequence_durations.to_vec(m2_data)?,
            header.sequences.to_vec(m2_data)?,
            header.get_texture_weights(m2_data)?,
            header.get_texture_transforms(m2_data)?,
            header.get_vertex_colors(m2_data)?,
            header.get_bones(m2_data)?,
            header.get_lights(m2_data)?,
        ));

        let mut legacy_textures = Vec::new();
        for tex in header.get_textures(m2_data)? {
            let filename = tex.filename.to_string(m2_data)?;
            legacy_textures.push(LegacyTexture {
                filename,
                flags: tex.flags,
            });
        }

        Ok(M2 {
            texture_ids: txid.unwrap_or_default(),
            skin_ids: sfid.ok_or("M2 didn't have SFID chunk!".to_string())?,
            animation_manager,
            flags: header.flags,
            txac,
            name: header.get_name(m2_data)?,
            materials: header.get_materials(m2_data)?,
            vertex_data: Some(header.get_vertex_data(m2_data)?),
            texture_lookup_table: Some(header.get_texture_lookup_table(m2_data)?),
            bone_lookup_table: Some(header.get_bone_lookup_table(m2_data)?),
            particle_emitters: Some(particle_emitters),
            legacy_textures: Some(legacy_textures),
            texture_transforms_lookup_table: Some(header.get_texture_transforms_lookup_table(m2_data)?),
            transparency_lookup_table: Some(header.get_transparency_lookup_table(m2_data)?),
            header,
        })
    }

    pub fn get_txac_value(&self, index: usize) -> Option<u16> {
        self.txac.as_ref()?.get(index).cloned()
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

    pub fn take_particle_emitters(&mut self) -> Vec<Emitter> {
        self.particle_emitters.take().expect("particle emitters have already been taken")
    }

    pub fn get_vertex_stride() -> usize {
        // position + bone weights + bone indices + normal + texture coords
        12 + 4 + 4 + 12 + 2 * 8
    }

    pub fn take_vertex_data(&mut self) -> Vec<u8> {
        self.vertex_data.take().expect("M2 vertex data already taken")
    }
}

#[derive(DekuRead)]
pub struct Exp2Record {
    pub z_source: f32,
    pub _unk1: u32,
    pub _unk2: u32,
    pub _unk3: M2TrackPartial<Fixedi16>,
}

#[derive(DekuRead, Debug, Clone)]
pub struct M2Light {
    pub _light_type: u16, // should be 1 (point light) in all cases except the login screen
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

#[derive(Debug, Clone)]
#[wasm_bindgen(js_name = "WowM2LegacyTexture", getter_with_clone)]
pub struct LegacyTexture {
    pub filename: String,
    pub flags: u32,
}

#[derive(Debug, DekuRead, Clone)]
pub struct M2Texture {
    pub _type: u32,
    pub flags: u32,
    pub filename: WowCharArray,
}

#[derive(DekuRead, Debug, Clone)]
pub struct ParticleEmitterGravity {
    pub g: f32,
}

impl From<ParticleEmitterGravity> for f32 {
    fn from(value: ParticleEmitterGravity) -> Self {
        value.g
    }
}

impl From<ParticleEmitterGravity> for Vec3 {
    fn from(value: ParticleEmitterGravity) -> Self {
        let bytes = value.g.to_le_bytes();
        let x = bytes[0] as f32 / 128.0;
        let y = bytes[1] as f32 / 128.0;
        let mut z = 1.0 - (x * x + y * y).sqrt();
        let mut mag = u16::from_le_bytes([bytes[2], bytes[3]]) as f32 * 0.04238648;

        if mag < 0.0 {
            z = -z;
            mag = -mag;
        }

        Vec3 {
            x: x * mag,
            y: y * mag,
            z: z * mag,
        }
    }
}

#[derive(Debug, DekuRead, Clone)]
pub struct ParticleEmitter {
    pub particle_id: i32, // maybe always -1
    pub flags: u32,
    pub position: Vec3,
    pub bone: u16,
    pub texture_id: u16, // maybe unused?
    geometry_model_filename_unallocated: WowCharArray,
    #[deku(skip)] geometry_model_filename: Option<String>,
    recursion_model_filename_unallocated: WowCharArray,
    #[deku(skip)] recursion_model_filename: Option<String>,
    pub blending_type: u8,
    pub emitter_type: u8, // 1 - Plane, 2 - Sphere, 3 - Spline, 4 - Bone
    pub particle_color_index: u16,
    pub multi_tex_param_x_0: u8,
    pub multi_tex_param_x_1: u8,
    pub texture_tile_rotation: u16,
    pub texture_dimension_rows: u16,
    pub texture_dimensions_cols: u16,
    pub(crate) emission_speed: M2Track<f32>,
    pub(crate) speed_variation: M2Track<f32>,
    pub(crate) vertical_range: M2Track<f32>,
    pub(crate) horizontal_range: M2Track<f32>,
    pub(crate) gravity: M2Track<ParticleEmitterGravity>,
    pub(crate) lifespan: M2Track<f32>,
    pub lifespan_variance: f32,
    pub(crate) emission_rate: M2Track<f32>,
    pub emission_rate_variance: f32,
    pub(crate) emission_area_length: M2Track<f32>,
    pub(crate) emission_area_width: M2Track<f32>,
    pub(crate) z_source: M2Track<f32>,
    pub(crate) color: M2TrackPartial<Vec3>,
    pub(crate) alpha: M2TrackPartial<Fixedi16>,
    pub(crate) scale: M2TrackPartial<Vec2>,
    pub scale_variance: Vec2,
    pub(crate) head_cell: M2TrackPartial<u16>,
    pub(crate) tail_cell: M2TrackPartial<u16>,
    pub tail_length: f32,
    pub twinkle_speed: f32,
    pub twinkle_percent: f32,
    pub twinkle_scale: Vec2,
    pub burst_multiplier: f32,
    pub drag: f32,
    pub base_spin: f32,
    pub base_spin_variance: f32,
    pub spin: f32,
    pub spin_variance: f32,
    pub tumble_min: Vec3,
    pub tumble_max: Vec3,
    pub wind_vector: Vec3,
    pub wind_time: f32,
    pub follow_speed1: f32,
    pub follow_scale1: f32,
    pub follow_speed2: f32,
    pub follow_scale2: f32,
    spline_points_unallocated: WowArray<Vec3>,
    #[deku(skip)] pub spline_points: Option<Vec<Vec3>>,
    pub(crate) enabled: M2Track<u8>,

    texture_velocity0: [u16; 2],
    texture_velocity1: [u16; 2],
    texture_velocity_variance0: [u16; 2],
    texture_velocity_variance1: [u16; 2],
}

#[wasm_bindgen(js_name = "WowM2ParticleShaderType")]
#[derive(Debug, Copy, Clone)]
pub enum ParticleShaderType {
    Mod,
    TwoColorTexThreeAlphaTex,
    ThreeColorTexThreeAlphaTex,
    ThreeColorTexThreeAlphaTexUV,
    Refraction,
}

impl ParticleEmitter {
    pub fn check_flag(&self, mask: u32) -> bool {
        (self.flags & mask) > 0
    }

    pub fn set_flags(&mut self, mask: u32, value: bool) {
        let mask_off = self.flags & !mask;
        if value {
            self.flags = mask_off | mask;
        } else {
            self.flags = mask_off;
        }
    }

    pub fn use_compressed_gravity(&self) -> bool {
        self.check_flag(0x800000)
    }

    pub fn has_multiple_textures(&self) -> bool {
        self.check_flag(0x10000000)
    }

    pub fn get_texture_velocity(&self, i: u8) -> Vec2 {
        let packed = if i == 0 { self.texture_velocity0 } else { self.texture_velocity1 };
        Vec2 {
            x: fixed_precision_6_9_to_f32(packed[0]),
            y: fixed_precision_6_9_to_f32(packed[1]),
        }
    }

    pub fn get_texture_velocity_variance(&self, i: u8) -> Vec2 {
        let packed = if i == 0 { self.texture_velocity_variance0 } else { self.texture_velocity_variance1 };
        Vec2 {
            x: fixed_precision_6_9_to_f32(packed[0]),
            y: fixed_precision_6_9_to_f32(packed[1]),
        }
    }

    pub fn emits_head_particles(&self) -> bool {
        self.check_flag(0x20000)
    }

    pub fn emits_tail_particles(&self) -> bool {
        self.check_flag(0x40000)
    }

    pub fn translate_particle_with_bone(&self) -> bool {
        self.check_flag(0x10)
    }

    pub fn get_blend_mode(&self) -> M2BlendingMode {
        match self.blending_type {
            1 => M2BlendingMode::AlphaKey,
            2 => M2BlendingMode::Alpha,
            3 => M2BlendingMode::NoAlphaAdd,
            4 => M2BlendingMode::Add,
            5 => M2BlendingMode::Mod,
            6 => M2BlendingMode::Mod2x,
            7 => M2BlendingMode::BlendAdd,
            _ => M2BlendingMode::Opaque,
        }
    }

    pub fn take_spline_points(&mut self) -> Vec<Vec3> {
        self.spline_points.take().expect("spline points already taken")
    }

    pub fn calculate_particle_type(&self) -> u32 {
        if !self.check_flag(0x10100000) {
            return 0;
        } else if self.check_flag(0x1c) {
                return 2;
        } else {
            return 3;
        }
    }

    pub fn calculate_shader_type(&self, txac: u16) -> ParticleShaderType {
        let particle_type = self.calculate_particle_type();
        // some awful undocumented flag stuff
        let mut material0x20 = false;
        if self.check_flag(0x10000000) {
            material0x20 = self.check_flag(0x40000000);
        }

        let multi_tex = self.check_flag(0x10000000);
        if particle_type == 2 || (particle_type == 4 && multi_tex && txac != 0) {
            assert!(material0x20);
            return ParticleShaderType::ThreeColorTexThreeAlphaTexUV;
        } else if  particle_type == 2 || (particle_type == 4 && multi_tex) {
            if material0x20 {
                return ParticleShaderType::ThreeColorTexThreeAlphaTex;
            } else {
                return ParticleShaderType::TwoColorTexThreeAlphaTex;
            }
        } else if particle_type == 3 {
            return ParticleShaderType::Refraction;
        } else {
            return ParticleShaderType::Mod;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wow::sheep::SheepfileManager;

    #[test]
    fn test() {
        let sheep_path = "../data/WorldOfWarcraft/sheep0";
        let campfire = SheepfileManager::load_file_id_data(sheep_path, 202050).unwrap();
        let _m2 = M2::new(&campfire).unwrap();
    }
}
