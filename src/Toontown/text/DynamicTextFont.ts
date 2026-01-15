import { rust } from "../../rustlib";
import {
  Geom,
  GeomTriangles,
  GeomVertexArrayData,
  GeomVertexArrayFormat,
  GeomVertexColumn,
  GeomVertexData,
  GeomVertexFormat,
  RenderState,
} from "../nodes";
import {
  Contents,
  NumericType,
  PrimitiveType,
  ShadeModel,
} from "../nodes/geomEnums";
import { TextGlyph } from "./TextGlyph";

/**
 * A dynamic text font that loads TTF fonts and generates glyph meshes at runtime.
 * Uses the fontmesh Rust library for TTF parsing and triangulation.
 */
export class DynamicTextFont {
  private loader: rust.FontMeshLoader;
  private familyName: string;
  private glyphCache = new Map<number, TextGlyph>();
  private _lineHeight: number;
  private _spaceAdvance: number;
  private scale: number;

  /**
   * Create a DynamicTextFont from TTF font data
   * @param data - Raw TTF font file data
   * @param scale - Scale factor to apply to font coordinates (default 1.0)
   */
  constructor(data: Uint8Array, scale = 1.0) {
    this.loader = new rust.FontMeshLoader(data);
    this.scale = scale;

    // Get family name
    this.familyName = this.loader.family_name();

    // Calculate line height from font metrics
    const rawLineHeight = this.loader.get_line_height();
    this._lineHeight = rawLineHeight * scale;

    // Space advance is typically about 0.25 of line height
    const spaceCharAdvance = this.loader.get_advance(32); // space character
    this._spaceAdvance = spaceCharAdvance * scale;
  }

  get lineHeight(): number {
    return this._lineHeight;
  }

  get spaceAdvance(): number {
    return this._spaceAdvance;
  }

  /**
   * Get a glyph for the given character code.
   * Glyphs are cached after first generation.
   */
  getGlyph(charCode: number): TextGlyph | null {
    // Check cache first
    if (this.glyphCache.has(charCode)) {
      return this.glyphCache.get(charCode)!;
    }

    // Handle whitespace characters
    if (
      charCode === 32 ||
      charCode === 9 ||
      charCode === 10 ||
      charCode === 13
    ) {
      const advance = charCode === 32 ? this._spaceAdvance : 0;
      const glyph = new TextGlyph(charCode, null, null, advance);
      this.glyphCache.set(charCode, glyph);
      return glyph;
    }

    try {
      // Generate mesh from TTF
      const mesh = this.loader.get_glyph_mesh(charCode, 20);
      const advance = mesh.advance * this.scale;

      // If the mesh has no vertices (empty glyph), return a whitespace-like glyph
      if (mesh.vertices.length === 0) {
        const glyph = new TextGlyph(charCode, null, null, advance);
        this.glyphCache.set(charCode, glyph);
        return glyph;
      }

      // Create Geom from mesh data
      const geom = this.createGeomFromMesh(mesh.vertices, mesh.indices);
      const glyph = new TextGlyph(charCode, geom, new RenderState(), advance);
      this.glyphCache.set(charCode, glyph);
      return glyph;
    } catch (e) {
      // Glyph not found in font, return null
      console.warn(`Failed to generate glyph for char code ${charCode}:`, e);
      return null;
    }
  }

  /**
   * Create a Geom object from raw vertex and index data
   */
  private createGeomFromMesh(
    vertices: Float32Array,
    indices: Uint32Array,
  ): Geom {
    const posColumn = new GeomVertexColumn();
    posColumn.numComponents = 3;
    posColumn.numericType = NumericType.F32;
    posColumn.contents = Contents.Point;
    posColumn.columnAlignment = 4;
    posColumn.componentBytes = 4;
    posColumn.numElements = 1;
    posColumn.elementStride = 12;
    posColumn.numValues = 3;
    posColumn.totalBytes = 12;

    const arrayFormat = new GeomVertexArrayFormat();
    arrayFormat.stride = 12;
    arrayFormat.totalBytes = 12;
    arrayFormat.padTo = 4;
    arrayFormat.columns = [posColumn];

    const vertexFormat = new GeomVertexFormat();
    vertexFormat.arrays = [arrayFormat];

    // Create vertex buffer with 3D positions (Y=0)
    const numVertices = vertices.length / 2;
    const vertexBuffer = new Float32Array(numVertices * 3);
    for (let i = 0; i < numVertices; i++) {
      vertexBuffer[i * 3 + 0] = vertices[i * 2 + 0] * this.scale; // X = fontX
      vertexBuffer[i * 3 + 1] = 0; // Y (depth)
      vertexBuffer[i * 3 + 2] = vertices[i * 2 + 1] * this.scale; // Z = fontY
    }

    const arrayData = new GeomVertexArrayData();
    arrayData.arrayFormat = arrayFormat;
    arrayData.buffer = new Uint8Array(vertexBuffer.buffer);

    const vertexData = new GeomVertexData();
    vertexData.name = this.familyName || "glyph";
    vertexData.format = vertexFormat;
    vertexData.arrays = [arrayData];

    // Create triangle primitive with indices
    // Reverse winding order for correct face culling
    let indexType: NumericType;
    let indexBuffer: Uint8Array;
    if (numVertices <= 256) {
      indexType = NumericType.U8;
      const u8Indices = new Uint8Array(indices.length);
      for (let i = 0; i < indices.length; i += 3) {
        u8Indices[i + 0] = indices[i + 0];
        u8Indices[i + 1] = indices[i + 2]; // swap 1 and 2
        u8Indices[i + 2] = indices[i + 1];
      }
      indexBuffer = u8Indices;
    } else if (numVertices <= 65536) {
      indexType = NumericType.U16;
      const u16Indices = new Uint16Array(indices.length);
      for (let i = 0; i < indices.length; i += 3) {
        u16Indices[i + 0] = indices[i + 0];
        u16Indices[i + 1] = indices[i + 2]; // swap 1 and 2
        u16Indices[i + 2] = indices[i + 1];
      }
      indexBuffer = new Uint8Array(u16Indices.buffer);
    } else {
      indexType = NumericType.U32;
      const u32Indices = new Uint32Array(indices.length);
      for (let i = 0; i < indices.length; i += 3) {
        u32Indices[i + 0] = indices[i + 0];
        u32Indices[i + 1] = indices[i + 2]; // swap 1 and 2
        u32Indices[i + 2] = indices[i + 1];
      }
      indexBuffer = new Uint8Array(u32Indices.buffer);
    }

    const indexArrayData = new GeomVertexArrayData();
    indexArrayData.buffer = indexBuffer;

    const triangles = new GeomTriangles();
    triangles.indexType = indexType;
    triangles.vertices = indexArrayData;

    // Create the final Geom
    const geom = new Geom();
    geom.data = vertexData;
    geom.primitives = [triangles];
    geom.primitiveType = PrimitiveType.Polygons;
    geom.shadeModel = ShadeModel.Flat;

    return geom;
  }

  /**
   * Free resources when done with the font
   */
  dispose(): void {
    this.loader.free();
    this.glyphCache.clear();
  }
}
