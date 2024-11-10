use std::{collections::HashMap, fmt::Debug, hash::Hash, marker::PhantomData};

use wasm_bindgen::prelude::*;
use deku::{bitvec::{BitSlice, Msb0}, ctx::BitSize, prelude::*};

#[derive(Clone, Debug)]
pub struct UnityArray<T> {
    pub values: Vec<T>,
}

impl<'a, T> DekuRead<'a> for UnityArray<T> where T: DekuRead<'a> {
    fn read(
        input: &'a deku::bitvec::BitSlice<u8, deku::bitvec::Msb0>,
        ctx: (),
    ) -> Result<(&'a deku::bitvec::BitSlice<u8, deku::bitvec::Msb0>, Self), DekuError>
    where
        Self: Sized {
            let (mut rest, count) = i32::read(input, ctx)?;
            let mut values = Vec::with_capacity(count as usize);
            for _ in 0..count {
                let (new_rest, value) = T::read(rest, ctx)?;
                rest = new_rest;
                values.push(value);
            }
            Ok((rest, UnityArray {
                values,
            }))
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

impl<'a, K, V> DekuRead<'a> for Map<K, V>
    where K: DekuRead<'a>, V: DekuRead<'a>
{
    fn read(
        input: &'a deku::bitvec::BitSlice<u8, deku::bitvec::Msb0>,
        ctx: (),
    ) -> Result<(&'a deku::bitvec::BitSlice<u8, deku::bitvec::Msb0>, Self), DekuError>
    where
        Self: Sized {
            let (mut rest, count) = i32::read(input, ctx)?;
            let mut keys = Vec::with_capacity(count as usize);
            let mut values = Vec::with_capacity(count as usize);
            for _ in 0..count {
                let (new_rest, key) = K::read(rest, ctx)?;
                rest = new_rest;
                let (new_rest, value) = V::read(rest, ctx)?;
                rest = new_rest;
                keys.push(key);
                values.push(value);
            }
            Ok((rest, Map {
                keys,
                values,
            }))
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

#[derive(DekuRead, Clone)]
pub struct CharArray {
    count: u32,
    #[deku(count = "*count")]
    bytes: Vec<u8>,
    // align to the nearest 4 byte boundary
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

fn unpack_i32s(input: &BitSlice<u8, Msb0>, num_items: usize, bit_size: usize) -> Result<(&BitSlice<u8, Msb0>, Vec<i32>), DekuError> {
    let mut result = Vec::with_capacity(num_items);
    let mut rest = input;
    for _ in 0..num_items {
        let (new_rest, value) = i32::read(rest, BitSize(bit_size))?;
        rest = new_rest;
        result.push(value);
    }
    Ok((rest, result))
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

impl<'a> DekuRead<'a> for Packedi32Vec {
    fn read(input: &'a BitSlice<u8, Msb0>, ctx: ()) -> Result<(&'a BitSlice<u8, Msb0>, Self), DekuError>
    where
        Self: Sized {
            let (mut rest, num_items) = u32::read(input, ctx)?;
            let (new_rest, byte_array_count) = u32::read(rest, ctx)?;
            rest = new_rest;
            let (new_rest, bit_size) = u8::read(&rest[8 * byte_array_count as usize..], ctx)?;
            // align
            let last_rest = &new_rest[3*8..];
            let (_, data) = unpack_i32s(rest, num_items as usize, bit_size as usize)?;

            Ok((last_rest, Packedi32Vec {
                data,
            }))
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

impl<'a> DekuRead<'a> for Packedf32Vec {
    fn read(input: &'a BitSlice<u8, Msb0>, ctx: ()) -> Result<(&'a BitSlice<u8, Msb0>, Self), DekuError>
    where
        Self: Sized {
            let (mut rest, num_items) = u32::read(input, ctx)?;
            let (new_rest, scale) = f32::read(rest, ctx)?;
            rest = new_rest;
            let (new_rest, start) = f32::read(rest, ctx)?;
            rest = new_rest;
            let (new_rest, byte_array_count) = u32::read(rest, ctx)?;
            rest = new_rest;
            let (new_rest, bit_size) = u8::read(&rest[8 * byte_array_count as usize..], ctx)?;
            // align
            let last_rest = &new_rest[3*8..];

            let max = ((1 << bit_size) as f32) - 1.0;
            let (_, ints) = unpack_i32s(rest, num_items as usize, bit_size as usize)?;
            let mut result = Vec::with_capacity(num_items as usize);
            for v in ints {
                result.push(start + (v as f32) * scale / max);
            }

            Ok((last_rest, Packedf32Vec {
                data: result,
            }))
    }
}
