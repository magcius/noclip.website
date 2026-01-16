import type { vec2, vec3, vec4 } from "gl-matrix";
import type { BAMFile } from "../BAMFile";
import { AssetVersion, type DataStream } from "../Common";
import { type DebugInfo, dbgNum, dbgTypedArray } from "./debug";
import {
  type CopyContext,
  registerTypedObject,
  TypedObject,
} from "./TypedObject";

/**
 * VertexTransform - Transforms vertices by a joint
 *
 * Associates vertex/normal indices with a joint and an effect weight.
 */
export interface VertexTransform {
  jointIndex: number; // int16 - index into Character's joint list
  effect: number; // float32 - blend weight
  vindex: Uint16Array; // vertex indices affected by this joint
  nindex: Uint16Array; // normal indices affected by this joint
}

/**
 * MorphValue - A single morph offset value
 *
 * Represents the offset applied to a vertex when the morph is active.
 */
export interface MorphValue2 {
  index: number; // uint16 - vertex index
  vector: vec2; // offset
}

export interface MorphValue3 {
  index: number; // uint16 - vertex index
  vector: vec3; // offset
}

export interface MorphValue4 {
  index: number; // uint16 - vertex index
  vector: vec4; // offset
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
export class ComputedVertices extends TypedObject {
  // Vertex transforms (joint-based animation)
  public transforms: VertexTransform[] = [];

  // Morph targets
  public vertexMorphs: VertexMorph[] = [];
  public normalMorphs: NormalMorph[] = [];
  public texcoordMorphs: TexcoordMorph[] = [];
  public colorMorphs: ColorMorph[] = [];

  // Original vertex data (shared with Geoms via PTAs)
  public origCoords: Float32Array = new Float32Array(); // vec3
  public origNorms: Float32Array = new Float32Array(); // vec3
  public origColors: Float32Array = new Float32Array(); // vec4
  public origTexcoords: Float32Array = new Float32Array(); // vec2

  override load(file: BAMFile, data: DataStream) {
    super.load(file, data);

    // In BAM 4.10+, counts are uint32 instead of uint16
    const useUint32 = this._version.compare(new AssetVersion(4, 10)) >= 0;
    const readCount = useUint32
      ? data.readUint32.bind(data)
      : data.readUint16.bind(data);

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

    this.origCoords = data.readPtaVec3();
    this.origNorms = data.readPtaVec3();
    this.origColors = data.readPtaVec4();
    this.origTexcoords = data.readPtaVec2();
  }

  override copyTo(target: this, ctx: CopyContext): void {
    super.copyTo(target, ctx);
    target.transforms = this.transforms; // Shared
    target.vertexMorphs = this.vertexMorphs; // Shared
    target.normalMorphs = this.normalMorphs; // Shared
    target.texcoordMorphs = this.texcoordMorphs; // Shared
    target.colorMorphs = this.colorMorphs; // Shared
    target.origCoords = this.origCoords; // Shared
    target.origNorms = this.origNorms; // Shared
    target.origColors = this.origColors; // Shared
    target.origTexcoords = this.origTexcoords; // Shared
  }

  override getDebugInfo(): DebugInfo {
    const info = super.getDebugInfo();
    info.set("transforms", dbgNum(this.transforms.length));
    info.set("vertexMorphs", dbgNum(this.vertexMorphs.length));
    info.set("normalMorphs", dbgNum(this.normalMorphs.length));
    info.set("texcoordMorphs", dbgNum(this.texcoordMorphs.length));
    info.set("colorMorphs", dbgNum(this.colorMorphs.length));
    info.set("origCoords", dbgTypedArray(this.origCoords, 3));
    info.set("origNorms", dbgTypedArray(this.origNorms, 3));
    info.set("origColors", dbgTypedArray(this.origColors, 4));
    info.set("origTexcoords", dbgTypedArray(this.origTexcoords, 2));
    return info;
  }

  private readVertexTransform(data: DataStream): VertexTransform {
    const jointIndex = data.readInt16();
    const effect = data.readFloat32();

    const vindexSize = data.readUint16();
    const vindex = data.readUint16Array(vindexSize);

    const nindexSize = data.readUint16();
    const nindex = data.readUint16Array(nindexSize);

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
}

registerTypedObject("ComputedVertices", ComputedVertices);
