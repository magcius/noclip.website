
import { GfxDevice, GfxBuffer, GfxInputState, GfxInputLayout, GfxFormat, GfxVertexBufferFrequency, GfxVertexAttributeDescriptor, GfxBufferUsage, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxCullMode, GfxCompareMode, makeTextureDescriptor2D, GfxProgram, GfxMegaStateDescriptor, GfxBlendMode, GfxBlendFactor, GfxInputLayoutBufferDescriptor, GfxTexture } from "../gfx/platform/GfxPlatform";
import { BINModel, BINTexture, BINModelSector, BINModelPart, GSConfiguration } from "./bin";
import { DeviceProgram } from "../Program";
import * as Viewer from "../viewer";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { mat4, vec3 } from "gl-matrix";
import { fillMatrix4x3, fillColor, fillMatrix4x2, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { TextureMapping } from "../TextureHolder";
import { nArray, assert } from "../util";
import { GfxRenderInstManager, GfxRendererLayer, setSortKeyDepth, makeSortKey } from "../gfx/render/GfxRenderInstManager";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers";
import { GSAlphaCompareMode, GSAlphaFailMode, GSTextureFunction, GSDepthCompareMode, GSTextureFilter, GSPixelStorageFormat, psmToString } from "../Common/PS2/GS";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { AABB } from "../Geometry";
import { convertToCanvas } from "../gfx/helpers/TextureConversionHelpers";
import ArrayBufferSlice from "../ArrayBufferSlice";

export class KatamariDamacyProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;

    private static reflectionDeclarations = `
precision mediump float;

// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    vec4 u_LightDirs[2];
    vec4 u_LightColors[3];
};

layout(std140) uniform ub_ModelParams {
    Mat4x3 u_BoneMatrix[SKINNING_MATRIX_COUNT];
    Mat4x3 u_NormalMatrix[SKINNING_MATRIX_COUNT];
    Mat4x2 u_TextureMatrix[1];
    vec4 u_Color;
    vec4 u_Misc[1];
};

#define u_Alpha (u_Misc[0].x)

uniform sampler2D u_Texture;

varying vec3 v_DiffuseLighting;
varying vec2 v_TexCoord;
`;

    public override vert = `
${KatamariDamacyProgram.reflectionDeclarations}
layout(location = 0) in vec4 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in vec2 a_TexCoord;

void main() {
    int t_SkinningIndex = int(a_Position.w);
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[t_SkinningIndex]), vec4(a_Position.xyz, 1.0)));
    v_TexCoord = Mul(_Mat4x4(u_TextureMatrix[0]), vec4(a_TexCoord, 0.0, 1.0)).xy;

#ifdef LIGHTING
    vec3 t_Normal = normalize(Mul(_Mat4x4(u_NormalMatrix[t_SkinningIndex]), vec4(a_Normal, 0.0)).xyz);
    v_DiffuseLighting = u_LightColors[2].rgb;
    for (int i = 0; i < 2; i++)
        v_DiffuseLighting += max(dot(t_Normal, u_LightDirs[i].xyz), 0.0) * u_LightColors[i].rgb;
#else
    v_DiffuseLighting = vec3(1.0);
#endif
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
        // TODO(jstpierre): What to do about afail?

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
        const tfx: GSTextureFunction = (gsConfiguration.tex0_1_data1 >>> 3) & 0x03;
        assert(tfx === GSTextureFunction.MODULATE);

        // Contains depth & alpha test settings.
        const ate = !!((gsConfiguration.test_1_data0 >>> 0) & 0x01);
        const atst = (gsConfiguration.test_1_data0 >>> 1) & 0x07;
        const aref = (gsConfiguration.test_1_data0 >>> 4) & 0xFF;
        const afail = (gsConfiguration.test_1_data0 >>> 12) & 0x03;
        const date = !!((gsConfiguration.test_1_data0 >>> 14) & 0x01);
        const datm = !!((gsConfiguration.test_1_data0 >>> 15) & 0x01);

        return `
${KatamariDamacyProgram.reflectionDeclarations}
void main() {
    vec4 t_Color;

    t_Color = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    t_Color.rgba *= u_Color.rgba;
    t_Color.rgb *= clamp(v_DiffuseLighting, 0.0, 1.0);
    t_Color.a *= u_Alpha;

${this.generateAlphaTest(ate, atst, aref, afail)}

    gl_FragColor = t_Color;
}
`;
    }
}

export class BINModelData {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;

    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;

    constructor(device: GfxDevice, cache: GfxRenderCache, public sectorData: BINModelSectorData, public binModel: BINModel) {
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, this.binModel.vertexData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, this.binModel.indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: KatamariDamacyProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0*4, format: GfxFormat.F32_RGBA },
            { location: KatamariDamacyProgram.a_Normal,   bufferIndex: 0, bufferByteOffset: 4*4, format: GfxFormat.F32_RGB },
            { location: KatamariDamacyProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 7*4, format: GfxFormat.F32_RG },
        ];
        const VERTEX_STRIDE = 4+3+2;
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: VERTEX_STRIDE*4, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;

        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

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

enum CLAMP1_WM {
    REPEAT, CLAMP, REGION_CLAMP, REGION_REPEAT,
}

function translateWrapMode(wm: CLAMP1_WM): GfxWrapMode {
    switch (wm) {
    case CLAMP1_WM.REPEAT: return GfxWrapMode.Repeat;
    case CLAMP1_WM.CLAMP: return GfxWrapMode.Clamp;
    // TODO(jstpierre): Support REGION_* clamp modes.
    case CLAMP1_WM.REGION_REPEAT: return GfxWrapMode.Repeat;
    default: throw "whoops";
    }
}

function translateDepthCompareMode(cmp: GSDepthCompareMode): GfxCompareMode {
    switch (cmp) {
    case GSDepthCompareMode.NEVER: return GfxCompareMode.Never;
    case GSDepthCompareMode.ALWAYS: return GfxCompareMode.Always;
    // We use a LESS-style depth buffer.
    case GSDepthCompareMode.GEQUAL: return GfxCompareMode.LessEqual;
    case GSDepthCompareMode.GREATER: return GfxCompareMode.Less;
    }
}

function translateTextureFilter(filter: GSTextureFilter): [GfxTexFilterMode, GfxMipFilterMode] {
    switch (filter) {
    case GSTextureFilter.NEAREST:
        return [GfxTexFilterMode.Point,    GfxMipFilterMode.NoMip];
    case GSTextureFilter.LINEAR:
        return [GfxTexFilterMode.Bilinear, GfxMipFilterMode.NoMip];
    case GSTextureFilter.NEAREST_MIPMAP_NEAREST:
        return [GfxTexFilterMode.Point,    GfxMipFilterMode.Nearest];
    case GSTextureFilter.NEAREST_MIPMAP_LINEAR:
        return [GfxTexFilterMode.Point,    GfxMipFilterMode.Linear];
    case GSTextureFilter.LINEAR_MIPMAP_NEAREST:
        return [GfxTexFilterMode.Bilinear, GfxMipFilterMode.Nearest];
    case GSTextureFilter.LINEAR_MIPMAP_LINEAR:
        return [GfxTexFilterMode.Bilinear, GfxMipFilterMode.Linear];
    default: throw new Error();
    }
}

export class BINModelPartInstance {
    private gfxProgram: GfxProgram;
    private textureMapping = nArray(1, () => new TextureMapping());
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    public alphaMultiplier = 1;

    constructor(device: GfxDevice, cache: GfxRenderCache, public sectorData: BINModelSectorData, public binModelPart: BINModelPart, public transformCount = 1) {
        const gsConfiguration = this.binModelPart.gsConfiguration!;

        const program = new KatamariDamacyProgram(gsConfiguration);
        if (this.binModelPart.lit)
            program.defines.set("LIGHTING", "1");
        program.defines.set("SKINNING_MATRIX_COUNT", this.transformCount.toString());
        this.gfxProgram = cache.createProgram(program);

        const zte = !!((gsConfiguration.test_1_data0 >>> 16) & 0x01);
        const ztst: GSDepthCompareMode = (gsConfiguration!.test_1_data0 >>> 17) & 0x03;
        assert(zte);

        this.megaStateFlags = {
            depthCompare: reverseDepthForCompareMode(translateDepthCompareMode(ztst)),
        };

        if (gsConfiguration.alpha_1_data0 === 0x44) {
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            });
        } else if (gsConfiguration.alpha_1_data0 === 0x48) {
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.One,
            });
        } else {
            throw "whoops";
        }

        // Katamari should not have any mipmaps.
        const lcm = (gsConfiguration.tex1_1_data0 >>> 0) & 0x01;
        const mxl = (gsConfiguration.tex1_1_data0 >>> 2) & 0x07;
        assert(lcm === 0x00);
        assert(mxl === 0x00);

        const texMagFilter: GSTextureFilter = (gsConfiguration.tex1_1_data0 >>> 5) & 0x01;
        const texMinFilter: GSTextureFilter = (gsConfiguration.tex1_1_data0 >>> 6) & 0x07;
        const [magFilter]            = translateTextureFilter(texMagFilter);
        const [minFilter, mipFilter] = translateTextureFilter(texMinFilter);

        const wms = (gsConfiguration.clamp_1_data0 >>> 0) & 0x03;
        const wmt = (gsConfiguration.clamp_1_data0 >>> 2) & 0x03;
        const wrapS = translateWrapMode(wms);
        const wrapT = translateWrapMode(wmt);

        this.textureMapping[0].gfxSampler = cache.createSampler({
            minFilter, magFilter, mipFilter,
            wrapS, wrapT,
            minLOD: 0, maxLOD: 100,
        });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, modelViewMatrices: mat4[], modelMatrices: mat4[], textureMatrix: mat4, currentPalette: number): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);

        mat4.copy(scratchTextureMatrix, textureMatrix);
        if (this.binModelPart.textureIndex !== null)
            this.sectorData.textureData[this.binModelPart.textureIndex].fillTextureMapping(this.textureMapping[0], scratchTextureMatrix, currentPalette);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

        renderInst.drawIndexes(this.binModelPart.indexCount, this.binModelPart.indexOffset);

        let offs = renderInst.allocateUniformBuffer(KatamariDamacyProgram.ub_ModelParams, 12*2*this.transformCount+8+4+4);
        const d = renderInst.mapUniformBufferF32(KatamariDamacyProgram.ub_ModelParams);
        for (let i = 0; i < this.transformCount; i++)
            offs += fillMatrix4x3(d, offs, modelViewMatrices[i]);
        for (let i = 0; i < this.transformCount; i++)
            offs += fillMatrix4x3(d, offs, modelMatrices[i]);
        offs += fillMatrix4x2(d, offs, scratchTextureMatrix);
        offs += fillColor(d, offs, this.binModelPart.diffuseColor);
        offs += fillVec4(d, offs, this.alphaMultiplier);
        renderInstManager.submitRenderInst(renderInst);
    }
}

// poisonous frog (0x2E6) uses the most of any object, though the game supports up to 9
const scratchModelViews = nArray(6, () => mat4.create());
const scratchModelMatrices = nArray(6, () => mat4.create());
const scratchAABB = new AABB();
const cullModeFlags = {
    cullMode: GfxCullMode.Back,
};
export class BINModelInstance {
    public modelMatrix = mat4.create();
    public modelParts: BINModelPartInstance[] = [];
    public textureMatrix = mat4.create();
    public uvState = 0;
    public visible = true;
    public layer = GfxRendererLayer.BACKGROUND;

    public translation = vec3.create();
    public euler = vec3.create();

    public skinningMatrices: mat4[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, public binModelData: BINModelData, skinningCount = 0) {
        this.skinningMatrices = nArray(skinningCount, () => mat4.create());
        assert(skinningCount + 1 <= scratchModelViews.length);
        for (let i = 0; i < this.binModelData.binModel.modelParts.length; i++)
            this.modelParts.push(new BINModelPartInstance(device, cache, this.binModelData.sectorData, this.binModelData.binModel.modelParts[i], skinningCount + 1));
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, toNoclip: mat4, currentPalette: number, depth = 0): void {
        if (!this.visible)
            return;

        mat4.mul(scratchModelMatrices[0], toNoclip, this.modelMatrix);

        scratchAABB.transform(this.binModelData.binModel.bbox, scratchModelMatrices[0]);
        if (!viewerInput.camera.frustum.contains(scratchAABB))
            return;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setInputLayoutAndState(this.binModelData.inputLayout, this.binModelData.inputState);
        template.setMegaStateFlags(cullModeFlags);
        template.sortKey = makeSortKey(this.layer)
        template.sortKey = setSortKeyDepth(template.sortKey, depth);

        mat4.mul(scratchModelViews[0], viewerInput.camera.viewMatrix, scratchModelMatrices[0]);
        for (let i = 0; i < this.skinningMatrices.length; i++) {
            mat4.mul(scratchModelMatrices[i + 1], toNoclip, this.skinningMatrices[i]);
            mat4.mul(scratchModelViews[i + 1], viewerInput.camera.viewMatrix, scratchModelMatrices[i + 1]);
        }

        for (let i = 0; i < this.modelParts.length; i++)
            this.modelParts[i].prepareToRender(renderInstManager, scratchModelViews, scratchModelMatrices, this.textureMatrix, currentPalette);

        renderInstManager.popTemplateRenderInst();
    }

    public setAlphaMultiplier(alpha: number): void {
        for (let i = 0; i < this.modelParts.length; i++)
            this.modelParts[i].alphaMultiplier = alpha;
    }
}

const scratchTextureMatrix = mat4.create();
class BINTextureData {
    public gfxTexture: GfxTexture[] = [];
    public viewerTexture: Viewer.Texture[] = [];

    constructor(device: GfxDevice, private texture: BINTexture) {
        for (let i = 0; i < this.texture.pixels.length; i++) {
            const pixels = this.texture.pixels[i];

            if (pixels !== 'framebuffer') {
                const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, 1));
                device.setResourceName(gfxTexture, texture.name);

                device.uploadTextureData(gfxTexture, 0, [pixels]);
                this.gfxTexture[i] = gfxTexture;
    
                this.viewerTexture[i] = textureToCanvas(texture, `${texture.name}/${i}`, pixels);
            }
        }
    }

    public fillTextureMapping(m: TextureMapping, dstMtx: mat4, paletteIndex: number = 0): void {
        if (this.texture.pixels[paletteIndex] === 'framebuffer') {
            m.lateBinding = 'framebuffer';
            dstMtx[5] *= -1;
            dstMtx[13] += 1;
        } else {
            m.gfxTexture = this.gfxTexture[paletteIndex];
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.gfxTexture.length; i++)
            device.destroyTexture(this.gfxTexture[i]);
    }
}

export class BINModelSectorData {
    public modelData: BINModelData[] = [];
    public textureData: BINTextureData[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, public binModelSector: BINModelSector) {
        for (let i = 0; i < binModelSector.textures.length; i++)
            this.textureData.push(new BINTextureData(device, binModelSector.textures[i]));
        for (let i = 0; i < binModelSector.models.length; i++)
            this.modelData.push(new BINModelData(device, cache, this, binModelSector.models[i]));
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.textureData.length; i++)
            this.textureData[i].destroy(device);
        for (let i = 0; i < this.modelData.length; i++)
            this.modelData[i].destroy(device);
    }
}

function textureToCanvas(texture: BINTexture, name: string, pixels: Uint8Array): Viewer.Texture {
    const canvas = convertToCanvas(ArrayBufferSlice.fromView(pixels), texture.width, texture.height);
    canvas.title = name;

    const surfaces = [canvas];

    const extraInfo = new Map<string, string>();
    const psm: GSPixelStorageFormat = (texture.tex0_data0 >>> 20) & 0x3F;
    extraInfo.set('Format', psmToString(psm));

    return { name: name, surfaces, extraInfo };
}
