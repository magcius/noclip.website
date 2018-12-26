
import * as Viewer from '../viewer';
import { TextureHolder, LoadedTexture, TextureMapping } from '../TextureHolder';

import { GfxDevice, GfxTextureDimension, GfxSampler, GfxWrapMode, GfxMipFilterMode, GfxTexFilterMode, GfxProgram, GfxCullMode, GfxCompareMode, GfxInputState, GfxInputLayout, GfxBuffer, GfxBufferUsage, GfxFormat, GfxVertexAttributeDescriptor, GfxVertexAttributeFrequency, GfxVertexBufferDescriptor, GfxBufferBinding, GfxBindingLayoutDescriptor, GfxBufferFrequencyHint, GfxHostAccessPass, GfxBlendMode, GfxBlendFactor } from '../gfx/platform/GfxPlatform';

import * as BNTX from './bntx';
import { surfaceToCanvas } from '../fres/bc_texture';
import { translateImageFormat, deswizzle, decompress, getImageFormatString } from './tegra_texture';
import { FMDL, FSHP, FMAT, FMAT_RenderInfo, FMAT_RenderInfoType, FVTX, FSHP_Mesh } from './bfres';
import { GfxRenderInstViewRenderer, GfxRenderInstBuilder, GfxRenderInst } from '../gfx/render/GfxRenderer';
import { TextureAddressMode, FilterMode, IndexFormat, AttributeFormat, getChannelFormat, getTypeFormat } from './nngfx_enum';
import { nArray, assert } from '../util';
import { DeviceProgram } from '../Program';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { GfxRenderBuffer } from '../gfx/render/GfxRenderBuffer';
import { fillMatrix4x4, fillMatrix4x3 } from '../gfx/helpers/UniformBufferHelpers';
import { mat4 } from 'gl-matrix';
import { computeViewMatrix } from '../Camera';
import { BasicRendererHelper } from '../oot3d/render';

export class BRTITextureHolder extends TextureHolder<BNTX.BRTI> {
    public addTextureGfx(device: GfxDevice, textureEntry: BNTX.BRTI): LoadedTexture | null {
        const gfxTexture = device.createTexture_({
            dimension: GfxTextureDimension.n2D,
            pixelFormat: translateImageFormat(textureEntry.imageFormat),
            width: textureEntry.width,
            height: textureEntry.height,
            depth: 1,
            numLevels: 1,
        });
        const canvases: HTMLCanvasElement[] = [];

        const channelFormat = getChannelFormat(textureEntry.imageFormat);

        for (let i = 0; i < 1; i++) {
            const mipLevel = i;

            const buffer = textureEntry.mipBuffers[i];
            const width = textureEntry.width;
            const height = textureEntry.height;
            const deswizzled = deswizzle({ buffer, width, height, channelFormat });
            const rgbaTexture = decompress(textureEntry, deswizzled);
            const rgbaPixels = rgbaTexture.pixels;

            const hostAccessPass = device.createHostAccessPass();
            hostAccessPass.uploadTextureData(gfxTexture, mipLevel, [rgbaPixels]);
            device.submitPass(hostAccessPass);

            const canvas = document.createElement('canvas');
            surfaceToCanvas(canvas, rgbaTexture, 0);
            canvases.push(canvas);
        }

        const extraInfo = new Map<string, string>();
        extraInfo.set('Format', getImageFormatString(textureEntry.imageFormat));

        const viewerTexture: Viewer.Texture = { name: textureEntry.name, surfaces: canvases, extraInfo };
        return { viewerTexture, gfxTexture };
    }
}

class ShapeInstance {
    constructor(device: GfxDevice, fmdl: FMDL, public fshp: FSHP) {
    }
}

function translateAddressMode(addrMode: TextureAddressMode): GfxWrapMode {
    switch (addrMode) {
    case TextureAddressMode.Repeat:
        return GfxWrapMode.REPEAT;
    case TextureAddressMode.ClampToEdge:
    case TextureAddressMode.ClampToBorder:
        return GfxWrapMode.CLAMP;
    case TextureAddressMode.Mirror:
        return GfxWrapMode.MIRROR;
    default:
        throw "whoops";
    }
}

function translateMipFilterMode(filterMode: FilterMode): GfxMipFilterMode {
    switch (filterMode) {
    case FilterMode.Linear:
        return GfxMipFilterMode.LINEAR;
    case FilterMode.Point:
        return GfxMipFilterMode.NEAREST;
    case 0:
        return GfxMipFilterMode.NO_MIP;
    default:
        throw "whoops";
    }
}

function translateTexFilterMode(filterMode: FilterMode): GfxTexFilterMode {
    switch (filterMode) {
    case FilterMode.Linear:
        return GfxTexFilterMode.BILINEAR;
    case FilterMode.Point:
        return GfxTexFilterMode.POINT;
    default:
        throw "whoops";
    }
}

class AglProgram extends DeviceProgram {
    public static _p0: number = 0;
    public static _n0: number = 1;
    public static _t0: number = 2;
    public static _c0: number = 3;
    public static _u0: number = 4;
    public static _u1: number = 5;
    public static _u2: number = 6;
    public static a_Orders = ['_p0', '_n0', '_t0', '_c0', '_u0', '_u1', '_u2'];

    public static ub_SceneParams = 0;
    public static ub_MaterialParams = 1;
    public static ub_ShapeParams = 2;

    public vert = `
precision mediump float;

layout(row_major, std140) uniform ub_SceneParams {
    mat4 u_Projection;
};

layout(row_major, std140) uniform ub_MaterialParams {
    vec4 u_Misc0;
};

layout(row_major, std140) uniform ub_ShapeParams {
    mat4x3 u_ModelView;
};

layout(location = ${AglProgram._p0}) in vec3 _p0;
layout(location = ${AglProgram._n0}) in vec3 _n0;
layout(location = ${AglProgram._t0}) in vec3 _t0;
layout(location = ${AglProgram._c0}) in vec4 _c0;
layout(location = ${AglProgram._u0}) in vec2 _u0;
layout(location = ${AglProgram._u1}) in vec2 _u1;
layout(location = ${AglProgram._u2}) in vec2 _u2;

out vec2 v_u0;

void main() {
    gl_Position = u_Projection * mat4(u_ModelView) * vec4(_p0, 1.0);
    v_u0 = _u0;
}
`;

    public frag = `
precision mediump float;

in vec2 v_u0;
uniform sampler2D _a0;

void main() {
    gl_FragColor = texture(_a0, v_u0);
}
`;
}

function translateRenderInfoSingleString(renderInfo: FMAT_RenderInfo): string {
    assert(renderInfo.type === FMAT_RenderInfoType.String && renderInfo.values.length === 1);
    return renderInfo.values[0] as string;
}

function translateRenderInfoBoolean(renderInfo: FMAT_RenderInfo): boolean {
    const value = translateRenderInfoSingleString(renderInfo);
    if (value === 'true')
        return true;
    else if (value === 'false')
        return false;
    else
        throw "whoops";
}

function translateCullMode(fmat: FMAT): GfxCullMode {
    const display_face = translateRenderInfoSingleString(fmat.renderInfo.get('display_face'));
    if (display_face === 'front')
        return GfxCullMode.BACK;
    else
        throw "whoops";
}

function translateDepthWrite(fmat: FMAT): boolean {
    return translateRenderInfoBoolean(fmat.renderInfo.get('enable_depth_write'));
}

function translateDepthCompare(fmat: FMAT): GfxCompareMode {
    if (translateRenderInfoBoolean(fmat.renderInfo.get('enable_depth_test'))) {
        const depth_test_func = translateRenderInfoSingleString(fmat.renderInfo.get('depth_test_func'));
        if (depth_test_func === 'Lequal')
            return GfxCompareMode.LEQUAL;
        else
            throw "whoops";
    } else {
        return GfxCompareMode.ALWAYS;
    }
}

function translateBlendMode(fmat: FMAT): GfxBlendMode {
    const enable_blend0: string = fmat.shaderAssign.shaderOption.get('enable_blend0');
    if (enable_blend0 === '1') {
        const color_blend_rgb_op: string = translateRenderInfoSingleString(fmat.renderInfo.get('color_blend_rgb_op'));
        if (color_blend_rgb_op === 'add')
            return GfxBlendMode.ADD;
        else
            throw "whoops";
    } else {
        return GfxBlendMode.NONE;
    }
}

function translateRenderInfoBlendFactor(renderInfo: FMAT_RenderInfo): GfxBlendFactor {
    const value = translateRenderInfoSingleString(renderInfo);
    if (value === 'src_alpha')
        return GfxBlendFactor.SRC_ALPHA;
    else if (value === 'one_minus_src_alpha')
        return GfxBlendFactor.ONE_MINUS_SRC_ALPHA;
    else
        throw "whoops";
}

function translateBlendSrcFactor(fmat: FMAT): GfxBlendFactor {
    return translateRenderInfoBlendFactor(fmat.renderInfo.get('color_blend_rgb_src_func'));
}

function translateBlendDstFactor(fmat: FMAT): GfxBlendFactor {
    return translateRenderInfoBlendFactor(fmat.renderInfo.get('color_blend_rgb_dst_func'));
}

class FMATInstance {
    public gfxSamplers: GfxSampler[] = [];
    public textureMapping: TextureMapping[] = [];
    public templateRenderInst: GfxRenderInst;

    constructor(device: GfxDevice, textureHolder: BRTITextureHolder, renderInstBuilder: GfxRenderInstBuilder, public fmat: FMAT) {
        this.templateRenderInst = renderInstBuilder.newRenderInst();

        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, AglProgram.ub_MaterialParams);

        // Fill in our texture mappings.
        assert(fmat.samplerInfo.length === fmat.textureName.length);

        // Textures are assigned in the order that they show up in the shader.
        // For us, that is this order.
        const textureShaderOrder = ['_a0'];

        this.textureMapping = nArray(textureShaderOrder.length, () => new TextureMapping());
        for (let i = 0; i < textureShaderOrder.length; i++) {
            const textureParameterName = textureShaderOrder[i];
            const samplerName = fmat.shaderAssign.samplerAssign.get(textureParameterName);

            // TODO(jstpierre): Figure out how to deal with this. Bind a black texture and hope it works?
            if (samplerName === undefined)
                continue;

            // Now find the corresponding sampler.
            const samplerIndex = fmat.samplerInfo.findIndex((samplerInfo) => samplerInfo.name === samplerName);

            const samplerInfo = fmat.samplerInfo[samplerIndex];
            const gfxSampler = device.createSampler({
                wrapS: translateAddressMode(samplerInfo.addrModeU),
                wrapT: translateAddressMode(samplerInfo.addrModeV),
                mipFilter: translateMipFilterMode((samplerInfo.filterMode >>> FilterMode.MipShift) & 0x03),
                minFilter: translateTexFilterMode((samplerInfo.filterMode >>> FilterMode.MinShift) & 0x03),
                magFilter: translateTexFilterMode((samplerInfo.filterMode >>> FilterMode.MagShift) & 0x03),
                maxLOD: samplerInfo.maxLOD,
                minLOD: samplerInfo.minLOD,
            });
            this.gfxSamplers.push(gfxSampler);

            const textureName = fmat.textureName[samplerIndex];
            textureHolder.fillTextureMapping(this.textureMapping[i], textureName);
            this.textureMapping[i].gfxSampler = gfxSampler;
        }
        this.templateRenderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

        // Render flags.
        this.templateRenderInst.setRenderFlags({
            cullMode:       translateCullMode(fmat),
            depthCompare:   translateDepthCompare(fmat),
            depthWrite:     translateDepthWrite(fmat),
            blendMode:      translateBlendMode(fmat),
            blendSrcFactor: translateBlendSrcFactor(fmat),
            blendDstFactor: translateBlendDstFactor(fmat),
        });
    }

    public prepareToRender(materialParamsBuffer: GfxRenderBuffer, viewerInput: Viewer.ViewerRenderInput): void {
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.gfxSamplers.length; i++)
            device.destroySampler(this.gfxSamplers[i]);
    }
}

function translateAttributeFormat(attributeFormat: AttributeFormat): GfxFormat {
    switch (attributeFormat) {
    case AttributeFormat._8_8_8_8_Unorm:
        return GfxFormat.U8_RGBA_NORM;
    case AttributeFormat._8_8_8_8_Snorm:
        return GfxFormat.S8_RGBA_NORM;
    case AttributeFormat._10_10_10_2_Snorm:
        // TODO(jstpierre): Get this right. We probably need to convert again like we did for Wii U.
        return GfxFormat.S8_RGBA_NORM;
    case AttributeFormat._16_16_Unorm:
        return GfxFormat.S16_RG_NORM;
    case AttributeFormat._16_16_Float:
        return GfxFormat.F16_RG;
    case AttributeFormat._32_32_Float:
        return GfxFormat.F32_RG;
    case AttributeFormat._32_32_32_Float:
        return GfxFormat.F32_RGB;
    default:
        console.error(getChannelFormat(attributeFormat), getTypeFormat(attributeFormat));
        throw "whoops";
    }
}

class FVTXInstance {
    public vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[] = [];

    constructor(device: GfxDevice, public fvtx: FVTX) {
        for (let i = 0; i < fvtx.vertexAttributes.length; i++) {
            const vertexAttribute = fvtx.vertexAttributes[i];
            const attribLocation = AglProgram.a_Orders.indexOf(vertexAttribute.name);
            if (attribLocation < 0)
                throw "whoops";

            this.vertexAttributeDescriptors.push({
                location: attribLocation,
                format: translateAttributeFormat(vertexAttribute.format),
                bufferIndex: vertexAttribute.bufferIndex,
                bufferByteOffset: vertexAttribute.offset,
                frequency: GfxVertexAttributeFrequency.PER_VERTEX,
            });
        }

        for (let i = 0; i < fvtx.vertexBuffers.length; i++) {
            const vertexBuffer = fvtx.vertexBuffers[i];
            const gfxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vertexBuffer.data.castToBuffer());
            this.vertexBufferDescriptors.push({ buffer: gfxBuffer, byteOffset: 0, byteStride: vertexBuffer.stride });
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.vertexBufferDescriptors.length; i++)
            device.destroyBuffer(this.vertexBufferDescriptors[i].buffer);
    }
}

function translateIndexFormat(indexFormat: IndexFormat): GfxFormat {
    switch (indexFormat) {
    case IndexFormat.Uint8:  return GfxFormat.U8_R;
    case IndexFormat.Uint16: return GfxFormat.U16_R;
    case IndexFormat.Uint32: return GfxFormat.U32_R;
    default: throw "whoops";
    }
}

function getIndexFormatByteSize(indexFormat: IndexFormat): number {
    switch (indexFormat) {
    case IndexFormat.Uint8:  return 1;
    case IndexFormat.Uint16: return 2;
    case IndexFormat.Uint32: return 4;
    default: throw "whoops";
    }
}

class FSHPMeshInstance {
    public inputState: GfxInputState;
    public inputLayout: GfxInputLayout;
    public indexBuffer: GfxBuffer;
    public renderInsts: GfxRenderInst[] = [];

    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, fvtxInstance: FVTXInstance, public mesh: FSHP_Mesh) {
        const indexBufferFormat = translateIndexFormat(mesh.format);
        this.inputLayout = device.createInputLayout({
            vertexAttributeDescriptors: fvtxInstance.vertexAttributeDescriptors, indexBufferFormat,
        });

        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, mesh.indexBufferData.castToBuffer());
        const indexBufferDescriptor: GfxVertexBufferDescriptor = { buffer: this.indexBuffer, byteOffset: 0, byteStride: 0 };
        this.inputState = device.createInputState(this.inputLayout, fvtxInstance.vertexBufferDescriptors, indexBufferDescriptor);

        assert(mesh.offset === 0);

        // TODO(jstpierre): Do we have to care about submeshes?
        const renderInst = renderInstBuilder.pushRenderInst();
        renderInst.drawIndexes(mesh.count);
        renderInst.inputState = this.inputState;
        this.renderInsts.push(renderInst);
    }

    public destroy(device: GfxDevice): void {
        device.destroyInputState(this.inputState);
        device.destroyInputLayout(this.inputLayout);
        device.destroyBuffer(this.indexBuffer);
    }
}

const scratchMatrix = mat4.create();
class FSHPInstance {
    private meshInstances: FSHPMeshInstance[] = [];
    public templateRenderInst: GfxRenderInst;

    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, fvtxInstance: FVTXInstance, public fshp: FSHP) {
        // TODO(jstpierre): Joints.
        this.templateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, AglProgram.ub_ShapeParams);

        // Only construct the first LOD mesh for now.
        for (let i = 0; i < 1; i++)
            this.meshInstances.push(new FSHPMeshInstance(device, renderInstBuilder, fvtxInstance, fshp.mesh[i]));

        renderInstBuilder.popTemplateRenderInst();
    }

    public computeModelView(viewerInput: Viewer.ViewerRenderInput): mat4 {
        // Build view matrix
        const viewMatrix = scratchMatrix;
        computeViewMatrix(viewMatrix, viewerInput.camera);
        return viewMatrix;
    }

    public prepareToRender(shapeParamsBuffer: GfxRenderBuffer, viewerInput: Viewer.ViewerRenderInput): void {
        const shapeParamsMapped = shapeParamsBuffer.mapBufferF32(this.templateRenderInst.uniformBufferOffsets[AglProgram.ub_ShapeParams], 12);
        let offs = this.templateRenderInst.uniformBufferOffsets[AglProgram.ub_ShapeParams];
        offs += fillMatrix4x3(shapeParamsMapped, offs, this.computeModelView(viewerInput));
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.meshInstances.length; i++)
            this.meshInstances[i].destroy(device);
    }
}

export class FMDLRenderer {
    public fvtxInst: FVTXInstance[] = [];
    public fmatInst: FMATInstance[] = [];
    public fshpInst: FSHPInstance[] = [];
    public gfxProgram: GfxProgram;
    public renderInstBuilder: GfxRenderInstBuilder;
    public sceneParamsBuffer: GfxRenderBuffer;
    public materialParamsBuffer: GfxRenderBuffer;
    public shapeParamsBuffer: GfxRenderBuffer;
    public templateRenderInst: GfxRenderInst;

    constructor(device: GfxDevice, public textureHolder: BRTITextureHolder, public fmdl: FMDL) {
        this.gfxProgram = device.createProgram(new AglProgram());
        const programReflection = device.queryProgram(this.gfxProgram);

        this.sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);
        this.materialParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_MaterialParams`);
        this.shapeParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_ShapeParams`);

        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 0 }, // Scene
            { numUniformBuffers: 1, numSamplers: 1 }, // Material
            { numUniformBuffers: 1, numSamplers: 0 }, // Shape
        ];
        const uniformBuffers = [ this.sceneParamsBuffer, this.materialParamsBuffer, this.shapeParamsBuffer ];

        this.renderInstBuilder = new GfxRenderInstBuilder(device, programReflection, bindingLayouts, uniformBuffers);

        this.templateRenderInst = this.renderInstBuilder.pushTemplateRenderInst();
        this.templateRenderInst.gfxProgram = this.gfxProgram;
        this.renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, AglProgram.ub_SceneParams);

        this.translateModel(device);
    }

    public addToViewRenderer(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        this.renderInstBuilder.popTemplateRenderInst();
        this.renderInstBuilder.finish(device, viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const sceneParamsMapped = this.sceneParamsBuffer.mapBufferF32(this.templateRenderInst.uniformBufferOffsets[AglProgram.ub_SceneParams], 16);
        let offs = this.templateRenderInst.uniformBufferOffsets[AglProgram.ub_SceneParams];
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < this.fshpInst.length; i++)
            this.fshpInst[i].prepareToRender(this.shapeParamsBuffer, viewerInput);

        this.sceneParamsBuffer.prepareToRender(hostAccessPass);
        this.materialParamsBuffer.prepareToRender(hostAccessPass);
        this.shapeParamsBuffer.prepareToRender(hostAccessPass);
    }

    public translateModel(device: GfxDevice): void {
        for (let i = 0; i < this.fmdl.fvtx.length; i++)
            this.fvtxInst.push(new FVTXInstance(device, this.fmdl.fvtx[i]));
        for (let i = 0; i < this.fmdl.fmat.length; i++)
            this.fmatInst.push(new FMATInstance(device, this.textureHolder, this.renderInstBuilder, this.fmdl.fmat[i]));
        for (let i = 0; i < this.fmdl.fshp.length; i++) {
            const fshp = this.fmdl.fshp[i];
            const fvtxInstance = this.fvtxInst[fshp.vertexIndex];
            const fmatInstance = this.fmatInst[fshp.materialIndex];
            this.renderInstBuilder.pushTemplateRenderInst(fmatInstance.templateRenderInst);
            this.fshpInst.push(new FSHPInstance(device, this.renderInstBuilder, fvtxInstance, fshp));
            this.renderInstBuilder.popTemplateRenderInst();
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.fvtxInst.length; i++)
            this.fvtxInst[i].destroy(device);
        for (let i = 0; i < this.fmatInst.length; i++)
            this.fmatInst[i].destroy(device);
        for (let i = 0; i < this.fshpInst.length; i++)
            this.fshpInst[i].destroy(device);
    }
}

export class BasicFRESRenderer extends BasicRendererHelper {
    public fmdlRenderers: FMDLRenderer[] = [];

    constructor(public textureHolder: BRTITextureHolder) {
        super();
    }

    public addFMDLRenderer(device: GfxDevice, fmdlRenderer: FMDLRenderer): void {
        fmdlRenderer.addToViewRenderer(device, this.viewRenderer);
        this.fmdlRenderers.push(fmdlRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.fmdlRenderers.length; i++)
            this.fmdlRenderers[i].prepareToRender(hostAccessPass, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        for (let i = 0; i < this.fmdlRenderers.length; i++)
            this.fmdlRenderers[i].destroy(device);
    }
}
