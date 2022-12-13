use std::{io::{Cursor, Seek, SeekFrom, Read}, convert::TryFrom};
use js_sys::{Array};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsValue, JsCast};
use num_enum::{IntoPrimitive, TryFromPrimitive, TryFromPrimitiveError};
use inflate::inflate_bytes;

use byteorder::{LittleEndian, ReadBytesExt};

#[derive(Debug, Clone)]
enum MapReaderError {
    IO(String),
    UnimplementedTag(String),
    InvalidTag(String),
}

impl From<std::io::Error> for MapReaderError {
    fn from(err: std::io::Error) -> Self {
        MapReaderError::IO(err.to_string())
    }
}

impl<T: TryFromPrimitive> From<TryFromPrimitiveError<T>> for MapReaderError {
    fn from(err: TryFromPrimitiveError<T>) -> Self {
        MapReaderError::IO(err.to_string())
    }
}

type Result<T> = std::result::Result<T, MapReaderError>;
type Pointer = u32;

const BASE_MEMORY_ADDRESS: Pointer = 0x50000000;

#[wasm_bindgen]
pub struct MapManager {
    reader: MapReader,
    header: Header,
    tag_index_header: TagIndexHeader,
    bitmaps_reader: ResourceMapReader,
    bitmaps_header: ResourcesHeader,
    tag_headers: Vec<TagHeader>,
}

#[wasm_bindgen]
impl MapManager {
    fn new(map: Vec<u8>, bitmaps: Vec<u8>) -> Result<Self> {
        let mut reader = MapReader::new(map);
        let header = reader.read_header()?;
        let mut bitmaps_reader = ResourceMapReader::new(bitmaps);
        let bitmaps_header = bitmaps_reader.read_header()?;

        let tag_index_header = reader.read_tag_index_header(&header)?;
        let tag_headers = reader.read_tag_headers(&header, &tag_index_header)?;

        Ok(MapManager {
            reader,
            header,
            tag_index_header,
            bitmaps_reader,
            bitmaps_header,
            tag_headers,
        })
    }

    pub fn new_js(map: Vec<u8>, bitmaps: Vec<u8>) -> Self {
        MapManager::new(map, bitmaps).unwrap()
    }

    fn read_tag(&mut self, tag_header: &TagHeader) -> Result<Tag> {
        let data = match tag_header.primary_class {
            TagClass::Bitmap => {
                let offset: i64 = self.header.tag_data_offset as i64 - BASE_MEMORY_ADDRESS as i64;
                self.reader.data.seek(SeekFrom::Start((offset + tag_header.tag_data as i64) as u64))?;
                let mut bitmap = Bitmap::deserialize(&mut self.reader.data)?;
                bitmap.bitmap_group_sequence.read_items(&mut self.reader.data, offset)?;
                bitmap.data.read_items(&mut self.reader.data, offset)?;
                TagData::Bitmap(bitmap)
            },
            _ => return Err(MapReaderError::UnimplementedTag(format!("can't yet read {:?}", tag_header))),
        };
        Ok(Tag { header: tag_header.clone(), data })
    }

    fn get_bitmaps(&mut self) -> Result<Vec<Tag>> {
        let bitmap_headers: Vec<TagHeader> = self.tag_headers.iter()
            .filter(|header| match header.primary_class {
                TagClass::Bitmap => true,
                _ => false,
            })
            .cloned()
            .collect();
        let mut result = Vec::new();
        for hdr in &bitmap_headers {
            result.push(self.read_tag(&hdr)?);
        }
        Ok(result)
    }

    pub fn get_bitmaps_js(&mut self) -> Array {
        self.get_bitmaps().unwrap().iter().cloned().map(JsValue::from).collect()
    }

    fn read_bitmap_data(&mut self, tag: &Tag, index: usize) -> Result<Vec<u8>> {
        match &tag.data {
            TagData::Bitmap(bitmap) => match &bitmap.data.items {
                Some(bitmap_data) => {
                    let data = &bitmap_data[index];
                    let mut result = vec![0; data.pixel_data_size as usize];
                    self.bitmaps_reader.data.seek(SeekFrom::Start(data.pixel_data_offset as u64))?;
                    self.bitmaps_reader.data.read_exact(&mut result)?;
                    Ok(result)
                },
                None => return Err(MapReaderError::InvalidTag(format!("bitmap has no BitmapData"))),
            },
            _ => return Err(MapReaderError::InvalidTag(format!("expected bitmap tag, got {:?}", tag.header.primary_class))),
        }
    }

    pub fn read_bitmap_data_js(&mut self, tag: &Tag, index: usize) -> Vec<u8> {
        self.read_bitmap_data(tag, index).unwrap()
    }
}

#[wasm_bindgen]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

struct ResourceMapReader {
    pub data: Cursor<Vec<u8>>,
}

impl ResourceMapReader {
    fn new(data: Vec<u8>) -> ResourceMapReader {
        ResourceMapReader { data: Cursor::new(data) }
    }

    fn read_header(&mut self) -> Result<ResourcesHeader> {
        ResourcesHeader::deserialize(&mut self.data)
    }
}

#[derive(Debug, Clone)]
struct Block<T> {
    items: Option<Vec<T>>,
    base_pointer: Pointer,
    count: usize,
}

impl<T> Deserialize for Block<T> {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let count = data.read_u32::<LittleEndian>()? as usize;
        let base_pointer = data.read_u32::<LittleEndian>()? as Pointer;
        Ok(Block {
            count, 
            base_pointer,
            items: None,
        })
    }
}

impl<T: Deserialize> Block<T> {
    fn read_items(&mut self, data: &mut Cursor<Vec<u8>>, offset: i64) -> Result<()> {
        let mut items: Vec<T> = Vec::with_capacity(self.count as usize);
        if self.count > 0 {
            data.seek(SeekFrom::Start((self.base_pointer as i64 + offset) as u64))?;
            for _ in 0..self.count {
                items.push(T::deserialize(data)?);
            }
        }
        self.items = Some(items);
        Ok(())
    }
}

struct MapReader {
    pub data: Cursor<Vec<u8>>,
}

impl MapReader {
    fn new(data: Vec<u8>) -> MapReader {
        MapReader { data: Cursor::new(data) }
    }

    fn read_header(&mut self) -> Result<Header> {
        self.data.seek(SeekFrom::Start(0))?;
        Header::deserialize(&mut self.data)
    }

    fn read_tag_index_header(&mut self, header: &Header) -> Result<TagIndexHeader> {
        self.data.seek(SeekFrom::Start(header.tag_data_offset as u64))?;
        TagIndexHeader::deserialize(&mut self.data)
    }

    fn read_tag_headers(&mut self, header: &Header, tag_index_header: &TagIndexHeader) -> Result<Vec<TagHeader>> {
        let mut result = Vec::with_capacity(tag_index_header.tag_count as usize);
        for i in 0..tag_index_header.tag_count {
            let data_offset = header.tag_data_offset + 40 + (i * 32);
            self.data.seek(SeekFrom::Start(data_offset as u64))?;
            let mut tag_header = TagHeader::deserialize(&mut self.data)?;
            let path_offset = header.tag_data_offset + tag_header.tag_path - BASE_MEMORY_ADDRESS;
            self.data.seek(SeekFrom::Start(path_offset as u64))?;
            let path = read_null_terminated_string(&mut self.data)?;
            tag_header.path = path;
            result.push(tag_header);
        }
        Ok(result)
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct Tag {
    header: TagHeader,
    data: TagData,
}

#[wasm_bindgen]
impl Tag {
    pub fn as_bitmap(&self) -> Option<Bitmap> {
        match &self.data {
            TagData::Bitmap(b) => Some(b.clone()),
            _ => None,
        }
    }
}

struct Sky {
}

#[derive(Debug, Clone)]
struct Scenario {
    skies: Vec<TagDependency>,
    scenario_type: ScenarioType,
    flags: u16,
    child_scenarios: Vec<TagDependency>,
    local_north: f32,
}

#[derive(Debug, IntoPrimitive, TryFromPrimitive, Copy, Clone)]
#[repr(u16)]
enum ObjectType {
    Biped = 0x0	,
    Vehicle = 0x1,
    Weapon = 0x2,
    Equipment = 0x3,
    Garbage = 0x4,
    Projectile = 0x5,
    Scenery = 0x6,
    DeviceMachine = 0x7,
    DeviceControl = 0x8,
    DeviceLightFixture = 0x9,
    PlaceHolder = 0xA,
    SoundScenery = 0xB,
}

#[derive(Debug)]
struct ObjectName {
    name: String,
    object_type: ObjectType,
    index: u16,
}

impl Deserialize for ObjectName {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(ObjectName {
            name: read_null_terminated_string(data)?,
            object_type: ObjectType::try_from(data.read_u16::<LittleEndian>()?)?,
            index: data.read_u16::<LittleEndian>()?,
        })
    }
}

#[derive(Debug, Copy, Clone)]
struct Point2D {
    x: f32,
    y: f32,
}

impl Deserialize for Point2D {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(Point2D {
            x: data.read_f32::<LittleEndian>()?,
            y: data.read_f32::<LittleEndian>()?,
        })
    }
}

#[derive(Debug, Copy, Clone)]
struct Point2DInt {
    x: i16,
    y: i16,
}

impl Deserialize for Point2DInt {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(Point2DInt {
            x: data.read_i16::<LittleEndian>()?,
            y: data.read_i16::<LittleEndian>()?,
        })
    }
}

#[derive(Debug, Copy, Clone)]
struct Point3D {
    x: f32,
    y: f32,
    z: f32,
}

impl Deserialize for Point3D {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(Point3D {
            x: data.read_f32::<LittleEndian>()?,
            y: data.read_f32::<LittleEndian>()?,
            z: data.read_f32::<LittleEndian>()?,
        })
    }
}

#[derive(Debug)]
struct Euler3D {
    yaw: f32,
    pitch: f32,
    roll: f32,
}

impl Deserialize for Euler3D {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(Euler3D {
            yaw: data.read_f32::<LittleEndian>()?,
            pitch: data.read_f32::<LittleEndian>()?,
            roll: data.read_f32::<LittleEndian>()?,
        })
    }
}

#[derive(Debug)]
struct Scenery {
    scenery_type: u16,
    name_index: u16,
    not_placed: u16,
    desired_permutation: u16,
    position: Point3D,
    rotation: Euler3D,
}

impl Deserialize for Scenery {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let scenery = Scenery {
            scenery_type: data.read_u16::<LittleEndian>()?,
            name_index: data.read_u16::<LittleEndian>()?,
            not_placed: data.read_u16::<LittleEndian>()?,
            desired_permutation: data.read_u16::<LittleEndian>()?,
            position: Point3D::deserialize(data)?,
            rotation: Euler3D::deserialize(data)?,
        };
        let _bsp_indices = data.read_u16::<LittleEndian>()?;
        Ok(scenery)
    }
}

impl Deserialize for Scenario {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let _deprecated = TagDependency::deserialize(data)?;
        let _deprecated = TagDependency::deserialize(data)?;
        let _deprecated = TagDependency::deserialize(data)?;
        let skies: Block<TagDependency> = Block::deserialize(data)?;
        let scenario_type = match data.read_u16::<LittleEndian>()? {
            0x0 => ScenarioType::Singleplayer,
            0x1 => ScenarioType::Multiplayer,
            0x2 => ScenarioType::UserInterface,
            _ => return Err(MapReaderError::IO("Invalid scenario type".into())),
        };
        let flags = data.read_u16::<LittleEndian>()?;
        let child_scenarios: Block<TagDependency> = Block::deserialize(data)?;
        let local_north = data.read_f32::<LittleEndian>()?;
        data.seek(SeekFrom::Current(32 * 2))?; // block of predicted_resources
        data.seek(SeekFrom::Current(32 * 2))?; // block of functions
        let _editor_scenario_data = data.read_u32::<LittleEndian>()? as Pointer;
        data.seek(SeekFrom::Current(32 * 2))?; // block of editor comments
        let object_names: Block<ObjectName> = Block::deserialize(data)?;
        let scenery: Block<Scenery> = Block::deserialize(data)?;
        todo!();
    }
}

#[derive(Debug, Clone)]
enum TagData {
    Scenario(Scenario),
    Bitmap(Bitmap),
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

#[derive(Debug, Copy, Clone)]
enum ResourceType {
    Bitmaps = 0x1,
    Sounds = 0x2,
    Localization = 0x3,
}

#[derive(Debug)]
struct ResourcesHeader {
    resource_type: ResourceType,
    paths_offset: Pointer,
    resources_offset: Pointer,
    resource_count: u32,
}

#[derive(Debug)]
struct ResourceHeader {
    path_offset: Pointer,
    size: u32,
    data_offset: Pointer,
    path: Option<String>,
}

impl Deserialize for ResourceHeader {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(ResourceHeader {
            path_offset: data.read_u32::<LittleEndian>()? as Pointer,
            size: data.read_u32::<LittleEndian>()?,
            data_offset: data.read_u32::<LittleEndian>()? as Pointer,
            path: None,
        })
    }
}

impl Deserialize for ResourcesHeader {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(ResourcesHeader {
            resource_type: match data.read_u32::<LittleEndian>()? {
                0x1 => ResourceType::Bitmaps,
                0x2 => ResourceType::Sounds,
                0x3 => ResourceType::Localization,
                x => return Err(MapReaderError::IO(format!("invalid enum {}", x))),
            },
            paths_offset: data.read_u32::<LittleEndian>()? as Pointer,
            resources_offset: data.read_u32::<LittleEndian>()? as Pointer,
            resource_count: data.read_u32::<LittleEndian>()?,
        })
    }
}

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

#[wasm_bindgen]
#[derive(Debug, IntoPrimitive, TryFromPrimitive, Clone, Copy)]
#[repr(u16)]
pub enum BitmapType {
    Tex2D = 0x0,
    Tex3D = 0x1,
    CubeMaps = 0x2,
    Sprites = 0x3,
    InterfaceBitmaps = 0x4,
}

#[wasm_bindgen]
#[derive(Debug, IntoPrimitive, TryFromPrimitive, Clone, Copy)]
#[repr(u16)]
pub enum BitmapEncodingFormat {
    Dxt1 = 0x0,
    Dxt3 = 0x1,
    Dxt5 = 0x2,
    Bit16 = 0x3,
    Bit32 = 0x4,
    Monochrome = 0x5,
}

#[wasm_bindgen]
#[derive(Debug, IntoPrimitive, TryFromPrimitive, Copy, Clone)]
#[repr(u16)]
pub enum BitmapUsage {
    AlphaBlend = 0x0,
    Default = 0x1,
    Heightmap = 0x2,
    Detailmap = 0x3,
    Lightmap = 0x4,
    Vectormap = 0x5,
}

#[derive(Debug, IntoPrimitive, TryFromPrimitive, Copy, Clone)]
#[repr(u16)]
enum BitmapSpriteBudgetSize {
    Sq32x32 = 0x0,
    Sq64x64 = 0x1,
    Sq128x128 = 0x2,
    Sq256x256 = 0x3,
    Sq512x512 = 0x4,
    Sq1024x1024 = 0x5,
    Sq2048x2048 = 0x6,
}

#[derive(Debug, IntoPrimitive, TryFromPrimitive, Copy, Clone)]
#[repr(u16)]
enum BitmapSpriteUsage {
    BlendAddSubtractMax = 0x0,
    MultiplyMin = 0x1,
    DoubleMultiply = 0x2,
}
#[derive(Debug, Clone)]
struct Sprite {
    bitmap_index: u16,
    left: f32,
    right: f32,
    top: f32,
    bottom: f32,
    registration_point: Point2D,
}

impl Deserialize for Sprite {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(Sprite{
            bitmap_index: data.read_u16::<LittleEndian>()?,
            left: data.read_f32::<LittleEndian>()?,
            right: data.read_f32::<LittleEndian>()?,
            top: data.read_f32::<LittleEndian>()?,
            bottom: data.read_f32::<LittleEndian>()?,
            registration_point: Point2D::deserialize(data)?,
        })
    }
}

#[derive(Debug, Clone)]
struct BitmapGroup {
    name: String,
    first_bitmap_index: u16,
    bitmap_count: u16,
    sprites: Block<Sprite>,
}

impl Deserialize for BitmapGroup {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(BitmapGroup {
            name: read_null_terminated_string(data)?,
            first_bitmap_index: data.read_u16::<LittleEndian>()?,
            bitmap_count: data.read_u16::<LittleEndian>()?,
            sprites: Block::deserialize(data)?,
        })
    }
}

#[derive(Debug, IntoPrimitive, TryFromPrimitive, Copy, Clone)]
#[repr(u32)]
enum BitmapClass {
    None = 0xFFFFFFFF,
    Null = 0x0,
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
    UiWidgetDefinition = 0x44654C61,
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
    UiWidgetCollection = 0x536F756C,
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

#[derive(Debug, IntoPrimitive, TryFromPrimitive, Copy, Clone)]
#[repr(u16)]
enum BitmapDataType {
    Tex2D = 0x0,
    Tex3D = 0x1,
    CubeMap = 0x2,
    White = 0x3,
}

#[derive(Debug, IntoPrimitive, TryFromPrimitive, Copy, Clone)]
#[repr(u16)]
enum BitmapFormat {
    A8 = 0x0,
    Y8 = 0x1,
    Ay8 = 0x2,
    A8y8 = 0x3,
    Unused1 = 0x4,
    Unused2 = 0x5,
    R5g6b5 = 0x6,
    Unused3 = 0x7,
    A1r5g5b5 = 0x8,
    A4r4g4b4 = 0x9,
    X8r8g8b8 = 0xA,
    A8r8g8b8 = 0xB,
    Unused4 = 0xC,
    Unused5 = 0xD,
    Dxt1 = 0xE,
    Dxt3 = 0xF,
    Dxt5 = 0x10,
    P8Bump = 17,
    P8 = 18,
    ARGBFP32 = 19,
    RGBFP32 = 20,
    RGBFP16 = 21,
    U8V8 = 22,
}

#[derive(Debug, Clone)]
struct BitmapData {
    bitmap_class: BitmapClass,
    width: u16,
    height: u16,
    depth: u16,
    bitmap_type: BitmapDataType,
    format: BitmapFormat,
    flags: u16,
    registration_point: Point2DInt,
    mipmap_count: u16,
    pixel_data_offset: Pointer,
    pixel_data_size: u32,
    bitmap_tag_id: u32,
    pointer: Pointer,
}

impl BitmapData {
    fn is_external(&self) -> bool {
        (self.flags & 0x100) > 0
    }
}

impl Deserialize for BitmapData {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let bitmap_class = BitmapClass::try_from(data.read_u32::<LittleEndian>()?)?;
        let width = data.read_u16::<LittleEndian>()?;
        let height = data.read_u16::<LittleEndian>()?;
        let depth = data.read_u16::<LittleEndian>()?;
        let bitmap_type = BitmapDataType::try_from(data.read_u16::<LittleEndian>()?)?;
        let format = BitmapFormat::try_from(data.read_u16::<LittleEndian>()?)?;
        let flags = data.read_u16::<LittleEndian>()?;
        let registration_point = Point2DInt::deserialize(data)?;
        let mipmap_count = data.read_u16::<LittleEndian>()?;
        data.seek(SeekFrom::Current(2))?;
        let pixel_data_offset = data.read_u32::<LittleEndian>()? as Pointer;
        let pixel_data_size = data.read_u32::<LittleEndian>()?;
        let bitmap_tag_id = data.read_u32::<LittleEndian>()?;
        let pointer = data.read_u32::<LittleEndian>()? as Pointer;
        data.seek(SeekFrom::Current(8))?;
        Ok(BitmapData {
            bitmap_class,
            width,
            height,
            depth,
            bitmap_type,
            format,
            flags,
            registration_point,
            mipmap_count,
            pixel_data_offset,
            pixel_data_size,
            bitmap_tag_id,
            pointer,
        })
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct Bitmap {
    pub bitmap_type: BitmapType,
    pub encoding_format: BitmapEncodingFormat,
    pub usage: BitmapUsage,
    pub flags: u16,
    /*
    pub detail_fade_factor: f32,
    pub sharpen_amount: f32,
    pub bump_height: f32,
    sprite_budget_size: BitmapSpriteBudgetSize,
    sprite_budget_count: u16,
    pub color_plate_width: u16, // non-cached
    pub color_plate_height: u16, // non-cached
    compressed_color_plate_pointer: Pointer, // non-cached
    processed_pixel_data: Pointer, // non-cached
    pub blur_filter_size: f32,
    pub alpha_bias: f32,
    */
    pub mipmap_count: u16,
    sprite_usage: BitmapSpriteUsage,
    sprite_spacing: u16,
    bitmap_group_sequence: Block<BitmapGroup>,
    data: Block<BitmapData>,
}

impl Deserialize for Bitmap {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let start = data.position();
        let bitmap_type = BitmapType::try_from(data.read_u16::<LittleEndian>()?)?;
        let encoding_format = BitmapEncodingFormat::try_from(data.read_u16::<LittleEndian>()?)?;
        let usage = BitmapUsage::try_from(data.read_u16::<LittleEndian>()?)?;
        let flags = data.read_u16::<LittleEndian>()?;
        let detail_fade_factor = data.read_f32::<LittleEndian>()?;
        let sharpen_amount = data.read_f32::<LittleEndian>()?;
        let bump_height = data.read_f32::<LittleEndian>()?;
        let sprite_budget_size = BitmapSpriteBudgetSize::try_from(data.read_u16::<LittleEndian>()?)?;
        let sprite_budget_count = data.read_u16::<LittleEndian>()?;
        let color_plate_width = data.read_u16::<LittleEndian>()?; // non-cache
        let color_plate_height = data.read_u16::<LittleEndian>()?; // non-cache
        let compressed_color_plate_pointer = data.read_u32::<LittleEndian>()? as Pointer; // non-cache
        let processed_pixel_data = data.read_u32::<LittleEndian>()? as Pointer; // non-cache
        let blur_filter_size = data.read_f32::<LittleEndian>()?;
        let alpha_bias = data.read_f32::<LittleEndian>()?;
        let mipmap_count = data.read_u16::<LittleEndian>()?;
        let sprite_usage = BitmapSpriteUsage::try_from(data.read_u16::<LittleEndian>()?)?;
        let sprite_spacing = data.read_u16::<LittleEndian>()?;
        data.seek(SeekFrom::Start(start + 84))?;
        let bitmap_group_sequence = Block::deserialize(data)?;
        data.seek(SeekFrom::Start(start + 96))?;
        let data = Block::deserialize(data)?;
        Ok(Bitmap { bitmap_type, encoding_format, usage, flags, mipmap_count, sprite_usage, sprite_spacing, bitmap_group_sequence, data })
    }
}

#[derive(Debug, Copy, Clone)]
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

#[derive(Debug, IntoPrimitive, TryFromPrimitive, Copy, Clone)]
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

#[wasm_bindgen]
#[derive(Debug, Clone)]
struct TagHeader {
    primary_class: TagClass,
    secondary_class: TagClass,
    tertiary_class: TagClass,
    tag_id: u32,
    tag_path: u32,
    tag_data: u32,
    indexed: u32, // seems to always be 0 in bloodgulch

    path: String // read in after deserialization
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
            path: String::new(),
        };
        data.seek(SeekFrom::Current(0x4))?;
        Ok(tag)
    }
}

#[derive(Debug, Clone)]
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

    fn read_bloodgulch() -> Vec<u8> {
        std::fs::read("test_data/bloodgulch.map").unwrap()
    }

    fn read_bitmaps() -> Vec<u8> {
        std::fs::read("test_data/bitmaps.map").unwrap()
    }

    #[test]
    fn test() {
        let mut mgr = MapManager::new(read_bloodgulch(), read_bitmaps()).unwrap();
        let bitmaps = mgr.get_bitmaps().unwrap();
        dbg!(&bitmaps[0]);
        let data = mgr.read_bitmap_data(&bitmaps[0], 0).unwrap();
        dbg!(&data[0..10]);
    }
}