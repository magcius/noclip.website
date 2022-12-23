use std::{io::{Cursor, Seek, SeekFrom}, convert::TryFrom};
use byteorder::{ReadBytesExt, LittleEndian};
use num_enum::{IntoPrimitive, TryFromPrimitive};

use crate::halo::common::*;
use crate::halo::util::*;
use crate::halo::tag::*;

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
    pub not_placed: u32,
    pub position: Point3D,
    pub rotation: Euler3D,
}

impl Deserialize for ScenarioScenery {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let start = data.position();
        let scenery_type = data.read_u16::<LittleEndian>()?;
        let name_index = data.read_u16::<LittleEndian>()?;
        let not_placed = data.read_u32::<LittleEndian>()?;
        let position = Point3D::deserialize(data)?;
        let rotation = Euler3D::deserialize(data)?;
        let _appearance_player_index = data.read_u16::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 72))?;
        Ok(ScenarioScenery {
            scenery_type,
            name_index,
            not_placed,
            position,
            rotation,
        })
    }
}

#[derive(Debug, Clone)]
pub struct ObjectSwatch {
    pub obj: TagDependency,
}

impl Deserialize for ObjectSwatch {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let obj = TagDependency::deserialize(data)?;
        data.seek(SeekFrom::Current(32))?;
        Ok(ObjectSwatch { obj })
    }
}

#[derive(Debug, Clone)]
pub struct Scenario {
    pub skies: Block<TagDependency>,
    pub scenery: Block<ScenarioScenery>,
    pub scenery_palette: Block<ObjectSwatch>,
    pub light_fixtures: Block<ScenarioLightFixture>,
    pub light_fixture_palette: Block<ObjectSwatch>,
    pub decals: Block<ScenarioDecal>,
    pub decal_palette: Block<ObjectSwatch>,
    pub detail_object_collection_palette: Block<ObjectSwatch>,
    pub structure_bsp_references: Block<ScenarioStructureBSPReference>,
}

impl Deserialize for Scenario {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let start = data.position();
        data.seek(SeekFrom::Start(start + 48))?;
        let skies: Block<TagDependency> = Block::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 528))?;
        let scenery: Block<ScenarioScenery> = Block::deserialize(data)?;
        let scenery_palette: Block<ObjectSwatch> = Block::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 708))?;
        let light_fixtures: Block<ScenarioLightFixture> = Block::deserialize(data)?;
        let light_fixture_palette: Block<ObjectSwatch> = Block::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 936))?;
        let decals: Block<ScenarioDecal> = Block::deserialize(data)?;
        let decal_palette: Block<ObjectSwatch> = Block::deserialize(data)?;
        let detail_object_collection_palette: Block<ObjectSwatch> = Block::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 1444))?; // skip to BSPs
        let structure_bsps: Block<ScenarioStructureBSPReference> = Block::deserialize(data)?;
        Ok(Scenario {
            skies,
            scenery,
            scenery_palette,
            light_fixtures,
            light_fixture_palette,
            decals,
            decal_palette,
            detail_object_collection_palette,
            structure_bsp_references: structure_bsps,
        })
    }
}

#[derive(Debug, Clone)]
pub struct ScenarioStructureBSPReference {
    pub start: u32,
    pub size: u32,
    pub address: u32,
    pub structure_bsp: TagDependency,
}

impl Deserialize for ScenarioStructureBSPReference {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let start = data.read_u32::<LittleEndian>()?;
        let size = data.read_u32::<LittleEndian>()?;
        let address = data.read_u32::<LittleEndian>()?;
        data.seek(SeekFrom::Current(4))?;
        let structure_bsp = TagDependency::deserialize(data)?;
        Ok(ScenarioStructureBSPReference {
            start, size, address, structure_bsp,
        })
    }
}

#[derive(Debug, Clone)]
pub struct BSPHeader {
    pub bsp_offset: u32,
    pub rendered_vertices_offset: u32,
    pub lightmap_vertices_offset: u32,
}

impl Deserialize for BSPHeader {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let bsp_offset = data.read_u32::<LittleEndian>()?;
        data.seek(SeekFrom::Current(4))?;
        let rendered_vertices_offset = data.read_u32::<LittleEndian>()?;
        data.seek(SeekFrom::Current(4))?;
        let lightmap_vertices_offset = data.read_u32::<LittleEndian>()?;
        assert_eq!(data.read_u32::<LittleEndian>()?, TagClass::ScenarioStructureBsp.into());
        Ok(BSPHeader {
            bsp_offset,
            rendered_vertices_offset,
            lightmap_vertices_offset,
        })
    }
}

#[derive(Debug, Clone)]
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

    pub header: Option<BSPHeader>,
}

impl Deserialize for BSP {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let start = data.position();
        let lightmaps_bitmap = TagDependency::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 44))?;
        let default_ambient_color = ColorRGB::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 60))?;
        let default_distant_light0_color = ColorRGB::deserialize(data)?;
        let default_distant_light0_direction = Vector3D::deserialize(data)?;
        let default_distant_light1_color = ColorRGB::deserialize(data)?;
        let default_distant_light1_direction = Vector3D::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 120))?;
        let default_reflection_tint = ColorARGB::deserialize(data)?;
        let default_shadow_vector = Vector3D::deserialize(data)?;
        let default_shadow_color = ColorRGB::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 236))?;
        data.seek(SeekFrom::Start(start + 248))?;
        let surfaces: Block<Tri> = Block::deserialize(data)?;
        let lightmaps: Block<BSPLightmap> = Block::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 636))?;
        Ok(BSP {
            lightmaps_bitmap,
            default_ambient_color,
            default_distant_light0_color,
            default_distant_light0_direction,
            default_distant_light1_color,
            default_distant_light1_direction,
            default_reflection_tint,
            default_shadow_vector,
            default_shadow_color,
            surfaces,
            lightmaps,
            header: None,
        })
    }
}

#[derive(Debug, Clone)]
pub struct BSPLightmap {
    pub bitmap: u16,
    pub materials: Block<BSPMaterial>,
}

impl Deserialize for BSPLightmap {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let bitmap = data.read_u16::<LittleEndian>()?;
        data.seek(SeekFrom::Current(18))?;
        let materials = Block::deserialize(data)?;
        Ok(BSPLightmap {
            bitmap,
            materials,
        })
    }
}

#[derive(Debug, Clone)]
pub struct BSPMaterial {
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
    pub uncompressed_vertices: TagDataOffset,
    pub compressed_vertices: TagDataOffset,
}

impl Deserialize for BSPMaterial {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let start = data.position();
        let shader = TagDependency::deserialize(data).unwrap();
        let shader_permutation = data.read_u16::<LittleEndian>()?;
        let flags = data.read_u16::<LittleEndian>()?;
        let surfaces = data.read_i32::<LittleEndian>()?;
        let surface_count = data.read_i32::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 28))?;
        let centroid = Point3D::deserialize(data)?;
        let ambient_color = ColorRGB::deserialize(data)?;
        let distant_light_count = data.read_u16::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 56))?;
        let distant_light0_color = ColorRGB::deserialize(data)?;
        let distant_light0_direction = Vector3D::deserialize(data)?;
        let distant_light1_color = ColorRGB::deserialize(data)?;
        let distant_light1_direction = Vector3D::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 116))?;
        let reflection_tint = ColorARGB::deserialize(data)?;
        let shadow_vector = Vector3D::deserialize(data)?;
        let shadow_color = ColorRGB::deserialize(data)?;
        let plane = Plane3D::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 176))?;
        let rendered_vertices_type = RenderedVerticesType::try_from(data.read_u16::<LittleEndian>()?)?;
        data.seek(SeekFrom::Start(start + 180))?;
        let rendered_vertices: Block<RenderedVertex> = Block::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 200))?;
        let lightmap_vertices: Block<LightmapVertex> = Block::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 216))?;
        let uncompressed_vertices = TagDataOffset::deserialize(data)?;
        assert_ne!(uncompressed_vertices.file_offset, 0);
        assert_eq!(rendered_vertices_type, RenderedVerticesType::StructureBSPUncompressedRenderedVertices);
        data.seek(SeekFrom::Start(start + 236))?;
        let compressed_vertices = TagDataOffset::deserialize(data)?;
        Ok(BSPMaterial {
            shader,
            shader_permutation,
            flags,
            surfaces,
            surface_count,
            centroid,
            ambient_color,
            distant_light_count,
            distant_light0_color,
            distant_light0_direction,
            distant_light1_color,
            distant_light1_direction,
            reflection_tint,
            shadow_vector,
            shadow_color,
            plane,
            rendered_vertices_type,
            rendered_vertices,
            lightmap_vertices,
            uncompressed_vertices,
            compressed_vertices,
        })
    }
}

#[derive(Debug, Clone)]
pub struct RenderedVertex {
    pub position: Vector3D,
    pub normal: Vector3D,
    pub binormal: Vector3D,
    pub tangent: Vector3D,
    pub u: f32,
    pub v: f32,
}

impl Deserialize for RenderedVertex {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(RenderedVertex {
            position: Vector3D::deserialize(data)?,
            normal: Vector3D::deserialize(data)?,
            binormal: Vector3D::deserialize(data)?,
            tangent: Vector3D::deserialize(data)?,
            u: data.read_f32::<LittleEndian>()?,
            v: data.read_f32::<LittleEndian>()?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct LightmapVertex {
    pub normal: Vector3D,
    pub u: f32,
    pub v: f32,
}

impl Deserialize for LightmapVertex {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(LightmapVertex {
            normal: Vector3D::deserialize(data)?,
            u: data.read_f32::<LittleEndian>()?,
            v: data.read_f32::<LittleEndian>()?,
        })
    }
}

#[derive(Debug, Clone, Copy, TryFromPrimitive, PartialEq)]
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