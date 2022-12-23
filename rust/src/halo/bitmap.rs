use std::{io::{Cursor, Seek, SeekFrom}, convert::TryFrom};
use byteorder::{ReadBytesExt, LittleEndian};
use num_enum::{IntoPrimitive, TryFromPrimitive};
use wasm_bindgen::prelude::*;

use crate::halo::common::*;
use crate::halo::util::*;

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
pub enum BitmapSpriteBudgetSize {
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
pub enum BitmapSpriteUsage {
    BlendAddSubtractMax = 0x0,
    MultiplyMin = 0x1,
    DoubleMultiply = 0x2,
}
#[derive(Debug, Clone)]
pub struct Sprite {
    pub bitmap_index: u16,
    pub left: f32,
    pub right: f32,
    pub top: f32,
    pub bottom: f32,
    pub registration_point: Point2D,
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
pub struct BitmapGroup {
    pub name: String,
    pub first_bitmap_index: u16,
    pub bitmap_count: u16,
    pub sprites: Block<Sprite>,
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
pub enum BitmapClass {
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

#[wasm_bindgen]
#[derive(Debug, IntoPrimitive, TryFromPrimitive, Copy, Clone)]
#[repr(u16)]
pub enum BitmapDataType {
    Tex2D = 0x0,
    Tex3D = 0x1,
    CubeMap = 0x2,
    White = 0x3,
}

#[wasm_bindgen]
#[derive(Debug, IntoPrimitive, TryFromPrimitive, Copy, Clone)]
#[repr(u16)]
pub enum BitmapFormat {
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

impl BitmapFormat {
    // bytes per texel
    pub fn pitch(&self) -> u32 {
        use BitmapFormat::*;
        match self {
            A8 | Ay8 | P8 | P8Bump | Y8 => 1,
            A8r8g8b8 | X8r8g8b8 => 4,
            _ => 2,
        }
    }
}

#[derive(Debug, Clone)]
pub struct BitmapData {
    pub bitmap_class: BitmapClass,
    pub width: u16,
    pub height: u16,
    pub depth: u16,
    pub bitmap_type: BitmapDataType,
    pub format: BitmapFormat,
    pub flags: u16,
    pub registration_point: Point2DInt,
    pub mipmap_count: u16,
    pub pixel_data_offset: Pointer,
    pub pixel_data_size: u32,
    pub bitmap_tag_id: u32,
    pub pointer: Pointer,
}

impl BitmapData {
    pub fn is_external(&self) -> bool {
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
    pub sprite_usage: BitmapSpriteUsage,
    pub sprite_spacing: u16,
    pub bitmap_group_sequence: Block<BitmapGroup>,
    pub data: Block<BitmapData>,
}

impl Bitmap {
    pub fn get_dimensions(&self) -> (u32, u32) {
        todo!();
    }
}

impl Deserialize for Bitmap {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        let start = data.position();
        let bitmap_type = BitmapType::try_from(data.read_u16::<LittleEndian>()?)?;
        let encoding_format = BitmapEncodingFormat::try_from(data.read_u16::<LittleEndian>()?)?;
        let usage = BitmapUsage::try_from(data.read_u16::<LittleEndian>()?)?;
        let flags = data.read_u16::<LittleEndian>()?;
        let _detail_fade_factor = data.read_f32::<LittleEndian>()?;
        let _sharpen_amount = data.read_f32::<LittleEndian>()?;
        let _bump_height = data.read_f32::<LittleEndian>()?;
        let _sprite_budget_size = BitmapSpriteBudgetSize::try_from(data.read_u16::<LittleEndian>()?)?;
        let _sprite_budget_count = data.read_u16::<LittleEndian>()?;
        let _color_plate_width = data.read_u16::<LittleEndian>()?; // non-cache
        let _color_plate_height = data.read_u16::<LittleEndian>()?; // non-cache
        let _compressed_color_plate_pointer = data.read_u32::<LittleEndian>()? as Pointer; // non-cache
        let _processed_pixel_data = data.read_u32::<LittleEndian>()? as Pointer; // non-cache
        let _blur_filter_size = data.read_f32::<LittleEndian>()?;
        let _alpha_bias = data.read_f32::<LittleEndian>()?;
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