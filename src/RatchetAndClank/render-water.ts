import { mat4, vec2 } from "gl-matrix";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillMatrix4x3, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCompareMode, GfxDevice, GfxFormat, GfxInputLayout, GfxProgram, GfxTexture, GfxTextureDimension, GfxSamplerFormatKind, GfxTextureUsage, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { DeviceProgram } from "../Program";
import { assert } from "../util";
import { RatchetShaderLib } from "./shader-lib";
import { create1x1x1ErrorArrayTexture } from "./textures";
import type { MobyUpdateKit } from "./moby-impl/moby";

export interface WaterFogParams {
    near: number;
    far: number;
    nearIntensity: number;
    farIntensity: number;
    color: { r: number; g: number; b: number };
}

interface WaterAnimationParams {
    uvScroll: vec2;
    zWobble: vec2;
    randomSeed: number;
    uvRandomSeed: number;
    useWorldspaceWobble: boolean;
    uvWorldSpaceScale: number;
}

interface WaterAlphaOptions {
    blendAlpha: number;
    useTextureAlpha: boolean;
    useVertexColorAlpha: boolean;
}

interface WaterRenderOptions {
    depthWrite: boolean;
    useAdditiveBlend: boolean;
    vertexColorTexture: GfxTexture | null;
    vertexColorLayers: number[] | null;
}

// mud, lava, ice and glass are considered "honorary water"
export class WaterProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_ST = 1;
    public static a_VertexColor = 2;
    public static a_ColorLutCoords = 3;
    public static a_InstanceTransform0 = 4;
    public static a_InstanceTransform1 = 5;
    public static a_InstanceTransform2 = 6;
    public static a_InstanceUVParams = 7;
    public static a_InstanceWobbleParams = 8;
    public static a_InstanceFogColor = 9;
    public static a_InstanceFogParams = 10;
    public static a_InstanceRenderParams = 11;

    public static elementsPerInstance = 32;

    public static ub_SceneParams = 0;

    constructor() {
        super();
    }

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}
${RatchetShaderLib.SceneParams}

layout(binding = 0) uniform sampler2D u_FxTexture;
precision highp sampler2DArray;
layout(binding = 1) uniform sampler2DArray u_VertexColorTexture;
`;

    public override vert = `
layout(location = ${WaterProgram.a_Position}) in vec3 a_Position;
layout(location = ${WaterProgram.a_ST}) in vec2 a_ST;
layout(location = ${WaterProgram.a_VertexColor}) in vec4 a_VertexColor;
layout(location = ${WaterProgram.a_ColorLutCoords}) in vec2 a_ColorLutCoords;
layout(location = ${WaterProgram.a_InstanceTransform0}) in vec4 a_InstanceTransform0;
layout(location = ${WaterProgram.a_InstanceTransform1}) in vec4 a_InstanceTransform1;
layout(location = ${WaterProgram.a_InstanceTransform2}) in vec4 a_InstanceTransform2;
layout(location = ${WaterProgram.a_InstanceUVParams}) in vec4 a_InstanceUVParams; // xy = uv scroll, z = color lut layer, w = uv scale
layout(location = ${WaterProgram.a_InstanceWobbleParams}) in vec4 a_InstanceWobbleParams; // x = wobble amount, y = wobble period, z = vertical wobble seed, w = uv wobble seed
layout(location = ${WaterProgram.a_InstanceFogColor}) in vec4 a_InstanceFogColor;
layout(location = ${WaterProgram.a_InstanceFogParams}) in vec4 a_InstanceFogParams; // same as u_FogParams, overrides if fog alpha is non-zero
layout(location = ${WaterProgram.a_InstanceRenderParams}) in vec4 a_InstanceRenderParams; // x=enable texture alpha, y=use color from lut texture instead of vertex color attribute, z=wobble seed is world position, w=unused

out vec4 v_Rgba;
out vec2 v_ST;
out float v_FogFactor;
out vec3 v_FogColor;
flat out vec4 v_RenderParams;

${RatchetShaderLib.LightingFunctions}

void main() {
    mat4x3 instanceTransform = mat4x3(transpose(mat4(a_InstanceTransform0, a_InstanceTransform1, a_InstanceTransform2, vec4(0.0, 0.0, 0.0, 1.0))));
    vec3 positionWorld = instanceTransform * vec4(a_Position, 1.0);

    // calcualte wobble amount for vertical world displacement and uvs
    float zWobble = 0.0;
    float phase = seededRandom(positionWorld, a_InstanceWobbleParams.z) * 2.0 * PI;
    if (a_InstanceRenderParams.z > 0.5) {
        phase = (positionWorld.x + positionWorld.z) / 8.0; // not sure about this scale
    }
    float uvWobbleDirectionPhase = seededRandom(positionWorld, a_InstanceWobbleParams.w) * 2.0 * PI;
    vec2 uvWobbleDirection = vec2(cos(uvWobbleDirectionPhase), sin(uvWobbleDirectionPhase));
    float uvWobbleAmount = 0.0;
    if (a_InstanceWobbleParams.y > 0.0) {
        if (a_InstanceRenderParams.z > 0.5) {
            zWobble = a_InstanceWobbleParams.x * sin(phase + (u_Time.x / 1000.0) / a_InstanceWobbleParams.y);
        } else {
            zWobble = a_InstanceWobbleParams.x * sin(2.0 * PI * (u_Time.x / 60.0) / a_InstanceWobbleParams.y + phase);
            float uvPhase = seededRandom(positionWorld, a_InstanceWobbleParams.w + 19.19) * 2.0 * PI;
            uvWobbleAmount = a_InstanceWobbleParams.x * 0.5 * sin(2.0 * PI * (u_Time.x / 60.0) / a_InstanceWobbleParams.y + uvPhase);
        }
    }
    positionWorld.y += zWobble;

    // get color from vertex color or color lut
    v_Rgba = a_InstanceRenderParams.y > 0.5 ? texture(u_VertexColorTexture, vec3(a_ColorLutCoords, a_InstanceUVParams.z)) : a_VertexColor;
    vec2 uvPosition = a_ST;
    if (a_InstanceUVParams.w != 0.0) {
        uvPosition = positionWorld.xz * a_InstanceUVParams.w;
    }
    v_ST = uvPosition + a_InstanceUVParams.xy + (uvWobbleAmount * uvWobbleDirection);

    // override fog if custom fog is provided
    FogParams fogParams = u_FogParams;
    if (a_InstanceFogColor.a != 0.0) {
        fogParams.color = a_InstanceFogColor;
        fogParams.distanceNearFar = vec4(a_InstanceFogParams.xy, 0.0, 0.0);
        fogParams.intensityNearFar = vec4(a_InstanceFogParams.zw, 0.0, 0.0);
    }
    v_FogFactor = u_FogParams.color.a == 0.0 ? 0.0 : fogFactor(positionWorld, fogParams);
    v_FogColor = fogParams.color.rgb;

    v_RenderParams = a_InstanceRenderParams;
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(positionWorld, 1.0);
}
`;

    public override frag = `
${RatchetShaderLib.CommonFragmentShader}

in vec4 v_Rgba;
in vec2 v_ST;
in float v_FogFactor;
in vec3 v_FogColor;
flat in vec4 v_RenderParams;

void main() {
    if (u_RenderSettings.x == 0.0) { gl_FragColor = vec4(v_Rgba.rgb / 2.0, v_Rgba.a); return; }
    vec4 textureSample = texture(u_FxTexture, v_ST);
    if (v_RenderParams.x == 1.0) {
        textureSample.a *= 2.0;
    } else {
        textureSample.a = 1.0;
    }
    gl_FragColor = commonFragmentShader(v_Rgba, textureSample, v_FogFactor, 0.01, v_FogColor);
}
`;

}

export class WaterGeometry {
    public inputLayout: GfxInputLayout;
    public positionBuffer: GfxBuffer;
    public texcoordBuffer: GfxBuffer;
    public vertexColorBuffer: GfxBuffer;
    public colorLutCoordsBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public vertexCount: number;
    public indexCount: number;

    /**
     * Takes in:
     * - positions as f32vec3[]
     * - texcoords as f32vec2[]
     * - vertexColors as f32vec4[] or null for white
     * - indices as u16[]
     */
    constructor(private cache: GfxRenderCache, positions: Float32Array, texcoords: Float32Array, vertexColors: Float32Array | null, indices: Uint16Array, vertexColorTexturePositions: Float32Array | null = null) {
        assert(positions.length % 3 === 0);
        this.vertexCount = positions.length / 3;
        assert(texcoords.length === this.vertexCount * 2);
        const colors = vertexColors ?? new Float32Array(this.vertexCount * 4).fill(1);
        assert(colors.length === this.vertexCount * 4);
        const colorTexturePositions = vertexColorTexturePositions ?? new Float32Array(this.vertexCount * 2);
        assert(colorTexturePositions.length === this.vertexCount * 2);

        const device = cache.device;
        this.positionBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, positions.buffer, positions.byteOffset, positions.byteLength);
        this.texcoordBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, texcoords.buffer, texcoords.byteOffset, texcoords.byteLength);
        this.vertexColorBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, colors.buffer, colors.byteOffset, colors.byteLength);
        this.colorLutCoordsBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, colorTexturePositions.buffer, colorTexturePositions.byteOffset, colorTexturePositions.byteLength);

        this.indexCount = indices.length;
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indices.buffer, indices.byteOffset, indices.byteLength);

        const vertexAttributeDescriptors = [
            { location: WaterProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0 },
            { location: WaterProgram.a_ST, format: GfxFormat.F32_RG, bufferByteOffset: 0, bufferIndex: 1 },
            { location: WaterProgram.a_VertexColor, format: GfxFormat.F32_RGBA, bufferByteOffset: 0, bufferIndex: 2 },
            { location: WaterProgram.a_ColorLutCoords, format: GfxFormat.F32_RG, bufferByteOffset: 0, bufferIndex: 3 },

            { location: WaterProgram.a_InstanceTransform0, format: GfxFormat.F32_RGBA, bufferByteOffset: 0, bufferIndex: 4 },
            { location: WaterProgram.a_InstanceTransform1, format: GfxFormat.F32_RGBA, bufferByteOffset: 4 * 4, bufferIndex: 4 },
            { location: WaterProgram.a_InstanceTransform2, format: GfxFormat.F32_RGBA, bufferByteOffset: 8 * 4, bufferIndex: 4 },
            { location: WaterProgram.a_InstanceUVParams, format: GfxFormat.F32_RGBA, bufferByteOffset: 12 * 4, bufferIndex: 4 },
            { location: WaterProgram.a_InstanceWobbleParams, format: GfxFormat.F32_RGBA, bufferByteOffset: 16 * 4, bufferIndex: 4 },
            { location: WaterProgram.a_InstanceFogColor, format: GfxFormat.F32_RGBA, bufferByteOffset: 20 * 4, bufferIndex: 4 },
            { location: WaterProgram.a_InstanceFogParams, format: GfxFormat.F32_RGBA, bufferByteOffset: 24 * 4, bufferIndex: 4 },
            { location: WaterProgram.a_InstanceRenderParams, format: GfxFormat.F32_RGBA, bufferByteOffset: 28 * 4, bufferIndex: 4 },
        ];
        const vertexBufferDescriptors = [
            { byteStride: 3 * 4, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 2 * 4, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 4 * 4, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 2 * 4, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: WaterProgram.elementsPerInstance * 4, frequency: GfxVertexBufferFrequency.PerInstance },
        ];

        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat: GfxFormat.U16_R });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.positionBuffer);
        device.destroyBuffer(this.texcoordBuffer);
        device.destroyBuffer(this.vertexColorBuffer);
        device.destroyBuffer(this.colorLutCoordsBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

const bindingLayouts = [{
    numSamplers: 2,
    numUniformBuffers: 1,
    samplerEntries: [
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float },
        { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float },
    ],
}];

export class WaterRenderer {
    private program: GfxProgram;
    private fallbackTexture: GfxTexture;
    private fallbackVertexColorTexture: GfxTexture;

    constructor(private renderHelper: GfxRenderHelper) {
        this.program = renderHelper.renderCache.createProgram(new WaterProgram());
        const device = renderHelper.device;
        this.fallbackTexture = device.createTexture({
            dimension: GfxTextureDimension.n2D,
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            width: 1,
            height: 1,
            depthOrArrayLayers: 1,
            numLevels: 1,
            usage: GfxTextureUsage.Sampled,
        });
        device.uploadTextureData(this.fallbackTexture, 0, [new Uint8Array([255, 255, 255, 255])]);
        this.fallbackVertexColorTexture = create1x1x1ErrorArrayTexture(device);
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.fallbackTexture);
        device.destroyTexture(this.fallbackVertexColorTexture);
    }

    renderWater(updateKit: MobyUpdateKit, geometry: WaterGeometry, transforms: mat4[], texture: GfxTexture | null, animation: WaterAnimationParams, alpha: WaterAlphaOptions, fogParams: WaterFogParams | null, options: WaterRenderOptions): void {
        if (transforms.length === 0 || geometry.vertexCount === 0) return;

        const { instanceDataBuffer, fxSampler, renderInstList } = updateKit;
        const { uvScroll, zWobble, randomSeed, uvRandomSeed, useWorldspaceWobble, uvWorldSpaceScale } = animation;
        const { blendAlpha, useTextureAlpha, useVertexColorAlpha } = alpha;
        const { depthWrite, useAdditiveBlend, vertexColorTexture, vertexColorLayers } = options;
        const instanceDataStartBytes = instanceDataBuffer.ptr * 4;
        for (let i = 0; i < transforms.length; i++) {
            instanceDataBuffer.ptr += fillMatrix4x3(instanceDataBuffer.f32View, instanceDataBuffer.ptr, transforms[i]);
            instanceDataBuffer.ptr += fillVec4(instanceDataBuffer.f32View, instanceDataBuffer.ptr, uvScroll[0], uvScroll[1], vertexColorLayers?.[i] ?? 0, uvWorldSpaceScale);
            instanceDataBuffer.ptr += fillVec4(instanceDataBuffer.f32View, instanceDataBuffer.ptr, zWobble[0], zWobble[1], randomSeed, uvRandomSeed);
            instanceDataBuffer.ptr += fillVec4(
                instanceDataBuffer.f32View,
                instanceDataBuffer.ptr,
                fogParams ? fogParams.color.r / 0xFF : 0,
                fogParams ? fogParams.color.g / 0xFF : 0,
                fogParams ? fogParams.color.b / 0xFF : 0,
                fogParams ? 1 : 0,
            );
            instanceDataBuffer.ptr += fillVec4(
                instanceDataBuffer.f32View,
                instanceDataBuffer.ptr,
                fogParams ? fogParams.near / 1024 : 0,
                fogParams ? fogParams.far / 1024 : 0,
                fogParams ? 1 - fogParams.nearIntensity / 0xFF : 0,
                fogParams ? 1 - fogParams.farIntensity / 0xFF : 0,
            );
            instanceDataBuffer.ptr += fillVec4(
                instanceDataBuffer.f32View,
                instanceDataBuffer.ptr,
                useTextureAlpha ? 1 : 0,
                vertexColorTexture !== null ? 1 : 0,
                useWorldspaceWobble ? 1 : 0,
                0,
            );
        }

        const renderInst = this.renderHelper.renderInstManager.newRenderInst();
        renderInst.setMegaStateFlags({ depthWrite, depthCompare: GfxCompareMode.GreaterEqual });
        setAttachmentStateSimple(renderInst.getMegaStateFlags(), {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: useTextureAlpha || useVertexColorAlpha ? GfxBlendFactor.SrcAlpha : GfxBlendFactor.ConstantAlpha,
            blendDstFactor: useAdditiveBlend ? GfxBlendFactor.One : useTextureAlpha || useVertexColorAlpha ? GfxBlendFactor.OneMinusSrcAlpha : GfxBlendFactor.OneMinusConstantAlpha,
        });
        const effectiveBlendAlpha = useVertexColorAlpha ? 1 : blendAlpha;
        renderInst.setBlendColor({ r: effectiveBlendAlpha, g: effectiveBlendAlpha, b: effectiveBlendAlpha, a: effectiveBlendAlpha });
        renderInst.setBindingLayouts(bindingLayouts);
        renderInst.setGfxProgram(this.program);

        renderInst.setVertexInput(
            geometry.inputLayout,
            [
                { buffer: geometry.positionBuffer, byteOffset: 0 },
                { buffer: geometry.texcoordBuffer, byteOffset: 0 },
                { buffer: geometry.vertexColorBuffer, byteOffset: 0 },
                { buffer: geometry.colorLutCoordsBuffer, byteOffset: 0 },
                { buffer: instanceDataBuffer.gfxBuffer, byteOffset: instanceDataStartBytes },
            ],
            { buffer: geometry.indexBuffer, byteOffset: 0 },
        );
        const samplerBindings = [
            { gfxTexture: texture ?? this.fallbackTexture, gfxSampler: fxSampler },
            { gfxTexture: vertexColorTexture ?? this.fallbackVertexColorTexture, gfxSampler: fxSampler },
        ];
        renderInst.setSamplerBindings(0, samplerBindings);
        renderInst.setDrawCount(geometry.indexCount, 0);
        renderInst.setInstanceCount(transforms.length);
        renderInstList.submitRenderInst(renderInst);
    }
}