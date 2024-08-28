use deku::{bitvec::{BitSlice, BitVec}, ctx::ByteSize, prelude::*};
use wasm_bindgen::prelude::*;
use std::ops::{Mul, AddAssign};

use crate::geometry::AABB;

#[derive(DekuRead, Debug, Clone, Copy)]
pub struct Fixedi16 {
    pub inner: i16,
}

impl From<Fixedi16> for f32 {
    fn from(value: Fixedi16) -> Self {
        value.inner as f32 / 32768.0
    }
}

impl From<f32> for Fixedi16 {
    fn from(value: f32) -> Self {
        Self { inner: (value * 32768.0) as i16 }
    }
}

#[derive(DekuRead, Debug)]
pub struct Chunk {
    pub magic: [u8; 4],
    pub size: u32,
}

pub fn parse_with_byte_size<T>(data: &[u8]) -> Result<T, String>
    where for<'a> T: DekuRead<'a, ByteSize>
{
    parse_inner(data, ByteSize(data.len()))
}

pub fn parse<T>(data: &[u8]) -> Result<T, String>
    where for<'a> T: DekuRead<'a, ()>
{
    parse_inner(data, ())
}

pub fn parse_array<T>(data: &[u8], size_per_data: usize) -> Result<Vec<T>, String>
    where for<'a> T: DekuRead<'a, ()>
{
    if data.len() % size_per_data != 0 {
        return Err(format!(
            "chunk size {} not evenly divisible by element size {}",
            data.len(),
            size_per_data
        ));
    }
    let num_elements = data.len() / size_per_data;
    let bitvec = BitVec::from_slice(data);
    let mut result = Vec::with_capacity(num_elements);
    let mut rest = bitvec.as_bitslice();
    for _ in 0..num_elements {
        let (new_rest, element) = T::read(rest, ())
            .map_err(|e| format!("{:?}", e))?;
        result.push(element);
        rest = new_rest;
    }
    Ok(result)
}

fn parse_inner<T, V>(data: &[u8], ctx: V) -> Result<T, String>
    where for<'a> T: DekuRead<'a, V>
{
    let bitvec = BitVec::from_slice(data);
    let (_, element) = T::read(bitvec.as_bitslice(), ctx)
        .map_err(|e| format!("{:?}", e))?;
    Ok(element)
}

impl Chunk {
    pub fn magic_str(&self) -> &str {
        std::str::from_utf8(&self.magic).unwrap()
    }
}

pub struct ChunkedData<'a> {
    pub data: &'a [u8],
    pub idx: usize,
}

impl<'a> ChunkedData<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        ChunkedData {
            data,
            idx: 0,
        }
    }
}

impl<'a> Iterator for ChunkedData<'a> {
    type Item = (Chunk, &'a [u8]);

    fn next(&mut self) -> Option<Self::Item> {
        if self.idx == self.data.len() {
            return None;
        }
        let (_, chunk) = Chunk::from_bytes((&self.data[self.idx..], 0)).unwrap();
        let chunk_start = self.idx + 8;
        let chunk_end = chunk_start + chunk.size as usize;
        let chunk_data = &self.data[chunk_start..chunk_end];
        self.idx = chunk_end;
        assert!(self.idx <= self.data.len());
        Some((chunk, chunk_data))
    }
}

pub type WowCharArray = WowArray<u8>;

impl WowArray<u8> {
    pub fn to_string(&self, data: &[u8]) -> Result<String, String> {
        let mut bytes = self.to_vec(data)?;
        bytes.pop(); // pop the null byte
        Ok(String::from_utf8(bytes).unwrap())
    }
}

pub fn fixed_precision_6_9_to_f32(x: u16) -> f32 {
    let mut result = (x & 0x1ff) as f32 * (1.0 / 512.0) + (x >> 9) as f32;
    if x & 0x8000 > 0 {
        result *= -1.0;
    }
    result
}

#[wasm_bindgen(js_name = "WowQuat")]
#[derive(DekuRead, Debug, Clone, Copy)]
pub struct Quat {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub w: f32,
}

impl Quat {
    pub fn normalize(&mut self) {
        let inverse_mag = 1.0 / self.dot(self).sqrt();
        self.x *= inverse_mag;
        self.y *= inverse_mag;
        self.z *= inverse_mag;
        self.w *= inverse_mag;
    }

    pub fn negate(&mut self) {
        self.x *= -1.0;
        self.y *= -1.0;
        self.z *= -1.0;
        self.w *= -1.0;
    }

    pub fn dot(&self, other: &Quat) -> f32 {
        self.x * other.x + self.y * other.y + self.z * other.z + self.w * other.w
    }
}

#[wasm_bindgen(js_name = "WowQuat16")]
#[derive(DekuRead, Debug, Clone, Copy)]
pub struct Quat16 {
    pub x: i16,
    pub y: i16,
    pub z: i16,
    pub w: i16,
}

#[wasm_bindgen(js_name = "WowVec3")]
#[derive(DekuRead, Debug, Default, Clone, Copy, PartialEq)]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Vec3 {
    pub fn new(v: f32) -> Self {
        Vec3 { x: v, y: v, z: v }
    }
}

impl From<Vec3> for nalgebra_glm::Vec3 {
    fn from(value: Vec3) -> Self {
        nalgebra_glm::vec3(value.x, value.y, value.z)
    }
}

#[wasm_bindgen(js_name = "WowVec4")]
#[derive(DekuRead, Debug, Clone, Copy)]
pub struct Vec4 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub w: f32,
}

impl Vec4 {
    pub fn new(v: f32) -> Self {
        Vec4 { x: v, y: v, z: v, w: v }
    }
}

#[wasm_bindgen(js_name = "WowVec2")]
#[derive(DekuRead, Debug, Clone, Copy)]
pub struct Vec2 {
    pub x: f32,
    pub y: f32,
}

impl From<Vec2> for nalgebra_glm::Vec2 {
    fn from(value: Vec2) -> Self {
        nalgebra_glm::vec2(value.x, value.y)
    }
}

#[wasm_bindgen(js_name = "WowRgba")]
#[derive(DekuRead, Debug, Clone, Copy)]
pub struct Rgba {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

#[wasm_bindgen(js_name = "WowBgra")]
#[derive(DekuRead, Debug, Clone, Copy)]
pub struct Bgra {
    pub b: u8,
    pub g: u8,
    pub r: u8,
    pub a: u8,
}

impl From<Bgra> for Rgba {
    fn from(value: Bgra) -> Self {
        Rgba {
            r: value.r,
            g: value.g,
            b: value.b,
            a: value.a,
        }
    }
}

#[wasm_bindgen(js_name = "WowPlane")]
#[derive(DekuRead, Clone, Debug)]
pub struct Plane {
    pub normal: Vec3,
    pub distance: f32,
}

impl From<&Plane> for crate::geometry::Plane {
    fn from(value: &Plane) -> Self {
        crate::geometry::Plane {
            d: value.distance,
            normal: value.normal.into(),
        }
    }
}

// Axis-aligned bounding box
#[wasm_bindgen(js_name = "WowAABBox")]
#[derive(DekuRead, Debug, Clone, Copy)]
pub struct AABBox {
    pub min: Vec3,
    pub max: Vec3,
}

impl Default for AABBox {
    fn default() -> Self {
        Self {
            min: Vec3 { x: f32::INFINITY, y: f32::INFINITY, z: f32::INFINITY },
            max: Vec3 { x: f32::NEG_INFINITY, y: f32::NEG_INFINITY, z: f32::NEG_INFINITY },
        }
    }
}

impl From<AABBox> for AABB {
    fn from(value: AABBox) -> Self {
        AABB { min: value.min.into(), max: value.max.into() }
    }
}

impl AABBox {
    pub fn update(&mut self, x: f32, y: f32, z: f32) {
        self.min.x = self.min.x.min(x);
        self.max.x = self.max.x.max(x);
        self.min.y = self.min.y.min(y);
        self.max.y = self.max.y.max(y);
        self.min.z = self.min.z.min(z);
        self.max.z = self.max.z.max(z);
    }
}

#[derive(Debug, DekuRead, Clone, Copy)]
pub struct WowArray<T> {
    pub count: i32,
    pub offset: i32,
    #[deku(skip)]
    pub element_type: std::marker::PhantomData<T>,
}

impl<T> WowArray<T> where for<'a> T: DekuRead<'a> {
    pub fn to_vec(&self, data: &[u8]) -> Result<Vec<T>, String> {
        let mut result = Vec::with_capacity(self.count as usize);
        let mut bitslice = BitSlice::from_slice(&data[self.offset as usize..]);
        for _ in 0..self.count {
            let (new_bitslice, element) = T::read(bitslice, ())
                .map_err(|e| format!("{:?}", e))?;
            bitslice = new_bitslice;
            result.push(element);
        }
        Ok(result)
    }
}

pub trait Lerp {
    fn lerp(self, other: Self, t: f32) -> Self;
}

impl Lerp for f32 {
    fn lerp(self, other: Self, t: f32) -> Self {
        self * (1.0 - t) + other * t
    }
}

impl Lerp for Quat16 {
    fn lerp(self, other: Self, t: f32) -> Self {
        Self {
            x: ((self.x as f32) * (1.0 - t) + (other.x as f32) * t) as i16,
            y: ((self.y as f32) * (1.0 - t) + (other.y as f32) * t) as i16,
            z: ((self.z as f32) * (1.0 - t) + (other.z as f32) * t) as i16,
            w: ((self.w as f32) * (1.0 - t) + (other.w as f32) * t) as i16,
        }
    }
}

impl From<Quat16> for Quat {
    fn from(value: Quat16) -> Self {
        let components = [value.x, value.y, value.z, value.w].map(|c| {
            if c < 0 {
                (c as i32 + 32768) as f32 / 32767.0
            } else {
                (c as i32 - 32767) as f32 / 32767.0
            }
        });
        let mut result = Quat {
            x: components[0],
            y: components[1],
            z: components[2],
            w: components[3],
        };
        result.normalize();
        result
    }
}

impl Lerp for u8 {
    fn lerp(self, other: Self, t: f32) -> Self {
        ((self as f32) * (1.0 - t) + (other as f32) * t) as u8
    }
}

impl Lerp for Fixedi16 {
    fn lerp(self, other: Self, t: f32) -> Self {
        let a: f32 = self.into();
        let b: f32 = other.into();
        Fixedi16::from(a.lerp(b, t))
    }
}

impl Lerp for i16 {
    fn lerp(self, other: Self, t: f32) -> Self {
        ((self as f32) * (1.0 - t) + (other as f32) * t) as i16
    }
}

impl Lerp for u16 {
    fn lerp(self, other: Self, t: f32) -> Self {
        ((self as f32) * (1.0 - t) + (other as f32) * t) as u16
    }
}

impl Lerp for Vec2 {
    fn lerp(self, other: Self, t: f32) -> Self {
        Vec2 {
            x: self.x * (1.0 - t) + other.x * t,
            y: self.y * (1.0 - t) + other.y * t,
        }
    }
}

impl Lerp for Vec3 {
    fn lerp(self, other: Self, t: f32) -> Self {
        Vec3 {
            x: self.x * (1.0 - t) + other.x * t,
            y: self.y * (1.0 - t) + other.y * t,
            z: self.z * (1.0 - t) + other.z * t,
        }
    }
}

impl AddAssign<Vec3> for Vec3 {
    fn add_assign(&mut self, other: Vec3) {
        self.x += other.x;
        self.y += other.y;
        self.z += other.z;
    }
}

impl Mul<f32> for Vec3 {
    type Output = Vec3;

    fn mul(self, rhs: f32) -> Self::Output {
        Vec3 {
            x: self.x * rhs,
            y: self.y * rhs,
            z: self.z * rhs,
        }
    }
}

impl Lerp for Quat {
    fn lerp(self, mut other: Self, t: f32) -> Self {
        if self.dot(&other) < 0.0 {
            other.negate();
        }
        let mut result = Quat {
            x: self.x * (1.0 - t) + other.x * t,
            y: self.y * (1.0 - t) + other.y * t,
            z: self.z * (1.0 - t) + other.z * t,
            w: self.w * (1.0 - t) + other.w * t,
        };
        result.normalize();
        result
    }
}
