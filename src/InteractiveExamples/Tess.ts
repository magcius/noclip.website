
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { SceneDesc, SceneContext } from "../SceneBase";
import { GfxDevice, GfxTexture, GfxProgram, GfxBuffer, GfxFormat, GfxInputLayout, GfxInputState, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxVertexBufferFrequency, GfxBindingLayoutDescriptor, GfxCullMode, makeTextureDescriptor2D, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { assert, nArray } from "../util";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { DeviceProgram } from "../Program";
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { GfxRenderInst, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { mat4, ReadonlyMat4, ReadonlyVec3, vec2, vec3 } from "gl-matrix";
import { fillColor, fillMatrix4x3, fillMatrix4x4, fillVec3v, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { computeModelMatrixS, computeModelMatrixSRT, getMatrixTranslation, getMatrixAxisZ, MathConstants, transformVec3Mat4w1 } from "../MathHelpers";
import { DataFetcher } from "../DataFetcher";
import { TextureMapping } from "../TextureHolder";
import { Blue, Cyan, Green, Magenta, Red, Yellow } from "../Color";
import { dfRange, dfShow } from "../DebugFloaters";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";

class PatchProgram extends DeviceProgram {
    public static a_TexCoord = 0;

    public static ub_SceneParams = 0;
    public static ub_ObjectParams = 1;

    public override both = `
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    vec4 u_CameraPosWorld;
};

struct WaveParam {
    vec4 Param[1];
};

layout(std140) uniform ub_ObjectParams {
    Mat4x3 u_PatchToMeshMatrix;
    Mat4x3 u_MeshToWorldMatrix;
    WaveParam u_Wave[2];
    vec4 u_ColorAdd;
};

uniform sampler2D u_TextureHeightmap;

vec4 UnpackUnsignedNormalMap(in vec4 t_NormalMapSample) {
    t_NormalMapSample.rgb = t_NormalMapSample.rgb * 2.0 - 1.0;
    return t_NormalMapSample;
}

float CalcWaveHeight(uint t_Index, in vec2 t_TexCoord) {
    vec4 t_WaveParam0 = u_Wave[t_Index].Param[0];
    t_TexCoord.xy *= t_WaveParam0.z;
    t_TexCoord.xy += t_WaveParam0.xy;
    vec4 t_HeightmapSample = texture(SAMPLER_2D(u_TextureHeightmap), t_TexCoord.xy);
    return UnpackUnsignedNormalMap(t_HeightmapSample)[t_Index] * t_WaveParam0.w;
}

${GfxShaderLibrary.saturate}
`;

    public override vert = `
layout(location = 0) in vec2 a_TexCoord;

out vec2 v_TexCoordMesh;
out vec3 v_PositionWorld;
out vec3 v_NormalWorld;
out vec3 v_TangentWorld;

vec3 SphereFromCube(vec3 t_Pos) {
    // http://mathproofs.blogspot.com/2005/07/mapping-cube-to-sphere.html
    vec3 t_Pos2 = t_Pos * t_Pos;
    vec3 t_Sph = t_Pos;
    t_Sph.x *= sqrt(1.0 - (t_Pos2.y / 2.0) - (t_Pos2.z / 2.0) + ((t_Pos2.y * t_Pos2.z) / 3.0));
    t_Sph.y *= sqrt(1.0 - (t_Pos2.z / 2.0) - (t_Pos2.x / 2.0) + ((t_Pos2.z * t_Pos2.x) / 3.0));
    t_Sph.z *= sqrt(1.0 - (t_Pos2.x / 2.0) - (t_Pos2.y / 2.0) + ((t_Pos2.x * t_Pos2.y) / 3.0));
    return t_Sph;
}

void main() {
    vec2 t_PatchLoc = a_TexCoord.xy * 2.0 - 1.0;
    vec3 t_PatchPos = vec3(t_PatchLoc.x, 0.0, t_PatchLoc.y);
    vec3 t_PatchNrm = vec3(0.0, 1.0, 0.0);

    vec3 t_MeshPos = Mul(_Mat4x4(u_PatchToMeshMatrix), vec4(t_PatchPos, 1.0)).xyz;
    vec3 t_MeshNrm = Mul(_Mat4x4(u_PatchToMeshMatrix), vec4(t_PatchNrm, 0.0)).xyz;
    vec3 t_MeshTng = vec3(1.0, 0.0, 0.0);
    v_TexCoordMesh.xy = a_TexCoord.xy;

#ifdef MODE_SPHERE
    t_MeshPos = SphereFromCube(t_MeshPos);
    t_MeshNrm = normalize(t_MeshPos);
    t_MeshTng = normalize(cross(t_MeshNrm, vec3(0.0, 1.0, 0.0)));

    v_TexCoordMesh.x = (atan(t_MeshNrm.z, t_MeshNrm.x) / (2.0 * 3.1415)) + 0.5;
    v_TexCoordMesh.y = t_MeshNrm.y * 0.5 + 0.5;
#endif

    vec3 t_PosWorld = Mul(_Mat4x4(u_MeshToWorldMatrix), vec4(t_MeshPos, 1.0)).xyz;
    v_NormalWorld = normalize(Mul(_Mat4x4(u_MeshToWorldMatrix), vec4(t_MeshNrm, 0.0)).xyz);
    v_TangentWorld = normalize(Mul(_Mat4x4(u_MeshToWorldMatrix), vec4(t_MeshTng, 0.0)).xyz);

    t_PosWorld.xyz += v_NormalWorld.xyz * CalcWaveHeight(0u, v_TexCoordMesh.xy);
    t_PosWorld.xyz += v_NormalWorld.xyz * CalcWaveHeight(1u, v_TexCoordMesh.xy);

    v_PositionWorld.xyz = t_PosWorld.xyz;
    gl_Position = Mul(u_ProjectionView, vec4(t_PosWorld, 1.0));
}
`;

    public override frag = `
in vec2 v_TexCoordMesh;
in vec3 v_PositionWorld;
in vec3 v_NormalWorld;
in vec3 v_TangentWorld;

float G1V(float NoV, float k) {
    return 1.0 / (NoV * (1.0 - k) + k);
}

vec3 CalcTangentToWorld(in vec3 t_TangentNormal, in vec3 t_Basis0, in vec3 t_Basis1, in vec3 t_Basis2) {
    return t_TangentNormal.xxx * t_Basis0 + t_TangentNormal.yyy * t_Basis1 + t_TangentNormal.zzz * t_Basis2;
}

vec3 ReconstructNormal(in vec4 t_NormalXY) {
    float t_NormalZ = sqrt(saturate(1.0 - dot(t_NormalXY.xy, t_NormalXY.xy)));
    return vec3(t_NormalXY.xy, t_NormalZ);
}

void main() {
    // gl_FragColor = vec4(v_NormalWorld.xyz * 0.5 + 0.5, 1.0);
    // gl_FragColor.rgba += u_ColorAdd;

    vec3 t_Albedo = vec3(0.17188, 0.32227, 0.14746);

    vec4 t_FinalColor = vec4(0.0, 0.0, 0.0, 1.0);

    vec3 t_SurfacePointToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    vec3 t_SurfacePointToEyeDir = normalize(t_SurfacePointToEye.xyz);

    vec3 t_Basis2 = v_NormalWorld.xyz;
    vec3 t_Basis0 = v_TangentWorld.xyz;
    vec3 t_Basis1 = cross(v_NormalWorld.xyz, v_TangentWorld.xyz);

    // We now have our basis. Now sample the normal maps.
    vec3 t_TangentNormal0 = ReconstructNormal(UnpackUnsignedNormalMap(texture(SAMPLER_2D(u_TextureHeightmap), v_TexCoordMesh.xy * 32.0 + u_Wave[0].Param[0].xy))) * 0.1;
    vec3 t_TangentNormal1 = ReconstructNormal(UnpackUnsignedNormalMap(texture(SAMPLER_2D(u_TextureHeightmap), v_TexCoordMesh.xy * 64.0 + u_Wave[0].Param[0].xy * 6.0))) * 0.1;
    vec3 t_NormalWorld = CalcTangentToWorld(normalize(t_TangentNormal0 + t_TangentNormal1), t_Basis0, t_Basis1, t_Basis2);

    vec3 N = t_NormalWorld.xyz;

    // Surface point to light
    vec3 L = normalize(vec3(1.0, 1.0, 1.0));
    // Surface point to eye
    vec3 V = t_SurfacePointToEyeDir.xyz;

    vec3 t_IncomingLight = vec3(0.0);

    if (true) {
        // Wrapped lighting
        float t_LightVis = dot(N, L) * 0.5 + 0.5;
        t_IncomingLight.rgb += mix(vec3(0.0), vec3(1.0), t_LightVis);
    }

    if (true) {
        // Specular
        float NoL = saturate(dot(N, L));

        // Stolen from: http://filmicworlds.com/blog/optimizing-ggx-update/

        vec3 H = normalize(L + V);
        float NoV = saturate(dot(N, V));
        float NoH = saturate(dot(N, H));
        float LoH = saturate(dot(L, H));

        float r = 0.2;
        float r2 = r * r;

        // D
        float D = r2 / (pow(NoH * NoH * (r2 - 1.0) + 1.0, 2.0));

        // V
        float k = r2 / 2.0;
        float vis = G1V(NoL, k) * G1V(NoV, k);

        vec3 F0 = vec3(0.05);

        float LoH5 = pow(1.0 - saturate(dot(H, V)), 5.0);
        vec3 F = F0 + (1.0 - F0) * LoH5;

        vec3 t_SpecularResponse = D * F * vis;
        t_IncomingLight.rgb += NoL * t_SpecularResponse.rgb * vec3(0.4, 0.4, 0.4);
    }

    t_FinalColor.rgb += t_IncomingLight.rgb * t_Albedo.rgb;

    t_FinalColor.rgb = pow(t_FinalColor.rgb, vec3(1.0 / 2.2));
    gl_FragColor.rgba = t_FinalColor;

    // gl_FragColor.rgb = t_NormalWorld0.rgb * 0.5 + 0.5;
}
`;
}

function fetchPNG(dataFetcher: DataFetcher, path: string): Promise<ImageData> {
    path = dataFetcher.getDataURLForPath(path);
    const img = document.createElement('img');
    img.crossOrigin = 'anonymous';
    img.src = path;
    const p = new Promise<ImageData>((resolve) => {
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0);
            resolve(ctx.getImageData(0, 0, img.width, img.height));
        };
    });
    return p;
}

function makeTextureFromImageData(device: GfxDevice, imageData: ImageData): GfxTexture {
    const texture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, imageData.width, imageData.height, 1));
    device.uploadTextureData(texture, 0, [new Uint8Array(imageData.data.buffer)]);
    return texture;
}

class PatchLibrary {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private patchVariation: { startIndex: number, indexCount: number }[] = [];

    constructor(cache: GfxRenderCache, public sideNumQuads: number = 32) {
        const device = cache.device;
        const sideNumVerts = sideNumQuads + 1;

        let totalNumVerts = sideNumVerts ** 2.0;
        // Skirt points -- one extra vert for each quad, along each edge
        totalNumVerts += sideNumQuads * 4;

        // UV
        const vertexSize = 2;
        const vertexData = new Float32Array(vertexSize * totalNumVerts);

        let vertexOffs = 0;
        for (let z = 0; z < sideNumVerts; z++) {
            const texCoordT = (z / sideNumQuads);
            for (let x = 0; x < sideNumVerts; x++) {
                const texCoordS = (x / sideNumQuads);

                vertexData[vertexOffs++] = texCoordS;
                vertexData[vertexOffs++] = texCoordT;
            }
        }

        // Skirt points.

        // Top
        let skirtTopVertexIndexStart = vertexOffs / vertexSize;
        for (let x = 0; x < sideNumQuads; x++) {
            const texCoordS = (x + 0.5) / sideNumQuads;
            const texCoordT = 0.0;

            vertexData[vertexOffs++] = texCoordS;
            vertexData[vertexOffs++] = texCoordT;
        }

        // Left
        let skirtLeftVertexIndexStart = vertexOffs / vertexSize;
        for (let z = 0; z < sideNumQuads; z++) {
            const texCoordS = 0.0;
            const texCoordT = (z + 0.5) / sideNumQuads;

            vertexData[vertexOffs++] = texCoordS;
            vertexData[vertexOffs++] = texCoordT;
        }

        // Right
        let skirtRightVertexIndexStart = vertexOffs / vertexSize;
        for (let z = 0; z < sideNumQuads; z++) {
            const texCoordS = 1.0;
            const texCoordT = (z + 0.5) / sideNumQuads;

            vertexData[vertexOffs++] = texCoordS;
            vertexData[vertexOffs++] = texCoordT;
        }

        // Bottom
        let skirtBottomVertexIndexStart = vertexOffs / vertexSize;
        for (let x = 0; x < sideNumQuads; x++) {
            const texCoordS = (x + 0.5) / sideNumQuads;
            const texCoordT = 1.0;

            vertexData[vertexOffs++] = texCoordS;
            vertexData[vertexOffs++] = texCoordT;
        }

        this.vertexBuffer = makeStaticDataBuffer(cache.device, GfxBufferUsage.Vertex, vertexData.buffer);

        const gridNumQuads = sideNumQuads ** 2.0;

        // Count up the index count in each patch.
        let indexBufferSize = 0;
        for (let i = 0; i <= 0b1111; i++) {
            const splitTop    = (i & 0b0001) !== 0 ? 1 : 0;
            const splitLeft   = (i & 0b0010) !== 0 ? 1 : 0;
            const splitRight  = (i & 0b0100) !== 0 ? 1 : 0;
            const splitBottom = (i & 0b1000) !== 0 ? 1 : 0;
            const popCount = splitTop + splitLeft + splitRight + splitBottom;

            // Start with a base grid count -- three indices per tri, two quads per quad.
            let indexCount = 2 * 3 * gridNumQuads;

            // Each split edge adds in an additional triangle for all the quads in a given edge.
            indexCount += 3 * sideNumQuads * popCount;

            const startIndex = indexBufferSize;
            this.patchVariation[i] = { startIndex, indexCount };

            indexBufferSize += indexCount;
        }

        const indexData = new Uint16Array(indexBufferSize);

        let indexOffs = 0;
        for (let i = 0; i <= 0b1111; i++) {
            const splitTop    = (i & 0b0001) !== 0 ? 1 : 0;
            const splitLeft   = (i & 0b0010) !== 0 ? 1 : 0;
            const splitRight  = (i & 0b0100) !== 0 ? 1 : 0;
            const splitBottom = (i & 0b1000) !== 0 ? 1 : 0;

            const variation = this.patchVariation[i];
            assert(indexOffs === variation.startIndex);
            for (let z = 1; z < sideNumVerts; z++) {
                for (let x = 1; x < sideNumVerts; x++) {
                    const x0 = x - 1, x1 = x;
                    const z0 = z - 1, z1 = z;

                    const shouldSplitTop = (splitTop && z0 === 0);
                    const shouldSplitLeft = (splitLeft && x0 === 0);
                    const shouldSplitRight = (splitRight && x1 === sideNumQuads);
                    const shouldSplitBottom = (splitBottom && z1 === sideNumQuads);

                    // Now get the indexes of the four points.
                    const i0 = z0*sideNumVerts + x0;
                    const i1 = z1*sideNumVerts + x0;
                    const i2 = z0*sideNumVerts + x1;
                    const i3 = z1*sideNumVerts + x1;

                    // Skirt patterns:
                    //
                    // i0    i2      i0 i4 i2     i0 i4 i2
                    // ________      ________     ________
                    // |    //|      |  /\  |     | //\\ |
                    // |  //  |      | /  \ |   i5|/    \|
                    // |//____|      |/____\|     |_\---\|
                    //
                    // i1    i3      i1    i3     i1    i3

                    if (shouldSplitTop && shouldSplitLeft) {
                        const i4 = skirtTopVertexIndexStart + x0;
                        const i5 = skirtLeftVertexIndexStart + z0;

                        indexData[indexOffs++] = i0;
                        indexData[indexOffs++] = i5;
                        indexData[indexOffs++] = i4;

                        indexData[indexOffs++] = i4;
                        indexData[indexOffs++] = i5;
                        indexData[indexOffs++] = i3;

                        indexData[indexOffs++] = i5;
                        indexData[indexOffs++] = i1;
                        indexData[indexOffs++] = i3;

                        indexData[indexOffs++] = i4;
                        indexData[indexOffs++] = i3;
                        indexData[indexOffs++] = i2;
                    } else if (shouldSplitTop && shouldSplitRight) {
                        const i4 = skirtTopVertexIndexStart + x0;
                        const i5 = skirtRightVertexIndexStart + z0;

                        indexData[indexOffs++] = i2;
                        indexData[indexOffs++] = i4;
                        indexData[indexOffs++] = i5;

                        indexData[indexOffs++] = i5;
                        indexData[indexOffs++] = i4;
                        indexData[indexOffs++] = i1;

                        indexData[indexOffs++] = i4;
                        indexData[indexOffs++] = i0;
                        indexData[indexOffs++] = i1;

                        indexData[indexOffs++] = i5;
                        indexData[indexOffs++] = i1;
                        indexData[indexOffs++] = i3;
                    } else if (shouldSplitBottom && shouldSplitRight) {
                        const i4 = skirtBottomVertexIndexStart + x0;
                        const i5 = skirtRightVertexIndexStart + z0;

                        indexData[indexOffs++] = i0;
                        indexData[indexOffs++] = i4;
                        indexData[indexOffs++] = i5;

                        indexData[indexOffs++] = i0;
                        indexData[indexOffs++] = i5;
                        indexData[indexOffs++] = i2;

                        indexData[indexOffs++] = i4;
                        indexData[indexOffs++] = i0;
                        indexData[indexOffs++] = i1;

                        indexData[indexOffs++] = i5;
                        indexData[indexOffs++] = i4;
                        indexData[indexOffs++] = i3;
                    } else if (shouldSplitBottom && shouldSplitLeft) {
                        const i4 = skirtBottomVertexIndexStart + x0;
                        const i5 = skirtLeftVertexIndexStart + z0;

                        indexData[indexOffs++] = i1;
                        indexData[indexOffs++] = i4;
                        indexData[indexOffs++] = i5;

                        indexData[indexOffs++] = i2;
                        indexData[indexOffs++] = i5;
                        indexData[indexOffs++] = i4;

                        indexData[indexOffs++] = i5;
                        indexData[indexOffs++] = i2;
                        indexData[indexOffs++] = i0;

                        indexData[indexOffs++] = i4;
                        indexData[indexOffs++] = i3;
                        indexData[indexOffs++] = i2;
                    } else if (shouldSplitTop) {
                        const i4 = skirtTopVertexIndexStart + x0;

                        indexData[indexOffs++] = i0;
                        indexData[indexOffs++] = i1;
                        indexData[indexOffs++] = i4;

                        indexData[indexOffs++] = i4;
                        indexData[indexOffs++] = i1;
                        indexData[indexOffs++] = i3;

                        indexData[indexOffs++] = i2;
                        indexData[indexOffs++] = i4;
                        indexData[indexOffs++] = i3;
                    } else if (shouldSplitLeft) {
                        const i4 = skirtLeftVertexIndexStart + z0;

                        indexData[indexOffs++] = i0;
                        indexData[indexOffs++] = i4;
                        indexData[indexOffs++] = i2;

                        indexData[indexOffs++] = i4;
                        indexData[indexOffs++] = i3;
                        indexData[indexOffs++] = i2;

                        indexData[indexOffs++] = i1;
                        indexData[indexOffs++] = i3;
                        indexData[indexOffs++] = i4;
                    } else if (shouldSplitRight) {
                        const i4 = skirtRightVertexIndexStart + z0;

                        indexData[indexOffs++] = i0;
                        indexData[indexOffs++] = i1;
                        indexData[indexOffs++] = i4;

                        indexData[indexOffs++] = i4;
                        indexData[indexOffs++] = i1;
                        indexData[indexOffs++] = i3;

                        indexData[indexOffs++] = i2;
                        indexData[indexOffs++] = i0;
                        indexData[indexOffs++] = i4;
                    } else if (shouldSplitBottom) {
                        const i4 = skirtBottomVertexIndexStart + x0;

                        indexData[indexOffs++] = i0;
                        indexData[indexOffs++] = i1;
                        indexData[indexOffs++] = i4;

                        indexData[indexOffs++] = i4;
                        indexData[indexOffs++] = i2;
                        indexData[indexOffs++] = i0;

                        indexData[indexOffs++] = i2;
                        indexData[indexOffs++] = i4;
                        indexData[indexOffs++] = i3;
                    } else {
                        indexData[indexOffs++] = i0;
                        indexData[indexOffs++] = i1;
                        indexData[indexOffs++] = i2;

                        indexData[indexOffs++] = i2;
                        indexData[indexOffs++] = i1;
                        indexData[indexOffs++] = i3;
                    }
                }
            }
            assert(indexOffs === variation.startIndex + variation.indexCount);
        }

        this.indexBuffer = makeStaticDataBuffer(cache.device, GfxBufferUsage.Index, indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: PatchProgram.a_TexCoord, format: GfxFormat.F32_RG, bufferIndex: 0, bufferByteOffset: 0, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 4*vertexSize, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat: GfxFormat.U16_R,
        });
        this.inputState = device.createInputState(this.inputLayout, [{ buffer: this.vertexBuffer, byteOffset: 0 }], { buffer: this.indexBuffer, byteOffset: 0 });
    }

    public getVariationNo(splitTop: boolean, splitLeft: boolean, splitRight: boolean, splitBottom: boolean): number {
        let no = 0;
        if (splitTop)
            no |= 0b0001;
        if (splitLeft)
            no |= 0b0010;
        if (splitRight)
            no |= 0b0100;
        if (splitBottom)
            no |= 0b1000;
        return no;
    }

    public setOnRenderInst(renderInst: GfxRenderInst, variationNo: number): void {
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);

        const variation = this.patchVariation[variationNo];
        renderInst.drawIndexes(variation.indexCount, variation.startIndex);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputState(this.inputState);
    }
}

const scratchMat4a = mat4.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();

const enum PatchNeighborEdge {
    // Blue-to-purple
    Top,
    // Blue-to-cyan
    Left,
    // Purple-to-white
    Right,
    // Cyan-to-white
    Bottom,
}

const enum PatchChild {
    TopLeft, TopRight,
    BottomLeft, BottomRight,
}

const enum PatchTransformMode {
    Plane,
    Sphere,
}

interface PatchShaderParam {
    worldFromMeshMatrix: ReadonlyMat4;
    waveParam: WaveParam[];
}

class PatchInstance {
    public patchToMeshMatrix = mat4.create();

    // PatchNeighbor
    public neighbor: (PatchInstance | null)[] = [null, null, null, null];
    // PatchChild
    public child: (PatchInstance | null)[] = [null, null, null, null];

    public meshCenterPos = vec3.create();
    public scale = 1.0;

    public isLeaf = false;
    public forceLeaf = false;

    constructor(matrix: ReadonlyMat4, private transformMode: PatchTransformMode, levelsLeft: number, childMask = 0b1111) {
        mat4.copy(this.patchToMeshMatrix, matrix);

        getMatrixTranslation(this.meshCenterPos, this.patchToMeshMatrix);
        this.transformMeshPos(this.meshCenterPos, this.meshCenterPos);

        mat4.getScaling(scratchVec3a, this.patchToMeshMatrix);
        this.scale = Math.max(scratchVec3a[0], scratchVec3a[1], scratchVec3a[2]);

        if (levelsLeft === 0) {
            this.isLeaf = true;
            this.forceLeaf = true;
        } else {
            for (let i = 0; i < 4; i++) {
                if (!(childMask & (1 << i)))
                    continue;

                mat4.scale(scratchMat4a, this.patchToMeshMatrix, [0.5, 0.5, 0.5]);
                if (i === PatchChild.TopLeft)
                    mat4.translate(scratchMat4a, scratchMat4a, [-1, 0, -1]);
                else if (i === PatchChild.TopRight)
                    mat4.translate(scratchMat4a, scratchMat4a, [1, 0, -1]);
                else if (i === PatchChild.BottomLeft)
                    mat4.translate(scratchMat4a, scratchMat4a, [-1, 0, 1]);
                else if (i === PatchChild.BottomRight)
                    mat4.translate(scratchMat4a, scratchMat4a, [1, 0, 1]);
                this.child[i] = new PatchInstance(scratchMat4a, this.transformMode, levelsLeft - 1);
            }
        }

        // Set up child topology.
        if (this.child[PatchChild.TopLeft] !== null) {
            this.child[PatchChild.TopLeft]!.setNeighborEdge(PatchNeighborEdge.Right, this.child[PatchChild.TopRight]);
            this.child[PatchChild.TopLeft]!.setNeighborEdge(PatchNeighborEdge.Bottom, this.child[PatchChild.BottomLeft]);
        }

        if (this.child[PatchChild.TopRight] !== null) {
            this.child[PatchChild.TopRight]!.setNeighborEdge(PatchNeighborEdge.Left, this.child[PatchChild.TopLeft]);
            this.child[PatchChild.TopRight]!.setNeighborEdge(PatchNeighborEdge.Bottom, this.child[PatchChild.BottomRight]);
        }

        if (this.child[PatchChild.BottomLeft] !== null) {
            this.child[PatchChild.BottomLeft]!.setNeighborEdge(PatchNeighborEdge.Right, this.child[PatchChild.BottomRight]);
            this.child[PatchChild.BottomLeft]!.setNeighborEdge(PatchNeighborEdge.Top, this.child[PatchChild.TopLeft]);
        }

        if (this.child[PatchChild.BottomRight] !== null) {
            this.child[PatchChild.BottomRight]!.setNeighborEdge(PatchNeighborEdge.Left, this.child[PatchChild.BottomLeft]);
            this.child[PatchChild.BottomRight]!.setNeighborEdge(PatchNeighborEdge.Top, this.child[PatchChild.TopRight]);
        }
    }

    public setNeighborEdge(edge: PatchNeighborEdge, patch: PatchInstance | null): void {
        this.neighbor[edge] = patch;

        if (edge === PatchNeighborEdge.Top) {
            if (this.child[PatchChild.TopLeft] !== null)
                this.child[PatchChild.TopLeft]!.setNeighborEdge(edge, patch);
            if (this.child[PatchChild.TopRight] !== null)
                this.child[PatchChild.TopRight]!.setNeighborEdge(edge, patch);
        } else if (edge === PatchNeighborEdge.Left) {
            if (this.child[PatchChild.TopLeft] !== null)
                this.child[PatchChild.TopLeft]!.setNeighborEdge(edge, patch);
            if (this.child[PatchChild.BottomLeft] !== null)
                this.child[PatchChild.BottomLeft]!.setNeighborEdge(edge, patch);
        } else if (edge === PatchNeighborEdge.Right) {
            if (this.child[PatchChild.TopRight] !== null)
                this.child[PatchChild.TopRight]!.setNeighborEdge(edge, patch);
            if (this.child[PatchChild.BottomRight] !== null)
                this.child[PatchChild.BottomRight]!.setNeighborEdge(edge, patch);
        } else if (edge === PatchNeighborEdge.Bottom) {
            if (this.child[PatchChild.BottomLeft] !== null)
                this.child[PatchChild.BottomLeft]!.setNeighborEdge(edge, patch);
            if (this.child[PatchChild.BottomRight] !== null)
                this.child[PatchChild.BottomRight]!.setNeighborEdge(edge, patch);
        }
    }

    public tessellate(cameraPosInMeshSpace: ReadonlyVec3, meshSpaceDistThreshold: number): void {
        if (this.forceLeaf)
            return;

        const dist = vec3.distance(cameraPosInMeshSpace, this.meshCenterPos);
        this.isLeaf = dist >= (meshSpaceDistThreshold * this.scale);

        if (this.isLeaf) {
            // Mark children as leaves for the neighbor split checks.
            for (let i = 0; i < this.child.length; i++)
                if (this.child[i] !== null)
                    this.child[i]!.isLeaf = true;
        } else {
            for (let i = 0; i < this.child.length; i++)
                if (this.child[i] !== null)
                    this.child[i]!.tessellate(cameraPosInMeshSpace, meshSpaceDistThreshold);
        }
    }

    private transformMeshPos(dst: vec3, src: ReadonlyVec3): void {
        if (this.transformMode === PatchTransformMode.Plane) {
            vec3.copy(dst, src);
        } else if (this.transformMode === PatchTransformMode.Sphere) {
            const x2 = src[0] ** 2.0, y2 = src[1] ** 2.0, z2 = src[2] ** 2.0;
            dst[0] = src[0] * Math.sqrt(1.0 - (y2 / 2.0) - (z2 / 2.0) + ((y2 * z2) / 3.0));
            dst[1] = src[1] * Math.sqrt(1.0 - (z2 / 2.0) - (x2 / 2.0) + ((z2 * x2) / 3.0));
            dst[2] = src[2] * Math.sqrt(1.0 - (x2 / 2.0) - (y2 / 2.0) + ((x2 * y2) / 3.0));
        }
    }

    private shouldSplitEdge(edge: PatchNeighborEdge): boolean {
        const neighbor = this.neighbor[edge];
        if (neighbor === null)
            return false;
        return !neighbor.isLeaf;
    }

    private chooseVariation(patchLibrary: PatchLibrary): number {
        const splitTop = this.shouldSplitEdge(PatchNeighborEdge.Top);
        const splitLeft = this.shouldSplitEdge(PatchNeighborEdge.Left);
        const splitRight = this.shouldSplitEdge(PatchNeighborEdge.Right);
        const splitBottom = this.shouldSplitEdge(PatchNeighborEdge.Bottom);
        return patchLibrary.getVariationNo(splitTop, splitLeft, splitRight, splitBottom);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, patchLibrary: PatchLibrary, shaderParam: PatchShaderParam): void {
        if (this.isLeaf) {
            const renderInst = renderInstManager.newRenderInst();
            const variation = this.chooseVariation(patchLibrary);
            patchLibrary.setOnRenderInst(renderInst, variation);

            renderInst.setMegaStateFlags({ cullMode: GfxCullMode.Back });

            let offs = renderInst.allocateUniformBuffer(PatchProgram.ub_ObjectParams, 12+12+4*2+4);
            const d = renderInst.mapUniformBufferF32(PatchProgram.ub_ObjectParams);

            offs += fillMatrix4x3(d, offs, this.patchToMeshMatrix); // u_PatchToMeshMatrix
            offs += fillMatrix4x3(d, offs, shaderParam.worldFromMeshMatrix);
            for (let i = 0; i < 2; i++)
                offs += shaderParam.waveParam[i].fill(d, offs);

            const level = Math.log2(1.0 / this.scale) | 0;
            const colors = [ Red, Green, Blue, Cyan, Magenta, Yellow, Red, Green, Blue ];
            offs += fillColor(d, offs, colors[level])

            renderInstManager.submitRenderInst(renderInst);
        } else {
            for (let i = 0; i < this.child.length; i++)
                if (this.child[i] !== null)
                    this.child[i]!.prepareToRender(renderInstManager, patchLibrary, shaderParam);
        }
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 1, },
];

interface TessObject {
    prepareToRender(renderInstManager: GfxRenderInstManager, patchLibrary: PatchLibrary, viewerInput: ViewerRenderInput): void;
}

const enum TessCubeFace {
    Top, Bottom, Left, Right, Front, Back,
}

class WaveParam {
    public texCoordScroll = vec2.create();
    @dfShow()
    @dfRange(1000, 10000, 1)
    public texCoordScrollSpeed = 1000.0;
    @dfShow()
    @dfRange(1, 20, 0.01)
    public texCoordScale = 4;
    @dfShow()
    @dfRange(0, 1000, 1)
    public heightmapScale = 500;

    public update(viewerInput: ViewerRenderInput): void {
        this.texCoordScroll[0] = viewerInput.time / this.texCoordScrollSpeed;
    }

    public fill(d: Float32Array, offs: number): number {
        return fillVec4(d, offs, this.texCoordScroll[0], this.texCoordScroll[1], this.texCoordScale, this.heightmapScale);
    }
}

class TessSphere {
    private face: PatchInstance[] = [];
    private gfxProgram: GfxProgram;
    public worldFromMeshMatrix = mat4.create();
    @dfShow()
    public waveParam = nArray(2, () => new WaveParam());
    public distThreshold = 5;
    private textureMapping = nArray(1, () => new TextureMapping());

    constructor(cache: GfxRenderCache, sceneData: SceneData) {
        const transformMode = PatchTransformMode.Sphere as PatchTransformMode;

        const program = new PatchProgram();
        if (transformMode === PatchTransformMode.Sphere)
            program.setDefineBool(`MODE_SPHERE`, true);
        this.gfxProgram = cache.createProgram(program);

        computeModelMatrixS(this.worldFromMeshMatrix, 512 * 16);

        const numLevels = 5;

        // Set up parameters.
        this.waveParam[0].texCoordScrollSpeed = 5000;
        this.waveParam[0].texCoordScale = 2;
        this.waveParam[0].heightmapScale = 230;

        this.waveParam[1].texCoordScrollSpeed = 9000;
        this.waveParam[1].texCoordScale = 1;
        this.waveParam[1].heightmapScale = 570;

        // Top
        {
            computeModelMatrixSRT(scratchMat4a, 1, 1, 1, 0, 0, 0, 0, 1, 0);
            const patch = new PatchInstance(scratchMat4a, transformMode, numLevels);
            this.face.push(patch);
        }

        // Bottom
        {
            computeModelMatrixSRT(scratchMat4a, 1, 1, 1, 0, 0, MathConstants.TAU / 2, 0, -1, 0);
            const patch = new PatchInstance(scratchMat4a, transformMode, numLevels);
            this.face.push(patch);
        }

        // Left
        {
            computeModelMatrixSRT(scratchMat4a, 1, 1, 1, -MathConstants.TAU / 4, MathConstants.TAU / 4, 0, -1, 0, 0);
            const patch = new PatchInstance(scratchMat4a, transformMode, numLevels);
            this.face.push(patch);
        }

        // Right
        {
            computeModelMatrixSRT(scratchMat4a, 1, 1, 1, -MathConstants.TAU / 4, -MathConstants.TAU / 4, 0, 1, 0, 0);
            const patch = new PatchInstance(scratchMat4a, transformMode, numLevels);
            this.face.push(patch);
        }

        // Front
        {
            computeModelMatrixSRT(scratchMat4a, 1, 1, 1, MathConstants.TAU / 4, 0, 0, 0, 0, 1);
            const patch = new PatchInstance(scratchMat4a, transformMode, numLevels);
            this.face.push(patch);
        }

        // Back
        {
            computeModelMatrixSRT(scratchMat4a, 1, 1, 1, -MathConstants.TAU / 4, 0, 0, 0, 0, -1);
            const patch = new PatchInstance(scratchMat4a, transformMode, numLevels);
            this.face.push(patch);
        }

        // Hook up cube topology.
        this.face[TessCubeFace.Top].setNeighborEdge(PatchNeighborEdge.Top, this.face[TessCubeFace.Back]);
        this.face[TessCubeFace.Top].setNeighborEdge(PatchNeighborEdge.Left, this.face[TessCubeFace.Left]);
        this.face[TessCubeFace.Top].setNeighborEdge(PatchNeighborEdge.Right, this.face[TessCubeFace.Right]);
        this.face[TessCubeFace.Top].setNeighborEdge(PatchNeighborEdge.Bottom, this.face[TessCubeFace.Front]);

        this.face[TessCubeFace.Bottom].setNeighborEdge(PatchNeighborEdge.Top, this.face[TessCubeFace.Back]);
        this.face[TessCubeFace.Bottom].setNeighborEdge(PatchNeighborEdge.Left, this.face[TessCubeFace.Right]);
        this.face[TessCubeFace.Bottom].setNeighborEdge(PatchNeighborEdge.Right, this.face[TessCubeFace.Left]);
        this.face[TessCubeFace.Bottom].setNeighborEdge(PatchNeighborEdge.Bottom, this.face[TessCubeFace.Front]);

        this.face[TessCubeFace.Left].setNeighborEdge(PatchNeighborEdge.Top, this.face[TessCubeFace.Bottom]);
        this.face[TessCubeFace.Left].setNeighborEdge(PatchNeighborEdge.Left, this.face[TessCubeFace.Front]);
        this.face[TessCubeFace.Left].setNeighborEdge(PatchNeighborEdge.Right, this.face[TessCubeFace.Back]);
        this.face[TessCubeFace.Left].setNeighborEdge(PatchNeighborEdge.Bottom, this.face[TessCubeFace.Top]);

        this.face[TessCubeFace.Right].setNeighborEdge(PatchNeighborEdge.Top, this.face[TessCubeFace.Bottom]);
        this.face[TessCubeFace.Right].setNeighborEdge(PatchNeighborEdge.Left, this.face[TessCubeFace.Back]);
        this.face[TessCubeFace.Right].setNeighborEdge(PatchNeighborEdge.Right, this.face[TessCubeFace.Front]);
        this.face[TessCubeFace.Right].setNeighborEdge(PatchNeighborEdge.Bottom, this.face[TessCubeFace.Top]);

        this.face[TessCubeFace.Front].setNeighborEdge(PatchNeighborEdge.Top, this.face[TessCubeFace.Top]);
        this.face[TessCubeFace.Front].setNeighborEdge(PatchNeighborEdge.Left, this.face[TessCubeFace.Left]);
        this.face[TessCubeFace.Front].setNeighborEdge(PatchNeighborEdge.Right, this.face[TessCubeFace.Right]);
        this.face[TessCubeFace.Front].setNeighborEdge(PatchNeighborEdge.Bottom, this.face[TessCubeFace.Bottom]);

        this.face[TessCubeFace.Back].setNeighborEdge(PatchNeighborEdge.Top, this.face[TessCubeFace.Bottom]);
        this.face[TessCubeFace.Back].setNeighborEdge(PatchNeighborEdge.Left, this.face[TessCubeFace.Left]);
        this.face[TessCubeFace.Back].setNeighborEdge(PatchNeighborEdge.Right, this.face[TessCubeFace.Right]);
        this.face[TessCubeFace.Back].setNeighborEdge(PatchNeighborEdge.Bottom, this.face[TessCubeFace.Top]);

        this.textureMapping[0].gfxTexture = sceneData.heightmap;
        this.textureMapping[0].gfxSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.NoMip,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });
    }

    private chooseClosestFace(meshPos: ReadonlyVec3): TessCubeFace {
        const x = Math.abs(meshPos[0]);
        const y = Math.abs(meshPos[1]);
        const z = Math.abs(meshPos[2]);

        if (x >= y && x >= z) {
            return meshPos[0] >= 0.0 ? TessCubeFace.Right : TessCubeFace.Left;
        } else if (y >= x && y >= z) {
            return meshPos[1] >= 0.0 ? TessCubeFace.Top : TessCubeFace.Bottom;
        } else {
            return meshPos[2] >= 0.0 ? TessCubeFace.Front : TessCubeFace.Back;
        }
    }

    public tessellate(worldPos: ReadonlyVec3): void {
        mat4.invert(scratchMat4a, this.worldFromMeshMatrix);
        transformVec3Mat4w1(scratchVec3b, scratchMat4a, worldPos);
        // vec3.normalize(scratchVec3b, scratchVec3b);

        // TODO(jstpierre): Constrain edges to reduce seams
        const closestFace = this.chooseClosestFace(scratchVec3b);

        for (let i = 0; i < this.face.length; i++)
            this.face[i].tessellate(scratchVec3b, this.distThreshold);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, patchLibrary: PatchLibrary, viewerInput: ViewerRenderInput): void {
        getMatrixTranslation(scratchVec3a, viewerInput.camera.worldMatrix);
        this.tessellate(scratchVec3a);

        for (let i = 0; i < this.waveParam.length; i++)
            this.waveParam[i].update(viewerInput);

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        template.setGfxProgram(this.gfxProgram);
        template.setSamplerBindingsFromTextureMappings(this.textureMapping);

        let offs = template.allocateUniformBuffer(PatchProgram.ub_SceneParams, 16+4);
        const d = template.mapUniformBufferF32(PatchProgram.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.clipFromWorldMatrix);

        getMatrixTranslation(scratchVec3a, viewerInput.camera.worldMatrix);
        offs += fillVec3v(d, offs, scratchVec3a);

        for (let i = 0; i < this.face.length; i++) {
            const patch = this.face[i];
            patch.prepareToRender(renderInstManager, patchLibrary, this);
        }

        renderInstManager.popTemplateRenderInst();
    }
}

class TessRenderer implements SceneGfx {
    private patchLibrary: PatchLibrary;
    private renderHelper: GfxRenderHelper;
    private objects: TessObject[] = [];

    constructor(device: GfxDevice, context: SceneContext, private sceneData: SceneData) {
        this.renderHelper = new GfxRenderHelper(device, context);

        this.patchLibrary = new PatchLibrary(this.renderHelper.renderCache);
        this.objects.push(new TessSphere(this.renderHelper.renderCache, sceneData));
    }

    private prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();

        const renderInstManager = this.renderHelper.renderInstManager;
        for (let i = 0; i < this.objects.length; i++)
            this.objects[i].prepareToRender(renderInstManager, this.patchLibrary, viewerInput);
        renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.sceneData.destroy(device);
        this.patchLibrary.destroy(device);
        this.renderHelper.destroy();
    }
}

class SceneData {
    public heightmap: GfxTexture;

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.heightmap);
    }
}

async function fetchSceneData(context: SceneContext): Promise<SceneData> {
    const sceneData = new SceneData();
    sceneData.heightmap = makeTextureFromImageData(context.device, await fetchPNG(context.dataFetcher, `Tess/Heightmap.png`));
    return sceneData;
}

export class TessSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const sceneData = await fetchSceneData(context);
        return new TessRenderer(device, context, sceneData);
    }
}
