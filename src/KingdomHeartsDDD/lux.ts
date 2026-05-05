import { vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxDevice, GfxFormat, GfxSampler, GfxTexture, GfxTextureDimension, GfxTextureUsage } from "../gfx/platform/GfxPlatform";
import { TextureMapping } from "../TextureHolder";

// shared code between DDD and BBS, herein prefixed with "Lux"

export enum LuxModelFlagRenderMode {
    UNK,
    SKYBOX,
    UNK2,
    UNK3,
    UNK4,
    SKYBOX2,
    UNK6,
    UNK7,
    BACKGROUND, // not used but "background" geometry has this value I guess?
}

export enum LuxShapeAttributeBlend {
    OPAQUE,
    OPAQUE2,
    TRANSLUCENT,
    TRANSLUCENT2,
    ADDITIVE,
    ADDITIVE2
}

export interface LuxPMP {
    pmos: LuxModelInfo[];
}

export interface LuxModelInfo {
    id: number;
    flags: number;
    scale: vec3;
    rotation: vec3;
    position: vec3;
    pmo: LuxModel;
}

export interface LuxDataSet {
    name: string;
    olos: string[];
}

export interface LuxObjectSet {
    name: string;
    instances: LuxOLOInstance[];
}

export interface LuxOLO {
    objects: LuxOLOInstance[];
}

export interface LuxOLOInstance {
    name: string;
    position: vec3;
    rotation: vec3;
}

export interface LuxModel {
    name: string;
    scale: number;
    flags: number;
    pmpFlags: number;
    bbox: number[];
    shapes: LuxShape[];
}

export interface LuxMaterial {
    textureOffset: number;
    textureName: string;
    scrollX: number;
    scrollY: number;
}

export interface LuxPAM {
    animations: LuxSkeletalAnimation[];
}

export interface LuxSkeletalAnimation {
    name: string;
    flag: number;
    framerate: number;
    interpolateFrameCount: number;
    loopFrame: number;
    boneCount: number;
    frameCount: number;
    returnFrame: number;
    channels: LuxBoneChannel[];
}

export interface LuxBoneChannel {
    translationX?: LuxKeyframe[];
    translationY?: LuxKeyframe[];
    translationZ?: LuxKeyframe[];
    rotationX?: LuxKeyframe[];
    rotationY?: LuxKeyframe[];
    rotationZ?: LuxKeyframe[];
    scaleX?: LuxKeyframe[];
    scaleY?: LuxKeyframe[];
    scaleZ?: LuxKeyframe[];
}

export interface LuxKeyframe {
    frame: number;
    value: number;
}

export interface LuxTXA {
    name: string;
    textureName: string;
    defaultAnimationIndex: number;
    animations: LuxTextureAnimation[];
}

export interface LuxTextureAnimation {
    name: string;
    frames: LuxTXAFrame[];
}

export interface LuxTXAFrame {
    displayFrames: number; // amount of frames to show the texture, assumed to be in terms of 30 FPS
    num2: number; // always zero?
    data: ArrayBufferSlice;
}

export class LuxTexture {
    public gfxTexture: GfxTexture;

    constructor(device: GfxDevice, public name: string, public width: number, public height: number, data: Uint8Array) {
        const gfxTexture = device.createTexture({
            width, height,
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            usage: GfxTextureUsage.Sampled,
            dimension: GfxTextureDimension.n2D,
            depthOrArrayLayers: 1, numLevels: 1
        });
        device.setResourceName(gfxTexture, name);
        device.uploadTextureData(gfxTexture, 0, [data]);
        this.gfxTexture = gfxTexture;
    }
}

export class LuxShape {
    public vertices: Float32Array;
    public colors: Float32Array;
    public uvs: Float32Array;
    public indices: Uint32Array;
    public weights: Float32Array;
    public joints: Uint8Array;

    constructor(public vertexCount: number, public textureIndex: number, public attribute: number, public boneIndices: number[]) {
        this.vertices = new Float32Array(vertexCount * 3);
        this.colors = new Float32Array(vertexCount * 4);
        this.uvs = new Float32Array(vertexCount * 2);
        this.weights = new Float32Array();
        this.joints = new Uint8Array();
        this.indices = new Uint32Array();
    }
}

export class LuxMaterialInstance {
    public name: string;
    public scrollX: number;
    public scrollY: number;
    public textureMappings: TextureMapping[][];

    constructor(material: LuxMaterial, textures: LuxTexture[], gfxSampler: GfxSampler) {
        this.name = textures[0].name;
        this.scrollX = material.scrollX;
        this.scrollY = material.scrollY;
        this.textureMappings = [];
        for (const texture of textures) {
            const tm = new TextureMapping();
            tm.gfxTexture = texture.gfxTexture;
            tm.gfxSampler = gfxSampler;
            this.textureMappings.push([tm]);
        }
    }
}
