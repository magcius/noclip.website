use polymorph::sheepfile::{get_data_filename, reader::SheepfileReader, Entry};
use wasm_bindgen::prelude::*;
use std::{io::{Read, Seek}, path::Path};

/**
 * For more information about sheepfiles, check out `src/WorldOfWarcraft/util.ts`
 * and https://github.com/wgreenberg/polymorph.
 */

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
// QOL utils for local testing
impl SheepfileManager {
    pub fn load_file_id_data<P: AsRef<Path>>(sheepfile_path: P, file_id: u32) -> Result<Vec<u8>, polymorph::error::Error> {
        let index_path = sheepfile_path.as_ref().join("index.shp");
        let reader = SheepfileReader::parse(&std::fs::read(index_path).unwrap())?;
        let entry = reader.get_entry_for_file_id(file_id).unwrap();
        let data_filename = get_data_filename(entry.data_file_index as usize);
        let data_path = sheepfile_path.as_ref().join(data_filename);
        let mut result = vec![0; entry.size_bytes as usize];
        let mut file = std::fs::File::open(data_path).unwrap();
        file.seek(std::io::SeekFrom::Start(entry.start_bytes as u64)).unwrap();
        file.read_exact(&mut result).unwrap();
        Ok(result)
    }
}
