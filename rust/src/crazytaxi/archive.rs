use std::{collections::HashMap, io::{Cursor, Seek}};

use deku::prelude::*;
use anyhow::Result;
use wasm_bindgen::prelude::*;

use crate::unity::types::common::NullTerminatedAsciiString;

#[derive(DekuRead, Debug)]
pub struct AllHeader {
    pub n_items: u32,
    pub unk0: u16,
    pub unk1: u16,
    #[deku(pad_bytes_before = "8", count = "n_items")]
    pub items: Vec<AllHeaderItem>,
}

#[derive(DekuRead, Debug)]
pub struct AllHeaderItem {
    pub name: NullTerminatedAsciiString,
    #[deku(pad_bytes_before = "64 - name.bytes.len()")]
    pub size: u32,
}

pub struct ArchiveReader<'a> {
    pub data: &'a [u8],
    pub header: AllHeader,
    item_idx: usize,
    pub offset: usize,
}

impl<'a> ArchiveReader<'a> {
    pub fn new(data: &'a [u8]) -> Result<Self> {
        let mut reader = Reader::new(Cursor::new(data));
        let header = AllHeader::from_reader_with_ctx(&mut reader, ())?;
        let offset = reader.stream_position()? as usize;
        Ok(ArchiveReader {
            data,
            header,
            item_idx: 0,
            offset,
        })
    }
}

pub struct ArchiveEntry<'a> {
    pub name: String,
    pub offset: usize,
    pub data: &'a [u8],
}

impl<'a> Iterator for ArchiveReader<'a> {
    type Item = ArchiveEntry<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        let item = self.header.items.get(self.item_idx)?;
        let mut entry_offset = self.offset;
        let mut entry_size = item.size as usize;
        if entry_offset % 0x20 != 0 {
            // entries are aligned to 0x20 sized blocks
            let diff = 0x20 - (self.offset % 0x20);
            entry_offset += diff;
            entry_size -= diff;
        }

        self.item_idx += 1;
        self.offset += item.size as usize;
        Some(ArchiveEntry {
            name: String::from(&item.name),
            offset: entry_offset,
            data: &self.data[entry_offset..entry_offset+entry_size],
        })
    }
}

#[cfg(test)]
mod test {
    use super::ArchiveReader;

    fn filepath(p: &str) -> std::path::PathBuf {
        let base_path = std::path::Path::new("../data/CrazyTaxi/files/ct/");
        base_path.join(p)
    }

    #[test]
    fn sanity_check_audio() {
        let files = &[
            filepath("voice_a.all"),
            filepath("voice_b.all"),
            filepath("voice_c.all"),
            filepath("voice_d.all"),
            filepath("voices.all"),
        ];
        for file in files {
            let data = std::fs::read(file).unwrap();
            let reader = ArchiveReader::new(&data).unwrap();

            for entry in reader {
                let sample_rate = u32::from_be_bytes([
                    entry.data[8],
                    entry.data[9],
                    entry.data[10],
                    entry.data[11],
                ]);
                assert!([24000, 22050].contains(&sample_rate));
            }
        }
    }

    #[test]
    pub fn test_shps() {
        let files = &[
            filepath("polDC0.all"),
            filepath("poldc1.all"),
            filepath("poldc1_stream.all"),
            filepath("poldc2.all"),
            filepath("poldc2_stream.all"),
            filepath("poldc3.all"),
            filepath("poldc3_stream.all"),
        ];
        for file in files {
            let data = std::fs::read(file).unwrap();
            let reader = ArchiveReader::new(&data).unwrap();
            for entry in reader {
                assert!(entry.name.ends_with(".shp"));
                assert_eq!(&entry.data[0..4], &[0x3f, 0x80, 0x00, 0x00]);
            }
        }
    }
}
