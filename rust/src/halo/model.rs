use std::{io::{Cursor, Seek, SeekFrom, Read}, convert::TryFrom};
use byteorder::{ReadBytesExt, LittleEndian};
use num_enum::{IntoPrimitive, TryFromPrimitive, TryFromPrimitiveError};

use crate::halo::common::*;
use crate::halo::util::*;
use crate::halo::tag::*;

struct GbxModel {
    base_bitmap_u_scale: f32,
    base_bitmap_v_scale: f32,
    geometries: Block<GbxModelGeometry>,
    shaders: Block<GbxModelShader>,
}

struct GbxModelGeometry {
    parts: Block<GbxModelPart>,
}

impl Deserialize for GbxModelGeometry {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let start = data.position();
        data.seek(SeekFrom::Start(start + 36))?;
        let parts: Block<GbxModelPart> = Block::deserialize(data)?;
        Ok(GbxModelGeometry { parts })
    }
}

struct GbxModelPart {
    shader_index: u16,
    centroid: Point3D,
    tri_count: u32,
    tri_offset: u32,
    vert_count: u32,
    vert_offset: u32,
}

impl Deserialize for GbxModelPart {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let start = data.position();
        data.seek(SeekFrom::Start(start + 4))?;
        let shader_index = data.read_u16::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 62))?;
        let centroid = Point3D::deserialize(data)?;
        let vert_count = data.read_u32::<LittleEndian>()?;
        let vert_offset = data.read_u32::<LittleEndian>()?;
        data.seek(SeekFrom::Current(8))?;
        let tri_count = data.read_u32::<LittleEndian>()?;
        let tri_offset = data.read_u32::<LittleEndian>()?;
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
        let start = data.position();
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

struct GbxModelShader {
    shader: TagDependency,
    permutation: u16,
}

impl Deserialize for GbxModelShader {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(GbxModelShader {
            shader: TagDependency::deserialize(data)?,
            permutation: data.read_u16::<LittleEndian>()?,
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