import { mat4, vec3 } from "gl-matrix";
import { Frustum } from "../Geometry";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillMatrix4x3, fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxProgram, GfxSamplerBinding, GfxSamplerFormatKind, GfxTextureDimension, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { DeviceProgram } from "../Program";
import { assert } from "../util";
import { TieClass, TieVertexWithNormalAndRgba } from "./bin-core";
import { TieInstance } from "./bin-gameplay";
import { RatchetShaderLib } from "./shader-lib";
import { GN, ImaginaryGsCommandType, MegaBuffer } from "./utils";

export class TieProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_ExtraData = 1;
    public static a_ST = 2;
    public static a_Normal = 3;
    public static a_LodMorphOffset = 4;

    public static elementsPerVertex = 14; // position (3), extras(3), st (2), normal (3), morph offset (3) = 14

    public static a_InstanceTransform0 = 5;
    public static a_InstanceTransform1 = 6;
    public static a_InstanceTransform2 = 7;
    public static a_InstanceDirectionLights = 8;
    public static a_InstanceExtraData = 9;

    public static elementsPerInstance = 20; // transform (12), lights (4), extra (4)

    public static ub_SceneParams = 0;
    public static ub_TieParams = 1;

    public override both = `
precision highp float;
precision highp sampler2DArray;

${GfxShaderLibrary.MatrixLibrary}
${RatchetShaderLib.SceneParams}

layout(location = 0) uniform sampler2DArray u_Texture_16;
layout(location = 1) uniform sampler2DArray u_Texture_32;
layout(location = 2) uniform sampler2DArray u_Texture_64;
layout(location = 3) uniform sampler2DArray u_Texture_128;
layout(location = 4) uniform sampler2DArray u_Texture_256;

layout(location = 5) uniform sampler2D u_AmbientRgbaTexture;

`;

    public override vert = `

layout(location = ${TieProgram.a_Position}) in vec3 a_Position;
layout(location = ${TieProgram.a_ExtraData}) in vec3 a_ExtraData; // x = texture index, y = clamp, z = rgba index
layout(location = ${TieProgram.a_ST}) in vec2 a_ST;
layout(location = ${TieProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${TieProgram.a_LodMorphOffset}) in vec3 a_LodMorphOffset;

layout(location = ${TieProgram.a_InstanceTransform0}) in vec4 a_InstanceTransform0;
layout(location = ${TieProgram.a_InstanceTransform1}) in vec4 a_InstanceTransform1;
layout(location = ${TieProgram.a_InstanceTransform2}) in vec4 a_InstanceTransform2;
layout(location = ${TieProgram.a_InstanceDirectionLights}) in vec4 a_InstanceDirectionLights;
layout(location = ${TieProgram.a_InstanceExtraData}) in vec4 a_InstanceExtraData; // x = ambient RGBA row index, y = lod morph factor, z = enable vertex colors

out vec2 v_ST;
out vec4 v_Rgba;
out float v_FogFactor;
flat out int v_TextureIndex;
flat out int v_Clamp;

${RatchetShaderLib.LightingFunctions}
${GfxShaderLibrary.MulNormalMatrix}

void main() {
    float lodMorphFactor = a_InstanceExtraData.y;
    vec3 morphedPosition = a_Position + a_LodMorphOffset * lodMorphFactor;
    mat4x3 instanceTransform = mat4x3(transpose(mat4(a_InstanceTransform0, a_InstanceTransform1, a_InstanceTransform2, vec4(0, 0, 0, 1))));
    vec3 positionWorld = instanceTransform * vec4(morphedPosition, 1.0f);

    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(positionWorld, 1.0f);
    v_ST = a_ST;

    vec4 rgba = vec4(0.5, 0.5, 0.5, 1.0);
    if (a_InstanceExtraData.z == 1.0) { // enable/disable vertex colors
        ivec2 ambientRgbaTexcoord = ivec2(int(a_ExtraData.z), int(a_InstanceExtraData.x));
        rgba = texelFetch(TEXTURE(u_AmbientRgbaTexture), ambientRgbaTexcoord, 0);
    }
    rgba.rgb *= 2.0; // not sure about this
    vec4 lights = a_InstanceDirectionLights;
    vec3 normal = MulNormalMatrix(instanceTransform, a_Normal);

    v_Rgba = commonVertexLighting(rgba, normal, lights);
    v_FogFactor = fogFactor(positionWorld.xyz);
    v_TextureIndex = int(a_ExtraData.x);
    v_Clamp = int(a_ExtraData.y);
}

`;

    public override frag = `
${RatchetShaderLib.CommonFragmentShader}
${RatchetShaderLib.Sampler}

in vec2 v_ST;
in vec4 v_Rgba;
in float v_FogFactor;
flat in int v_TextureIndex;
flat in int v_Clamp;

void main() {
    if (u_RenderSettings.x == 0.0) { gl_FragColor = vec4(v_Rgba.rgb / 2.0, v_Rgba.a); return; }
    ivec2 texRemap = getTexRemap(u_TextureRemaps.ties, v_TextureIndex);
    vec4 textureSample = ratchetSampler(texRemap, v_Clamp, v_ST);
    gl_FragColor = commonFragmentShader(v_Rgba, textureSample, v_FogFactor);
}
`;

}

export class TieGeometry {
    public inputLayout: GfxInputLayout;

    private vertexBuffer: GfxBuffer;
    private vertexCount: number;

    constructor(private cache: GfxRenderCache, private tieOClass: number, private tie: TieClass, private lodLevel: number, private textureIndices: number[]) {
        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                // per vertex
                { location: TieProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0, },
                { location: TieProgram.a_ExtraData, format: GfxFormat.F32_RGB, bufferByteOffset: 3 * 4, bufferIndex: 0, },
                { location: TieProgram.a_ST, format: GfxFormat.F32_RG, bufferByteOffset: 6 * 4, bufferIndex: 0, },
                { location: TieProgram.a_Normal, format: GfxFormat.F32_RGB, bufferByteOffset: 8 * 4, bufferIndex: 0, },
                { location: TieProgram.a_LodMorphOffset, format: GfxFormat.F32_RGB, bufferByteOffset: 11 * 4, bufferIndex: 0, },
                // per instance
                { location: TieProgram.a_InstanceTransform0, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 * 4, bufferIndex: 1, },
                { location: TieProgram.a_InstanceTransform1, format: GfxFormat.F32_RGBA, bufferByteOffset: 4 * 4, bufferIndex: 1, },
                { location: TieProgram.a_InstanceTransform2, format: GfxFormat.F32_RGBA, bufferByteOffset: 8 * 4, bufferIndex: 1, },
                { location: TieProgram.a_InstanceDirectionLights, format: GfxFormat.F32_RGBA, bufferByteOffset: 12 * 4, bufferIndex: 1, },
                { location: TieProgram.a_InstanceExtraData, format: GfxFormat.F32_RGBA, bufferByteOffset: 16 * 4, bufferIndex: 1, },
            ],
            vertexBufferDescriptors: [
                { byteStride: TieProgram.elementsPerVertex * 0x4, frequency: GfxVertexBufferFrequency.PerVertex, },
                { byteStride: TieProgram.elementsPerInstance * 0x4, frequency: GfxVertexBufferFrequency.PerInstance, },
            ],
            indexBufferFormat: null,
        });
    }

    public getOrCreateVertexBuffer() {
        if (!this.vertexBuffer) {
            const device = this.cache.device;
            const vertexData = this.assemble();
            this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertexData.vertexArrayBuffer.buffer);
            device.setResourceName(this.vertexBuffer, `Tie Class ${this.tieOClass} (VB)`);
            this.vertexCount = vertexData.vertexCount;
        }
        return {
            vertexBuffer: this.vertexBuffer,
            vertexCount: this.vertexCount,
        };
    }

    private assemble() {
        const tie = this.tie;
        const lod = this.lodLevel;
        const textureIndices = this.textureIndices;

        const positionScale = tie.scale * (1 / 1024);
        const texcoordScale = 1 / 4096;
        const normalScale = 1 / 0x7FFF;

        let vertexCount = 0;

        for (let packetIndex = 0; packetIndex < tie.packets[lod].length; packetIndex++) {
            const packet = tie.packets[lod][packetIndex];
            for (let i = 0; i < packet.body.commandBuffer.length; i++) {
                const command = packet.body.commandBuffer[i];
                switch (command.type) {
                    case ImaginaryGsCommandType.PRIMITIVE_RESET: {
                        const strip = command.value;
                        vertexCount += 3 * (strip.vertexCount - 2);
                        break;
                    }
                }
            }
        }

        const vertexArrayBuffer = new Float32Array(vertexCount * TieProgram.elementsPerVertex);
        let vertexPtr = 0;
        let currentMaterial: { texture: number, clamp: number } | undefined;

        let expectedVertsInStrip = 0;
        let tri = [null, null, null] as [TieVertexWithNormalAndRgba | null, TieVertexWithNormalAndRgba | null, TieVertexWithNormalAndRgba | null];

        for (let packetIndex = 0; packetIndex < tie.packets[lod].length; packetIndex++) {
            const packet = tie.packets[lod][packetIndex];

            for (let i = 0; i < packet.body.commandBuffer.length; i++) {
                const command = packet.body.commandBuffer[i];

                switch (command.type) {
                    case ImaginaryGsCommandType.PRIMITIVE_RESET: {
                        if (!currentMaterial) {
                            throw new Error(`Unexpected primitive reset before material`);
                        }
                        const strip = command.value;
                        assert(expectedVertsInStrip === 0);
                        expectedVertsInStrip = strip.vertexCount;
                        tri[0] = null;
                        tri[1] = null;
                        tri[2] = null;
                        break;
                    }
                    case ImaginaryGsCommandType.SET_MATERIAL: {
                        currentMaterial = {
                            texture: command.value.material,
                            clamp: command.value.clamp,
                        };
                        assert(expectedVertsInStrip === 0);
                        break;
                    }
                    case ImaginaryGsCommandType.VERTEX: {
                        const vert = command.value;
                        assert(expectedVertsInStrip > 0);
                        expectedVertsInStrip--;

                        tri[0] = tri[1];
                        tri[1] = tri[2];
                        tri[2] = vert;

                        if (tri[0]) {
                            assert(tri[1] !== null);
                            assert(tri[2] !== null);
                            assert(currentMaterial !== undefined);

                            const fixedTexcoords = this.fixTexcoords(tri[0].vertex, tri[1].vertex, tri[2].vertex);

                            for (let i = 0; i < 3; i++) {
                                const v = tri[i];
                                assert(v !== null);
                                const { vertex, normalIndex, rgbaIndex } = v;
                                const fixedTexcoord = fixedTexcoords[i];
                                let normal = tie.normalsData[normalIndex];
                                if (normal === undefined) normal = { x: 1 / normalScale, y: 0, z: 0 }; // FIXME: rac2 normal indices don't work

                                vertexArrayBuffer[vertexPtr++] = positionScale * vertex.x;
                                vertexArrayBuffer[vertexPtr++] = positionScale * vertex.y;
                                vertexArrayBuffer[vertexPtr++] = positionScale * vertex.z;
                                vertexArrayBuffer[vertexPtr++] = textureIndices[currentMaterial.texture];
                                vertexArrayBuffer[vertexPtr++] = currentMaterial.clamp;
                                vertexArrayBuffer[vertexPtr++] = rgbaIndex;
                                vertexArrayBuffer[vertexPtr++] = texcoordScale * fixedTexcoord.s;
                                vertexArrayBuffer[vertexPtr++] = texcoordScale * fixedTexcoord.t;
                                assert(vertex.q === 4096);
                                vertexArrayBuffer[vertexPtr++] = normalScale * normal.x;
                                vertexArrayBuffer[vertexPtr++] = normalScale * normal.y;
                                vertexArrayBuffer[vertexPtr++] = normalScale * normal.z;
                                vertexArrayBuffer[vertexPtr++] = positionScale * vertex.lodMorphOffsetX;
                                vertexArrayBuffer[vertexPtr++] = positionScale * vertex.lodMorphOffsetY;
                                vertexArrayBuffer[vertexPtr++] = positionScale * vertex.lodMorphOffsetZ;
                            }
                        }
                    }
                }
            }

            assert(expectedVertsInStrip === 0);
        }

        assert(vertexPtr === vertexCount * TieProgram.elementsPerVertex);
        assert(vertexPtr === vertexArrayBuffer.length);

        return { vertexArrayBuffer, vertexCount };
    }

    private fixTexcoords(v0: { s: number, t: number }, v1: { s: number, t: number }, v2: { s: number, t: number }) {
        // if adjacent verts have very different texcoords, they're intended to overflow and wrap around
        // returns a copy only if a change was required.

        let changed = false;

        const minS = Math.min(v0.s, v1.s, v2.s);
        const maxS = Math.max(v0.s, v1.s, v2.s);
        const minT = Math.min(v0.t, v1.t, v2.t);
        const maxT = Math.max(v0.t, v1.t, v2.t);

        if (maxS - minS > 8 * 4096) {
            for (const vert of [v0, v1, v2]) {
                if (vert.s < 8 * 4096) vert.s += 16 * 4096;
                changed = true;
            }
        }

        if (maxT - minT > 8 * 4096) {
            for (const vert of [v0, v1, v2]) {
                if (vert.t < 8 * 4096) vert.t += 16 * 4096;
                changed = true;
            }
        }

        if (changed) {
            return [
                { s: v0.s, t: v0.t },
                { s: v1.s, t: v1.t },
                { s: v2.s, t: v2.t },
            ];
        } else {
            return [v0, v1, v2];
        }
    }

    public destroy(device: GfxDevice): void {
        if (this.vertexBuffer) {
            device.destroyBuffer(this.vertexBuffer);
        }
    }
}

const scratchVec3 = vec3.create();

const bindingLayouts = [
    {
        numSamplers: 6,
        numUniformBuffers: 2,
        samplerEntries: [
            { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
            { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
            { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
            { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
            { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
            { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        ],
    }
];

export class TieRenderer {
    private tieProgram: GfxProgram;

    constructor(private renderHelper: GfxRenderHelper) {
        this.tieProgram = renderHelper.renderCache.createProgram(new TieProgram());
    }

    renderTie(renderInstList: GfxRenderInstList, tieGeometriesByLod: (TieGeometry | null)[], tieClass: TieClass, tieInstanceBatch: TieInstance[], textureMappings: GfxSamplerBinding[], cameraPosition: vec3, cameraFrustum: Frustum, settingLodPreset: number, settingLodBias: number, gn:GN, instanceDataBuffer: MegaBuffer): void {
        const enableVertexColors = gn === 1;

        type TieDrawInstance = { objectMatrix: mat4, directionLights: number[], rgbasRow: number, lodMorphFactor: number };
        const tieInstancesToDrawByLod: TieDrawInstance[][] = [[], [], []];
        for (let i = 0; i < tieInstanceBatch.length; i++) {
            const tieInstance = tieInstanceBatch[i];

            // tie instance transform
            const objectMatrix = tieInstance._matrixInNoclipSpace;
            let position = scratchVec3;
            mat4.getTranslation(position, objectMatrix);

            // camera position
            const distanceToCamera = vec3.distance(position, cameraPosition);

            // determine LOD level
            const hasLod2 = !!tieGeometriesByLod[2];
            const hasLod1 = !!tieGeometriesByLod[1];
            let modelLodLevel = settingLodPreset;
            let lodMorphFactor = 0;
            if (settingLodPreset === -1) {
                let smoothLod = 0;
                let nearDist = tieClass.nearDist + settingLodBias;
                let midDist = tieClass.midDist + settingLodBias * 2;
                let farDist = tieClass.farDist + settingLodBias * 3;
                if (distanceToCamera < nearDist) {
                    smoothLod = 0;
                } else if (distanceToCamera < midDist) {
                    smoothLod = (distanceToCamera - nearDist) / (midDist - nearDist);
                } else if (distanceToCamera < farDist) {
                    smoothLod = 1 + (distanceToCamera - midDist) / (farDist - midDist);
                } else {
                    smoothLod = 2;
                }
                modelLodLevel = Math.floor(smoothLod);
                lodMorphFactor = smoothLod - modelLodLevel;
            }
            if (modelLodLevel === 2 && !hasLod2) { modelLodLevel = 1; lodMorphFactor = 0; }
            if (modelLodLevel === 1 && !hasLod1) { modelLodLevel = 0; lodMorphFactor = 0; }

            // find bounding sphere and frustum cull
            const objectScale = Math.hypot(objectMatrix[0], objectMatrix[1], objectMatrix[2]);
            if (!cameraFrustum.containsSphere(position, 0x7FFF / 1024 * tieClass.scale * objectScale)) {
                continue;
            }

            tieInstancesToDrawByLod[modelLodLevel].push({
                objectMatrix,
                directionLights: tieInstance.directionalLights,
                lodMorphFactor,
                rgbasRow: tieInstance.instanceIndex,
            });
        }

        for (let i = 0; i < tieInstancesToDrawByLod.length; i++) {
            const lodLevel = i;
            const tieInstancesToDraw = tieInstancesToDrawByLod[i];
            if (!tieInstancesToDraw.length) continue;

            const tieGeometry = tieGeometriesByLod[lodLevel];
            if (!tieGeometry) continue;
            const vertexData = tieGeometry.getOrCreateVertexBuffer();

            const renderInst = this.renderHelper.renderInstManager.newRenderInst();
            renderInst.setGfxProgram(this.tieProgram);
            renderInst.setBindingLayouts(bindingLayouts);

            const instanceDataStartBytes = instanceDataBuffer.ptr * 4;
            for (let i = 0; i < tieInstancesToDraw.length; i++) {
                const inst = tieInstancesToDraw[i];
                instanceDataBuffer.ptr += fillMatrix4x3(instanceDataBuffer.f32View, instanceDataBuffer.ptr, inst.objectMatrix);
                instanceDataBuffer.ptr += fillVec4(instanceDataBuffer.f32View, instanceDataBuffer.ptr, inst.directionLights[0], inst.directionLights[1], inst.directionLights[2], inst.directionLights[3]);
                instanceDataBuffer.ptr += fillVec4(instanceDataBuffer.f32View, instanceDataBuffer.ptr, inst.rgbasRow, inst.lodMorphFactor, enableVertexColors ? 1 : 0, 0);
            }

            renderInst.setVertexInput(
                tieGeometry.inputLayout,
                [
                    { buffer: vertexData.vertexBuffer, byteOffset: 0 },
                    { buffer: instanceDataBuffer.gfxBuffer, byteOffset: instanceDataStartBytes },
                ],
                null,
            );

            renderInst.setSamplerBindingsFromTextureMappings(textureMappings);
            renderInst.setInstanceCount(tieInstancesToDraw.length);
            renderInst.setDrawCount(vertexData.vertexCount, 0);
            renderInstList.submitRenderInst(renderInst);
        }
    }
}
