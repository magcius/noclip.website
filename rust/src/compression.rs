use wasm_bindgen::prelude::wasm_bindgen;
use std::convert::TryInto;

#[wasm_bindgen]
pub fn lz4_decompress(src: &[u8], uncompressed_size: usize) -> Vec<u8> {
    lz4_flex::decompress(src, uncompressed_size).unwrap()
}

#[wasm_bindgen]
pub fn lzma_decompress(
    mut src: &[u8],
    lc: u32,
    lp: u32,
    pb: u32,
    dict_size: u32,
    unpacked_size: u64,
) -> Vec<u8> {
    let properties = lzma_rs::decompress::raw::LzmaProperties {
        lc: lc,
        lp: lp,
        pb: pb,
    };
    let params =
        lzma_rs::decompress::raw::LzmaParams::new(properties, dict_size, Some(unpacked_size));
    let mut decoder = lzma_rs::decompress::raw::LzmaDecoder::new(params, None).unwrap();
    let mut dst = Vec::<u8>::with_capacity(unpacked_size.try_into().unwrap());
    decoder.decompress(&mut src, &mut dst).unwrap();
    dst
}

#[wasm_bindgen]
pub fn deflate_decompress(src: &[u8]) -> Vec<u8> {
    inflate::inflate_bytes_zlib(src).unwrap()
}

#[wasm_bindgen]
pub fn deflate_raw_decompress(src: &[u8]) -> Vec<u8> {
    inflate::inflate_bytes(src).unwrap()
}

