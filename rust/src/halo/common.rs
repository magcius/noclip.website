use std::{error::Error, fmt::Display, io::{Cursor, Seek, SeekFrom}};
use deku::prelude::*;
use anyhow::Result;
use wasm_bindgen::prelude::*;

pub type Pointer = u32;

#[derive(Debug, Clone)]
pub enum MapReaderError {
    IO(String),
    UnimplementedTag(String),
    InvalidTag(String),
}

impl Display for MapReaderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}

impl Error for MapReaderError {}

#[derive(Debug, Clone, DekuRead)]
pub struct Block<T> {
    pub count: u32,
    #[deku(pad_bytes_after = "4")]
    pub base_pointer: Pointer,
    #[deku(skip)]
    pub items: Option<Vec<T>>,
}

impl<'a, T: DekuContainerRead<'a> + std::fmt::Debug> Block<T> {
    pub fn read_items(&mut self, data: &mut Reader<Cursor<Vec<u8>>>, offset: i64) -> Result<()> {
        let mut items: Vec<T> = Vec::with_capacity(self.count as usize);
        if self.count > 0 {
            let pointer = offset + self.base_pointer as i64;
            if pointer < 0 {
                panic!("pointer underflow for offset {} and pointer {}", offset, self.base_pointer);
            }
            data.seek(SeekFrom::Start((self.base_pointer as i64 + offset) as u64))?;
            for _ in 0..self.count {
                items.push(T::from_reader_with_ctx(data, ())?);
            }
        }
        self.items = Some(items);
        Ok(())
    }
}

#[wasm_bindgen(js_name = "HaloVector3D")]
#[derive(Debug, Copy, Clone, DekuRead)]
pub struct Vector3D {
    pub i: f32,
    pub j: f32,
    pub k: f32,
}

#[derive(Debug, Clone, DekuRead)]
pub struct TagDataOffset {
    pub size: u32,
    pub external: u32,
    #[deku(pad_bytes_after = "8")]
    pub file_offset: u32,
}

#[wasm_bindgen(js_name = "HaloPlane3D")]
#[derive(Debug, Copy, Clone, DekuRead)]
pub struct Plane3D {
    pub norm: Vector3D,
    pub w: f32, // distance from origin (along normal)
}

#[derive(Debug, Clone, Copy, DekuRead)]
pub struct Tri {
    pub v0: u16,
    pub v1: u16,
    pub v2: u16,
}

#[wasm_bindgen(js_name = "HaloColorRGB")]
#[derive(Debug, Clone, Copy, DekuRead)]
pub struct ColorRGB {
    pub r: f32,
    pub g: f32,
    pub b: f32,
}

#[wasm_bindgen(js_name = "HaloColorARGB")]
#[derive(Debug, Clone, Copy, DekuRead)]
#[wasm_bindgen]
pub struct ColorARGB {
    pub a: f32,
    pub r: f32,
    pub g: f32,
    pub b: f32,
}

#[wasm_bindgen(js_name = "HaloPoint2D")]
#[derive(Debug, Copy, Clone, DekuRead)]
pub struct Point2D {
    pub x: f32,
    pub y: f32,
}

#[wasm_bindgen(js_name = "HaloPoint2DInt")]
#[derive(Debug, Copy, Clone, DekuRead)]
pub struct Point2DInt {
    pub x: i16,
    pub y: i16,
}

#[wasm_bindgen(js_name = "HaloPoint3D")]
#[derive(Debug, Copy, Clone, DekuRead)]
pub struct Point3D {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

#[wasm_bindgen(js_name = "HaloEuler3D")]
#[derive(Debug, Clone, Copy, DekuRead)]
pub struct Euler3D {
    pub yaw: f32,
    pub pitch: f32,
    pub roll: f32,
}
