import { mat3, mat4 } from "gl-matrix";
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
import { nArray } from "../util";
import { TextureMapping } from "../TextureHolder";

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
    gl_FragColor += u_Emit;
}
`;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 1, },
];

export class VertexData {
    public vertexBuffer: GfxBuffer;
    // public uvBuffer: GfxBuffer;
    // public normalBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public bbox = new AABB();
    public indexCount: number;
    public material_id: number;

    constructor(device: GfxDevice, public mesh: MeshObject, material_index: number) {
        this.material_id = mesh.materials[material_index];
        // convert strips to single index buffer, and convert indices to single index
        // TODO: maybe make more efficient by storing some kind of (vert, uv, norm) => index map?
        let indices: number[] = [];
        let vertices: number[] = [];
        let cidx = 0;
        for (const strip of this.mesh.strips) {
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
                    for (const value of mesh.vertices[strip.elements[j][0]]) {
                        vertices.push(value);
                    }
                    for (const value of mesh.texcoords[strip.elements[j][1]]) {
                        vertices.push(value);
                    }
                    for (const value of mesh.normals[strip.elements[j][2]]) {
                        vertices.push(value);
                    }
                    indices.push(cidx);
                    cidx += 1;
                }
            }
        }
        this.indexCount = indices.length;
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, new Uint16Array(indices).buffer);
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, new Float32Array(vertices).buffer);
        this.bbox.setFromPoints(this.mesh.vertices);

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

export class ROTFDRenderer implements Viewer.SceneGfx {
    private program: GfxProgramDescriptorSimple;
    public renderHelper: GfxRenderHelper;
    private meshes = new Map<number, MeshInfo>();
    private materials = new Map<number, Material>();
    private meshRenderers: MeshRenderer[] = [];
    private bitmaps = new Map<number, Texture>();
    public sampler: GfxSampler;

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
        c.setSceneMoveSpeedMult(1/24);
    }

    onstatechanged() {

    }

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput, renderInstManager: GfxRenderInstManager) {
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
    }

    addMesh(id: number, mesh: MeshObject) {
        let meshes: VertexData[] = [];
        for (let i = 0; i < mesh.materials.length; i++) {
            meshes.push(new VertexData(this.device, mesh, i));
        }
        this.meshes.set(id, {
            meshes
        });
    }

    addBitmap(id: number, bitmap: TotemBitmap) {
        this.bitmaps.set(id, new Texture(id, bitmap, this.device));
    }

    addMaterial(id: number, material: Material) {
        this.materials.set(id, material);
    }

    addMeshNode(node: TotemNode) {
        const meshInfo = this.meshes.get(node.resource_id);
        if (meshInfo === undefined) {
            return;
        }
        const transform = node.global_transform;
        // use a default material for now
        for (const mesh of meshInfo.meshes) {
            let material = this.materials.get(mesh.material_id);
            if (material === undefined) {
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
}