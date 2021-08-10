use std::mem;

// http://www.mindcontrol.org/~hplus/graphics/expand-bits.html
pub fn expand_n_to_8(v: u8, n: u8) -> u8 {
    match v {
        3 => (n << (8 - 3)) | (n << (8 - 6)) | (n >> (9 - 8)),
        v if (v >= 4) => (n << (8 - v)) | (n >> ((v*2) - 8)),
        _ => unreachable!(),
    }
}

pub fn next_pow2(mut v: usize) -> usize {
    v -= 1;
    v |= v >> 1;
    v |= v >> 2;
    v |= v >> 4;
    v |= v >> 8;
    v |= v >> 16;
    v + 1
}

// #region Texture Decode
pub fn expand4to8(n: u8) -> u8 {
    (n << (8 - 4)) | (n >> (8 - 8))
}

pub fn expand5to8(n: u8) -> u8 {
    (n << (8 - 5)) | (n >> (10 - 8))
}

pub fn expand6to8(n: u8) -> u8 {
    (n << (8 - 6)) | (n >> (12 - 8))
}

pub fn halfblend(a: u8, b: u8) -> u8 {
    let a = a as u32;
    let b = b as u32;
    let ret = (a + b) >> 1;
    ret as u8
}

// Use the fast GX approximation.
pub fn s3tcblend(a: u8, b: u8) -> u8 {
    // return (a*3 + b*5) / 8;
    let a = a as u32;
    let b = b as u32;
    let ret = (((a << 1) + a) + ((b << 2) + b)) >> 3;
    ret as u8
}

pub unsafe fn unitialized_vec<T>(size: usize) -> Vec<T> {
    let mut vec = Vec::with_capacity(size);
    vec.set_len(size);
    vec
}

#[cfg(target_endian="little")]
pub fn get_uint16_le(src: &[u8], offs: usize) -> u16 {
    unsafe { *mem::transmute::<&u8, &u16>(&src[offs]) }
}

#[cfg(target_endian="little")]
pub fn get_uint24_le(src: &[u8], offs: usize) -> u32 {
    unsafe { *mem::transmute::<&u8, &u32>(&src[offs]) & 0x00FFFFFF }
}

#[cfg(target_endian="little")]
pub fn get_uint32_le(src: &[u8], offs: usize) -> u32 {
    unsafe { *mem::transmute::<&u8, &u32>(&src[offs]) }
}

#[cfg(target_endian="big")]
pub fn get_uint16_le(src: &[u8], offs: usize) -> u16 {
    (src[offs] as u16) | ((src[offs+1] as u16) << 8)
}

#[cfg(target_endian="big")]
pub fn get_uint24_le(src: &[u8], offs: usize) -> u32 {
    (src[offs] as u32) | ((src[offs+1] as u32) << 8) | ((src[offs+1] as u32) << 16)
}

#[cfg(target_endian="big")]
pub fn get_uint32_le(src: &[u8], offs: usize) -> u32 {
    (src[offs] as u32) | ((src[offs+1] as u32) << 8) | ((src[offs+1] as u32) << 16) | ((src[offs+1] as u32) << 24)
}

#[cfg(target_endian="big")]
pub fn get_uint16_be(src: &[u8], offs: usize) -> u16 {
    unsafe { *mem::transmute::<&u8, &u16>(&src[offs]) }
}

#[cfg(target_endian="big")]
pub fn get_uint24_be(src: &[u8], offs: usize) -> u32 {
    unsafe { *mem::transmute::<&u8, &u32>(&src[offs]) & 0x00FFFFFF }
}

#[cfg(target_endian="big")]
pub fn get_uint32_be(src: &[u8], offs: usize) -> u32 {
    unsafe { *mem::transmute::<&u8, &u32>(&src[offs]) }
}

#[cfg(target_endian="little")]
pub fn get_uint16_be(src: &[u8], offs: usize) -> u16 {
    ((src[offs] as u16) << 8) | (src[offs+1] as u16)
}

#[cfg(target_endian="little")]
pub fn get_uint24_be(src: &[u8], offs: usize) -> u32 {
    ((src[offs] as u32) << 16) | ((src[offs+1] as u32) << 8) | (src[offs+1] as u32)
}

#[cfg(target_endian="little")]
pub fn get_uint32_be(src: &[u8], offs: usize) -> u32 {
    ((src[offs] as u32) << 24) | ((src[offs+1] as u32) << 16) | ((src[offs+1] as u32) << 8) | (src[offs+1] as u32)
}