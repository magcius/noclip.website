use std::io::Cursor;

use deku::prelude::*;
use wasm_bindgen::prelude::*;
use anyhow::{Context, Result};

use crate::{crazytaxi::FileLoc, unity::types::common::NullTerminatedAsciiString};

#[derive(DekuRead, Debug, Clone)]
#[deku(endian = "big")]
pub struct ShpHeader {
    #[deku(assert_eq = "1.0")]
    pub _version: f32,
    pub bounding_radius: f32,
    pub _xf_reg_mask: u32,
    pub unk_0x0c: u32,
    pub num_textures: u32,
    pub num_opaque_draws: u32,
    pub num_transparent_draws: u32,
    pub num_unk_draws: u32,
    pub pos_x: f32,
    pub pos_y: f32,
    pub pos_z: f32,
    pub scale_x: f32,
    pub scale_y: f32,
    pub scale_z: f32,
    pub default_material_id: u32,
    pub unk_0x3c: u32,
    #[deku(pad_bytes_before = "32")]
    pub unk_0x60: u32,
    pub unk_0x64: u32,
    pub unk_0x68: u32,
    pub unk_0x6c: u32,
    pub unk_0x70: u32,
    pub unk_0x74: u32,
    #[deku(pad_bytes_before = "84")]
    pub pos_offset: u32,
    pub norm_offset: u32,
    pub clr_offsets: [u32; 2],
    pub tex_offsets: [u32; 8],
    #[deku(pad_bytes_before = "20")]
    pub draw_list_offset: u32,
    pub _pos_offset_dupe: u32,
    pub display_list_offset: u32,
    pub texture_list_offset: u32,
}

#[wasm_bindgen(js_name = "CTShape", getter_with_clone)]
#[derive(Clone)]
pub struct Shape {
    #[wasm_bindgen(skip)]
    pub header: ShpHeader,
    pub file_id: usize,
    pub offset: usize,
    pub length: usize,
    pub textures: Vec<String>,
}

#[derive(DekuRead)]
struct TextureName {
    #[deku(pad_bytes_after = "44 - name.bytes.len()")]
    name: NullTerminatedAsciiString,
}

impl Shape {
    pub fn populate_textures(&mut self, data: &[u8]) -> Result<()> {
        let texture_names_data = &data[self.header.texture_list_offset as usize..];
        assert_eq!(texture_names_data.len() / 44, self.header.num_textures as usize);
        let mut reader = Reader::new(Cursor::new(texture_names_data));
        for _ in 0..self.header.num_textures {
            let tex_name = TextureName::from_reader_with_ctx(&mut reader, ())
                .context("parsing TextureName from block")?;
            self.textures.push(String::from(tex_name.name));
        }
        Ok(())
    }

    // get the first nonzero offset after the given index
    fn next_offset(&self, offset_index: usize) -> usize {
        let offsets = &[
            self.header.pos_offset,
            self.header.norm_offset,
            self.header.clr_offsets[0],
            self.header.clr_offsets[1],
            self.header.tex_offsets[0],
            self.header.tex_offsets[1],
            self.header.tex_offsets[2],
            self.header.tex_offsets[3],
            self.header.tex_offsets[4],
            self.header.tex_offsets[5],
            self.header.tex_offsets[6],
            self.header.tex_offsets[7],
            self.header.draw_list_offset,
            self.header.display_list_offset,
            self.header.texture_list_offset,
        ];
        for &offset in &offsets[offset_index + 1..] {
            if offset != 0 {
                return offset as usize;
            }
        }
        panic!("couldn't find next offset");
    }
}

#[wasm_bindgen(js_class = "CTShape")]
impl Shape {
    pub fn header_loc(&self) -> FileLoc {
        FileLoc {
            file_id: self.file_id,
            offset: self.offset,
            length: self.length,
        }
    }

    pub fn num_unk_draws(&self) -> u32 {
        self.header.num_unk_draws
    }

    pub fn num_transparent_draws(&self) -> u32 {
        self.header.num_transparent_draws
    }

    pub fn num_opaque_draws(&self) -> u32 {
        self.header.num_opaque_draws
    }

    pub fn default_material_id(&self) -> u32 {
        self.header.default_material_id
    }

    pub fn pos_loc(&self) -> FileLoc {
        let relative_offset = self.header.pos_offset as usize;
        FileLoc {
            file_id: self.file_id,
            offset: self.offset + relative_offset,
            length: self.next_offset(0) - relative_offset,
        }
    }

    pub fn nrm_loc(&self) -> Option<FileLoc> {
        if self.header.norm_offset == 0 {
            None
        } else {
            let relative_offset = self.header.norm_offset as usize;
            Some(FileLoc {
                file_id: self.file_id,
                offset: self.offset + relative_offset,
                length: self.next_offset(1) - relative_offset,
            })
        }
    }

    pub fn clr_loc(&self, n: usize) -> Option<FileLoc> {
        assert!(n < 2);
        let relative_offset = *self.header.clr_offsets.get(n)? as usize;
        if relative_offset == 0 {
            None
        } else {
            Some(FileLoc {
                file_id: self.file_id,
                offset: self.offset + relative_offset,
                length: self.next_offset(n + 2) - relative_offset,
            })
        }
    }

    pub fn mystery_loc(&self) -> Option<FileLoc> {
        let relative_offset = self.header.draw_list_offset as usize;
        if relative_offset == 0 {
            None
        } else {
            Some(FileLoc {
                file_id: self.file_id,
                offset: self.offset + relative_offset,
                length: self.next_offset(12) - relative_offset,
            })
        }
    }

    pub fn pos_and_scale(&self) -> Vec<f32> {
        vec![
            self.header.pos_x,
            self.header.pos_y,
            self.header.pos_z,
            self.header.scale_x,
            self.header.scale_y,
            self.header.scale_z,
        ]
    }

    pub fn dbg_offs(&self) -> Vec<u32> {
        vec![
            self.header.pos_offset,
            self.header.norm_offset,
            self.header.clr_offsets[0],
            self.header.tex_offsets[0],
            self.header.draw_list_offset,
            self.header.display_list_offset,
        ]
    }

    pub fn tex_loc(&self, n: usize) -> Option<FileLoc> {
        assert!(n < 8);
        let relative_offset = *self.header.tex_offsets.get(n)? as usize;
        if relative_offset == 0 {
            None
        } else {
            Some(FileLoc {
                file_id: self.file_id,
                offset: self.offset + relative_offset,
                length: self.next_offset(n + 4) - relative_offset,
            })
        }
    }

    pub fn display_list_loc(&self) -> Option<FileLoc> {
        if self.header.display_list_offset == 0 {
            None
        } else {
            let relative_offset = self.header.display_list_offset as usize;
            Some(FileLoc {
                file_id: self.file_id,
                offset: self.offset + relative_offset,
                length: self.next_offset(13) - relative_offset,
            })
        }
    }

    pub fn bounding_radius(&self) -> f32 {
        self.header.bounding_radius
    }

    pub fn display_list_offs(&self) -> u32 {
        self.header.display_list_offset
    }
}

#[cfg(test)]
mod test {
    use std::io::Cursor;

    use deku::{reader::Reader, DekuReader};

    use crate::crazytaxi::util::readextract;

    use super::{ShpHeader, Shape};
    #[test]
    fn test() {
        let data = readextract("CT_train.shp");
        let length = data.len();
        let mut reader = Reader::new(Cursor::new(data));
        let header = ShpHeader::from_reader_with_ctx(&mut reader, ()).unwrap();
        let shape = Shape {
            file_id: 0,
            textures: Vec::new(),
            header,
            length,
            offset: 0,
        };
        dbg!(shape.display_list_loc());
    }

    #[test]
    fn bruteforce_find_modelmat() {
        let data = std::fs::read("../data/CrazyTaxi/sys/main.dol").unwrap();
        let mut runs: Vec<Vec<(usize, f32)>> = Vec::new();
        for i in 0..data.len() / 4 {
            let offs = i*4;
            let f = f32::from_be_bytes([
                data[offs],
                data[offs+1],
                data[offs+2],
                data[offs+3],
            ]);
            if f.is_nan() || (f.abs() < 0.0001 && f != 0.0) || f.abs() > 100_000.0 {
                continue;
            }
            match runs.last_mut() {
                Some(run) => {
                    let (last_offs, _) = run.last().unwrap();
                    if *last_offs == offs - 4 {
                        run.push((offs, f));
                    } else if f != 0.0 {
                        runs.push(vec![(offs, f)]);
                    }
                },
                None => {
                    runs.push(vec![(offs, f)]);
                }
            }
        }
        runs.retain(|run| run.len() >= 10);
        runs.sort_by_key(|run| run.len());
        for run in runs {
            println!("{:02x} ({:02x}): {:?}", run[0].0 + 0x80003000, run[0].0, run.len());
        }
    }
}
