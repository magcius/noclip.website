
import { mat4, vec3 } from "gl-matrix";
import { GfxDevice, GfxIndexBufferDescriptor, GfxTexture, GfxVertexBufferDescriptor } from "../gfx/platform/GfxPlatform.js";
import { SCX } from "./scx/types.js";
import { ViewerRenderInput } from "../viewer.js";
import { ChannelAnimation } from "./animation.js";
import { GfxrGraphBuilder } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { World } from "./world.js";

export type WorldData = {
    basePath: string;
    scenes: Record<string, { scene: SCX.Scene; envID?: string }>;
    textures: Texture[];
    environmentMaps: Record<string, EnvironmentMap>;
    cameras: {name: string, address: string}[];
    simulateFunc?: () => Simulation;
};

export type Texture = {
    path: string;
    width: number;
    height: number;
    rgba8: Uint8ClampedArray;
    gfxTexture?: GfxTexture;
};

export type EnvironmentMap = {
    texturePath: string;
    rotation: [number, number, number];
    tint?: [number, number, number];
};

export type VertexAttribute = GfxVertexBufferDescriptor & { name: string; data?: Float32Array };

export type Index = GfxIndexBufferDescriptor & { data?: Uint32Array };

export type Material = {
    shader: SCX.Shader;
    gfxTexture: GfxTexture | null;
};

export type Mesh = {
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
    protected device: GfxDevice;
    protected renderHelper: GfxRenderHelper;
    protected world: World;
    setup(device: GfxDevice, renderHelper: GfxRenderHelper, world: World): void {
        this.device = device;
        this.renderHelper = renderHelper;
        this.world = world;
    }
    update(input: ViewerRenderInput): void {}
    render(builder: GfxrGraphBuilder, cameraWorldPos: vec3): void {}
    renderReset(): void {}
    destroy(): void {}
}
