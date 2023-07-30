
use wasm_bindgen::prelude::wasm_bindgen;
use crate::unity::asset::*;
use crate::unity::reader::*;

#[wasm_bindgen(getter_with_clone)]
#[derive(Debug)]
pub struct UnityTexture2D {
    pub name: String,
    pub forced_fallback_format: u32,
    pub downscale_fallback: bool,
    pub width: u32,
    pub height: u32,
    pub mipmap_count: u32,
    pub texture_format: u32,
    pub color_space: u32,
    pub texture_settings: UnityTextureSettings,
    pub image_data: Vec<u8>,
    pub streaming_info: UnityStreamingInfo,
}

impl UnityTexture2D {
    pub fn get_streaming_info(&self) -> Option<UnityStreamingInfo> {
        if self.streaming_info.path.is_empty() {
            None
        } else {
            Some(self.streaming_info.clone())
        }
    }
}

impl Deserialize for UnityTexture2D {
    fn deserialize(reader: &mut AssetReader, asset: &AssetInfo) -> Result<Self> {
        let name = reader.read_char_array()?;
        let forced_fallback_format = reader.read_u32()?;
        let downscale_fallback = reader.read_bool()?;
        // TODO(jstpierre): IsAlphaChannelOptional (?)
        reader.align()?;
        let width = reader.read_u32()?;
        let height = reader.read_u32()?;
        let _complete_image_size = reader.read_u32()?;
        let texture_format = reader.read_u32()?;
        let mipmap_count = reader.read_u32()?;
        let _is_readable = reader.read_bool()?;
        let _is_preprocessed = reader.read_bool()?;
        let _is_ignore_master_texture_limit = reader.read_bool()?;
        let _is_streaming_mipmaps = reader.read_bool()?;
        reader.align()?;
        let _streaming_mipmaps_priority = reader.read_u32()?;
        reader.align()?;
        let _image_count = reader.read_u32()?;
        let _dimension = reader.read_u32()?;
        let texture_settings = UnityTextureSettings::deserialize(reader, asset)?;
        let _usage_mode = reader.read_u32()?;
        let color_space = reader.read_u32()?;

        let image_data = reader.read_byte_array()?;
        reader.align()?;
        let streaming_info = UnityStreamingInfo::deserialize(reader, asset)?;
        Ok(UnityTexture2D {
            name,
            forced_fallback_format,
            downscale_fallback,
            width,
            height,
            mipmap_count,
            texture_format,
            color_space,
            texture_settings,
            streaming_info,
            image_data,
        })
    }
}

#[wasm_bindgen]
impl UnityTexture2D {
    pub fn from_bytes(data: Vec<u8>, asset: &AssetInfo) -> std::result::Result<UnityTexture2D, String> {
        let mut reader = AssetReader::new(data);
        reader.set_endianness(asset.header.endianness);
        UnityTexture2D::deserialize(&mut reader, asset).map_err(|err| format!("{:?}", err))
    }
}

#[wasm_bindgen]
#[derive(Debug)]
pub enum UnityTextureFilterMode {
    Nearest = 0,
    Bilinear = 1,
    Trilinear = 2,
}

#[wasm_bindgen]
#[derive(Debug)]
pub enum UnityTextureWrapMode {
    Repeat = 0,
    Clamp = 1,
    Mirror = 2,
    MirrorOnce = 3,
}

#[wasm_bindgen]
#[derive(Debug)]
pub enum UnityTextureFormat {
    Alpha8       = 0x01,
    RGB24        = 0x03,
    RGBA32       = 0x04,
    ARGB32       = 0x05,
    BC1          = 0x0A,
    BC2          = 0x0B,
    BC3          = 0x0C,
    DXT1Crunched = 0x1C,
}

#[wasm_bindgen]
pub enum UnityColorSpace {
    Linear = 0x00,
    SRGB   = 0x01,
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct UnityTextureSettings {
    pub filter_mode: u32,
    pub aniso: u32,
    pub mip_bias: f32,
    pub wrap_u: u32,
    pub wrap_v: u32,
    pub wrap_w: u32,
}

impl Deserialize for UnityTextureSettings {
    fn deserialize(reader: &mut AssetReader, _asset: &AssetInfo) -> Result<Self> {
        let filter_mode = reader.read_u32()?;
        let aniso = reader.read_u32()?;
        let mip_bias = reader.read_f32()?;
        let wrap_u = reader.read_u32()?;
        let wrap_v = reader.read_u32()?;
        let wrap_w = reader.read_u32()?;

        Ok(UnityTextureSettings {
            filter_mode,
            aniso,
            mip_bias,
            wrap_u,
            wrap_v,
            wrap_w,
        })
    }
}
