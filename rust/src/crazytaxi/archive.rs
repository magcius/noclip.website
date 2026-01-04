use std::io::{Cursor, Seek};

use deku::prelude::*;
use anyhow::Result;

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
        let entry_size = item.size as usize;
        if entry_offset % 0x20 != 0 {
            // entries are aligned to 0x20 sized blocks
            let diff = 0x20 - (self.offset % 0x20);
            entry_offset += diff;
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
    use std::{fs::read_dir, io::Cursor, path::PathBuf};

    use deku::{reader::Reader, DekuReader};

    use super::ArchiveReader;
    use crate::crazytaxi::{shp::ShpHeader, util::readfile};

    #[test]
    fn sanity_check_audio() {
        let files = &[
            "voice_a.all",
            "voice_b.all",
            "voice_c.all",
            "voice_d.all",
            "voices.all",
        ];
        for file in files {
            let data = readfile(file);
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
    pub fn test_vtxfmt() {
        let mut fmts = std::collections::HashMap::new();
        for maybe_file in read_dir("../data/CrazyTaxi/files/ct").unwrap() {
            let file = maybe_file.unwrap();
            if let Some(file_ext) = file.path().extension() {
                if !file_ext.eq("all") {
                    continue;
                }
                let data = std::fs::read(file.path()).unwrap();
                let archive = ArchiveReader::new(&data).unwrap();
                for entry in archive {
                    if entry.name.ends_with(".shp") {
                        let mut reader = Reader::new(Cursor::new(entry.data));
                        let shape = ShpHeader::from_reader_with_ctx(&mut reader, ()).unwrap();
                        assert_ne!(shape.display_list_offset, 0);
                        let offs = shape.display_list_offset as usize;
                        let display_list = &entry.data[offs..];
                        fmts.entry(display_list[0] & 0x07).or_insert(Vec::new()).push((file.path(), entry.name));
                    }
                }
            }
        }
        for fmt in 0..7 {
            let files = fmts.get(&fmt).unwrap();
            let guys: Vec<&(PathBuf, String)> = files.iter().take(10).collect();
            println!("{}: {:?} {}", fmt, guys, files.len());
        }
    }

    #[test]
    pub fn test_shps() {
        let files = &[
            "polDC0.all",
            "poldc1.all",
            "poldc1_stream.all",
            "poldc2.all",
            "poldc2_stream.all",
            "poldc3.all",
            "poldc3_stream.all",
        ];
        for file in files {
            let data = readfile(file);
            let reader = ArchiveReader::new(&data).unwrap();
            for entry in reader {
                assert!(entry.name.ends_with(".shp"));
                assert_eq!(&entry.data[0..4], &[0x3f, 0x80, 0x00, 0x00]);
            }
        }
    }
}
