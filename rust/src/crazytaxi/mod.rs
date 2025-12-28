use std::{collections::HashMap, io::{Cursor, Seek}};

use deku::prelude::*;
use anyhow::Result;
use wasm_bindgen::prelude::*;

use crate::unity::types::common::NullTerminatedAsciiString;

mod archive;

fn s(err: anyhow::Error) -> String {
    format!("{:?}", err)
}

#[wasm_bindgen(js_name = "CTFileManager")]
struct FileManager {
    files: HashMap<String, Vec<u8>>,
}

#[wasm_bindgen(js_class = "CTFileManager")]
impl FileManager {
    pub fn new() -> Self {
        Self {
            files: HashMap::new(),
        }
    }

    pub fn append_archive(&mut self, data: &[u8]) -> Result<(), String> {
        let reader = archive::ArchiveReader::new(data).map_err(s)?;
        for entry in reader {
            assert!(self.files.insert(entry.name, entry.data.to_vec()).is_none());
        }
        Ok(())
    }

    pub fn list_files(&self, suffix: &str) -> Vec<String> {
        let mut result = Vec::new();
        for name in self.files.keys() {
            if name.ends_with(suffix) {
                result.push(name.clone());
            }
        }
        result
    }

    pub fn get_file(&self, name: &str) -> Option<Vec<u8>> {
        self.files.get(name).cloned()
    }
}
