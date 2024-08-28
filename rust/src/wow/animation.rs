use deku::prelude::*;
use js_sys::Uint8Array;
use wasm_bindgen::prelude::*;
use js_sys::Float32Array;
use crate::wow::m2::*;
use crate::wow::common::*;

#[derive(Debug, Clone)]
struct LcgRng {
    state: u32,
}

impl LcgRng {
    pub fn new(seed: u32) -> Self {
        LcgRng { state: seed }
    }

    pub fn next_u16(&mut self) -> u16 {
        self.state = self.state.wrapping_mul(1_103_515_245).wrapping_add(12_345);
        self.state %= 1 << 31;
        self.state as u16
    }

    pub fn next_f32(&mut self) -> f32 {
        self.next_u16() as f32 / std::u16::MAX as f32
    }
}

#[derive(DekuRead, Debug, Clone)]
pub struct M2CompBone {
    pub key_bone_id: i32,
    pub flags: u32,
    pub parent_bone: i16,
    pub submesh_id: u16,
    pub bone_name_crc: u32,
    pub translation: M2Track<Vec3>,
    pub rotation_quat16: M2Track<Quat16>,
    #[deku(skip)] pub rotation: Option<M2Track<Quat>>,
    pub scaling: M2Track<Vec3>,
    pub pivot: Vec3,
}

#[derive(DekuRead, Debug, Clone)]
pub struct M2Sequence {
    pub id: u16, // lookup table id?
    pub sub_id: u16, // which number in a row of animations this one is
    pub duration: u32, // in milliseconds
    pub movespeed: f32, // speed the character moves with in the animation
    pub flags: u32,
    #[deku(pad_bytes_after = "2")]
    pub frequency: u16, // how often this should be played (for all animations of the same type, this adds up to 0x7fff)
    pub replay_min: u32,
    pub replay_max: u32,
    pub blend_time: u32,
    pub bounds_aabb: AABBox,
    pub bounds_radius: f32,
    pub variation_next: i16, // id of the next animation of this animation id, -1 if none
    pub alias_next: u16, // id in the list of animations, used to find actual animation if this sequence is an alias (flags & 0x40)
}

impl M2Sequence {
    fn calculate_animation_repeats(&self, rng: &mut LcgRng) -> i32 {
        let times = (self.replay_max - self.replay_min) as f32;
        self.replay_min as i32 + (times * rng.next_f32()) as i32
    }
}

#[derive(DekuRead, Debug, Clone)]
pub struct M2TrackPartial<T> {
    pub timestamps_unallocated: WowArray<u16>,
    #[deku(skip)] pub timestamps: Option<Vec<u16>>,
    pub values_unallocated: WowArray<T>,
    #[deku(skip)] pub values: Option<Vec<T>>,
}

impl<T> M2TrackPartial<T> {
    pub fn allocate(&mut self, data: &[u8]) -> Result<(), String>
        where for<'a> T: DekuRead<'a> {
        self.timestamps = Some(self.timestamps_unallocated.to_vec(data)?);
        self.values = Some(self.values_unallocated.to_vec(data)?);

        Ok(())
    }

    pub fn timestamps(&self) -> &Vec<u16> {
        self.timestamps.as_ref().expect("must call M2TrackPartial::allocate() before accessing timestamps")
    }

    pub fn values(&self) -> &Vec<T> {
        self.values.as_ref().expect("must call M2TrackPartial::allocate() before accessing values")
    }
}

#[derive(DekuRead, Debug, Clone)]
pub struct M2Track<T> {
    pub interpolation_type: u16,
    pub global_sequence: i16,
    pub timestamps_unallocated: WowArray<WowArray<u32>>,
    #[deku(skip)] pub timestamps: Option<Vec<Vec<u32>>>,
    pub values_unallocated: WowArray<WowArray<T>>,
    #[deku(skip)] pub values: Option<Vec<Vec<T>>>,
}

impl<T> M2Track<T> {
    pub fn allocate(&mut self, data: &[u8]) -> Result<(), String>
        where for<'a> T: DekuRead<'a> {
        let mut timestamps = Vec::new();
        for arr in self.timestamps_unallocated.to_vec(data)? {
            timestamps.push(arr.to_vec(data)?);
        }
        self.timestamps = Some(timestamps);

        let mut values = Vec::new();
        for arr in self.values_unallocated.to_vec(data)? {
            values.push(arr.to_vec(data)?);
        }
        self.values = Some(values);

        Ok(())
    }

    pub fn timestamps(&self) -> &Vec<Vec<u32>> {
        self.timestamps.as_ref().expect("must call M2Track::allocate() before accessing timestamps")
    }

    pub fn values(&self) -> &Vec<Vec<T>> {
        self.values.as_ref().expect("must call M2Track::allocate() before accessing values")
    }
}

impl<T> M2Track<T> where T: PartialOrd + Copy {
    pub fn max_value(&self, default: T) -> T {
        let values = self.values();
        let mut max = default;
        for i in 0..values.len() {
            for j in 0..values[i].len() {
                if max < values[i][j] {
                    max = values[i][j];
                }
            }
        }
        max
    }
}

#[derive(DekuRead, Debug, Clone)]
pub struct M2TextureTransform {
    pub translation: M2Track<Vec3>,
    pub rotation: M2Track<Quat>,
    pub scaling: M2Track<Vec3>,
}

#[derive(DekuRead, Debug, Clone)]
pub struct M2Color {
    pub color: M2Track<Vec3>, // rgb
    pub alpha: M2Track<Fixedi16>, // 0 = transparent, 0x7FFF = opaque
}

#[derive(Debug, Clone)]
pub struct AnimationState {
    pub animation_index: Option<usize>,
    pub repeat_times: i32,
    pub animation_time: f64,
    pub main_variation_index: usize,
}

impl AnimationState {
    fn new(maybe_index: Option<usize>) -> Self {
        match maybe_index {
            Some(index) => AnimationState {
                animation_index: Some(index),
                repeat_times: 0,
                animation_time: 0.0,
                main_variation_index: index,
            },
            None => AnimationState {
                animation_index: None,
                repeat_times: 0,
                animation_time: 0.0,
                main_variation_index: 0,
            }
        }
    }
}

#[wasm_bindgen(js_name = "WowM2AnimationManager")]
#[derive(Debug, Clone)]
pub struct AnimationManager {
    global_sequence_durations: Vec<u32>,
    global_sequence_times: Vec<f64>,
    sequences: Vec<M2Sequence>,
    texture_weights: Vec<M2Track<Fixedi16>>,
    texture_transforms: Vec<M2TextureTransform>,
    current_animation: AnimationState,
    next_animation: AnimationState,
    rng: LcgRng,
    blend_factor: f32,
    colors: Vec<M2Color>,
    bones: Vec<M2CompBone>,
    lights: Vec<M2Light>,
}

#[wasm_bindgen(js_class = "WowM2AnimationManager")]
impl AnimationManager {
    pub fn update(&mut self, delta_time: f64) {
        self.current_animation.animation_time += delta_time;

        for i in 0..self.global_sequence_times.len() {
            self.global_sequence_times[i] += delta_time;
            if self.global_sequence_durations[i] > 0 {
                self.global_sequence_times[i] %= self.global_sequence_durations[i] as f64;
            }
        }

        let main_variation_record = &self.sequences[self.current_animation.main_variation_index];

        // If we don't have a next animation yet, and this animation isn't set
        // to repeat again, choose the next one
        let mut sub_anim_record: Option<&M2Sequence> = None;
        if self.next_animation.animation_index.is_none()
            && main_variation_record.variation_next > -1
            && self.current_animation.repeat_times <= 0 {

            let probability = (self.rng.next_f32() * 0x7fff as f32) as u16;
            let mut calc_prob = 0;

            let mut next_index = self.current_animation.main_variation_index;
            let mut next_record = &self.sequences[next_index];
            calc_prob += next_record.frequency;
            while calc_prob < probability && next_record.variation_next > -1 {
                next_index = next_record.variation_next as usize;
                next_record = &self.sequences[next_index];

                if self.current_animation.animation_index != Some(next_index) {
                    calc_prob += next_record.frequency;
                }
            }
            sub_anim_record = Some(next_record);

            self.next_animation.animation_index = Some(next_index);
            self.next_animation.animation_time = 0.0;
            self.next_animation.main_variation_index = self.current_animation.main_variation_index;
            self.next_animation.repeat_times = self.sequences[next_index].calculate_animation_repeats(&mut self.rng);
        } else if self.current_animation.repeat_times > 0 {
            self.next_animation = self.current_animation.clone();
            self.next_animation.repeat_times -= 1;
        }

        let current_record = &self.sequences[self.current_animation.animation_index.unwrap()];
        let current_animation_time_left = current_record.duration as f64 - self.current_animation.animation_time;
        let mut sub_anim_blend_time = 0.0;

        // if we have a next animation stored, get its blend time
        if let Some(next_index) = self.next_animation.animation_index {
            sub_anim_record = Some(&self.sequences[next_index]);
            sub_anim_blend_time = self.sequences[next_index].blend_time as f64;
        }

        // if it's time to start blending into the next animation, setup an appropriate blend factor
        if sub_anim_blend_time > 0.0 && current_animation_time_left < sub_anim_blend_time {
            self.next_animation.animation_time = (sub_anim_blend_time - current_animation_time_left) % sub_anim_record.unwrap().duration as f64;
            self.blend_factor = (current_animation_time_left / sub_anim_blend_time) as f32;
        } else {
            self.blend_factor = 1.0;
        }

        // if the current animation is done and we have a next animation, swap
        // them. otherwise, loop the current one
        if self.current_animation.animation_time >= current_record.duration as f64 {
            self.current_animation.repeat_times -= 1;

            if let Some(index) = self.next_animation.animation_index {
                let mut next_index = index;
                // if the next animation is an alias, look it up
                while ((self.sequences[next_index].flags & 0x20) == 0) && ((self.sequences[next_index].flags & 0x40) > 0) {
                    next_index = self.sequences[next_index].alias_next as usize;
                    if next_index >= self.sequences.len() {
                        break;
                    }
                }
                self.next_animation.animation_index = Some(next_index);

                self.current_animation = self.next_animation.clone();

                self.next_animation.animation_index = None;
                self.blend_factor = 1.0;
            } else if current_record.duration > 0 {
                self.current_animation.animation_time %= current_record.duration as f64;
            }
        }
    }

    pub fn update_lights(
        &self,
        ambient_light_colors: &Float32Array,
        diffuse_light_colors: &Float32Array,
        light_attenuation_starts: &Float32Array,
        light_attenuation_ends: &Float32Array,
        light_visibilities: &Uint8Array
    ) {
        let default_color = Vec3::new(1.0);
        let default_intensity = 1.0;
        for (i, light) in self.lights.iter().enumerate() {
            let color_index = i as u32 * 4;
    
            let ambient_color = self.get_current_value_with_blend(&light.ambient_color, default_color);
            let ambient_intensity = self.get_current_value_with_blend(&light.ambient_intensity, default_intensity);
            ambient_light_colors.set_index(color_index, ambient_color.x);
            ambient_light_colors.set_index(color_index + 1, ambient_color.y);
            ambient_light_colors.set_index(color_index + 2, ambient_color.z);
            ambient_light_colors.set_index(color_index + 3, ambient_intensity);

            let diffuse_color = self.get_current_value_with_blend(&light.diffuse_color, default_color);
            let diffuse_intensity = self.get_current_value_with_blend(&light.diffuse_intensity, default_intensity);
            diffuse_light_colors.set_index(color_index, diffuse_color.x);
            diffuse_light_colors.set_index(color_index + 1, diffuse_color.y);
            diffuse_light_colors.set_index(color_index + 2, diffuse_color.z);
            diffuse_light_colors.set_index(color_index + 3, diffuse_intensity);

            let attenuation_start = self.get_current_value_with_blend(&light.attenuation_start, 1.0);
            light_attenuation_starts.set_index(i as u32, attenuation_start);
            let attenuation_end = self.get_current_value_with_blend(&light.attenuation_end, 1.0);
            light_attenuation_ends.set_index(i as u32, attenuation_end);
            let visibility = self.get_current_value_with_blend(&light.visibility, 0);
            light_visibilities.set_index(i as u32, visibility);
        }
    }
    
    pub fn update_vertex_colors(&self, colors: &Float32Array) {
        let default_color = Vec3::new(1.0);
        let default_alpha = Fixedi16::from(1.0);
        for i in 0..self.colors.len() {
            let color = &self.colors[i];
            let color_index = i as u32 * 4;
            let rgb = self.get_current_value_with_blend(&color.color, default_color);
            let alpha = self.get_current_value_with_blend(&color.alpha, default_alpha);
            colors.set_index(color_index, rgb.x);
            colors.set_index(color_index + 1, rgb.y);
            colors.set_index(color_index + 2, rgb.z);
            colors.set_index(color_index + 3, alpha.into());
        }
    }
    
    pub fn update_bones(&self, bone_translations: &Float32Array, bone_rotations: &Float32Array, bone_scalings: &Float32Array) {
        let default_translation = Vec3::new(0.0);
        let default_rotation = Quat { x: 0.0, y: 0.0, z: 0.0, w: 1.0 };
        let default_scaling = Vec3::new(1.0);
        for (i, bone) in self.bones.iter().enumerate() {
            let translation_index = i as u32 * 3;
            let translation = self.get_current_value_with_blend(&bone.translation, default_translation);
            bone_translations.set_index(translation_index, translation.x);
            bone_translations.set_index(translation_index + 1, translation.y);
            bone_translations.set_index(translation_index + 2, translation.z);
    
            let rotation_index = i as u32 * 4;
            let rotation = self.get_current_value_with_blend(bone.rotation.as_ref().unwrap(), default_rotation);
            bone_rotations.set_index(rotation_index, rotation.x);
            bone_rotations.set_index(rotation_index + 1, rotation.y);
            bone_rotations.set_index(rotation_index + 2, rotation.z);
            bone_rotations.set_index(rotation_index + 3, rotation.w);
    
            let scaling_index = i as u32 * 3;
            let scaling = self.get_current_value_with_blend(&bone.scaling, default_scaling);
            bone_scalings.set_index(scaling_index, scaling.x);
            bone_scalings.set_index(scaling_index + 1, scaling.y);
            bone_scalings.set_index(scaling_index + 2, scaling.z);
        }
    }
    
    pub fn update_textures(&self, transparencies: &Float32Array, texture_translations: &Float32Array, texture_rotations: &Float32Array, texture_scalings: &Float32Array) {
        let default_alpha = Fixedi16::from(1.0);
        for (i, weight) in self.texture_weights.iter().enumerate() {
            let alpha = self.get_current_value_with_blend(&weight, default_alpha);
            transparencies.set_index(i as u32, alpha.into());
        }

        let default_translation = Vec3::new(0.0);
        let default_rotation = Quat { x: 0.0, y: 0.0, z: 0.0, w: 1.0 };
        let default_scaling = Vec3::new(1.0);
        for (i, transform) in self.texture_transforms.iter().enumerate() {
            let translation_index = i as u32 * 3;
            let translation = self.get_current_value_with_blend(&transform.translation, default_translation);
            texture_translations.set_index(translation_index, translation.x);
            texture_translations.set_index(translation_index + 1, translation.y);
            texture_translations.set_index(translation_index + 2, translation.z);
    
            let rotation_index = i as u32 * 4;
            let rotation = self.get_current_value_with_blend(&transform.rotation, default_rotation);
            texture_rotations.set_index(rotation_index, rotation.x);
            texture_rotations.set_index(rotation_index + 1, rotation.y);
            texture_rotations.set_index(rotation_index + 2, rotation.z);
            texture_rotations.set_index(rotation_index + 3, rotation.w);
    
            let scaling_index = i as u32 * 3;
            let scaling = self.get_current_value_with_blend(&transform.scaling, default_scaling);
            texture_scalings.set_index(scaling_index, scaling.x);
            texture_scalings.set_index(scaling_index + 1, scaling.y);
            texture_scalings.set_index(scaling_index + 2, scaling.z);
        }
    }
    
    pub fn get_sequence_ids(&self) -> Vec<u16> {
        self.sequences.iter().map(|seq| seq.id).collect()
    }

    pub fn set_sequence_id(&mut self, id: u16) {
        let index = self.sequences.iter()
            .position(|seq| seq.id == id)
            .unwrap();
        self.current_animation = AnimationState::new(Some(index));
        self.current_animation.repeat_times = self.sequences[index].calculate_animation_repeats(&mut self.rng);
        self.next_animation = AnimationState::new(None);
    }

    pub fn get_num_colors(&self) -> usize {
        self.colors.len()
    }

    pub fn get_num_bones(&self) -> usize {
        self.bones.len()
    }

    pub fn get_num_lights(&self) -> usize {
        self.lights.len()
    }

    pub fn get_light_bones(&self) -> Vec<i16> {
        self.lights.iter().map(|light| light.bone).collect()
    }

    pub fn get_light_positions(&self) -> Vec<f32> {
        let mut result = Vec::with_capacity(self.lights.len() * 3);
        for light in &self.lights {
            result.push(light.position.x);
            result.push(light.position.y);
            result.push(light.position.z);
        }
        result
    }

    pub fn get_bone_pivots(&self) -> Vec<Vec3> {
        self.bones.iter().map(|bone| bone.pivot).collect()
    }

    pub fn get_bone_parents(&self) -> Vec<i16> {
        self.bones.iter().map(|bone| bone.parent_bone).collect()
    }

    pub fn get_bone_flags(&self) -> Vec<M2BoneFlags> {
        self.bones.iter().map(|bone| M2BoneFlags::new(bone.flags)).collect()
    }

    pub fn get_num_transformations(&self) -> usize {
        self.texture_transforms.len()
    }

    pub fn get_num_texture_weights(&self) -> usize {
        self.texture_weights.len()
    }
}

// rust-only interface
impl AnimationManager {
    pub fn new(
        global_sequence_durations: Vec<u32>,
        sequences: Vec<M2Sequence>,
        texture_weights: Vec<M2Track<Fixedi16>>,
        texture_transforms: Vec<M2TextureTransform>,
        colors: Vec<M2Color>,
        bones: Vec<M2CompBone>,
        lights: Vec<M2Light>,
    ) -> Self {
        let global_sequence_times = vec![0.0; global_sequence_durations.len()];
        // pull out the "Stand" animation, which is the resting animation for all models
        let index = sequences.iter()
            .position(|seq| seq.id == 0)
            .unwrap();
        let mut current_animation = AnimationState::new(Some(index));
        let mut rng = LcgRng::new(1312);
        current_animation.repeat_times = sequences[index].calculate_animation_repeats(&mut rng);
        let next_animation = AnimationState::new(None);

        AnimationManager {
            global_sequence_durations,
            current_animation,
            next_animation,
            blend_factor: 0.0,
            sequences,
            texture_transforms,
            texture_weights,
            colors,
            bones,
            lights,
            global_sequence_times,
            rng,
        }
    }

    fn get_current_value<U, V>(&self, mut curr_time: f64, mut animation_index: usize, animation: &M2Track<U>, default: V) -> V
        where V: Clone + Lerp, U: Into<V> + Clone
        {
        if animation.global_sequence >= 0 {
            curr_time = self.global_sequence_times[animation.global_sequence as usize];
        }

        if animation.timestamps().len() <= animation_index {
            animation_index = 0;
        }

        if animation.timestamps().is_empty() {
            return default;
        }

        if animation_index <= animation.timestamps().len() && animation.timestamps()[animation_index].is_empty() {
            return default;
        }

        let times = &animation.timestamps()[animation_index];
        let values = &animation.values()[animation_index];

        if let Some(time_index) = find_timestamp_index(times, curr_time) {
            if time_index == times.len() - 1 {
                values[time_index].clone().into()
            } else {
                let value1 = &values[time_index];
                let value2 = &values[time_index + 1];
                let time1 = times[time_index];
                let time2 = times[time_index + 1];

                if animation.interpolation_type == 0 {
                    return <U as Into<V>>::into(value1.clone());
                } else if animation.interpolation_type == 1 {
                    let t = (curr_time - time1 as f64) / (time2 as f64 - time1 as f64);
                    return value1.clone().into().lerp(value2.clone().into(), t as f32);
                } else {
                    unreachable!("unknown interpolation type!")
                }
            }
        } else {
            return values[0].clone().into();
        }
    }

    pub fn get_current_value_with_blend<U, V>(&self, animation: &M2Track<U>, default: V) -> V
        where V: Clone + Lerp, U: Into<V> + Clone {
        let result = self.get_current_value(
            self.current_animation.animation_time,
            self.current_animation.animation_index.unwrap(),
            animation,
            default.clone()
        );
        
        if self.blend_factor < 0.999 {
            if let Some(next_index) = self.next_animation.animation_index {
                let next_result = self.get_current_value(
                    self.next_animation.animation_time,
                    next_index,
                    animation,
                    default.clone()
                );

                return result.lerp(next_result, self.blend_factor);
            }
        }

        result
    }

    pub fn get_particle_value<T>(&self, age: f64, animation: &M2TrackPartial<T>, default: T) -> T
        where T: Clone + Lerp {
            let num_timestamps = animation.timestamps().len();
            if num_timestamps == 0 {
                return default;
            }

            if let Some(time_index) = find_timestamp_index(animation.timestamps(), age) {
                if time_index == num_timestamps - 1 {
                    animation.values()[time_index].clone()
                } else {
                    let value1 = animation.values()[time_index].clone();
                    let time1 = animation.timestamps()[time_index].as_timestamp();
                    let value2 = animation.values()[time_index + 1].clone();
                    let time2 = animation.timestamps()[time_index + 1].as_timestamp();
                    let t = (age - time1) / (time2 - time1);
                    value1.lerp(value2, t as f32)
                }
            } else {
                animation.values()[0].clone()
            }
        }
}

trait AsTimestamp {
    fn as_timestamp(&self) -> f64;
}

impl AsTimestamp for u32 {
    fn as_timestamp(&self) -> f64 { *self as f64 }
}

impl AsTimestamp for u16 {
    fn as_timestamp(&self) -> f64 {
        *self as f64 / 32768.0
    }
}

fn find_timestamp_index<T: AsTimestamp>(timestamps: &Vec<T>, curr_time: f64) -> Option<usize> {
    if timestamps.len() > 1 {
        let last_index = timestamps.len() - 1;
        if curr_time > timestamps[last_index].as_timestamp() {
            Some(last_index)
        } else {
            let next_timestamp_idx = timestamps.iter().position(|time| {
                time.as_timestamp() >= curr_time
            }).unwrap();
            if next_timestamp_idx != 0 {
                Some(next_timestamp_idx - 1)
            } else {
                Some(next_timestamp_idx)
            }
        }
    } else if timestamps.len() == 1 {
        Some(0)
    } else {
        None
    }
}
