use deku::prelude::*;
use wasm_bindgen::prelude::*;

use crate::{halo::common::*, unity::types::common::NullTerminatedAsciiString};
use crate::halo::tag::*;

#[derive(Debug, Copy, Clone, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum ObjectType {
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

#[derive(Debug, DekuRead)]
pub struct ObjectName {
    pub name: NullTerminatedAsciiString,
    pub object_type: ObjectType,
    pub index: u16,
}

#[wasm_bindgen(js_name = "HaloSceneryInstance")]
#[derive(Debug, Clone, DekuRead)]
pub struct ScenarioScenery {
    pub scenery_type: u16,
    pub name_index: u16,
    pub not_placed: u32,
    pub position: Point3D,
    pub rotation: Euler3D,
    #[deku(pad_bytes_after = "38")]
    pub _appearance_player_index: u16,
}

#[derive(Debug, Clone, DekuRead)]
pub struct ObjectSwatch {
    #[deku(pad_bytes_after = "32")]
    pub obj: TagDependency,
}

#[derive(Debug, Clone, DekuRead)]
pub struct Scenario {
    #[deku(pad_bytes_before = "48")]
    pub skies: Block<TagDependency>,
    #[deku(pad_bytes_before = "468")]
    pub scenery: Block<ScenarioScenery>,
    pub scenery_palette: Block<ObjectSwatch>,
    #[deku(pad_bytes_before = "156")]
    pub light_fixtures: Block<ScenarioLightFixture>,
    pub light_fixture_palette: Block<ObjectSwatch>,
    #[deku(pad_bytes_before = "204")]
    pub decals: Block<ScenarioDecal>,
    pub decal_palette: Block<ObjectSwatch>,
    pub detail_object_collection_palette: Block<ObjectSwatch>,
    #[deku(pad_bytes_before = "472")]
    pub structure_bsp_references: Block<ScenarioStructureBSPReference>,
}

#[derive(Debug, Clone, DekuRead)]
pub struct ScenarioStructureBSPReference {
    pub start: u32,
    pub size: u32,
    pub address: u32,
    #[deku(pad_bytes_before = "4")]
    pub structure_bsp: TagDependency,
}

#[derive(Debug, Clone, DekuRead)]
pub struct BSPHeader {
    pub bsp_offset: u32,
    #[deku(pad_bytes_before = "4")]
    pub rendered_vertices_offset: u32,
    #[deku(pad_bytes_before = "4")]
    pub lightmap_vertices_offset: u32,
    #[deku(assert = "*_class == TagClass::ScenarioStructureBsp")]
    pub _class: TagClass,
}

#[wasm_bindgen(js_name = "HaloBSP")]
#[derive(Debug, Clone, DekuRead)]
pub struct BSP {
    pub lightmaps_bitmap: TagDependency,
    #[deku(pad_bytes_before = "28")]
    pub default_ambient_color: ColorRGB,
    #[deku(pad_bytes_before = "4")]
    pub default_distant_light0_color: ColorRGB,
    pub default_distant_light0_direction: Vector3D,
    pub default_distant_light1_color: ColorRGB,
    pub default_distant_light1_direction: Vector3D,
    #[deku(pad_bytes_before = "12")]
    pub default_reflection_tint: ColorARGB,
    pub default_shadow_vector: Vector3D,
    pub default_shadow_color: ColorRGB,
    #[deku(pad_bytes_before = "88")]
    pub(crate) surfaces: Block<Tri>,
    #[deku(pad_bytes_after = "364")]
    pub(crate) lightmaps: Block<BSPLightmap>,
    #[deku(skip)]
    pub(crate) header: Option<BSPHeader>,
}

#[wasm_bindgen(js_name = "HaloLightmap")]
#[derive(Debug, Clone, DekuRead)]
pub struct BSPLightmap {
    pub bitmap_index: u16,
    #[deku(pad_bytes_before = "18")]
    pub(crate) materials: Block<BSPMaterial>,
}

#[wasm_bindgen(js_name = "HaloMaterial")]
#[derive(Debug, Clone, DekuRead)]
pub struct BSPMaterial {
    pub(crate) shader: TagDependency,
    pub shader_permutation: u16,
    pub flags: u16,
    pub surfaces: i32,
    pub surface_count: i32,
    pub centroid: Point3D,
    pub ambient_color: ColorRGB,
    pub distant_light_count: u16,
    #[deku(pad_bytes_before = "2")]
    pub distant_light0_color: ColorRGB,
    pub distant_light0_direction: Vector3D,
    pub distant_light1_color: ColorRGB,
    pub distant_light1_direction: Vector3D,
    #[deku(pad_bytes_before = "12")]
    pub reflection_tint: ColorARGB,
    pub shadow_vector: Vector3D,
    pub shadow_color: ColorRGB,
    pub plane: Plane3D,
    #[deku(pad_bytes_before = "4", assert = "*rendered_vertices_type == RenderedVerticesType::StructureBSPUncompressedRenderedVertices")]
    pub rendered_vertices_type: RenderedVerticesType,
    #[deku(pad_bytes_before = "2")]
    pub(crate) rendered_vertices: Block<RenderedVertex>,
    #[deku(pad_bytes_before = "8")]
    pub(crate) lightmap_vertices: Block<LightmapVertex>,
    #[deku(pad_bytes_before = "4", assert = "_uncompressed_vertices.file_offset != 0")]
    pub(crate) _uncompressed_vertices: TagDataOffset,
    pub(crate) _compressed_vertices: TagDataOffset,
}

#[wasm_bindgen(js_class = "HaloMaterial")]
impl BSPMaterial {
    pub fn get_num_indices(&self) -> i32 {
        self.surface_count * 3
    }

    pub fn get_index_offset(&self) -> i32 {
        self.surfaces * 3
    }
}

#[derive(Debug, Clone, DekuRead)]
pub struct RenderedVertex {
    pub position: Vector3D,
    pub normal: Vector3D,
    pub binormal: Vector3D,
    pub tangent: Vector3D,
    pub u: f32,
    pub v: f32,
}

#[derive(Debug, Clone, DekuRead)]
pub struct LightmapVertex {
    pub normal: Vector3D,
    pub u: f32,
    pub v: f32,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, DekuRead)]
#[deku(id_type = "u16")]
#[repr(u16)]
pub enum RenderedVerticesType {
    StructureBSPUncompressedRenderedVertices = 0,
    StructureBSPCompressedRenderedVertices = 1,
    StructureBSPUncompressedLightmapVertices = 2,
    StructureBSPCompressedLightmapVertices = 3,
    ModelUncompressed = 4,
    ModelCompressed = 5,
}

#[derive(Debug, Clone, DekuRead)]
pub struct ScenarioDecal {
    pub decal_type: u16,
    pub yaw: i8,
    pub pitch: i8,
    pub position: Point3D,
}

#[derive(Debug, Clone, DekuRead)]
pub struct ScenarioLightFixture {
    pub light_type: u16,
    pub name: u16,
    pub not_placed: u16,
    pub desired_permutation: u16,
    pub position: Point3D,
    pub rotation: Euler3D,
    pub bsp_indices: u16,
    pub power_group: u16,
    pub position_group: u16,
    pub device_flags: u32,
    pub color: ColorRGB,
    pub intensity: f32,
    pub falloff_angle: f32,
    pub cutoff_angle: f32,
}
