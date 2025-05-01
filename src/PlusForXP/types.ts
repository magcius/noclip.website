import { mat4, vec3, vec4 } from "gl-matrix";
import { GfxBuffer, GfxDevice, GfxIndexBufferDescriptor, GfxInputLayout, GfxTexture, GfxVertexBufferDescriptor } from "../gfx/platform/GfxPlatform.js";
import { SCX } from "./scx/types.js";
import { ViewerRenderInput } from "../viewer.js";
import { ChannelAnimation } from "./animation.js";
import { GfxrGraphBuilder } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";

export type Texture = {
    path: string;
    width: number;
    height: number;
    rgba8: Uint8ClampedArray;
    gfxTexture?: GfxTexture;
};

export type Material = {
    shader: SCX.Shader;
    gfxTexture: GfxTexture | null;
};

export type EnvironmentMap = {
    texturePath: string;
    rotation: [number, number, number];
    tint?: [number, number, number];
};

export type ComputedEnvironmentMap = {
    texture: GfxTexture;
    matrix: mat4;
    tint: vec4;
};

export type UnbakedMesh = {
    node: SceneNode;
    mesh: SCX.Mesh;
    lights: SCX.Light[];
    shader: SCX.Shader;
    diffuseColorBuffer: GfxBuffer;
    sceneName: string;
};

export type VertexAttribute = GfxVertexBufferDescriptor & { name: string; data?: Float32Array };

export type Index = GfxIndexBufferDescriptor & { data?: Uint32Array };

export type Mesh = {
    inputLayout: GfxInputLayout;
    vertexAttributes: VertexAttribute[];
    indexBufferDescriptor: Index;
    indexCount: number;
    material: Material;
    envID?: string;
};

export type SceneNode = {
    name: string;
    parentName?: string;
    parent?: SceneNode;
    children: SceneNode[];
    transform: SCX.Transform;
    animatedTransform?: SCX.Transform;
    worldTransform: mat4;
    transformChanged: boolean;
    animates: boolean;
    loops: boolean;
    animations: ChannelAnimation[];
    visible: boolean;
    worldVisible: boolean;
    meshes: Mesh[];
    isGhost: boolean;
};

export abstract class Simulation {
    setup(device: GfxDevice, texturesByPath: Map<string, Texture>, materialsByName: Map<string, Material>, sceneNodesByName: Map<string, SceneNode>): void {}
    update(input: ViewerRenderInput, sceneNodesByName: Map<string, SceneNode>, device: GfxDevice): void {}
    render(renderHelper: GfxRenderHelper, builder: GfxrGraphBuilder, cameraWorldPos: vec3): void {}
    renderReset(): void {}
    destroy(device: GfxDevice): void {}
}
