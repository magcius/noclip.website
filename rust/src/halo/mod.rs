use wasm_bindgen::prelude::*;

pub mod map;
pub mod common;
pub mod util;
pub mod tag;
pub mod bitmap;
pub mod scenario;
pub mod model;
pub mod shader;
pub mod wasm;
pub mod bitmap_utils;

#[wasm_bindgen]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}