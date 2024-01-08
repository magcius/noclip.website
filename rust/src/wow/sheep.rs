use polymorph::sheepfile::{get_data_filename, reader::SheepfileReader, Entry};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = "WowSheepfileEntry", getter_with_clone)]
pub struct WasmEntry {
    pub file_id: u32,
    pub datafile_name: String,
    pub start_bytes: usize,
    pub size_bytes: usize,
}

impl From<&Entry> for WasmEntry {
    fn from(entry: &Entry) -> Self {
        WasmEntry {
            file_id: entry.file_id,
            datafile_name: get_data_filename(entry.data_file_index as usize),
            start_bytes: entry.start_bytes as usize,
            size_bytes: entry.size_bytes as usize,
        }
    }
}

#[wasm_bindgen(js_name = "WowSheepfileManager")]
pub struct SheepfileManager {
    sheepfile: SheepfileReader,
}

#[wasm_bindgen(js_class = "WowSheepfileManager")]
impl SheepfileManager {
    pub fn new(data: &[u8]) -> Result<SheepfileManager, String> {
        Ok(Self {
            sheepfile: SheepfileReader::parse(data).map_err(|e| format!("{:?}", e))?,
        })
    }

    pub fn get_file_id(&self, file_id: u32) -> Option<WasmEntry> {
        Some(self.sheepfile.get_entry_for_file_id(file_id)?.into())
    }

    pub fn get_file_name(&self, file_name: &str) -> Option<WasmEntry> {
        Some(self.sheepfile.get_entry_for_name(file_name)?.into())
    }
}
