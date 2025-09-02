use js_sys::Array;
use wasm_bindgen::prelude::*;

use crate::halo::map::*;
use crate::halo::scenario::*;
use crate::halo::bitmap::*;
use crate::halo::tag::*;
use crate::halo::model::*;

#[wasm_bindgen]
pub struct HaloSceneManager {
    mgr: MapManager,
}

#[wasm_bindgen(js_class = "HaloSceneManager")]
impl HaloSceneManager {
    pub fn new(map_data: Vec<u8>) -> Self {
        let mgr = MapManager::new(map_data).unwrap();
        HaloSceneManager { mgr }
    }

    fn get_shader(&mut self, shader_hdr: TagHeader) -> JsValue {
        match self.mgr.read_tag(&shader_hdr) {
            Ok(tag) => match tag.data {
                TagData::ShaderEnvironment(s) if s.base_bitmap.path_pointer != 0 => {
                    JsValue::from(s)
                },
                TagData::ShaderModel(s) => JsValue::from(s),
                TagData::ShaderTransparentGeneric(s) => JsValue::from(s),
                TagData::ShaderTransparentChicago(s) => JsValue::from(s),
                TagData::ShaderTransparentWater(s) => JsValue::from(s),
                _ => JsValue::NULL,
            },
            Err(_) => JsValue::NULL,
        }
    }

    pub fn get_model_shaders(&mut self, model: &GbxModel) -> Array {
        let result = Array::new();
        for model_shader in model.shaders.items.as_ref().unwrap() {
            // FIXME do we need the permutation value?
            let shader_hdr = self.mgr.resolve_dependency(&model_shader.shader).unwrap();
            let js_value = self.get_shader(shader_hdr);
            result.push(&js_value);
        }
        result
    }

    pub fn get_material_shader(&mut self, material: &BSPMaterial) -> JsValue {
        let shader_hdr = self.mgr.resolve_dependency(&material.shader).unwrap();
        self.get_shader(shader_hdr)
    }

    pub fn get_model_parts(&mut self, model: &GbxModel) -> Vec<GbxModelPart> {
        let mut result = Vec::new();
        for geometry in model.geometries.items.as_ref().unwrap() {
            for part in geometry.parts.items.as_ref().unwrap() {
                result.push(part.clone());
            }
        }
        result
    }

    pub fn get_scenery_model(&mut self, scenery: &Scenery) -> Option<GbxModel> {
        self.resolve_model_dependency(&scenery.model)
    }

    pub fn get_scenery_palette(&mut self) -> Vec<Scenery> {
        let scenario_tag = self.mgr.get_scenario().unwrap();
        let scenario = match scenario_tag.data {
            TagData::Scenario(s) => s,
            _ => unreachable!(),
        };
        let mut result = Vec::new();
        for palette_entry in scenario.scenery_palette.items.as_ref().unwrap() {
            let scenery_header = self.mgr.resolve_dependency(&palette_entry.obj).unwrap();
            let scenery_tag = self.mgr.read_tag(&scenery_header).unwrap();
            match scenery_tag.data {
                TagData::Scenery(s) => result.push(s),
                _ => unreachable!(),
            };
        }
        result
    }

    pub fn get_scenery_instances(&mut self) -> Vec<ScenarioScenery> {
        let scenario_tag = self.mgr.get_scenario().unwrap();
        let TagData::Scenario(scenario) = scenario_tag.data else {
            unreachable!();
        };
        scenario.scenery.items.as_ref().cloned().unwrap()
    }

    pub fn get_skies(&mut self) -> Vec<Sky> {
        let mut result = Vec::new();
        let TagData::Scenario(scenario_data) = self.mgr.get_scenario().unwrap().data else {
            unreachable!();
        };
        for dependency in scenario_data.skies.items.as_ref().unwrap() {
            let sky_header = self.mgr.resolve_dependency(dependency).unwrap();
            match self.mgr.read_tag(&sky_header).unwrap().data {
                TagData::Sky(s) => {
                    result.push(s);
                },
                _ => unreachable!(),
            }
        }
        result
    }

    pub fn get_bsps(&mut self) -> Vec<BSP> {
        let scenario_tag = self.mgr.get_scenario().unwrap();
        self.mgr.get_scenario_bsps(&scenario_tag).unwrap().iter()
            .map(|tag| match &tag.data {
                TagData::BSP(bsp) => bsp.clone(),
                _ => unreachable!(),
            }).collect()
    }

    pub fn get_bsp_lightmaps(&self, bsp: &BSP) -> Vec<BSPLightmap> {
        bsp.lightmaps.items.as_ref().cloned().unwrap()
    }

    pub fn get_lightmap_materials(&self, lightmap: &BSPLightmap) -> Vec<BSPMaterial> {
        lightmap.materials.items.as_ref().cloned().unwrap()
    }

    pub fn get_model_part_indices(&mut self, part: &GbxModelPart) -> Vec<u16> {
        let offset = part.tri_offset + self.mgr.tag_index_header.model_data_file_offset + self.mgr.tag_index_header.vertex_data_size;
        let count = part.tri_count();
        self.mgr.read_map_u16s(offset as u64, count as usize).unwrap()
    }

    pub fn get_model_part_vertices(&mut self, part: &GbxModelPart) -> Vec<u8> {
        let offset = part.vert_offset + self.mgr.tag_index_header.model_data_file_offset;
        let count = part.vert_count;
        let item_size = 68;
        self.mgr.read_map_bytes(offset as u64, item_size * count as usize).unwrap()
    }

    pub fn get_bsp_indices(&self, bsp: &BSP) -> Vec<u16> {
        let mut indices = Vec::new();
        for tri in bsp.surfaces.items.as_ref().unwrap() {
            indices.extend_from_slice(&[tri.v0, tri.v1, tri.v2]);
        }
        indices
    }

    pub fn resolve_model_dependency(&mut self, dependency: &TagDependency) -> Option<GbxModel> {
        let hdr = self.mgr.resolve_dependency(dependency)?;
        match self.mgr.read_tag(&hdr).unwrap().data {
            TagData::GbxModel(model) => Some(model),
            _ => unreachable!(),
        }
    }

    pub fn resolve_bitmap_dependency(&mut self, dependency: &TagDependency) -> Option<Bitmap> {
        let hdr = self.mgr.resolve_dependency(dependency)?;
        match self.mgr.read_tag(&hdr).unwrap().data {
            TagData::Bitmap(bitmap) => Some(bitmap),
            _ => unreachable!(),
        }
    }

    pub fn get_and_convert_bitmap_data(&mut self, bitmap: &Bitmap, submap: usize) -> Vec<u8> {
        let bitmap_data = &bitmap.data.items.as_ref().unwrap()[submap];
        get_and_convert_bitmap_data(&mut self.mgr.reader.data, bitmap_data)
    }

    pub fn get_material_vertex_data(&mut self, material: &BSPMaterial, bsp: &BSP) -> Vec<u8> {
        let offset = bsp.header.as_ref().unwrap().rendered_vertices_offset + material.rendered_vertices.base_pointer;
        let count = material.rendered_vertices.count;
        let item_size = 56; // position + normal + binormal + tangent + uv
        self.mgr.read_map_bytes(offset as u64, count as usize * item_size).unwrap()
    }

    pub fn get_material_lightmap_data(&mut self, material: &BSPMaterial, bsp: &BSP) -> Vec<u8> {
        let offset = bsp.header.as_ref().unwrap().rendered_vertices_offset + material.lightmap_vertices.base_pointer;
        let count = material.rendered_vertices.count;
        let item_size = 20; // normal + uv
        self.mgr.read_map_bytes(offset as u64, count as usize * item_size).unwrap()
    }
}
