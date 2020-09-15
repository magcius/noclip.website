
import { GfxDevice, GfxBuffer, GfxInputState, GfxInputLayout, GfxFormat, GfxVertexBufferFrequency, GfxVertexAttributeDescriptor, GfxBufferUsage, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxCullMode, GfxCompareMode, makeTextureDescriptor2D, GfxProgram, GfxMegaStateDescriptor, GfxBlendMode, GfxBlendFactor, GfxInputLayoutBufferDescriptor, GfxTexture } from "../gfx/platform/GfxPlatform";
import { DrawCall, GSConfiguration, LevelModel, LevelPart, Texture } from "./bin";
import { DeviceProgram } from "../Program";
import * as Viewer from "../viewer";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { mat4, vec3 } from "gl-matrix";
import { fillMatrix4x3, fillMatrix4x2 } from "../gfx/helpers/UniformBufferHelpers";
import { TextureMapping } from "../TextureHolder";
import { nArray, assert, hexzero } from "../util";
import { GfxRenderInstManager, GfxRendererLayer } from "../gfx/render/GfxRenderer";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers";
import { GSAlphaCompareMode, GSAlphaFailMode, GSTextureFunction, GSDepthCompareMode, GSTextureFilter, psmToString, GSWrapMode } from "../Common/PS2/GS";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { AABB } from "../Geometry";

export class FFXProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;
    public static a_Extra = 3;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;

    public both = `
precision mediump float;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(row_major, std140) uniform ub_ModelParams {
    Mat4x3 u_BoneMatrix;
    Mat4x3 u_NormalMatrix;
    Mat4x2 u_TextureMatrix;
};

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_TexCoord;
`;

    public vert = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec2 a_TexCoord;
layout(location = 3) in vec4 a_Extra;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix), vec4(a_Position.xyz, 1.0)));
    v_Color = a_Color;
    v_TexCoord = Mul(_Mat4x4(u_TextureMatrix), vec4(a_TexCoord, 0.0, 1.0)).xy;
}
`;

    constructor(gsConfiguration: GSConfiguration) {
        super();
        this.frag = this.generateFrag(gsConfiguration);
    }

    private generateAlphaCompareOp(atst: GSAlphaCompareMode, lhs: string, rhs: string): string {
        switch (atst) {
            case GSAlphaCompareMode.ALWAYS: return `true`;
            case GSAlphaCompareMode.NEVER: return `false`;
            case GSAlphaCompareMode.LESS: return `${lhs} < ${rhs}`;
            case GSAlphaCompareMode.LEQUAL: return `${lhs} <= ${rhs}`;
            case GSAlphaCompareMode.EQUAL: return `${lhs} == ${rhs}`;
            case GSAlphaCompareMode.GEQUAL: return `${lhs} >= ${rhs}`;
            case GSAlphaCompareMode.GREATER: return `${lhs} > ${rhs}`;
            case GSAlphaCompareMode.NOTEQUAL: return `${lhs} != ${rhs}`;
        }
    }

    private generateAlphaTest(ate: boolean, atst: GSAlphaCompareMode, aref: number, afail: GSAlphaFailMode): string {
        const floatRef = aref / 0xFF;
        const cmp = this.generateAlphaCompareOp(atst, `t_Color.a`, floatRef.toFixed(5));

        if (ate && afail === 0x00) {
            return `
    if (!(${cmp}))
        discard;
`;
        } else {
            return '';
        }
    }

    private generateFrag(gsConfiguration: GSConfiguration): string {
        assert(gsConfiguration.tex0.tfx === GSTextureFunction.MODULATE);

        // Contains depth & alpha test settings.
        const ate = !!((gsConfiguration.test_1_data0 >>> 0) & 0x01);
        const atst = (gsConfiguration.test_1_data0 >>> 1) & 0x07;
        const aref = (gsConfiguration.test_1_data0 >>> 4) & 0xFF;
        const afail = (gsConfiguration.test_1_data0 >>> 12) & 0x03;
        const date = !!((gsConfiguration.test_1_data0 >>> 14) & 0x01);
        const datm = !!((gsConfiguration.test_1_data0 >>> 15) & 0x01);

        return `
void main() {
    vec4 t_Color = v_Color;

${this.generateAlphaTest(ate, atst, aref, afail)}

    gl_FragColor = t_Color;
}
`;
    }
}

export class LevelModelData {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;

    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;

    constructor(device: GfxDevice, cache: GfxRenderCache, public model: LevelModel) {
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, this.model.vertexData.buffer as ArrayBuffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, this.model.indexData.buffer as ArrayBuffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: FFXProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0 * 4, format: GfxFormat.F32_RGB },
            { location: FFXProgram.a_Color, bufferIndex: 0, bufferByteOffset: 3 * 4, format: GfxFormat.F32_RGBA },
            { location: FFXProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 7 * 4, format: GfxFormat.F32_RG },
            { location: FFXProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 9 * 4, format: GfxFormat.F32_RGBA },
        ];
        const VERTEX_STRIDE = 3 + 4 + 2 + 4;
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: VERTEX_STRIDE * 4, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;

        this.inputLayout = cache.createInputLayout(device, { vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0 });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputState(this.inputState);
    }
}

function translateWrapMode(wm: GSWrapMode): GfxWrapMode {
    switch (wm) {
        case GSWrapMode.REPEAT: return GfxWrapMode.REPEAT;
        case GSWrapMode.CLAMP: return GfxWrapMode.CLAMP;
        // TODO(jstpierre): Support REGION_* clamp modes.
        case GSWrapMode.REGION_REPEAT: return GfxWrapMode.REPEAT;
        default: throw "whoops";
    }
}

function translateDepthCompareMode(cmp: GSDepthCompareMode): GfxCompareMode {
    switch (cmp) {
        case GSDepthCompareMode.NEVER: return GfxCompareMode.NEVER;
        case GSDepthCompareMode.ALWAYS: return GfxCompareMode.ALWAYS;
        // We use a LESS-style depth buffer.
        case GSDepthCompareMode.GEQUAL: return GfxCompareMode.LEQUAL;
        case GSDepthCompareMode.GREATER: return GfxCompareMode.LESS;
    }
}

function translateTextureFilter(filter: GSTextureFilter): [GfxTexFilterMode, GfxMipFilterMode] {
    switch (filter) {
        case GSTextureFilter.NEAREST:
            return [GfxTexFilterMode.POINT, GfxMipFilterMode.NO_MIP];
        case GSTextureFilter.LINEAR:
            return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NO_MIP];
        case GSTextureFilter.NEAREST_MIPMAP_NEAREST:
            return [GfxTexFilterMode.POINT, GfxMipFilterMode.NEAREST];
        case GSTextureFilter.NEAREST_MIPMAP_LINEAR:
            return [GfxTexFilterMode.POINT, GfxMipFilterMode.LINEAR];
        case GSTextureFilter.LINEAR_MIPMAP_NEAREST:
            return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NEAREST];
        case GSTextureFilter.LINEAR_MIPMAP_LINEAR:
            return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.LINEAR];
        default: throw new Error();
    }
}

export class DrawCallInstance {
    private gfxProgram: GfxProgram;
    private textureMapping = nArray(1, () => new TextureMapping());
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    public alphaMultiplier = 1;

    constructor(device: GfxDevice, cache: GfxRenderCache, public drawCall: DrawCall, public transformCount = 1) {
        const gsConfiguration = this.drawCall.gsConfiguration!;

        const program = new FFXProgram(gsConfiguration);
        this.gfxProgram = cache.createProgram(device, program);

        const zte = !!((gsConfiguration.test_1_data0 >>> 16) & 0x01);
        const ztst: GSDepthCompareMode = (gsConfiguration!.test_1_data0 >>> 17) & 0x03;
        assert(zte);

        this.megaStateFlags = {
            depthCompare: reverseDepthForCompareMode(translateDepthCompareMode(ztst)),
        };

        if (gsConfiguration.alpha_1_data0 === 0x44) {
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            });
        } else if (gsConfiguration.alpha_1_data0 === 0x48) {
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                blendDstFactor: GfxBlendFactor.ONE,
            });
        } else {
            throw `unknown alpha blend setting ${hexzero(gsConfiguration.alpha_1_data0, 2)}`;
        }

        // const lcm = (gsConfiguration.tex1_1_data0 >>> 0) & 0x01;
        // const mxl = (gsConfiguration.tex1_1_data0 >>> 2) & 0x07;
        // assert(lcm === 0x00);
        // assert(mxl === 0x00);

        // const texMagFilter: GSTextureFilter = (gsConfiguration.tex1_1_data0 >>> 5) & 0x01;
        // const texMinFilter: GSTextureFilter = (gsConfiguration.tex1_1_data0 >>> 6) & 0x07;
        // const [magFilter] = translateTextureFilter(texMagFilter);
        // const [minFilter, mipFilter] = translateTextureFilter(texMinFilter);

        // const wrapS = translateWrapMode(gsConfiguration.clamp.wms);
        // const wrapT = translateWrapMode(gsConfiguration.clamp.wmt);

        // this.textureMapping[0].gfxSampler = cache.createSampler(device, {
        //     minFilter, magFilter, mipFilter,
        //     wrapS, wrapT,
        //     minLOD: 0, maxLOD: 100,
        // });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, modelMatrix: mat4, modelViewMatrix: mat4, textureMatrix: mat4): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);

        renderInst.drawIndexes(this.drawCall.indexCount, this.drawCall.indexOffset);

        let offs = renderInst.allocateUniformBuffer(FFXProgram.ub_ModelParams, 12 * 2 + 8);
        const mapped = renderInst.mapUniformBufferF32(FFXProgram.ub_ModelParams);
        offs += fillMatrix4x3(mapped, offs, modelViewMatrix);
        offs += fillMatrix4x3(mapped, offs, modelMatrix);
        offs += fillMatrix4x2(mapped, offs, textureMatrix);
        renderInstManager.submitRenderInst(renderInst);
    }
}

const toNoclip = mat4.create();
mat4.fromXRotation(toNoclip, Math.PI);

const scratchMatrices = nArray(2, () => mat4.create());
const scratchAABB = new AABB();
export class LevelModelInstance {
    public modelMatrix = mat4.create();
    public drawCalls: DrawCallInstance[] = [];
    public textureMatrix = mat4.create();
    public uvState = 0;
    public visible = true;
    public layer = GfxRendererLayer.BACKGROUND;

    public translation = vec3.create();
    public euler = vec3.create();

    public skinningMatrices: mat4[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, public data: LevelModelData) {
        for (let i = 0; i < this.data.model.drawCalls.length; i++)
            this.drawCalls.push(new DrawCallInstance(device, cache, this.data.model.drawCalls[i]));
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        mat4.mul(scratchMatrices[0], toNoclip, this.modelMatrix);
        mat4.mul(scratchMatrices[1], viewerInput.camera.viewMatrix, scratchMatrices[0]);

        scratchAABB.transform(this.data.model.bbox, scratchMatrices[0]);
        if (!viewerInput.camera.frustum.contains(scratchAABB))
            return;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setInputLayoutAndState(this.data.inputLayout, this.data.inputState);

        for (let i = 0; i < this.drawCalls.length; i++)
            this.drawCalls[i].prepareToRender(renderInstManager, this.modelMatrix, scratchMatrices[1], this.textureMatrix);

        renderInstManager.popTemplateRenderInst();
    }

    public setAlphaMultiplier(alpha: number): void {
        for (let i = 0; i < this.drawCalls.length; i++)
            this.drawCalls[i].alphaMultiplier = alpha;
    }
}

const scratchTextureMatrix = mat4.create();
class TextureData {
    public gfxTexture: GfxTexture[] = [];
    public viewerTexture: Viewer.Texture[] = [];

    constructor(device: GfxDevice, private texture: Texture) {
        for (let i = 0; i < this.texture.pixels.length; i++) {
            const pixels = this.texture.pixels[i];

            const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, 1));
            device.setResourceName(gfxTexture, texture.name);
            const hostAccessPass = device.createHostAccessPass();
            hostAccessPass.uploadTextureData(gfxTexture, 0, [pixels]);
            device.submitPass(hostAccessPass);
            this.gfxTexture[i] = gfxTexture;

            this.viewerTexture[i] = textureToCanvas(texture, `${texture.name}/${i}`, pixels);
        }
    }

    public fillTextureMapping(m: TextureMapping, paletteIndex: number = 0): void {
        m.gfxTexture = this.gfxTexture[paletteIndex];
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.gfxTexture.length; i++)
            device.destroyTexture(this.gfxTexture[i]);
    }
}

export class LevelPartData {
    public modelData: LevelModelData[] = [];
    public textureData: TextureData[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, public part: LevelPart) {
        for (let i = 0; i < part.textures.length; i++)
            this.textureData.push(new TextureData(device, part.textures[i]));
        for (let i = 0; i < part.models.length; i++)
            this.modelData.push(new LevelModelData(device, cache, part.models[i]));
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.textureData.length; i++)
            this.textureData[i].destroy(device);
        for (let i = 0; i < this.modelData.length; i++)
            this.modelData[i].destroy(device);
    }
}

function textureToCanvas(texture: Texture, name: string, pixels: Uint8Array): Viewer.Texture {
    const canvas = document.createElement("canvas");
    const width = texture.width;
    const height = texture.height;
    canvas.width = width;
    canvas.height = height;
    canvas.title = name;

    const ctx = canvas.getContext("2d")!;
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    imgData.data.set(pixels);
    ctx.putImageData(imgData, 0, 0);
    const surfaces = [canvas];

    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', psmToString(texture.tex0.psm));

    return { name: name, surfaces, extraInfo };
}
