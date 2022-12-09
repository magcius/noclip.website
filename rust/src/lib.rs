
// When the `wee_alloc` feature is enabled, use `wee_alloc` as the global
// allocator.
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

pub mod gx_texture;
pub mod glsl_compile;
pub mod tegra_texture;
pub mod util;
pub mod unity;
pub mod yaz0;
pub mod halo;