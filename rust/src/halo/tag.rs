use std::{io::{Cursor, Seek, SeekFrom}, convert::TryFrom};
use byteorder::{ReadBytesExt, LittleEndian};
use num_enum::{IntoPrimitive, TryFromPrimitive};

use crate::halo::common::*;
use crate::halo::scenario::*;
use crate::halo::bitmap::*;
use crate::halo::shader::*;
use crate::halo::model::*;

#[derive(Debug, Clone)]
pub struct TagDependency {
    pub tag_class: TagClass,
    pub path_pointer: Pointer,
    pub global_id: u32,
    pub tag_id: u32,
}

impl Deserialize for TagDependency {
    fn deserialize(data: &mut Cursor<Vec<u8>>) -> Result<Self> where Self: Sized {
        Ok(TagDependency {
            tag_class: TagClass::deserialize(data)?,
            path_pointer: data.read_u32::<LittleEndian>()?,
            global_id: data.read_u32::<LittleEndian>()?,
            tag_id: data.read_u32::<LittleEndian>()?,
        })
    }
}

#[derive(Debug, IntoPrimitive, TryFromPrimitive, Copy, Clone, PartialEq, Hash, Eq)]
#[repr(u32)]
pub enum TagClass {
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
    GbxModel = 0x6D6F6432,
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

#[derive(Debug, Clone)]
pub struct TagHeader {
    pub primary_class: TagClass,
    pub secondary_class: TagClass,
    pub tertiary_class: TagClass,
    pub tag_id: u32,
    pub tag_path: u32,
    pub tag_data: u32,
    pub indexed: u32, // seems to always be 0 in bloodgulch

    pub path: String, // read in after deserialization
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
pub enum TagData {
    Scenario(Scenario),
    Bitmap(Bitmap),
    BSP(BSP),
    ShaderEnvironment(ShaderEnvironment),
    ShaderModel(ShaderModel),
    ShaderTransparentChicago(ShaderTransparentChicago),
    ShaderTransparentGeneric(ShaderTransparentGeneric),
    ShaderTransparentWater(ShaderTransparentWater),
    Scenery(Scenery),
    Sky(Sky),
    GbxModel(GbxModel),
}

impl<'a> TryFrom<&'a TagData> for &'a Scenario {
    type Error = String;

    fn try_from(data: &'a TagData) -> std::result::Result<Self, Self::Error> {
        match data {
            TagData::Scenario(x) => Ok(x),
            t => Err(format!("invalid tag type: expected Scenario, got {:?}", t))
        }
    }
}

impl<'a> TryFrom<&'a TagData> for &'a Bitmap {
    type Error = String;

    fn try_from(data: &'a TagData) -> std::result::Result<Self, Self::Error> {
        match data {
            TagData::Bitmap(x) => Ok(x),
            t => Err(format!("invalid tag type: expected Bitmap, got {:?}", t))
        }
    }
}

impl<'a> TryFrom<&'a TagData> for &'a BSP {
    type Error = String;

    fn try_from(data: &'a TagData) -> std::result::Result<Self, Self::Error> {
        match data {
            TagData::BSP(x) => Ok(x),
            t => Err(format!("invalid tag type: expected BSP, got {:?}", t))
        }
    }
}
impl<'a> TryFrom<&'a TagData> for &'a ShaderEnvironment {
    type Error = String;

    fn try_from(data: &'a TagData) -> std::result::Result<Self, Self::Error> {
        match data {
            TagData::ShaderEnvironment(x) => Ok(x),
            t => Err(format!("invalid tag type: expected ShaderEnvironment, got {:?}", t))
        }
    }
}

impl<'a> TryFrom<&'a TagData> for &'a Scenery {
    type Error = String;

    fn try_from(data: &'a TagData) -> std::result::Result<Self, Self::Error> {
        match data {
            TagData::Scenery(x) => Ok(x),
            t => Err(format!("invalid tag type: expected Scenery, got {:?}", t))
        }
    }
}

#[derive(Debug, Clone)]
pub struct Tag {
    pub header: TagHeader,
    pub data: TagData,
}