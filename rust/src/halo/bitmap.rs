use std::io::{Cursor, Seek};

use num_enum::{IntoPrimitive, TryFromPrimitive};
use deku::prelude::*;
use wasm_bindgen::prelude::*;
use crate::{halo::common::*, unity::types::common::NullTerminatedAsciiString};
use crate::halo::bitmap_utils;

#[wasm_bindgen(js_name = "HaloBitmapType")]
#[derive(Debug, IntoPrimitive, TryFromPrimitive, Clone, Copy, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum BitmapType {
    Tex2D = 0x0,
    Tex3D = 0x1,
    CubeMaps = 0x2,
    Sprites = 0x3,
    InterfaceBitmaps = 0x4,
}

#[wasm_bindgen(js_name = "HaloBitmapEncodingFormat")]
#[derive(Debug, IntoPrimitive, TryFromPrimitive, Clone, Copy, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum BitmapEncodingFormat {
    Dxt1 = 0x0,
    Dxt3 = 0x1,
    Dxt5 = 0x2,
    Bit16 = 0x3,
    Bit32 = 0x4,
    Monochrome = 0x5,
}

#[wasm_bindgen(js_name = "HaloBitmapUsage")]
#[derive(Debug, IntoPrimitive, TryFromPrimitive, Copy, Clone, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum BitmapUsage {
    AlphaBlend = 0x0,
    Default = 0x1,
    Heightmap = 0x2,
    Detailmap = 0x3,
    Lightmap = 0x4,
    Vectormap = 0x5,
}

#[derive(Debug, IntoPrimitive, TryFromPrimitive, Copy, Clone, DekuRead)]
#[deku(id_type = "u16")]
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

#[wasm_bindgen(js_name = "HaloBitmapSpriteUsage")]
#[derive(Debug, IntoPrimitive, TryFromPrimitive, Copy, Clone, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum BitmapSpriteUsage {
    BlendAddSubtractMax = 0x0,
    MultiplyMin = 0x1,
    DoubleMultiply = 0x2,
}

#[derive(Debug, Clone, DekuRead)]
pub struct Sprite {
    pub bitmap_index: u16,
    pub left: f32,
    pub right: f32,
    pub top: f32,
    pub bottom: f32,
    pub registration_point: Point2D,
}

#[derive(Debug, Clone, DekuRead)]
pub struct BitmapGroup {
    pub name: NullTerminatedAsciiString,
    pub first_bitmap_index: u16,
    pub bitmap_count: u16,
    pub sprites: Block<Sprite>,
}

#[wasm_bindgen(js_name = "HaloBitmapClass")]
#[derive(Debug, IntoPrimitive, TryFromPrimitive, Copy, Clone, DekuRead)]
#[deku(id_type = "u32")]
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
#[derive(Debug, IntoPrimitive, TryFromPrimitive, Copy, Clone, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum BitmapDataType {
    Tex2D = 0x0,
    Tex3D = 0x1,
    CubeMap = 0x2,
    White = 0x3,
}

#[wasm_bindgen]
#[derive(Debug, IntoPrimitive, TryFromPrimitive, Copy, Clone, DekuRead)]
#[deku(id_type = "u16")]
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

#[wasm_bindgen(js_name = "HaloBitmapMetadata")]
#[derive(Debug, Clone, DekuRead)]
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
    #[deku(pad_bytes_before = "2")]
    pub pixel_data_offset: Pointer,
    pub pixel_data_size: u32,
    pub bitmap_tag_id: u32,
    #[deku(pad_bytes_after = "8")]
    pub pointer: Pointer,
}

#[wasm_bindgen(js_class = "HaloBitmapMetadata")]
impl BitmapData {
    pub fn is_external(&self) -> bool {
        (self.flags & 0x100) > 0
    }
}

#[wasm_bindgen(js_name = "HaloBitmap")]
#[derive(Debug, Clone, DekuRead)]
pub struct Bitmap {
    pub bitmap_type: BitmapType,
    pub encoding_format: BitmapEncodingFormat,
    pub usage: BitmapUsage,
    pub flags: u16,
    pub _detail_fade_factor: f32,
    pub _sharpen_amount: f32,
    pub _bump_height: f32,
    _sprite_budget_size: BitmapSpriteBudgetSize,
    _sprite_budget_count: u16,
    pub _color_plate_width: u16, // non-cached
    pub _color_plate_height: u16, // non-cached
    _compressed_color_plate_pointer: Pointer, // non-cached
    _processed_pixel_data: Pointer, // non-cached
    pub _blur_filter_size: f32,
    pub _alpha_bias: f32,
    pub mipmap_count: u16,
    pub sprite_usage: BitmapSpriteUsage,
    pub sprite_spacing: u16,
    #[deku(pad_bytes_before = "34")]
    pub(crate) bitmap_group_sequence: Block<BitmapGroup>,
    pub(crate) data: Block<BitmapData>,
}

#[wasm_bindgen(js_class = "HaloBitmap")]
impl Bitmap {
    pub fn get_metadata_for_index(&self, index: usize) -> BitmapData {
        self.data.items.as_ref().unwrap()[index].clone()
    }

    pub fn get_tag_id(&self) -> u32 {
        self.data.items.as_ref().unwrap()[0].bitmap_tag_id
    }
}

pub fn get_and_convert_bitmap_data(reader: &mut deku::reader::Reader<Cursor<Vec<u8>>>, bitmap_data: &BitmapData) -> Vec<u8> {
    let offset = bitmap_data.pixel_data_offset as u64;
    let length = bitmap_data.pixel_data_size as usize;
    let mut bytes = vec![0; length];
    reader.seek(std::io::SeekFrom::Start(offset)).unwrap();
    reader.read_bytes(length, &mut bytes, deku::ctx::Order::Msb0).unwrap();
    match bitmap_data.format {
        BitmapFormat::P8 | BitmapFormat::P8Bump => bitmap_utils::convert_p8_data(&bytes),
        BitmapFormat::A8r8g8b8 => bitmap_utils::convert_a8r8g8b8_data(&bytes),
        BitmapFormat::X8r8g8b8 => bitmap_utils::convert_x8r8g8b8_data(&bytes),
        BitmapFormat::A8 => bitmap_utils::convert_a8_data(&bytes),
        BitmapFormat::Y8 => bitmap_utils::convert_y8_data(&bytes),
        BitmapFormat::A8y8 => bitmap_utils::convert_a8y8_data(&bytes),
        BitmapFormat::R5g6b5 => bitmap_utils::convert_r5g6b5_data(&bytes),
        _ => bytes,
    }
}
