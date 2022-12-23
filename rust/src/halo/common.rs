use std::{io::{Cursor, Seek, SeekFrom}};
use byteorder::{ReadBytesExt, LittleEndian};
use num_enum::{TryFromPrimitive, TryFromPrimitiveError};
use wasm_bindgen::prelude::*;

pub type Result<T> = std::result::Result<T, MapReaderError>;
pub type Pointer = u32;

#[derive(Debug, Clone)]
pub enum MapReaderError {
    IO(String),
    UnimplementedTag(String),
    InvalidTag(String),
}

impl From<std::io::Error> for MapReaderError {
    fn from(err: std::io::Error) -> Self {
        MapReaderError::IO(err.to_string())
    }
}

impl<T: TryFromPrimitive> From<TryFromPrimitiveError<T>> for MapReaderError {
    fn from(err: TryFromPrimitiveError<T>) -> Self {
        MapReaderError::IO(err.to_string())
    }
}

pub trait Deserialize {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized;
}

#[derive(Debug, Clone)]
pub struct Block<T> {
    pub items: Option<Vec<T>>,
    pub base_pointer: Pointer,
    pub count: usize,
}

impl<T> Deserialize for Block<T> {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let count = data.read_u32::<LittleEndian>()? as usize;
        let base_pointer = data.read_u32::<LittleEndian>()? as Pointer;
        data.seek(SeekFrom::Current(4))?;
        Ok(Block {
            count, 
            base_pointer,
            items: None,
        })
    }
}

impl<T: Deserialize + std::fmt::Debug> Block<T> {
    pub fn read_items(&mut self, data: &mut Cursor<Vec<u8>>, offset: i64) -> Result<()> {
        let mut items: Vec<T> = Vec::with_capacity(self.count as usize);
        if self.count > 0 {
            let pointer = offset + self.base_pointer as i64;
            if pointer < 0 {
                panic!("pointer underflow for offset {} and pointer {}", offset, self.base_pointer);
            }
            data.seek(SeekFrom::Start((self.base_pointer as i64 + offset) as u64))?;
            for _ in 0..self.count {
                items.push(T::deserialize(data)?);
            }
        }
        self.items = Some(items);
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct Vector3D {
    pub i: f32,
    pub j: f32,
    pub k: f32,
}

impl Deserialize for Vector3D {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(Vector3D {
            i: data.read_f32::<LittleEndian>()?,
            j: data.read_f32::<LittleEndian>()?,
            k: data.read_f32::<LittleEndian>()?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct TagDataOffset {
    pub size: u32,
    pub external: u32,
    pub file_offset: u32,
}

impl Deserialize for TagDataOffset {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let offset = TagDataOffset {
            size: data.read_u32::<LittleEndian>()?,
            external: data.read_u32::<LittleEndian>()?,
            file_offset: data.read_u32::<LittleEndian>()?,
        };
        data.seek(SeekFrom::Current(8))?;
        Ok(offset)
    }
}

#[derive(Debug, Clone)]
pub struct Plane3D {
    pub norm: Vector3D,
    pub w: f32, // distance from origin (along normal)
}

impl Deserialize for Plane3D {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(Plane3D {
            norm: Vector3D::deserialize(data)?,
            w: data.read_f32::<LittleEndian>()?,
        })
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Tri {
    pub v0: u16,
    pub v1: u16,
    pub v2: u16,
}

impl Deserialize for Tri {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(Tri {
            v0: data.read_u16::<LittleEndian>()?,
            v1: data.read_u16::<LittleEndian>()?,
            v2: data.read_u16::<LittleEndian>()?,
        })
    }
}
#[wasm_bindgen]
#[derive(Debug, Clone, Copy)]
pub struct ColorRGB {
    pub r: f32,
    pub g: f32,
    pub b: f32,
}

impl Deserialize for ColorRGB {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(ColorRGB {
            r: data.read_f32::<LittleEndian>()?,
            g: data.read_f32::<LittleEndian>()?,
            b: data.read_f32::<LittleEndian>()?,
        })
    }
}

#[derive(Debug, Clone, Copy)]
#[wasm_bindgen]
pub struct ColorARGB {
    pub a: f32,
    pub r: f32,
    pub g: f32,
    pub b: f32,
}

impl Deserialize for ColorARGB {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(ColorARGB {
            a: data.read_f32::<LittleEndian>()?,
            r: data.read_f32::<LittleEndian>()?,
            g: data.read_f32::<LittleEndian>()?,
            b: data.read_f32::<LittleEndian>()?,
        })
    }
}
#[wasm_bindgen]
#[derive(Debug, Copy, Clone)]
pub struct Point2D {
    pub x: f32,
    pub y: f32,
}

impl Deserialize for Point2D {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(Point2D {
            x: data.read_f32::<LittleEndian>()?,
            y: data.read_f32::<LittleEndian>()?,
        })
    }
}

#[derive(Debug, Copy, Clone)]
pub struct Point2DInt {
    pub x: i16,
    pub y: i16,
}

impl Deserialize for Point2DInt {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(Point2DInt {
            x: data.read_i16::<LittleEndian>()?,
            y: data.read_i16::<LittleEndian>()?,
        })
    }
}

#[wasm_bindgen]
#[derive(Debug, Copy, Clone)]
pub struct Point3D {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Deserialize for Point3D {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(Point3D {
            x: data.read_f32::<LittleEndian>()?,
            y: data.read_f32::<LittleEndian>()?,
            z: data.read_f32::<LittleEndian>()?,
        })
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy)]
pub struct Euler3D {
    pub yaw: f32,
    pub pitch: f32,
    pub roll: f32,
}

impl Deserialize for Euler3D {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(Euler3D {
            yaw: data.read_f32::<LittleEndian>()?,
            pitch: data.read_f32::<LittleEndian>()?,
            roll: data.read_f32::<LittleEndian>()?,
        })
    }
}