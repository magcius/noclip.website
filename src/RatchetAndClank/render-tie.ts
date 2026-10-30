import { mat4, vec3 } from "gl-matrix";
import { Frustum } from "../Geometry";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillMatrix4x3, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxProgram, GfxSamplerBinding, GfxSamplerFormatKind, GfxTextureDimension, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { DeviceProgram } from "../Program";
import { assert } from "../util";
import { RgbaRemapKind, TieClass, TieVertexWithNormalAndRgba } from "./bin-core";
import { DirectionLightSelector, TieInstance } from "./bin-gameplay";
import { RatchetShaderLib } from "./shader-lib";
import { GN, ImaginaryGsCommandType, MegaBuffer, OcclusionChecker } from "./utils";
import { packRemap, TextureAtlases } from "./textures";
import { invlerp } from "../MathHelpers";

export class TieProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_LodMorphOffset = 1;
    public static a_ExtraData = 2;
    public static a_ST = 3;
    public static a_RgbaIndices = 4;
    public static a_NormalIndices = 5;
    public static a_RemapSources = 4;

    public static elementsPerVertex(gn: GN): number { return gn === 1 ? 16 : 14; }

    public static a_InstanceTransform0 = 6;
    public static a_InstanceTransform1 = 7;
    public static a_InstanceTransform2 = 8;
    public static a_InstanceLightSelector = 9;
    public static a_InstanceExtraData = 10;

    public static elementsPerInstance = 20; // transform (12), lights (4), extra (4)

    public static ub_SceneParams = 0;
    public static ub_TieParams = 1;

    constructor(gn: GN) {
        super();
        this.setDefineBool('RAC1', gn === 1);
    }

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

layout(binding = 5) uniform sampler2D u_AmbientRgbaTexture;
layout(binding = 6) uniform sampler2D u_TieNormalsTexture;

`;

    public override vert = `

layout(location = ${TieProgram.a_Position}) in vec3 a_Position;
layout(location = ${TieProgram.a_LodMorphOffset}) in vec3 a_LodMorphOffset;
layout(location = ${TieProgram.a_ExtraData}) in vec2 a_ExtraData; // x = texture index, y = clamp
layout(location = ${TieProgram.a_ST}) in vec2 a_ST;
#ifdef RAC1
layout(location = ${TieProgram.a_RgbaIndices}) in vec3 a_RgbaIndices;
layout(location = ${TieProgram.a_NormalIndices}) in vec3 a_NormalIndices;
#else
layout(location = ${TieProgram.a_RemapSources}) in vec4 a_RemapSources;
#endif

layout(location = ${TieProgram.a_InstanceTransform0}) in vec4 a_InstanceTransform0;
layout(location = ${TieProgram.a_InstanceTransform1}) in vec4 a_InstanceTransform1;
layout(location = ${TieProgram.a_InstanceTransform2}) in vec4 a_InstanceTransform2;
layout(location = ${TieProgram.a_InstanceLightSelector}) in vec3 a_InstanceLightSelector;
layout(location = ${TieProgram.a_InstanceExtraData}) in vec4 a_InstanceExtraData; // x = ambient row, y = LOD morph, z = mode bits, w = class index

out vec2 v_ST;
out vec4 v_Rgba;
out float v_FogFactor;
flat out int v_TextureIndex;
flat out int v_Clamp;
flat out int v_ModeBits;

${RatchetShaderLib.LightingFunctions}
${GfxShaderLibrary.MulNormalMatrix}

void main() {
    float lodMorphFactor = a_InstanceExtraData.y;
    vec3 morphedPosition = a_Position + a_LodMorphOffset * lodMorphFactor;
    mat4x3 instanceTransform = mat4x3(transpose(mat4(a_InstanceTransform0, a_InstanceTransform1, a_InstanceTransform2, vec4(0, 0, 0, 1))));
    vec3 positionWorld = instanceTransform * vec4(morphedPosition, 1.0f);
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(positionWorld, 1.0f);
    v_ST = a_ST;

    /*
    In the original, lighing is done on the CPU against a palette of (color,normal) pairs.
    64 on rac1, 512 on rac2+.
    Then each vertex points to a slot in the palette.
    On rac1, morphing verts additionally point to two extra palette slots which are mixed like: lerp(a, avg(b, c), lodMorphFactor).
    On rac2+, all verts have 4 palette slots which are mixed according to the remap kind.

    In this implementation, the palette and normals are uploaded as textures and all the lighting is done here.
    */

#ifdef RAC1

    float rgbaIndices[3] = float[3](a_RgbaIndices.x, a_RgbaIndices.y, a_RgbaIndices.z);
    vec4 colors[3];
    for (int i = 0; i < 3; i++) {
        ivec2 ambientRgbaTexcoord = ivec2(int(rgbaIndices[i]), int(a_InstanceExtraData.x));
        vec4 rgba = texelFetch(TEXTURE(u_AmbientRgbaTexture), ambientRgbaTexcoord, 0);
        rgba.rgb /= 128.0 / 255.0;
        ivec2 normalTexcoord = ivec2(int(a_NormalIndices[i]), int(a_InstanceExtraData.w));
        vec4 normalTexData = texelFetch(TEXTURE(u_TieNormalsTexture), normalTexcoord, 0);
        vec3 normal = MulNormalMatrix(instanceTransform, normalTexData.xyz);
        colors[i] = commonVertexLighting(rgba, normal, a_InstanceLightSelector);
    }
    // mix colors based on lodMorphFactor
    v_Rgba = mix(colors[0], mix(colors[1], colors[2], 0.5), lodMorphFactor);

#else

    mat3 inverseTransform = inverse(mat3(instanceTransform));
    vec4 colors[4];
    for (int i = 0; i < 4; i++) {
        if (a_RemapSources[i] == -1.0) {
            // remap says write zeroes
            colors[i] = vec4(0.0, 0.0, 0.0, 1.0);
            continue;
        }
        if (a_RemapSources[i] == -2.0) {
            // remap is missing
            colors[i] = vec4(255.0 / 128.0, 0.0, 255.0 / 128.0, 1.0);
            continue;
        }
        ivec2 ambientRgbaTexcoord = ivec2(int(a_RemapSources[i]), int(a_InstanceExtraData.x));
        vec4 rgba = texelFetch(TEXTURE(u_AmbientRgbaTexture), ambientRgbaTexcoord, 0);
        if (a_RemapSources[i] == 511.0) {
            // last row means emissive
            colors[i] = rgba;
            continue;
        }
        ivec2 normalTexcoord = ivec2(int(a_RemapSources[i]), int(a_InstanceExtraData.w));
        vec4 normalTexData = texelFetch(TEXTURE(u_TieNormalsTexture), normalTexcoord, 0);
        vec3 normal = normalize(inverseTransform * normalTexData.xyz);
        colors[i] = commonVertexLighting(rgba, normal, a_InstanceLightSelector);
    }
    v_Rgba = (colors[0] + colors[1] + colors[2] + colors[3]) / 4.0;

#endif
    
    v_FogFactor = fogFactor(positionWorld.xyz);
    v_TextureIndex = int(a_ExtraData.x);
    v_Clamp = int(a_ExtraData.y);
    v_ModeBits = int(a_InstanceExtraData.z);
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
flat in int v_ModeBits;

void main() {
    if (u_RenderSettings.x == 0.0) { gl_FragColor = vec4(v_Rgba.rgb / 2.0, v_Rgba.a); return; }

    ivec2 texRemap = getTexRemap(v_TextureIndex);
    vec4 textureSample = ratchetSampler(texRemap, v_Clamp, v_ST);

    if ((v_ModeBits & 0x20) != 0) {
        // TODO: if this flag is set, the alpha channel is treated as a specular mask
        textureSample.a = 1.0;
    }

    gl_FragColor = commonFragmentShader(v_Rgba, textureSample, v_FogFactor, 0.01);
}
`;

}

const NO_REMAP_SOURCE: [number, number, number, number] = [-1, -1, -1, -1];
// no remap entry for this column; shader renders magenta
const MISSING_REMAP_SOURCE: [number, number, number, number] = [-2, -2, -2, -2];

export class TieGeometry {
    public inputLayout: GfxInputLayout;

    private vertexBuffer: GfxBuffer;
    private vertexCount: number;

    constructor(private cache: GfxRenderCache, private gn: GN, private tieOClass: number, private tie: TieClass, private lodLevel: number, private textureIndices: number[], private textureAtlases: TextureAtlases) {
        if (gn === 1) {
            this.inputLayout = cache.createInputLayout({
                vertexAttributeDescriptors: [
                    { location: TieProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0, },
                    { location: TieProgram.a_LodMorphOffset, format: GfxFormat.F32_RGB, bufferByteOffset: 3 * 4, bufferIndex: 0, },
                    { location: TieProgram.a_ExtraData, format: GfxFormat.F32_RG, bufferByteOffset: 6 * 4, bufferIndex: 0, },
                    { location: TieProgram.a_ST, format: GfxFormat.F32_RG, bufferByteOffset: 8 * 4, bufferIndex: 0, },
                    { location: TieProgram.a_RgbaIndices, format: GfxFormat.F32_RGB, bufferByteOffset: 10 * 4, bufferIndex: 0, },
                    { location: TieProgram.a_NormalIndices, format: GfxFormat.F32_RGB, bufferByteOffset: 13 * 4, bufferIndex: 0, },
                    { location: TieProgram.a_InstanceTransform0, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 * 4, bufferIndex: 1, },
                    { location: TieProgram.a_InstanceTransform1, format: GfxFormat.F32_RGBA, bufferByteOffset: 4 * 4, bufferIndex: 1, },
                    { location: TieProgram.a_InstanceTransform2, format: GfxFormat.F32_RGBA, bufferByteOffset: 8 * 4, bufferIndex: 1, },
                    { location: TieProgram.a_InstanceLightSelector, format: GfxFormat.F32_RGB, bufferByteOffset: 12 * 4, bufferIndex: 1, },
                    { location: TieProgram.a_InstanceExtraData, format: GfxFormat.F32_RGBA, bufferByteOffset: 16 * 4, bufferIndex: 1, },
                ],
                vertexBufferDescriptors: [
                    { byteStride: TieProgram.elementsPerVertex(this.gn) * 4, frequency: GfxVertexBufferFrequency.PerVertex, },
                    { byteStride: TieProgram.elementsPerInstance * 4, frequency: GfxVertexBufferFrequency.PerInstance, },
                ],
                indexBufferFormat: null,
            });
        } else {
            this.inputLayout = cache.createInputLayout({
                vertexAttributeDescriptors: [
                    { location: TieProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0, },
                    { location: TieProgram.a_LodMorphOffset, format: GfxFormat.F32_RGB, bufferByteOffset: 3 * 4, bufferIndex: 0, },
                    { location: TieProgram.a_ExtraData, format: GfxFormat.F32_RG, bufferByteOffset: 6 * 4, bufferIndex: 0, },
                    { location: TieProgram.a_ST, format: GfxFormat.F32_RG, bufferByteOffset: 8 * 4, bufferIndex: 0, },
                    { location: TieProgram.a_RemapSources, format: GfxFormat.F32_RGBA, bufferByteOffset: 10 * 4, bufferIndex: 0, },
                    { location: TieProgram.a_InstanceTransform0, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 * 4, bufferIndex: 1, },
                    { location: TieProgram.a_InstanceTransform1, format: GfxFormat.F32_RGBA, bufferByteOffset: 4 * 4, bufferIndex: 1, },
                    { location: TieProgram.a_InstanceTransform2, format: GfxFormat.F32_RGBA, bufferByteOffset: 8 * 4, bufferIndex: 1, },
                    { location: TieProgram.a_InstanceLightSelector, format: GfxFormat.F32_RGB, bufferByteOffset: 12 * 4, bufferIndex: 1, },
                    { location: TieProgram.a_InstanceExtraData, format: GfxFormat.F32_RGBA, bufferByteOffset: 16 * 4, bufferIndex: 1, },
                ],
                vertexBufferDescriptors: [
                    { byteStride: TieProgram.elementsPerVertex(this.gn) * 4, frequency: GfxVertexBufferFrequency.PerVertex, },
                    { byteStride: TieProgram.elementsPerInstance * 4, frequency: GfxVertexBufferFrequency.PerInstance, },
                ],
                indexBufferFormat: null,
            });
        }
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

        const elementsPerVertex = TieProgram.elementsPerVertex(this.gn);
        const vertexArrayBuffer = new Float32Array(vertexCount * elementsPerVertex);
        let vertexPtr = 0;
        const remapSources = this.buildRemapSources();
        let currentMaterial: { texture: number, clamp: number } | undefined;
        let globalVertexIndex = 0;

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

                        if (this.gn >= 2) {
                            // vert.rgbaIndices = [globalVertexIndex, globalVertexIndex, globalVertexIndex];
                            vert.rgbaIndices = [vert.writeOrder, vert.writeOrder, vert.writeOrder];
                        }

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
                                const { vertex, normalIndices, rgbaIndices, writeOrder } = v;
                                const fixedTexcoord = fixedTexcoords[i];
                                vertexArrayBuffer[vertexPtr++] = positionScale * vertex.x;
                                vertexArrayBuffer[vertexPtr++] = positionScale * vertex.y;
                                vertexArrayBuffer[vertexPtr++] = positionScale * vertex.z;
                                vertexArrayBuffer[vertexPtr++] = positionScale * vertex.lodMorphOffsetX;
                                vertexArrayBuffer[vertexPtr++] = positionScale * vertex.lodMorphOffsetY;
                                vertexArrayBuffer[vertexPtr++] = positionScale * vertex.lodMorphOffsetZ;
                                vertexArrayBuffer[vertexPtr++] = packRemap(this.textureAtlases.tieTextureRemap[textureIndices[currentMaterial.texture]]);
                                vertexArrayBuffer[vertexPtr++] = currentMaterial.clamp;
                                vertexArrayBuffer[vertexPtr++] = texcoordScale * fixedTexcoord.s;
                                vertexArrayBuffer[vertexPtr++] = texcoordScale * fixedTexcoord.t;
                                assert(vertex.q === 4096);
                                if (this.gn === 1) {
                                    vertexArrayBuffer[vertexPtr++] = rgbaIndices[0];
                                    vertexArrayBuffer[vertexPtr++] = rgbaIndices[1];
                                    vertexArrayBuffer[vertexPtr++] = rgbaIndices[2];
                                    vertexArrayBuffer[vertexPtr++] = normalIndices[0];
                                    vertexArrayBuffer[vertexPtr++] = normalIndices[1];
                                    vertexArrayBuffer[vertexPtr++] = normalIndices[2];
                                } else {
                                    const remapSource = remapSources.get(writeOrder) ?? MISSING_REMAP_SOURCE;
                                    vertexArrayBuffer[vertexPtr++] = remapSource[0];
                                    vertexArrayBuffer[vertexPtr++] = remapSource[1];
                                    vertexArrayBuffer[vertexPtr++] = remapSource[2];
                                    vertexArrayBuffer[vertexPtr++] = remapSource[3];
                                }
                            }
                        }

                        globalVertexIndex++;
                    }
                }
            }

            assert(expectedVertsInStrip === 0);
        }

        assert(vertexPtr === vertexCount * elementsPerVertex);
        assert(vertexPtr === vertexArrayBuffer.length);

        return { vertexArrayBuffer, vertexCount };
    }

    private buildRemapSources() {
        // keyed by output column (byte offset / 4), matching the vertex writeOrder
        const sources = new Map<number, [number, number, number, number]>();
        const rgbaRemaps = this.tie.rgbaRemaps?.[this.lodLevel];
        if (!rgbaRemaps) return sources;

        for (let packetIndex = 0; packetIndex < rgbaRemaps.packets.length; packetIndex++) {
            const packet = rgbaRemaps.packets[packetIndex];
            for (let remapIndex = 0; remapIndex < packet.remaps.length; remapIndex++) {
                const remap = packet.remaps[remapIndex];
                const column = (packet.outputBase + remap.dest) / 4;
                if (remap.kind === RgbaRemapKind.Zero) {
                    sources.set(column, NO_REMAP_SOURCE);
                } else {
                    assert(Array.isArray(remap.src));
                    const src = remap.src;
                    sources.set(column, [src[0] / 4, src[1] / 4, src[2] / 4, src[3] / 4]);
                }
            }
        }

        return sources;
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

const bindingLayouts = [{
    numSamplers: 7,
    numUniformBuffers: 2,
    samplerEntries: [
        { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2DArray, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float, },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.UnfilterableFloat, },
    ],
}];

export class TieRenderer {
    private tieProgram: GfxProgram;

    constructor(private renderHelper: GfxRenderHelper, private gn: GN) {
        this.tieProgram = renderHelper.renderCache.createProgram(new TieProgram(gn));
    }

    renderTie(renderInstList: GfxRenderInstList, tieGeometriesByLod: (TieGeometry | null)[], tieClass: TieClass, tieInstanceBatch: TieInstance[], textureMappings: GfxSamplerBinding[], cameraPosition: vec3, occlusionChecker: OcclusionChecker | null, cameraFrustum: Frustum, settingLodPreset: number, settingLodBias: number, instanceDataBuffer: MegaBuffer): void {

        type TieDrawInstance = { objectMatrix: mat4, lightSelector: DirectionLightSelector, rgbasRow: number, lodMorphFactor: number };
        const tieInstancesToDrawByLod: TieDrawInstance[][] = [[], [], []];
        for (let i = 0; i < tieInstanceBatch.length; i++) {
            const tieInstance = tieInstanceBatch[i];

            // occlusion check
            if (occlusionChecker && occlusionChecker.mask) {
                const bit = tieInstance._occlusionBit;
                if (bit !== -1 && (occlusionChecker.mask[bit >> 3] & (1 << (bit % 8))) === 0) continue;
            }

            // tie instance transform
            const objectMatrix = tieInstance._matrixPretransformed;
            const position = tieInstance._positionPretransformed;
            const distanceToCameraSquared = vec3.sqrDist(position, cameraPosition);

            // determine LOD level
            const hasLod2 = !!tieGeometriesByLod[2];
            const hasLod1 = !!tieGeometriesByLod[1];
            let modelLodLevel = settingLodPreset;
            let lodMorphFactor = 0;
            if (settingLodPreset === -1) {
                let smoothLod = 0;
                let nearDist = Math.max(0, tieClass.nearDist + settingLodBias);
                let midDist = Math.max(0, tieClass.midDist + settingLodBias * 2);
                let farDist = Math.max(0, tieClass.farDist + settingLodBias * 3);
                if (distanceToCameraSquared < nearDist ** 2) {
                    smoothLod = 0;
                } else if (distanceToCameraSquared < midDist ** 2) {
                    smoothLod = invlerp(nearDist, midDist, Math.sqrt(distanceToCameraSquared));
                } else if (distanceToCameraSquared < farDist ** 2) {
                    smoothLod = 1 + invlerp(midDist, farDist, Math.sqrt(distanceToCameraSquared));
                } else {
                    smoothLod = 2;
                }
                smoothLod = Math.max(0, smoothLod);
                modelLodLevel = Math.floor(smoothLod);
                lodMorphFactor = smoothLod - modelLodLevel;
            }
            if (modelLodLevel === 2 && !hasLod2) { modelLodLevel = 1; lodMorphFactor = 0; }
            if (modelLodLevel === 1 && !hasLod1) { modelLodLevel = 0; lodMorphFactor = 0; }

            // find bounding sphere and frustum cull
            if (!cameraFrustum.containsSphere(position, 32 * tieClass.scale * tieInstance._scalePretransformed)) {
                continue;
            }

            tieInstancesToDrawByLod[modelLodLevel].push({
                objectMatrix,
                lightSelector: tieInstance.lightSelector,
                lodMorphFactor,
                rgbasRow: tieInstance._i,
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
                instanceDataBuffer.ptr += fillVec4(instanceDataBuffer.f32View, instanceDataBuffer.ptr, inst.lightSelector.lightIndices[0], inst.lightSelector.lightIndices[1], inst.lightSelector.weight, 0);
                instanceDataBuffer.ptr += fillVec4(instanceDataBuffer.f32View, instanceDataBuffer.ptr, inst.rgbasRow, inst.lodMorphFactor, tieClass.header.modeBits, tieClass._classIndex);
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
