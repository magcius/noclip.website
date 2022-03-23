#![allow(dead_code, unused_variables)]

use wasm_bindgen::prelude::wasm_bindgen;
use crate::unity::asset::*;
use crate::unity::reader::*;
use crate::unity::version::UnityVersion;
use crate::unity::bitstream::BitStream;

// empty type for when we just wanna move the read stream along
pub struct NoOp {}
impl Deserialize for NoOp {
    fn deserialize(_: &mut AssetReader, _: &AssetInfo) -> Result<Self> {
        todo!();
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct ChannelInfo {
    pub stream: u8,
    pub offset: u8,
    pub format: VertexFormat,
    pub dimension: u8,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy)]
pub enum VertexFormat {
    Float,
    Float16,
    UNorm8,
    SNorm8,
    UNorm16,
    SNorm16,
    UInt8,
    SInt8,
    UInt16,
    SInt16,
    UInt32,
    SInt32,
}

#[wasm_bindgen]
impl ChannelInfo {
    pub fn get_format(value: u8) -> VertexFormat {
        match value {
            0 => VertexFormat::Float,
            1 => VertexFormat::Float16,
            2 => VertexFormat::UNorm8,
            3 => VertexFormat::SNorm8,
            4 => VertexFormat::UNorm16,
            5 => VertexFormat::SNorm16,
            6 => VertexFormat::UInt8,
            7 => VertexFormat::SInt8,
            8 => VertexFormat::UInt16,
            9 => VertexFormat::SInt16,
            10 => VertexFormat::UInt32,
            11 => VertexFormat::SInt32,
            _ => panic!("unrecognized format {}", value)
        }
    }

    pub fn get_format_size(&self) -> usize {
        match self.format {
            VertexFormat::Float |
            VertexFormat::UInt32 |
            VertexFormat::SInt32 => 4,

            VertexFormat::Float16 |
            VertexFormat::UNorm16 |
            VertexFormat::SNorm16 |
            VertexFormat::UInt16 |
            VertexFormat::SInt16 => 2,

            VertexFormat::UNorm8 |
            VertexFormat::SNorm8 |
            VertexFormat::UInt8 |
            VertexFormat::SInt8 => 1,
        }
    }
}

impl Deserialize for ChannelInfo {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        Ok(ChannelInfo {
            stream: reader.read_u8()?,
            offset: reader.read_u8()?,
            format: ChannelInfo::get_format(reader.read_u8()?),
            dimension: reader.read_u8()? & 0x0F,
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
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
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
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
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
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
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

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct StreamingInfo {
    pub size: u32,
    pub offset: u32,
    path: String,
}

#[wasm_bindgen]
impl StreamingInfo {
    pub fn get_path(&self) -> String {
        return self.path.clone();
    }
}

impl Deserialize for StreamingInfo {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        Ok(StreamingInfo {
            size: reader.read_u32()?,
            offset: reader.read_u32()?,
            path: reader.read_char_array()?,
        })
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct VertexStreamInfo {
    channel_mask: u32,
    pub offset: u32,
    pub stride: u32,
    divider_op: u8,
    frequency: u32,
}

impl VertexStreamInfo {
    pub fn from_channels(channels: &Vec<ChannelInfo>, vertex_count: usize) -> Vec<VertexStreamInfo> {
        let mut n_streams = 0;
        for c in channels {
            if c.stream > n_streams {
                n_streams = c.stream;
            }
        }
        n_streams += 1;
        let mut result = Vec::with_capacity(n_streams as usize);
        let mut offset = 0;
        for s in 0..n_streams {
            let mut channel_mask = 0;
            let mut stride = 0;
            for chn in 0..channels.len() {
                let channel = &channels[chn];
                if channel.stream == s {
                    if channel.dimension > 0 {
                        channel_mask |= 1 << chn;
                        stride += channel.dimension as usize * channel.get_format_size();
                    }
                }
            }

            result.push(VertexStreamInfo {
                channel_mask,
                offset,
                stride: stride as u32,
                divider_op: 0,
                frequency: 0,
            });
            offset += (vertex_count * stride) as u32;
            offset = (offset + 15) & 15;
        }
        return result;
    }
}

#[derive(Debug)]
pub struct VertexData {
    vertex_count: u32,
    channels: Vec<ChannelInfo>,
    streams: Vec<VertexStreamInfo>,
    data: Vec<u8>,
}

impl Deserialize for VertexData {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        let vertex_count = reader.read_u32()?;
        let channels = ChannelInfo::deserialize_array(reader, asset)?;
        reader.align()?;
        let data = reader.read_byte_array()?;
        reader.align()?;
        let streams = VertexStreamInfo::from_channels(&channels, vertex_count as usize);
        Ok(VertexData {
            vertex_count,
            streams,
            channels,
            data,
        })
    }
}

#[derive(Debug)]
pub struct Shape {
}

impl Deserialize for Shape {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        // TODO actually get shapes
        let _vertices = NoOp::deserialize_array(reader, asset)?;
        let _shapes = NoOp::deserialize_array(reader, asset)?;
        let _channels = NoOp::deserialize_array(reader, asset)?;
        let _full_weights = NoOp::deserialize_array(reader, asset)?;
        Ok(Shape {})
    }
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone)]
pub struct Vec3f {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Deserialize for Vec3f {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        Ok(Vec3f {
            x: reader.read_f32()?,
            y: reader.read_f32()?,
            z: reader.read_f32()?,
        })
    }
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone)]
pub struct AABB {
    pub center: Vec3f,
    pub extent: Vec3f,
}

impl Deserialize for AABB {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
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
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
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
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
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

#[derive(Debug, Copy, Clone)]
#[wasm_bindgen]
pub enum IndexFormat {
    UInt16,
    UInt32,
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
    pub index_format: IndexFormat,
    raw_index_buffer: Vec<u8>,
    vertex_data: VertexData,
    compressed_mesh: CompressedMesh,
    pub local_aabb: AABB,
    mesh_usage_flags: i32,
    hash_metrics: [f32; 2],
    baked_convex_collision_mesh: Vec<u8>,
    baked_triangle_collision_mesh: Vec<u8>,
    streaming_info: StreamingInfo,
}

#[wasm_bindgen]
impl Mesh {
    pub fn from_bytes(data: Vec<u8>, asset: &AssetInfo) -> std::result::Result<Mesh, String> {
        let mut reader = AssetReader::new(data);
        reader.set_endianness(asset.header.endianness);
        Mesh::deserialize(&mut reader, asset).map_err(|err| format!("{:?}", err))
    }

    pub fn get_name(&self) -> String {
        self.name.clone()
    }

    pub fn is_compressed(&self) -> bool {
        return self.mesh_compression != MeshCompression::Off
    }

    pub fn unpack_vertices(&self) -> Option<Vec<f32>> {
        if self.mesh_compression == MeshCompression::Off {
            None
        } else {
            Some(self.compressed_mesh.vertices.unpack())
        }
    }

    pub fn unpack_normals(&self) -> Option<Vec<f32>> {
        if self.mesh_compression == MeshCompression::Off {
            None
        } else {
            let signs = &self.compressed_mesh.normal_signs;
            Some(self.compressed_mesh.normals.octohedral_unpack(signs))
        }
    }

    pub fn unpack_indices(&self) -> Option<Vec<i32>> {
        if self.mesh_compression == MeshCompression::Off {
            None
        } else {
            Some(self.compressed_mesh.triangles.unpack())
        }
    }

    pub fn get_streaming_info(&self) -> Option<StreamingInfo> {
        if self.streaming_info.path.is_empty() {
            None
        } else {
            Some(self.streaming_info.clone())
        }
    }

    pub fn set_vertex_data(&mut self, data: Vec<u8>) {
        self.vertex_data.data = data;
    }

    pub fn get_vertex_count(&self) -> usize {
        self.vertex_data.vertex_count as usize
    }

    pub fn get_vertex_data(&self) -> Vec<u8> {
        self.vertex_data.data.clone()
    }

    pub fn get_index_data(&self) -> Vec<u8> {
        self.raw_index_buffer.clone()
    }

    pub fn get_channel_info(&self, i: usize) -> Option<ChannelInfo> {
        match self.vertex_data.channels.get(i) {
            Some(c) => Some(c.clone()),
            None => None,
        }
    }

    pub fn get_vertex_stream_info(&self, i: usize) -> Option<VertexStreamInfo> {
        match self.vertex_data.streams.get(i) {
            Some(s) => Some(s.clone()),
            None => None,
        }
    }
}

impl Deserialize for Mesh {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
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
        let index_format = if reader.read_i32()? == 0 { IndexFormat::UInt16 } else { IndexFormat::UInt32 };
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
        let streaming_info = StreamingInfo::deserialize(reader, asset)?;
        //web_sys::console::log_1(&format!("{:?}", &vertex_data.channels).into());
        //web_sys::console::log_1(&format!("{:?}", &vertex_data.streams).into());

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
        let asset = reader.read_asset_info().unwrap();
        reader.seek_to_object(&asset.objects[3]).unwrap();
        assert!(Mesh::deserialize(&mut reader, &asset).is_err());
    }

    #[test]
    fn test_read_compressed_mesh() {
        let mut reader = read_test_asset("test_data/unity_assets/v22/compressed_mesh.assets");
        let asset = reader.read_asset_info().unwrap();
        reader.seek_to_object(&asset.objects[3]).unwrap();
        let mesh = Mesh::deserialize(&mut reader, &asset).unwrap();
        assert_eq!(mesh.compressed_mesh.vertices.num_items, 14577);
        assert_eq!(mesh.compressed_mesh.vertices.data.len(), 2 * 14577);
    }
}