use std::borrow::Cow;
use std::io::{Seek, SeekFrom};
use std::{collections::HashMap, fmt::Debug, hash::Hash, marker::PhantomData};
use std::clone::Clone;

use wasm_bindgen::prelude::*;
use deku::{ctx::BitSize, prelude::*};

// Important: these must be ordered by chronological release date, so
// PartialOrd can correctly compare them.
#[wasm_bindgen(js_name = "UnityVersion")]
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd)]
pub enum UnityVersion {
    V2019_4_39f1,
    V2020_3_16f1,
    V2021_3_27f1,
}

#[derive(Clone, Debug, Default)]
pub struct UnityArray<T> {
    pub values: Vec<T>,
}

fn check_count(count: usize, limit: usize) -> Result<(), DekuError> {
    if count > limit {
        return Err(DekuError::Assertion(Cow::from(format!("Got unreasonably large count: {} > {}", count, limit))));
    }
    Ok(())
}

impl<'a, T, Ctx> DekuReader<'a, Ctx> for UnityArray<T> where T: DekuReader<'a, Ctx>, Ctx: Clone {
    fn from_reader_with_ctx<R: std::io::Read + std::io::Seek>(reader: &mut Reader<R>, ctx: Ctx) -> Result<Self, DekuError> {
        let count = i32::from_reader_with_ctx(reader, ())? as usize;
        let mut values = Vec::new();
        for _ in 0..count {
            values.push(T::from_reader_with_ctx(reader, ctx.clone())?);
        }
        Ok(UnityArray {
            values,
        })
    }
}

impl<PreT, ResT> From<UnityArray<PreT>> for Vec<ResT> where ResT: From<PreT> {
    fn from(mut array: UnityArray<PreT>) -> Self {
        array.values.drain(..).map(|v| v.into()).collect()
    }
}

#[derive(Clone, Debug)]
pub struct Map<K, V> {
    pub keys: Vec<K>,
    pub values: Vec<V>,
}

impl<'a, K, V, Ctx> DekuReader<'a, Ctx> for Map<K, V>
    where K: DekuReader<'a, Ctx>, V: DekuReader<'a, Ctx>, Ctx: Clone
{
    fn from_reader_with_ctx<R: std::io::Read + std::io::Seek>(reader: &mut Reader<R>, ctx: Ctx) -> Result<Self, DekuError> {
        let count = i32::from_reader_with_ctx(reader, ())?;
        let mut keys = Vec::new();
        let mut values = Vec::new();
        for _ in 0..count {
            keys.push(K::from_reader_with_ctx(reader, ctx.clone())?);
            values.push(V::from_reader_with_ctx(reader, ctx.clone())?);
        }
        Ok(Map {
            keys,
            values,
        })
    }
}

impl<PreK, PreV, ResK, ResV> From<Map<PreK, PreV>> for HashMap<ResK, ResV>
    where ResK: Hash + Eq,
        ResK: From<PreK>,
        ResV: From<PreV> {
    fn from(mut map: Map<PreK, PreV>) -> Self {
        let mut result = HashMap::new();
        let keys = map.keys.drain(..);
        let values = map.values.drain(..);
        for (k, v) in keys.zip(values) {
            result.insert(k.into(), v.into());
        }
        result
    }
}

#[derive(DekuRead, Clone, Default)]
pub struct CharArray {
    count: u32,
    #[deku(count = "*count")]
    bytes: Vec<u8>,
    #[deku(count = "(4 - deku::byte_offset % 4) % 4")] _alignment: Vec<u8>,
}

impl From<CharArray> for String {
    fn from(value: CharArray) -> Self {
        String::from_utf8(value.bytes).unwrap()
    }
}

impl Debug for CharArray {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = core::str::from_utf8(&self.bytes);
        s.fmt(f)
    }
}

#[derive(DekuRead, Clone)]
pub struct NullTerminatedAsciiString {
    #[deku(until = "|v: &u8| *v == 0")]
    pub bytes: Vec<u8>,
}

impl From<&NullTerminatedAsciiString> for String {
    fn from(value: &NullTerminatedAsciiString) -> Self {
        std::str::from_utf8(&value.bytes[0..value.bytes.len() - 1]).unwrap().to_string()
    }
}

impl From<NullTerminatedAsciiString> for String {
    fn from(mut value: NullTerminatedAsciiString) -> Self {
        value.bytes.pop();
        String::from_utf8(value.bytes).unwrap()
    }
}

impl Debug for NullTerminatedAsciiString {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = core::str::from_utf8(&self.bytes[0..self.bytes.len() - 1]);
        s.fmt(f)
    }
}

#[derive(DekuRead, Debug, Clone, Copy)]
pub struct PPtr<T> {
    pub file_index: u32,
    pub path_id: i64,
    #[deku(skip)]
    _foo: PhantomData<T>,
}

#[wasm_bindgen(js_name = "UnityVec4")]
#[derive(DekuRead, Debug, Copy, Clone)]
pub struct Vec4 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub w: f32,
}

#[wasm_bindgen(js_name = "UnityVec3")]
#[derive(DekuRead, Debug, Copy, Clone)]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

#[wasm_bindgen(js_name = "UnityVec2")]
#[derive(DekuRead, Debug, Copy, Clone)]
pub struct Vec2 {
    pub x: f32,
    pub y: f32,
}

#[wasm_bindgen(js_name = "UnityColorRGBA")]
#[derive(DekuRead, Debug, Copy, Clone)]
pub struct ColorRGBA {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

#[wasm_bindgen(js_name = "UnityQuaternion")]
#[derive(DekuRead, Clone, Copy, Debug)]
pub struct Quaternion {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub w: f32,
}

#[wasm_bindgen(js_name = "UnityAABB")]
#[derive(DekuRead, Clone, Copy, Debug)]
pub struct AABB {
    pub center: Vec3,
    pub extent: Vec3,
}

#[wasm_bindgen(js_name = "UnityMat4")]
#[derive(DekuRead, Clone, Copy, Debug)]
pub struct Matrix4x4 {
    pub e0: Vec4,
    pub e1: Vec4,
    pub e2: Vec4,
    pub e3: Vec4,
}

fn unpack_i32s<R: std::io::Read + std::io::Seek>(reader: &mut Reader<R>, num_items: usize, bit_size: usize) -> Result<Vec<i32>, DekuError> {
    let mut result = Vec::new();
    for _ in 0..num_items {
        let value = i32::from_reader_with_ctx(reader, BitSize(bit_size))?;
        result.push(value);
    }
    Ok(result)
}

#[derive(Clone, Debug)]
pub struct Packedi32Vec {
    pub data: Vec<i32>,
}

impl From<Packedi32Vec> for Vec<i32> {
    fn from(value: Packedi32Vec) -> Self {
        value.data
    }
}

impl<'a, Ctx> DekuReader<'a, Ctx> for Packedi32Vec where Ctx: Clone {
    fn from_reader_with_ctx<R: std::io::Read + std::io::Seek>(reader: &mut Reader<R>, _ctx: Ctx) -> Result<Self, DekuError> {
        let num_items = u32::from_reader_with_ctx(reader, ())? as usize;
        let byte_array_count = u32::from_reader_with_ctx(reader, ())? as usize;
        reader.seek(SeekFrom::Current(byte_array_count as i64)).unwrap();
        let bit_size: u8 = u8::from_reader_with_ctx(reader, ())?;
        reader.seek(SeekFrom::Current(-(byte_array_count as i64) - 1)).unwrap();
        reader.bits_read -= 8;
        let data = unpack_i32s(reader, num_items as usize, bit_size as usize)?;
        reader.skip_bits(4 * 8)?; // bit_size, padding

        Ok(Packedi32Vec {
            data,
        })
    }
}

#[derive(Clone, Debug)]
pub struct Packedf32Vec {
    pub data: Vec<f32>,
}

impl From<Packedf32Vec> for Vec<f32> {
    fn from(value: Packedf32Vec) -> Self {
        value.data
    }
}

impl<'a, Ctx> DekuReader<'a, Ctx> for Packedf32Vec where Ctx: Clone {
    fn from_reader_with_ctx<R: std::io::Read + std::io::Seek>(reader: &mut Reader<R>, _ctx: Ctx) -> Result<Self, DekuError> {
        let num_items = u32::from_reader_with_ctx(reader, ())?;
        let scale = f32::from_reader_with_ctx(reader, ())?;
        let start = f32::from_reader_with_ctx(reader, ())?;
        let byte_array_count = u32::from_reader_with_ctx(reader, ())? as usize;
        reader.seek(SeekFrom::Current(byte_array_count as i64)).unwrap();
        let bit_size = u8::from_reader_with_ctx(reader, ())?;
        reader.seek(SeekFrom::Current(-(byte_array_count as i64) - 1)).unwrap();
        reader.bits_read -= 8;

        let max = ((1 << bit_size) as f32) - 1.0;
        let ints = unpack_i32s(reader, num_items as usize, bit_size as usize)?;
        let mut result = Vec::new();
        for v in ints {
            result.push(start + (v as f32) * scale / max);
        }

        reader.skip_bits(4 * 8)?; // bit_size, padding

        Ok(Packedf32Vec {
            data: result,
        })
    }
}
