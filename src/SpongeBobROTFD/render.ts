import { mat3, mat4, quat, vec2, vec3, vec4 } from "gl-matrix";
import { AABB } from "../Geometry";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import {
    GfxBindingLayoutDescriptor,
    GfxBlendFactor,
    GfxBlendMode,
    GfxBufferUsage,
    GfxChannelWriteMask,
    GfxCompareMode,
    GfxCullMode,
    GfxDevice,
    GfxFormat,
    GfxFrontFaceMode,
    GfxInputLayoutBufferDescriptor,
    GfxMegaStateDescriptor,
    GfxMipFilterMode,
    GfxProgramDescriptorSimple,
    GfxTexFilterMode,
    GfxVertexAttributeDescriptor,
    GfxVertexBufferFrequency,
    GfxWrapMode
} from "../gfx/platform/GfxPlatform";
import { GfxBuffer, GfxInputLayout, GfxInputState, GfxSampler } from "../gfx/platform/GfxPlatformImpl";
import { GfxRendererLayer, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { DataStream, SIZE_VEC2, SIZE_VEC3 } from "./util";
import * as Viewer from '../viewer';
import { CameraController, computeViewMatrix } from "../Camera";
import { fillMatrix4x4, fillVec3v, fillVec4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { preprocessProgramObj_GLSL } from "../gfx/shaderc/GfxShaderCompiler";
import {
    makeBackbufferDescSimple,
    pushAntialiasingPostProcessPass,
    standardFullClearRenderPassDescriptor
} from "../gfx/helpers/RenderGraphHelpers";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { TextureMapping } from "../TextureHolder";
import { getMatrixTranslation, lerp } from "../MathHelpers";
import { Color, colorCopy, colorLerp, colorNewCopy } from "../Color";
import { nArray } from "../util";
import { hashCodeNumberFinish, hashCodeNumberUpdate, HashMap } from "../HashMap";
import { readBitmap, Texture, TotemBitmap } from "./bitmap";
import { readHFog, TotemHFog } from "./hfog";
import { readLight, TotemLight } from "./light";
import { readLod, TotemLod } from "./lod";
import { getMaterialFlag, Material, MaterialFlags, readMaterial } from "./material";
import { interpTrack, interpTrackInPlace, MaterialAnim, readMaterialAnim } from "./materialanim";
import { MeshObject, readMesh } from "./mesh";
import { readNode, TotemNode } from "./node";
import { readOmni, TotemOmni } from "./omni";
import { readSkin, TotemSkin } from "./skin";
import { precompute_lerp_vec2, precompute_lerp_vec3, precompute_surface_vec3, readSurface, SurfaceObject } from "./surface";
import { iterWarpSkybox, readWarp, TotemWarp } from "./warp";
import { FileType, TotemArchive } from "./archive";

class RotfdProgram {
    public static ub_SceneParams = 0;
    public static ub_MaterialParams = 1;
    public static ub_InstanceParams = 2;
    public static SCENEPARAM_SIZE = 4*4;
    public static MATERIALPARAM_SIZE = 4*4 + 4*4 + 4 + 4 + 4*4;
    public static INSTANCEPARAM_SIZE = 4 + 4 + 4 * 4*4 + 4 + 4 * (4 + 4 + 4);

    public both = `
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(std140) uniform ub_MaterialParams {
    Mat4x4 u_ModelView;
    Mat4x4 u_View;
    vec4 u_Color;
    vec4 u_Emit;
    Mat4x4 u_TexTransform;
};

layout(std140) uniform ub_InstanceParams {
    vec3 u_LightDirection;
    vec3 u_LightColor;
    vec3 u_LightAmbient;
    Mat4x4 u_HFogTransform;
    vec4 u_HFogColor;
    vec4 u_OmniPosition[4];
    vec4 u_OmniColor[4];
    vec4 u_OmniAttenuation[4];
};

uniform sampler2D u_Texture;
uniform sampler2D u_TextureReflection;
`;

// TODO: lighting, reflection

    public vert: string = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec2 a_TexCoord;
layout(location = 2) in vec3 a_Normal;

out vec3 v_WorldNormal;
out vec3 v_ClipNormal;
out vec2 v_TexCoord;
out vec4 v_WorldPosition;
out vec4 v_ClipPosition;

void main() {
    mat3 realmat = mat3(
        u_TexTransform.mx.xyz,
        u_TexTransform.my.xyz,
        u_TexTransform.mz.xyz
    );
    v_WorldPosition = Mul(u_ModelView, vec4(a_Position, 1.0));
    v_ClipPosition = Mul(u_View, v_WorldPosition);
    gl_Position = Mul(u_Projection, v_ClipPosition);
    v_WorldNormal = normalize(Mul(u_ModelView, vec4(a_Normal, 0.0)).xyz);
    v_ClipNormal = normalize(Mul(u_Projection, Mul(u_View, Mul(u_ModelView, vec4(a_Normal, 0.0)))).xyz);
    v_TexCoord = (vec3(a_TexCoord.xy, 1.0) * realmat).xy;
}
`;

    public frag: string = `
in vec3 v_WorldNormal;
in vec3 v_ClipNormal;
in vec2 v_TexCoord;
in vec4 v_WorldPosition;
in vec4 v_ClipPosition;

void main() {
    // AMBIENT
    vec3 lightColor = u_LightAmbient;
    // DIFFUSE
    float lightDot = max(0.0, dot(v_WorldNormal, u_LightDirection));
    lightColor += lightDot * u_LightColor;
    // SPECULAR
    vec3 reflectLight = normalize(reflect(u_LightDirection, v_ClipNormal));
    vec4 reflectionColor = texture(SAMPLER_2D(u_TextureReflection), reflectLight.xy);
    lightColor += reflectionColor.rgb;
    // OMNI LIGHTS
    for (int i = 0; i < 4; i++) {

            vec3 diff = u_OmniPosition[i].xyz - v_WorldPosition.xyz;
            vec3 lightDirection = normalize(diff);
            float minrange = u_OmniAttenuation[i][0];
            float maxrange = u_OmniAttenuation[i][1] - minrange;
            float dist = max(0.0, length(diff) - minrange);
            vec4 color = u_OmniColor[i];
            float att = clamp(maxrange/dist, 0.0, 1.0);
            lightColor += color.rgb * att * max(0.0, dot(v_WorldNormal, lightDirection));

    }
    // COLOR
    vec4 texcol = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    vec4 surfacecol = texcol * u_Color;
    gl_FragColor += surfacecol * vec4(lightColor, 1.0);

    if (u_HFogColor.a > 0.0) {
        vec4 fogPos = Mul(u_HFogTransform, v_WorldPosition);
        // float viewDot = abs(dot(v_ClipNormal, vec3(0.0, 0.0, 1.0)));
        // float fogAmount = pow(clamp(1.0 - fogPos.y, 0.0, 1.0), 1.0 / (2.0 - viewDot));
        float fogAmount = clamp(1.0 - fogPos.y, 0.0, 1.0);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, u_HFogColor.rgb, fogAmount * u_HFogColor.a);
    }

    gl_FragColor += vec4(u_Emit.rgb * texcol.rgb, 0);
    // gl_FragColor.a = 1.0;
}
`;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 2, },
];

type Vertex = [number, number, number, number, number, number, number, number];
function vertexEq(a: Vertex, b: Vertex): boolean {
    for (let i = 0; i < 8; i++) {
        if (a[i] != b[i]) {
            return false;
        }
    }
    return true;
}
function vertexHash(a: Vertex): number {
    let hash = 0;
    for (const value of a) {
        hash = hashCodeNumberUpdate(hash, value);
    }
    return hashCodeNumberFinish(hash);
}

export class VertexDataBuilder {
    private indices: number[] = [];
    private vertices: number[] = [];
    private bbox = new AABB();
    private hashmap = new HashMap<Vertex, number>(vertexEq, vertexHash);

    constructor() { }

    addVertex(vertex: Vertex): number {
        const existing = this.hashmap.get(vertex);
        if (existing !== null) {
            return existing;
        }
        if (this.vertices.length === 0) {
            this.bbox.setFromPoints([[vertex[0], vertex[1], vertex[2]]]);
        }
        else {
            this.bbox.unionPoint([vertex[0], vertex[1], vertex[2]]);
        }
        for (const value of vertex) {
            this.vertices.push(value);
        }
        this.hashmap.add(vertex, this.vertices.length / 8 - 1);
        return this.vertices.length / 8 - 1;
    }

    addTri(a: number, b: number, c: number) {
        this.indices.push(a);
        this.indices.push(b);
        this.indices.push(c);
    }

    addMeshMaterial(mesh: MeshObject, material_index: number) {
        for (const strip of mesh.strips) {
            // only consider materials for corresponding material_index
            if (strip.material_index % mesh.materials.length !== material_index) {
                continue;
            }
            for (let i = 0; i < strip.elements.length-2; i++) {
                let index0 = i;
                let index1, index2;
                if (i % 2 !== 0) {
                    index1 = 3 - strip.tri_order + i;
                    index2 = strip.tri_order + i;
                }
                else {
                    index1 = strip.tri_order + i;
                    index2 = 3 - strip.tri_order + i;
                }
                for (const j of [index0, index1, index2]) {
                    const p = mesh.vertices[strip.elements[j][0]];
                    const t = mesh.texcoords[strip.elements[j][1]];
                    const n = mesh.normals[strip.elements[j][2]];
                    const index = this.addVertex([p[0], p[1], p[2], t[0], t[1], n[0], n[1], n[2]]);
                    this.indices.push(index);
                }
            }
        }
    }

    addSurfaceIndex(surf: SurfaceObject, index: number) {
        const patch = surf.surfaces[index];
        const normals = patch.normal_indices.map(i => surf.normals[i]);
        let curves = nArray(4, () => nArray(4, () => vec3.create()));
        for (let i = 0; i < 4; i++) {
            let curve = surf.curves[patch.curve_indices[i]];
            if ((patch.curve_order & (2 << i)) === 0) {
                curves[i][0] = surf.vertices[curve.p1];
                curves[i][1] = surf.vertices[curve.p1_t];
                curves[i][2] = surf.vertices[curve.p2_t];
                curves[i][3] = surf.vertices[curve.p2];
            } else {
                curves[i][3] = surf.vertices[curve.p1];
                curves[i][2] = surf.vertices[curve.p1_t];
                curves[i][1] = surf.vertices[curve.p2_t];
                curves[i][0] = surf.vertices[curve.p2];
            }
        }
        let pts_tl = vec3.clone(curves[0][1]);
        vec3.sub(pts_tl, pts_tl, curves[0][0]);
        vec3.add(pts_tl, pts_tl, curves[3][2]);
        let pts_tr = vec3.clone(curves[0][2]);
        vec3.sub(pts_tr, pts_tr, curves[0][3]);
        vec3.add(pts_tr, pts_tr, curves[1][1]);
        let pts_bl = vec3.clone(curves[2][2]);
        vec3.sub(pts_bl, pts_bl, curves[2][3]);
        vec3.add(pts_bl, pts_bl, curves[3][1]);
        let pts_br = vec3.clone(curves[2][1]);
        vec3.sub(pts_br, pts_br, curves[1][3]);
        vec3.add(pts_br, pts_br, curves[1][2]);
        let points = [
            [curves[0][0], curves[0][1], curves[0][2], curves[0][3]],
            [curves[3][2], pts_tl, pts_tr, curves[1][1]],
            [curves[3][1], pts_bl, pts_br, curves[1][2]],
            [curves[2][3], curves[2][2], curves[2][1], curves[1][3]],
        ];
        const usteps = 3;
        const vsteps = 3;
        const interpVertices = precompute_surface_vec3(points, usteps, vsteps);
        const interpUV = precompute_lerp_vec2(patch.texcoords, usteps, vsteps);
        const interpNormals = precompute_lerp_vec3(normals, usteps, vsteps);
        const indexMap = [];
        for (let ix = 0; ix <= usteps; ix++) {
            for (let iy = 0; iy <= vsteps; iy++) {
                const p = interpVertices[ix][iy];
                const t = interpUV[ix][iy];
                const n = interpNormals[ix][iy];
                const indexValue = this.addVertex([p[0], p[1], p[2], t[0], t[1], n[0], n[1], n[2]]);
                indexMap.push(indexValue);
            }
        }
        for (let ix = 0; ix < usteps; ix++) {
            for (let iy = 0; iy < vsteps; iy++) {
                const iTL =  ix      + ( iy      * (usteps + 1));
                const iTR = (ix + 1) + ( iy      * (usteps + 1));
                const iBL =  ix      + ((iy + 1) * (usteps + 1));
                const iBR = (ix + 1) + ((iy + 1) * (usteps + 1));
                this.indices.push(indexMap[iTL]);
                this.indices.push(indexMap[iBL]);
                this.indices.push(indexMap[iTR]);
                this.indices.push(indexMap[iTR]);
                this.indices.push(indexMap[iBL]);
                this.indices.push(indexMap[iBR]);
            }
        }
    }
    build(device: GfxDevice, material: number): VertexData {
        return new VertexData(device, this.indices, this.vertices, this.bbox, material);
    }
}

export class VertexData {
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public indexCount: number;

    constructor(
        device: GfxDevice,
        indices: number[],
        vertices: number[],
        public bbox: AABB,
        public material_id: number,
    ) {
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, new Uint16Array(indices).buffer);
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, new Float32Array(vertices).buffer);
        this.indexCount = indices.length;

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: 0, format: GfxFormat.F32_RGB, bufferIndex: 0, bufferByteOffset: 0 },
            { location: 1, format: GfxFormat.F32_RG, bufferIndex: 0, bufferByteOffset: SIZE_VEC3 },
            { location: 2, format: GfxFormat.F32_RGB, bufferIndex: 0, bufferByteOffset: SIZE_VEC3 + SIZE_VEC2 },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: SIZE_VEC3 * 2 + SIZE_VEC2, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];

        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = device.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0 });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputState(this.inputState);
    }
}

function colorToRGB(out: vec3, col: Color) {
    out[0] = col.r;
    out[1] = col.g;
    out[2] = col.b;
}

function colorToRGBA(out: vec4, col: Color, a: number = col.a) {
    out[0] = col.r;
    out[1] = col.g;
    out[2] = col.b;
    out[3] = a;
}

const AttachmentsStateBlendColor = [
    {
        channelWriteMask: GfxChannelWriteMask.RGB,
        rgbBlendState: {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.One,
            blendDstFactor: GfxBlendFactor.OneMinusSrc,
        },
        alphaBlendState: {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.OneMinusDst,
            blendDstFactor: GfxBlendFactor.OneMinusSrc,
        },
    }
];

const AttachmentsStateBlendAlpha = [
    {
        channelWriteMask: GfxChannelWriteMask.AllChannels,
        rgbBlendState: {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        },
        alphaBlendState: {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.One,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        },
    }
];

let bboxScratch = new AABB();
let modelViewScratch = mat4.create();
let vec3Scratch = vec3.create();
let vec4Scratch = vec4.create();
export class MeshRenderer {
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private omniLights: OmniInstance[] = [];

    constructor(
        private geometryData: VertexData,
        private material: Material,
        public modelMatrix: mat4,
        private textureMap: Map<number, Texture>,
        public isSkybox: boolean,
        private directionalLight: TotemLight | undefined,
        private hFog: TotemHFog | undefined,
    ) {
        this.megaStateFlags.frontFace = GfxFrontFaceMode.CW;
        this.megaStateFlags.cullMode = GfxCullMode.Back;
    }

    public prepareToRender(
        renderInstManager: GfxRenderInstManager,
        viewerInput: Viewer.ViewerRenderInput,
        sampler: GfxSampler,
    ) {
        if (getMaterialFlag(this.material, MaterialFlags.FLAG_HIDDEN) || this.material.color.a === 0.0) {
            return;
        }
        bboxScratch.transform(this.geometryData.bbox, this.modelMatrix);
        if (!viewerInput.camera.frustum.contains(bboxScratch) && !this.isSkybox) {
            return;
        }
        
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(this.geometryData.inputLayout, this.geometryData.inputState);
        const textureMapping = new TextureMapping();
        const texture = this.textureMap.get(this.material.texture_id);
        const textureAlpha = texture ? texture.alphaLevel : 0;
        textureMapping.gfxTexture = texture ? texture.texture : null;
        textureMapping.gfxSampler = sampler;
        const reflectionMapping = new TextureMapping();
        const reflectionTexture = this.textureMap.get(this.material.reflection_id);
        reflectionMapping.gfxTexture = reflectionTexture ? reflectionTexture.texture : null;
        reflectionMapping.gfxSampler = sampler;
        renderInst.setSamplerBindingsFromTextureMappings([ textureMapping, reflectionMapping ]);

        let offs = renderInst.allocateUniformBuffer(RotfdProgram.ub_MaterialParams, RotfdProgram.MATERIALPARAM_SIZE);
        const d = renderInst.mapUniformBufferF32(RotfdProgram.ub_MaterialParams);
        computeViewMatrix(modelViewScratch, viewerInput.camera);
        if (this.isSkybox) {
            modelViewScratch[12] = 0.0;
            modelViewScratch[13] = 0.0;
            modelViewScratch[14] = 0.0;
            renderInst.sortKey = GfxRendererLayer.BACKGROUND;
            this.megaStateFlags.depthWrite = false;
        }
        else {
            this.megaStateFlags.depthWrite = true;
        }
        if (getMaterialFlag(this.material, MaterialFlags.FLAG_BLENDCOLOR)) {
            renderInst.sortKey = GfxRendererLayer.TRANSLUCENT;
            this.megaStateFlags.attachmentsState = AttachmentsStateBlendColor;
            this.megaStateFlags.depthWrite = false;
        }
        else if (this.material.color.a < 1.0 || textureAlpha >= 1) {
            // other material flags seem to be unreliable and erratic
            // i.e. there are materials with no flags set who are still transparent?
            renderInst.sortKey = GfxRendererLayer.TRANSLUCENT;
            this.megaStateFlags.attachmentsState = AttachmentsStateBlendAlpha;
            this.megaStateFlags.depthWrite = false;
        }
        else {
            renderInst.sortKey = GfxRendererLayer.OPAQUE;
            this.megaStateFlags.attachmentsState = undefined;
        }
        renderInst.setMegaStateFlags(this.megaStateFlags);
        offs += fillMatrix4x4(d, offs, this.modelMatrix);
        offs += fillMatrix4x4(d, offs, modelViewScratch);
        const col = this.material.color;
        const emit = this.material.emission;
        offs += fillVec4(d, offs, col.r, col.g, col.b, col.a);
        offs += fillVec4(d, offs, emit.r, emit.g, emit.b, 0);
        const tx = this.material.transform;
        offs += fillMatrix4x4(d, offs, [
            tx[0], tx[1], tx[2], 0,
            tx[3], tx[4], tx[5], 0,
            tx[6], tx[7], tx[8], 0,
            0, 0, 0, 1
        ]);
        let offs2 = renderInst.allocateUniformBuffer(RotfdProgram.ub_InstanceParams, RotfdProgram.INSTANCEPARAM_SIZE);
        const d2 = renderInst.mapUniformBufferF32(RotfdProgram.ub_InstanceParams);
        if (this.directionalLight !== undefined) {
            offs2 += fillVec3v(d2, offs2, this.directionalLight.direction);
            colorToRGB(vec3Scratch, this.directionalLight.color1);
            offs2 += fillVec3v(d2, offs2, vec3Scratch);
            colorToRGB(vec3Scratch, this.directionalLight.color2);
            offs2 += fillVec3v(d2, offs2, vec3Scratch);
        }
        else {
            offs2 += fillVec4(d2, offs2, 0, 1, 0);
            offs2 += fillVec4(d2, offs2, 0, 0, 0);
            offs2 += fillVec4(d2, offs2, 1, 1, 1);
        }
        if (this.hFog !== undefined) {
            mat4.identity(modelViewScratch);
            mat4.mul(modelViewScratch, modelViewScratch, this.hFog.global_transform);
            mat4.invert(modelViewScratch, modelViewScratch);
            offs2 += fillMatrix4x4(d2, offs2, modelViewScratch);
            colorToRGBA(vec4Scratch, this.hFog.color, 1.0);
            offs2 += fillVec4v(d2, offs2, vec4Scratch);
        }
        else {
            mat4.identity(modelViewScratch);
            offs2 += fillMatrix4x4(d2, offs2, modelViewScratch);
            offs2 += fillVec4(d2, offs2, 0, 0, 0, 0);
        }
        for (let i = 0; i < Math.min(4, this.omniLights.length); i++) {
            const instance = this.omniLights[i];
            getMatrixTranslation(vec3Scratch, instance.transform);
            fillVec3v(d2, offs2 + i * 4, vec3Scratch);
            colorToRGBA(vec4Scratch, instance.omni.color, 1.0);
            fillVec4v(d2, offs2 + i * 4 + 16, vec4Scratch);
            fillVec4(d2, offs2 + i * 4 + 32, instance.omni.attenuation[0], instance.omni.attenuation[1], 0, 0);
        }
        for (let i = this.omniLights.length; i < 4; i++) {
            fillVec4(d2, offs2 + i * 4, 0, 0, 0);
            fillVec4(d2, offs2 + i * 4 + 16, 0, 0, 0, 0);
            fillVec4(d2, offs2 + i * 4 + 32, 0, 0, 0, 0);
        }

        renderInst.drawIndexes(this.geometryData.indexCount);
        renderInstManager.submitRenderInst(renderInst);
    }

    updateOmniLights(omniInstances: Map<number, OmniInstance>) {
        this.omniLights = [];
        bboxScratch.transform(this.geometryData.bbox, this.modelMatrix);
        for (const instance of omniInstances.values()) {
            getMatrixTranslation(vec3Scratch, instance.transform);
            if (bboxScratch.containsSphere(vec3Scratch, instance.omni.attenuation[1])) {
                this.omniLights.push(instance);
            }
        }
    }
}

type MeshInfo = {
    meshes: VertexData[]
}

type MaterialAnimInfo = {
    id: number;
    anim: MaterialAnim;
}

type SkinInfo = {
    meshes: number[] // can be MESH or SURFACE
}

type LodInfo = {
    resources: number[] // can be SKIN or MESH
}

type OmniInstance = {
    omni: TotemOmni;
    transform: mat4;
}

export class ROTFDRenderer implements Viewer.SceneGfx {
    private program: GfxProgramDescriptorSimple;
    public renderHelper: GfxRenderHelper;
    public sampler: GfxSampler;
    public warpSampler: GfxSampler;
    // mesh info
    private meshes = new Map<number, MeshInfo>();
    private otherMeshes: VertexData[] = [];
    private meshRenderers: MeshRenderer[] = [];
    private lods = new Map<number, LodInfo>();
    private skins = new Map<number, SkinInfo>();
    // resources
    private materials = new Map<number, Material>();
    private bitmaps = new Map<number, Texture>();
    private materialAnims: MaterialAnimInfo[] = [];
    private hfogResources = new Map<number, TotemHFog>();
    private directionalLights = new Map<number, TotemLight>();
    private omniResources = new Map<number, TotemOmni>();
    private omniInstances = new Map<number, OmniInstance>();

    constructor(private device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
        this.program = preprocessProgramObj_GLSL(device, new RotfdProgram());

        this.sampler = device.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.NoMip,
            minLOD: 0, maxLOD: 0,
        });

        this.warpSampler = device.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.NoMip,
            minLOD: 0, maxLOD: 0,
        });
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(1/60);
    }

    onstatechanged() {
        
    }

    updateMaterialAnims(frame: number) {
        for (const animInfo of this.materialAnims) {
            const anim = animInfo.anim;
            let material = this.materials.get(animInfo.id);
            if (material === undefined) {
                continue;
            }
            const animFrame = Math.floor(frame % (anim.length * 60));
            let shouldUpdateTransform = false;
            const texture = interpTrack(anim.texture, animFrame, (a, b, t) => a);
            if (texture !== undefined) {
                material.texture_id = texture;
            }
            if (interpTrackInPlace(material.offset, anim.scroll, animFrame, vec2.lerp, vec2.copy)) {
                shouldUpdateTransform = true;
            }
            if (interpTrackInPlace(material.scale, anim.stretch, animFrame, vec2.lerp, vec2.copy)) {
                shouldUpdateTransform = true;
            }
            const rotation = interpTrack(anim.rotation, animFrame, lerp);
            if (rotation !== undefined) {
                shouldUpdateTransform = true;
                material.rotation = rotation;
            }
            interpTrackInPlace(material.color, anim.color, animFrame, colorLerp, (out, a) => colorCopy(out, a, out.a));
            interpTrackInPlace(material.emission, anim.emission, animFrame, colorLerp, colorCopy);
            const alpha = interpTrack(anim.alpha, animFrame, lerp);
            if (alpha !== undefined) {
                material.color.a = alpha;
            }
            if (shouldUpdateTransform) {
                let tx = material.transform;
                mat3.identity(tx);
                mat3.translate(tx, tx, [0.5, 0.5]);
                mat3.translate(tx, tx, material.offset);
                mat3.scale(tx, tx, material.scale);
                mat3.rotate(tx, tx, material.rotation);
                mat3.translate(tx, tx, [-0.5, -0.5]);
            }
        }
    }

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput, renderInstManager: GfxRenderInstManager) {
        // console.log(viewerInput.time * 60 * 1000);
        viewerInput.camera.setClipPlanes(0.5);

        this.updateMaterialAnims(Math.floor(viewerInput.time * 60 / 1000));
        const gfxProgram = renderInstManager.gfxRenderCache.createProgramSimple(this.program);

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setGfxProgram(gfxProgram);
        let offs = template.allocateUniformBuffer(RotfdProgram.ub_SceneParams, RotfdProgram.SCENEPARAM_SIZE);
        const d = template.mapUniformBufferF32(RotfdProgram.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);
        for (const instance of this.meshRenderers) {
            instance.prepareToRender(renderInstManager, viewerInput, instance.isSkybox ? this.warpSampler : this.sampler);
        }
        renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

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

        this.prepareToRender(device, viewerInput, renderInstManager);
        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
    }

    destroy(device: GfxDevice) {
        this.renderHelper.destroy();
        for (const meshinfo of this.meshes.values()) {
            for (const mesh of meshinfo.meshes) {
                mesh.destroy(device);
            }
        }
        for (const mesh of this.otherMeshes) {
            mesh.destroy(device);
        }
        for (const texture of this.bitmaps.values()) {
            texture.destroy();
        }
    }

    addMesh(id: number, mesh: MeshObject) {
        let meshes: VertexData[] = [];
        for (let i = 0; i < mesh.materials.length; i++) {
            let builder = new VertexDataBuilder();
            builder.addMeshMaterial(mesh, i);
            meshes.push(builder.build(this.device, mesh.materials[i]));
        }
        this.meshes.set(id, {
            meshes
        });
    }

    addSurface(id: number, surf: SurfaceObject) {
        let builders = new Map<number, VertexDataBuilder>();
        for (let i = 0; i < surf.surfaces.length; i++) {
            let material = surf.surfaces[i].materialanim_id;
            let builder = builders.get(material);
            if (builder === undefined) {
                builder = new VertexDataBuilder();
                builders.set(material, builder);
            }
            builder.addSurfaceIndex(surf, i);
        }
        let meshes: VertexData[] = [];
        for (const [material, builder] of builders) {
            meshes.push(builder.build(this.device, material));
        }
        this.meshes.set(id, {
            meshes
        })
    }

    addBitmap(id: number, bitmap: TotemBitmap) {
        this.bitmaps.set(id, new Texture(id, bitmap, this.device));
    }

    addMaterial(id: number, material: Material) {
        this.materials.set(id, material);
    }

    addMaterialAnim(id: number, anim: MaterialAnim) {
        let material = this.materials.get(anim.material_id);
        if (material === undefined) {
            console.log(id);
            material = {
                color: {r: 1, g: 1, b: 1, a: 1},
                emission: {r: 0, g: 0, b: 0, a: 0},
                unk1: 0,
                offset: [0, 0],
                reflection_id: 0,
                texture_id: 0,
                rotation: 0,
                scale: [0, 0],
                transform: mat3.create(),
                flags_a: 7,
                flags_b: 6,
                unk2: 0,
                unk3: 0,
            };
        }
        else {
            material = {
                color: colorNewCopy(material.color),
                emission: colorNewCopy(material.emission),
                unk1: material.unk1,
                transform: mat3.clone(material.transform),
                rotation: material.rotation,
                offset: vec2.clone(material.offset),
                scale: vec2.clone(material.scale),
                texture_id: material.texture_id,
                reflection_id: material.reflection_id,
                flags_a: material.flags_a,
                flags_b: material.flags_b,
                unk2: material.unk2,
                unk3: material.unk3,
            };
        }
        // just use the same map for both MATERIAL and MATERIALANIM,
        // it doesn't really matter. There shouldn't be any overlap anyways.
        this.materials.set(id, material);
        this.materialAnims.push({
            id,
            anim,
        })
    }

    addSkin(id: number, skin: TotemSkin) {
        this.skins.set(id, {
            meshes: skin.meshes
        })
    }

    addLod(id: number, lod: TotemLod) {
        this.lods.set(id, {
            resources: lod.meshes,
        })
    }

    addWarp(id: number, warp: TotemWarp) {
        for (const face of iterWarpSkybox(warp)) {
            let builder = new VertexDataBuilder();
            let n = face.normal;
            for (let i = 0; i < 4; i++) {
                let v = face.positions[i];
                let t = face.texcoords[i];
                builder.addVertex([v[0], v[1], v[2], t[0], t[1], n[0], n[1], n[2]]);
            }
            builder.addTri(0, 1, 2);
            builder.addTri(1, 3, 2);
            const vertexdata = builder.build(this.device, face.material);
            this.otherMeshes.push(vertexdata);
            this.addMeshRenderer(mat4.create(), vertexdata, true, 0, 0);
        }
    }

    private addMeshRenderer(tx: mat4, mesh: VertexData, isSkybox: boolean, lightid: number, hfogid: number) {
        let material = this.materials.get(mesh.material_id);
        if (material === undefined) {
            // use a default material for now, might search node data?
            material = {
                color: {r: 1, g: 1, b: 1, a: 1},
                emission: {r: 0, g: 0, b: 0, a: 0},
                unk1: 0,
                offset: [0, 0],
                reflection_id: 0,
                texture_id: 0,
                rotation: 0,
                scale: [0, 0],
                transform: mat3.create(),
                flags_a: 7,
                flags_b: 6,
                unk2: 0,
                unk3: 0,
            };
        }
        let light = this.directionalLights.get(lightid);
        const hfog = this.hfogResources.get(hfogid);
        const renderer = new MeshRenderer(mesh, material, tx, this.bitmaps, isSkybox, light, hfog);
        renderer.updateOmniLights(this.omniInstances);
        this.meshRenderers.push(renderer);
    }

    private addMeshInfo(tx: mat4, meshInfo: MeshInfo, lightid: number, hfogid: number) {
        for (const mesh of meshInfo.meshes) {
            this.addMeshRenderer(tx, mesh, false, lightid, hfogid);
        }
    }

    private addMeshInfoFromNode(node: TotemNode, meshinfo: MeshInfo) {
        this.addMeshInfo(node.global_transform, meshinfo, node.light_id, node.hfog_id);
    }

    addMeshNode(node: TotemNode, resid: number = node.resource_id) {
        const meshInfo = this.meshes.get(resid);
        if (meshInfo === undefined) {
            console.log(`NO MESH ${resid}`);
            return;
        }
        this.addMeshInfoFromNode(node, meshInfo);
    }

    addSkinNode(node: TotemNode, resid: number = node.resource_id) {
        const skinInfo = this.skins.get(resid);
        if (skinInfo === undefined) {
            console.log(`NO SKIN ${resid}`);
            return;
        }
        for (const subskin of skinInfo.meshes) {
            this.addMeshNode(node, subskin);
        }
    }

    addLodNode(node: TotemNode, resid: number = node.resource_id) {
        const lodInfo = this.lods.get(resid);
        if (lodInfo === undefined) {
            console.log(`NO LOD ${resid}`);
            return;
        }
        for (const index of lodInfo.resources) {
            const meshInfo = this.meshes.get(index);
            if (meshInfo !== undefined) {
                this.addMeshInfoFromNode(node, meshInfo);
            }
            else if (this.skins.has(index)) {
                this.addSkinNode(node, index);
            }
            else {
                console.log("UNRECOGNIZED NODE LOD", node, resid);
            }
        }
    }

    addLight(id: number, light: TotemLight) {
        this.directionalLights.set(id, light);
    }

    public addArchive(archive: TotemArchive) {
        for (const file of archive.iterFilesOfType(FileType.LIGHT)) {
            const reader = new DataStream(file.data, 0, false);
            const data = readLight(reader);
            this.addLight(file.nameHash, data);
        }

        for (const file of archive.iterFilesOfType(FileType.OMNI)) {
            const reader = new DataStream(file.data, 0, false);
            const data = readOmni(reader);
            this.omniResources.set(file.nameHash, data);
        }

        for (const bitmapFile of archive.iterFilesOfType(FileType.BITMAP)) {
            const reader = new DataStream(bitmapFile.data, 0, false);
            const bitmapData = readBitmap(reader);
            this.addBitmap(bitmapFile.nameHash, bitmapData);
        }

        for (const materialFile of archive.iterFilesOfType(FileType.MATERIAL)) {
            const reader = new DataStream(materialFile.data, 0, false);
            const materialData = readMaterial(reader);
            this.addMaterial(materialFile.nameHash, materialData);
        }

        for (const materialAnimFile of archive.iterFilesOfType(FileType.MATERIALANIM)) {
            const reader = new DataStream(materialAnimFile.data, 0, false);
            const manimData = readMaterialAnim(reader);
            this.addMaterialAnim(materialAnimFile.nameHash, manimData);
        }

        for (const meshFile of archive.iterFilesOfType(FileType.MESH)) {
            const reader = new DataStream(meshFile.data, 0, false);
            const meshdata = readMesh(reader);
            this.addMesh(meshFile.nameHash, meshdata);
        }

        for (const surfFile of archive.iterFilesOfType(FileType.SURFACE)) {
            const reader = new DataStream(surfFile.data, 0, false);
            const surfData = readSurface(reader);
            this.addSurface(surfFile.nameHash, surfData);
        }

        for (const skinFile of archive.iterFilesOfType(FileType.SKIN)) {
            const reader = new DataStream(skinFile.data, 0, false);
            const skinData = readSkin(reader);
            this.addSkin(skinFile.nameHash, skinData);
        }

        for (const lodFile of archive.iterFilesOfType(FileType.LOD)) {
            const reader = new DataStream(lodFile.data, 0, false);
            const lodData = readLod(reader);
            this.addLod(lodFile.nameHash, lodData);
        }

        for (const warpFile of archive.iterFilesOfType(FileType.WARP)) {
            const reader = new DataStream(warpFile.data, 0, false);
            const warpData = readWarp(reader);
            this.addWarp(warpFile.nameHash, warpData);
        }

        for (const file of archive.iterFilesOfType(FileType.HFOG)) {
            const reader = new DataStream(file.data, 0, false);
            const data = readHFog(reader);
            this.hfogResources.set(file.nameHash, data);
        }

        const nodes = [];
        for (const nodeFile of archive.iterFilesOfType(FileType.NODE)) {
            const reader = new DataStream(nodeFile.data, 0, false);
            const nodeData = readNode(reader);
            if (nodeData.resource_id !== 0) {
                nodes.push(nodeData);
            }
        }
        for (const nodeData of nodes) {
            const resourceFile = archive.getFile(nodeData.resource_id);
            if (resourceFile === undefined) {
                console.log("ERROR!");
                continue;
            }
            if (resourceFile.typeHash === FileType.OMNI) {
                this.omniInstances.set(resourceFile.nameHash, {
                    omni: this.omniResources.get(resourceFile.nameHash)!,
                    transform: nodeData.global_transform,
                })
            }
        }

        for (const nodeData of nodes) {
            const resourceFile = archive.getFile(nodeData.resource_id);
            if (resourceFile === undefined) {
                console.log("ERROR!");
                continue;
            }
            if (resourceFile.typeHash === FileType.MESH || resourceFile.typeHash === FileType.SURFACE) {
                this.addMeshNode(nodeData);
            }
            else if (resourceFile.typeHash === FileType.LOD) {
                this.addLodNode(nodeData);
            }
            else if (resourceFile.typeHash === FileType.SKIN) {
                this.addSkinNode(nodeData);
            }
        }
    }
}

function buildCube(device: GfxDevice, material: number, extents: vec3) {
    const builder = new VertexDataBuilder();
    for (const face of iterWarpSkybox({
        // material_ids and size don't matter here
        material_ids: [0, 0, 0, 0, 0, 0],
        size: 1.0,
        vertices: [
            [-extents[0], -extents[1], +extents[2]],
            [-extents[0], -extents[1], -extents[2]],
            [+extents[0], -extents[1], -extents[2]],
            [+extents[0], -extents[1], +extents[2]],
            [-extents[0], +extents[1], +extents[2]],
            [-extents[0], +extents[1], -extents[2]],
            [+extents[0], +extents[1], -extents[2]],
            [+extents[0], +extents[1], +extents[2]],
        ],
        texcoords: [[0, 0], [0, 1], [1, 1], [1, 0]],
    })) {
        let n = face.normal;
        let verts = [];
        for (let i = 0; i < 4; i++) {
            let v = face.positions[i];
            let t = face.texcoords[i];
            verts.push(builder.addVertex([v[0], v[1], v[2], t[0], t[1], n[0], n[1], n[2]]));
        }
        builder.addTri(verts[0], verts[2], verts[1]);
        builder.addTri(verts[1], verts[2], verts[3]);
    }
    return builder.build(device, material);
}