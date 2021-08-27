
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

pub mod glsl_compile;
pub mod gx_texture;
pub mod tegra_texture;
pub mod util;
pub mod yaz0;
