use std::{io::{Cursor, Seek, SeekFrom, Read}, convert::TryFrom};
use byteorder::{ReadBytesExt, LittleEndian};
use num_enum::{IntoPrimitive, TryFromPrimitive, TryFromPrimitiveError};

use crate::halo::common::*;
use crate::halo::util::*;
use crate::halo::tag::*;

pub struct Sky {
}

#[derive(Debug, IntoPrimitive, TryFromPrimitive, Copy, Clone)]
#[repr(u16)]
pub enum ObjectType {
    Biped = 0x0	,
    Vehicle = 0x1,
    Weapon = 0x2,
    Equipment = 0x3,
    Garbage = 0x4,
    Projectile = 0x5,
    Scenery = 0x6,
    DeviceMachine = 0x7,
    DeviceControl = 0x8,
    DeviceLightFixture = 0x9,
    PlaceHolder = 0xA,
    SoundScenery = 0xB,
}

#[derive(Debug)]
pub struct ObjectName {
    pub name: String,
    pub object_type: ObjectType,
    pub index: u16,
}

impl Deserialize for ObjectName {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(ObjectName {
            name: read_null_terminated_string(data)?,
            object_type: ObjectType::try_from(data.read_u16::<LittleEndian>()?)?,
            index: data.read_u16::<LittleEndian>()?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct ScenarioScenery {
    pub scenery_type: u16,
    pub name_index: u16,
    pub not_placed: u16,
    pub desired_permutation: u16,
    pub position: Point3D,
    pub rotation: Euler3D,
}

impl Deserialize for ScenarioScenery {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let scenery = ScenarioScenery {
            scenery_type: data.read_u16::<LittleEndian>()?,
            name_index: data.read_u16::<LittleEndian>()?,
            not_placed: data.read_u16::<LittleEndian>()?,
            desired_permutation: data.read_u16::<LittleEndian>()?,
            position: Point3D::deserialize(data)?,
            rotation: Euler3D::deserialize(data)?,
        };
        let _bsp_indices = data.read_u16::<LittleEndian>()?;
        Ok(scenery)
    }
}

#[derive(Debug, Clone)]
pub struct Scenario {
    pub skies: Block<TagDependency>,
    pub scenery: Block<ScenarioScenery>,
    pub scenery_palette: Block<TagDependency>,
    pub light_fixtures: Block<ScenarioLightFixture>,
    pub light_fixture_palette: Block<TagDependency>,
    pub decals: Block<ScenarioDecal>,
    pub decal_palette: Block<TagDependency>,
    pub detail_object_collection_palette: Block<TagDependency>,
    pub structure_bsps: Block<ScenarioStructureBSP>,
}

impl Deserialize for Scenario {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let start = data.position();
        dbg!(start);
        data.seek(SeekFrom::Start(start + 48))?;
        let skies: Block<TagDependency> = Block::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 528))?;
        let scenery: Block<ScenarioScenery> = Block::deserialize(data)?;
        let scenery_palette: Block<TagDependency> = Block::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 708))?;
        let light_fixtures: Block<ScenarioLightFixture> = Block::deserialize(data)?;
        let light_fixture_palette: Block<TagDependency> = Block::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 936))?;
        let decals: Block<ScenarioDecal> = Block::deserialize(data)?;
        let decal_palette: Block<TagDependency> = Block::deserialize(data)?;
        let detail_object_collection_palette: Block<TagDependency> = Block::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 1444))?; // skip to BSPs
        let structure_bsps: Block<ScenarioStructureBSP> = Block::deserialize(data)?;
        Ok(Scenario {
            skies,
            scenery,
            scenery_palette,
            light_fixtures,
            light_fixture_palette,
            decals,
            decal_palette,
            detail_object_collection_palette,
            structure_bsps,
        })
    }
}

#[derive(Debug, Clone)]
pub struct ScenarioStructureBSP {
    pub start: u32,
    pub size: u32,
    pub address: u32,
    pub structure_bsp: TagDependency,
}

impl Deserialize for ScenarioStructureBSP {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(ScenarioStructureBSP {
            start: data.read_u32::<LittleEndian>()?,
            size: data.read_u32::<LittleEndian>()?,
            address: data.read_u32::<LittleEndian>()?,
            structure_bsp: TagDependency::deserialize(data)?,
        })
    }
}

pub struct BSP {
    pub lightmaps_bitmap: TagDependency,
    pub default_ambient_color: ColorRGB,
    pub default_distant_light0_color: ColorRGB,
    pub default_distant_light0_direction: Vector3D,
    pub default_distant_light1_color: ColorRGB,
    pub default_distant_light1_direction: Vector3D,
    pub default_reflection_tint: ColorARGB,
    pub default_shadow_vector: Vector3D,
    pub default_shadow_color: ColorRGB,
    pub surfaces: Block<Tri>,
    pub lightmaps: Block<BSPLightmap>,
}

pub struct BSPLightmap {
    pub bitmap: u16,
    pub materials: Block<BSPLightmapMaterial>,
}

pub struct BSPLightmapMaterial {
    pub shader: TagDependency,
    pub shader_permutation: u16,
    pub flags: u16,
    pub surfaces: i32,
    pub surface_count: i32,
    pub centroid: Point3D,
    pub ambient_color: ColorRGB,
    pub distant_light_count: u16,
    pub distant_light0_color: ColorRGB,
    pub distant_light0_direction: Vector3D,
    pub distant_light1_color: ColorRGB,
    pub distant_light1_direction: Vector3D,
    pub reflection_tint: ColorARGB,
    pub shadow_vector: Vector3D,
    pub shadow_color: ColorRGB,
    pub plane: Plane3D,
    pub rendered_vertices_type: RenderedVerticesType,
    pub rendered_vertices: Block<RenderedVertex>,
    pub lightmap_vertices: Block<LightmapVertex>,
    pub uncompressed_vertices_offset: u32,
    pub compressed_vertices_offset: u32,
}

pub struct RenderedVertex {
    position: Vector3D,
    normal: Vector3D,
    binormal: Vector3D,
    tangent: Vector3D,
    u: u32,
    v: u32,
}

pub struct LightmapVertex {
    normal: Vector3D,
    u: u32,
    v: u32,
}

#[derive(Debug, Clone, Copy, TryFromPrimitive)]
#[repr(u16)]
pub enum RenderedVerticesType {
    StructureBSPUncompressedRenderedVertices = 0,
    StructureBSPCompressedRenderedVertices = 1,
    StructureBSPUncompressedLightmapVertices = 2,
    StructureBSPCompressedLightmapVertices = 3,
    ModelUncompressed = 4,
    ModelCompressed = 5,
}

#[derive(Debug, Clone)]
pub struct ScenarioDecal {
    pub decal_type: u16,
    pub yaw: i8,
    pub pitch: i8,
    pub position: Point3D,
}

impl Deserialize for ScenarioDecal {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(ScenarioDecal {
            decal_type: data.read_u16::<LittleEndian>()?,
            yaw: data.read_i8()?,
            pitch: data.read_i8()?,
            position: Point3D::deserialize(data)?,
        })
    }
}


#[derive(Debug, Clone)]
pub struct ScenarioLightFixture {
    pub light_type: u16,
    pub name: u16,
    pub not_placed: u16,
    pub desired_permutation: u16,
    pub position: Point3D,
    pub rotation: Euler3D,
    pub bsp_indices: u16,
    pub power_group: u16,
    pub position_group: u16,
    pub device_flags: u32,
    pub color: ColorRGB,
    pub intensity: f32,
    pub falloff_angle: f32,
    pub cutoff_angle: f32,
}

impl Deserialize for ScenarioLightFixture {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(ScenarioLightFixture {
            light_type: data.read_u16::<LittleEndian>()?,
            name: data.read_u16::<LittleEndian>()?,
            not_placed: data.read_u16::<LittleEndian>()?,
            desired_permutation: data.read_u16::<LittleEndian>()?,
            position: Point3D::deserialize(data)?,
            rotation: Euler3D::deserialize(data)?,
            bsp_indices: data.read_u16::<LittleEndian>()?,
            power_group: data.read_u16::<LittleEndian>()?,
            position_group: data.read_u16::<LittleEndian>()?,
            device_flags: data.read_u32::<LittleEndian>()?,
            color: ColorRGB::deserialize(data)?,
            intensity: data.read_f32::<LittleEndian>()?,
            falloff_angle: data.read_f32::<LittleEndian>()?,
            cutoff_angle: data.read_f32::<LittleEndian>()?,
        })
    }
}