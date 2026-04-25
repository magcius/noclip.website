use wasm_bindgen::prelude::*;
use texture2ddecoder::*;

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
    let mut rgba8: Vec<u8> = Vec::with_capacity(bgra32.len() * 4);
    for pixel in bgra32.iter() {
        let b: u8 = (pixel & 0xFF) as u8;
        let g: u8 = ((pixel >> 8) & 0xFF) as u8;
        let r: u8 = ((pixel >> 16) & 0xFF) as u8;
        let a: u8 = ((pixel >> 24) & 0xFF) as u8;
        rgba8.push(r);
        rgba8.push(g);
        rgba8.push(b);
        rgba8.push(a);
    }
    rgba8
}
