import { mat4, vec3 } from "gl-matrix";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxTextureUsage, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { DeviceProgram } from "../Program.js";
import { DecodedImage } from "./bmp.js";
import { GrannyAnimation, GrannyMesh, GrannySkeleton } from "./granny.js";
import { GRANNY_MAX_BONES, GrannyAnimator } from "./granny-anim.js";
import { MAX_POINT_LIGHTS, PointLight, POINT_LIGHT_FALLOFF_EXPONENT, POINT_LIGHT_INTENSITY } from "./lights.js";

const GRANNY_VERTEX_STRIDE = 3 * 4 + 2 * 4 + 3 * 4 + 4 + 4;

class GrannyProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_TexCoord = 1;
    public static a_Normal = 2;
    public static a_BoneWeights = 3;
    public static a_BoneIndices = 4;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
    vec4 u_LightDir;
    vec4 u_DiffuseColor;
    vec4 u_AmbientColor;
    vec4 u_PointLightParams;
    vec4 u_PointLightPosRange[${MAX_POINT_LIGHTS}];
    vec4 u_PointLightColor[${MAX_POINT_LIGHTS}];
};

layout(std140) uniform ub_ModelParams {
    Mat4x4 u_WorldFromModel;
    vec4 u_Skinned;
    Mat4x4 u_BoneMatrices[${GRANNY_MAX_BONES}];
};

uniform sampler2D u_BaseTexture;

varying vec2 v_TexCoord;
varying vec3 v_Normal;
varying vec3 v_WorldPos;
`;

    public override vert = `
layout(location = ${GrannyProgram.a_Position}) in vec3 a_Position;
layout(location = ${GrannyProgram.a_TexCoord}) in vec2 a_TexCoord;
layout(location = ${GrannyProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${GrannyProgram.a_BoneWeights}) in vec4 a_BoneWeights;
layout(location = ${GrannyProgram.a_BoneIndices}) in vec4 a_BoneIndices;

void main() {
    mat4 t_M = UnpackMatrix(u_WorldFromModel);

    vec3 t_Pos = a_Position;
    vec3 t_Nrm = a_Normal;
    if (u_Skinned.x > 0.5) {
        float t_WeightSum = a_BoneWeights.x + a_BoneWeights.y + a_BoneWeights.z + a_BoneWeights.w;
        if (t_WeightSum > 0.0001) {

            ivec4 t_Idx = ivec4(a_BoneIndices * 255.0 + 0.5);
            mat4 t_Skin =
                UnpackMatrix(u_BoneMatrices[t_Idx.x]) * a_BoneWeights.x +
                UnpackMatrix(u_BoneMatrices[t_Idx.y]) * a_BoneWeights.y +
                UnpackMatrix(u_BoneMatrices[t_Idx.z]) * a_BoneWeights.z +
                UnpackMatrix(u_BoneMatrices[t_Idx.w]) * a_BoneWeights.w;
            t_Skin = t_Skin * (1.0 / t_WeightSum);
            t_Pos = (t_Skin * vec4(a_Position, 1.0)).xyz;
            t_Nrm = mat3(t_Skin[0].xyz, t_Skin[1].xyz, t_Skin[2].xyz) * a_Normal;
        }
    }

    vec4 t_WorldPos = t_M * vec4(t_Pos, 1.0);
    gl_Position = UnpackMatrix(u_ClipFromWorld) * t_WorldPos;
    v_TexCoord = a_TexCoord;
    v_Normal = mat3(t_M[0].xyz, t_M[1].xyz, t_M[2].xyz) * t_Nrm;
    v_WorldPos = t_WorldPos.xyz;
}
`;

    public override frag = `
const float GRANNY_LIGHT_FLOOR = 0.5;

void main() {
    vec4 t_Base = texture(SAMPLER_2D(u_BaseTexture), v_TexCoord);
    if (t_Base.a < 0.5)
        discard;
    float t_Shade;
    float t_NLen = length(v_Normal);
    bool t_HasNormal = t_NLen >= 0.0001;
    vec3 t_N = t_HasNormal ? v_Normal / t_NLen : vec3(0.0);
    if (!t_HasNormal) {
        t_Shade = 1.0;
    } else {
        float t_Light = clamp(dot(t_N, u_LightDir.xyz), 0.0, 1.0);
        t_Shade = mix(GRANNY_LIGHT_FLOOR, 1.0, t_Light);
    }
    vec3 t_Color = t_Base.rgb * t_Shade;

    if (u_PointLightParams.w > 0.5) {
        int t_Count = int(u_PointLightParams.x);
        float t_Gain = u_PointLightParams.y;
        float t_Falloff = u_PointLightParams.z;
        vec3 t_Add = vec3(0.0);
        for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {
            if (i >= t_Count) break;
            vec3 t_Lp = u_PointLightPosRange[i].xyz;
            float t_R = u_PointLightPosRange[i].w;
            vec3 t_To = t_Lp - v_WorldPos;
            float t_D = length(t_To);
            float t_K = max(0.0, 1.0 - t_D / t_R);
            float t_Att = pow(t_K, t_Falloff) * t_Gain;
            float t_NdotL = t_HasNormal ? max(dot(t_N, t_To / max(t_D, 1e-4)), 0.0) : 1.0;
            t_Add += u_PointLightColor[i].rgb * (t_Att * t_NdotL);
        }
        t_Color = min(t_Color + t_Base.rgb * t_Add, vec3(1.0));
    }

    gl_FragColor = vec4(t_Color, 1.0);
}
`;
}

interface GpuGrannyMesh {
    vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    indexBufferDescriptor: GfxIndexBufferDescriptor;
    indexCount: number;
    texture: GfxTexture | null;
}

export interface GrannyInstance {
    meshes: GrannyMesh[];
    worldMatrix: mat4;
    textures: (DecodedImage | null)[];
    skeleton: GrannySkeleton | null;
    animations: GrannyAnimation[];
}

export class GrannyModelRenderer {
    private program: GfxProgram;
    private inputLayout: GfxInputLayout;
    private sampler: GfxSampler;
    private gpuMeshes: GpuGrannyMesh[] = [];
    private worldMatrix: mat4;
    private animator: GrannyAnimator | null = null;
    private skinned = false;

    constructor(device: GfxDevice, cache: GfxRenderHelper["renderCache"], instance: GrannyInstance) {
        this.program = cache.createProgram(new GrannyProgram());
        this.worldMatrix = instance.worldMatrix;

        const skeleton = instance.skeleton;
        if (skeleton !== null && skeleton.bones.length > 0) {
            this.animator = new GrannyAnimator(skeleton, instance.animations);
            this.skinned = this.animator.hasAnimation();
        }

        const boneIndexByName = new Map<string, number>();
        if (skeleton !== null)
            skeleton.bones.forEach((b, i) => { if (b.name !== null) boneIndexByName.set(b.name, i); });

        this.inputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: GrannyProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0 },
                { location: GrannyProgram.a_TexCoord, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 4, bufferIndex: 0 },
                { location: GrannyProgram.a_Normal, format: GfxFormat.F32_RGB, bufferByteOffset: 5 * 4, bufferIndex: 0 },
                { location: GrannyProgram.a_BoneWeights, format: GfxFormat.U8_RGBA_NORM, bufferByteOffset: 8 * 4, bufferIndex: 0 },

                { location: GrannyProgram.a_BoneIndices, format: GfxFormat.U8_RGBA_NORM, bufferByteOffset: 8 * 4 + 4, bufferIndex: 0 },
            ],
            vertexBufferDescriptors: [
                { byteStride: GRANNY_VERTEX_STRIDE, frequency: GfxVertexBufferFrequency.PerVertex },
            ],
            indexBufferFormat: GfxFormat.U32_R,
        });

        this.sampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });

        for (let i = 0; i < instance.meshes.length; i++) {
            const mesh = instance.meshes[i];
            if (mesh.indices.length === 0)
                continue;
            const remap = mesh.boneBindingNames.map((n) => boneIndexByName.get(n) ?? 0);
            const vertexData = this.packVertices(mesh, remap);
            const vbuf = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertexData);
            const ibuf = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, mesh.indices.buffer);

            const img = instance.textures[i] ?? null;
            const texture = img !== null ? this.createTexture(device, img) : null;
            this.gpuMeshes.push({
                vertexBufferDescriptors: [{ buffer: vbuf, byteOffset: 0 }],
                indexBufferDescriptor: { buffer: ibuf, byteOffset: 0 },
                indexCount: mesh.indices.length,
                texture,
            });
        }
    }

    private packVertices(mesh: GrannyMesh, remap: number[]): ArrayBuffer {
        const n = mesh.vertexCount;
        const ab = new ArrayBuffer(n * GRANNY_VERTEX_STRIDE);
        const f = new Float32Array(ab);
        const u = new Uint8Array(ab);
        for (let v = 0; v < n; v++) {
            const fo = v * (GRANNY_VERTEX_STRIDE / 4);
            f[fo + 0] = mesh.positions[v * 3 + 0];
            f[fo + 1] = mesh.positions[v * 3 + 1];
            f[fo + 2] = mesh.positions[v * 3 + 2];
            f[fo + 3] = mesh.uvs[v * 2 + 0];
            f[fo + 4] = mesh.uvs[v * 2 + 1];
            f[fo + 5] = mesh.normals[v * 3 + 0];
            f[fo + 6] = mesh.normals[v * 3 + 1];
            f[fo + 7] = mesh.normals[v * 3 + 2];
            const bo = v * GRANNY_VERTEX_STRIDE + 8 * 4;
            for (let k = 0; k < 4; k++) {
                u[bo + k] = Math.round(Math.min(1, Math.max(0, mesh.boneWeights[v * 4 + k])) * 255);
                const local = mesh.boneIndices[v * 4 + k];
                const global = local < remap.length ? remap[local] : 0;
                u[bo + 4 + k] = Math.min(global, GRANNY_MAX_BONES - 1);
            }
        }
        return ab;
    }

    private createTexture(device: GfxDevice, img: DecodedImage): GfxTexture {
        const tex = device.createTexture({
            pixelFormat: GfxFormat.U8_RGBA_NORM,
            width: img.width, height: img.height,
            depthOrArrayLayers: 1, numLevels: 1,
            dimension: GfxTextureDimension.n2D,
            usage: GfxTextureUsage.Sampled,
        });
        device.uploadTextureData(tex, 0, [img.rgba]);
        return tex;
    }

    public prepare(renderHelper: GfxRenderHelper, clipFromWorld: mat4, lightDir: vec3, diffuse: vec3, ambient: vec3, dtSeconds: number, activeLights: PointLight[], activeLightCount: number): void {
        if (this.gpuMeshes.length === 0)
            return;

        if (this.animator !== null)
            this.animator.update(dtSeconds);

        const renderInstManager = renderHelper.renderInstManager;

        const template = renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 2, numSamplers: 1 }]);
        template.setGfxProgram(this.program);
        template.setMegaStateFlags({ cullMode: GfxCullMode.None });

        const pointLightVec4Count = 1 + 2 * MAX_POINT_LIGHTS;
        let so = template.allocateUniformBuffer(GrannyProgram.ub_SceneParams, 16 + 3 * 4 + pointLightVec4Count * 4);
        const sm = template.mapUniformBufferF32(GrannyProgram.ub_SceneParams);
        so += fillMatrix4x4(sm, so, clipFromWorld);
        so += fillVec4(sm, so, lightDir[0], lightDir[1], lightDir[2], 0);
        so += fillVec4(sm, so, diffuse[0], diffuse[1], diffuse[2], 0);
        so += fillVec4(sm, so, ambient[0], ambient[1], ambient[2], 0);
        const enabled = activeLightCount > 0 ? 1 : 0;
        so += fillVec4(sm, so, activeLightCount, POINT_LIGHT_INTENSITY, POINT_LIGHT_FALLOFF_EXPONENT, enabled);
        for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
            if (i < activeLightCount) {
                const l = activeLights[i];
                so += fillVec4(sm, so, l.pos[0], l.pos[1], l.pos[2], l.range);
            } else {
                so += fillVec4(sm, so, 0, 0, 0, 0);
            }
        }
        for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
            if (i < activeLightCount) {
                const l = activeLights[i];
                so += fillVec4(sm, so, l.color[0], l.color[1], l.color[2], 0);
            } else {
                so += fillVec4(sm, so, 0, 0, 0, 0);
            }
        }

        for (const gm of this.gpuMeshes) {
            if (gm.texture === null)
                continue;
            const ri = renderInstManager.newRenderInst();
            ri.setVertexInput(this.inputLayout, gm.vertexBufferDescriptors, gm.indexBufferDescriptor);
            const modelParamsSize = 16 + 4 + 16 * GRANNY_MAX_BONES;
            let mo = ri.allocateUniformBuffer(GrannyProgram.ub_ModelParams, modelParamsSize);
            const mm = ri.mapUniformBufferF32(GrannyProgram.ub_ModelParams);
            mo += fillMatrix4x4(mm, mo, this.worldMatrix);
            const doSkin = this.skinned && this.animator !== null;
            mo += fillVec4(mm, mo, doSkin ? 1 : 0, 0, 0, 0);

            if (doSkin) {
                const palette = this.animator!.skinMatrices;
                for (let b = 0; b < GRANNY_MAX_BONES; b++)
                    mo += fillMatrix4x4(mm, mo, palette.subarray(b * 16, b * 16 + 16) as unknown as mat4);
            }
            ri.setSamplerBindingsFromTextureMappings([{ gfxTexture: gm.texture, gfxSampler: this.sampler }]);
            ri.setDrawCount(gm.indexCount, 0);
            renderInstManager.submitRenderInst(ri);
        }

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        for (const gm of this.gpuMeshes) {
            for (const vb of gm.vertexBufferDescriptors)
                device.destroyBuffer(vb.buffer);
            device.destroyBuffer(gm.indexBufferDescriptor.buffer);
            if (gm.texture !== null)
                device.destroyTexture(gm.texture);
        }
    }
}
