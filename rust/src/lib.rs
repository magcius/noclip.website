
// When the `wee_alloc` feature is enabled, use `wee_alloc` as the global
// allocator.
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

pub mod yaz0;
pub mod gx_texture;

pub use crate::yaz0::yaz0dec;
pub use crate::gx_texture::decode_texture;

use wasm_bindgen::prelude::*;

// This is like the `main` function, except for JavaScript.
#[wasm_bindgen(start)]
pub fn main() {
    console_error_panic_hook::set_once();
}
