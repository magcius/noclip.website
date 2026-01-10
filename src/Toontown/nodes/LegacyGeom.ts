import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgEnum, dbgNum } from "./debug";
import { TexCoordName } from "./InternalName";

// GeomBindType from old Panda3D
export enum GeomBindType {
  Off = 0,
  Overall = 1,
  PerPrim = 2,
  PerComponent = 3,
  PerVertex = 4,
}

// GeomAttrType indices
const G_COORD = 0;
const G_COLOR = 1;
const G_NORMAL = 2;
const G_TEXCOORD = 3;

/**
 * TexCoordDef - texture coordinate set for multitexture (BAM 4.11+)
 */
export interface TexCoordDef {
  name: TexCoordName | null;
  texcoords: Float32Array; // vec2
  tindex: Uint16Array;
}

/**
 * LegacyGeom - Pre-5.0 BAM geometry format
 *
 * This is the old Geom class that was replaced in BAM 5.0 with the
 * new Geom/GeomPrimitive system. The old format stored vertex data
 * directly in the Geom object rather than in separate GeomVertexData.
 *
 * Version differences:
 * - BAM < 4.11: Single texcoords/tindex arrays
 * - BAM >= 4.11: Multiple named texture coordinate sets (multitexture)
 */
export class LegacyGeom extends BAMObject {
  // Vertex attribute arrays
  public coords: Float32Array = new Float32Array(); // vec3
  public norms: Float32Array = new Float32Array(); // vec3
  public colors: Float32Array = new Float32Array(); // vec4
  public texcoords: Float32Array = new Float32Array(); // vec2 // Default texcoords (for < 4.11 or default set)

  // Index arrays
  public vindex: Uint16Array = new Uint16Array();
  public nindex: Uint16Array = new Uint16Array();
  public cindex: Uint16Array = new Uint16Array();
  public tindex: Uint16Array = new Uint16Array(); // Default tindex (for < 4.11 or default set)

  // Multitexture support (BAM 4.11+)
  public texcoordSets: TexCoordDef[] = [];

  // Primitive info
  public numPrims = 0;
  public primLengths: Int32Array = new Int32Array();

  // Bindings for each attribute type
  public bindings: [GeomBindType, GeomBindType, GeomBindType, GeomBindType] = [
    GeomBindType.Off,
    GeomBindType.Off,
    GeomBindType.Off,
    GeomBindType.Off,
  ];

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    const isMultitexture = this._version.compare(new AssetVersion(4, 11)) >= 0;

    this.coords = data.readPtaVec3();
    this.norms = data.readPtaVec3();
    this.colors = data.readPtaVec4();

    if (!isMultitexture) {
      // BAM < 4.11: Single texcoords PTA
      this.texcoords = data.readPtaVec2();
    } else {
      // BAM 4.11+: Multiple named texture coordinate sets
      const numTexcoordSets = data.readUint8();
      for (let i = 0; i < numTexcoordSets; i++) {
        const name = file.getTyped(data.readObjectId(), TexCoordName);
        const texcoords = data.readPtaVec2();
        const tindex = data.readPtaUint16();
        this.texcoordSets.push({ name, texcoords, tindex });
      }
      // Use first set as default texcoords for compatibility
      if (this.texcoordSets.length > 0) {
        this.texcoords = this.texcoordSets[0].texcoords;
        this.tindex = this.texcoordSets[0].tindex;
      }
    }

    this.vindex = data.readPtaUint16();
    this.nindex = data.readPtaUint16();
    this.cindex = data.readPtaUint16();

    // BAM < 4.11: tindex comes after cindex
    // BAM >= 4.11: tindex is part of each texcoord set (already read above)
    if (!isMultitexture) {
      this.tindex = data.readPtaUint16();
    }

    this.numPrims = data.readUint16();
    this.primLengths = data.readPtaInt32();

    // Read bindings (4 x uint8)
    this.bindings = [
      data.readUint8() as GeomBindType, // G_COORD
      data.readUint8() as GeomBindType, // G_COLOR
      data.readUint8() as GeomBindType, // G_NORMAL
      data.readUint8() as GeomBindType, // G_TEXCOORD
    ];
  }

  override copyTo(target: this): void {
    super.copyTo(target);
    target.coords = this.coords; // Shared
    target.norms = this.norms; // Shared
    target.colors = this.colors; // Shared
    target.texcoords = this.texcoords; // Shared
    target.vindex = this.vindex; // Shared
    target.nindex = this.nindex; // Shared
    target.cindex = this.cindex; // Shared
    target.tindex = this.tindex; // Shared
    target.texcoordSets = this.texcoordSets; // Shared
    target.numPrims = this.numPrims;
    target.primLengths = this.primLengths; // Shared
    target.bindings = this.bindings; // Shared
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("coords", dbgNum(this.coords.length));
    info.set("norms", dbgNum(this.norms.length));
    info.set("colors", dbgNum(this.colors.length));
    info.set("texcoords", dbgNum(this.texcoords.length));
    info.set("numPrims", dbgNum(this.numPrims));
    info.set("coordBind", dbgEnum(this.bindings[G_COORD], GeomBindType));
    info.set("colorBind", dbgEnum(this.bindings[G_COLOR], GeomBindType));
    info.set("normalBind", dbgEnum(this.bindings[G_NORMAL], GeomBindType));
    info.set("texcoordBind", dbgEnum(this.bindings[G_TEXCOORD], GeomBindType));
    return info;
  }
}

export class GeomTri extends LegacyGeom {}
export class GeomTristrip extends LegacyGeom {}
export class GeomTrifan extends LegacyGeom {}
export class GeomLine extends LegacyGeom {}
export class GeomLinestrip extends LegacyGeom {}
export class GeomPoint extends LegacyGeom {}
export class GeomSprite extends LegacyGeom {}

registerBAMObject("GeomTri", GeomTri);
registerBAMObject("GeomTristrip", GeomTristrip);
registerBAMObject("GeomTrifan", GeomTrifan);
registerBAMObject("GeomLine", GeomLine);
registerBAMObject("GeomLinestrip", GeomLinestrip);
registerBAMObject("GeomPoint", GeomPoint);
registerBAMObject("GeomSprite", GeomSprite);
