import { mat3, mat4, vec2, vec3 } from "gl-matrix";
import { AABB } from "../Geometry";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import {
    GfxBindingLayoutDescriptor,
    GfxBufferUsage,
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
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { MeshObject } from "./mesh";
import { Material } from "./material";
import { TotemNode } from "./node";
import { SIZE_VEC2, SIZE_VEC3 } from "./util";
import * as Viewer from '../viewer';
import { CameraController, computeViewMatrix } from "../Camera";
import { fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { preprocessProgramObj_GLSL } from "../gfx/shaderc/GfxShaderCompiler";
import {
    makeBackbufferDescSimple,
    pushAntialiasingPostProcessPass,
    standardFullClearRenderPassDescriptor
} from "../gfx/helpers/RenderGraphHelpers";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { Texture, TotemBitmap } from "./bitmap";
import { TextureMapping } from "../TextureHolder";
import { interpTrack, interpTrackInPlace, MaterialAnim } from "./materialanim";
import { lerp } from "../MathHelpers";
import { colorCopy, colorLerp, colorNewCopy } from "../Color";
import { precompute_lerp_vec2, precompute_lerp_vec3, precompute_surface_vec3, SurfaceObject } from "./surface";
import { nArray } from "../util";
import { hashCodeNumberFinish, hashCodeNumberUpdate, HashMap } from "../HashMap";
import { TotemSkin } from "./skin";
import { TotemLod } from "./lod";

class RotfdProgram {
    public static ub_SceneParams = 0;
    public static ub_MaterialParams = 1;
    public static SCENEPARAM_SIZE = 4*4;
    public static MATERIALPARAM_SIZE = 4*4 + 4 + 4 + 4*4;

    public both = `
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(std140) uniform ub_MaterialParams {
    Mat4x4 u_ModelView;
    vec4 u_Color;
    vec4 u_Emit;
    Mat4x4 u_TexTransform;
};

uniform sampler2D u_Texture;
`;

// TODO: lighting, reflection

    public vert: string = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec2 a_TexCoord;
layout(location = 2) in vec3 a_Normal;

out vec3 v_Normal;
out vec2 v_TexCoord;

void main() {
    mat3 realmat = mat3(
        u_TexTransform.mx.xyz,
        u_TexTransform.my.xyz,
        u_TexTransform.mz.xyz
    );
    gl_Position = Mul(u_Projection, Mul(u_ModelView, vec4(a_Position, 1.0)));
    v_Normal = normalize(a_Normal);
    v_TexCoord = (vec3(a_TexCoord.xy, 1.0) * realmat).xy;
}
`;

    public frag: string = `
in vec3 v_Normal;
in vec2 v_TexCoord;

void main() {
    gl_FragColor.rgba = u_Color;
    gl_FragColor *= texture(SAMPLER_2D(u_Texture), v_TexCoord);
    gl_FragColor.rgb += u_Emit.rgb;
}
`;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 1, },
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
        const usteps = 4;
        const vsteps = 4;
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

let bboxScratch = new AABB();
let modelViewScratch = mat4.create();
export class MeshRenderer {
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};

    constructor(
        private geometryData: VertexData,
        private material: Material,
        public modelMatrix: mat4,
        private textureMap: Map<number, Texture>,
    ) {
        this.megaStateFlags.frontFace = GfxFrontFaceMode.CW;
        this.megaStateFlags.cullMode = GfxCullMode.Back;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, sampler: GfxSampler) {
        bboxScratch.transform(this.geometryData.bbox, this.modelMatrix);
        if (!viewerInput.camera.frustum.contains(bboxScratch))
            return;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(this.geometryData.inputLayout, this.geometryData.inputState);
        const textureMapping = new TextureMapping();
        const texture = this.textureMap.get(this.material.texture_id);
        textureMapping.gfxTexture = texture ? texture.texture : null;
        textureMapping.gfxSampler = sampler;
        renderInst.setSamplerBindingsFromTextureMappings([ textureMapping ]);
        renderInst.setMegaStateFlags(this.megaStateFlags);

        let offs = renderInst.allocateUniformBuffer(RotfdProgram.ub_MaterialParams, RotfdProgram.MATERIALPARAM_SIZE);
        const d = renderInst.mapUniformBufferF32(RotfdProgram.ub_MaterialParams);
        computeViewMatrix(modelViewScratch, viewerInput.camera);
        mat4.mul(modelViewScratch, modelViewScratch, this.modelMatrix);
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
        renderInst.drawIndexes(this.geometryData.indexCount);
        renderInstManager.submitRenderInst(renderInst);
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

export class ROTFDRenderer implements Viewer.SceneGfx {
    private program: GfxProgramDescriptorSimple;
    public renderHelper: GfxRenderHelper;
    private meshes = new Map<number, MeshInfo>();
    private materials = new Map<number, Material>();
    private meshRenderers: MeshRenderer[] = [];
    private bitmaps = new Map<number, Texture>();
    private materialAnims: MaterialAnimInfo[] = [];
    public sampler: GfxSampler;
    private lods = new Map<number, LodInfo>();
    private skins = new Map<number, SkinInfo>();

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
                mat3.translate(tx, tx, [-0.5, -0.5]);
                mat3.translate(tx, tx, material.offset);
                mat3.scale(tx, tx, material.scale);
                mat3.rotate(tx, tx, material.rotation);
                mat3.translate(tx, tx, [0.5, 0.5]);
            }
        }
    }

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput, renderInstManager: GfxRenderInstManager) {
        // console.log(viewerInput.time * 60 * 1000);
        this.updateMaterialAnims(Math.floor(viewerInput.time * 60 / 1000));

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        const gfxProgram = renderInstManager.gfxRenderCache.createProgramSimple(this.program);
        template.setGfxProgram(gfxProgram);

        let offs = template.allocateUniformBuffer(RotfdProgram.ub_SceneParams, 16);
        const d = template.mapUniformBufferF32(RotfdProgram.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);

        for (const instance of this.meshRenderers) {
            instance.prepareToRender(renderInstManager, viewerInput, this.sampler);
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
                offset: [0, 0],
                reflection_id: 0,
                texture_id: 0,
                rotation: 0,
                scale: [0, 0],
                transform: mat3.create(),
                unk2: 0,
                unk4: undefined,
            };
        }
        else {
            material = {
                color: colorNewCopy(material.color),
                emission: colorNewCopy(material.emission),
                unk2: material.unk2,
                transform: mat3.clone(material.transform),
                rotation: material.rotation,
                offset: vec2.clone(material.offset),
                scale: vec2.clone(material.scale),
                unk4: undefined,
                texture_id: material.texture_id,
                reflection_id: material.reflection_id,
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

    private addMeshInfo(node: TotemNode, meshInfo: MeshInfo) {
        const transform = node.global_transform;
        for (const mesh of meshInfo.meshes) {
            let material = this.materials.get(mesh.material_id);
            if (material === undefined) {
                // use a default material for now, might search node data?
                material = {
                    color: {r: 1, g: 1, b: 1, a: 1},
                    emission: {r: 0, g: 0, b: 0, a: 0},
                    offset: [0, 0],
                    reflection_id: 0,
                    texture_id: 0,
                    rotation: 0,
                    scale: [0, 0],
                    transform: mat3.create(),
                    unk2: 0,
                    unk4: undefined,
                };
            }
            const renderer = new MeshRenderer(mesh, material, transform, this.bitmaps);
            this.meshRenderers.push(renderer);
        }
    }

    addMeshNode(node: TotemNode, resid: number = node.resource_id) {
        const meshInfo = this.meshes.get(resid);
        if (meshInfo === undefined) {
            console.log(`NO MESH ${resid}`);
            return;
        }
        this.addMeshInfo(node, meshInfo);
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
                this.addMeshInfo(node, meshInfo);
            }
            else if (this.skins.has(index)) {
                this.addSkinNode(node, index);
            }
            else {
                console.log("UNRECOGNIZED NODE LOD", node, resid);
            }
        }
    }
}