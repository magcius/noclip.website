use deku::prelude::*;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = "WowColorEncoding")]
#[derive(Debug, DekuRead, Copy, Clone)]
#[deku(type = "u8")]
pub enum ColorEncoding {
    #[deku(id = "1")]
    Uncompressed,
    #[deku(id = "2")]
    Dxtc,
    #[deku(id = "3 | 4")]
    A8R8G8B8,
}

#[wasm_bindgen(js_name = "WowPixelFormat")]
#[derive(Debug, DekuRead, Copy, Clone)]
#[deku(type = "u8")]
pub enum PixelFormat {
    #[deku(id = "0")]
    Dxt1,
    #[deku(id = "1")]
    Dxt3,
    #[deku(id = "2")]
    Argb8888,
    #[deku(id = "3")]
    Argb1555,
    #[deku(id = "4")]
    Argb4444,
    #[deku(id = "5")]
    Rgb565,
    #[deku(id = "6")]
    A8,
    #[deku(id = "7")]
    Dxt5,
    #[deku(id = "8")]
    Unspecified,
    #[deku(id = "9")]
    Argb2565,
    #[deku(id = "11")]
    Pc511,
}

#[wasm_bindgen]
#[derive(Debug, DekuRead, Copy, Clone)]
#[deku(magic = b"BLP2")]
pub struct BlpHeader {
    _version: u32, // always 1 apparently
    pub color_encoding: ColorEncoding,
    pub alpha_bit_depth: u8,
    pub preferred_format: PixelFormat,
    pub has_mips: u8,
    pub width: u32,
    pub height: u32,
    mip_offsets: [u32; 16],
    mip_sizes: [u32; 16],
    palette: [u32; 256], // BGRA values
}

#[wasm_bindgen(js_name = "WowBlp")]
#[derive(Debug)]
pub struct Blp {
    texture_data: Vec<u8>,
    pub header: BlpHeader,
}

#[wasm_bindgen(js_name = "WowBlpMipMetadata")]
pub struct BlpMipMetadata {
    pub offset: u32,
    pub size: u32,
}

#[wasm_bindgen(js_class = "WowBlp")]
impl Blp {
    pub fn new(data: &[u8]) -> Result<Blp, String> {
        let (_, header) = BlpHeader::from_bytes((data, 0))
            .map_err(|e| format!("{:?}", e))?;

        Ok(Blp {
            texture_data: data[1172..].to_vec(),
            header,
        })
    }

    pub fn get_texture_data(&self, start: usize, size: usize) -> Result<Vec<u8>, String> {
        let data = &self.texture_data[start..start+size];
        match (self.header.color_encoding, self.header.preferred_format) {
            (ColorEncoding::Uncompressed, _) => {
                let mut result = Vec::with_capacity(self.texture_data.len() * 4);
                for &idx in data.iter() {
                    let pixel: u32 = self.header.palette[idx as usize];
                    let [b, g, r, a] = pixel.to_le_bytes();
                    result.push(r);
                    result.push(g);
                    result.push(b);
                    result.push(a);
                }
                Ok(result)
            },
            (ColorEncoding::Dxtc, _) => Ok(data.to_vec()),
            x => Err(format!("unsupported texture format combination: {:?}", x)),
        }
    }

    pub fn get_mip_data(&self, mip_level: usize) -> Result<Vec<u8>, String> {
        if mip_level > self.header.mip_offsets.len() {
            return Err("invalid mip level".to_string());
        }
        let w = (self.header.width >> mip_level).max(1);
        let h = (self.header.height >> mip_level).max(1);
        let offset = self.header.mip_offsets[mip_level] as usize - 1172;
        let size = match self.header.preferred_format {
            PixelFormat::Dxt5 | PixelFormat::Dxt3 => {
                ((w + 3) / 4) * ((h + 3) / 4) * 16
            },
            PixelFormat::Dxt1 => {
                ((w + 3) / 4) * ((h + 3) / 4) * 8
            },
            _ => self.header.mip_sizes[mip_level],
        };
        self.get_texture_data(offset, size as usize)
    }

    pub fn get_num_mips(&self) -> usize {
        for i in 0..16 {
            if self.header.mip_offsets[i] == 0 || self.header.mip_sizes[i] == 0 {
                return i;
            }
        }
        16
    }
}
