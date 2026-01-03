use deku::prelude::*;
use wasm_bindgen::prelude::*;

use super::FileLoc;

#[derive(DekuRead, Clone)]
#[deku(endian = "big")]
pub struct TexHeader {
    pub width: u32,
    pub height: u32,
    _unk_0x08: u32,
    pub format: u32,
}

#[wasm_bindgen(js_name = "CTTexture")]
#[derive(Clone)]
pub struct Texture {
    #[wasm_bindgen(skip)]
    pub header: TexHeader,
    pub file_id: usize,
    pub offset: usize,
    pub length: usize,
}

#[wasm_bindgen(js_class = "CTTexture")]
impl Texture {
    pub fn width(&self) -> u32 {
        self.header.width
    }

    pub fn height(&self) -> u32 {
        self.header.height
    }

    pub fn format(&self) -> u32 {
        self.header.format
    }

    pub fn data_loc(&self) -> FileLoc {
        FileLoc {
            file_id: self.file_id,
            offset: self.offset + 0x60,
            length: self.length - 0x60,
        }
    }
}
