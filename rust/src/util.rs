use wasm_bindgen::prelude::*;

// http://www.mindcontrol.org/~hplus/graphics/expand-bits.html
pub fn expand_n_to_8(v: u8, n: u8) -> u8 {
    match v {
        3 => (n << (8 - 3)) | (n << (8 - 6)) | (n >> (9 - 8)),
        v if (v >= 4) => (n << (8 - v)) | (n >> ((v*2) - 8)),
        _ => unreachable!(),
    }
}

pub fn next_pow2(value: usize) -> usize {
    match value {
        0 => 1,
        mut v => {
            v -= 1;
            v |= v >> 1;
            v |= v >> 2;
            v |= v >> 4;
            v |= v >> 8;
            v |= v >> 16;
            v + 1
        }
    }
}

pub fn srgb_to_linear(value: u8) -> f32 {
    let value = (value as f32) / 255.0;
    if value <= 0.0404482362771082 {
        value / 12.92
    } else {
        ((value + 0.055)/1.055).powf(2.4)
    }
}

pub fn linear_to_srgb(value: f32) -> u8 {
    if value.is_nan() || value <= 0.0 {
        0
    } else if value >= 1.0 {
        255
    } else {
        let value = if value < 0.00313066844250063 {
            value * 12.92
        } else {
            value.powf(1.0/2.4) * 1.055 - 0.055
        };
        let value = value / 255.0;
        (value + 0.5) as u8
    }
}

pub type BlendFunction<T, U> = fn(T, T, U, U) -> T;

pub fn blend_srgb_u8(a: u8, b: u8, weight_a: u32, weight_b: u32) -> u8 {
    let a = srgb_to_linear(a);
    let b = srgb_to_linear(b);
    let v = (a * (weight_a as f32) + b * (weight_b as f32)) / ((weight_a as f32) + (weight_b as f32));
    linear_to_srgb(v)
}

pub fn blend_linear_u8(a: u8, b: u8, weight_a: u32, weight_b: u32) -> u8 {
    (((a as u32) * weight_a + (b as u32) * weight_b) / (weight_a + weight_b)) as u8
}

pub fn blend_linear_i8(a: i8, b: i8, weight_a: i32, weight_b: i32) -> i8 {
    (((a as i32) * weight_a + (b as i32) * weight_b) / (weight_a + weight_b)) as i8
}

pub fn get_uint16_le(src: &[u8], offs: usize) -> u16 {
    (src[offs] as u16) | ((src[offs+1] as u16) << 8)
}

pub fn get_uint24_le(src: &[u8], offs: usize) -> u32 {
    (src[offs] as u32) | ((src[offs+1] as u32) << 8) | ((src[offs+1] as u32) << 16)
}

pub fn get_uint32_le(src: &[u8], offs: usize) -> u32 {
    (src[offs] as u32) | ((src[offs+1] as u32) << 8) | ((src[offs+1] as u32) << 16) | ((src[offs+1] as u32) << 24)
}

pub fn get_uint16_be(src: &[u8], offs: usize) -> u16 {
    ((src[offs] as u16) << 8) | (src[offs+1] as u16)
}

pub fn get_uint24_be(src: &[u8], offs: usize) -> u32 {
    ((src[offs] as u32) << 16) | ((src[offs+1] as u32) << 8) | (src[offs+1] as u32)
}

pub fn get_uint32_be(src: &[u8], offs: usize) -> u32 {
    ((src[offs] as u32) << 24) | ((src[offs+1] as u32) << 16) | ((src[offs+1] as u32) << 8) | (src[offs+1] as u32)
}

#[wasm_bindgen]
extern "C" {
    // Use `js_namespace` here to bind `console.log(..)` instead of just
    // `log(..)`
    #[wasm_bindgen(js_namespace = console)]
    pub fn log(s: &str);
}
