import { vec2, vec3 } from "gl-matrix";
import { VifCmd, VifUnpackFormat } from "../../../Common/PS2/VIF";
import { VifCommand, UnpackData } from "./vif";

export interface Primitive {
  totalVertsInPrimitive: number;
  primType: number;
  vertices: {
    position: vec3;
    normal: vec3;
    uv: vec2;
    adcBitSet: boolean;
  }[];
}

export interface Buffer {
  numHeaderLines: number;
  numStrips: number;
  primitives: Primitive[];
  textureId: number;
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
  dataTriples: Triple[];
}

interface BufferChunk {
  bufferHeader: { v1: number; v2: number; lastOffset: number }[];
  strips: StripChunk[];
}

export interface TextureEntry {
  eldaOffset: number;
  textureId: number;
}

export interface TextureMeta {
  numTextures: number;
  textureEntries: TextureEntry[];
}

function getBufferChunks(filtered: VifCommand[]): BufferChunk[] {
  const result: BufferChunk[] = [];
  let i = 0;

  while (i < filtered.length) {
    if (
      i + 1 < filtered.length &&
      filtered[i].unpack?.type === VifUnpackFormat.V4_32 &&
      filtered[i + 1].unpack?.type === VifUnpackFormat.V4_32
    ) {
      const bufHeader = filtered[i].unpack!.v4_32.map((e) => ({
        v1: e.v1,
        v2: e.v2,
        lastOffset: e.offset,
      }));
      i++;

      const strips: StripChunk[] = [];

      while (i < filtered.length) {
        if (
          i + 1 < filtered.length &&
          filtered[i].unpack?.type === VifUnpackFormat.V4_32 &&
          filtered[i + 1].unpack?.type === VifUnpackFormat.V4_32
        ) {
          break;
        }

        if (filtered[i].unpack?.type !== VifUnpackFormat.V4_32) {
          throw new Error(`expected strip header at index ${i}`);
        }

        const gifEntries = filtered[i].unpack!.v4_32;
        const sChunk: StripChunk = {
          gifTagV1: gifEntries.length > 0 ? gifEntries[0].v1 : 0,
          gifTagV2: gifEntries.length > 0 ? gifEntries[0].v2 : 0,
          dataTriples: [],
        };
        i++;

        while (
          i < filtered.length &&
          filtered[i].unpack?.type !== VifUnpackFormat.V4_32
        ) {
          const tripl: UnpackData[] = [];
          for (let j = 0; j < 3 && i < filtered.length; j++) {
            if (filtered[i].unpack?.type === VifUnpackFormat.V4_32) break;
            tripl.push(filtered[i].unpack!);
            i++;
          }
          if (tripl.length > 2) {
            sChunk.dataTriples.push({ a: tripl[0], b: tripl[1], c: tripl[2] });
          }
        }
        strips.push(sChunk);
      }

      const lastHeader = bufHeader[bufHeader.length - 1];
      result.push({ bufferHeader: bufHeader, strips });
    } else {
      i++;
    }
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
  commandStream: VifCommand[],
  textures: TextureMeta,
): Geometry {
  const filtered = commandStream.filter((c) => c.kind === VifCmd.UNPACK_MASK);
  const chunks = getBufferChunks(filtered);
  const geometry: Geometry = { buffers: [] };

  for (const bChunk of chunks) {
    const lastHeader = bChunk.bufferHeader[bChunk.bufferHeader.length - 1];
    const buf: Buffer = {
      numStrips: bChunk.bufferHeader[0]?.v1 ?? 0,
      numHeaderLines: bChunk.bufferHeader[0]?.v2 ?? 0,
      primitives: [],
      textureId: findTextureId(textures, lastHeader?.lastOffset ?? 0),
    };

    for (const sChunk of bChunk.strips) {
      const strip: Primitive = {
        totalVertsInPrimitive: sChunk.gifTagV1 & 0x7fff,
        primType: (sChunk.gifTagV2 & (0b111 << 15)) >> 15,
        vertices: [],
      };

      for (const triple of sChunk.dataTriples) {
        const { a: cmdA, b: cmdB, c: cmdC } = triple;

        if (
          cmdA.type === VifUnpackFormat.V3_32 && // A = normals
          cmdB.type === VifUnpackFormat.V3_32 && // B = vertices
          cmdC.type === VifUnpackFormat.V2_32 // C = uvs
        ) {
          for (let j = 0; j < cmdA.v3_32.length; j++) {
            strip.vertices.push({
              normal: vec3.fromValues(
                cmdA.v3_32[j].v1,
                cmdA.v3_32[j].v2,
                cmdA.v3_32[j].v3,
              ),
              adcBitSet: cmdA.v3_32[j].adcBitSet,
              position: vec3.fromValues(
                cmdB.v3_32[j].v1,
                cmdB.v3_32[j].v2,
                cmdB.v3_32[j].v3,
              ),
              uv: vec2.fromValues(cmdC.v2_32[j].v1, cmdC.v2_32[j].v2),
            });
          }
        } else if (
          cmdA.type === VifUnpackFormat.V3_32 && // A = vertices
          cmdB.type === VifUnpackFormat.V2_32 && // B = uvs
          cmdC.type === VifUnpackFormat.V4_8 // C = normals
        ) {
          for (let j = 0; j < cmdA.v3_32.length; j++) {
            strip.vertices.push({
              position: vec3.fromValues(
                cmdA.v3_32[j].v1,
                cmdA.v3_32[j].v2,
                cmdA.v3_32[j].v3,
              ),
              uv: vec2.fromValues(cmdB.v2_32[j].v1, cmdB.v2_32[j].v2),
              normal: vec3.fromValues(
                cmdC.v4_8[j].v1 / 255.0,
                cmdC.v4_8[j].v2 / 255.0,
                cmdC.v4_8[j].v3 / 255.0,
              ),
              adcBitSet: cmdC.v4_8[j].adcBitSet,
            });
          }
        }
      }

      buf.primitives.push(strip);
    }

    geometry.buffers.push(buf);
  }

  return geometry;
}
