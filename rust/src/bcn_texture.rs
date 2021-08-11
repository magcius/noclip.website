use wasm_bindgen::prelude::*;
use crate::util;

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

const fn get_format_block_width(channel_format: ChannelFormat) -> usize {
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

const fn get_format_block_height(channel_format: ChannelFormat) -> usize {
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

const fn get_format_bytes_per_block(channel_format: ChannelFormat) -> usize {
    use ChannelFormat::*;
    match channel_format {
        Bc1 | Bc4 => 8,
        Bc2 | Bc3 | Bc5 => 16,
        R8G8B8A8 | B8G8R8A8 => 4,
        _ => 1,
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

fn calc_required_unswizzled_buffer_len(w: usize, h: usize, bpp: usize, block_height: usize) -> usize {
    let width_in_gobs = (w * bpp + GOB_SIZE_X - 1) / GOB_SIZE_X;
    let width = width_in_gobs * GOB_SIZE_X;
    let height_in_blocks = (h + GOB_SIZE_Y * block_height - 1) / (GOB_SIZE_Y * block_height);
    let height = height_in_blocks * GOB_SIZE_Y * block_height;
    width * height
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
    while block_height > 1 && (util::next_pow2(height_in_blocks) < (GOB_SIZE_Y * block_height)) {
        block_height >>= 1;
    }
    let bpp = get_format_bytes_per_block(channel_format);
    let mut dst = Vec::with_capacity(width_in_blocks * height_in_blocks * bpp);
    for y in 0..height_in_blocks {
        for x in 0..width_in_blocks {
            let src_offs = get_addr_block_linear(x, y, width_in_blocks, bpp, block_height, 0);
            dst.extend_from_slice(&src[src_offs..(src_offs + bpp)]);
        }
    }
    dst
}

fn color_table_bc1(color_table: &mut [[u8; 4]; 4], color1: u16, color2: u16) {
    // Fill in first two colors in color table.
    // TODO(jstpierre): SRGB-correct blending.
    color_table[0] = [
        util::expand5to8(((color1 >> 11) & 0x1F) as u8),
        util::expand6to8(((color1 >> 5) & 0x3F) as u8),
        util::expand5to8((color1 & 0x1F) as u8),
        0xFF,
    ];
    color_table[1] = [
        util::expand5to8(((color2 >> 11) & 0x1F) as u8),
        util::expand6to8(((color2 >> 5) & 0x3F) as u8),
        util::expand5to8((color2 & 0x1F) as u8),
        0xFF
    ];
    if color1 > color2 {
        // Predict gradients.
        color_table[2] = [
            util::s3tcblend(color_table[1][0], color_table[0][0]),
            util::s3tcblend(color_table[1][1], color_table[0][1]),
            util::s3tcblend(color_table[1][2], color_table[0][2]),
            0xFF,
        ];
        color_table[3] = [
            util::s3tcblend(color_table[0][0], color_table[1][0]),
            util::s3tcblend(color_table[0][1], color_table[1][1]),
            util::s3tcblend(color_table[0][2], color_table[1][2]),
            0xFF
        ];
    } else {
        color_table[2] = [
            ((color_table[0][0] as u16 + color_table[1][0] as u16) >> 1) as u8,
            ((color_table[0][1] as u16 + color_table[1][1] as u16) >> 1) as u8,
            ((color_table[0][2] as u16 + color_table[1][2] as u16) >> 1) as u8,
            0xFF,
        ];
        color_table[3] = [
            0x00,
            0x00,
            0x00,
            0x00,
        ];
    }
}

#[wasm_bindgen]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum SurfaceFlag {
    Srgb,
    UNorm,
    SNorm,
}

#[derive(Clone)]
pub struct SurfaceMetaData {
    flag: SurfaceFlag,
    width: usize,
    height: usize,
    depth: usize,
    block_height_log2: usize,
}

pub struct SurfaceDataUnsigned {
    // meta: SurfaceMetaData,
    pixels: Vec<u8>,
}

pub struct SurfaceDataSigned {
    // meta: SurfaceMetaData,
    pixels: Vec<i8>,
}

#[wasm_bindgen]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum BCNType {
    BC1,
    BC2,
    BC3,
    BC4,
    BC5,
}

// Software decompresses from standard BC1 (DXT1) to RGBA.
fn decompress_bc1_surface_deswizzle(surface: &SurfaceMetaData, src: &[u8]) -> SurfaceDataUnsigned {
    const BLOCK_W: usize = get_format_block_width(ChannelFormat::Bc1);
    const BLOCK_H: usize = get_format_block_height(ChannelFormat::Bc1);
    const INPUT_BYTES_PER_CHUNK: usize = get_format_bytes_per_block(ChannelFormat::Bc1);
    const OUTPUT_BYTES_PER_PIXEL: usize = 4;
    let width = surface.width;
    let height = surface.height;
    let depth = surface.depth;
    let tall = height * depth;
    let width_in_blocks = (width + BLOCK_W - 1) / BLOCK_W;
    let height_in_blocks = (tall + BLOCK_H - 1) / BLOCK_H;
    let mut block_height = 1 << surface.block_height_log2;
    while block_height > 1 && (util::next_pow2(height_in_blocks) < (GOB_SIZE_Y * block_height)) {
        block_height >>= 1;
    }
    if src.len() != calc_required_unswizzled_buffer_len(width_in_blocks, height_in_blocks, INPUT_BYTES_PER_CHUNK, block_height) {
        panic!("BC1: Given source size does not match provided metadata.");
    }
    let mut dst = unsafe { util::unitialized_vec(width * tall * OUTPUT_BYTES_PER_PIXEL) };
    let mut color_table = [[0u8; 4]; 4];
    for block_y in 0..height_in_blocks {
        for block_x in 0..width_in_blocks {
            let src_offs = get_addr_block_linear(block_x, block_y, width_in_blocks, INPUT_BYTES_PER_CHUNK, block_height, 0);
            let color1 = util::get_uint16_le(src, src_offs);
            let color2 = util::get_uint16_le(src, src_offs + 2);
            color_table_bc1(&mut color_table, color1, color2);
            let mut colorbits = util::get_uint32_le(src, src_offs + 4);
            for iy in 0..usize::min(4, tall-block_y*4) {
                for ix in 0..usize::min(4, width-block_x*4) {
                    let dst_px = (block_y*4 + iy) * width + block_x*4 + ix;
                    let dst_offs = dst_px * 4;
                    let color_idx = colorbits as usize & 0x03;
                    dst[dst_offs + 0] = color_table[color_idx][0];
                    dst[dst_offs + 1] = color_table[color_idx][1];
                    dst[dst_offs + 2] = color_table[color_idx][2];
                    dst[dst_offs + 3] = color_table[color_idx][3];
                    colorbits >>= 2;
                }
            }
        }
    }
    SurfaceDataUnsigned {
        pixels: dst,
    }
}

// Software decompresses from standard BC2 (DXT3) to RGBA.
fn decompress_bc2_surface_deswizzle(surface: &SurfaceMetaData, src: &[u8]) -> SurfaceDataUnsigned {
    const BLOCK_W: usize = get_format_block_width(ChannelFormat::Bc2);
    const BLOCK_H: usize = get_format_block_height(ChannelFormat::Bc2);
    const INPUT_BYTES_PER_CHUNK: usize = get_format_bytes_per_block(ChannelFormat::Bc2);
    const OUTPUT_BYTES_PER_PIXEL: usize = 4;
    let width = surface.width;
    let height = surface.height;
    let depth = surface.depth;
    let tall = height * depth;
    let width_in_blocks = (width + BLOCK_W - 1) / BLOCK_W;
    let height_in_blocks = (tall + BLOCK_H - 1) / BLOCK_H;
    let mut block_height = 1 << surface.block_height_log2;
    while block_height > 1 && (util::next_pow2(height_in_blocks) < (GOB_SIZE_Y * block_height)) {
        block_height >>= 1;
    }
    if src.len() != calc_required_unswizzled_buffer_len(width_in_blocks, height_in_blocks, INPUT_BYTES_PER_CHUNK, block_height) {
        panic!("BC2: Given source size does not match provided metadata.");
    }
    let mut dst = unsafe { util::unitialized_vec(width * tall * OUTPUT_BYTES_PER_PIXEL) };
    let mut color_table = [[0u8; 4]; 4];
    for block_y in 0..height_in_blocks {
        for block_x in 0..width_in_blocks {
            let src_offs = get_addr_block_linear(block_x, block_y, width_in_blocks, INPUT_BYTES_PER_CHUNK, block_height, 0);
            let alphabits1 = util::get_uint32_le(src, src_offs);
            let alphabits2 = util::get_uint32_le(src, src_offs + 4);
            let color1 = util::get_uint16_le(src, src_offs + 8);
            let color2 = util::get_uint16_le(src, src_offs + 10);
            color_table_bc1(&mut color_table, color1, color2);
            let mut colorbits = util::get_uint32_le(src, src_offs + 12);
            for iy in 0..usize::min(2, tall-block_y*4) {
                for ix in 0..usize::min(4, width-block_x*4) {
                    let dst_px = (block_y*4 + iy) * width + block_x*4 + ix;
                    let dst_offs = dst_px * 4;
                    let color_idx = colorbits as usize & 0x03;
                    let shift = (iy * 4 + ix) * 4;
                    let alpha = ((alphabits1 >> shift) & 0x0F) as u8;
                    dst[dst_offs + 0] = color_table[color_idx][0];
                    dst[dst_offs + 1] = color_table[color_idx][1];
                    dst[dst_offs + 2] = color_table[color_idx][2];
                    dst[dst_offs + 3] = util::expand4to8(alpha);
                    colorbits >>= 2;
                }
            }
            for iy in 2..usize::min(4, tall-block_y*4) {
                for ix in 0..usize::min(4, width-block_x*4) {
                    let dst_px = (block_y*4 + iy) * width + block_x*4 + ix;
                    let dst_offs = dst_px * 4;
                    let color_idx = colorbits as usize & 0x03;
                    let shift = (iy * 4 + ix) * 4 - 32;
                    let alpha = ((alphabits2 >> shift) & 0x0F) as u8;
                    dst[dst_offs + 0] = color_table[color_idx][0];
                    dst[dst_offs + 1] = color_table[color_idx][1];
                    dst[dst_offs + 2] = color_table[color_idx][2];
                    dst[dst_offs + 3] = util::expand4to8(alpha);
                    colorbits >>= 2;
                }
            }
        }
    }
    SurfaceDataUnsigned {
        pixels: dst,
    }
}

// Software decompresses from standard BC3 (DXT5) to RGBA.
fn decompress_bc3_surface_deswizzle(surface: &SurfaceMetaData, src: &[u8]) -> SurfaceDataUnsigned {
    const BLOCK_W: usize = get_format_block_width(ChannelFormat::Bc3);
    const BLOCK_H: usize = get_format_block_height(ChannelFormat::Bc3);
    const INPUT_BYTES_PER_CHUNK: usize = get_format_bytes_per_block(ChannelFormat::Bc3);
    const OUTPUT_BYTES_PER_PIXEL: usize = 4;
    let width = surface.width;
    let height = surface.height;
    let depth = surface.depth;
    let tall = height * depth;
    let width_in_blocks = (width + BLOCK_W - 1) / BLOCK_W;
    let height_in_blocks = (tall + BLOCK_H - 1) / BLOCK_H;
    let mut block_height = 1 << surface.block_height_log2;
    while block_height > 1 && (util::next_pow2(height_in_blocks) < (GOB_SIZE_Y * block_height)) {
        block_height >>= 1;
    }
    if src.len() != calc_required_unswizzled_buffer_len(width_in_blocks, height_in_blocks, INPUT_BYTES_PER_CHUNK, block_height) {
        panic!("BC3: Given source size does not match provided metadata.");
    }
    let mut dst = unsafe { util::unitialized_vec(width * tall * OUTPUT_BYTES_PER_PIXEL) };
    let mut color_table = [[0u8; 4]; 4];
    let mut alpha_table = [0u8; 8];
    for block_y in 0..height_in_blocks {
        for block_x in 0..width_in_blocks {
            let src_offs = get_addr_block_linear(block_x, block_y, width_in_blocks, INPUT_BYTES_PER_CHUNK, block_height, 0);
            let alpha1 = src[src_offs] as u16;
            let alpha2 = src[src_offs + 1] as u16;
            alpha_table[0] = alpha1 as u8;
            alpha_table[1] = alpha2 as u8;
            if alpha1 > alpha2 {
                alpha_table[2] = ((6 * alpha1 + 1 * alpha2) / 7) as u8;
                alpha_table[3] = ((5 * alpha1 + 2 * alpha2) / 7) as u8;
                alpha_table[4] = ((4 * alpha1 + 3 * alpha2) / 7) as u8;
                alpha_table[5] = ((3 * alpha1 + 4 * alpha2) / 7) as u8;
                alpha_table[6] = ((2 * alpha1 + 5 * alpha2) / 7) as u8;
                alpha_table[7] = ((1 * alpha1 + 6 * alpha2) / 7) as u8;
            } else {
                alpha_table[2] = ((4 * alpha1 + 1 * alpha2) / 5) as u8;
                alpha_table[3] = ((3 * alpha1 + 2 * alpha2) / 5) as u8;
                alpha_table[4] = ((2 * alpha1 + 3 * alpha2) / 5) as u8;
                alpha_table[5] = ((1 * alpha1 + 4 * alpha2) / 5) as u8;
                alpha_table[6] = 0;
                alpha_table[7] = 255;
            }
            let alphabits1 = util::get_uint24_le(src, src_offs + 2);
            let alphabits2 = util::get_uint24_le(src, src_offs + 5);
            let color1 = util::get_uint16_le(src, src_offs + 8);
            let color2 = util::get_uint16_le(src, src_offs + 10);
            color_table_bc1(&mut color_table, color1, color2);
            let mut colorbits = util::get_uint32_le(src, src_offs + 12);
            for iy in 0..usize::min(2, tall-block_y*4) {
                for ix in 0..usize::min(4, width-block_x*4) {
                    let dst_px = (block_y*4 + iy) * width + block_x*4 + ix;
                    let dst_offs = dst_px * 4;
                    let color_idx = colorbits as usize & 0x03;
                    let shift = (iy * 4 + ix) * 3;
                    let index = (alphabits1 >> shift) & 0x07;
                    dst[dst_offs + 0] = color_table[color_idx][0];
                    dst[dst_offs + 1] = color_table[color_idx][1];
                    dst[dst_offs + 2] = color_table[color_idx][2];
                    dst[dst_offs + 3] = alpha_table[index as usize];
                    colorbits >>= 2;
                }
            }
            for iy in 2..usize::min(4, tall-block_y*4) {
                for ix in 0..usize::min(4, width-block_x*4) {
                    let dst_px = (block_y*4 + iy) * width + block_x*4 + ix;
                    let dst_offs = dst_px * 4;
                    let color_idx = colorbits as usize & 0x03;
                    let shift = (iy * 4 + ix) * 3 - 24;
                    let index = (alphabits2 >> shift) & 0x07;
                    dst[dst_offs + 0] = color_table[color_idx][0];
                    dst[dst_offs + 1] = color_table[color_idx][1];
                    dst[dst_offs + 2] = color_table[color_idx][2];
                    dst[dst_offs + 3] = alpha_table[index as usize];
                    colorbits >>= 2;
                }
            }
        }
    }
    SurfaceDataUnsigned {
        pixels: dst,
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum BC45DecompressType {
    BC4,
    BC5,
}

pub enum BC45DecompressResult {
    UNorm(SurfaceDataUnsigned),
    SNorm(SurfaceDataSigned),
}

fn decompress_bc45_surface_unorm_deswizzle(surface: &SurfaceMetaData, src: &[u8], bctype: BC45DecompressType) -> SurfaceDataUnsigned {
    let channel_format = if bctype == BC45DecompressType::BC4 { ChannelFormat::Bc4 } else { ChannelFormat::Bc5 };
    let block_w = get_format_block_width(channel_format);
    let block_h = get_format_block_height(channel_format);
    let input_bytes_per_chunk = get_format_bytes_per_block(channel_format);
    const OUTPUT_BYTES_PER_PIXEL: usize = 4;
    let input_num_channels = if bctype == BC45DecompressType::BC4 { 1 } else { 2 };
    let width = surface.width;
    let height = surface.height;
    let depth = surface.depth;
    let tall = height * depth;
    let width_in_blocks = (width + block_w - 1) / block_w;
    let height_in_blocks = (tall + block_h - 1) / block_h;
    let mut block_height = 1 << surface.block_height_log2;
    while block_height > 1 && (util::next_pow2(height_in_blocks) < (GOB_SIZE_Y * block_height)) {
        block_height >>= 1;
    }
    if src.len() != calc_required_unswizzled_buffer_len(width_in_blocks, height_in_blocks, input_bytes_per_chunk, block_height) {
        panic!("BC45 UNORM: Given source size does not match provided metadata.");
    }
    let mut dst = unsafe { util::unitialized_vec(width * tall * OUTPUT_BYTES_PER_PIXEL) };
    let mut color_table = [0u8; 8];
    for block_y in 0..height_in_blocks {
        for block_x in 0..width_in_blocks {
            let src_offs = get_addr_block_linear(block_x, block_y, width_in_blocks, input_bytes_per_chunk, block_height, 0);
            for ch in 0..input_num_channels {
                let src_offs = src_offs + ch * 8;

                let red1 = src[src_offs] as u16;
                let red2 = src[src_offs + 1] as u16;

                color_table[0] = red1 as u8;
                color_table[1] = red2 as u8;
                if red1 > red2 {
                    color_table[2] = ((6 * red1 + 1 * red2) / 7) as u8;
                    color_table[3] = ((5 * red1 + 2 * red2) / 7) as u8;
                    color_table[4] = ((4 * red1 + 3 * red2) / 7) as u8;
                    color_table[5] = ((3 * red1 + 4 * red2) / 7) as u8;
                    color_table[6] = ((2 * red1 + 5 * red2) / 7) as u8;
                    color_table[7] = ((1 * red1 + 6 * red2) / 7) as u8;
                } else {
                    color_table[2] = ((4 * red1 + 1 * red2) / 5) as u8;
                    color_table[3] = ((3 * red1 + 2 * red2) / 5) as u8;
                    color_table[4] = ((2 * red1 + 3 * red2) / 5) as u8;
                    color_table[5] = ((1 * red1 + 4 * red2) / 5) as u8;
                    color_table[6] = 0;
                    color_table[7] = 255;
                }
                let colorbits1 = util::get_uint24_le(src, src_offs + 2);
                let colorbits2 = util::get_uint24_le(src, src_offs + 5);
                for iy in 0..usize::min(2, tall-block_y*4) {
                    for ix in 0..usize::min(4, width-block_x*4) {
                        let dst_px = (block_y * 4 + iy) * width + block_x * 4 + ix;
                        let dst_offs = dst_px * OUTPUT_BYTES_PER_PIXEL;
                        let shift = (iy * 4 + ix) * 3;
                        let index = (colorbits1 >> shift) & 0x07;
                        if input_num_channels == 1 {
                            dst[dst_offs + 0] = color_table[index as usize];
                            dst[dst_offs + 1] = color_table[index as usize];
                            dst[dst_offs + 2] = color_table[index as usize];
                            dst[dst_offs + 3] = color_table[index as usize];
                        } else {
                            if ch == 0 {
                                dst[dst_offs + 0] = color_table[index as usize];
                            } else if ch == 1 {
                                dst[dst_offs + 1] = color_table[index as usize];
                                dst[dst_offs + 2] = 255;
                                dst[dst_offs + 3] = 255;
                            }
                        }
                    }
                }
                for iy in 2..usize::min(4, tall-block_y*4) {
                    for ix in 0..usize::min(4, width-block_x*4) {
                        let dst_px = (block_y * 4 + iy) * width + block_x * 4 + ix;
                        let dst_offs = dst_px * OUTPUT_BYTES_PER_PIXEL;
                        let shift = (iy * 4 + ix) * 3 - 24;
                        let index = (colorbits2 >> shift) & 0x07;
                        if input_num_channels == 1 {
                            dst[dst_offs + 0] = color_table[index as usize];
                            dst[dst_offs + 1] = color_table[index as usize];
                            dst[dst_offs + 2] = color_table[index as usize];
                            dst[dst_offs + 3] = color_table[index as usize];
                        } else {
                            if ch == 0 {
                                dst[dst_offs + 0] = color_table[index as usize];
                            } else if ch == 1 {
                                dst[dst_offs + 1] = color_table[index as usize];
                                dst[dst_offs + 2] = 255;
                                dst[dst_offs + 3] = 255;
                            }
                        }
                    }
                }
            }
        }
    }
    SurfaceDataUnsigned {
        pixels: dst,
    }
}

fn decompress_bc45_surface_snorm_deswizzle(surface: &SurfaceMetaData, src: &[u8], bctype: BC45DecompressType) -> SurfaceDataSigned {
    let channel_format = if bctype == BC45DecompressType::BC4 { ChannelFormat::Bc4 } else { ChannelFormat::Bc5 };
    let block_w = get_format_block_width(channel_format);
    let block_h = get_format_block_height(channel_format);
    let input_bytes_per_chunk = get_format_bytes_per_block(channel_format);
    const OUTPUT_BYTES_PER_PIXEL: usize = 4;
    let input_num_channels = if bctype == BC45DecompressType::BC4 { 1 } else { 2 };
    let width = surface.width;
    let height = surface.height;
    let depth = surface.depth;
    let tall = height * depth;
    let width_in_blocks = (width + block_w - 1) / block_w;
    let height_in_blocks = (tall + block_h - 1) / block_h;
    let mut block_height = 1 << surface.block_height_log2;
    while block_height > 1 && (util::next_pow2(height_in_blocks) < (GOB_SIZE_Y * block_height)) {
        block_height >>= 1;
    }
    if src.len() != calc_required_unswizzled_buffer_len(width_in_blocks, height_in_blocks, input_bytes_per_chunk, block_height) {
        panic!("BC45 SNORM: Given source size does not match provided metadata.");
    }
    let mut dst = unsafe { util::unitialized_vec(width * tall * OUTPUT_BYTES_PER_PIXEL) };
    let mut color_table = [0i8; 8];
    for block_y in 0..height_in_blocks {
        for block_x in 0..width_in_blocks {
            let src_offs = get_addr_block_linear(block_x, block_y, width_in_blocks, input_bytes_per_chunk, block_height, 0);
            for ch in 0..input_num_channels {
                let src_offs = src_offs + ch * 8;

                let (red1, red2) = unsafe {
                    use std::mem::transmute_copy;
                    (
                        transmute_copy::<u8, i8>(&src[src_offs]) as i16,
                        transmute_copy::<u8, i8>(&src[src_offs + 1]) as i16,
                    )
                };

                color_table[0] = red1 as i8;
                color_table[1] = red2 as i8;
                if red1 > red2 {
                    color_table[2] = ((6 * red1 + 1 * red2) / 7) as i8;
                    color_table[3] = ((5 * red1 + 2 * red2) / 7) as i8;
                    color_table[4] = ((4 * red1 + 3 * red2) / 7) as i8;
                    color_table[5] = ((3 * red1 + 4 * red2) / 7) as i8;
                    color_table[6] = ((2 * red1 + 5 * red2) / 7) as i8;
                    color_table[7] = ((1 * red1 + 6 * red2) / 7) as i8;
                } else {
                    color_table[2] = ((4 * red1 + 1 * red2) / 5) as i8;
                    color_table[3] = ((3 * red1 + 2 * red2) / 5) as i8;
                    color_table[4] = ((2 * red1 + 3 * red2) / 5) as i8;
                    color_table[5] = ((1 * red1 + 4 * red2) / 5) as i8;
                    color_table[6] = -128;
                    color_table[7] = 127;
                }
                let colorbits1 = util::get_uint24_le(src, src_offs + 2);
                let colorbits2 = util::get_uint24_le(src, src_offs + 5);
                for iy in 0..usize::min(2, tall-block_y*4) {
                    for ix in 0..usize::min(4, width-block_x*4) {
                        let dst_px = (block_y * 4 + iy) * width + block_x * 4 + ix;
                        let dst_offs = dst_px * OUTPUT_BYTES_PER_PIXEL;
                        let shift = (iy * 4 + ix) * 3;
                        let index = (colorbits1 >> shift) & 0x07;
                        if input_num_channels == 1 {
                            dst[dst_offs + 0] = color_table[index as usize];
                            dst[dst_offs + 1] = color_table[index as usize];
                            dst[dst_offs + 2] = color_table[index as usize];
                            dst[dst_offs + 3] = color_table[index as usize];
                        } else {
                            if ch == 0 {
                                dst[dst_offs + 0] = color_table[index as usize];
                            } else if ch == 1 {
                                dst[dst_offs + 1] = color_table[index as usize];
                                dst[dst_offs + 2] = 127;
                                dst[dst_offs + 3] = 127;
                            }
                        }
                    }
                }
                for iy in 2..usize::min(4, tall-block_y*4) {
                    for ix in 0..usize::min(4, width-block_x*4) {
                        let dst_px = (block_y * 4 + iy) * width + block_x * 4 + ix;
                        let dst_offs = dst_px * OUTPUT_BYTES_PER_PIXEL;
                        let shift = (iy * 4 + ix) * 3 - 24;
                        let index = (colorbits2 >> shift) & 0x07;
                        if input_num_channels == 1 {
                            dst[dst_offs + 0] = color_table[index as usize];
                            dst[dst_offs + 1] = color_table[index as usize];
                            dst[dst_offs + 2] = color_table[index as usize];
                            dst[dst_offs + 3] = color_table[index as usize];
                        } else {
                            if ch == 0 {
                                dst[dst_offs + 0] = color_table[index as usize];
                            } else if ch == 1 {
                                dst[dst_offs + 1] = color_table[index as usize];
                                dst[dst_offs + 2] = 127;
                                dst[dst_offs + 3] = 127;
                            }
                        }
                    }
                }
            }
        }
    }
    SurfaceDataSigned {
        pixels: dst
    }
}

#[wasm_bindgen]
pub fn decompress_bcn_deswizzle(
    bcntype: BCNType,
    flag: SurfaceFlag,
    width: usize,
    height: usize,
    depth: usize,
    src: &[u8],
    block_height_log2: usize,
) -> Vec<u8> {
    let meta = SurfaceMetaData {
        flag,
        width,
        height,
        depth,
        block_height_log2,
    };
    match bcntype {
        BCNType::BC1 => decompress_bc1_surface_deswizzle(&meta, src).pixels,
        BCNType::BC2 => decompress_bc2_surface_deswizzle(&meta, src).pixels,
        BCNType::BC3 => decompress_bc3_surface_deswizzle(&meta, src).pixels,
        BCNType::BC4 => decompress_bc45_surface_unorm_deswizzle(&meta, src, BC45DecompressType::BC4).pixels,
        BCNType::BC5 => decompress_bc45_surface_unorm_deswizzle(&meta, src, BC45DecompressType::BC5).pixels,
    }
}

#[wasm_bindgen]
pub fn decompress_bcn_snorm_deswizzle(
    bcntype: BCNType,
    flag: SurfaceFlag,
    width: usize,
    height: usize,
    depth: usize,
    src: &[u8],
    block_height_log2: usize,
) -> Vec<i8> {
    let meta = SurfaceMetaData {
        flag,
        width,
        height,
        depth,
        block_height_log2,
    };
    match bcntype {
        BCNType::BC4 => decompress_bc45_surface_snorm_deswizzle(&meta, src, BC45DecompressType::BC4).pixels,
        BCNType::BC5 => decompress_bc45_surface_snorm_deswizzle(&meta, src, BC45DecompressType::BC5).pixels,
        _ => panic!(),
    }
}