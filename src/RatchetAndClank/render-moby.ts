import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxProgram, GfxSamplerBinding, GfxSamplerFormatKind, GfxTextureDimension, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DeviceProgram } from "../Program";
import { RatchetShaderLib } from "./shader-lib";
import { MobyClass, MobyVertex } from "./bin-core";
import { MegaBuffer, noclipSpaceFromRatchetSpace } from "./utils";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { mat4, quat, vec3 } from "gl-matrix";
import { fillMatrix4x3, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { MobyInstance } from "./bin-gameplay";
import { Frustum } from "../Geometry";
import { assert } from "../util";

export class MobyProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_NormalAzimuthElevationRad = 1;
    public static a_ST = 2;
    public static a_TextureParams = 3; // x = texture index, y = clamp flag

    public static elementsPerVertex = 9; // position (3), normal (2), st (2), texture params (2)

    public static a_InstanceTransform0 = 4;
    public static a_InstanceTransform1 = 5;
    public static a_InstanceTransform2 = 6;
    public static a_InstanceAmbientRgba = 7;
    public static a_InstanceDirectionLights = 8;
    public static a_InstanceLodAlpha = 9; // x = lod alpha

    public static elementsPerInstance = 24; // transform (12), direction lights (4), ambient rgba (4), lod alpha (4)

    public static ub_SceneParams = 0;
    public static ub_MobyParams = 1;

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

`;

    public override vert = `

layout(location = ${MobyProgram.a_Position}) in vec3 a_Position;
layout(location = ${MobyProgram.a_NormalAzimuthElevationRad}) in vec2 a_NormalAzimuthElevationRad;
layout(location = ${MobyProgram.a_ST}) in vec2 a_ST;
layout(location = ${MobyProgram.a_TextureParams}) in vec2 a_TextureParams; // x = texture index, y = clamp flag

layout(location = ${MobyProgram.a_InstanceTransform0}) in vec4 a_InstanceTransform0;
layout(location = ${MobyProgram.a_InstanceTransform1}) in vec4 a_InstanceTransform1;
layout(location = ${MobyProgram.a_InstanceTransform2}) in vec4 a_InstanceTransform2;
layout(location = ${MobyProgram.a_InstanceAmbientRgba}) in vec4 a_InstanceAmbientRgba;
layout(location = ${MobyProgram.a_InstanceDirectionLights}) in vec4 a_InstanceDirectionLights;
layout(location = ${MobyProgram.a_InstanceLodAlpha}) in vec4 a_InstanceLodAlpha; // x = lod alpha

${RatchetShaderLib.LightingFunctions}
${GfxShaderLibrary.MulNormalMatrix}

out vec3 v_PositionWorld;
out vec4 v_Rgba;
out vec3 v_Normal;
out vec2 v_ST;
out float v_FogFactor;
flat out int v_TextureIndex;
flat out int v_Clamp;

void main() {
    mat4x3 instanceTransform = mat4x3(transpose(mat4(a_InstanceTransform0, a_InstanceTransform1, a_InstanceTransform2, vec4(0, 0, 0, 1))));
    vec3 positionWorld = instanceTransform * vec4(a_Position.xyz, 1.0f);

    vec3 normal = normalFromAzumithElevation(a_NormalAzimuthElevationRad.x, a_NormalAzimuthElevationRad.y);
    normal = MulNormalMatrix(instanceTransform, normal);

    float lodAlpha = a_InstanceLodAlpha.x;
    vec4 rgba = commonVertexLighting(a_InstanceAmbientRgba, normal, a_InstanceDirectionLights);
    rgba.a *= lodAlpha;

    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(positionWorld, 1.0f);
    v_PositionWorld = positionWorld.xyz;
    v_Rgba = rgba;
    v_Normal = normal;
    v_ST = a_ST;
    v_FogFactor = fogFactor(positionWorld.xyz);
    v_TextureIndex = int(a_TextureParams.x);
    v_Clamp = int(a_TextureParams.y);
}
`;

    public override frag = `

${RatchetShaderLib.CommonFragmentShader}
${RatchetShaderLib.Sampler}

in vec3 v_PositionWorld;
in vec4 v_Rgba;
in vec3 v_Normal;
in vec2 v_ST;
in float v_FogFactor;
flat in int v_TextureIndex;
flat in int v_Clamp;

void main() {
    if (v_TextureIndex < 0) {
        // some objects have negative textures, probably indicates special materials
        // used on water, triggers, and sometimes for seemingly no reason
        discard;
    }

    if (u_RenderSettings.x == 0.0) { gl_FragColor = vec4(v_Rgba.rgb / 2.0, v_Rgba.a); return; }
    ivec2 texRemap = getTexRemap(u_TextureRemaps.mobys, v_TextureIndex);
    vec4 textureSample = ratchetSampler(texRemap, v_Clamp, v_ST);
    gl_FragColor = commonFragmentShader(vec4(v_Rgba.rgb / 2.0, v_Rgba.a), textureSample, v_FogFactor);
}

`;

}

export class MobyGeometry {
    public inputLayout: GfxInputLayout;

    private vertexBuffer: GfxBuffer | null = null;
    private vertexCount: number | null = null;

    constructor(private cache: GfxRenderCache, public oClass: number, public moby: MobyClass, public lod: number, private textureIndices: number[]) {
        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                // per vertex
                { location: MobyProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0, },
                { location: MobyProgram.a_NormalAzimuthElevationRad, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 4, bufferIndex: 0, },
                { location: MobyProgram.a_ST, format: GfxFormat.F32_RG, bufferByteOffset: 5 * 4, bufferIndex: 0, },
                { location: MobyProgram.a_TextureParams, format: GfxFormat.F32_RG, bufferByteOffset: 7 * 4, bufferIndex: 0, },
                // per instance
                { location: MobyProgram.a_InstanceTransform0, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 * 4, bufferIndex: 1, },
                { location: MobyProgram.a_InstanceTransform1, format: GfxFormat.F32_RGBA, bufferByteOffset: 4 * 4, bufferIndex: 1, },
                { location: MobyProgram.a_InstanceTransform2, format: GfxFormat.F32_RGBA, bufferByteOffset: 8 * 4, bufferIndex: 1, },
                { location: MobyProgram.a_InstanceAmbientRgba, format: GfxFormat.F32_RGBA, bufferByteOffset: 12 * 4, bufferIndex: 1, },
                { location: MobyProgram.a_InstanceDirectionLights, format: GfxFormat.F32_RGBA, bufferByteOffset: 16 * 4, bufferIndex: 1, },
                { location: MobyProgram.a_InstanceLodAlpha, format: GfxFormat.F32_RGBA, bufferByteOffset: 20 * 4, bufferIndex: 1, },
            ],
            vertexBufferDescriptors: [
                { byteStride: MobyProgram.elementsPerVertex * 0x4, frequency: GfxVertexBufferFrequency.PerVertex, },
                { byteStride: MobyProgram.elementsPerInstance * 0x4, frequency: GfxVertexBufferFrequency.PerInstance, },
            ],

            indexBufferFormat: null,
        });
    }

    public getOrCreateVertexBuffer() {
        if (this.vertexCount === null) {
            const vertexData = this.assemble(this.moby, this.textureIndices);
            if (vertexData) {
                const device = this.cache.device;
                this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertexData.vertexArrayBuffer.buffer);
                device.setResourceName(this.vertexBuffer, `Moby Class ${this.moby.oClass} (VB)`);
                this.vertexCount = vertexData.vertexCount;
            } else {
                this.vertexCount = 0;
            }
        }
        return {
            vertexBuffer: this.vertexBuffer,
            vertexCount: this.vertexCount,
        };
    }

    private assemble(moby: MobyClass, textureIndices: number[]) {
        const scale = moby.header.scale * (1 / 1024);
        const texcoordScale = 1 / 4096;
        const angleScale = Math.PI / 128;

        assert(moby.mesh !== null);

        const lodPackets = moby.mesh.packetsByLod[this.lod];

        interface MobyVertexWithST extends MobyVertex {
            s: number;
            t: number;
        }
        const realPacketData: MobyVertexWithST[][] = [];

        // emulate vertex caching system
        const vertexCache: (MobyVertexWithST | null)[] = new Array(512).fill(null);
        for (let packetIndex = 0; packetIndex < lodPackets.length; packetIndex++) {
            // packet verts
            const packet = lodPackets[packetIndex];
            const realPacket: MobyVertexWithST[] = [];
            for (let vertIndex = 0; vertIndex < packet.vertices.length; vertIndex++) {
                let vertex = packet.vertices[vertIndex];
                assert(!!vertex);
                const st = packet.texcoords[vertIndex];
                assert(!!st);
                const vertexWithTexcoords = {
                    cacheAddress: vertex.cacheAddress,
                    normalAzumith: vertex.normalAzumith,
                    normalElevation: vertex.normalElevation,
                    x: vertex.x,
                    y: vertex.y,
                    z: vertex.z,
                    s: st.s,
                    t: st.t,
                };
                realPacket.push(vertexWithTexcoords);
                vertexCache[vertex.cacheAddress] = vertexWithTexcoords;
            }
            for (let dupIndex = 0; dupIndex < packet.duplicateVertices.length; dupIndex++) {
                const index = packet.duplicateVertices[dupIndex];
                let vertex = vertexCache[index];
                assert(!!vertex);
                const st = packet.texcoords[realPacket.length];
                assert(!!st);
                const vertexWithTexcoords = {
                    cacheAddress: vertex.cacheAddress,
                    normalAzumith: vertex.normalAzumith,
                    normalElevation: vertex.normalElevation,
                    x: vertex.x,
                    y: vertex.y,
                    z: vertex.z,
                    s: st.s,
                    t: st.t,
                };
                realPacket.push(vertexWithTexcoords);
            }
            realPacketData.push(realPacket);
        }

        // assemble vertex buffer
        interface MobyVertexWithTex extends MobyVertexWithST {
            textureIndex: number;
            clamp: number;
        }
        let outputVerts: MobyVertexWithTex[] = [];
        let currentMaterial = {
            texture: 0,
            clamp: 0,
        };

        for (let packetIndex = 0; packetIndex < lodPackets.length; packetIndex++) {

            const tri = [null, null, null] as [MobyVertexWithST | null, MobyVertexWithST | null, MobyVertexWithST | null];
            const packet = lodPackets[packetIndex];
            const realPacketVerts = realPacketData[packetIndex];
            let adGifIndex = 0;

            for (let i = 0; i < packet.indices.length; i++) {
                let index = packet.indices[i];

                if (index === 0) {
                    const secretIndex = packet.secretIndices[adGifIndex];
                    assert(secretIndex !== undefined);

                    if (secretIndex === 0) {
                        // the game has async vertex transformations, there are 3 verts in flight at any one time
                        // when it reaches the end of the list it will terminate the async process early and the
                        // in flight verts will be discarded
                        for (let j = 0; j < 9; j++) outputVerts.pop();
                        break;
                    }

                    index = secretIndex - 0x80; // never kick here, texture changes are always primative restarts
                    const adGif = packet.textures[adGifIndex];
                    assert(adGif !== undefined);
                    let textureIndex: number;
                    if (adGif.tex0.low === -1) {
                        textureIndex = -1;
                    } else {
                        textureIndex = textureIndices[adGif.tex0.low] ?? 0; // FIXME: should not fall back to zero
                    }
                    assert(textureIndex !== undefined);
                    currentMaterial = {
                        texture: textureIndex,
                        clamp: adGif.clamp.low + (adGif.clamp.high << 2),
                    };
                    adGifIndex++;
                }

                let realIndex = (index > 0 ? index : index + 0x80) - 1;
                let vertex = realPacketVerts[realIndex];

                tri[0] = tri[1];
                tri[1] = tri[2];
                tri[2] = vertex;
                const kick = index > 0;

                if (kick) {
                    for (let j = 0; j < 3; j++) {
                        const v = tri[j];
                        assert(!!v);
                        outputVerts.push({
                            cacheAddress: v.cacheAddress,
                            normalAzumith: v.normalAzumith,
                            normalElevation: v.normalElevation,
                            x: v.x,
                            y: v.y,
                            z: v.z,
                            s: v.s,
                            t: v.t,
                            textureIndex: currentMaterial.texture,
                            clamp: currentMaterial.clamp,
                        });
                    }
                }
            }
        }

        // encode
        let vertexArrayBuffer = new Float32Array(outputVerts.length * MobyProgram.elementsPerVertex);
        let vertexPtr = 0;

        for (let i = 0; i < outputVerts.length; i++) {
            const v = outputVerts[i];
            vertexArrayBuffer[vertexPtr++] = scale * v.x;
            vertexArrayBuffer[vertexPtr++] = scale * v.y;
            vertexArrayBuffer[vertexPtr++] = scale * v.z;
            vertexArrayBuffer[vertexPtr++] = angleScale * v.normalAzumith;
            vertexArrayBuffer[vertexPtr++] = angleScale * v.normalElevation;
            vertexArrayBuffer[vertexPtr++] = texcoordScale * v.s;
            vertexArrayBuffer[vertexPtr++] = texcoordScale * v.t;
            vertexArrayBuffer[vertexPtr++] = v.textureIndex;
            vertexArrayBuffer[vertexPtr++] = v.clamp;
        }

        return { vertexArrayBuffer, vertexCount: outputVerts.length };

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

const colorScale = 1 / 255 * 4;

export class MobyRenderer {
    private mobyProgram: GfxProgram;

    constructor(private renderHelper: GfxRenderHelper) {
        this.mobyProgram = renderHelper.renderCache.createProgram(new MobyProgram());
    }

    renderMoby(renderInstList: GfxRenderInstList, mobyGeometriesByLod: (MobyGeometry | null)[], mobyClass: MobyClass, mobyInstances: MobyInstance[], textureMappings: GfxSamplerBinding[], cameraPosition: vec3, cameraFrustum: Frustum, lodSetting: number, lodBias: number, instanceDataBuffer: MegaBuffer): void {
        type MobyDrawInstance = { objectMatrix: mat4, rgb: vec3, directionalLights: number[], lodAlpha: number };

        if (mobyGeometriesByLod[0] === null) return;
        const maxLod = mobyGeometriesByLod[1] ? 1 : 0;

        const mobyInstancesToDrawByLod: MobyDrawInstance[][] = [[], []];
        for (let i = 0; i < mobyInstances.length; i++) {
            const mobyInstance = mobyInstances[i];

            // moby instance transform
            const objectMatrix = mat4.create();
            mat4.fromRotationTranslationScale(objectMatrix,
                quat.fromEuler(quat.create(), mobyInstance.rotation.x * (180 / Math.PI), mobyInstance.rotation.y * (180 / Math.PI), mobyInstance.rotation.z * (180 / Math.PI)),
                vec3.fromValues(mobyInstance.position.x, mobyInstance.position.y, mobyInstance.position.z),
                vec3.fromValues(mobyInstance.scale, mobyInstance.scale, mobyInstance.scale),
            );
            mat4.mul(objectMatrix, noclipSpaceFromRatchetSpace, objectMatrix);

            // color
            const rgb = vec3.fromValues(mobyInstance.color.r * colorScale, mobyInstance.color.g * colorScale, mobyInstance.color.b * colorScale);

            // lights
            const directionalLights = mobyInstance.directionalLights;

            // distance to camera
            const position = scratchVec3;
            mat4.getTranslation(position, objectMatrix);
            const distanceToCamera = vec3.distance(position, cameraPosition);

            let lod: number;
            let lodAlpha = 1.0;
            if (lodSetting === -1) {
                let farDist = mobyInstance.drawDistance + lodBias * 2.0;
                let midDist: number;
                if (mobyClass.header.lodTrans !== 255) {
                    midDist = mobyClass.header.lodTrans + lodBias * 1.5;
                } else {
                    midDist = farDist * 0.75;
                }
                if (midDist >= farDist) {
                    farDist = midDist * 1.25;
                };
                if (distanceToCamera > farDist) continue;
                lod = distanceToCamera < midDist ? 0 : 1;
                lodAlpha = Math.min(1, 1 - (distanceToCamera - midDist) / (farDist - midDist));
            } else {
                lod = lodSetting;
            }
            lod = Math.min(lod, maxLod);

            // find bounding sphere and frustum cull
            const objectScale = Math.hypot(objectMatrix[0], objectMatrix[1], objectMatrix[2]);
            if (!cameraFrustum.containsSphere(position, 0x7FFF / 1024 * mobyClass.header.scale * objectScale)) {
                continue;
            }

            mobyInstancesToDrawByLod[lod].push({
                objectMatrix,
                rgb,
                directionalLights,
                lodAlpha,
            });
        }

        for (let lod = 0; lod < mobyInstancesToDrawByLod.length; lod++) {
            const mobyInstancesToDraw = mobyInstancesToDrawByLod[lod];
            if (!mobyInstancesToDraw.length) continue;
            const mobyGeometry = mobyGeometriesByLod[lod];
            if (!mobyGeometry) continue;

            const renderInst = this.renderHelper.renderInstManager.newRenderInst();
            renderInst.setGfxProgram(this.mobyProgram);
            renderInst.setBindingLayouts(bindingLayouts);

            // per instance data
            const instanceDataStartBytes = instanceDataBuffer.ptr * 4;
            for (let i = 0; i < mobyInstancesToDraw.length; i++) {
                const inst = mobyInstancesToDraw[i];
                const color = inst.rgb;
                instanceDataBuffer.ptr += fillMatrix4x3(instanceDataBuffer.f32View, instanceDataBuffer.ptr, inst.objectMatrix);
                instanceDataBuffer.ptr += fillVec4(instanceDataBuffer.f32View, instanceDataBuffer.ptr, color[0], color[1], color[2], 1.0);
                instanceDataBuffer.ptr += fillVec4(instanceDataBuffer.f32View, instanceDataBuffer.ptr, inst.directionalLights[0], inst.directionalLights[1], inst.directionalLights[2], inst.directionalLights[3]);
                instanceDataBuffer.ptr += fillVec4(instanceDataBuffer.f32View, instanceDataBuffer.ptr, inst.lodAlpha, 0, 0, 0);
            }

            const vertexData = mobyGeometry.getOrCreateVertexBuffer();
            assert(vertexData.vertexBuffer !== null);

            renderInst.setVertexInput(
                mobyGeometry.inputLayout,
                [
                    { buffer: vertexData.vertexBuffer, byteOffset: 0 },
                    { buffer: instanceDataBuffer.gfxBuffer, byteOffset: instanceDataStartBytes },
                ],
                null,
            );
            renderInst.setSamplerBindingsFromTextureMappings(textureMappings);
            renderInst.setDrawCount(vertexData.vertexCount, 0);
            renderInst.setInstanceCount(mobyInstancesToDraw.length);
            renderInstList.submitRenderInst(renderInst);

        }
    }
}
