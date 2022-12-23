use std::{io::{Cursor, Seek, SeekFrom}};
use byteorder::{ReadBytesExt, LittleEndian};
use crate::halo::common::*;
use crate::halo::tag::*;

#[derive(Debug, Clone)]
pub struct SkyAnimations {
    pub animation_index: i16,
    pub period: f32,
}

#[derive(Debug, Clone)]
pub struct Sky {
    pub model: TagDependency,
    pub animation_graph: TagDependency,
    pub indoor_ambient_radiosity_color: ColorRGB,
    pub indoor_ambient_radiosity_power: f32,
    pub outdoor_ambient_radiosity_color: ColorRGB,
    pub outdoor_ambient_radiosity_power: f32,
    pub outdoor_fog_color: ColorRGB,
    pub outdoor_fog_max_density: f32,
    pub outdoor_fog_start_distance: f32,
    pub outdoor_fog_opaque_distance: f32,
    pub indoor_fog_color: ColorRGB,
    pub indoor_fog_max_density: f32,
    pub indoor_fog_start_distance: f32,
    pub indoor_fog_opaque_distance: f32,
}

impl Deserialize for Sky {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let start = data.position();
        let model = TagDependency::deserialize(data)?;
        let animation_graph = TagDependency::deserialize(data)?;
        data.seek(SeekFrom::Current(24))?;
        let indoor_ambient_radiosity_color = ColorRGB::deserialize(data)?;
        let indoor_ambient_radiosity_power = data.read_f32::<LittleEndian>()?;
        let outdoor_ambient_radiosity_color = ColorRGB::deserialize(data)?;
        let outdoor_ambient_radiosity_power = data.read_f32::<LittleEndian>()?;
        let outdoor_fog_color = ColorRGB::deserialize(data)?;
        data.seek(SeekFrom::Current(8))?;
        let outdoor_fog_max_density = data.read_f32::<LittleEndian>()?;
        let outdoor_fog_start_distance = data.read_f32::<LittleEndian>()?;
        let outdoor_fog_opaque_distance = data.read_f32::<LittleEndian>()?;
        let indoor_fog_color = ColorRGB::deserialize(data)?;
        data.seek(SeekFrom::Current(8))?;
        let indoor_fog_max_density = data.read_f32::<LittleEndian>()?;
        let indoor_fog_start_distance = data.read_f32::<LittleEndian>()?;
        let indoor_fog_opaque_distance = data.read_f32::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 208))?;
        // TODO handle lens flares + animations
        Ok(Sky {
            model,
            animation_graph,
            indoor_ambient_radiosity_color,
            indoor_ambient_radiosity_power,
            outdoor_ambient_radiosity_color,
            outdoor_ambient_radiosity_power,
            outdoor_fog_color,
            outdoor_fog_max_density,
            outdoor_fog_start_distance,
            outdoor_fog_opaque_distance,
            indoor_fog_color,
            indoor_fog_max_density,
            indoor_fog_start_distance,
            indoor_fog_opaque_distance,
        })
    }
}

#[derive(Debug, Clone)]
pub struct GbxModel {
    pub base_bitmap_u_scale: f32,
    pub base_bitmap_v_scale: f32,
    pub geometries: Block<GbxModelGeometry>,
    pub shaders: Block<GbxModelShader>,
}

#[derive(Debug, Clone)]
pub struct GbxModelGeometry {
    pub parts: Block<GbxModelPart>,
}

impl Deserialize for GbxModelGeometry {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let start = data.position();
        data.seek(SeekFrom::Start(start + 36))?;
        let parts: Block<GbxModelPart> = Block::deserialize(data)?;
        Ok(GbxModelGeometry { parts })
    }
}

#[derive(Debug, Clone)]
pub struct GbxModelPart {
    pub shader_index: u16,
    pub centroid: Point3D,
    pub tri_count: u32,
    pub tri_offset: u32,
    pub vert_count: u32,
    pub vert_offset: u32,
}

impl Deserialize for GbxModelPart {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let start = data.position();
        data.seek(SeekFrom::Start(start + 4))?;
        let shader_index = data.read_u16::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 20))?;
        let centroid = Point3D::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 72))?;
        let tri_count = data.read_u32::<LittleEndian>()? + 2; // it's always off by 2????
        let tri_offset = data.read_u32::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 88))?;
        let vert_count = data.read_u32::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 100))?;
        dbg!(data.position());
        let vert_offset = data.read_u32::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 132))?;
        Ok(GbxModelPart {
            shader_index,
            centroid,
            tri_count,
            tri_offset,
            vert_count,
            vert_offset,
        })
    }
}

impl Deserialize for GbxModel {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        data.seek(SeekFrom::Current(4))?; // Bool32('flags',
        data.seek(SeekFrom::Current(4))?; // SInt32('node_list_checksum'),
        data.seek(SeekFrom::Current(4))?; // Float('superhigh_lod_cutoff', SIDETIP="pixels"),
        data.seek(SeekFrom::Current(4))?; // Float('high_lod_cutoff', SIDETIP="pixels"),
        data.seek(SeekFrom::Current(4))?; // Float('medium_lod_cutoff', SIDETIP="pixels"),
        data.seek(SeekFrom::Current(4))?; // Float('low_lod_cutoff', SIDETIP="pixels"),
        data.seek(SeekFrom::Current(4))?; // Float('superlow_lod_cutoff', SIDETIP="pixels"),
        data.seek(SeekFrom::Current(2))?; // SInt16('superlow_lod_nodes', SIDETIP="nodes"),
        data.seek(SeekFrom::Current(2))?; // SInt16('low_lod_nodes', SIDETIP="nodes"),
        data.seek(SeekFrom::Current(2))?; // SInt16('medium_lod_nodes', SIDETIP="nodes"),
        data.seek(SeekFrom::Current(2))?; // SInt16('high_lod_nodes', SIDETIP="nodes"),
        data.seek(SeekFrom::Current(2))?; // SInt16('superhigh_lod_nodes', SIDETIP="nodes"),
        data.seek(SeekFrom::Current(10))?; // Pad(10),
        let base_bitmap_u_scale = data.read_f32::<LittleEndian>()?; // Float('base_map_u_scale'),
        let base_bitmap_v_scale = data.read_f32::<LittleEndian>()?; // Float('base_map_v_scale'),
        data.seek(SeekFrom::Current(116))?; // Pad(116),
        data.seek(SeekFrom::Current(12))?; // reflexive("markers", marker, 256, DYN_NAME_PATH=".name"),
        data.seek(SeekFrom::Current(12))?;// reflexive("nodes", node, 64, DYN_NAME_PATH=".name"),
        data.seek(SeekFrom::Current(12))?;// reflexive("regions", region, 32, DYN_NAME_PATH=".name"),
        let geometries: Block<GbxModelGeometry> = Block::deserialize(data)?;
        let shaders: Block<GbxModelShader> = Block::deserialize(data)?;
        data.seek(SeekFrom::Start(232))?;// reflexive("regions", region, 32, DYN_NAME_PATH=".name"),
        Ok(GbxModel {
            base_bitmap_u_scale,
            base_bitmap_v_scale,
            geometries,
            shaders,
        })
    }
}

#[derive(Debug, Clone)]
pub struct GbxModelShader {
    pub shader: TagDependency,
    pub permutation: u16,
}

impl Deserialize for GbxModelShader {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let shader = TagDependency::deserialize(data)?;
        let permutation = data.read_u16::<LittleEndian>()?;
        data.seek(SeekFrom::Current(14))?;
        Ok(GbxModelShader {
            shader,
            permutation,
        })
    }
}

#[derive(Debug, Clone)]
pub struct Scenery {
    pub flags: u16,
    pub bounding_radius: f32,
    pub bounding_offset: Point3D,
    pub origin_offset: Point3D,
    pub model: TagDependency,
    pub modifier_shader: TagDependency,
}

impl Deserialize for Scenery {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let start = data.position();
        data.seek(SeekFrom::Start(start + 2))?;
        let flags = data.read_u16::<LittleEndian>()?;
        let bounding_radius = data.read_f32::<LittleEndian>()?;
        let bounding_offset = Point3D::deserialize(data)?;
        let origin_offset = Point3D::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 40))?;
        let model = TagDependency::deserialize(data)?;
        assert_eq!(model.tag_class, TagClass::GbxModel);
        data.seek(SeekFrom::Start(start + 144))?;
        let modifier_shader = TagDependency::deserialize(data)?;
        assert_eq!(modifier_shader.tag_class, TagClass::Shader);
        Ok(Scenery {
            flags,
            bounding_radius,
            bounding_offset,
            origin_offset,
            model,
            modifier_shader,
        })
    }
}