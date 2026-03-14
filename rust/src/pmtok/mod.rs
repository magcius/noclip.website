use std::{num::NonZeroU32};
use wasm_bindgen::prelude::*;
use tegra_swizzle::surface::{BlockDim, deswizzle_surface};

#[wasm_bindgen(js_name = "pmtok_deswizzle")]
pub fn deswizzle(src: &[u8], width: u32, height: u32, block_width: u32, block_height: u32, bytes_per_pixel: u32, mipmap_count: u32) -> Vec<u8> {
    let block_dim: BlockDim = BlockDim {
        width: Option::expect(NonZeroU32::new(block_width), ""),
        height: Option::expect(NonZeroU32::new(block_height), ""),
        depth: Option::expect(NonZeroU32::new(1), "")
    };

    let surface: Result<Vec<u8>, tegra_swizzle::SwizzleError> = deswizzle_surface(width, height, 1, src, block_dim, None, bytes_per_pixel, mipmap_count, 1);

    match surface {
        Ok(v) => return v,
        Err(_e) => return vec![0x00; src.len() as usize]
    }
}
