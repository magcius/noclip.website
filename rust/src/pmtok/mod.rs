use std::{num::NonZeroU32};
use wasm_bindgen::prelude::*;
use tegra_swizzle::surface::{BlockDim, deswizzle_surface};
use texture2ddecoder::*;

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

#[wasm_bindgen(js_name = "PMTOKCompressedTextureFormat")]
pub enum CompressedTextureFormat {
    BC1,
    BC3,
    BC4,
    BC5,
    BC6H,
    BC6S,
    BC7,
    ASTC8x5,
    ASTC8x6,
    ASTC8x8
}

#[wasm_bindgen(js_name = "pmtok_decode_texture")]
pub fn decode_texture(src: &[u8], format: CompressedTextureFormat, width: usize, height: usize) -> Vec<u8> {
    let mut bgra32: Vec<u32> = vec![0u32; width * height];
    // ASTC formats work fine, some of the BC ones don't handle alpha correctly
    let _r: Result<(), &str> = match format {
        CompressedTextureFormat::BC1 => decode_bc1(src, width, height, &mut bgra32),
        CompressedTextureFormat::BC3 => decode_bc3(src, width, height, &mut bgra32),
        CompressedTextureFormat::BC4 => decode_bc4(src, width, height, &mut bgra32),
        CompressedTextureFormat::BC5 => decode_bc5(src, width, height, &mut bgra32),
        CompressedTextureFormat::BC6H => decode_bc6_unsigned(src, width, height, &mut bgra32),
        CompressedTextureFormat::BC6S => decode_bc6_signed(src, width, height, &mut bgra32),
        CompressedTextureFormat::BC7 => decode_bc7(src, width, height, &mut bgra32),
        CompressedTextureFormat::ASTC8x5 => decode_astc_8_5(src, width, height, &mut bgra32),
        CompressedTextureFormat::ASTC8x6 => decode_astc_8_6(src, width, height, &mut bgra32),
        CompressedTextureFormat::ASTC8x8 => decode_astc_8_8(src, width, height, &mut bgra32)
    };
    // convert from BGRA32 to RGBA8
    let rgba8: Vec<u8> = bgra32.iter().flat_map(|&p| [((p >> 16) & 0xff) as u8, ((p >> 8) & 0xff) as u8, (p & 0xff) as u8, ((p >> 24) & 0xff) as u8]).collect();
    rgba8
}
