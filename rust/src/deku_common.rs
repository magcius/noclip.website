use deku::prelude::*;
use deku::ctx::Endian;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
#[derive(DekuRead, Debug, Default, Clone, Copy, PartialEq)]
#[deku(ctx = "endian: Endian")]
pub struct Vec3 {
    #[deku(endian = "endian")]
    pub x: f32,
    #[deku(endian = "endian")]
    pub y: f32,
    #[deku(endian = "endian")]
    pub z: f32,
}

// Axis-aligned bounding box
#[wasm_bindgen]
#[derive(DekuRead, Debug, Clone, Copy)]
#[deku(ctx = "endian: Endian")]
pub struct AABBox {
    #[deku(ctx = "endian")]
    pub min: Vec3,
    #[deku(ctx = "endian")]
    pub max: Vec3,
}
