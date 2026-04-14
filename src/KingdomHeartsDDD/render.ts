import { mat4 } from "gl-matrix";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBufferFrequencyHint, GfxBufferUsage, GfxCompareMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { DeviceProgram } from "../Program";
import { Destroyable } from "../SceneBase";
import { ViewerRenderInput } from "../viewer";
import { DreamDropPMO, DreamDropPMOMaterial, DreamDropPMOShape, DreamDropShapeAttributeBlend } from "./bin";
import { computeModelMatrixSRT } from "../MathHelpers";
import { DreamDropTexture } from "./texture";
import { GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { DreamDropRoomConfig } from "./room_config";
import { Layer } from "../ui";
import { TextureMapping } from "../TextureHolder";

class Shader extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_UV = 2;
    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;
    public static ub_ShapeParams = 2;

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    float u_Time;
};

layout(std140) uniform ub_ModelParams {
    Mat4x4 u_Shift;
};

layout(std140) uniform ub_ShapeParams {
    vec2 u_Scroll;
    float u_HasTexture;
};

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_UV;

#ifdef VERT
layout(location = ${Shader.a_Position}) in vec3 a_Position;
layout(location = ${Shader.a_Color}) in vec4 a_Color;
layout(location = ${Shader.a_UV}) in vec2 a_UV;

void main() {
    v_Color = a_Color;
    v_UV = a_UV + (u_Time * u_Scroll);
    gl_Position = UnpackMatrix(u_Projection) * UnpackMatrix(u_Shift) * vec4(a_Position, 1.0);
}
#endif

#ifdef FRAG
void main() {
    if (u_HasTexture > 0.1) {
        vec4 color = texture(SAMPLER_2D(u_Texture), v_UV);
        if (color.a < 0.1) {
            discard;
        }
        vec3 ambient = vec3(0.075);
        color *= vec4(clamp(v_Color.xyz + ambient, 0.0, 1.0), 1.0);
        gl_FragColor = color;
    } else {
        gl_FragColor = v_Color;
    }
}
#endif
    `;
}

const FRAME_TIME = 0.03;
const WORLD_SCALE = 200.0;
const BINDING_LAYOUTS: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 3, numSamplers: 1 }];
const SCRATCH_SKY_MAT = mat4.create();
const SCRATCH_CLIP = mat4.create();
const SCRATCH_MVP = mat4.create();

function getShortNibble(n: number, nibble: number): number {
    return (n >> ((3 - nibble) * 4)) & 15;
}

function computeShiftMatrix(model: DreamDropPMO) {
    const srt = mat4.create();
    computeModelMatrixSRT(srt,
        model.scale[0] * WORLD_SCALE, model.scale[1] * WORLD_SCALE, model.scale[2] * WORLD_SCALE,
        model.rotation[0], model.rotation[1], model.rotation[2],
        model.position[0] * WORLD_SCALE, model.position[1] * WORLD_SCALE, model.position[2] * WORLD_SCALE
    );
    return srt;
}

/**
 * Renderer for a room from _Kingdom Hearts 3D: Dream Drop Distance_
 */
export class DreamDropRoomRenderer implements Destroyable {
    public parts: ModelRenderer[];
    private partIndices: number[];
    private skyPartIndices: number[];
    private gfxInputLayout: GfxInputLayout;
    private gfxProgram: GfxProgram;

    constructor(cache: GfxRenderCache, pmos: DreamDropPMO[], textures: DreamDropTexture[], config: DreamDropRoomConfig | undefined) {
        const gfxSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat
        });
        this.gfxInputLayout = cache.createInputLayout({
            vertexAttributeDescriptors: [
                { location: Shader.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },
                { location: Shader.a_Color, bufferIndex: 1, format: GfxFormat.F32_RGBA, bufferByteOffset: 0 },
                { location: Shader.a_UV, bufferIndex: 2, format: GfxFormat.F32_RG, bufferByteOffset: 0 },
            ],
            vertexBufferDescriptors: [
                { byteStride: 12, frequency: GfxVertexBufferFrequency.PerVertex },
                { byteStride: 16, frequency: GfxVertexBufferFrequency.PerVertex },
                { byteStride: 8, frequency: GfxVertexBufferFrequency.PerVertex }
            ],
            indexBufferFormat: GfxFormat.U32_R
        });
        this.gfxProgram = cache.createProgram(new Shader());

        this.parts = Array(pmos.length);
        this.partIndices = [];
        this.skyPartIndices = [];
        for (let i = 0; i < pmos.length; i++) {
            const model = pmos[i];
            const materials: MaterialInstance[] = Array(model.materials.length);
            for (let j = 0; j < model.materials.length; j++) {
                const t = textures.find(texture => texture.name === model.materials[j].textureName);
                if (t) {
                    materials[j] = new MaterialInstance(model.materials[j], t, gfxSampler);
                }
            }
            const isSkyBox = config && config.skyBoxIds && config.skyBoxIds.includes(model.id);
            if (isSkyBox) {
                this.skyPartIndices.push(i);
            } else {
                this.partIndices.push(i);
            }
            this.parts[i] = new ModelRenderer(cache, model, materials, `part${i}_${model.id}`, isSkyBox);
        }
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, viewerInput: ViewerRenderInput) {
        const template = renderHelper.renderInstManager.pushTemplate();

        template.setGfxProgram(this.gfxProgram);
        template.setBindingLayouts(BINDING_LAYOUTS);
        template.setUniformBuffer(renderHelper.uniformBuffer);

        if (this.skyPartIndices.length > 0) {
            const skyTemplate = renderHelper.renderInstManager.pushTemplate();

            let skyOffset = skyTemplate.allocateUniformBuffer(Shader.ub_SceneParams, 17);
            const skyUniformBuffer = skyTemplate.mapUniformBufferF32(Shader.ub_SceneParams);
            mat4.copy(SCRATCH_SKY_MAT, viewerInput.camera.viewMatrix);
            SCRATCH_SKY_MAT[12] = 0;
            SCRATCH_SKY_MAT[13] = 0;
            SCRATCH_SKY_MAT[14] = 0;
            mat4.mul(SCRATCH_CLIP, viewerInput.camera.projectionMatrix, SCRATCH_SKY_MAT);
            // u_Projection (16)
            skyOffset += fillMatrix4x4(skyUniformBuffer, skyOffset, SCRATCH_CLIP);
            // u_Time (1)
            skyUniformBuffer[skyOffset++] = viewerInput.time * FRAME_TIME;

            for (const spi of this.skyPartIndices) {
                if (this.parts[spi].visible) {
                    this.parts[spi].prepareToRender(device, renderHelper, this.gfxInputLayout);
                }
            }

            renderHelper.renderInstManager.popTemplate();
        }

        let offset = template.allocateUniformBuffer(Shader.ub_SceneParams, 17);
        const uniformBuffer = template.mapUniformBufferF32(Shader.ub_SceneParams);
        // u_Projection (16)
        offset += fillMatrix4x4(uniformBuffer, offset, viewerInput.camera.clipFromWorldMatrix);
        // u_Time (1)
        uniformBuffer[offset++] = viewerInput.time * FRAME_TIME;

        for (const i of this.partIndices) {
            if (this.parts[i].visible) {
                const m = SCRATCH_MVP;
                mat4.mul(m, viewerInput.camera.clipFromWorldMatrix, this.parts[i].shiftMatrix);
                if (this.partInView(this.parts[i].bbox, m)) {
                    this.parts[i].prepareToRender(device, renderHelper, this.gfxInputLayout);
                }
            }
        }

        renderHelper.renderInstManager.popTemplate();
    }

    /**
     * More efficient frustum culling with 8-point bbox
     */
    private partInView(bbox: Float32Array, m: mat4) {
        let allOutsideLeft = true, allOutsideRight = true;
        let allOutsideBottom = true, allOutsideTop = true;
        let allOutsideNear = true, allOutsideFar = true;
        for (let i = 0; i < 32; i += 4) {
            const x = bbox[i], y = bbox[i + 1], z = bbox[i + 2];
            const xw = x * m[0] + y * m[4] + z * m[8] + m[12];
            const yw = x * m[1] + y * m[5] + z * m[9] + m[13];
            const zw = x * m[2] + y * m[6] + z * m[10] + m[14];
            const ww = x * m[3] + y * m[7] + z * m[11] + m[15];
            if (xw >= -ww && xw <= ww && yw >= -ww && yw <= ww && zw >= 0 && zw <= ww) {
                return true;
            }
            if (xw > -ww) allOutsideLeft = false;
            if (xw < ww) allOutsideRight = false;
            if (yw > -ww) allOutsideBottom = false;
            if (yw < ww) allOutsideTop = false;
            if (zw > 0) allOutsideNear = false;
            if (zw < ww) allOutsideFar = false;
        }
        if (allOutsideLeft || allOutsideRight || allOutsideBottom || allOutsideTop || allOutsideNear || allOutsideFar) {
            return false;
        }
        return true;
    }

    public destroy(device: GfxDevice) {
        for (const part of this.parts) {
            part.destroy(device);
        }
    }
}

class ModelRenderer implements Destroyable, Layer {
    public name: string;
    public visible: boolean = true;
    public bbox: Float32Array;
    public shiftMatrix: mat4;
    private shapes: ShapeRenderer[];

    constructor(cache: GfxRenderCache, model: DreamDropPMO, materials: MaterialInstance[], name: string, isSkyBox: boolean = false) {
        // console.log(model.id, model.shapes.map(s => s.attribute.toString(16).padStart(4, "0")).join(" "));
        this.name = name;
        this.shapes = Array(model.shapes.length);
        for (let i = 0; i < model.shapes.length; i++) {
            const s = model.shapes[i];
            this.shapes[i] = new ShapeRenderer(cache, s, materials[s.textureIndex], isSkyBox);
        }
        this.shiftMatrix = computeShiftMatrix(model);
        this.bbox = new Float32Array(model.bbox);
    }

    public prepareToRender(device: GfxDevice, renderHelper: GfxRenderHelper, gfxInputLayout: GfxInputLayout) {
        const template = renderHelper.renderInstManager.pushTemplate();

        let offset = template.allocateUniformBuffer(Shader.ub_ModelParams, 16);
        const uniformBuffer = template.mapUniformBufferF32(Shader.ub_ModelParams);
        // u_Shift (16)
        offset += fillMatrix4x4(uniformBuffer, offset, this.shiftMatrix);

        for (const shape of this.shapes) {
            shape.prepareToRender(renderHelper, gfxInputLayout);
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
}

class MaterialInstance {
    public scrollX: number;
    public scrollY: number;
    public textureMapping: TextureMapping[];

    constructor(material: DreamDropPMOMaterial, texture: DreamDropTexture, gfxSampler: GfxSampler) {
        this.scrollX = material.scrollX;
        this.scrollY = material.scrollY;
        this.textureMapping = [new TextureMapping()];
        this.textureMapping[0].gfxTexture = texture.gfxTexture;
        this.textureMapping[0].gfxSampler = gfxSampler;
    }
}

class ShapeRenderer implements Destroyable {
    public sortKey: number;
    private drawCount: number;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private indexBufferDescriptor: GfxIndexBufferDescriptor;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];

    constructor(cache: GfxRenderCache, shape: DreamDropPMOShape, private material: MaterialInstance, private isSkyBox: boolean = false) {
        const blendByte = getShortNibble(shape.attribute, 2);
        const isTranslucent = blendByte === DreamDropShapeAttributeBlend.TRANSLUCENT || blendByte === DreamDropShapeAttributeBlend.TRANSLUCENT2;
        const additiveBlend = blendByte === DreamDropShapeAttributeBlend.ADDITIVE;
        const transparent = isTranslucent || additiveBlend;
        this.megaStateFlags = {
            depthWrite: !transparent
        };
        if (transparent) {
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.Add, blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: additiveBlend ? GfxBlendFactor.One : GfxBlendFactor.OneMinusSrcAlpha,
            });
        }
        if (isSkyBox) {
            this.megaStateFlags.depthWrite = false;
            this.megaStateFlags.depthCompare = GfxCompareMode.Always;
        }
        this.sortKey = makeSortKey(transparent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE);

        this.drawCount = shape.indices.length;
        this.indexBufferDescriptor = { buffer: createBufferFromData(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, shape.indices.buffer), byteOffset: 0 };
        this.vertexBufferDescriptors = [
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, shape.vertices.buffer), byteOffset: 0 },
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, shape.colors.buffer), byteOffset: 0 },
            { buffer: createBufferFromData(cache.device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, shape.uvs.buffer), byteOffset: 0 }
        ];
    }

    public prepareToRender(renderHelper: GfxRenderHelper, gfxInputLayout: GfxInputLayout) {
        const renderInst = renderHelper.renderInstManager.newRenderInst();

        renderInst.setVertexInput(gfxInputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);
        let o = renderInst.allocateUniformBuffer(Shader.ub_ShapeParams, 3);
        const d = renderInst.mapUniformBufferF32(Shader.ub_ShapeParams);
        
        if (this.material) {
            d[o++] = this.material.scrollX;
            d[o++] = this.material.scrollY;
            d[o++] = 1.0;
            renderInst.setSamplerBindingsFromTextureMappings(this.material.textureMapping);
        } else {
            d[o++] = 0.0;
            d[o++] = 0.0;
            d[o++] = 0.0;
        }
        renderInst.setMegaStateFlags(this.megaStateFlags);
        if (!this.isSkyBox) {
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
