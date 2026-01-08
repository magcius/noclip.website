import type { BAMFile } from "../bam";
import { AssetVersion, type DataStream } from "../common";
import { BAMObject, registerBAMObject } from "./base";
import { type DebugInfo, dbgNum } from "./debug";
import { LegacyGeom } from "./LegacyGeom";

/**
 * VertexTransform - Transforms vertices by a joint
 *
 * Associates vertex/normal indices with a joint and an effect weight.
 */
export interface VertexTransform {
  jointIndex: number; // int16 - index into Character's joint list
  effect: number; // float32 - blend weight
  vindex: number[]; // uint16[] - vertex indices affected by this joint
  nindex: number[]; // uint16[] - normal indices affected by this joint
}

/**
 * MorphValue - A single morph offset value
 *
 * Represents the offset applied to a vertex when the morph is active.
 */
export interface MorphValue2 {
  index: number; // uint16 - vertex index
  vector: [number, number]; // Vec2 offset
}

export interface MorphValue3 {
  index: number; // uint16 - vertex index
  vector: [number, number, number]; // Vec3 offset
}

export interface MorphValue4 {
  index: number; // uint16 - vertex index
  vector: [number, number, number, number]; // Vec4 offset
}

/**
 * ComputedVerticesMorph - Morph target data
 *
 * Associates a slider index with a list of vertex offsets.
 */
export interface VertexMorph {
  sliderIndex: number; // int16 - index into Character's slider list
  morphs: MorphValue3[];
}

export interface NormalMorph {
  sliderIndex: number;
  morphs: MorphValue3[];
}

export interface TexcoordMorph {
  sliderIndex: number;
  morphs: MorphValue2[];
}

export interface ColorMorph {
  sliderIndex: number;
  morphs: MorphValue4[];
}

/**
 * ComputedVertices - Pre-5.0 BAM character animation vertices
 *
 * This class stores original vertex data and transform/morph information
 * for character animation. The vertex arrays are shared with Geom objects
 * via the PTA (PointerToArray) mechanism.
 *
 * Version differences:
 * - BAM < 4.10: counts are uint16
 * - BAM >= 4.10: counts are uint32
 */
export class ComputedVertices extends BAMObject {
  // Vertex transforms (joint-based animation)
  public transforms: VertexTransform[] = [];

  // Morph targets
  public vertexMorphs: VertexMorph[] = [];
  public normalMorphs: NormalMorph[] = [];
  public texcoordMorphs: TexcoordMorph[] = [];
  public colorMorphs: ColorMorph[] = [];

  // Original vertex data (shared with Geoms via PTAs)
  public origCoords: Array<[number, number, number]> = [];
  public origNorms: Array<[number, number, number]> = [];
  public origColors: Array<[number, number, number, number]> = [];
  public origTexcoords: Array<[number, number]> = [];

  constructor(objectId: number, file: BAMFile, data: DataStream) {
    super(objectId, file, data);

    // In BAM 4.10+, counts are uint32 instead of uint16
    const useUint32 =
      file.header.version.compare(new AssetVersion(4, 10)) >= 0;
    const readCount = () => (useUint32 ? data.readUint32() : data.readUint16());

    // Read vertex transforms
    const numTransforms = readCount();
    for (let i = 0; i < numTransforms; i++) {
      this.transforms.push(this.readVertexTransform(data));
    }

    // Read vertex morphs
    const numVertexMorphs = readCount();
    for (let i = 0; i < numVertexMorphs; i++) {
      this.vertexMorphs.push(this.readMorph3(data));
    }

    // Read normal morphs
    const numNormalMorphs = readCount();
    for (let i = 0; i < numNormalMorphs; i++) {
      this.normalMorphs.push(this.readMorph3(data));
    }

    // Read texcoord morphs
    const numTexcoordMorphs = readCount();
    for (let i = 0; i < numTexcoordMorphs; i++) {
      this.texcoordMorphs.push(this.readMorph2(data));
    }

    // Read color morphs
    const numColorMorphs = readCount();
    for (let i = 0; i < numColorMorphs; i++) {
      this.colorMorphs.push(this.readMorph4(data));
    }

    // Read original vertex data PTAs - these are shared with Geoms
    // Use the global PTA cache from LegacyGeom
    this.origCoords = LegacyGeom.readPtaVec3Global(data);
    this.origNorms = LegacyGeom.readPtaVec3Global(data);
    this.origColors = LegacyGeom.readPtaVec4Global(data);
    this.origTexcoords = LegacyGeom.readPtaVec2Global(data);
  }

  private readVertexTransform(data: DataStream): VertexTransform {
    const jointIndex = data.readInt16();
    const effect = data.readFloat32();

    const vindexSize = data.readUint16();
    const vindex: number[] = [];
    for (let i = 0; i < vindexSize; i++) {
      vindex.push(data.readUint16());
    }

    const nindexSize = data.readUint16();
    const nindex: number[] = [];
    for (let i = 0; i < nindexSize; i++) {
      nindex.push(data.readUint16());
    }

    return { jointIndex, effect, vindex, nindex };
  }

  private readMorph3(data: DataStream): VertexMorph {
    const sliderIndex = data.readInt16();
    const size = data.readUint16();
    const morphs: MorphValue3[] = [];
    for (let i = 0; i < size; i++) {
      const index = data.readUint16();
      const vector = data.readVec3();
      morphs.push({ index, vector });
    }
    return { sliderIndex, morphs };
  }

  private readMorph2(data: DataStream): TexcoordMorph {
    const sliderIndex = data.readInt16();
    const size = data.readUint16();
    const morphs: MorphValue2[] = [];
    for (let i = 0; i < size; i++) {
      const index = data.readUint16();
      const vector = data.readVec2();
      morphs.push({ index, vector });
    }
    return { sliderIndex, morphs };
  }

  private readMorph4(data: DataStream): ColorMorph {
    const sliderIndex = data.readInt16();
    const size = data.readUint16();
    const morphs: MorphValue4[] = [];
    for (let i = 0; i < size; i++) {
      const index = data.readUint16();
      const vector = data.readVec4();
      morphs.push({ index, vector });
    }
    return { sliderIndex, morphs };
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("transforms", dbgNum(this.transforms.length));
    info.set("vertexMorphs", dbgNum(this.vertexMorphs.length));
    info.set("normalMorphs", dbgNum(this.normalMorphs.length));
    info.set("texcoordMorphs", dbgNum(this.texcoordMorphs.length));
    info.set("colorMorphs", dbgNum(this.colorMorphs.length));
    info.set("origCoords", dbgNum(this.origCoords.length));
    info.set("origNorms", dbgNum(this.origNorms.length));
    info.set("origColors", dbgNum(this.origColors.length));
    info.set("origTexcoords", dbgNum(this.origTexcoords.length));
    return info;
  }
}

registerBAMObject("ComputedVertices", ComputedVertices);
