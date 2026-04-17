/*
 * SceneTree Types.
 *
 * The SceneTree is a flattened representation of the BLV tree that:
 * 1. Gives each "instantiation" of an object its own identity (even if the underlying LocoObject is shared)
 * 2. Caches GPU resources that can be shared between nodes
 * 3. Tracks per-instantiation animation state
 * 
 * petton-svn, 2026.
 */

import {
  GfxBuffer,
  GfxIndexBufferDescriptor,
  GfxInputLayout,
  GfxTexture,
  GfxVertexBufferDescriptor,
} from "../gfx/platform/GfxPlatform.js";
import { TextureMapping } from "../TextureHolder.js";
import { Color } from "../Color.js";
import { vec2, mat4 } from "gl-matrix";
import {
  AnimationNamedPart,
  AnimationTrack,
  SubRoot,
  LocoObject,
  RootObject,
  File as LocoFile,
  Material,
  Polygon,
  Buffer as BlvBuffer,
} from "./lib/blv.js";

/**
 * Cached GPU resources for a mesh. These are expensive to create and can be shared
 * between multiple nodes that reference the same underlying Mesh.
 */
export interface GpuMeshResources {
  readonly vertexBuffer: GfxBuffer;
  readonly indexBuffer: GfxBuffer;
  readonly inputLayout: GfxInputLayout;
  readonly vertexBufferDescriptors: GfxVertexBufferDescriptor[]; // not readonly — setVertexInput API requires mutable
  readonly indexBufferDescriptor: GfxIndexBufferDescriptor;
  readonly drawCount: number;
  readonly textureMapping: TextureMapping;

  // Local-space Z for layer sorting (before world transform)
  readonly localZ: number;

  // Local-space bounding box
  readonly localAABB: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
    readonly minZ: number;
    readonly maxZ: number;
  };
}

/* Updated every frame by SceneUpdate for visible nodes. */
export interface NodeMeshInstanceRenderState {
  z: number;
  color: Color;
  uvOffset: vec2;
  texture: GfxTexture | null;
  isFocused: boolean;
}

/**
 * Per-node mesh instance. References shared GPU resources but has its own world-space data.
 */
export interface NodeMeshInstance {
  // Parent node.
  readonly node: SceneNode;

  // Resources
  readonly gpuResources: GpuMeshResources;

  // Material/file references for animation matching
  readonly material?: Material;
  readonly file?: LocoFile;

  // For debug overlays
  readonly isDebug: boolean;
  readonly debugWorldWidth?: number;
  readonly debugWorldHeight?: number;
  readonly debugLabel?: string;
  readonly debugColor?: Color;
  readonly debugArrowDirection?: number;
  readonly debugIsCircle?: boolean;
  readonly debugTextWidthPx?: number;

  // Updated by the animation system.
  readonly renderState: NodeMeshInstanceRenderState;
}

/**
 * Animation state for a specific node instantiation.
 * This allows the same Animation to have different state when used in different contexts.
 */
export interface NodeAnimation {
  // Reference to the original animation (for accessing tracks, etc.)
  readonly namedPart: AnimationNamedPart;
  // Animation-level time (loops at part duration)
  currentTime: number;
  // Per-track playback times (each track loops at its own duration)
  readonly trackTimes: Map<AnimationTrack, number>;
  // Whether this animation's effects are applied (only one per node should be active)
  isActive: boolean;
  // Whether the active animation is advancing time (false = paused)
  isPlaying: boolean;
}

/** Cached GPU resources for a line mesh (path lines). */
export interface GpuLineResources {
  readonly vertexBuffer: GfxBuffer;
  readonly indexBuffer: GfxBuffer;
  readonly inputLayout: GfxInputLayout;
  readonly vertexBufferDescriptors: GfxVertexBufferDescriptor[];
  readonly indexBufferDescriptor: GfxIndexBufferDescriptor;
  readonly indexCount: number;
}

/** A single polyline strip (connected sequence of 2D points). */
export type LineStrip = readonly { readonly x: number; readonly y: number }[];

/* Updated every frame by SceneUpdate for visible nodes. */
export interface PathLineRenderState {
  worldMatrix: mat4; // different world matrix from SceneNode needed to support [dontScale]
}

/** A path (one or more polyline strips) to draw as connected line segments, stored in local space. */
export interface PathLine {
  // Parent node.
  readonly node: SceneNode;
  readonly color: Color;
  // One or more disconnected polyline strips in local space
  readonly strips: readonly LineStrip[];
  // If true, strip parent scale when collecting for rendering (translate+rotate only)
  readonly dontScale: boolean;
  // GPU resources for rendering (created at scene build time, in local space)
  readonly gpuResources: GpuLineResources;

  // Updated by the animation system.
  readonly renderState: PathLineRenderState;
}

/* Updated every frame by SceneUpdate for visible nodes. */
export interface SceneNodeRenderState {
  visible: boolean;
  localMatrix: mat4;
  worldMatrix: mat4;
}

/**
 * A node in the scene tree. Each node represents a unique "instantiation" of an object,
 * even if the underlying LocoObject is shared via pointer caching.
 */
export interface SceneNode {
  // The thing this node represents (for property access).
  readonly owner: LocoObject | RootObject | SubRoot | null;

  readonly renderState: SceneNodeRenderState;

  // Base transform values (for animation to modify and rebuild localMatrix)
  readonly baseTransform: {
    readonly posX: number;
    readonly posY: number;
    readonly posZ: number;
    readonly rotZ: number;
    readonly scaleX: number;
    readonly scaleY: number;
    readonly scaleZ: number;
  };
  readonly baseVisibility: boolean;

  // Object metadata
  readonly objectType: string;
  readonly objectPath: string;
  readonly name: string;

  // Mesh instances for this node
  readonly meshInstances: readonly NodeMeshInstance[];
  // Path lines to draw as connected line segments (kaze, soundline, kawa, cross markers)
  readonly pathLines: readonly PathLine[];
  // Animations that apply to this node's subtree
  readonly animations: readonly NodeAnimation[];
  // Parent node (null for the root)
  readonly parent: SceneNode | null;
  readonly children: readonly SceneNode[];
}

/**
 * The root of the scene tree, containing all nodes and shared resources.
 */
export interface SceneTree {
  readonly root: SceneNode;
  // Collision data (kept separate as it's rendered differently)
  readonly collisionPolygon: Polygon | null;
  // All GPU textures created during scene construction, keyed by source buffer
  readonly textures: ReadonlyMap<BlvBuffer, GfxTexture>;
}
