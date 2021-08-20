
// When the `wee_alloc` feature is enabled, use `wee_alloc` as the global
// allocator.
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

pub mod yaz0;
pub mod gx_texture;
pub mod glsl_compile;

pub use crate::yaz0::yaz0dec;
pub use crate::gx_texture::decode_texture;
pub use crate::glsl_compile::glsl_compile;
