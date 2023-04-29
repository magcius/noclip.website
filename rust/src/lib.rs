// When the `wee_alloc` feature is enabled, use `wee_alloc` as the global
// allocator.
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

pub mod compression;
pub mod glsl_compile;
pub mod gx_texture;
pub mod halo;
pub mod tegra_texture;
pub mod unity;
pub mod util;
pub mod yaz0;
