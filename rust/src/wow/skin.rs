use deku::prelude::*;
use wasm_bindgen::prelude::*;
use super::common::{
    WowArray,
    Vec3,
};

#[wasm_bindgen(js_name = "WowSkinSubmesh")]
#[derive(Debug, DekuRead, Clone)]
pub struct SkinSubmesh {
    pub skin_submesh_id: u16,
    pub level: u16, // (level << 16) is added to index_start to avoid having that field be u32
    pub vertex_start: u16,
    pub vertex_count: u16,
    pub index_start: u16,
    pub index_count: u16,
    pub bone_count: u16,
    pub bone_combo_index: u16,
    pub bone_influences: u16,
    pub center_bone_index: u16,
    pub center_position: Vec3,
    pub sort_center_position: Vec3,
    pub sort_radius: f32,
}

#[wasm_bindgen(js_class = "WowSkinSubmesh")]
impl SkinSubmesh {
    pub fn get_index_start(&self) -> u32 {
        let index_start = self.index_start as u32;
        let level = self.level as u32;
        (index_start + (level << 16)) * 2
    }
}

#[derive(Debug, DekuRead)]
#[deku(magic = b"SKIN")]
pub struct SkinProfile {
    vertices: WowArray<u16>,
    indices: WowArray<u16>,
    _bones: WowArray<[u8; 4]>,
    submeshes: WowArray<SkinSubmesh>,
    batches: WowArray<ModelBatch>,
    pub _bone_count_max: u32,
}

#[wasm_bindgen(js_name = "WowSkin", getter_with_clone)]
#[derive(Debug)]
pub struct Skin {
    pub submeshes: Vec<SkinSubmesh>,
    pub batches: Vec<ModelBatch>,
    indices: Option<Vec<u16>>,
    _profile: SkinProfile,
}

#[wasm_bindgen(js_class = "WowSkin")]
impl Skin {
    pub fn new(data: &[u8]) -> Result<Skin, String> {
        let (_, profile) = SkinProfile::from_bytes((data, 0))
            .map_err(|e| format!("{:?}", e))?;
        let batches = profile.batches.to_vec(data)
            .map_err(|e| format!("{:?}", e))?;
        let submeshes = profile.submeshes.to_vec(data)
            .map_err(|e| format!("{:?}", e))?;

        let global_vertex_indices = profile.vertices.to_vec(data)
            .map_err(|e| format!("{:?}", e))?;
        let local_vertex_indices = profile.indices.to_vec(data)
            .map_err(|e| format!("{:?}", e))?;
        let mut indices = Vec::with_capacity(local_vertex_indices.len());

        for local_idx in local_vertex_indices {
            indices.push(global_vertex_indices[local_idx as usize]);
        }

        Ok(Skin {
            batches,
            submeshes,
            _profile: profile,
            indices: Some(indices),
        })
    }

    pub fn take_indices(&mut self) -> Vec<u16> {
        self.indices.take().expect("Skin indices already taken")
    }
}

#[wasm_bindgen(js_name = "WowVertexShader")]
#[derive(Debug, Clone, Copy)]
pub enum VertexShader {
    DiffuseT1 = 0,
    DiffuseEnv = 1,
    DiffuseT1T2 = 2,
    DiffuseT1Env = 3,
    DiffuseEnvT1 = 4,
    DiffuseEnvEnv = 5,
    DiffuseT1EnvT1 = 6,
    DiffuseT1T1 = 7,
    DiffuseT1T1T1 = 8,
    DiffuseEdgeFadeT1 = 9,
    DiffuseT2 = 10,
    DiffuseT1EnvT2 = 11,
    DiffuseEdgeFadeT1T2 = 12,
    DiffuseEdgeFadeEnv = 13,
    DiffuseT1T2T1 = 14,
    DiffuseT1T2T3 = 15,
    ColorT1T2T3 = 16,
    BWDiffuseT1 = 17,
    BWDiffuseT1T2 = 18,
}

#[wasm_bindgen(js_name = "WowPixelShader")]
#[derive(Debug, Clone, Copy)]
pub enum PixelShader {
    CombinersOpaque = 0,
    CombinersMod = 1,
    CombinersOpaqueMod = 2,
    CombinersOpaqueMod2x = 3,
    CombinersOpaqueMod2xNA = 4,
    CombinersOpaqueOpaque = 5,
    CombinersModMod = 6,
    CombinersModMod2x = 7,
    CombinersModAdd = 8,
    CombinersModMod2xNA = 9,
    CombinersModAddNA = 10,
    CombinersModOpaque = 11,
    CombinersOpaqueMod2xNAAlpha = 12,
    CombinersOpaqueAddAlpha = 13,
    CombinersOpaqueAddAlphaAlpha = 14,
    CombinersOpaqueMod2xNAAlphaAdd = 15,
    CombinersModAddAlpha = 16,
    CombinersModAddAlphaAlpha = 17,
    CombinersOpaqueAlphaAlpha = 18,
    CombinersOpaqueMod2xNAAlpha3s = 19,
    CombinersOpaqueAddAlphaWgt = 20,
    //CombinersModAddAlpha = 21,
    CombinersOpaqueModNAAlpha = 22,
    CombinersModAddAlphaWgt = 23,
    CombinersOpaqueModAddWgt = 24,
    CombinersOpaqueMod2xNAAlphaUnshAlpha = 25,
    CombinersModDualCrossfade = 26,
    CombinersOpaqueMod2xNAAlphaAlpha = 27,
    CombinersModMaskedDualCrossfade = 28,
    CombinersOpaqueAlpha = 29,
    Guild = 30,
    GuildNoBorder = 31,
    GuildOpaque = 32,
    CombinersModDepth = 33,
    Illum = 34,
    CombinersModModModConst = 35,
    NewUnkCombiner = 36
}

static STATIC_SHADERS: [(PixelShader, VertexShader); 36] = [
    (PixelShader::CombinersOpaqueMod2xNAAlpha, VertexShader::DiffuseT1Env),
    (PixelShader::CombinersOpaqueAddAlpha, VertexShader::DiffuseT1Env),
    (PixelShader::CombinersOpaqueAddAlphaAlpha, VertexShader::DiffuseT1Env),
    (PixelShader::CombinersOpaqueMod2xNAAlphaAdd, VertexShader::DiffuseT1EnvT1),
    (PixelShader::CombinersModAddAlpha, VertexShader::DiffuseT1Env),
    (PixelShader::CombinersOpaqueAddAlpha, VertexShader::DiffuseT1T1),
    (PixelShader::CombinersModAddAlpha, VertexShader::DiffuseT1T1),
    (PixelShader::CombinersModAddAlphaAlpha, VertexShader::DiffuseT1Env),
    (PixelShader::CombinersOpaqueAlphaAlpha, VertexShader::DiffuseT1Env),
    (PixelShader::CombinersOpaqueMod2xNAAlpha3s, VertexShader::DiffuseT1EnvT1),
    (PixelShader::CombinersOpaqueAddAlphaWgt, VertexShader::DiffuseT1T1),
    (PixelShader::CombinersModAddAlpha, VertexShader::DiffuseT1Env),
    (PixelShader::CombinersOpaqueModNAAlpha, VertexShader::DiffuseT1Env),
    (PixelShader::CombinersModAddAlphaWgt, VertexShader::DiffuseT1Env),
    (PixelShader::CombinersModAddAlphaWgt, VertexShader::DiffuseT1T1),
    (PixelShader::CombinersOpaqueAddAlphaWgt, VertexShader::DiffuseT1T2),
    (PixelShader::CombinersOpaqueModAddWgt, VertexShader::DiffuseT1Env),
    (PixelShader::CombinersOpaqueMod2xNAAlphaUnshAlpha, VertexShader::DiffuseT1EnvT1),
    (PixelShader::CombinersModDualCrossfade, VertexShader::DiffuseT1),
    (PixelShader::CombinersModDepth, VertexShader::DiffuseEdgeFadeT1),
    (PixelShader::CombinersOpaqueMod2xNAAlphaAlpha, VertexShader::DiffuseT1EnvT2),
    (PixelShader::CombinersModMod, VertexShader::DiffuseEdgeFadeT1T2),
    (PixelShader::CombinersModMaskedDualCrossfade, VertexShader::DiffuseT1T2),
    (PixelShader::CombinersOpaqueAlpha, VertexShader::DiffuseT1T1),
    (PixelShader::CombinersOpaqueMod2xNAAlphaUnshAlpha, VertexShader::DiffuseT1EnvT2),
    (PixelShader::CombinersModDepth, VertexShader::DiffuseEdgeFadeEnv),
    (PixelShader::Guild, VertexShader::DiffuseT1T2T1),
    (PixelShader::GuildNoBorder, VertexShader::DiffuseT1T2),
    (PixelShader::GuildOpaque, VertexShader::DiffuseT1T2T1),
    (PixelShader::Illum, VertexShader::DiffuseT1T1),
    (PixelShader::CombinersModModModConst, VertexShader::DiffuseT1T2T3),
    (PixelShader::CombinersModModModConst, VertexShader::ColorT1T2T3),
    (PixelShader::CombinersOpaque, VertexShader::DiffuseT1),
    (PixelShader::CombinersModMod2x, VertexShader::DiffuseEdgeFadeT1T2),
    (PixelShader::CombinersMod, VertexShader::DiffuseEdgeFadeT1),
    (PixelShader::NewUnkCombiner, VertexShader::DiffuseEdgeFadeT1T2),
];

#[wasm_bindgen(js_name = "WowModelBatch")]
#[derive(Debug, DekuRead, Clone, Copy)]
pub struct ModelBatch {
    pub flags: u8,
    pub priority_plane: u8,
    pub shader_id: u16,
    pub skin_submesh_index: u16,
    pub geoset_index: u16,
    pub color_index: u16,
    pub material_index: u16,
    pub material_layer: u16,
    pub texture_count: u16, // 1-4
    pub texture_combo_index: u16, // index into an M2 texture_lookup_table
    pub texture_coord_combo_index: u16, // index into an M2 texture_mapping_lookup_table
    pub texture_weight_combo_index: u16, // index into an M2 transparency_lookup_table
    pub texture_transform_combo_index: u16,// index into an M2 texture_transforms_lookup_table
}

#[wasm_bindgen(js_class = "WowModelBatch")]
impl ModelBatch {
    pub fn get_pixel_shader(&self) -> PixelShader {
        if self.shader_id & 0x8000 > 0 {
            let shader_idx = self.shader_id as usize & 0x7fff;
            STATIC_SHADERS[shader_idx].0
        } else if self.texture_count == 1 {
            if self.shader_id & 0x70 > 0 {
                PixelShader::CombinersMod
            } else {
                PixelShader::CombinersOpaque
            }
        } else {
            let lower = self.shader_id & 7;
            if self.shader_id & 0x70 > 0 {
                match lower {
                    0 => PixelShader::CombinersModOpaque,
                    3 => PixelShader::CombinersModAdd,
                    4 => PixelShader::CombinersModMod2x,
                    6 => PixelShader::CombinersModMod2xNA,
                    7 => PixelShader::CombinersModAddNA,
                    _ => PixelShader::CombinersModMod,
                }
            } else {
                match lower {
                    0 => PixelShader::CombinersOpaqueOpaque,
                    3 => PixelShader::CombinersOpaqueAddAlpha,
                    4 => PixelShader::CombinersOpaqueMod2x,
                    6 => PixelShader::CombinersOpaqueMod2xNA,
                    7 => PixelShader::CombinersOpaqueAddAlpha,
                    _ => PixelShader::CombinersOpaqueMod,
                }
            }
        }
    }

    pub fn get_vertex_shader(&self) -> VertexShader {
        if self.shader_id & 0x8000 > 0 {
            let shader_idx = self.shader_id as usize & 0x7fff;
            STATIC_SHADERS[shader_idx].1
        } else if self.texture_count == 1 {
            if self.shader_id & 0x80 > 0 {
                VertexShader::DiffuseEnv
            } else if self.shader_id & 0x4000 > 0 {
                VertexShader::DiffuseT2
            } else {
                VertexShader::DiffuseT1
            }
        } else if self.shader_id & 0x80 > 0 {
            if self.shader_id & 0x8 > 0 {
                VertexShader::DiffuseEnvEnv
            } else {
                VertexShader::DiffuseEnvT1
            }
        } else if self.shader_id & 0x8 > 0 {
            VertexShader::DiffuseT1Env
        } else if self.shader_id & 0x4000 > 0 {
            VertexShader::DiffuseT1T2
        } else {
            VertexShader::DiffuseT1T1
        }
    }
}
