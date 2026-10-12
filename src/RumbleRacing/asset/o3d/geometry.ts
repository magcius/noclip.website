import { vec2, vec3 } from "gl-matrix";
import { Color, colorNewFromRGBA } from "../../../Color";
import { GSRegister, GsPrimitiveType } from "../../../Common/PS2/GS";
import { VifUnpackFormat } from "../../../Common/PS2/VIF";
import { UnpackData, V4_32 } from "./vif";
import { assert } from "../../../util";

export const enum BlendMode {
  None,
  SourceOver,
  Additive,
}

export interface Primitive {
  totalVertsInPrimitive: number;
  primType: GsPrimitiveType;
  blendMode: BlendMode;
  vertices: {
    position: vec3;
    normal: vec3 | null;
    color: Color | null;
    uv: vec2;
    adcBitSet: boolean;
  }[];
}

export interface Buffer {
  numHeaderLines: number;
  numStrips: number;
  primitives: Primitive[];
  textureId: number;
  blendMode: BlendMode;
}

export interface Geometry {
  buffers: Buffer[];
}

interface Triple {
  a: UnpackData;
  b: UnpackData;
  c: UnpackData;
}

interface StripChunk {
  gifTagV1: number;
  gifTagV2: number;
  blendMode: BlendMode;
  dataTriples: Triple[];
}

interface BufferChunk {
  bufferHeader: { v1: number; v2: number; lastOffset: number }[];
  strips: StripChunk[];
}

const GS_PRMODE = 0x1b;

const PRMODE_ALPHA_BLEND_ENABLE = 1 << 6;

interface GSState {
  alphaBlendEnabled: boolean;
  alphaBlendMode: BlendMode;
}

function decodeAlphaRegister(value: number): BlendMode {
  const b = (value >>> 2) & 0x03;
  return b === 2 ? BlendMode.Additive : BlendMode.SourceOver;
}

function applyGSRegisters(unpack: V4_32, state: GSState): void {
  for (const entry of unpack.data) {
    if (entry.v3 >>> 8 !== 0 || entry.v4 !== 0) continue;

    switch (entry.v3 & 0xff) {
      case GS_PRMODE:
        state.alphaBlendEnabled = (entry.v1 & PRMODE_ALPHA_BLEND_ENABLE) !== 0;
        break;
      case GSRegister.ALPHA_1:
      case GSRegister.ALPHA_2:
        state.alphaBlendMode = decodeAlphaRegister(entry.v1);
        break;
    }
  }
}

export interface TextureEntry {
  eldaOffset: number;
  textureId: number;
}

export interface TextureMeta {
  numTextures: number;
  textureEntries: TextureEntry[];
}

// This whole function is kind of ugly, directly translated from the original imperative Go code
// It consumes sequences of unpack commands and collects all the data up in an easier to use object
// which represents a portion of the model that has a specific texture and GIF tag data.
function getBufferChunks(unpackData: UnpackData[]): BufferChunk[] {
  const result: BufferChunk[] = [];
  const gs: GSState = {
    alphaBlendEnabled: false,
    alphaBlendMode: BlendMode.SourceOver,
  };
  let i = 0;

  while (i < unpackData.length) {
    const headerA = unpackData[i];
    const headerB = unpackData[i + 1];

    // The first and second header data must be of type V4_32
    // This should never fail with the release data
    assert(i + 1 < unpackData.length, "there is enough data to unpack");
    assert(
      headerA.type === VifUnpackFormat.V4_32 &&
        headerB.type === VifUnpackFormat.V4_32,
      "GIF headers are the correct unpack format",
    );

    const bufHeader = headerA.data.map((e) => ({
      v1: e.v1,
      v2: e.v2,
      lastOffset: e.offset,
    }));
    applyGSRegisters(headerA, gs);
    i++;

    const strips: StripChunk[] = [];

    while (i < unpackData.length) {
      let gifData = unpackData[i];
      let subsequentData = unpackData[i + 1];
      if (
        i + 1 < unpackData.length &&
        gifData.type === VifUnpackFormat.V4_32 &&
        subsequentData.type === VifUnpackFormat.V4_32
      ) {
        break;
      }

      if (gifData.type !== VifUnpackFormat.V4_32) {
        throw new Error(`expected strip header at index ${i}`);
      }

      applyGSRegisters(gifData, gs);
      const sChunk: StripChunk = {
        gifTagV1: gifData.data.length > 0 ? gifData.data[0].v1 : 0,
        gifTagV2: gifData.data.length > 0 ? gifData.data[0].v2 : 0,
        blendMode: gs.alphaBlendEnabled ? gs.alphaBlendMode : BlendMode.None,
        dataTriples: [],
      };
      i++;

      // Running into an unpack of V4_32 would signify the next GIF header/end of model data triples
      // so while we are not processing a V4_32, collect groups of three unpack commands.
      // the type of the underlying unpack data triple as a set (A, B, C) determines
      // how the data is interpreted (A = normals, or B = normals, etc.)
      // For now we're just collecting groups of three data streams
      // without yet caring about the semantic meaning
      while (
        i < unpackData.length &&
        unpackData[i].type !== VifUnpackFormat.V4_32
      ) {
        const tripl: UnpackData[] = [];
        for (let j = 0; j < 3 && i < unpackData.length; j++) {
          if (unpackData[i].type === VifUnpackFormat.V4_32) break;
          tripl.push(unpackData[i]);
          i++;
        }
        if (tripl.length > 2) {
          sChunk.dataTriples.push({ a: tripl[0], b: tripl[1], c: tripl[2] });
        }
      }
      strips.push(sChunk);
    }

    result.push({ bufferHeader: bufHeader, strips });
  }

  return result;
}

function findTextureId(textures: TextureMeta, dataAddress: number): number {
  let bestId = -1;
  let bestOffset = -1;

  for (const entry of textures.textureEntries) {
    if (entry.eldaOffset <= dataAddress) {
      if (bestId === -1 || entry.eldaOffset > bestOffset) {
        bestOffset = entry.eldaOffset;
        bestId = entry.textureId;
      }
    }
  }

  return bestId;
}

export function getGeometry(
  unpackStream: UnpackData[],
  textures: TextureMeta,
): Geometry {
  const chunks = getBufferChunks(unpackStream);
  const geometry: Geometry = { buffers: [] };

  for (const bChunk of chunks) {
    const lastHeader = bChunk.bufferHeader[bChunk.bufferHeader.length - 1];
    const buf: Buffer = {
      numStrips: bChunk.bufferHeader[0]?.v1 ?? 0,
      numHeaderLines: bChunk.bufferHeader[0]?.v2 ?? 0,
      primitives: [],
      textureId: findTextureId(textures, lastHeader?.lastOffset ?? 0),
      blendMode: BlendMode.None,
    };

    for (const sChunk of bChunk.strips) {
      const strip: Primitive = {
        totalVertsInPrimitive: sChunk.gifTagV1 & 0x7fff,
        primType: ((sChunk.gifTagV2 & (0b111 << 15)) >> 15) as GsPrimitiveType,
        blendMode: sChunk.blendMode,
        vertices: [],
      };

      for (const triple of sChunk.dataTriples) {
        const { a: cmdA, b: cmdB, c: cmdC } = triple;

        if (
          cmdA.type === VifUnpackFormat.V3_32 && // A = normals
          cmdB.type === VifUnpackFormat.V3_32 && // B = vertices
          cmdC.type === VifUnpackFormat.V2_32 // C = uvs
        ) {
          for (let j = 0; j < cmdA.data.length; j++) {
            strip.vertices.push({
              normal: vec3.fromValues(
                cmdA.data[j].v1,
                cmdA.data[j].v2,
                cmdA.data[j].v3,
              ),
              color: null,
              adcBitSet: cmdA.data[j].adcBitSet,
              position: vec3.fromValues(
                cmdB.data[j].v1,
                cmdB.data[j].v2,
                cmdB.data[j].v3,
              ),
              uv: vec2.fromValues(cmdC.data[j].v1, cmdC.data[j].v2),
            });
          }
        } else if (
          cmdA.type === VifUnpackFormat.V3_32 && // A = vertices
          cmdB.type === VifUnpackFormat.V2_32 && // B = uvs
          cmdC.type === VifUnpackFormat.V4_8 // C = RGBA vertex colors
        ) {
          for (let j = 0; j < cmdA.data.length; j++) {
            const rgba = cmdC.data[j];

            strip.vertices.push({
              position: vec3.fromValues(
                cmdA.data[j].v1,
                cmdA.data[j].v2,
                cmdA.data[j].v3,
              ),
              uv: vec2.fromValues(cmdB.data[j].v1, cmdB.data[j].v2),
              normal: null,
              color: colorNewFromRGBA(
                rgba.v1 / 0x80,
                rgba.v2 / 0x80,
                (rgba.v3 & ~1) / 0x80,
                rgba.v4 / 0x80,
              ),
              adcBitSet: rgba.adcBitSet,
            });
          }
        }
      }

      buf.primitives.push(strip);

      if (strip.blendMode > buf.blendMode) buf.blendMode = strip.blendMode;
    }

    geometry.buffers.push(buf);
  }

  return geometry;
}
