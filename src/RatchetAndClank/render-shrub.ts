import { GsPrimitiveType } from "../Common/PS2/GS";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxProgram, GfxSamplerBinding, GfxSamplerFormatKind, GfxTextureDimension, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DeviceProgram } from "../Program";
import { assert } from "../util";
import { RatchetShaderLib } from "./shader-lib";
import { ShrubClass, ShrubVertex } from "./bin-core";
import { ImaginaryGsCommandType, MegaBuffer } from "./utils";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { mat4, vec3 } from "gl-matrix";
import { fillMatrix4x3, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { ShrubInstance } from "./bin-gameplay";
import { Frustum } from "../Geometry";
import { decodeLodK, packRemap, TextureAtlases } from "./textures";
import { invlerp, saturate } from "../MathHelpers";

export class ShrubProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TextureParams = 2;
    public static a_ST = 3;

    public static elementsPerVertex = 11; // position (3), normal (3), texture params (3), st (2)

    public static a_InstanceTransform0 = 4;
    public static a_InstanceTransform1 = 5;
    public static a_InstanceTransform2 = 6;
    public static a_InstanceAmbientRgba = 7;
    public static a_InstanceLightSelector = 8;
    public static a_InstanceExtraData = 9;

    public static elementsPerInstance = 23; // transform (12), ambient rgba (4), directional lights (4), extra data (lod alpha, mode bits, instance index)

    public static ub_SceneParams = 0;
    public static ub_ShrubParams = 1;

    public override both = `
precision highp float;
precision highp sampler2DArray;

${GfxShaderLibrary.MatrixLibrary}
${RatchetShaderLib.SceneParams}

layout(binding = 0) uniform sampler2DArray u_Texture_16;
layout(binding = 1) uniform sampler2DArray u_Texture_32;
layout(binding = 2) uniform sampler2DArray u_Texture_64;
layout(binding = 3) uniform sampler2DArray u_Texture_128;
layout(binding = 4) uniform sampler2DArray u_Texture_256;

`;

    public override vert = `

layout(location = ${ShrubProgram.a_Position}) in vec3 a_Position;
layout(location = ${ShrubProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${ShrubProgram.a_TextureParams}) in vec3 a_TextureParams; // x = texture index, y = clamp flag, z = LOD K
layout(location = ${ShrubProgram.a_ST}) in vec2 a_ST;

layout(location = ${ShrubProgram.a_InstanceTransform0}) in vec4 a_InstanceTransform0;
layout(location = ${ShrubProgram.a_InstanceTransform1}) in vec4 a_InstanceTransform1;
layout(location = ${ShrubProgram.a_InstanceTransform2}) in vec4 a_InstanceTransform2;
layout(location = ${ShrubProgram.a_InstanceAmbientRgba}) in vec4 a_InstanceAmbientRgba;
layout(location = ${ShrubProgram.a_InstanceLightSelector}) in vec3 a_InstanceLightSelector;
layout(location = ${ShrubProgram.a_InstanceExtraData}) in vec3 a_InstanceExtraData; // x = LOD alpha, y = mode bits, z = instance index

out vec4 v_Rgba;
out vec2 v_ST;
out float v_FogFactor;
flat out int v_TextureIndex;
flat out int v_Clamp;
flat out float v_LodK;

${RatchetShaderLib.LightingFunctions}
${GfxShaderLibrary.MulNormalMatrix}

void main() {
    mat4x3 instanceTransform = mat4x3(transpose(mat4(a_InstanceTransform0, a_InstanceTransform1, a_InstanceTransform2, vec4(0, 0, 0, 1))));
    vec3 morphedPosition = a_Position;
    morphedPosition.xy += windSkew(a_InstanceExtraData.z, u_Time.x / 1000.0, a_InstanceExtraData.y) * morphedPosition.z;

    vec3 positionWorld = instanceTransform * vec4(morphedPosition, 1.0f);
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(positionWorld, 1.0f);

    vec3 normal = MulNormalMatrix(instanceTransform, a_Normal);

    vec4 rgba = a_InstanceAmbientRgba.rgba;
    v_Rgba = commonVertexLighting(rgba, normal, a_InstanceLightSelector);
    v_Rgba.a *= a_InstanceExtraData.x;

    v_ST = a_ST.xy;
    v_FogFactor = fogFactor(positionWorld.xyz, u_FogParams);
    v_TextureIndex = int(a_TextureParams.x);
    v_Clamp = int(a_TextureParams.y);
    v_LodK = a_TextureParams.z;
}
`;

    public override frag = `

in vec4 v_Rgba;
in vec2 v_ST;
in float v_FogFactor;
flat in int v_TextureIndex;
flat in int v_Clamp;
flat in float v_LodK;

${RatchetShaderLib.CommonFragmentShader}
${RatchetShaderLib.Sampler}

void main() {
    if (u_RenderSettings.x == 0.0) { gl_FragColor = vec4(v_Rgba.rgb / 2.0, v_Rgba.a); return; }
    ivec2 texRemap = getTexRemap(v_TextureIndex);
    vec4 textureSample = ratchetSampler(texRemap, v_Clamp, v_ST, v_LodK);
    gl_FragColor = commonFragmentShader(v_Rgba, textureSample, v_FogFactor, 0.01);
}

`;

}

export class ShrubGeometry {
    public inputLayout: GfxInputLayout;

    private vertexBuffer: GfxBuffer;
    private vertexCount: number;

    constructor(private cache: GfxRenderCache, public shrub: ShrubClass, private textureIndices: number[], private textureAtlases: TextureAtlases) {
        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                // per vertex
                { location: ShrubProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0, },
                { location: ShrubProgram.a_Normal, format: GfxFormat.F32_RGB, bufferByteOffset: 3 * 4, bufferIndex: 0, },
                { location: ShrubProgram.a_TextureParams, format: GfxFormat.F32_RGB, bufferByteOffset: 6 * 4, bufferIndex: 0, },
                { location: ShrubProgram.a_ST, format: GfxFormat.F32_RG, bufferByteOffset: 9 * 4, bufferIndex: 0, },
                // per instance
                { location: ShrubProgram.a_InstanceTransform0, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 * 4, bufferIndex: 1, },
                { location: ShrubProgram.a_InstanceTransform1, format: GfxFormat.F32_RGBA, bufferByteOffset: 4 * 4, bufferIndex: 1, },
                { location: ShrubProgram.a_InstanceTransform2, format: GfxFormat.F32_RGBA, bufferByteOffset: 8 * 4, bufferIndex: 1, },
                { location: ShrubProgram.a_InstanceAmbientRgba, format: GfxFormat.F32_RGBA, bufferByteOffset: 12 * 4, bufferIndex: 1, },
                { location: ShrubProgram.a_InstanceLightSelector, format: GfxFormat.F32_RGB, bufferByteOffset: 16 * 4, bufferIndex: 1, },
                { location: ShrubProgram.a_InstanceExtraData, format: GfxFormat.F32_RGB, bufferByteOffset: 20 * 4, bufferIndex: 1, },
            ],
            vertexBufferDescriptors: [
                { byteStride: ShrubProgram.elementsPerVertex * 0x4, frequency: GfxVertexBufferFrequency.PerVertex, },
                { byteStride: ShrubProgram.elementsPerInstance * 0x4, frequency: GfxVertexBufferFrequency.PerInstance, },
            ],

            indexBufferFormat: null,
        });
    }

    public getOrCreateVertexBuffer() {
        if (!this.vertexBuffer) {
            const vertexData = this.assemble(this.shrub, this.textureIndices);
            const device = this.cache.device;
            this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertexData.vertexArrayBuffer.buffer);
            device.setResourceName(this.vertexBuffer, `Shrub Class ${this.shrub.header.oClass} (VB)`);
            this.vertexCount = vertexData.vertexCount;
        }
        return {
            vertexBuffer: this.vertexBuffer,
            vertexCount: this.vertexCount,
        };
    }

    private assemble(shrub: ShrubClass, textureIndices: number[]) {
        const scale = shrub.header.scale * (1 / 1024);
        const normalScale = 1 / 0x7fff;
        const texcoordScale = 1 / 4096;

        let vertexCount = 0;
        let currentPrimitiveType: GsPrimitiveType | null = null;

        for (let packetIndex = 0; packetIndex < shrub.body.packets.length; packetIndex++) {
            const commandBuffer = shrub.body.packets[packetIndex];
            let vertsSinceLastReset = 0;
            function endPrimitives() {
                switch (currentPrimitiveType) {
                    case GsPrimitiveType.TRIANGLE_STRIP:
                        vertexCount += Math.max(0, vertsSinceLastReset - 2) * 3;
                        break;
                    case GsPrimitiveType.TRIANGLE:
                        vertexCount += vertsSinceLastReset;
                        break;
                }
            }
            for (let i = 0; i < commandBuffer.length; i++) {
                const command = commandBuffer[i];
                switch (command.type) {
                    case ImaginaryGsCommandType.PRIMITIVE_RESET: {
                        endPrimitives();
                        currentPrimitiveType = command.value.type;
                        vertsSinceLastReset = 0;
                        break;
                    }
                    case ImaginaryGsCommandType.VERTEX: {
                        vertsSinceLastReset++;
                        break;
                    }
                }
            }
            endPrimitives();
        }

        currentPrimitiveType = null;
        const vertexArrayBuffer = new Float32Array(vertexCount * ShrubProgram.elementsPerVertex);
        let vertexPtr = 0;
        let currentMaterial: { texture: number, clamp: number, lodK: number } | undefined;
        const tri = [null, null, null] as [ShrubVertex | null, ShrubVertex | null, ShrubVertex | null];

        for (let packetIndex = 0; packetIndex < shrub.body.packets.length; packetIndex++) {
            const commandBuffer = shrub.body.packets[packetIndex];

            for (let i = 0; i < commandBuffer.length; i++) {
                const command = commandBuffer[i];

                switch (command.type) {
                    case ImaginaryGsCommandType.PRIMITIVE_RESET: {
                        assert(currentMaterial !== undefined);
                        currentPrimitiveType = command.value.type;
                        tri[0] = null;
                        tri[1] = null;
                        tri[2] = null;
                        break;
                    }
                    case ImaginaryGsCommandType.SET_MATERIAL: {
                        currentMaterial = {
                            texture: command.value.adGif.tex0.low,
                            clamp: command.value.adGif.clamp.low + (command.value.adGif.clamp.high << 2),
                            lodK: decodeLodK(command.value.adGif.tex1.low),
                        };
                        break;
                    }
                    case ImaginaryGsCommandType.VERTEX: {
                        const vert = command.value;
                        let kick = false;

                        assert(currentPrimitiveType !== null);
                        if (currentPrimitiveType === GsPrimitiveType.TRIANGLE_STRIP) {
                            tri[0] = tri[1];
                            tri[1] = tri[2];
                            tri[2] = vert;
                            if (tri[0] !== null) kick = true;
                        } else if (currentPrimitiveType === GsPrimitiveType.TRIANGLE) {
                            if (tri[0] === null) tri[0] = vert;
                            else if (tri[1] === null) tri[1] = vert;
                            else if (tri[2] === null) tri[2] = vert;
                            if (tri[2] !== null) kick = true;
                        }

                        if (kick) {
                            assert(currentMaterial !== undefined);

                            for (let j = 0; j < 3; j++) {
                                const vertex = tri[j];
                                assert(vertex !== null);
                                const normal = shrub.body.normals[vertex.n];

                                vertexArrayBuffer[vertexPtr++] = scale * vertex.x;
                                vertexArrayBuffer[vertexPtr++] = scale * vertex.y;
                                vertexArrayBuffer[vertexPtr++] = scale * vertex.z;
                                vertexArrayBuffer[vertexPtr++] = normalScale * normal.x;
                                vertexArrayBuffer[vertexPtr++] = normalScale * normal.y;
                                vertexArrayBuffer[vertexPtr++] = normalScale * normal.z;
                                vertexArrayBuffer[vertexPtr++] = packRemap(this.textureAtlases.shrubTextureRemap[textureIndices[currentMaterial.texture]]);
                                vertexArrayBuffer[vertexPtr++] = currentMaterial.clamp;
                                vertexArrayBuffer[vertexPtr++] = currentMaterial.lodK;
                                vertexArrayBuffer[vertexPtr++] = texcoordScale * vertex.s;
                                vertexArrayBuffer[vertexPtr++] = texcoordScale * vertex.t;
                            }
                        }

                        if (currentPrimitiveType === GsPrimitiveType.TRIANGLE) {
                            tri[0] = null;
                            tri[1] = null;
                            tri[2] = null;
                        }
                    }
                }
            }
        }

        assert(vertexPtr === vertexCount * ShrubProgram.elementsPerVertex);
        assert(vertexPtr === vertexArrayBuffer.length);

        return { vertexArrayBuffer, vertexCount };

    }

    public destroy(device: GfxDevice): void {
        if (this.vertexBuffer) {
            device.destroyBuffer(this.vertexBuffer);
        }
    }
}

const bindingLayouts = [
    {
        numSamplers: 5,
        numUniformBuffers: 2,
        samplerEntries: [
            { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
            { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
            { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
            { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
            { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
        ],
    }
];

export class ShrubRenderer {
    private shrubProgram: GfxProgram;

    constructor(private renderHelper: GfxRenderHelper) {
        this.shrubProgram = renderHelper.renderCache.createProgram(new ShrubProgram());
    }

    renderShrub(renderInstList: GfxRenderInstList, shrubGeometry: ShrubGeometry, shrubInstances: ShrubInstance[], textureMappings: GfxSamplerBinding[], cameraPosition: vec3, cameraFrustum: Frustum, settingLodPreset: number, settingLodBias: number, instanceDataBuffer: MegaBuffer): void {
        type ShrubDrawInstance = { objectMatrix: mat4, lightSelector: ShrubInstance["lightSelector"], rgb: { r: number, g: number, b: number }, lodAlpha: number, windSeed: number };
        const shrubInstancesToDraw: ShrubDrawInstance[] = [];
        for (let i = 0; i < shrubInstances.length; i++) {
            const shrubInstance = shrubInstances[i];

            // shrub instance transform
            const objectMatrix = shrubInstance._matrixPretransformed;
            const position = shrubInstance._positionPretransformed;
            const distanceToCameraSquared = vec3.sqrDist(position, cameraPosition);

            // lod
            let lodAlpha = settingLodPreset === 0 ? 1 : 0;
            if (settingLodPreset === -1) {
                const farDist = shrubInstance.drawDistance + settingLodBias * 1.5;
                if (farDist > 0) {
                    if (distanceToCameraSquared > farDist ** 2) continue;
                    const nearDist = farDist * 0.5;
                    if (distanceToCameraSquared < nearDist ** 2) {
                        lodAlpha = 1;
                    } else {
                        lodAlpha = saturate(1 - invlerp(nearDist, farDist, Math.sqrt(distanceToCameraSquared)));
                    }
                }
            }
            if (lodAlpha <= 0) continue;

            // find bounding sphere and frustum cull
            // (32 is the range of a 12.4 fixed point)
            if (!cameraFrustum.containsSphere(position, 32 * shrubGeometry.shrub.header.scale * shrubInstance._scalePretransformed)) {
                continue;
            }

            shrubInstancesToDraw.push({
                objectMatrix,
                lightSelector: shrubInstance.lightSelector,
                rgb: shrubInstance.color,
                lodAlpha,
                windSeed: shrubInstance._i,
            })
        }

        if (!shrubInstancesToDraw.length) return;

        const renderInst = this.renderHelper.renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.shrubProgram);
        renderInst.setBindingLayouts(bindingLayouts);

        // per instance data
        const instanceDataStartBytes = instanceDataBuffer.ptr * 4;
        for (let i = 0; i < shrubInstancesToDraw.length; i++) {
            const inst = shrubInstancesToDraw[i];
            const color = inst.rgb;
            instanceDataBuffer.ptr += fillMatrix4x3(instanceDataBuffer.f32View, instanceDataBuffer.ptr, inst.objectMatrix);
            instanceDataBuffer.ptr += fillVec4(instanceDataBuffer.f32View, instanceDataBuffer.ptr, color.r / 0x80, color.g / 0x80, color.b / 0x80, 1);
            instanceDataBuffer.ptr += fillVec4(instanceDataBuffer.f32View, instanceDataBuffer.ptr, inst.lightSelector.lightIndices[0], inst.lightSelector.lightIndices[1], inst.lightSelector.weight, 0);
            instanceDataBuffer.f32View[instanceDataBuffer.ptr++] = inst.lodAlpha;
            instanceDataBuffer.f32View[instanceDataBuffer.ptr++] = shrubGeometry.shrub.header.modeBits;
            instanceDataBuffer.f32View[instanceDataBuffer.ptr++] = inst.windSeed;
        }

        const vertexData = shrubGeometry.getOrCreateVertexBuffer();

        renderInst.setVertexInput(
            shrubGeometry.inputLayout,
            [
                { buffer: vertexData.vertexBuffer, byteOffset: 0 },
                { buffer: instanceDataBuffer.gfxBuffer, byteOffset: instanceDataStartBytes },
            ],
            null,
        );
        renderInst.setSamplerBindingsFromTextureMappings(textureMappings);
        renderInst.setDrawCount(vertexData.vertexCount, 0);
        renderInst.setInstanceCount(shrubInstancesToDraw.length);
        renderInstList.submitRenderInst(renderInst);
    }
}
