use wasm_bindgen::prelude::*;

const GOB_SIZE_X: usize = 64;
const GOB_SIZE_Y: usize = 8;

#[wasm_bindgen]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ChannelFormat {
    Undefined,
    R4G4,
    R8,
    R4G4B4A4,
    A4B4G4R4,
    R5G5B5A1,
    A1B5G5R5,
    R5G6B5,
    B5G6R5,
    R8G8,
    R16,
    R8G8B8A8,
    B8G8R8A8,
    R9G9B9E5,
    R10G10B10A2,
    R11G11B10,
    B10G11R11,
    R10G11B11,
    R16G16,
    R24G8,
    R32,
    R16G16B16A16,
    R32G8X24,
    R32G32,
    R32G32B32,
    R32G32B32A32,
    Bc1,
    Bc2,
    Bc3,
    Bc4,
    Bc5,
    Bc6,
    Bc7,
    EacR11,
    EacR11G11,
    Etc1,
    Etc2,
    Etc2Mask,
    Etc2Alpha,
    Pvrtc12Bpp,
    Pvrtc14Bpp,
    Pvrtc1Alpha2Bpp,
    Pvrtc1Alpha4Bpp,
    Pvrtc2Alpha2Bpp,
    Pvrtc2Alpha4Bpp,
    Astc4x4,
    Astc5x4,
    Astc5x5,
    Astc6x5,
    Astc6x6,
    Astc8x5,
    Astc8x6,
    Astc8x8,
    Astc10x5,
    Astc10x6,
    Astc10x8,
    Astc10x10,
    Astc12x10,
    Astc12x12,
    B5G5R5A1,
}

fn get_format_block_width(channel_format: ChannelFormat) -> usize {
    use ChannelFormat::*;
    match channel_format {
        Bc1 | Bc2 | Bc3 | Bc4 | Bc5 | Bc6 | Bc7| Astc4x4 => 4,
        Astc5x4 | Astc5x5 => 5,
        Astc6x5 | Astc6x6 => 6,
        Astc8x5 | Astc8x6 | Astc8x8 => 8,
        Astc10x5 | Astc10x6 | Astc10x8 | Astc10x10 => 10,
        Astc12x10 | Astc12x12 => 12,
        _ => 1,
    }
}

fn get_format_block_height(channel_format: ChannelFormat) -> usize {
    use ChannelFormat::*;
    match channel_format {
        Bc1 | Bc2 | Bc3 | Bc4 | Bc5 | Bc6 | Bc7 | Astc4x4 | Astc5x4 => 4,
        Astc5x5 | Astc6x5 | Astc8x5 | Astc10x5 => 5,
        Astc6x6 | Astc8x6 | Astc10x6 => 6,
        Astc8x8 | Astc10x8 => 8,
        Astc10x10 | Astc12x10 => 10,
        Astc12x12 => 12,
        _ => 1,
    }
}

fn get_format_bytes_per_pixel(channel_format: ChannelFormat) -> usize {
    use ChannelFormat::*;
    match channel_format {
        Bc1 | Bc4 => 8,
        Bc2 | Bc3 | Bc5 => 16,
        R8G8B8A8 | B8G8R8A8 => 4,
        _ => panic!("whoops"),
    }
}

fn get_addr_block_linear(mut x: usize, y: usize, w: usize, bpp: usize, block_height: usize, base_addr: usize) -> usize {
    let width_in_gobs = ((w * bpp) + GOB_SIZE_X - 1) / GOB_SIZE_X;
    let mut gob_addr = base_addr;

    gob_addr += ((y / (GOB_SIZE_Y * block_height)) | 0) * 512 * block_height * width_in_gobs;
    gob_addr += ((x * bpp / 64) | 0) * 512 * block_height;
    gob_addr += ((y % (GOB_SIZE_Y * block_height) / 8) | 0) * 512;

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
pub fn deswizzle(
    width: usize,
    height: usize,
    channel_format: ChannelFormat,
    src: &[u8],
    block_height_log2: usize,
) -> Vec<u8> {
    let fmt_block_w = get_format_block_width(channel_format);
    let fmt_block_h = get_format_block_height(channel_format);
    let width_in_blocks = (width + fmt_block_w - 1) / fmt_block_w;
    let height_in_blocks = (height + fmt_block_h - 1) / fmt_block_h;
    let mut block_height = 1 << block_height_log2;
    while block_height > 1 && (next_pow2(height_in_blocks) < (GOB_SIZE_Y * block_height)) {
        block_height >>= 1;
    }
    let bpp = get_format_bytes_per_pixel(channel_format);
    let mut dst = Vec::with_capacity(width_in_blocks * height_in_blocks * bpp);
    for y in 0..height_in_blocks {
        for x in 0..width_in_blocks {
            let src_offs = get_addr_block_linear(x, y, width_in_blocks, bpp, block_height, 0);
            dst.extend_from_slice(&src[src_offs..(src_offs + bpp)]);
        }
    }
    dst
}

fn next_pow2(mut v: usize) -> usize {
    v -= 1;
    v |= v >> 1;
    v |= v >> 2;
    v |= v >> 4;
    v |= v >> 8;
    v |= v >> 16;
    v + 1
}