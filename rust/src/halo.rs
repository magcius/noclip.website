use std::{io::{Cursor, Seek, SeekFrom, Read}, convert::TryFrom};
use num_enum::{IntoPrimitive, TryFromPrimitive, TryFromPrimitiveError};

use byteorder::{LittleEndian, ReadBytesExt};

#[derive(Debug)]
enum MapReaderError {
    IO(String),
    UnimplementedTag(String),
}

impl From<std::io::Error> for MapReaderError {
    fn from(err: std::io::Error) -> Self {
        MapReaderError::IO(err.to_string())
    }
}

impl From<TryFromPrimitiveError<TagClass>> for MapReaderError {
    fn from(err: TryFromPrimitiveError<TagClass>) -> Self {
        MapReaderError::IO(err.to_string())
    }
}

type Result<T> = std::result::Result<T, MapReaderError>;
type Pointer = u32;

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

    fn read_tag_headers(&mut self, header: &Header) -> Result<Vec<TagHeader>> {
        self.data.seek(SeekFrom::Start(header.tag_data_offset as u64))?;
        let index_header = TagIndexHeader::deserialize(&mut self.data)?;
        let mut result = Vec::with_capacity(index_header.tag_count as usize);
        for _ in 0..index_header.tag_count {
            let mut tag = TagHeader::deserialize(&mut self.data)?;
            if tag.tag_data > 0 {
                tag.tag_data = convert_vpointer(header.tag_data_offset + tag.tag_data);
            }
            tag.tag_path = convert_vpointer(header.tag_data_offset + tag.tag_path);
            result.push(tag);
        }
        Ok(result)
    }

    fn read_tag(&mut self, tag_header: &TagHeader) -> Result<Tag> {
        self.data.seek(SeekFrom::Start(tag_header.tag_path as u64))?;
        let path = read_null_terminated_string(&mut self.data)?;
        self.data.seek(SeekFrom::Start(tag_header.tag_data as u64))?;
        let data = match tag_header.primary_class {
            TagClass::Scenario => TagData::Scenario(Scenario::deserialize(&mut self.data)?),
            _ => return Err(MapReaderError::UnimplementedTag(format!("{:?} not yet implemented", tag_header.primary_class))),
        };
        Ok(Tag { path, data })
    }
}

#[derive(Debug)]
struct Tag {
    path: String,
    data: TagData,
}

#[derive(Debug)]
struct Scenario {
}

impl Deserialize for Scenario {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let _deprecated = TagDependency::deserialize(data)?;
        let _deprecated = TagDependency::deserialize(data)?;
        let _deprecated = TagDependency::deserialize(data)?;
        dbg!(data.position());
        todo!();
    }
}

#[derive(Debug)]
enum TagData {
    Scenario(Scenario),
}

trait Deserialize {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized;
}

#[derive(Debug)]
struct Header {
    pub uncompressed_file_size: u32,
    pub tag_data_offset: Pointer,
    pub tag_data_size: u32,
    pub scenario_name: String,
    pub scenario_type: ScenarioType,
}

const BASE_MEMORY_ADDRESS: Pointer = 0x50000000;
fn convert_vpointer(pointer: Pointer) -> Pointer {
    pointer - BASE_MEMORY_ADDRESS
}

fn read_null_terminated_string_with_size<T: Read>(data: &mut T, len: usize) -> Result<String> {
    let mut str_buf = vec![0; len];
    data.read_exact(&mut str_buf)?;
    let end = str_buf.iter()
        .take_while(|b| **b != 0)
        .count();
    Ok(std::str::from_utf8(&str_buf[0..end]).unwrap().to_string())
}

fn read_null_terminated_string<T: Read>(data: &mut T) -> Result<String> {
    let mut res = String::new();
    loop {
        match data.read_u8()? {
            0 => break,
            x => res.push(x as char),
        }
    }
    Ok(res)
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
        let scenario_name = read_null_terminated_string_with_size(data, 32)?;
        let _build_version = read_null_terminated_string_with_size(data, 32)?;
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
    pub tag_array_pointer: Pointer,
    pub model_part_count: u32,
    pub model_data_file_offset: Pointer,
    pub vertex_data_size: u32,
    pub scenario_tag_id: u32,
    pub model_data_size: u32,
}

impl Deserialize for TagIndexHeader {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let tag_array_pointer = data.read_u32::<LittleEndian>()?;
        let _checksum = data.read_u32::<LittleEndian>()?;
        let scenario_tag_id = data.read_u32::<LittleEndian>()?;
        let tag_count = data.read_u32::<LittleEndian>()?;
        let model_part_count = data.read_u32::<LittleEndian>()?;
        let model_data_file_offset = data.read_u32::<LittleEndian>()?;
        let _model_part_count_pc = data.read_u32::<LittleEndian>()?;
        let vertex_data_size = data.read_u32::<LittleEndian>()?;
        let model_data_size = data.read_u32::<LittleEndian>()?;
        assert_eq!(data.read_u32::<LittleEndian>()?, 1952540531);
        Ok(TagIndexHeader {
            tag_count,
            tag_array_pointer,
            model_part_count,
            model_data_file_offset,
            scenario_tag_id,
            vertex_data_size,
            model_data_size,
        })
    }
}

#[derive(Debug, IntoPrimitive, TryFromPrimitive)]
#[repr(u32)]
enum TagClass {
    Actor = 0x61637472,
    ActorVariant = 0x61637476,
    Antenna = 0x616E7421,
    ModelAnimations = 0x616E7472,
    Biped = 0x62697064,
    Bitmap = 0x6269746D,
    Spheroid = 0x626F6F6D,
    ContinuousDamageEffect = 0x63646D67,
    ModelCollisionGeometry = 0x636F6C6C,
    ColorTable = 0x636F6C6F,
    Contrail = 0x636F6E74,
    DeviceControl = 0x6374726C,
    Decal = 0x64656361,
    UIWidgetDefinition = 0x44654C61,
    InputDeviceDefaults = 0x64657663,
    Device = 0x64657669,
    DetailObjectCollection = 0x646F6263,
    Effect = 0x65666665,
    Equipment = 0x65716970,
    Flag = 0x666C6167,
    Fog = 0x666F6720,
    Font = 0x666F6E74,
    MaterialEffects = 0x666F6F74,
    Garbage = 0x67617262,
    Glow = 0x676C7721,
    GrenadeHudInterface = 0x67726869,
    HudMessageText = 0x686D7420,
    HudNumber = 0x68756423,
    HudGlobals = 0x68756467,
    Item = 0x6974656D,
    ItemCollection = 0x69746D63,
    DamageEffect = 0x6A707421,
    LensFlare = 0x6C656E73,
    Lightning = 0x656C6563,
    DeviceLightFixture = 0x6C696669,
    Light = 0x6C696768,
    SoundLooping = 0x6C736E64,
    DeviceMachine = 0x6D616368,
    Globals = 0x6D617467,
    Meter = 0x6D657472,
    LightVolume = 0x6D677332,
    Gbxmodel = 0x6D6F6432,
    Model = 0x6D6F6465,
    MultiplayerScenarioDescription = 0x6D706C79,
    PreferencesNetworkGame = 0x6E677072,
    #[num_enum(alternatives = [0xFFFFFFFF])]
    Null = 0,
    Object = 0x6F626A65,
    Particle = 0x70617274,
    ParticleSystem = 0x7063746C,
    Physics = 0x70687973,
    Placeholder = 0x706C6163,
    PointPhysics = 0x70706879,
    Projectile = 0x70726F6A,
    WeatherParticleSystem = 0x7261696E,
    ScenarioStructureBsp = 0x73627370,
    Scenery = 0x7363656E,
    ShaderTransparentChicagoExtended = 0x73636578,
    ShaderTransparentChicago = 0x73636869,
    Scenario = 0x73636E72,
    ShaderEnvironment = 0x73656E76,
    ShaderTransparentGlass = 0x73676C61,
    Shader = 0x73686472,
    Sky = 0x736B7920,
    ShaderTransparentMeter = 0x736D6574,
    Sound = 0x736E6421,
    SoundEnvironment = 0x736E6465,
    ShaderModel = 0x736F736F,
    ShaderTransparentGeneric = 0x736F7472,
    UIWidgetCollection = 0x536F756C,
    ShaderTransparentPlasma = 0x73706C61,
    SoundScenery = 0x73736365,
    StringList = 0x73747223,
    ShaderTransparentWater = 0x73776174,
    TagCollection = 0x74616763,
    CameraTrack = 0x7472616B,
    Dialogue = 0x75646C67,
    UnitHudInterface = 0x756E6869,
    Unit = 0x756E6974,
    UnicodeStringList = 0x75737472,
    VirtualKeyboard = 0x76636B79,
    Vehicle = 0x76656869,
    Weapon = 0x77656170,
    Wind = 0x77696E64,
    WeaponHudInterface = 0x77706869,
}

impl Deserialize for TagClass {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(TagClass::try_from(data.read_u32::<LittleEndian>()?)?)
    }
}

#[derive(Debug)]
struct TagHeader {
    primary_class: TagClass,
    secondary_class: TagClass,
    tertiary_class: TagClass,
    tag_id: u32,
    tag_path: u32,
    tag_data: u32,
    indexed: u32, // seems to always be 0 in bloodgulch
}

impl Deserialize for TagHeader {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let tag = TagHeader {
            primary_class: TagClass::deserialize(data)?,
            secondary_class: TagClass::deserialize(data)?,
            tertiary_class: TagClass::deserialize(data)?,
            tag_id: data.read_u32::<LittleEndian>()?,
            tag_path: data.read_u32::<LittleEndian>()?,
            tag_data: data.read_u32::<LittleEndian>()?,
            indexed: data.read_u32::<LittleEndian>()?,
        };
        data.seek(SeekFrom::Current(0x4))?;
        Ok(tag)
    }
}

struct TagDependency {
    tag_class: TagClass,
    path_pointer: Pointer,
    tag_id: u32,
}

impl Deserialize for TagDependency {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(TagDependency {
            tag_class: TagClass::deserialize(data)?,
            path_pointer: data.read_u32::<LittleEndian>()?,
            tag_id: data.read_u32::<LittleEndian>()?,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::convert;

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
        let tags = reader.read_tag_headers(&header).unwrap();
        let scenario_tag = &tags[0];
        dbg!(reader.read_tag(&scenario_tag));
    }
}