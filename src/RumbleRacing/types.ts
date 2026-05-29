import { GfxBuffer } from "../gfx/platform/GfxPlatformImpl";

type MatrixRow = [x: number, y: number, z: number, w: number];

export interface ExcludeInfo {
  textureIds?: Set<number>;
  nodeIds?: Set<number>;
}

export type ActorTransforms = Record<number, ActorMatrix>;

export type ActorMatrix = [
  right: MatrixRow,
  up: MatrixRow,
  forward: MatrixRow,
  position: MatrixRow,
];

export interface RumbleRacingTrackFile {
  Obfs: ObfData[];
  O3Ds: O3DData[];
  Actors: Actor[];
  Textures: TextureData[];
}

export interface ObfData {
  Name: string;
  RootNode: ObfJsonNode;
}

export interface O3DData {
  Name: string;
  ResourceIndex: number;
  IsAnimated: boolean;
  Obfs: ObfData[];
}

export interface Actor {
  Name: string;
  ResourceIndex: number;
  O3DResourceIndex: number;

  transform: ActorMatrix | undefined;
}

export interface TextureData {
  TextureId: number;
  PngBytes: string;
  Width: number;
  Height: number;
}

export interface JsonBuffer {
  BufferIndex: number;
  TextureId: number;
  Name: string;
  Vertices: [number, number, number][];
  UVs: [number, number][];
  Normals: [number, number, number][];
  Indices: number[];
}

export interface ObfJsonNode {
  HeaderOffset: number;
  Buffers: JsonBuffer[];
  Children: ObfJsonNode[];
}
export interface DrawCall {
  vertexBuffer: GfxBuffer;
  indexBuffer: GfxBuffer;
  indexCount: number;
  textureId: number;
}
