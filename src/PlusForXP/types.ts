import { mat4, vec3 } from "gl-matrix";
import { GfxDevice, GfxIndexBufferDescriptor, GfxInputLayout, GfxTexture, GfxVertexBufferDescriptor } from "../gfx/platform/GfxPlatform.js";
import { SCX } from "./scx/types.js";
import { ViewerRenderInput } from "../viewer.js";
import { ChannelAnimation } from "./animation.js";
import { GfxrGraphBuilder } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";

export type Texture = {
  path: string,
  width: number,
  height: number,
  rgba8: Uint8Array,
  gfxTexture?: GfxTexture
};

export type Material = {
  shader: SCX.Shader,
  gfxTexture: GfxTexture | null
};

export type EnvironmentMap = {
  texturePath: string,
  rotation: [number, number, number],
  tint?: [number, number, number]
};

export type VertexAttribute = GfxVertexBufferDescriptor & {name: string, data?: Float32Array};

export type Mesh = {
  inputLayout: GfxInputLayout,
  vertexAttributes: VertexAttribute[],
  indexBufferDescriptor: GfxIndexBufferDescriptor,
  indexCount: number,
  material: Material,
  envID?: string
};

export type Transform = {
  trans: vec3,
  rot: vec3,
  scale: vec3
};

export type SceneNode = {
  name: string,
  parentName?: string,
  parent?: SceneNode,
  children: SceneNode[],
  transform: Transform,
  animatedTransform?: Transform,
  worldTransform: mat4,
  transformChanged: boolean,
  animates: boolean,
  loops: boolean,
  animations: ChannelAnimation[],
  visible: boolean,
  worldVisible: boolean,
  meshes: Mesh[],
  isGhost?: boolean
};

export abstract class Simulation {
  setup(device: GfxDevice, texturesByPath: Map<string, Texture>, materialsByName: Map<string, Material>, sceneNodesByName: Map<string, SceneNode>): void {}
  update(input: ViewerRenderInput, sceneNodesByName: Map<string, SceneNode>, device: GfxDevice): void {}
  render(renderHelper: GfxRenderHelper, builder: GfxrGraphBuilder, cameraWorldPos: vec3): void {}
  renderReset(): void {}
  destroy(device: GfxDevice): void {}
}