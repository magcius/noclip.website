import { mat4, ReadonlyMat4, vec3 } from "gl-matrix";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { fillMatrix4x3, fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBufferFrequencyHint, GfxBufferUsage, GfxCompareMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgram, GfxTexFilterMode, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { Destroyable } from "../SceneBase";
import { ViewerRenderInput } from "../viewer";
import { computeModelMatrixSRT } from "../MathHelpers";
import { Layer } from "../ui";
import { DreamDropShader } from "./shader";
import { computeViewMatrix, computeViewMatrixSkybox } from "../Camera";
import { LuxMaterialInstance, LuxModel, LuxModelFlagRenderMode, LuxShape, LuxShapeAttributeBlend, LuxTexture } from "./lux";
import { BBSModel, BBSPMP } from "./bin_bbs";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxRendererLayer, makeSortKeyOpaque } from "../gfx/render/GfxRenderInstManager";

const FRAME_TIME = 0.03;
const WORLD_SCALE = 200.0;
const BINDING_LAYOUTS: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 3, numSamplers: 1 }];
const SCRATCH_MVP = mat4.create();
const SCRATCH_VIEW = mat4.create();

function getShortNibble(n: number, nibble: number): number {
    return (n >> ((3 - nibble) * 4)) & 15;
}

/**
 * Returns shift matrix based on given SRT and {@link WORLD_SCALE}. The SRT must be the instance SRT - baked SRT is handled by the model renderer. Rotation is assumed to be in radians
 */
function computeShiftMatrix(scale: vec3, rotation: vec3, position: vec3) {
    const srt = mat4.create();
    computeModelMatrixSRT(srt,
        scale[0] * WORLD_SCALE, scale[1] * WORLD_SCALE, scale[2] * WORLD_SCALE,
        rotation[0], rotation[1], rotation[2],
        position[0] * WORLD_SCALE, position[1] * WORLD_SCALE, position[2] * WORLD_SCALE
    );
    return srt;
}

export class BBSRoomRenderer implements Destroyable {
    public parts: ModelRenderer[];

    constructor(cache: GfxRenderCache, pmp: BBSPMP, textures: LuxTexture[]) {
        const gfxSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat
        });

        this.parts = Array(pmp.pmos.length);
        for (let i = 0; i < pmp.pmos.length; i++) {
            const info = pmp.pmos[i];
            const model = info.pmo as BBSModel;
            const materials: LuxMaterialInstance[] = [];
            for (let textureName of model.textureNames) {
                const i = pmp.tims.findIndex(t => t.name === textureName);
                if (i >= 0) {
                    const tim = pmp.tims[i];
                    materials.push(new LuxMaterialInstance({ textureName: tim.name, scrollX: tim.scrollX, scrollY: tim.scrollY, textureOffset: 0 }, [textures[i]], gfxSampler));
                }
            }
            this.parts[i] = new ModelRenderer(cache, model.name, model, materials);
            this.parts[i].shiftMatrices = [computeShiftMatrix(info.scale, info.rotation, info.position)];
        }
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput) {
        const template = renderHelper.renderInstManager.pushTemplate();

        template.setBindingLayouts(BINDING_LAYOUTS);
        template.setUniformBuffer(renderHelper.uniformBuffer);

        let offset = template.allocateUniformBuffer(DreamDropShader.ub_SceneParams, 17);
        const uniformBuffer = template.mapUniformBufferF32(DreamDropShader.ub_SceneParams);
        // u_Projection (16)
        offset += fillMatrix4x4(uniformBuffer, offset, viewerInput.camera.projectionMatrix);
        // u_Time (1)
        uniformBuffer[offset++] = viewerInput.time * FRAME_TIME;

        for (let i = 0; i < this.parts.length; i++) {
            if (this.parts[i].visible) {
                this.parts[i].prepareToRender(device, renderHelper, viewerInput);
            }
        }

        renderHelper.renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice) {
        for (const mr of this.parts) {
            mr.destroy(device);
        }
    }
}

class ModelRenderer implements Destroyable, Layer {
    public name: string;
    public visible: boolean = true;
    public bboxPoints: Float32Array;
    public shiftMatrices: mat4[] = [];
    private shapes: ShapeRenderer[];
    private isSkybox: boolean;

    constructor(cache: GfxRenderCache, name: string, model: LuxModel, materials: LuxMaterialInstance[]) {
        // console.log(model.name, model.pmpFlags.toString(16).padStart(4, "0"), "-", model.shapes.map(s => s.attribute.toString(16).padStart(4, "0")).join(" "));
        this.name = name;
        const modeNibble = getShortNibble(model.pmpFlags, 3);
        this.isSkybox = model.pmpFlags !== -1 && (modeNibble === LuxModelFlagRenderMode.SKYBOX || modeNibble === LuxModelFlagRenderMode.SKYBOX2);
        this.shapes = Array(model.shapes.length);
        for (let i = 0; i < model.shapes.length; i++) {
            const shape = model.shapes[i];
            this.shapes[i] = new ShapeRenderer(cache, shape, model.scale, materials[shape.textureIndex], this.isSkybox);
        }
        this.bboxPoints = new Float32Array(model.bbox.map(p => p * model.scale));
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput) {
        const template = renderHelper.renderInstManager.pushTemplate();

        for (const shiftMatrix of this.shiftMatrices) {
            if (!this.isSkybox) {
                mat4.mul(SCRATCH_MVP, viewerInput.camera.clipFromWorldMatrix, shiftMatrix);
                if (!this.inView(this.bboxPoints, SCRATCH_MVP)) {
                    continue;
                }
            }

            let offset = template.allocateUniformBuffer(DreamDropShader.ub_ModelParams, 12);
            const d = template.mapUniformBufferF32(DreamDropShader.ub_ModelParams);
            // u_View (12)
            if (this.isSkybox) {
                computeViewMatrixSkybox(SCRATCH_VIEW, viewerInput.camera);
            } else {
                computeViewMatrix(SCRATCH_VIEW, viewerInput.camera);
            }
            mat4.mul(SCRATCH_VIEW, SCRATCH_VIEW, shiftMatrix);
            offset += fillMatrix4x3(d, offset, SCRATCH_VIEW);

            for (const shape of this.shapes) {
                shape.prepareToRender(renderHelper);
            }
        }

        renderHelper.renderInstManager.popTemplate();
    }

    public setVisible(v: boolean): void {
        this.visible = v;
    }

    public destroy(device: GfxDevice): void {
        for (const shape of this.shapes) {
            shape.destroy(device);
        }
    }

    private inView(bbox: Float32Array, m: ReadonlyMat4) {
        let aol = true, aor = true;
        let aob = true, aot = true;
        let aon = true, aof = true;
        for (let i = 0; i < 32; i += 4) {
            const x = bbox[i], y = bbox[i + 1], z = bbox[i + 2];
            const xw = x * m[0] + y * m[4] + z * m[8] + m[12];
            const yw = x * m[1] + y * m[5] + z * m[9] + m[13];
            const zw = x * m[2] + y * m[6] + z * m[10] + m[14];
            const ww = x * m[3] + y * m[7] + z * m[11] + m[15];
            if (xw >= -ww && xw <= ww && yw >= -ww && yw <= ww && zw >= 0 && zw <= ww) {
                return true;
            }
            if (xw > -ww) aol = false;
            if (xw < ww) aor = false;
            if (yw > -ww) aob = false;
            if (yw < ww) aot = false;
            if (zw > 0) aon = false;
            if (zw < ww) aof = false;
        }
        if (aol || aor || aob || aot || aon || aof) {
            return false;
        }
        return true;
    }
}

class ShapeRenderer implements Destroyable {
    private sortKey: number;
    private drawCount: number;
    private gfxProgram: GfxProgram;
    private gfxInputLayout: GfxInputLayout;
    private indexBufferDescriptor: GfxIndexBufferDescriptor;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    constructor(cache: GfxRenderCache, shape: LuxShape, scale: number, private material: LuxMaterialInstance, private isSkybox: boolean) {
        const blend = getShortNibble(shape.attribute, 2);
        const isTranslucent = blend === LuxShapeAttributeBlend.TRANSLUCENT || blend === LuxShapeAttributeBlend.TRANSLUCENT2;
        const additiveBlend = blend === LuxShapeAttributeBlend.ADDITIVE || blend === LuxShapeAttributeBlend.ADDITIVE2;
        const transparent = isTranslucent || additiveBlend;
        this.megaStateFlags = {
            depthWrite: !transparent
        };
        if (transparent) {
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: additiveBlend ? GfxBlendFactor.One : GfxBlendFactor.OneMinusSrcAlpha,
            });
        }
        if (this.isSkybox) {
            this.megaStateFlags.depthWrite = false;
            this.megaStateFlags.depthCompare = GfxCompareMode.Always;
        }
        this.sortKey = makeSortKeyOpaque(transparent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE, 0);
        const inVertexAttributeDescriptors = [
            { location: DreamDropShader.a_Position, bufferIndex: DreamDropShader.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },
            { location: DreamDropShader.a_Color, bufferIndex: DreamDropShader.a_Color, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 },
            { location: DreamDropShader.a_UV, bufferIndex: DreamDropShader.a_UV, format: GfxFormat.F32_RG, bufferByteOffset: 0 },
        ];
        const inVertexBufferDescriptors = [
            { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 16, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 8, frequency: GfxVertexBufferFrequency.PerVertex }
        ];
        this.vertexBufferDescriptors = [
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, shape.vertices.map(v => v * scale).buffer), byteOffset: 0 },
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, shape.colors.buffer), byteOffset: 0 },
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, shape.uvs.buffer), byteOffset: 0 }
        ];

        this.gfxProgram = cache.createProgram(new DreamDropShader(this.vertexBufferDescriptors.length, 0));
        this.gfxInputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: inVertexAttributeDescriptors,
            vertexBufferDescriptors: inVertexBufferDescriptors,
            indexBufferFormat: GfxFormat.U32_R
        });
        this.drawCount = shape.indices.length;
        this.indexBufferDescriptor = { buffer: createBufferFromData(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, shape.indices.buffer), byteOffset: 0 };
    }

    public prepareToRender(renderHelper: GfxRenderHelper) {
        const renderInst = renderHelper.renderInstManager.newRenderInst();

        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setVertexInput(this.gfxInputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);
        let offset = renderInst.allocateUniformBuffer(DreamDropShader.ub_ShapeParams, 3);
        const d = renderInst.mapUniformBufferF32(DreamDropShader.ub_ShapeParams);
        // u_Scroll (2)
        d[offset++] = this.material ? this.material.scrollX : 0.0;
        d[offset++] = this.material ? this.material.scrollY : 0.0;
        // u_HasTexture (1)
        d[offset++] = this.material ? 1.0 : 0.0;

        if (this.material) {
            renderInst.setSamplerBindingsFromTextureMappings(this.material.textureMappings[0]);
        }
        renderInst.setMegaStateFlags(this.megaStateFlags);
        if (!this.isSkybox) {
            renderInst.sortKey = this.sortKey;
        }
        renderInst.setDrawCount(this.drawCount);

        renderHelper.renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBufferDescriptor.buffer);
        for (const d of this.vertexBufferDescriptors) {
            device.destroyBuffer(d.buffer);
        }
    }
}
