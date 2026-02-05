use std::io::{Cursor, Seek};

use deku::prelude::*;
use anyhow::Result;

use crate::unity::types::common::NullTerminatedAsciiString;

#[derive(DekuRead, Debug)]
pub struct AllHeader {
    pub _n_items: u32,
    pub _unk0: u16,
    pub _unk1: u16,
    #[deku(pad_bytes_before = "8", count = "_n_items")]
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
