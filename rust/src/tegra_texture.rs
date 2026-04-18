use std::num::NonZeroU32;
use tegra_swizzle::surface::{BlockDim, deswizzle_surface, deswizzled_surface_size};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
pub fn tegra_deswizzle(src: &[u8], width: u32, height: u32, block_width: u32, block_height: u32, bytes_per_block: u32, mipmap_count: Option<u32>, depth: Option<u32>, layer_count: Option<u32>, block_depth: Option<u32>) -> Vec<u8> {
    let block_dim: BlockDim = BlockDim {
        width: NonZeroU32::new(block_width).unwrap(),
        height: NonZeroU32::new(block_height).unwrap(),
        depth: NonZeroU32::new(block_depth.unwrap_or(1)).unwrap()
    };
    deswizzle_surface(width, height, depth.unwrap_or(1), src, block_dim, None, bytes_per_block, mipmap_count.unwrap_or(1), layer_count.unwrap_or(1)).unwrap()
}

#[wasm_bindgen]
pub fn tegra_deswizzled_size(width: u32, height: u32, block_width: u32, block_height: u32, bytes_per_block: u32, mipmap_count: Option<u32>, depth: Option<u32>, layer_count: Option<u32>, block_depth: Option<u32>) -> usize {
    let block_dim: BlockDim = BlockDim {
        width: NonZeroU32::new(block_width).unwrap(),
        height: NonZeroU32::new(block_height).unwrap(),
        depth: NonZeroU32::new(block_depth.unwrap_or(1)).unwrap()
    };
    return deswizzled_surface_size(width, height, depth.unwrap_or(1), block_dim, bytes_per_block, mipmap_count.unwrap_or(1), layer_count.unwrap_or(1));
}
