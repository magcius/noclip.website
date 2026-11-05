import { vec3 } from "gl-matrix";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCompareMode, GfxDevice, GfxFormat, GfxInputLayout, GfxProgram, GfxSamplerBinding, GfxSamplerFormatKind, GfxTextureDimension, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { DeviceProgram } from "../Program";
import { assert } from "../util";
import { RatchetShaderLib } from "./shader-lib";
import { Tfrag, TfragVertexInfo } from "./bin-core";
import { decodeLodK, packRemap, PaletteTexture, TextureAtlases } from "./textures";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { noclipSpaceFromRatchetSpace } from "./utils";
import { fillMatrix4x3, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";

export class TfragProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_NormalAzimuthElevationRad = 1;
    public static a_AmbientColor = 2;
    public static a_TextureParams = 3;
    public static a_ST = 4;
    public static a_DirectionLightSelector = 5;

    public static elementsPerVertex = 16; // position(3) + normal angles(2) + ambient color(3) + texture(3) + st(2) + lights(3) = 16

    public static ub_SceneParams = 0;
    public static ub_TfragParams = 1;

    public override both = `
precision highp float;
precision highp sampler2DArray;

${GfxShaderLibrary.MatrixLibrary}
${RatchetShaderLib.SceneParams}

layout(std140) uniform ub_TfragParams {
    Mat3x4 u_WorldFromLocal;
    vec4 u_AlphaTest; // x = alpha test
};

layout(binding = 0) uniform sampler2DArray u_Texture_16;
layout(binding = 1) uniform sampler2DArray u_Texture_32;
layout(binding = 2) uniform sampler2DArray u_Texture_64;
layout(binding = 3) uniform sampler2DArray u_Texture_128;
layout(binding = 4) uniform sampler2DArray u_Texture_256;

`;

    public override vert = `

layout(location = ${TfragProgram.a_Position}) in vec3 a_Position;
layout(location = ${TfragProgram.a_NormalAzimuthElevationRad}) in vec2 a_NormalAzimuthElevationRad;
layout(location = ${TfragProgram.a_AmbientColor}) in vec3 a_AmbientColor;
layout(location = ${TfragProgram.a_TextureParams}) in vec3 a_TextureParams;
layout(location = ${TfragProgram.a_ST}) in vec2 a_ST;
layout(location = ${TfragProgram.a_DirectionLightSelector}) in vec3 a_DirectionLightSelector;

out vec4 v_Rgba;
out vec2 v_ST;
out float v_FogFactor;
flat out int v_TextureIndex;
flat out int v_Clamp;
flat out float v_LodK;

${RatchetShaderLib.LightingFunctions}
${GfxShaderLibrary.MulNormalMatrix}

void main() {
    mat4x3 worldTransform = UnpackMatrix(u_WorldFromLocal);
    vec3 t_PositionWorld = worldTransform * vec4(a_Position.xyz, 1.0f);
    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(t_PositionWorld, 1.0f);

    vec3 normal = normalFromAzumithElevation(a_NormalAzimuthElevationRad.x, a_NormalAzimuthElevationRad.y);
    normal = MulNormalMatrix(worldTransform, normal);
    vec3 lightSelector = a_DirectionLightSelector;

    v_Rgba = commonVertexLighting(vec4(a_AmbientColor, 1.0), normal, lightSelector);

    v_ST = a_ST.xy;
    v_FogFactor = fogFactor(t_PositionWorld.xyz);
    v_TextureIndex = int(a_TextureParams.x);
    v_Clamp = int(a_TextureParams.y);
    v_LodK = a_TextureParams.z;
}
`;

    public override frag = `
${RatchetShaderLib.CommonFragmentShader}
${RatchetShaderLib.Sampler}

in vec4 v_Rgba;
in vec2 v_ST;
in float v_FogFactor;
flat in int v_TextureIndex;
flat in int v_Clamp;
flat in float v_LodK;

void main() {
    if (u_RenderSettings.x == 0.0) { gl_FragColor = vec4(v_Rgba.rgb / 2.0, v_Rgba.a); return; }
    ivec2 texRemap = getTexRemap(v_TextureIndex);
    vec4 textureSample = ratchetSampler(texRemap, v_Clamp, v_ST, v_LodK);
    gl_FragColor = commonFragmentShader(v_Rgba, textureSample, v_FogFactor, u_AlphaTest.x);
}
`;

}

export class TfragGeometry {
    public inputLayout: GfxInputLayout;

    // array of 3 vertex buffers, one per lod
    private lods: ({
        vertexBuffer: GfxBuffer,
        vertexCountOpaque: number,
        vertexCountTransparent: number,
    } | null)[] = [null, null, null];

    constructor(private cache: GfxRenderCache, private tfrags: Tfrag[], private textureAssets: PaletteTexture[], private textureAtlases: TextureAtlases) {
        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: TfragProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0, },
                { location: TfragProgram.a_NormalAzimuthElevationRad, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 0x4, bufferIndex: 0, },
                { location: TfragProgram.a_AmbientColor, format: GfxFormat.F32_RGB, bufferByteOffset: 5 * 0x4, bufferIndex: 0, },
                { location: TfragProgram.a_TextureParams, format: GfxFormat.F32_RGB, bufferByteOffset: 8 * 0x4, bufferIndex: 0, },
                { location: TfragProgram.a_ST, format: GfxFormat.F32_RG, bufferByteOffset: 11 * 0x4, bufferIndex: 0, },
                { location: TfragProgram.a_DirectionLightSelector, format: GfxFormat.F32_RGB, bufferByteOffset: 13 * 0x4, bufferIndex: 0, },
            ],
            vertexBufferDescriptors: [
                { byteStride: TfragProgram.elementsPerVertex * 0x4, frequency: GfxVertexBufferFrequency.PerVertex, },
            ],
            indexBufferFormat: null,
        });
    }

    public getOrCreateVertexBuffer(lod: number) {
        if (!this.lods[lod]) {
            const device = this.cache.device;
            const vertexCountOpaque = this.count(lod, false);
            const vertexCountTransparent = this.count(lod, true);
            const vertexArrayBuffer = new Float32Array((vertexCountOpaque + vertexCountTransparent) * TfragProgram.elementsPerVertex);
            this.assemble(lod, vertexArrayBuffer, 0, vertexCountOpaque, false);
            this.assemble(lod, vertexArrayBuffer, vertexCountOpaque, vertexCountTransparent, true);

            const vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertexArrayBuffer.buffer);
            device.setResourceName(vertexBuffer, `Tfrag LOD ${lod} VB`);

            this.lods[lod] = {
                vertexBuffer,
                vertexCountOpaque,
                vertexCountTransparent,
            };
        }

        const lodData = this.lods[lod];
        assert(lodData !== null);
        return lodData;
    }

    private count(lod: number, transparentMode: boolean) {
        const tfrags = this.tfrags;
        const textureAssets = this.textureAssets;

        let vertexCount = 0;

        for (let i = 0; i < tfrags.length; i++) {
            const tfrag = tfrags[i];
            const tfragStrips = [tfrag.dataGroup5.lod0.strips, tfrag.dataGroup3.lod1.strips, tfrag.dataGroup1.lod2.strips];
            const tfragTextures = tfrag.dataGroup2.textures;

            const strips = tfragStrips[lod];
            let stripPtr = 0;

            let activeMaterialIsTransparent = false;

            stripLoop: while (true) {
                const strip = strips[stripPtr];
                assert(strip !== undefined);

                switch (strip.endOfPacketFlag) {
                    case 0: break; // normal strip
                    case 0x80: break; // end of packet but not end of this tfrag
                    case 0xFF: break stripLoop; // end
                    default: throw new Error(`Unknown strip flag`);
                }

                let stripVertexCount = strip.vertexCount;
                if (strip.hasAdGifFlag) {
                    if (strip.adGifOffset === -1) {
                        // do nothing
                    } else if (strip.adGifOffset >= 0) {
                        const localAdGifIndex = strip.adGifOffset / 0x5;
                        assert(tfragTextures[localAdGifIndex] !== undefined);
                        let activeMaterial = tfragTextures[localAdGifIndex].tex0.low;
                        activeMaterialIsTransparent = textureAssets[activeMaterial].hasAlpha;
                    } else {
                        throw new Error(`invalid adGifOffset`);
                    }
                }

                if (activeMaterialIsTransparent !== transparentMode) {
                    // do not count
                    stripPtr++;
                    continue;
                }

                vertexCount += stripVertexCount * 3 - (2 * 3);
                stripPtr++;
            }

        }

        return vertexCount;
    }

    private assemble(lod: number, vertexArrayBuffer: Float32Array, baseVertex: number, expectedCount: number, transparentMode: boolean) {
        const tfrags = this.tfrags;
        const textureAssets = this.textureAssets;

        const positionScale = 1 / 1024;
        const texcoordScale = 1 / 4096;
        const colorScale = 1 / 0x80;
        const angleScale = (2 * Math.PI) / 256;

        let vertexPtr = baseVertex * TfragProgram.elementsPerVertex;

        for (let i = 0; i < tfrags.length; i++) {
            const tfrag = tfrags[i];
            const basePosition = { x: tfrag.dataGroup2.basePosition[0], y: tfrag.dataGroup2.basePosition[1], z: tfrag.dataGroup2.basePosition[2] };

            const tfragInfo = new Array<TfragVertexInfo>().concat(
                tfrag.dataGroup2.vertexInfoPart1,
                tfrag.dataGroup4.vertexInfoPart2,
                tfrag.dataGroup5.vertexInfoPart3,
            );
            const tfragVerts = new Array<{ x: number, y: number, z: number }>().concat(
                tfrag.dataGroup2.vertexPositionsPart1,
                tfrag.dataGroup4.vertexPositionsPart2,
                tfrag.dataGroup5.vertexPositionsPart3,
            );
            const tfragStrips = [tfrag.dataGroup5.lod0.strips, tfrag.dataGroup3.lod1.strips, tfrag.dataGroup1.lod2.strips];
            const tfragIndices = [tfrag.dataGroup5.lod0.indices, tfrag.dataGroup3.lod1.indices, tfrag.dataGroup1.lod2.indices];
            const tfragTextures = tfrag.dataGroup2.textures;

            const strips = tfragStrips[lod];
            let stripPtr = 0;
            const indices = tfragIndices[lod];
            let stripIndicesPtr = 0;

            let currentMaterial = {
                texture: 0,
                textureIsTransparent: false,
                clamp: 0,
                lodK: 0,
            };

            stripLoop: while (true) {
                const strip = strips[stripPtr];
                assert(strip !== undefined);

                switch (strip.endOfPacketFlag) {
                    case 0: break; // normal strip
                    case 0x80: break; // end of packet but not end of this tfrag
                    case 0xFF: break stripLoop; // end
                    default: throw new Error(`Unknown strip flag`);
                }

                let stripVertexCount = strip.vertexCount;
                if (strip.hasAdGifFlag) {
                    if (strip.adGifOffset === -1) {
                        // do nothing
                    } else if (strip.adGifOffset >= 0) {
                        const localAdGifIndex = strip.adGifOffset / 0x5;
                        assert(tfragTextures[localAdGifIndex] !== undefined);
                        const texture = tfragTextures[localAdGifIndex].tex0.low;
                        currentMaterial = {
                            texture,
                            textureIsTransparent: textureAssets[texture].hasAlpha,
                            clamp: tfragTextures[localAdGifIndex].clamp.low + (tfragTextures[localAdGifIndex].clamp.high << 2),
                            lodK: decodeLodK(tfragTextures[localAdGifIndex].tex1.low),
                        }
                    } else {
                        throw new Error(`invalid adGifOffset`);
                    }
                }

                if (currentMaterial.textureIsTransparent !== transparentMode) {
                    stripIndicesPtr += stripVertexCount;
                    stripPtr++;
                    continue;
                }

                for (let i = 0; i < stripVertexCount - 2; i++) {
                    const triangleIndices = [indices[stripIndicesPtr], indices[stripIndicesPtr + 1], indices[stripIndicesPtr + 2]];
                    for (let tri = 0; tri < 3; tri++) {
                        const vertexIndex = triangleIndices[tri];
                        const vertInfo = tfragInfo[vertexIndex];
                        const vertPos = tfragVerts[vertInfo.vertex / 2];
                        const light = tfrag.lights[vertInfo.vertex / 2];

                        vertexArrayBuffer[vertexPtr++] = positionScale * (basePosition.x + vertPos.x);
                        vertexArrayBuffer[vertexPtr++] = positionScale * (basePosition.y + vertPos.y);
                        vertexArrayBuffer[vertexPtr++] = positionScale * (basePosition.z + vertPos.z);
                        vertexArrayBuffer[vertexPtr++] = angleScale * light.azimuth;
                        vertexArrayBuffer[vertexPtr++] = angleScale * light.elevation;
                        vertexArrayBuffer[vertexPtr++] = colorScale * light.ambientColor.r;
                        vertexArrayBuffer[vertexPtr++] = colorScale * light.ambientColor.g;
                        vertexArrayBuffer[vertexPtr++] = colorScale * light.ambientColor.b;
                        vertexArrayBuffer[vertexPtr++] = packRemap(this.textureAtlases.tfragTextureRemap[currentMaterial.texture]);
                        vertexArrayBuffer[vertexPtr++] = currentMaterial.clamp;
                        vertexArrayBuffer[vertexPtr++] = currentMaterial.lodK;
                        vertexArrayBuffer[vertexPtr++] = texcoordScale * this.fixTexcoord(vertInfo.s);
                        vertexArrayBuffer[vertexPtr++] = texcoordScale * this.fixTexcoord(vertInfo.t);
                        vertexArrayBuffer[vertexPtr++] = light.lightSelector.lightIndices[0];
                        vertexArrayBuffer[vertexPtr++] = light.lightSelector.lightIndices[1];
                        vertexArrayBuffer[vertexPtr++] = light.lightSelector.weight;
                    }
                    stripIndicesPtr++;
                }

                stripIndicesPtr += 2;
                stripPtr++;
            }

        }

        assert(vertexPtr === (baseVertex + expectedCount) * TfragProgram.elementsPerVertex);
    }

    private fixTexcoord(n: number) {
        if (n < 0) return n / 2;
        return n;
    }

    public destroy(device: GfxDevice): void {
        for (const lod of this.lods) {
            if (lod) {
                device.destroyBuffer(lod.vertexBuffer);
            }
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

export class TfragRenderer {
    private tfragProgram: GfxProgram;

    constructor(private renderHelper: GfxRenderHelper) {
        this.tfragProgram = renderHelper.renderCache.createProgram(new TfragProgram());
    }

    renderTfrag(renderInstList: GfxRenderInstList, tfragGeometry: TfragGeometry, settingLodPreset: number, textureMappings: GfxSamplerBinding[], cameraPosition: vec3) {
        const objectMatrix = noclipSpaceFromRatchetSpace; // the tfrag has no transform, it's already in world space

        let lodLevel = settingLodPreset;
        if (settingLodPreset === -1) {
            lodLevel = 0;
        }

        const vertexData = tfragGeometry.getOrCreateVertexBuffer(lodLevel);

        // to emulate TEST_1.AFAIL=FB_ONLY, render transparent parts twice, once with depth write and alpha test, and again with neither
        const draws = [
            { transparentOnly: false, depthWrite: true, alphaTest: 0.75 },
            { transparentOnly: true, depthWrite: false, alphaTest: 0 },
        ]

        for (let i = 0; i < draws.length; i++) {
            const draw = draws[i];

            const vertexCount = draw.transparentOnly ? vertexData.vertexCountTransparent : (vertexData.vertexCountOpaque + vertexData.vertexCountTransparent);
            if (!vertexCount) continue;
            const startVertex = draw.transparentOnly ? vertexData.vertexCountOpaque : 0;

            const renderInst = this.renderHelper.renderInstManager.newRenderInst();
            renderInst.setMegaStateFlags({ depthWrite: draw.depthWrite, depthCompare: GfxCompareMode.Greater });
            renderInst.setBindingLayouts(bindingLayouts);
            renderInst.setGfxProgram(this.tfragProgram);

            const tfragParams = renderInst.allocateUniformBufferF32(TfragProgram.ub_TfragParams, 0x16);
            let offs = 0;
            offs += fillMatrix4x3(tfragParams, offs, objectMatrix);
            offs += fillVec4(tfragParams, offs, draw.alphaTest, 0, 0, 0);

            renderInst.setVertexInput(
                tfragGeometry.inputLayout,
                [
                    { buffer: vertexData.vertexBuffer, byteOffset: startVertex * TfragProgram.elementsPerVertex * 0x4 },
                ],
                null,
            );
            renderInst.setSamplerBindingsFromTextureMappings(textureMappings);
            renderInst.setDrawCount(vertexCount, 0);
            renderInstList.submitRenderInst(renderInst);
        }
    }
}
