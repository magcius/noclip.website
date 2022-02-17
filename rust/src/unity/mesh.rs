#![allow(dead_code, unused_variables)]

use wasm_bindgen::prelude::wasm_bindgen;
use crate::unity::asset::*;
use crate::unity::reader::*;
use crate::unity::version::UnityVersion;
use crate::unity::bitstream::BitStream;

// empty type for when we just wanna move the read stream along
pub struct NoOp {}
impl Deserialize for NoOp {
    fn deserialize(_: &mut AssetReader, _: &Asset) -> Result<Self> {
        todo!();
    }
}

#[derive(Debug)]
pub struct ChannelInfo {
    stream: u8,
    offset: u8,
    format: u8,
    dimension: u8,
}

impl Deserialize for ChannelInfo {
    fn deserialize(reader: &mut AssetReader, asset: &Asset) -> Result<Self> {
        Ok(ChannelInfo {
            stream: reader.read_u8()?,
            offset: reader.read_u8()?,
            format: reader.read_u8()?,
            dimension: reader.read_u8()?,
        })
    }
}

#[derive(Debug)]
pub struct PackedIntVector {
    num_items: u32,
    data: Vec<u8>,
    bit_size: u8,
}

impl PackedIntVector {
    pub fn unpack(&self) -> Vec<i32> {
        let stream = BitStream::new(&self.data, self.num_items as usize, self.bit_size as usize);
        stream.unpack_i32()
    }
}

impl Deserialize for PackedIntVector {
    fn deserialize(reader: &mut AssetReader, asset: &Asset) -> Result<Self> {
        let num_items = reader.read_u32()?;
        let data = reader.read_byte_array()?;
        reader.align()?;
        let bit_size = reader.read_u8()?;
        reader.align()?;
        Ok(PackedIntVector {
            num_items,
            data,
            bit_size,
        })
    }
}

#[derive(Debug)]
pub struct PackedFloatVector {
    num_items: u32,
    range: f32,
    start: f32,
    data: Vec<u8>,
    bit_size: u8,
}

impl PackedFloatVector {
    pub fn unpack(&self) -> Vec<f32> {
        let stream = BitStream::new(&self.data, self.num_items as usize, self.bit_size as usize);
        stream.unpack_f32(self.start, self.range)
    }

    pub fn octohedral_unpack(&self, signs: &PackedIntVector) -> Vec<f32> {
        let stream = BitStream::new(&self.data, self.num_items as usize, self.bit_size as usize);
        let sign_stream = BitStream::new(&signs.data, signs.num_items as usize, signs.bit_size as usize);
        stream.octohedral_unpack(self.start, self.range, &sign_stream)
    }
}

impl Deserialize for PackedFloatVector {
    fn deserialize(reader: &mut AssetReader, asset: &Asset) -> Result<Self> {
        let num_items = reader.read_u32()?;
        let range = reader.read_f32()?;
        let start = reader.read_f32()?;
        let data = reader.read_byte_array()?;
        reader.align()?;
        let bit_size = reader.read_u8()?;
        reader.align()?;
        Ok(PackedFloatVector {
            num_items,
            range,
            start,
            data,
            bit_size,
        })
    }
}

#[derive(Debug)]
pub struct CompressedMesh {
    vertices: PackedFloatVector,
    uv: PackedFloatVector,
    normals: PackedFloatVector,
    tangents: PackedFloatVector,
    weights: PackedIntVector,
    normal_signs: PackedIntVector,
    tangent_signs: PackedIntVector,
    float_colors: PackedFloatVector,
    bone_indices: PackedIntVector,
    triangles: PackedIntVector,
    uv_info: u32,
}

impl Deserialize for CompressedMesh {
    fn deserialize(reader: &mut AssetReader, asset: &Asset) -> Result<Self> {
        Ok(CompressedMesh {
            vertices: PackedFloatVector::deserialize(reader, asset)?,
            uv: PackedFloatVector::deserialize(reader, asset)?,
            normals: PackedFloatVector::deserialize(reader, asset)?,
            tangents: PackedFloatVector::deserialize(reader, asset)?,
            weights: PackedIntVector::deserialize(reader, asset)?,
            normal_signs: PackedIntVector::deserialize(reader, asset)?,
            tangent_signs: PackedIntVector::deserialize(reader, asset)?,
            float_colors: PackedFloatVector::deserialize(reader, asset)?,
            bone_indices: PackedIntVector::deserialize(reader, asset)?,
            triangles: PackedIntVector::deserialize(reader, asset)?,
            uv_info: reader.read_u32()?,
        })
    }
}

#[derive(Debug)]
pub struct StreamingInfo {
    size: u32,
    offset: u32,
    path: String,
}

impl Deserialize for StreamingInfo {
    fn deserialize(reader: &mut AssetReader, asset: &Asset) -> Result<Self> {
        Ok(StreamingInfo {
            size: reader.read_u32()?,
            offset: reader.read_u32()?,
            path: reader.read_char_array()?,
        })
    }
}

#[derive(Debug)]
pub struct VertexData {
    vertex_count: u32,
    channels: Vec<ChannelInfo>,
    data: Vec<u8>,
}

impl Deserialize for VertexData {
    fn deserialize(reader: &mut AssetReader, asset: &Asset) -> Result<Self> {
        let vertex_count = reader.read_u32()?;
        let channels = ChannelInfo::deserialize_array(reader, asset)?;
        reader.align()?;
        let data = reader.read_byte_array()?;
        reader.align()?;
        Ok(VertexData {
            vertex_count,
            channels,
            data,
        })
    }
}

#[derive(Debug)]
pub struct Shape {
}

impl Deserialize for Shape {
    fn deserialize(reader: &mut AssetReader, asset: &Asset) -> Result<Self> {
        // TODO actually get shapes
        let _vertices = NoOp::deserialize_array(reader, asset)?;
        let _shapes = NoOp::deserialize_array(reader, asset)?;
        let _channels = NoOp::deserialize_array(reader, asset)?;
        let _full_weights = NoOp::deserialize_array(reader, asset)?;
        Ok(Shape {})
    }
}

#[derive(Debug)]
pub struct Vec3f {
    x: f32,
    y: f32,
    z: f32,
}

impl Deserialize for Vec3f {
    fn deserialize(reader: &mut AssetReader, asset: &Asset) -> Result<Self> {
        Ok(Vec3f {
            x: reader.read_f32()?,
            y: reader.read_f32()?,
            z: reader.read_f32()?,
        })
    }
}

#[derive(Debug)]
pub struct AABB {
    center: Vec3f,
    extent: Vec3f,
}

impl Deserialize for AABB {
    fn deserialize(reader: &mut AssetReader, asset: &Asset) -> Result<Self> {
        Ok(AABB {
            center: Vec3f::deserialize(reader, asset)?,
            extent: Vec3f::deserialize(reader, asset)?,
        })
    }
}

#[derive(Debug)]
pub struct SubMesh {
    first_byte: u32,
    index_count: u32,
    topology: u32,
    base_vertex: u32,
    first_vertex: u32,
    vertex_count: u32,
    local_aabb: AABB,
}

impl Deserialize for SubMesh {
    fn deserialize(reader: &mut AssetReader, asset: &Asset) -> Result<Self> {
        Ok(SubMesh {
            first_byte: reader.read_u32()?,
            index_count: reader.read_u32()?,
            topology: reader.read_u32()?,
            base_vertex: reader.read_u32()?,
            first_vertex: reader.read_u32()?,
            vertex_count: reader.read_u32()?,
            local_aabb: AABB::deserialize(reader, asset)?,
        })
    }
}

#[derive(Debug, PartialEq)]
pub enum MeshCompression {
    Off,
    Low,
    Med,
    High,
}

impl Deserialize for MeshCompression {
    fn deserialize(reader: &mut AssetReader, asset: &Asset) -> Result<Self> {
        Ok(match reader.read_u8()? {
            0 => MeshCompression::Off,
            1 => MeshCompression::Low,
            2 => MeshCompression::Med,
            3 => MeshCompression::High,
            x => {
                let reason = format!("Invalid mesh compression level {}", x);
                return Err(AssetReaderError::DeserializationError(reason));
            },
        })
    }
}

#[derive(Debug)]
#[wasm_bindgen]
pub struct Mesh {
    name: String,
    submeshes: Vec<SubMesh>,
    mesh_compression: MeshCompression,
    is_readable: bool,
    keep_vertices: bool,
    keep_indices: bool,
    index_format: i32,
    raw_index_buffer: Vec<u8>,
    vertex_data: VertexData,
    compressed_mesh: CompressedMesh,
    local_aabb: AABB,
    mesh_usage_flags: i32,
    hash_metrics: [f32; 2],
    baked_convex_collision_mesh: Vec<u8>,
    baked_triangle_collision_mesh: Vec<u8>,
    streaming_info: StreamingInfo,
}

#[wasm_bindgen]
impl Mesh {
    pub fn from_bytes(data: Vec<u8>, asset: &Asset) -> std::result::Result<Mesh, String> {
        let mut reader = AssetReader::new(data);
        reader.set_endianness(asset.header.endianness);
        Mesh::deserialize(&mut reader, asset).map_err(|err| format!("{:?}", err))
    }

    pub fn get_name(&self) -> String {
        self.name.clone()
    }

    pub fn get_vertices(&self) -> Vec<f32> {
        if self.mesh_compression == MeshCompression::Off {
            panic!("non-compressed meshes not yet implemented");
        }
        self.compressed_mesh.vertices.unpack()
    }

    pub fn get_normals(&self) -> Vec<f32> {
        if self.mesh_compression == MeshCompression::Off {
            panic!("non-compressed meshes not yet implemented");
        }
        self.compressed_mesh.normals.octohedral_unpack(&self.compressed_mesh.normal_signs)
    }

    pub fn get_indices(&self) -> Vec<i32> {
        if self.mesh_compression == MeshCompression::Off {
            panic!("non-compressed meshes not yet implemented");
        }
        self.compressed_mesh.triangles.unpack()
    }
}

impl Deserialize for Mesh {
    fn deserialize(reader: &mut AssetReader, asset: &Asset) -> Result<Self> {
        let name = reader.read_char_array()?;
        let unity2019 = UnityVersion { major: 2019, ..Default::default() };
        // TODO support older versions
        if asset.metadata.unity_version < unity2019 {
            return Err(AssetReaderError::UnsupportedUnityVersion(asset.metadata.unity_version));
        }

        let submeshes = SubMesh::deserialize_array(reader, asset)?;
        let _shapes = Shape::deserialize(reader, asset)?;
        let _bind_pose = NoOp::deserialize_array(reader, asset)?;
        let _bone_name_hashes = NoOp::deserialize_array(reader, asset)?;
        let _root_bone_name_hash = reader.read_u32()?;
        let _bones_aabb = NoOp::deserialize_array(reader, asset)?;
        let _variable_bone_count_weights = NoOp::deserialize_array(reader, asset)?;
        let mesh_compression = MeshCompression::deserialize(reader, asset)?;
        let is_readable = reader.read_bool()?;
        let keep_vertices = reader.read_bool()?;
        let keep_indices = reader.read_bool()?;
        reader.align()?;
        let index_format = reader.read_i32()?;
        let raw_index_buffer = reader.read_byte_array()?;
        reader.align()?;
        let vertex_data = VertexData::deserialize(reader, asset)?;
        reader.align()?;
        let compressed_mesh = CompressedMesh::deserialize(reader, asset)?;
        let local_aabb = AABB::deserialize(reader, asset)?;
        let mesh_usage_flags = reader.read_i32()?;
        let baked_convex_collision_mesh = reader.read_byte_array()?;
        reader.align()?;
        let baked_triangle_collision_mesh = reader.read_byte_array()?;
        reader.align()?;
        let hash_metrics = [reader.read_f32()?, reader.read_f32()?];

        // TODO: read in vertex data from StreamingInfo file
        let streaming_info = StreamingInfo::deserialize(reader, asset)?;
        if !streaming_info.path.is_empty() {
            let reason = "Meshes with streaming data not currently supported";
            return Err(AssetReaderError::UnsupportedFeature(reason.into()))
        }

        Ok(Mesh {
            name,
            submeshes,
            mesh_compression,
            is_readable,
            keep_vertices,
            keep_indices,
            index_format,
            raw_index_buffer,
            vertex_data,
            compressed_mesh,
            local_aabb,
            mesh_usage_flags,
            hash_metrics,
            baked_convex_collision_mesh,
            baked_triangle_collision_mesh,
            streaming_info,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_test_asset(path: &str) -> AssetReader {
        let data = std::fs::read(path).unwrap();
        AssetReader::new(data)
    }

    #[test]
    fn test_read_uncompressed_mesh() {
        let mut reader = read_test_asset("test_data/unity_assets/v22/sharedassets0.assets");
        let asset = reader.read_asset().unwrap();
        reader.seek_to_object(&asset.objects[3]).unwrap();
        assert!(Mesh::deserialize(&mut reader, &asset).is_err());
    }

    #[test]
    fn test_read_compressed_mesh() {
        let mut reader = read_test_asset("test_data/unity_assets/v22/compressed_mesh.assets");
        let asset = reader.read_asset().unwrap();
        reader.seek_to_object(&asset.objects[3]).unwrap();
        let mesh = Mesh::deserialize(&mut reader, &asset).unwrap();
        assert_eq!(mesh.compressed_mesh.vertices.num_items, 14577);
        assert_eq!(mesh.compressed_mesh.vertices.data.len(), 2 * 14577);
    }
}