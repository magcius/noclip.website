import {
  parseTrackFile,
  getResourceList,
  getResource,
  ParsedAsset,
} from "./file/track";
import { ObfNode } from "./asset/o3d/obf";
import { BlendMode } from "./asset/o3d/geometry";
import { getTextures } from "./asset/txf/TXF";
import { TrackLightData } from "./asset/gmd";
import { vec2, vec3 } from "gl-matrix";
import { Color, White } from "../Color";

export interface ExcludeInfo {
  textureIds?: Set<number>;
}

export interface JsonBuffer {
  bufferIndex: number;
  textureId: number;
  name: string;
  positions: vec3[];
  uvs: vec2[];
  normals: vec3[];
  colors: Color[];
  hasVertexColors: boolean;
  blendMode: BlendMode;
  indices: number[];
}

export interface ObfJsonNode {
  headerOffset: number;
  buffers: JsonBuffer[];
  children: ObfJsonNode[];
}

export interface ObfData {
  name: string;
  rootNode: ObfJsonNode;
}

export interface O3DData {
  name: string;
  resourceIndex: number;
  isAnimated: boolean;
  obfs: ObfData[];
  boundingSphere: BoundingSphere | null;
}

export interface BoundingSphere {
  center: vec3;
  radius: number;
}

export const enum ActorType {
  PowerUp = 8,
}

type MatrixRow = [x: number, y: number, z: number, w: number];
export type ActorTransforms = Record<number, ActorMatrix>;

export type ActorMatrix = [
  right: MatrixRow,
  up: MatrixRow,
  forward: MatrixRow,
  position: MatrixRow,
];

export interface ActorData {
  name: string;
  resourceIndex: number;
  actorType: number;
  x: number;
  y: number;
  z: number;
  o3dResourceIndex: number;
  transform: ActorMatrix | undefined;
}

export interface TextureData {
  textureId: number;
  textureData: Uint8Array[];
  width: number;
  height: number;
}

export interface RumbleRacingTrackFile {
  obfs: ObfData[];
  o3ds: O3DData[];
  actors: ActorData[];
  textures: TextureData[];
  lights: TrackLightData | null; // only half of the tracks have light data, so make it nullable
}

function buildObfNode(node: ObfNode): ObfJsonNode {
  const jNode: ObfJsonNode = {
    headerOffset: node.metadata.headerOffset,
    buffers: [],
    children: [],
  };

  if (node.rawChunk.elda.raw.size > 8) {
    for (let bufIdx = 0; bufIdx < node.geometry.buffers.length; bufIdx++) {
      const buf = node.geometry.buffers[bufIdx];
      const indices: number[] = [];
      const positions: vec3[] = [];
      const uvs: vec2[] = [];
      const normals: vec3[] = [];
      const colors: Color[] = [];
      let hasVertexColors = false;

      for (const strip of buf.primitives) {
        const base = positions.length;

        for (const vert of strip.vertices) {
          positions.push(vert.position);
          normals.push(vert.normal ?? vec3.fromValues(0, 0, 0));
          colors.push(vert.color ?? White);
          uvs.push(vert.uv);
          if (vert.color !== null) hasVertexColors = true;
        }

        let isFlipped = false;
        for (let i = 2; i < strip.vertices.length; i++) {
          if (strip.vertices[i].adcBitSet) {
            if (!strip.vertices[i - 1].adcBitSet) {
              isFlipped = false;
            } else {
              isFlipped = !isFlipped;
            }
            const A = base + i - 2;
            const B = base + i - 1;
            const C = base + i;
            if (isFlipped) {
              indices.push(A, B, C);
            } else {
              indices.push(B, A, C);
            }
          }
        }
      }

      if (indices.length === 0) continue;

      jNode.buffers.push({
        bufferIndex: bufIdx,
        textureId: buf.textureId,
        name: `${node.metadata.headerOffset}_buf${bufIdx}`,
        positions,
        uvs,
        normals,
        colors,
        hasVertexColors,
        blendMode: buf.blendMode,
        indices,
      });
    }
  }

  let child = node.lastChild;
  while (child !== null) {
    jNode.children.push(buildObfNode(child));
    child = child.prevSibling;
  }

  return jNode;
}

export function processTrackFile(
  rawData: Uint8Array,
  isGlobalFile: boolean,
): RumbleRacingTrackFile {
  const out: RumbleRacingTrackFile = {
    obfs: [],
    o3ds: [],
    actors: [],
    textures: [],
    lights: null,
  };

  const track = parseTrackFile(rawData, "track");
  const resourceList = getResourceList(track);

  for (const res of resourceList.entries) {
    if (
      res.typeTag !== "Cact" &&
      res.typeTag !== "txf " &&
      res.typeTag !== "txf2" &&
      res.typeTag !== "obf " &&
      res.typeTag !== "o3d " &&
      res.typeTag !== "o3da" &&
      res.typeTag !== "gmd "
    ) {
      continue;
    }

    // We only want to parse some specific things from the shared global file
    if (
      isGlobalFile &&
      !res.resourceName.includes("GLOBAL.TXF") && // parse out shared textures
      !res.resourceName.includes("PU_") // parse out powerup models
    )
      continue;

    let resource: ParsedAsset;
    try {
      resource = getResource(track, res);
    } catch (e) {
      console.log("Error fetching resource", res.resourceName, e);
      continue;
    }

    switch (resource.kind) {
      case "Actor": {
        const isPowerUp = resource.actorType === ActorType.PowerUp;
        if (resource.o3dResourceIndex > 0 || isPowerUp) {
          out.actors.push({
            name: res.resourceName,
            resourceIndex: res.resourceIndex,
            actorType: resource.actorType,
            x: resource.x,
            y: resource.y,
            z: resource.z,
            o3dResourceIndex: resource.o3dResourceIndex,
            transform: undefined,
          });
        }
        break;
      }
      case "Obf": {
        out.obfs.push({
          name: res.resourceName,
          rootNode: buildObfNode(resource.rootNode),
        });
        break;
      }
      case "O3D": {
        const obfs: ObfData[] = resource.obfs.map((obf, idx) => ({
          name: `obf_${idx}`,
          rootNode: buildObfNode(obf.rootNode),
        }));
        const bounds = resource.gmds[0]?.bounds ?? null;
        out.o3ds.push({
          name: res.resourceName,
          resourceIndex: res.resourceIndex,
          isAnimated: resource.isAnimated,
          obfs,
          boundingSphere:
            bounds !== null
              ? { center: bounds.sphereCenter, radius: bounds.sphereRadius }
              : null,
        });
        break;
      }
      case "TXF": {
        for (const tex of getTextures(resource)) {
          if (tex.files.length === 0) continue;
          const base = tex.files[0];
          out.textures.push({
            textureId: tex.textureId,
            textureData: tex.files.map((file) => file.image.pix),
            width: base.width,
            height: base.height,
          });
        }
        break;
      }
      case "Gmd": {
        out.lights = resource.lights;
        break;
      }
      default: {
        const g = resource as { kind: string; getType: () => string };
        throw new Error("UNHANDLED ASSET " + g.getType());
      }
    }
  }

  return out;
}
