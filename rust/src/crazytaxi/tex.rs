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
    _unk_0x10: u32,
    _unk_0x14: u32,
    _unk_0x18: u32,
    _unk_0x1c: u32,
    _unk_0x20: u32,
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

    pub fn dbg_unks(&self) -> Vec<u32> {
        vec![
            self.header._unk_0x08,
            self.header._unk_0x10,
            self.header._unk_0x14,
            self.header._unk_0x18,
            self.header._unk_0x1c,
            self.header._unk_0x20,
        ]
    }

    pub fn header_loc(&self) -> FileLoc {
        FileLoc {
            file_id: self.file_id,
            offset: self.offset,
            length: 0x60,
        }
    }

    pub fn data_loc(&self) -> FileLoc {
        FileLoc {
            file_id: self.file_id,
            offset: self.offset + 0x60,
            length: self.length - 0x60,
        }
    }
}
