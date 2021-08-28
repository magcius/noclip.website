
use wasm_bindgen::prelude::wasm_bindgen;
use crate::util;

const GOB_SIZE_X: usize = 64;
const GOB_SIZE_Y: usize = 8;

#[wasm_bindgen]
#[derive(Copy, Clone)]
pub enum CompressionType {
    Bc1,
    Bc2,
    Bc3,
    Bc4,
    Bc5,
}

const fn get_format_bytes_per_block(channel_format: CompressionType) -> usize {
    use CompressionType::*;
    match channel_format {
        Bc1 | Bc4 => 8,
        Bc2 | Bc3 | Bc5 => 16,
    }
}

const fn get_format_block_width(channel_format: CompressionType) -> usize {
    use CompressionType::*;
    match channel_format {
        Bc1 | Bc2 | Bc3 | Bc4 | Bc5 => 4,
    }
}

const fn get_format_block_height(channel_format: CompressionType) -> usize {
    use CompressionType::*;
    match channel_format {
        Bc1 | Bc2 | Bc3 | Bc4 | Bc5 => 4,
    }
}

fn get_addr_block_linear(mut x: usize, y: usize, w: usize, bpp: usize, block_height: usize, base_addr: usize) -> usize {
    let width_in_gobs = ((w * bpp) + GOB_SIZE_X - 1) / GOB_SIZE_X;
    let mut gob_addr = base_addr;

    gob_addr += (y / (GOB_SIZE_Y * block_height)) * 512 * block_height * width_in_gobs;
    gob_addr += (x * bpp / 64) * 512 * block_height;
    gob_addr += (y % (GOB_SIZE_Y * block_height) / 8) * 512;

    x *= bpp;
    let mut addr = gob_addr;
    addr += (((x % 64) / 32) | 0) * 256;
    addr += (((y % 8) / 2) | 0) * 64;
    addr += (((x % 32) / 16) | 0) * 32;
    addr += (y % 2) * 16;
    addr += x % 16;
    return addr;
}

#[wasm_bindgen]
pub fn tegra_deswizzle(src: &[u8], compression_type: CompressionType, w: usize, h: usize, block_height_log2: usize) -> Vec<u8> {
    let format_block_width = get_format_block_width(compression_type);
    let format_block_height = get_format_block_height(compression_type);

    let width_in_blocks = (w + format_block_width - 1) / format_block_width;
    let height_in_blocks = (h + format_block_height - 1) / format_block_height;

    let mut block_height = 1 << block_height_log2;
    let bpp = get_format_bytes_per_block(compression_type);

    // Adjust block height down per mip to fit the image.
    while block_height > 1 && (util::next_pow2(height_in_blocks) < (GOB_SIZE_Y * block_height)) {
        block_height >>= 1;
    };

    let mut dst = vec![0x00; src.len() as usize];

    for y in 0..height_in_blocks {
        for x in 0..width_in_blocks {
            let src_offs = get_addr_block_linear(x, y, width_in_blocks, bpp, block_height, 0);
            let dst_offs = ((y * width_in_blocks) + x) * bpp;
            dst[dst_offs..dst_offs + bpp].copy_from_slice(&src[src_offs..src_offs + bpp]);
        }
    }

    dst
}
