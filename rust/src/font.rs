use wasm_bindgen::prelude::*;

/// Result of generating a 2D glyph mesh
#[wasm_bindgen]
pub struct GlyphMesh {
    /// Flattened vertex positions [x, y, x, y, ...]
    #[wasm_bindgen(getter_with_clone)]
    pub vertices: Vec<f32>,
    /// Triangle indices
    #[wasm_bindgen(getter_with_clone)]
    pub indices: Vec<u32>,
    /// Horizontal advance width (in font units)
    pub advance: f32,
}

/// TTF font loader that generates triangle meshes from glyphs
#[wasm_bindgen]
pub struct FontMeshLoader {
    font_data: Vec<u8>,
}

#[wasm_bindgen]
impl FontMeshLoader {
    /// Create a new FontMeshLoader from TTF font data
    #[wasm_bindgen(constructor)]
    pub fn new(data: &[u8]) -> Result<FontMeshLoader, JsValue> {
        let loader = FontMeshLoader {
            font_data: data.to_vec(),
        };
        // Validate that we can parse the font
        loader.parse()?;
        Ok(loader)
    }

    /// Parse the font data into a Face object
    fn parse<'a>(&'a self) -> Result<fontmesh::Face<'a>, JsValue> {
        fontmesh::parse_font(&self.font_data)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse font: {:?}", e)))
    }

    /// Get a list of all names in the font
    #[wasm_bindgen]
    pub fn names(&self) -> Result<Vec<String>, JsValue> {
        let face = self.parse()?;
        Ok(face
            .names()
            .into_iter()
            .map(|name| name.to_string().unwrap_or_default())
            .collect())
    }

    /// Get the font family name
    #[wasm_bindgen]
    pub fn family_name(&self) -> Result<String, JsValue> {
        let face = self.parse()?;
        Ok(face
            .names()
            .into_iter()
            .filter_map(|n| n.to_string())
            .nth(1 /* name_id::FAMILY */)
            .unwrap_or_default())
    }

    /// Generate a 2D triangle mesh for a character
    ///
    /// # Arguments
    /// * `char_code` - Unicode code point
    /// * `subdivisions` - Quality level for bezier curve tessellation (1-4 recommended)
    #[wasm_bindgen]
    pub fn get_glyph_mesh(&self, char_code: u32, subdivisions: u8) -> Result<GlyphMesh, JsValue> {
        let face = self.parse()?;

        let c = char::from_u32(char_code)
            .ok_or_else(|| JsValue::from_str(&format!("Invalid char code: {}", char_code)))?;

        // Get the advance width
        let advance = fontmesh::glyph_advance(&face, c).unwrap_or(0.5);

        // Generate the mesh
        let mesh = fontmesh::char_to_mesh_2d(&face, c, subdivisions)
            .map_err(|e| JsValue::from_str(&format!("Failed to generate mesh: {:?}", e)))?;

        // Flatten vertices from Vec<Point2D> to Vec<f32>
        let vertices: Vec<f32> = mesh.vertices.iter().flat_map(|p| [p.x, p.y]).collect();

        Ok(GlyphMesh {
            vertices,
            indices: mesh.indices,
            advance,
        })
    }

    /// Get the horizontal advance width for a character (in font units)
    #[wasm_bindgen]
    pub fn get_advance(&self, char_code: u32) -> Result<f32, JsValue> {
        let face = self.parse()?;
        let c = char::from_u32(char_code)
            .ok_or_else(|| JsValue::from_str(&format!("Invalid char code: {}", char_code)))?;
        Ok(fontmesh::glyph_advance(&face, c).unwrap_or(0.5))
    }

    /// Get the font height (ascender - descender)
    #[wasm_bindgen]
    pub fn get_line_height(&self) -> Result<f32, JsValue> {
        let face = self.parse()?;
        let ascender = fontmesh::ascender(&face);
        let descender = fontmesh::descender(&face);
        let line_gap = fontmesh::line_gap(&face);
        Ok(ascender - descender + line_gap)
    }
}
