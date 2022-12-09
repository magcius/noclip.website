use std::io::{Cursor, Seek, SeekFrom, Read};

use byteorder::{LittleEndian, ReadBytesExt};

#[derive(Debug)]
enum MapReaderError {
    IO(String),
}

impl From<std::io::Error> for MapReaderError {
    fn from(err: std::io::Error) -> Self {
        MapReaderError::IO(err.to_string())
    }
}

type Result<T> = std::result::Result<T, MapReaderError>;

struct MapReader {
    pub data: Cursor<Vec<u8>>,
}

impl MapReader {
    fn new(data: Vec<u8>) -> MapReader {
        MapReader { data: Cursor::new(data) }
    }

    fn read_header(&mut self) -> Result<Header> {
        Header::deserialize(&mut self.data)
    }
}

trait Deserialize {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized;
}

#[derive(Debug)]
struct Header {
    pub uncompressed_file_size: u32,
    pub tag_data_offset: u32,
    pub tag_data_size: u32,
    pub scenario_name: String,
    pub scenario_type: ScenarioType,
}

fn read_null_terminated_string<T: Read>(data: &mut T, len: usize) -> Result<String> {
    let mut str_buf = vec![0; len];
    data.read_exact(&mut str_buf)?;
    let end = str_buf.iter()
        .take_while(|b| **b != 0)
        .count();
    Ok(std::str::from_utf8(&str_buf[0..end]).unwrap().to_string())
}

#[derive(Debug)]
pub enum ScenarioType {
    Singleplayer,
    Multiplayer,
    UserInterface,
}

impl Deserialize for Header {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        assert_eq!(data.read_u32::<LittleEndian>()?, 1751474532); // magic
        assert_eq!(data.read_u32::<LittleEndian>()?, 0xD); // MCC
        let uncompressed_file_size = data.read_u32::<LittleEndian>()?;
        let _padding_length = data.read_u32::<LittleEndian>()?;
        let tag_data_offset = data.read_u32::<LittleEndian>()?;
        let tag_data_size = data.read_u32::<LittleEndian>()?;
        data.seek(SeekFrom::Current(0x8))?;
        let scenario_name = read_null_terminated_string(data, 32)?;
        let _build_version = read_null_terminated_string(data, 32)?;
        let scenario_type = match data.read_u16::<LittleEndian>()? {
            0x0 => ScenarioType::Singleplayer,
            0x1 => ScenarioType::Multiplayer,
            0x2 => ScenarioType::UserInterface,
            _ => return Err(MapReaderError::IO("Invalid scenario type".into())),
        };
        data.seek(SeekFrom::Current(0x2))?;
        let _checksum = data.read_u32::<LittleEndian>()?;
        data.seek(SeekFrom::Current(0x794))?;
        assert_eq!(data.read_u32::<LittleEndian>()?, 1718579060);
        Ok(Header{
            uncompressed_file_size,
            tag_data_offset,
            tag_data_size,
            scenario_name,
            scenario_type,
        })
    }
}

#[derive(Debug)]
struct TagIndexHeader {
    pub tag_count: u32,
    pub model_part_count: u32,
    pub model_data_file_offset: u32,
    pub vertex_data_size: u32,
    pub model_data_size: u32,
}

impl Deserialize for TagIndexHeader {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let _tag_array_pointer = data.read_u32::<LittleEndian>()?;
        let _checksum = data.read_u32::<LittleEndian>()?;
        let _scenario_tag_id = data.read_u32::<LittleEndian>()?;
        let tag_count = data.read_u32::<LittleEndian>()?;
        let model_part_count = data.read_u32::<LittleEndian>()?;
        let model_data_file_offset = data.read_u32::<LittleEndian>()?;
        let _model_part_count_pc = data.read_u32::<LittleEndian>()?;
        let vertex_data_size = data.read_u32::<LittleEndian>()?;
        let model_data_size = data.read_u32::<LittleEndian>()?;
        assert_eq!(data.read_u32::<LittleEndian>()?, 1952540531);
        Ok(TagIndexHeader {
            tag_count,
            model_part_count,
            model_data_file_offset,
            vertex_data_size,
            model_data_size,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_test_file() -> MapReader {
        let data = std::fs::read("test_data/bloodgulch.map").unwrap();
        MapReader::new(data)
    }

    #[test]
    fn test() {
        let mut reader = read_test_file();
        let header = reader.read_header().unwrap();
        assert_eq!(header.scenario_name, "bloodgulch");
        reader.data.seek(SeekFrom::Start(header.tag_data_offset as u64)).unwrap();
        let index_header = TagIndexHeader::deserialize(&mut reader.data).unwrap();
        dbg!(reader.data.position());
    }
}