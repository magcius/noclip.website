use std::convert::TryInto;

use js_sys::Float32Array;
use js_sys::Uint16Array;
use wasm_bindgen::prelude::*;
use js_sys::{Array, Uint8Array};
use web_sys::console;

use crate::halo::map::*;
use crate::halo::scenario::*;
use crate::halo::common::*;
use crate::halo::bitmap::*;
use crate::halo::tag::*;

use super::shader::ShaderEnvironment;

#[wasm_bindgen]
pub struct HaloSceneManager {
    mgr: MapManager,
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloMaterial {
    inner: BSPMaterial,
}

#[wasm_bindgen]
impl HaloMaterial {
    fn new(material: &BSPMaterial) -> HaloMaterial {
        HaloMaterial {
            inner: material.clone(),
        }
    }

    pub fn get_num_indices(&self) -> i32 {
        self.inner.surface_count * 3
    }

    pub fn get_index_offset(&self) -> i32 {
        self.inner.surfaces * 3
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloMaterialShader {
    inner: ShaderEnvironment,
    base_bitmap: Bitmap,
    bump_map: Option<Bitmap>,
    primary_detail_bitmap: Option<Bitmap>,
    secondary_detail_bitmap: Option<Bitmap>,
}

#[wasm_bindgen]
impl HaloMaterialShader {
    pub fn get_base_bitmap(&self) -> HaloBitmap {
        HaloBitmap::new(self.base_bitmap.clone())
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloLightmap {
    inner: BSPLightmap,
}

#[wasm_bindgen]
impl HaloLightmap {
    fn new(lightmap: &BSPLightmap) -> HaloLightmap {
        HaloLightmap {
            inner: lightmap.clone(),
        }
    }

    pub fn get_bitmap_index(&self) -> u16 {
        self.inner.bitmap
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloBSP {
    inner: BSP,
    lightmaps_bitmap: Bitmap,
}

#[wasm_bindgen]
impl HaloBSP {
    fn new(bsp: BSP, lightmaps_bitmap: Bitmap) -> HaloBSP {
        HaloBSP { inner: bsp, lightmaps_bitmap }
    }

    pub fn get_lightmaps_bitmap(&self) -> HaloBitmap {
        HaloBitmap::new(self.lightmaps_bitmap.clone())
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct HaloBitmap {
    inner: Bitmap,
}

#[wasm_bindgen]
impl HaloBitmap {
    fn new(inner: Bitmap) -> Self {
        HaloBitmap { inner }
    }

    pub fn get_metadata_for_index(&self, index: usize) -> HaloBitmapMetadata {
        HaloBitmapMetadata::new(&self.inner.data.items.as_ref().unwrap()[index])
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy)]
pub struct HaloBitmapMetadata {
    pub height: u16,
    pub width: u16,
    pub format: BitmapFormat,
}

#[wasm_bindgen]
impl HaloBitmapMetadata {
    fn new(data: &BitmapData) -> Self {
        HaloBitmapMetadata {
            height: data.height,
            width: data.width,
            format: data.format,
        }
    }
}

#[wasm_bindgen]
impl HaloSceneManager {
    pub fn new(map_data: Vec<u8>, bitmap_data: Vec<u8>) -> Self {
        let mgr = MapManager::new(map_data, bitmap_data).unwrap();
        HaloSceneManager { mgr }
    }

    pub fn get_bsps(&mut self) -> Array {
        let scenario_tag = self.mgr.get_scenario().unwrap();
        let bsps: Vec<BSP> = self.mgr.get_scenario_bsps(&scenario_tag).unwrap().iter()
            .map(|tag| match &tag.data {
                TagData::BSP(bsp) => bsp.clone(),
                _ => unreachable!(),
            }).collect();
        let result = Array::new();
        for bsp in &bsps {
            let lightmaps_bitmap = self.resolve_bitmap_dependency(&bsp.lightmaps_bitmap).unwrap();
            result.push(&JsValue::from(HaloBSP::new(bsp.clone(), lightmaps_bitmap)));
        }
        result
    }

    pub fn get_bsp_lightmaps(&self, bsp: &HaloBSP) -> Array {
        bsp.inner.lightmaps.items.as_ref().unwrap().iter()
            .map(|lightmap| JsValue::from(HaloLightmap::new(lightmap)))
            .collect()
    }

    pub fn get_lightmap_materials(&self, lightmap: &HaloLightmap) -> Array {
        lightmap.inner.materials.items.as_ref().unwrap().iter()
            .map(|material| JsValue::from(HaloMaterial::new(material)))
            .collect()
    }

    pub fn get_bsp_indices(&self, bsp: &HaloBSP) -> Vec<u16> {
        let mut indices = Vec::new();
        for tri in bsp.inner.surfaces.items.as_ref().unwrap() {
            indices.extend_from_slice(&[tri.v0, tri.v1, tri.v2]);
        }
        indices
    }

    fn resolve_bitmap_dependency(&mut self, dependency: &TagDependency) -> Option<Bitmap> {
        let hdr = match self.mgr.resolve_dependency(dependency) {
            Some(hdr) => hdr.clone(),
            None => return None,
        };
        match self.mgr.read_tag(&hdr).unwrap().data {
            TagData::Bitmap(bitmap) => Some(bitmap),
            _ => unreachable!(),
        }
    }

    pub fn get_material_shader(&mut self, material: &HaloMaterial) -> Option<HaloMaterialShader> {
        let shader_hdr = self.mgr.resolve_dependency(&material.inner.shader).unwrap().clone();
        match &shader_hdr.primary_class {
            TagClass::ShaderEnvironment => {
                let shader_tag = self.mgr.read_tag(&shader_hdr).unwrap();
                let shader: &ShaderEnvironment = (&shader_tag.data).try_into().unwrap();
                if shader.base_bitmap.path_pointer == 0 {
                    return None;
                }
                Some(HaloMaterialShader {
                    base_bitmap: self.resolve_bitmap_dependency(&shader.base_bitmap).unwrap(),
                    bump_map: self.resolve_bitmap_dependency(&shader.bump_map),
                    primary_detail_bitmap: self.resolve_bitmap_dependency(&shader.primary_detail_bitmap),
                    secondary_detail_bitmap: self.resolve_bitmap_dependency(&shader.secondary_detail_bitmap),
                    inner: shader.clone(),
                })
            }
            _ => None,
        }
    }

    pub fn get_bitmap_data(&mut self, bitmap: &HaloBitmap, index: usize) -> Vec<u8> {
        self.mgr.read_bitmap_data(&bitmap.inner, index).unwrap()
    }

    pub fn get_material_vertex_data(&mut self, material: &HaloMaterial, bsp: &HaloBSP) -> Vec<u8> {
        let offset = bsp.inner.header.as_ref().unwrap().rendered_vertices_offset + material.inner.rendered_vertices.base_pointer;
        let count = material.inner.rendered_vertices.count;
        let item_size = 56; // position + normal + binormal + tangent + uv
        self.mgr.read_map_bytes(offset as u64, count * item_size).unwrap()
    }

    pub fn get_material_lightmap_data(&mut self, material: &HaloMaterial, bsp: &HaloBSP) -> Vec<u8> {
        let offset = bsp.inner.header.as_ref().unwrap().rendered_vertices_offset + material.inner.lightmap_vertices.base_pointer;
        let count = material.inner.rendered_vertices.count;
        let item_size = 20; // normal + uv
        self.mgr.read_map_bytes(offset as u64, count * item_size).unwrap()
    }
}