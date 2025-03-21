import { mat4, vec3 } from "gl-matrix";
import { GfxIndexBufferDescriptor, GfxInputLayout, GfxTexture, GfxVertexBufferDescriptor } from "../gfx/platform/GfxPlatform.js";
import { SCX } from "./scx/types.js";
import { ViewerRenderInput } from "../viewer.js";
import { ChannelAnimation } from "./animation.js";

export type Texture = {
  path: string,
  width: number,
  height: number,
  rgba8: Uint8Array
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

export type Mesh = {
  inputLayout: GfxInputLayout,
  vertexBufferDescriptors: GfxVertexBufferDescriptor[],
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
  meshes: Mesh[]
};

export interface ISimulation {
  setup(sceneNodesByName: Map<string, SceneNode>): void;
  update(input: ViewerRenderInput, sceneNodesByName: Map<string, SceneNode>): void;
}