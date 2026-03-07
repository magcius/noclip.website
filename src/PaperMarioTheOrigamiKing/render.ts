import { mat4, quat } from 'gl-matrix';
import { computeViewSpaceDepthFromWorldSpaceAABB, computeViewMatrix } from '../Camera.js';
import { FMAT, FMAT_RenderInfo, FMAT_RenderInfoType, FMDL, FSHP, FSHP_Mesh, FSKL, FSKL_Bone, FVTX, FVTX_VertexAttribute, FVTX_VertexBuffer } from '../fres_nx/bfres.js';
import { AttributeFormat, FilterMode, getChannelFormat, getTypeFormat, IndexFormat, TextureAddressMode } from '../fres_nx/nngfx_enum.js';
import { BRTITextureHolder } from '../fres_nx/render.js';
import { AABB } from '../Geometry.js';
import { createBufferFromData, createBufferFromSlice } from '../gfx/helpers/BufferHelpers.js';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers.js';
import { GfxShaderLibrary } from '../gfx/helpers/GfxShaderLibrary.js';
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { reverseDepthForCompareMode } from '../gfx/helpers/ReversedDepthHelpers.js';
import { fillMatrix4x4, fillMatrix4x3, fillVec3v } from '../gfx/helpers/UniformBufferHelpers.js';
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCompareMode, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { GfxRenderInst, GfxRendererLayer, makeSortKey, GfxRenderInstManager, setSortKeyDepth, GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { DeviceProgram } from '../Program.js';
import { TextureMapping } from '../TextureHolder.js';
import { assert, assertExists, nArray } from '../util.js';
import * as Viewer from '../viewer.js';

function translateAddressMode(addrMode: TextureAddressMode): GfxWrapMode {
    switch (addrMode) {
        case TextureAddressMode.Repeat:
            return GfxWrapMode.Repeat;
        case TextureAddressMode.ClampToEdge:
        case TextureAddressMode.ClampToBorder:
            return GfxWrapMode.Clamp;
        case TextureAddressMode.Mirror:
            return GfxWrapMode.Mirror;
        case TextureAddressMode.MirrorClampToEdge:
            return GfxWrapMode.Mirror;
        default:
            throw "whoops2";
    }
}

function translateMipFilterMode(filterMode: FilterMode): GfxMipFilterMode {
    switch (filterMode) {
        case FilterMode.Linear:
            return GfxMipFilterMode.Linear;
        case 0:
        case FilterMode.Point:
            return GfxMipFilterMode.Nearest;
        default:
            throw "whoops3";
    }
}

function translateTexFilterMode(filterMode: FilterMode): GfxTexFilterMode {
    switch (filterMode) {
        case FilterMode.Linear:
            return GfxTexFilterMode.Bilinear;
        case FilterMode.Point:
            return GfxTexFilterMode.Point;
        default:
            throw "whoops4";
    }
}

class AglProgram extends DeviceProgram {
    public static _p0: number = 0;
    public static _n0: number = 1;
    public static _t0: number = 2;
    public static _b0: number = 3;
    public static _u0: number = 4;
    public static _u1: number = 5;
    public static a_Orders = ['_p0', '_n0', '_t0', '_b0', '_u0', '_u1'];
    public static s_Orders = ['_a0', '_d0', '_l0', '_m0', '_n0'];

    public static ub_ShapeParams = 0;

    public isTranslucent: boolean = false;

    constructor(public fmat: FMAT) {
        super();

        this.name = this.fmat.name;
        assert(this.fmat.samplerInfo.length <= 8);

        // let alphaIsTranslucent = false;
        // try {
        //     alphaIsTranslucent = this.outputIsTranslucent('o_alpha');
        // } catch (e) {
        // }

        this.isTranslucent = false;//alphaIsTranslucent && !this.getShaderOptionBoolean(`enable_alphamask`);

        this.frag = this.generateFrag();
    }

    public static globalDefinitions = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_ShapeParams {
    Mat4x4 u_Projection;
    Mat4x4 u_Shift;
    Mat3x4 u_ModelView;
};

uniform sampler2D u_TextureAlbedo0;     // _a0
uniform sampler2D u_TextureDepth0;      // _d0
uniform sampler2D u_TextureLight0;      // _l0
uniform sampler2D u_TextureMetalness0;  // _m0
uniform sampler2D u_TextureNormal0;     // _n0
`;

    public override both = AglProgram.globalDefinitions;

    public lookupSamplerIndex(shadingModelSamplerBindingName: string) {
        const samplerName = assertExists(this.fmat.shaderAssign.samplerAssign.get(shadingModelSamplerBindingName));
        const samplerIndex = this.fmat.samplerInfo.findIndex((sampler) => sampler.name === samplerName);
        assert(samplerIndex >= 0);
        return samplerIndex;
    }

    public getShaderOptionNumber(optionName: string): number {
        const optionValue = assertExists(this.fmat.shaderAssign.shaderOption.get(optionName));
        return +optionValue;
    }

    public getShaderOptionBoolean(optionName: string): boolean {
        const optionValue = assertExists(this.fmat.shaderAssign.shaderOption.get(optionName));
        assert(optionValue === '0' || optionValue === '1');
        return optionValue === '1';
    }

    public condShaderOption(optionName: string, branchTrue: () => string, branchFalse: () => string = () => ''): string {
        return this.getShaderOptionBoolean(optionName) ? branchTrue() : branchFalse();
    }

    public generateComponentMask(componentMask: number): string {
        if (componentMask === 10)
            return '.rgba';
        else if (componentMask === 20)
            return '.rrrr';
        else if (componentMask === 30)
            return '.g';
        else if (componentMask === 50)
            return '.rgba';
        else if (componentMask === 60)
            return '.a';
        else
            throw "whoops5";
    }

    public genSample(shadingModelSamplerBindingName: string): string {
        try {
            const samplerIndex = this.lookupSamplerIndex(shadingModelSamplerBindingName);
            const uv = 'v_TexCoord0';
            return `texture(SAMPLER_2D(u_Texture${samplerIndex}), ${uv})`;
        } catch (e) {
            console.warn(`${this.name}: No sampler by name ${shadingModelSamplerBindingName}`);
            return `vec4(1.0)`;
        }
    }

    public genBlend(instance: number) {
        assert(this.getShaderOptionBoolean(`enable_blend${instance}`));
        const src = `${this.genOutput(`blend${instance}_src`)}${this.genOutputCompMask(`blend${instance}_src_ch`)}`;
        return src;
    }

    public genOutputCompMask(optionName: string): string {
        return this.generateComponentMask(this.getShaderOptionNumber(optionName));
    }

    public genOutput(optionName: string): string {
        const n = this.getShaderOptionNumber(optionName);

        if (n === 15)
            return 'vec4(1.0)';

        const kind = assertExists((n / 10) | 0);
        const instance = assertExists(n % 10);

        if (kind === 1)
            return this.genSample(`_a${instance}`);
        else if (kind === 2 || kind === 3)
            return this.genSample(`_n${instance}`);
        else if (kind === 5)
            return this.genSample(`_u${instance}`);
        else if (kind === 6)
            return `vec4(1.0)`;
        else if (kind === 7)
            return `vec4(1.0)`;
        else if (kind === 8)
            return this.genBlend(instance);
        else if (kind === 10)
            return `vec4(1.0)`;
        else if (kind === 11) {
            if (instance === 0 || instance === 1 || instance === 2 || instance === 5)
                return `vec4(0.0)`;
            else if (instance === 6)
                return `vec4(1.0)`;
            else
                throw "whoops6";
        } else
            throw "whoops7";
    }

    public blendIsTranslucent(instance: number): boolean {
        assert(this.getShaderOptionBoolean(`enable_blend${instance}`));
        return this.outputIsTranslucent(`blend${instance}_src`);
    }

    public outputIsTranslucent(optionName: string): boolean {
        const n = this.getShaderOptionNumber(optionName);

        const kind = (n / 10) | 0;
        const instance = (n % 10);

        if (kind === 8)
            return this.blendIsTranslucent(instance);
        else if (kind === 11)
            return instance !== 6;
        else
            return true;
    }

    public override vert = `
layout(location = ${AglProgram._p0}) in vec3 _p0;
layout(location = ${AglProgram._n0}) in vec4 _n0;
layout(location = ${AglProgram._t0}) in vec4 _t0;
layout(location = ${AglProgram._b0}) in vec4 _b0;
layout(location = ${AglProgram._u0}) in vec2 _u0;
layout(location = ${AglProgram._u1}) in vec2 _u1;

out vec3 v_PositionWorld;
out vec4 v_NormalWorld;
out vec4 v_TangentWorld;
out vec4 v_BitangentWorld;
out vec2 v_TexCoord0;
out vec2 v_TexCoord1;

void main() {
    vec3 t_PositionView = UnpackMatrix(u_ModelView) * UnpackMatrix(u_Shift) * vec4(_p0, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(t_PositionView, 1.0);
    v_PositionWorld = _p0;
    v_NormalWorld = _n0;
    v_TangentWorld = _t0;
    v_BitangentWorld = _b0;
    v_TexCoord0 = _u0;
    v_TexCoord1 = _u1;
}
`;

    public generateFrag() {
        return `
precision highp float;

in vec3 v_PositionWorld;
in vec4 v_NormalWorld;
in vec4 v_TangentWorld;
in vec4 v_BitangentWorld;
in vec2 v_TexCoord0;
in vec2 v_TexCoord1;

void main() {
    gl_FragColor = texture(SAMPLER_2D(u_TextureAlbedo0), v_TexCoord0);
    gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(1.0 / 2.2));
}
`;
    }
}

function translateRenderInfoSingleString(renderInfo: FMAT_RenderInfo): string {
    assert(renderInfo.type === FMAT_RenderInfoType.String && renderInfo.values.length === 1);
    return renderInfo.values[0] as string;
}

function translateRenderInfoBoolean(renderInfo: FMAT_RenderInfo): boolean {
    const value = translateRenderInfoSingleString(renderInfo);
    if (value === '1')
        return true;
    else if (value === '0')
        return false;
    else
        throw "whoops8";
}

function translateCullMode(fmat: FMAT): GfxCullMode {
    const cull_mode = translateRenderInfoSingleString(fmat.renderInfo.get('culling')!);
    if (cull_mode === 'front')
        return GfxCullMode.Front;
    else if (cull_mode === 'back')
        return GfxCullMode.Back;
    else if (cull_mode === 'none')
        return GfxCullMode.None;
    else
        throw "whoops9";
}

function translateDepthWrite(fmat: FMAT): boolean {
    return true;
    // return translateRenderInfoBoolean(fmat.renderInfo.get('enable_depth_write')!);
}

function translateDepthCompare(fmat: FMAT): GfxCompareMode {
    // if (fmat.renderInfo.has('depth_test_equal')) {
    //     if (translateRenderInfoBoolean(fmat.renderInfo.get('depth_test_equal')!)) {
    //         return GfxCompareMode.GreaterEqual;
    //     } else {
    //         return GfxCompareMode.Always;
    //     }
    // }
    return GfxCompareMode.Never;
}

class FMATInstance {
    public gfxSamplers: GfxSampler[] = [];
    public textureMapping: TextureMapping[] = [];
    private program: AglProgram;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    constructor(device: GfxDevice, cache: GfxRenderCache, textureHolder: BRTITextureHolder, public fmat: FMAT) {
        this.program = new AglProgram(fmat);

        assert(fmat.samplerInfo.length === fmat.textureName.length);

        this.textureMapping = nArray(AglProgram.s_Orders.length, () => new TextureMapping());
        for (let i = 0; i < fmat.samplerInfo.length; i++) {
            const samplerInfo = fmat.samplerInfo[i];
            const gfxSampler = cache.createSampler({
                wrapS: translateAddressMode(samplerInfo.addrModeU),
                wrapT: translateAddressMode(samplerInfo.addrModeV),
                mipFilter: translateMipFilterMode((samplerInfo.filterMode >>> FilterMode.MipShift) & 0x03),
                minFilter: translateTexFilterMode((samplerInfo.filterMode >>> FilterMode.MinShift) & 0x03),
                magFilter: translateTexFilterMode((samplerInfo.filterMode >>> FilterMode.MagShift) & 0x03),
                maxLOD: samplerInfo.maxLOD,
                minLOD: samplerInfo.minLOD,
            });
            this.gfxSamplers.push(gfxSampler);

            const textureName = fmat.textureName[i];
            textureHolder.fillTextureMapping(this.textureMapping[i], textureName);
            (this.textureMapping[i] as any).name = textureName;
            this.textureMapping[i].gfxSampler = gfxSampler;
        }

        this.gfxProgram = cache.createProgram(this.program);

        this.megaStateFlags = {
            cullMode: translateCullMode(fmat),
            // depthCompare: translateDepthCompare(fmat),
            // depthWrite: true,
        };
        // setAttachmentStateSimple(this.megaStateFlags, {
        //     blendMode: GfxBlendMode.Add,
        //     blendSrcFactor: GfxBlendFactor.One,
        //     blendDstFactor: GfxBlendFactor.Zero,
        // });
    }

    public setOnRenderInst(device: GfxDevice, renderInst: GfxRenderInst): void {
        // const isTranslucent = this.program.isTranslucent;
        // const materialLayer = isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        // renderInst.sortKey = makeSortKey(materialLayer, 0);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
    }
}

function translateAttributeFormat(attributeFormat: AttributeFormat): GfxFormat {
    switch (attributeFormat) {
        case AttributeFormat._8_8_Unorm:
            return GfxFormat.U8_RG_NORM;
        case AttributeFormat._8_8_Snorm:
            return GfxFormat.S8_RG_NORM;
        case AttributeFormat._8_8_Uint:
            return GfxFormat.U32_RG;
        case AttributeFormat._8_8_8_8_Unorm:
            return GfxFormat.U8_RGBA_NORM;
        case AttributeFormat._8_8_8_8_Snorm:
            return GfxFormat.S8_RGBA_NORM;
        case AttributeFormat._10_10_10_2_Snorm:
            return GfxFormat.S8_RGBA_NORM;
        case AttributeFormat._16_16_Unorm:
            return GfxFormat.U16_RG_NORM;
        case AttributeFormat._16_16_Snorm:
            return GfxFormat.S16_RG_NORM;
        case AttributeFormat._16_16_Float:
            return GfxFormat.F16_RG;
        case AttributeFormat._16_16_16_16_Float:
            return GfxFormat.F16_RGBA;
        case AttributeFormat._32_32_Float:
            return GfxFormat.F32_RG;
        case AttributeFormat._32_32_32_Float:
            return GfxFormat.F32_RGB;
        default:
            console.error(getChannelFormat(attributeFormat), getTypeFormat(attributeFormat));
            throw "whoops11";
    }
}

interface ConvertedVertexAttribute {
    format: GfxFormat;
    data: ArrayBufferLike;
    stride: number;
}

class FVTXData {
    public vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
    public inputBufferDescriptors: (GfxInputLayoutBufferDescriptor | null)[] = [];
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[] = [];

    constructor(device: GfxDevice, public fvtx: FVTX) {
        let nextBufferIndex = fvtx.vertexBuffers.length;

        for (let i = 0; i < fvtx.vertexAttributes.length; i++) {
            const vertexAttribute = fvtx.vertexAttributes[i];
            const bufferIndex = vertexAttribute.bufferIndex;

            if (this.inputBufferDescriptors[bufferIndex] === undefined)
                this.inputBufferDescriptors[bufferIndex] = null;

            const attribLocation = AglProgram.a_Orders.indexOf(vertexAttribute.name);
            if (attribLocation < 0)
                continue;

            const vertexBuffer = fvtx.vertexBuffers[bufferIndex];
            const convertedAttribute = this.convertVertexAttribute(vertexAttribute, vertexBuffer);
            if (convertedAttribute !== null) {
                const attribBufferIndex = nextBufferIndex++;

                this.vertexAttributeDescriptors.push({
                    location: attribLocation,
                    format: convertedAttribute.format,
                    bufferIndex: attribBufferIndex,
                    bufferByteOffset: 0,
                });

                this.inputBufferDescriptors[attribBufferIndex] = {
                    byteStride: convertedAttribute.stride,
                    frequency: GfxVertexBufferFrequency.PerVertex,
                };

                const gfxBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, convertedAttribute.data);
                this.vertexBufferDescriptors[attribBufferIndex] = { buffer: gfxBuffer };
            } else {
                this.vertexAttributeDescriptors.push({
                    location: attribLocation,
                    format: translateAttributeFormat(vertexAttribute.format),
                    bufferIndex: bufferIndex,
                    bufferByteOffset: vertexAttribute.offset,
                });

                if (!this.vertexBufferDescriptors[bufferIndex]) {
                    const gfxBuffer = createBufferFromSlice(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertexBuffer.data);

                    this.inputBufferDescriptors[bufferIndex] = {
                        byteStride: vertexBuffer.stride,
                        frequency: GfxVertexBufferFrequency.PerVertex,
                    };

                    this.vertexBufferDescriptors[bufferIndex] = { buffer: gfxBuffer };
                }
            }
        }
    }

    public convertVertexAttribute(vertexAttribute: FVTX_VertexAttribute, vertexBuffer: FVTX_VertexBuffer): ConvertedVertexAttribute | null {
        switch (vertexAttribute.format) {
            case AttributeFormat._10_10_10_2_Snorm:
                return this.convertVertexAttribute_10_10_10_2_Snorm(vertexAttribute, vertexBuffer);
            default:
                return null;
        }
    }

    public convertVertexAttribute_10_10_10_2_Snorm(vertexAttribute: FVTX_VertexAttribute, vertexBuffer: FVTX_VertexBuffer): ConvertedVertexAttribute {
        function signExtend10(n: number): number {
            return (n << 22) >> 22;
        }

        const numElements = vertexBuffer.data.byteLength / vertexBuffer.stride;
        const format = GfxFormat.S16_RGBA_NORM;
        const out = new Int16Array(numElements * 4);
        const stride = out.BYTES_PER_ELEMENT * 4;
        let dst = 0;
        let offs = vertexAttribute.offset;
        const view = vertexBuffer.data.createDataView();
        for (let i = 0; i < numElements; i++) {
            const n = view.getUint32(offs, true);
            out[dst++] = signExtend10((n >>> 0) & 0x3FF) << 4;
            out[dst++] = signExtend10((n >>> 10) & 0x3FF) << 4;
            out[dst++] = signExtend10((n >>> 20) & 0x3FF) << 4;
            out[dst++] = ((n >>> 30) & 0x03) << 14;
            offs += vertexBuffer.stride;
        }

        return { format, data: out.buffer, stride };
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.vertexBufferDescriptors.length; i++)
            if (this.vertexBufferDescriptors[i])
                device.destroyBuffer(this.vertexBufferDescriptors[i].buffer);
    }
}

class FSHPMeshData {
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;
    public inputLayout: GfxInputLayout;
    public indexBuffer: GfxBuffer;

    constructor(cache: GfxRenderCache, public mesh: FSHP_Mesh, fvtxData: FVTXData, public bone: FSKL_Bone) {
        const indexBufferFormat = translateIndexFormat(mesh.indexFormat);
        this.inputLayout = cache.createInputLayout({
            indexBufferFormat,
            vertexAttributeDescriptors: fvtxData.vertexAttributeDescriptors,
            vertexBufferDescriptors: fvtxData.inputBufferDescriptors,
        });

        this.vertexBufferDescriptors = fvtxData.vertexBufferDescriptors;
        this.indexBuffer = createBufferFromSlice(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, mesh.indexBufferData);
        this.indexBufferDescriptor = { buffer: this.indexBuffer };
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
    }
}

class FSHPData {
    public meshData: FSHPMeshData[] = [];

    constructor(cache: GfxRenderCache, public fshp: FSHP, fvtxData: FVTXData, public bone: FSKL_Bone) {
        for (let i = 0; i < fshp.mesh.length; i++)
            this.meshData.push(new FSHPMeshData(cache, fshp.mesh[i], fvtxData, this.bone));
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.meshData.length; i++)
            this.meshData[i].destroy(device);
    }
}

export class FMDLData {
    public fvtxData: FVTXData[] = [];
    public fshpData: FSHPData[] = [];

    constructor(cache: GfxRenderCache, public fmdl: FMDL) {
        for (let i = 0; i < fmdl.fvtx.length; i++)
            this.fvtxData.push(new FVTXData(cache.device, fmdl.fvtx[i]));
        for (let i = 0; i < fmdl.fshp.length; i++) {
            const fshp = fmdl.fshp[i];
            this.fshpData.push(new FSHPData(cache, fshp, this.fvtxData[fshp.vertexIndex], fmdl.fskl.bones[fshp.boneIndex]));
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.fvtxData.length; i++)
            this.fvtxData[i].destroy(device);
        for (let i = 0; i < this.fshpData.length; i++)
            this.fshpData[i].destroy(device);
    }
}

function translateIndexFormat(indexFormat: IndexFormat): GfxFormat {
    switch (indexFormat) {
        case IndexFormat.Uint8: return GfxFormat.U8_R;
        case IndexFormat.Uint16: return GfxFormat.U16_R;
        case IndexFormat.Uint32: return GfxFormat.U32_R;
        default: throw "whoops12";
    }
}

class FSHPMeshInstance {
    constructor(public meshData: FSHPMeshData) {
        assert(this.meshData.mesh.offset === 0);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setDrawCount(this.meshData.mesh.count);
        renderInst.setVertexInput(this.meshData.inputLayout, this.meshData.vertexBufferDescriptors, this.meshData.indexBufferDescriptor);

        const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera.viewMatrix, this.meshData.mesh.bbox);
        renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
        renderInstManager.submitRenderInst(renderInst);
    }
}

const scratchMatrix = mat4.create();
const bboxScratch = new AABB();
class FSHPInstance {
    private lodMeshInstances: FSHPMeshInstance[] = [];
    public visible = true;

    constructor(public fshpData: FSHPData, private fmatInstance: FMATInstance) {
        this.lodMeshInstances.push(new FSHPMeshInstance(fshpData.meshData[0]));
    }

    public computeShiftMatrix(bone: FSKL_Bone): mat4 {
        const shift = mat4.create();
        mat4.fromRotationTranslationScale(shift, bone.rotation, bone.translation, bone.scale);
        return shift;
    }

    public computeModelView(modelMatrix: mat4, viewerInput: Viewer.ViewerRenderInput): mat4 {
        const viewMatrix = scratchMatrix;
        computeViewMatrix(viewMatrix, viewerInput.camera);
        mat4.mul(viewMatrix, viewMatrix, modelMatrix);
        return viewMatrix;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, modelMatrix: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        const template = renderInstManager.pushTemplate();
        let offs = template.allocateUniformBuffer(AglProgram.ub_ShapeParams, 16 + 16 + 12);
        const d = template.mapUniformBufferF32(AglProgram.ub_ShapeParams);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x4(d, offs, this.computeShiftMatrix(this.fshpData.bone));
        offs += fillMatrix4x3(d, offs, this.computeModelView(modelMatrix, viewerInput));
        this.fmatInstance.setOnRenderInst(device, template);

        for (let i = 0; i < this.lodMeshInstances.length; i++) {
            bboxScratch.transform(this.lodMeshInstances[i].meshData.mesh.bbox, modelMatrix);
            // if (!viewerInput.camera.frustum.contains(bboxScratch))
            //     continue;

            this.lodMeshInstances[i].prepareToRender(device, renderInstManager, viewerInput);
        }

        renderInstManager.popTemplate();
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 8 }];

export class FMDLRenderer {
    public fmatInst: FMATInstance[] = [];
    public fshpInst: FSHPInstance[] = [];
    public modelMatrix = mat4.create();
    public name: string;

    constructor(device: GfxDevice, cache: GfxRenderCache, textureHolder: BRTITextureHolder, fmdlData: FMDLData) {
        const fmdl = fmdlData.fmdl;
        this.name = fmdl.name;
        for (let i = 0; i < fmdl.fmat.length; i++)
            this.fmatInst.push(new FMATInstance(device, cache, textureHolder, fmdl.fmat[i]));

        for (let i = 0; i < fmdlData.fshpData.length; i++) {
            const fshpData = fmdlData.fshpData[i];
            const fmatInstance = this.fmatInst[fshpData.fshp.materialIndex];
            this.fshpInst.push(new FSHPInstance(fshpData, fmatInstance));
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplate();
        template.setBindingLayouts(bindingLayouts);

        for (let i = 0; i < this.fshpInst.length; i++)
            this.fshpInst[i].prepareToRender(device, renderInstManager, this.modelMatrix, viewerInput);

        renderInstManager.popTemplate();
    }
}

export class PMTOKRenderer {
    public renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    public fmdlRenderers: FMDLRenderer[] = [];

    constructor(device: GfxDevice, public textureHolder: BRTITextureHolder) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;

        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);

        this.renderHelper.pushTemplateRenderInst();
        for (let i = 0; i < this.fmdlRenderers.length; i++)
            this.fmdlRenderers[i].prepareToRender(device, renderInstManager, viewerInput);
        this.renderHelper.renderInstManager.popTemplate();

        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
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
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        builder.execute();
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
    }
}
