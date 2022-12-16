use std::convert::TryInto;

use js_sys::Float32Array;
use js_sys::Uint16Array;
use wasm_bindgen::prelude::*;
use js_sys::{Array, Uint8Array};

use crate::halo::map::*;
use crate::halo::scenario::*;
use crate::halo::common::*;
use crate::halo::bitmap::*;
use crate::halo::tag::*;

use super::shader::ShaderEnvironment;

#[wasm_bindgen]
struct HaloSceneManager {
    mgr: MapManager,
    scenario: Scenario,
    bsps: Vec<Tag>,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Default)]
pub struct Material {
    indices: Vec<u16>,
    vertices: Vec<f32>,
    normals: Vec<f32>,
    uvs: Vec<f32>,
    bitmap_data: Vec<u8>,
    pub bitmap_metadata: Option<BitmapMetadata>,
    pub num_indices: usize,
}
#[wasm_bindgen]
#[derive(Debug, Clone, Copy)]
pub struct BitmapMetadata {
    pub width: u16,
    pub height: u16,
    pub format: BitmapFormat,
}

#[wasm_bindgen]
impl Material {
    pub fn get_indices(&self) -> Uint16Array {
        Uint16Array::from(&self.indices[..])
    }

    pub fn get_vertices(&self) -> Float32Array {
        Float32Array::from(&self.vertices[..])
    }

    pub fn get_normals(&self) -> Float32Array {
        Float32Array::from(&self.normals[..])
    }

    pub fn get_uvs(&self) -> Float32Array {
        Float32Array::from(&self.uvs[..])
    }

    pub fn get_bitmap_data(&self) -> Uint8Array {
        Uint8Array::from(&self.bitmap_data[..])
    }

    pub fn has_bitmap(&self) -> bool {
        self.bitmap_metadata.is_some()
    }
}

#[wasm_bindgen]
impl HaloSceneManager {
    pub fn new(map_data: Vec<u8>, bitmap_data: Vec<u8>) -> Self {
        let mut mgr = MapManager::new(map_data, bitmap_data).unwrap();
        let scenario_tag = mgr.get_scenario().unwrap();
        let bsps = mgr.get_scenario_bsps(&scenario_tag).unwrap();
        let scenario = match scenario_tag.data {
            TagData::Scenario(scenario) => scenario,
            _ => unreachable!(),
        };
        HaloSceneManager {
            mgr,
            scenario,
            bsps,
        }
    }

    pub fn get_materials(&mut self) -> Array {
        let mut result: Vec<Material> = Vec::new();
        for bsp_tag in &self.bsps {
            let bsp: &BSP = (&bsp_tag.data).try_into().unwrap();
            let surfaces = bsp.surfaces.items.as_ref().unwrap();
            for lightmap in bsp.lightmaps.items.as_ref().unwrap().iter() {
                for material in lightmap.materials.items.as_ref().unwrap().iter() {
                    let mut bundle = Material::default();

                    let shader_hdr = self.mgr.resolve_dependency(&material.shader).unwrap().clone();
                    match &shader_hdr.primary_class {
                        TagClass::ShaderEnvironment => {
                            let shader_tag = self.mgr.read_tag(&shader_hdr).unwrap();
                            let shader: &ShaderEnvironment = (&shader_tag.data).try_into().unwrap();
                            let bitmap_hdr = self.mgr.resolve_dependency(&shader.base_bitmap).unwrap().clone();
                            let bitmap_tag = self.mgr.read_tag(&bitmap_hdr).unwrap();
                            bundle.bitmap_data = self.mgr.read_bitmap_data(&bitmap_tag, 0).unwrap();
                            match bitmap_tag.data {
                                TagData::Bitmap(x) => {
                                    let bitmap_data = &x.data.items.unwrap()[0];
                                    bundle.bitmap_metadata = Some(BitmapMetadata {
                                        height: bitmap_data.height,
                                        width: bitmap_data.width,
                                        format: bitmap_data.format,
                                    });
                                },
                                _ => unreachable!(),
                            };
                        }
                        _ => {},
                    }
                    for vert in material.rendered_vertices.items.as_ref().unwrap().iter() {
                        bundle.vertices.extend_from_slice(&[vert.position.i, vert.position.j, vert.position.k]);
                        bundle.normals.extend_from_slice(&[vert.normal.i, vert.normal.j, vert.normal.k]);
                        bundle.uvs.extend_from_slice(&[vert.u, vert.v]);
                    }
                    bundle.num_indices = material.surface_count as usize;
                    let start = material.surfaces as usize;
                    let end = start + bundle.num_indices;
                    for tri in &surfaces[start..end] {
                        bundle.indices.extend_from_slice(&[tri.v0, tri.v1, tri.v2]);
                    }
                    result.push(bundle);
                }
            }
        }
        result.iter().cloned().map(JsValue::from).collect()
    }
}