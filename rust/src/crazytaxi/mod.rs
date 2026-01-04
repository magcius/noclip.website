use std::{collections::HashMap, io::Cursor};

use anyhow::{Context, Result};
use deku::{reader::Reader, DekuReader};
use shp::{Shape, ShpHeader};
use tex::{TexHeader, Texture};
use wasm_bindgen::prelude::*;

mod archive;
mod shp;
mod util;
mod tex;

fn s(err: anyhow::Error) -> String {
    format!("{:?}", err)
}

#[wasm_bindgen(js_name = "CTFileLoc")]
#[derive(Clone, Copy, Debug)]
pub struct FileLoc {
    pub file_id: usize,
    pub offset: usize,
    pub length: usize,
}

#[wasm_bindgen(js_name = "CTFileStore")]
#[derive(Default)]
pub struct FileStore {
    files: Vec<String>,
    shapes: HashMap<String, Shape>,
    textures: HashMap<String, Texture>,
}

#[wasm_bindgen(js_class = "CTFileStore")]
impl FileStore {
    pub fn new() -> Self {
        Self {
            ..Default::default()
        }
    }

    pub fn append_file(&mut self, name: &str, data: &[u8]) -> Result<(), String> {
        let file_id = self.files.len();
        self.files.push(name.to_string());
        self.insert_data(name.to_string(), file_id, 0, data)?;
        Ok(())
    }

    fn insert_data(&mut self, name: String, file_id: usize, offset: usize, data: &[u8]) -> Result<(), String> {
        let mut reader = Reader::new(Cursor::new(data));
        let length = data.len();
        if name.ends_with(".shp") {
            let header = ShpHeader::from_reader_with_ctx(&mut reader, ())
                .context("parsing ShpHeader")
                .map_err(s)?;
            let mut shape = Shape {
                header,
                file_id,
                offset,
                textures: Vec::new(),
            };
            shape.populate_textures(data).map_err(s)?;
            self.shapes.insert(name, shape);
        } else if name.ends_with(".tex") {
            let header = TexHeader::from_reader_with_ctx(&mut reader, ())
                .context("parsing TexHeader")
                .map_err(s)?;
            self.textures.insert(name, Texture {
                header,
                length,
                file_id,
                offset,
            });
        } else {
            return Err(format!("unknown file format {}", name));
        }
        Ok(())
    }

    pub fn append_archive(&mut self, name: &str, data: &[u8]) -> Result<(), String> {
        let file_id = self.files.len();
        self.files.push(name.to_string());
        let reader = archive::ArchiveReader::new(data).map_err(s)?;
        for entry in reader {
            self.insert_data(entry.name, file_id, entry.offset, entry.data)?;
        }
        Ok(())
    }

    pub fn list_textures(&self) -> Vec<String> {
        self.textures.keys().cloned().collect()
    }

    pub fn list_shapes(&self) -> Vec<String> {
        self.shapes.keys().cloned().collect()
    }

    pub fn get_texture(&self, name: &str) -> Option<Texture> {
        self.textures.get(name).cloned()
    }

    pub fn get_shape(&self, name: &str) -> Option<Shape> {
        self.shapes.get(name).cloned()
    }
}
