import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxProgram, GfxSamplerBinding, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DeviceProgram } from "../Program";
import { RatchetShaderLib } from "./shader-lib";
import { MobyClass, MobyVertex } from "./bin-core";
import { MegaBuffer, noclipSpaceFromRatchetSpace } from "./utils";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { mat4, quat, vec3 } from "gl-matrix";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { MobyInstance } from "./bin-gameplay";
import { Frustum } from "../Geometry";
import { assert } from "../util";

export class MobyProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_NormalAzimuthElevationRad = 1;
    public static a_ST = 2;

    public static elementsPerVertex = 7; // position (3) + normal (2) + st (2)

    public static a_InstanceTransform0 = 3;
    public static a_InstanceTransform1 = 4;
    public static a_InstanceTransform2 = 5;
    public static a_InstanceTransform3 = 6;

    public static elementsPerInstance = 16; // transform (16)

    public static ub_SceneParams = 0;
    public static ub_MobyParams = 1;

    public override both = `
precision highp float;
precision highp sampler2DArray;

${GfxShaderLibrary.MatrixLibrary}
${RatchetShaderLib.SceneParams}

`;

    public override vert = `

layout(location = ${MobyProgram.a_Position}) in vec3 a_Position;
layout(location = ${MobyProgram.a_NormalAzimuthElevationRad}) in vec2 a_NormalAzimuthElevationRad;
layout(location = ${MobyProgram.a_ST}) in vec2 a_ST;

layout(location = ${MobyProgram.a_InstanceTransform0}) in vec4 a_InstanceTransform0;
layout(location = ${MobyProgram.a_InstanceTransform1}) in vec4 a_InstanceTransform1;
layout(location = ${MobyProgram.a_InstanceTransform2}) in vec4 a_InstanceTransform2;
layout(location = ${MobyProgram.a_InstanceTransform3}) in vec4 a_InstanceTransform3;

${RatchetShaderLib.LightingFunctions}

out vec3 v_PositionWorld;
out vec4 v_Rgba;
out vec3 v_Normal;
out vec2 v_ST;

void main() {
    Mat4x4 _instanceTransform = Mat4x4(a_InstanceTransform0, a_InstanceTransform1, a_InstanceTransform2, a_InstanceTransform3);
    mat4 instanceTransform = UnpackMatrix(_instanceTransform);
    vec4 positionWorld = instanceTransform * vec4(a_Position.xyz, 1.0f);
    gl_Position = UnpackMatrix(u_ClipFromWorld) * positionWorld;
    v_PositionWorld = positionWorld.xyz;
    v_Rgba = vec4(vec3(gl_VertexID) * 0.005, 1.0);
    v_Normal = normalFromAzumithElevation(a_NormalAzimuthElevationRad.x, a_NormalAzimuthElevationRad.y);
    v_ST = a_ST;
}
`;

    public override frag = `

in vec3 v_PositionWorld;
in vec4 v_Rgba;
in vec3 v_Normal;
in vec2 v_ST;

void main() {
    // vec3 tangentX = dFdx(v_PositionWorld);
    // vec3 tangentY = dFdy(v_PositionWorld);
    // vec3 faceNormal = normalize(cross(tangentX, tangentY));
    vec3 faceNormal = normalize(v_Normal);
    float light = 0.3
        + 0.4 * max(dot(faceNormal, u_DirectionLights[0].directionA.xyz), 0.0)
        + 0.4 * max(dot(faceNormal, u_DirectionLights[0].directionB.xyz), 0.0);

    gl_FragColor = vec4(vec3(light), 1.0);
    // gl_FragColor = v_Rgba;
    // gl_FragColor = vec4(vec2(light) * v_ST, 0.0, v_Rgba.a);
}

`;

}

export class MobyGeometry {
    public inputLayout: GfxInputLayout;

    private vertexBuffer: GfxBuffer | null = null;
    private vertexCount: number | null = null;

    constructor(private cache: GfxRenderCache, public moby: MobyClass, private textureIndices: number[]) {
        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                // per vertex
                { location: MobyProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0, },
                { location: MobyProgram.a_NormalAzimuthElevationRad, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 4, bufferIndex: 0, },
                { location: MobyProgram.a_ST, format: GfxFormat.F32_RG, bufferByteOffset: 5 * 4, bufferIndex: 0, },
                // per instance
                { location: MobyProgram.a_InstanceTransform0, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 * 4, bufferIndex: 1, },
                { location: MobyProgram.a_InstanceTransform1, format: GfxFormat.F32_RGBA, bufferByteOffset: 4 * 4, bufferIndex: 1, },
                { location: MobyProgram.a_InstanceTransform2, format: GfxFormat.F32_RGBA, bufferByteOffset: 8 * 4, bufferIndex: 1, },
                { location: MobyProgram.a_InstanceTransform3, format: GfxFormat.F32_RGBA, bufferByteOffset: 12 * 4, bufferIndex: 1, },
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

        interface MobyVertexWithTexcoords extends MobyVertex {
            s: number;
            t: number;
        }
        const realPacketData: MobyVertexWithTexcoords[][] = [];

        // emulate vertex caching system
        const vertexCache: (MobyVertexWithTexcoords | null)[] = new Array(512).fill(null);
        for (let packetIndex = 0; packetIndex < moby.mesh.packetsLod0.length; packetIndex++) {
            // packet verts
            const packet = moby.mesh.packetsLod0[packetIndex];
            const realPacket: MobyVertexWithTexcoords[] = [];
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
        let outputVerts: MobyVertexWithTexcoords[] = [];

        for (let packetIndex = 0; packetIndex < moby.mesh.packetsLod0.length; packetIndex++) {

            const tri = [null, null, null] as [MobyVertexWithTexcoords | null, MobyVertexWithTexcoords | null, MobyVertexWithTexcoords | null];
            const packet = moby.mesh.packetsLod0[packetIndex];
            const realPacketVerts = realPacketData[packetIndex];
            let adGifIndex = 0;

            for (let i = 0; i < packet.indices.length; i++) {
                let index = packet.indices[i];

                if (index === 0) {
                    const secretIndex = packet.secretIndices[adGifIndex];
                    assert(secretIndex !== undefined);

                    if (secretIndex === 0) {
                        // the game inserts 3 indices at the end to account for a race,
                        // the packet ends when we see a 0 index in both the index buffer and the secret indices,
                        // but the game uses async vertex transformation, so some have already been sent to VU1,
                        // those transformed verts will be ignored.
                        for (let j = 0; j < 9; j++) outputVerts.pop();
                        break;
                    }

                    index = secretIndex - 0x80; // never kick here, texture changes are always primative restarts
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
                        assert(tri[j] !== null);
                        outputVerts.push(tri[j]!);
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
        numSamplers: 0,
        numUniformBuffers: 2,
        samplerEntries: [],
    }
];

export class MobyRenderer {
    private mobyProgram: GfxProgram;

    constructor(private renderHelper: GfxRenderHelper) {
        this.mobyProgram = renderHelper.renderCache.createProgram(new MobyProgram());
    }

    renderMoby(renderInstList: GfxRenderInstList, mobyGeometry: MobyGeometry, mobyInstances: MobyInstance[], textureMappings: GfxSamplerBinding[], cameraPosition: vec3, cameraFrustum: Frustum, instanceDataBuffer: MegaBuffer): void {
        type MobyDrawInstance = { objectMatrix: mat4, distanceToCamera: number };

        const mobyInstancesToDraw: MobyDrawInstance[] = [];
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

            // distance to camera
            const position = scratchVec3;
            mat4.getTranslation(position, objectMatrix);
            const distanceToCamera = vec3.distance(position, cameraPosition);

            mobyInstancesToDraw.push({
                objectMatrix,
                distanceToCamera,
            })
        }

        if (!mobyInstancesToDraw.length) return;

        const renderInst = this.renderHelper.renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.mobyProgram);
        renderInst.setBindingLayouts(bindingLayouts);

        // per instance data
        const instanceDataStartBytes = instanceDataBuffer.ptr * 4;
        for (let i = 0; i < mobyInstancesToDraw.length; i++) {
            const inst = mobyInstancesToDraw[i];
            instanceDataBuffer.ptr += fillMatrix4x4(instanceDataBuffer.f32View, instanceDataBuffer.ptr, inst.objectMatrix);
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
