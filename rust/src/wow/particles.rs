use js_sys::Float32Array;
use nalgebra_glm::{mat4_to_mat3, pi, quat_angle_axis, quat_to_mat3, vec2, vec3, vec3_to_vec4, Mat4, Vec2, Vec3, Vec4};
use rand::{rngs::ThreadRng, thread_rng, Rng};
use wasm_bindgen::prelude::*;

use crate::spline::BezierSpline;

use super::{
    animation::AnimationManager,
    common::{Vec3 as WowVec3, Vec2 as WowVec2, Fixedi16},
    m2::{M2BlendingMode, ParticleEmitter as M2ParticleEmitter, ParticleShaderType},
};

pub const TEXELS_PER_PARTICLE: usize = 4;
const PARTICLE_COORDINATE_FIX_SLICE: &[f32] = &[
    0.0, 1.0, 0.0, 0.0,
    -1.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 1.0, 0.0,
    0.0, 0.0, 0.0, 1.0,
];

#[derive(Default, Debug, Clone)]
struct Particle {
    age: f32,
    lifespan: f32,
    color: Vec4,
    scale: Vec2,
    tex_coord_head: Vec2,
    tex_coord_tail: Vec2,
    position: Vec3,
    velocity: Vec3,
}
impl Particle {
    fn is_alive(&self) -> bool {
        self.age < self.lifespan
    }

    fn create_planar(emitter: &mut Emitter) -> Self {
        let position = vec3(
            emitter.random_range(1.0) * emitter.params.emission_area_length * 0.5,
            emitter.random_range(1.0) * emitter.params.emission_area_width * 0.5,
            0.0,
        );
        let mut velocity: Vec3;
        if emitter.params.z_source < 0.001 {
            let polar = emitter.params.vertical_range * emitter.random_range(1.0);
            let azimuth = emitter.params.horizontal_range * emitter.random_range(1.0);
            velocity = vec3(
                azimuth.cos() * polar.sin(),
                azimuth.sin() * polar.sin(),
                polar.cos(),
            );
            velocity *= emitter.emission_speed();
        } else {
            velocity = position - vec3(0.0, 0.0, emitter.params.z_source);
            if velocity.magnitude() > 0.0001 {
                velocity.normalize_mut();
                velocity *= emitter.emission_speed();
            }
        }

        Particle::new(position, velocity, emitter.lifespan())
    }
    
    fn create_spherical(emitter: &mut Emitter) -> Self {
        let emission_area = emitter.params.emission_area_width - emitter.params.emission_area_length;
        let radius = emitter.params.emission_area_length + emitter.rng.gen_range(0.0..1.0) * emission_area;
        let polar = emitter.random_range(1.0) * emitter.params.vertical_range;
        let azimuth = emitter.random_range(1.0) * emitter.params.horizontal_range;
        let emission_dir = vec3(
            polar.cos() * azimuth.cos(),
            polar.cos() * azimuth.sin(),
            polar.sin()
        );
        let position = emission_dir * radius;

        let mut velocity: Vec3;
        if emitter.params.z_source < 0.001 {
            let particles_go_up = emitter.inner.check_flag(0x100);
            if particles_go_up {
                velocity = vec3(0.0, 0.0, 1.0);
            } else {
                velocity = vec3(
                    polar.cos() * azimuth.cos(),
                    polar.cos() * azimuth.sin(),
                    polar.sin()
                );
            }
        } else {
            velocity = position - vec3(0.0, 0.0, emitter.params.z_source);
            if velocity.magnitude() > 0.0001 {
                velocity.normalize_mut();
            }
        }

        velocity *= emitter.emission_speed();

        Particle::new(position, velocity, emitter.lifespan())
    }
    
    fn create_spline(emitter: &mut Emitter) -> Self {
        let t = emitter.params.emission_area_length.min(1.0).max(0.0);
        let spline = emitter.spline.as_ref().expect("create_spline called, but no spline points found");

        let mut position: Vec3;
        if t > 0.0 {
            if t < 1.0 {
                position = spline.calculate_paramateric_spline(t);
            } else {
                position = spline.points[spline.points.len() - 1];
            }
        } else {
            position = spline.points[0];
        }

        let mut velocity: Vec3;
        if emitter.params.z_source < 0.001 {
            let dz = position[2] - emitter.params.z_source;
            velocity = position.clone();
            velocity[2] = dz;
            velocity.normalize_mut();
            velocity *= emitter.emission_speed();
        } else if emitter.params.vertical_range != 0.0 {
            // this is insane. treat the spline's derivative at t as a rotation vector, and the
            // emitter's verticalRange parameter as a rotation (in degrees). then, set the velocity
            // to the resulting rotation along just the Z axis. i guess.
            let mut rot_axis = spline.calculate_parametric_spline_derivative(t);
            rot_axis.normalize_mut();
            let rot_radians = emitter.params.vertical_range * pi::<f32>() / 180.0;
            let rot_quat = quat_angle_axis(emitter.random_range(1.0) * rot_radians, &rot_axis);
            let rot_mat = quat_to_mat3(&rot_quat);
            velocity = vec3(rot_mat[6], rot_mat[7], rot_mat[8]);
            velocity *= emitter.emission_speed();
            if emitter.params.horizontal_range != 0.0 {
                let pos_offset = emitter.random_range(1.0) * emitter.params.horizontal_range;
                position[0] += pos_offset;
                position[1] += pos_offset;
                position[2] += pos_offset;
            }
        } else {
            velocity = vec3(0.0, 0.0, emitter.emission_speed());
        }

        Particle::new(position, velocity, emitter.lifespan())
    }

    fn new(position: Vec3, velocity: Vec3, lifespan: f32) -> Self {
        Particle {
            position,
            velocity,
            lifespan,
            ..Default::default()
        }
    }
}

#[wasm_bindgen(js_name = "WowM2ParticleEmitterParams")]
#[derive(Default, Debug, Clone)]
pub struct EmitterParams {
    pub enabled: bool,
    gravity: Vec3,
    pub emission_speed: f32,
    pub speed_variation: f32,
    pub vertical_range: f32,
    pub horizontal_range: f32,
    pub lifespan: f32,
    pub emission_rate: f32,
    pub emission_area_length: f32,
    pub emission_area_width: f32,
    pub z_source: f32,
}

#[wasm_bindgen(js_name = "WowM2ParticleEmitter", getter_with_clone)]
#[derive(Debug, Clone)]
pub struct Emitter {
    inner: M2ParticleEmitter,
    rng: ThreadRng,
    model_mat: Mat4,
    particle_coordinate_fix: Mat4,
    particles: Vec<Particle>,
    wind: Vec3,
    particles_to_emit: f32,
    position: Vec3,
    spline: Option<BezierSpline>,
    tex_col_bits: u32,
    tex_col_mask: u32,
    z_source: Option<f32>,
    pub max_particles: usize,
    pub params: EmitterParams,
    pub tex_scale_x: f32,
    pub tex_scale_y: f32,
    pub alpha_test: f32,
    pub blend_mode: M2BlendingMode,
    pub frag_shader_type: ParticleShaderType,
    pub bone: u16,
}

impl Emitter {
    pub fn new(mut m2_emitter: M2ParticleEmitter, txac: u16, z_source: Option<f32>) -> Self {
        let model_mat = Mat4::identity();
        let wind = m2_emitter.wind_vector.into();
        let position = m2_emitter.position.into();
        let bone = m2_emitter.bone;
        let mut spline_points = m2_emitter.take_spline_points();
        let mut spline = None;
        if !spline_points.is_empty() {
            // convert WowVec3 -> nalgebra::Vec3
            let points = spline_points.drain(..).map(|p| p.into()).collect();
            spline = Some(BezierSpline::new(points));
        }
        let tex_col_bits = (m2_emitter.texture_dimensions_cols as f32).log2().ceil() as u32;
        let tex_col_mask = (1 << tex_col_bits) - 1;
        let tex_scale_x = 1.0 / m2_emitter.texture_dimension_rows as f32;
        let tex_scale_y = 1.0 / m2_emitter.texture_dimensions_cols as f32;
        let max_particles = (m2_emitter.lifespan.max_value(0.0) * m2_emitter.emission_rate.max_value(0.0) * 1.5) as usize;
        let alpha_test = match m2_emitter.blending_type {
            0 => -1.0,
            1 => 0.501960814,
            _ => 0.0039215689,
        };
        let frag_shader_type = m2_emitter.calculate_shader_type(txac);
        let blend_mode = m2_emitter.get_blend_mode();

        Emitter {
            model_mat,
            rng: thread_rng(),
            max_particles,
            particle_coordinate_fix: Mat4::from_column_slice(PARTICLE_COORDINATE_FIX_SLICE),
            particles: Vec::with_capacity(max_particles as usize),
            particles_to_emit: 0.0,
            params: EmitterParams::default(),
            wind,
            position,
            spline,
            tex_col_bits,
            tex_col_mask,
            tex_scale_x,
            tex_scale_y,
            alpha_test,
            frag_shader_type,
            blend_mode,
            bone,
            z_source,
            inner: m2_emitter,
        }
    }

    // returns value in (-a, a)
    fn random_range(&mut self, a: f32) -> f32 {
        if a == 0.0 {
            return 0.0;
        }
        self.rng.gen_range(-a..a)
    }

    fn update_params(&mut self, animation_manager: &mut AnimationManager) {
        let mut enabled: u8 = 1;
        if self.inner.enabled.timestamps().len() > 0 {
            enabled = animation_manager.get_current_value_with_blend(&self.inner.enabled, 0);
        }
        self.params.enabled = enabled > 0;

        if enabled > 0 {
            self.params.emission_speed = animation_manager.get_current_value_with_blend(&self.inner.emission_speed, 0.0);
            self.params.speed_variation = animation_manager.get_current_value_with_blend(&self.inner.speed_variation, 0.0);
            self.params.vertical_range = animation_manager.get_current_value_with_blend(&self.inner.vertical_range, 0.0);
            self.params.horizontal_range = animation_manager.get_current_value_with_blend(&self.inner.horizontal_range, 0.0);
            self.params.lifespan = animation_manager.get_current_value_with_blend(&self.inner.lifespan, 0.0);
            self.params.emission_rate = animation_manager.get_current_value_with_blend(&self.inner.emission_rate, 0.0);
            self.params.emission_area_length = animation_manager.get_current_value_with_blend(&self.inner.emission_area_length, 0.0);
            self.params.emission_area_width = animation_manager.get_current_value_with_blend(&self.inner.emission_area_width, 0.0);

            if let Some(z_source) = self.z_source {
                self.params.z_source = z_source;
            } else {
                self.params.z_source = animation_manager.get_current_value_with_blend(&self.inner.z_source, 0.0);
            }

            if self.inner.use_compressed_gravity() {
                self.params.gravity = animation_manager.get_current_value_with_blend(
                    &self.inner.gravity,
                    WowVec3::new(1.0)
                ).into();
            } else {
                self.params.gravity.z = animation_manager.get_current_value_with_blend(
                    &self.inner.gravity,
                    0.0
                ).into();
            }
        }
    }

    fn create_particle(&mut self) {
        let mut particle = match self.inner.emitter_type {
            1 => Particle::create_planar(self),
            2 => Particle::create_spherical(self),
            3 => Particle::create_spline(self),
            _ => panic!("unknown particle type {}", self.inner.emitter_type),
        };

        if !self.inner.check_flag(0x10) {
            particle.position = transform(&particle.position, &self.model_mat);
            particle.velocity = mat4_to_mat3(&self.model_mat) * particle.velocity;
            if self.inner.check_flag(0x2000) {
                particle.position[2] = 0.0;
            }
        }
        if self.inner.check_flag(0x40) {
            // TODO: add random burst value to velocity
        }
        if self.inner.check_flag(0x10000000) {
            // TODO: randomize particle texture stuff
        }
        self.particles.push(particle);
    }

    fn emission_rate(&mut self) -> f32 {
        self.params.emission_rate + self.random_range(self.inner.emission_rate_variance)
    }

    fn emission_speed(&mut self) -> f32 {
        self.params.emission_speed * (1.0 + self.random_range(self.params.speed_variation))
    }

    fn lifespan(&mut self) -> f32 {
        self.params.lifespan + self.random_range(self.inner.lifespan_variance)
    }
    
    fn extract_tex_coords(&self, cell: u16) -> Vec2 {
        let x_int = cell as u32 & self.tex_col_mask;
        let y_int = cell as u32 >> self.tex_col_bits;
        vec2(x_int as f32 * self.tex_scale_x, y_int as f32 * self.tex_scale_y)
    }
}

#[wasm_bindgen(js_class = "WowM2ParticleEmitter")]
impl Emitter {
    pub fn update(
        &mut self,
        dt_ms: f32,
        animation_manager: &mut AnimationManager,
        bone_transform_slice: &[f32],
        bone_post_billboard_transform_slice: &[f32]
    ) {
        assert_eq!(bone_transform_slice.len(), 16);
        assert_eq!(bone_post_billboard_transform_slice.len(), 16);

        let dt_secs = dt_ms / 1000.0;
        self.update_params(animation_manager);

        let bone_transform = Mat4::from_column_slice(bone_transform_slice);
        let bone_post_billboard_transform = Mat4::from_column_slice(bone_post_billboard_transform_slice);
        self.model_mat.fill_with_identity();
        self.model_mat.append_translation_mut(&self.position);
        self.model_mat = bone_post_billboard_transform * bone_transform * self.model_mat;
        self.model_mat = self.model_mat * self.particle_coordinate_fix;

        if self.params.enabled {
            self.particles_to_emit += self.emission_rate() * dt_secs;
            while self.particles_to_emit > 1.0 {
                if self.particles.len() < self.max_particles {
                    self.create_particle();
                }
                self.particles_to_emit -= 1.0;
            }
        }

        let force = self.wind - self.params.gravity;
        let max_lifespan = self.params.lifespan + self.inner.lifespan_variance;

        self.particles.retain_mut(|particle| {
            particle.age += dt_secs;
            particle.is_alive()
        });

        for i in 0..self.particles.len() {
            let age = self.particles[i].age;
            let age_pct = (age / max_lifespan) as f64;
            let default_color = WowVec3::default();
            let default_alpha = Fixedi16::from(1.0);
            let default_scale = WowVec2 { x: 1.0, y: 1.0 };
            let default_head_cell = 0;
            let default_tail_cell = 0;
            let mut rgb: Vec3 = animation_manager.get_particle_value(
                age_pct,
                &self.inner.color,
                default_color
            ).into();
            rgb /= 255.0;
            let alpha: f32 = animation_manager.get_particle_value(
                age_pct,
                &self.inner.alpha,
                default_alpha
            ).into();
            self.particles[i].color[0] = rgb[0];
            self.particles[i].color[1] = rgb[1];
            self.particles[i].color[2] = rgb[2];
            self.particles[i].color[3] = alpha;
            self.particles[i].scale = animation_manager.get_particle_value(
                age_pct,
                &self.inner.scale,
                default_scale
            ).into();
            let head_cell = animation_manager.get_particle_value(
                age_pct,
                &self.inner.head_cell,
                default_head_cell
            );
            self.particles[i].tex_coord_head = self.extract_tex_coords(head_cell);
            let tail_cell = animation_manager.get_particle_value(
                age_pct,
                &self.inner.tail_cell,
                default_tail_cell
            );
            self.particles[i].tex_coord_tail = self.extract_tex_coords(tail_cell);

            self.particles[i].velocity += force * dt_secs;
            if self.inner.drag > 0.0 {
                self.particles[i].velocity *= (1.0 - self.inner.drag).powf(dt_secs);
            }
            let dist = self.particles[i].velocity * dt_secs;
            self.particles[i].position += dist;
        }
    }

    pub fn fill_texture(&self, texture: &Float32Array) {
        let mut data = vec![0.0; self.max_particles * TEXELS_PER_PARTICLE * 4];
        for (i, particle) in self.particles.iter().enumerate() {
            let mut offs = TEXELS_PER_PARTICLE * i * 4;
            let mut pos = particle.position.clone();
            if self.inner.translate_particle_with_bone() {
                pos = transform(&particle.position, &self.model_mat);
            }
            let texel_slices = [
                pos.as_slice(),
                particle.color.as_slice(),
                particle.scale.as_slice(),
                particle.tex_coord_head.as_slice(),
            ];
            for slice in texel_slices {
                assert!(slice.len() <= 4);
                for j in 0..4 {
                    if j < slice.len() {
                        data[offs] = slice[j];
                    }
                    offs += 1;
                }
            }
        }
        texture.copy_from(&data);
    }

    pub fn get_texture_ids(&self) -> Vec<u16> {
        if self.inner.has_multiple_textures() {
            vec![
                self.inner.texture_id & 0x1f,
                (self.inner.texture_id >> 5) & 0x1f,
                (self.inner.texture_id >> 10) & 0x1f,
            ]
        } else {
            vec![self.inner.texture_id]
        }
    }

    pub fn get_texels_per_particle() -> usize {
        TEXELS_PER_PARTICLE
    }

    pub fn num_particles(&self) -> usize {
        self.particles.len()
    }
}

fn transform(p: &Vec3, m: &Mat4) -> Vec3 {
    let mut p_hom = vec3_to_vec4(p);
    p_hom[3] = 1.0;
    (m * p_hom).xyz()
}
