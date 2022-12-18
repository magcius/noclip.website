use std::{io::{Cursor, Seek, SeekFrom, Read}, convert::TryFrom};

use wasm_bindgen::prelude::*;
use byteorder::LittleEndian;
use byteorder::ReadBytesExt;
use num_enum::TryFromPrimitive;
use super::tag::*;
use super::common::*;

#[derive(Debug, Clone, TryFromPrimitive)]
#[repr(u16)]
pub enum RadiosityDetailLevel {
    High = 0,
    Medium = 1,
    Low = 2,
    Turd = 3, // smh
}

#[derive(Debug, Clone)]
pub struct ShaderEnvironment {
    // shader properties
    pub radiosity_flags: u16,
    pub radiosity_detail_level: RadiosityDetailLevel,
    pub radiosity_light_power: f32,
    pub radiosity_light_color: ColorRGB,
    pub radiosity_tint_color: ColorRGB,

    // shader environment properties
    pub flags: u16,
    pub shader_environment_type: ShaderEnvironmentType,
    pub lens_flare_spacing: f32,
    pub lens_flare: TagDependency,
    pub diffuse_flags: u16,
    pub base_bitmap: TagDependency,
    pub detail_bitmap_function: DetailBitmapFunction,
    pub primary_detail_bitmap_scale: f32,
    pub primary_detail_bitmap: TagDependency,
    pub secondary_detail_bitmap_scale: f32,
    pub secondary_detail_bitmap: TagDependency,
    pub micro_detail_scale: f32,
    pub micro_detail_bitmap_function: DetailBitmapFunction,
    pub micro_detail_bitmap: TagDependency,
    pub material_color: ColorRGB,
    pub bump_map_scale: f32,
    pub bump_map: TagDependency,
    pub specular_flags: u16,
    pub brightness: f32,
}

impl Deserialize for ShaderEnvironment {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let mut start = data.position();
        let radiosity_flags = data.read_u16::<LittleEndian>()?;
        let radiosity_detail_level = RadiosityDetailLevel::try_from(data.read_u16::<LittleEndian>()?)?;
        let radiosity_light_power = data.read_f32::<LittleEndian>()?;
        let radiosity_light_color = ColorRGB::deserialize(data)?;
        let radiosity_tint_color = ColorRGB::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 40))?;
        start = data.position();
        let flags = data.read_u16::<LittleEndian>()?;
        let shader_environment_type = ShaderEnvironmentType::try_from(data.read_u16::<LittleEndian>()?)?;
        let lens_flare_spacing = data.read_f32::<LittleEndian>()?;
        let lens_flare = TagDependency::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 68))?;
        let diffuse_flags = data.read_u16::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 96))?;
        let base_bitmap = TagDependency::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 136))?;
        let detail_bitmap_function = DetailBitmapFunction::try_from(data.read_u16::<LittleEndian>()?)?;
        data.seek(SeekFrom::Start(start + 140))?;
        let primary_detail_bitmap_scale = data.read_f32::<LittleEndian>()?;
        let primary_detail_bitmap = TagDependency::deserialize(data)?;
        let secondary_detail_bitmap_scale = data.read_f32::<LittleEndian>()?;
        let secondary_detail_bitmap = TagDependency::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 204))?;
        let micro_detail_bitmap_function = DetailBitmapFunction::try_from(data.read_u16::<LittleEndian>()?)?;
        data.seek(SeekFrom::Start(start + 208))?;
        let micro_detail_scale = data.read_f32::<LittleEndian>()?;
        let micro_detail_bitmap = TagDependency::deserialize(data)?;
        let material_color = ColorRGB::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 252))?;
        let bump_map_scale = data.read_f32::<LittleEndian>()?;
        let bump_map = TagDependency::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 596))?;
        let specular_flags = data.read_u16::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 616))?;
        let brightness = data.read_f32::<LittleEndian>()?;
        Ok(ShaderEnvironment {
            radiosity_flags,
            radiosity_detail_level,
            radiosity_light_power,
            radiosity_light_color,
            radiosity_tint_color,
            flags,
            shader_environment_type,
            lens_flare_spacing,
            lens_flare,
            diffuse_flags,
            base_bitmap,
            detail_bitmap_function,
            primary_detail_bitmap_scale,
            primary_detail_bitmap,
            secondary_detail_bitmap_scale,
            secondary_detail_bitmap,
            micro_detail_scale,
            micro_detail_bitmap_function,
            micro_detail_bitmap,
            material_color,
            bump_map_scale,
            bump_map,
            specular_flags,
            brightness,
        })
    }
}

#[wasm_bindgen]
#[derive(Debug, TryFromPrimitive, Copy, Clone)]
#[repr(u16)]
pub enum DetailBitmapFunction {
    DoubleBiasedMultiply = 0,
    Multiply = 1,
    DoubleBiasedAdd = 2,
}

#[wasm_bindgen]
#[derive(Debug, TryFromPrimitive, Copy, Clone)]
#[repr(u16)]
pub enum ShaderEnvironmentType {
    Normal = 0,
    Blended = 1,
    BlendedBaseSpecular = 2,
}