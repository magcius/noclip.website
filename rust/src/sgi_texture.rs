use crate::util;
use wasm_bindgen::prelude::wasm_bindgen;

/// SGI image dimensions returned from header validation
#[wasm_bindgen]
pub struct SgiDimensions {
    pub width: u32,
    pub height: u32,
}

/// Decode SGI RGB format image to RGBA.
///
/// SGI RGB is a simple image format from Silicon Graphics.
/// This decoder supports both verbatim (uncompressed) and RLE compressed images.
/// Only 8-bit per channel images are supported.
///
/// Returns RGBA pixel data in top-to-bottom, left-to-right order.
#[wasm_bindgen]
pub fn decode_sgi(src: &[u8]) -> Result<Vec<u8>, String> {
    if src.len() < 512 {
        return Err("SGI data too small for header".to_string());
    }

    // Read header (512 bytes)
    let magic = util::get_uint16_be(src, 0);
    if magic != 474 {
        return Err(format!("Invalid SGI magic number: {}", magic));
    }

    let storage = src[2]; // 0 = verbatim, 1 = RLE
    let bpc = src[3]; // Bytes per channel (1 or 2)
    let _dimension = util::get_uint16_be(src, 4);
    let width = util::get_uint16_be(src, 6) as usize;
    let height = util::get_uint16_be(src, 8) as usize;
    let channels = util::get_uint16_be(src, 10) as usize;

    if bpc != 1 {
        return Err("SGI 16-bit images not supported".to_string());
    }

    if width == 0 || height == 0 {
        return Err("SGI image has zero dimensions".to_string());
    }

    if channels == 0 || channels > 4 {
        return Err(format!("SGI invalid channel count: {}", channels));
    }

    let pixel_count = width * height;

    // Decode image data (channel-by-channel, planar format)
    let channel_data = if storage == 0 {
        decode_verbatim(src, width, height, channels)?
    } else {
        decode_rle(src, width, height, channels)?
    };

    // Convert to RGBA
    let mut result = vec![0u8; pixel_count * 4];

    match channels {
        1 => {
            // Grayscale
            for i in 0..pixel_count {
                let v = channel_data[i];
                result[i * 4 + 0] = v;
                result[i * 4 + 1] = v;
                result[i * 4 + 2] = v;
                result[i * 4 + 3] = v;
            }
        }
        2 => {
            // Grayscale + Alpha
            for i in 0..pixel_count {
                let v = channel_data[i];
                let a = channel_data[pixel_count + i];
                result[i * 4 + 0] = v;
                result[i * 4 + 1] = v;
                result[i * 4 + 2] = v;
                result[i * 4 + 3] = a;
            }
        }
        3 => {
            // RGB
            for i in 0..pixel_count {
                result[i * 4 + 0] = channel_data[i];
                result[i * 4 + 1] = channel_data[pixel_count + i];
                result[i * 4 + 2] = channel_data[pixel_count * 2 + i];
                result[i * 4 + 3] = 255;
            }
        }
        4 => {
            // RGBA
            for i in 0..pixel_count {
                result[i * 4 + 0] = channel_data[i];
                result[i * 4 + 1] = channel_data[pixel_count + i];
                result[i * 4 + 2] = channel_data[pixel_count * 2 + i];
                result[i * 4 + 3] = channel_data[pixel_count * 3 + i];
            }
        }
        _ => unreachable!(),
    }

    Ok(result)
}

/// Get dimensions of SGI image from header.
/// Returns dimensions if valid, or {0, 0} if:
/// - Header too small
/// - Invalid magic number
/// - Zero dimensions
#[wasm_bindgen]
pub fn sgi_get_dimensions(src: &[u8]) -> SgiDimensions {
    if src.len() < 512 {
        return SgiDimensions { width: 0, height: 0 };
    }

    // Check magic number (0x01da = 474)
    let magic = util::get_uint16_be(src, 0);
    if magic != 474 {
        return SgiDimensions { width: 0, height: 0 };
    }

    let width = util::get_uint16_be(src, 6) as u32;
    let height = util::get_uint16_be(src, 8) as u32;

    // Return 0,0 for zero dimensions
    if width == 0 || height == 0 {
        return SgiDimensions { width: 0, height: 0 };
    }

    SgiDimensions { width, height }
}

/// Decode verbatim (uncompressed) SGI data.
/// Data is stored channel by channel, scanline by scanline, bottom-to-top.
fn decode_verbatim(
    src: &[u8],
    width: usize,
    height: usize,
    channels: usize,
) -> Result<Vec<u8>, String> {
    let pixel_count = width * height;
    let mut result = vec![0u8; pixel_count * channels];

    let header_size = 512;
    let expected_size = header_size + pixel_count * channels;
    if src.len() < expected_size {
        return Err(format!(
            "SGI verbatim data too small: expected {} bytes, got {}",
            expected_size,
            src.len()
        ));
    }

    let mut src_offset = header_size;

    for c in 0..channels {
        for y in 0..height {
            // SGI stores bottom-to-top, we want top-to-bottom
            let flipped_y = height - 1 - y;
            for x in 0..width {
                let dst_idx = c * pixel_count + flipped_y * width + x;
                result[dst_idx] = src[src_offset];
                src_offset += 1;
            }
        }
    }

    Ok(result)
}

/// Decode RLE compressed SGI data.
/// Offset and length tables follow the header, then compressed scanlines.
fn decode_rle(src: &[u8], width: usize, height: usize, channels: usize) -> Result<Vec<u8>, String> {
    let pixel_count = width * height;
    let mut result = vec![0u8; pixel_count * channels];

    let table_size = height * channels;
    let header_size = 512;
    let table_end = header_size + table_size * 8; // 4 bytes offset + 4 bytes length per entry

    if src.len() < table_end {
        return Err("SGI RLE table data too small".to_string());
    }

    // Read offset and length tables
    let mut start_offsets = Vec::with_capacity(table_size);
    let mut _lengths = Vec::with_capacity(table_size);

    for i in 0..table_size {
        start_offsets.push(util::get_uint32_be(src, header_size + i * 4) as usize);
    }
    for i in 0..table_size {
        _lengths.push(util::get_uint32_be(src, header_size + table_size * 4 + i * 4) as usize);
    }

    for c in 0..channels {
        for y in 0..height {
            let table_idx = c * height + y;
            let mut src_offset = start_offsets[table_idx];
            let flipped_y = height - 1 - y;
            let mut x = 0usize;

            while x < width {
                if src_offset >= src.len() {
                    break;
                }

                let pixel = src[src_offset];
                src_offset += 1;
                let count = (pixel & 0x7F) as usize;

                if count == 0 {
                    break; // End of scanline
                }

                if (pixel & 0x80) != 0 {
                    // Literal run - copy count pixels
                    for _ in 0..count {
                        if x >= width || src_offset >= src.len() {
                            break;
                        }
                        let dst_idx = c * pixel_count + flipped_y * width + x;
                        result[dst_idx] = src[src_offset];
                        src_offset += 1;
                        x += 1;
                    }
                } else {
                    // RLE run - repeat next pixel count times
                    if src_offset >= src.len() {
                        break;
                    }
                    let value = src[src_offset];
                    src_offset += 1;
                    for _ in 0..count {
                        if x >= width {
                            break;
                        }
                        let dst_idx = c * pixel_count + flipped_y * width + x;
                        result[dst_idx] = value;
                        x += 1;
                    }
                }
            }
        }
    }

    Ok(result)
}
