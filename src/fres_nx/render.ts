
import * as UI from '../ui';
import * as Viewer from '../viewer';
import { TextureHolder, LoadedTexture, TextureMapping } from '../TextureHolder';

import { GfxDevice, GfxTextureDimension, GfxSampler, GfxWrapMode, GfxMipFilterMode, GfxTexFilterMode, GfxCullMode, GfxCompareMode, GfxInputState, GfxInputLayout, GfxBuffer, GfxBufferUsage, GfxFormat, GfxVertexAttributeDescriptor, GfxVertexAttributeFrequency, GfxVertexBufferDescriptor, GfxBufferBinding, GfxBindingLayoutDescriptor, GfxBufferFrequencyHint, GfxHostAccessPass, GfxBlendMode, GfxBlendFactor } from '../gfx/platform/GfxPlatform';

import * as BNTX from './bntx';
import { surfaceToCanvas } from '../fres/bc_texture';
import { translateImageFormat, deswizzle, decompress, getImageFormatString } from './tegra_texture';
import { FMDL, FSHP, FMAT, FMAT_RenderInfo, FMAT_RenderInfoType, FVTX, FSHP_Mesh, FRES, FVTX_VertexAttribute, FVTX_VertexBuffer } from './bfres';
import { GfxRenderInstViewRenderer, GfxRenderInstBuilder, GfxRenderInst, makeSortKey, GfxRendererLayer, setSortKeyDepth } from '../gfx/render/GfxRenderer';
import { TextureAddressMode, FilterMode, IndexFormat, AttributeFormat, getChannelFormat, getTypeFormat } from './nngfx_enum';
import { nArray, assert, assertExists } from '../util';
import { DeviceProgram, DeviceProgramReflection } from '../Program';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { GfxRenderBuffer } from '../gfx/render/GfxRenderBuffer';
import { fillMatrix4x4, fillMatrix4x3 } from '../gfx/helpers/UniformBufferHelpers';
import { mat4 } from 'gl-matrix';
import { computeViewMatrix, computeViewSpaceDepth } from '../Camera';
import { BasicRendererHelper } from '../oot3d/render';
import { AABB } from '../Geometry';

export class BRTITextureHolder extends TextureHolder<BNTX.BRTI> {
    public addFRESTextures(device: GfxDevice, fres: FRES): void {
        const bntxFile = fres.externalFiles.find((f) => f.name === 'textures.bntx');
        for (let i = 0; i < fres.externalFiles.length; i++) {
            if (fres.externalFiles[i].name !== 'textures.bntx') continue;
            const bntx = BNTX.parse(bntxFile.buffer);
            this.addTextures(device, bntx.textures);
            break;
        }
    }

    public loadTexture(device: GfxDevice, textureEntry: BNTX.BRTI): LoadedTexture | null {
        const gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2D,
            pixelFormat: translateImageFormat(textureEntry.imageFormat),
            width: textureEntry.width,
            height: textureEntry.height,
            depth: 1,
            numLevels: textureEntry.mipBuffers.length,
        });
        const canvases: HTMLCanvasElement[] = [];

        const channelFormat = getChannelFormat(textureEntry.imageFormat);

        for (let i = 0; i < textureEntry.mipBuffers.length; i++) {
            const mipLevel = i;

            const buffer = textureEntry.mipBuffers[i];
            const width = Math.max(textureEntry.width >>> mipLevel, 1);
            const height = Math.max(textureEntry.height >>> mipLevel, 1);
            const depth = 1;
            const deswizzled = deswizzle({ buffer, width, height, channelFormat });
            const rgbaTexture = decompress({ ...textureEntry, width, height, depth }, deswizzled);
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
    public static _c0: number = 1;
    public static _u0: number = 2;
    public static _n0: number = 3;
    public static _t0: number = 4;
    public static a_Orders = [ '_p0', '_c0', '_u0', '_n0', '_t0' ];

    public static ub_SceneParams = 0;
    public static ub_MaterialParams = 1;
    public static ub_ShapeParams = 2;

    public isTranslucent: boolean = false;

    constructor(public fmat: FMAT) {
        super();

        this.name = this.fmat.name;
        assert(this.fmat.samplerInfo.length <= 8);

        if (this.getShaderOptionNumber('vtxcolor_type') >= 0)
            this.defines.set('OPT_vtxcolor', '1');

        let alphaIsTranslucent = false;
        try {
            alphaIsTranslucent = this.outputIsTranslucent('o_alpha');
        } catch(e) {
        }

        this.isTranslucent = alphaIsTranslucent && !this.getShaderOptionBoolean(`enable_alphamask`);

        this.frag = this.generateFrag();
    }

    public static globalDefinitions = `
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

uniform sampler2D u_Samplers[8];
`;

    public static programReflection: DeviceProgramReflection = DeviceProgram.parseReflectionDefinitions(AglProgram.globalDefinitions);
    public both = AglProgram.globalDefinitions;

    public lookupSamplerIndex(shadingModelSamplerBindingName: string) {
        // Translate to a local sampler by looking in the sampler map, and then that's the index we use.
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
            return '.rgba'; // ???
        else if (componentMask === 60)
            return '.a';
        else
            throw "whoops";
    }

    public genSample(shadingModelSamplerBindingName: string): string {
        try {
            const samplerIndex = this.lookupSamplerIndex(shadingModelSamplerBindingName);
            const uv = 'v_TexCoord0';
            return `texture(u_Samplers[${samplerIndex}], ${uv})`;
        } catch(e) {
            // TODO(jstpierre): Figure out wtf is going on.
            console.warn(`${this.name}: No sampler by name ${shadingModelSamplerBindingName}`);
            return `vec4(1.0)`;
        }
    }

    public genBlend(instance: number) {
        assert(this.getShaderOptionBoolean(`enable_blend${instance}`));
        // For now, just use the src.
        const src = `${this.genOutput(`blend${instance}_src`)}${this.genOutputCompMask(`blend${instance}_src_ch`)}`;
        return src;
    }

    public genOutputCompMask(optionName: string): string {
        return this.generateComponentMask(this.getShaderOptionNumber(optionName));
    }

    public genOutput(optionName: string): string {
        const n = this.getShaderOptionNumber(optionName);

        // TODO(jstpierre): WaterConnectMT has "15" for a blend1_src, which is used in alpha.
        // The material doesn't have *any* samplers with _a prefix. WTF?
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
            return `vec4(1.0)`; // TODO(jstpierre): What is this?
        else if (kind === 8)
            return this.genBlend(instance);
        else if (kind === 11) {
            // TODO(jstpierre): Is this right?
            if (instance === 0 || instance === 2 || instance === 5)
                return `vec4(0.0)`;
            else if (instance === 6)
                return `vec4(1.0)`;
            else
                throw "whoops";
        } else
            throw "whoops";
    }

    public blendIsTranslucent(instance: number): boolean {
        assert(this.getShaderOptionBoolean(`enable_blend${instance}`));
        // For now, just use the src.
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

    public vert = `
layout(location = ${AglProgram._p0}) in vec3 _p0;
layout(location = ${AglProgram._c0}) in vec4 _c0;
layout(location = ${AglProgram._u0}) in vec2 _u0;
layout(location = ${AglProgram._n0}) in vec4 _n0;
layout(location = ${AglProgram._t0}) in vec4 _t0;

out vec3 v_PositionWorld;
out vec2 v_TexCoord0;
out vec4 v_VtxColor;

out vec4 v_NormalWorld;
out vec4 v_TangentWorld;

void main() {
    gl_Position = u_Projection * mat4(u_ModelView) * vec4(_p0, 1.0);
    v_PositionWorld = _p0.xyz;
    v_TexCoord0 = _u0;
    v_VtxColor = _c0;
    v_NormalWorld = _n0;
    v_TangentWorld = _t0;
}
`;

    public generateFrag() {
        return `
precision mediump float;

in vec3 v_PositionWorld;
in vec2 v_TexCoord0;
in vec4 v_VtxColor;
in vec4 v_NormalWorld;
in vec4 v_TangentWorld;

void main() {
    o_color = vec4(0.0);

${this.condShaderOption(`enable_base_color`, () => `
    vec4 o_base_color = ${this.genOutput(`o_base_color`)};
    o_color += o_base_color;
`)}

    // TODO(jstpierre): When should o_alpha be used?
    o_color.a = ${this.genOutput(`o_alpha`)}${this.genOutputCompMask(`alpha_component`)};

// TODO(jstpierre): How does this interact with enable_base_color_mul_color
#ifdef OPT_vtxcolor
    o_color.rgb *= v_VtxColor.rgb;
#endif

${this.condShaderOption(`enable_normal`, () => `
    vec3 t_Normal = v_NormalWorld.xyz;
    vec3 t_Tangent = normalize(v_TangentWorld.xyz);
    vec3 t_Bitangent = cross(t_Normal, t_Tangent) * v_TangentWorld.w;

    // Perturb normal with map.
    vec3 t_LocalNormal = vec3(${this.genOutput(`o_normal`)}.rg, 0);
    float t_Len2 = 1.0 - t_LocalNormal.x*t_LocalNormal.x - t_LocalNormal.y*t_LocalNormal.y;
    t_LocalNormal.z = sqrt(clamp(t_Len2, 0.0, 1.0));
    vec3 t_NormalDir = (t_LocalNormal.x * t_Tangent + t_LocalNormal.y * t_Bitangent + t_LocalNormal.z * t_Normal);

    vec3 t_LightDir = normalize(vec3(-0.5, -0.5, -1));
    float t_LightIntensity = clamp(dot(t_LightDir, -t_NormalDir), 0.0, 1.0);
    // Don't perturb that much.
    t_LightIntensity = mix(0.5, 1.0, t_LightIntensity);

    o_color.rgb *= t_LightIntensity;
`)}

${this.condShaderOption(`enable_alphamask`, () => `
    // TODO(jstpierre): Dynamic alpha reference value (it should be in the shader params)
    if (o_color.a <= 0.5)
        discard;
`)}

${this.condShaderOption(`enable_emission`, () => `
    vec4 o_emission = ${this.genOutput(`o_emission`)};
`)}

    // Gamma correction.
    o_color.rgb = pow(o_color.rgb, vec3(1.0 / 2.2));
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
    else if (display_face === 'back')
        return GfxCullMode.FRONT;
    else if (display_face === 'both')
        return GfxCullMode.NONE;
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

function translateRenderInfoBlendFactor(renderInfo: FMAT_RenderInfo): GfxBlendFactor {
    const value = translateRenderInfoSingleString(renderInfo);
    if (value === 'src_alpha')
        return GfxBlendFactor.SRC_ALPHA;
    else if (value === 'one_minus_src_alpha')
        return GfxBlendFactor.ONE_MINUS_SRC_ALPHA;
    else if (value === 'one')
        return GfxBlendFactor.ONE;
    else if (value === 'zero')
        return GfxBlendFactor.ZERO;
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

        const program = new AglProgram(fmat);
        this.templateRenderInst.gfxProgram = device.createProgram(program);

        // Fill in our texture mappings.
        assert(fmat.samplerInfo.length === fmat.textureName.length);

        this.textureMapping = nArray(8, () => new TextureMapping());
        for (let i = 0; i < fmat.samplerInfo.length; i++) {
            const samplerInfo = fmat.samplerInfo[i];
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

            const textureName = fmat.textureName[i];
            textureHolder.fillTextureMapping(this.textureMapping[i], textureName);
            (this.textureMapping[i] as any).name = textureName;
            this.textureMapping[i].gfxSampler = gfxSampler;
        }
        this.templateRenderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

        // Render flags.
        const isTranslucent = program.isTranslucent;
        this.templateRenderInst.setMegaStateFlags({
            cullMode:       translateCullMode(fmat),
            depthCompare:   translateDepthCompare(fmat),
            depthWrite:     isTranslucent ? false : translateDepthWrite(fmat),
            blendMode:      isTranslucent ? GfxBlendMode.ADD : GfxBlendMode.NONE,
            blendSrcFactor: translateBlendSrcFactor(fmat),
            blendDstFactor: translateBlendDstFactor(fmat),
        });

        const materialLayer = isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.templateRenderInst.sortKey = makeSortKey(materialLayer, 0);
    }

    public prepareToRender(materialParamsBuffer: GfxRenderBuffer, viewerInput: Viewer.ViewerRenderInput): void {
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.gfxSamplers.length; i++)
            device.destroySampler(this.gfxSamplers[i]);
        device.destroyProgram(this.templateRenderInst.gfxProgram);
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
        // TODO(jstpierre): Get this right. We probably need to convert again like we did for Wii U.
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
        throw "whoops";
    }
}

interface ConvertedVertexAttribute {
    format: GfxFormat;
    data: ArrayBuffer;
    stride: number;
}

class FVTXData {
    public vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[] = [];

    constructor(device: GfxDevice, public fvtx: FVTX) {
        let nextBufferIndex = fvtx.vertexBuffers.length;

        for (let i = 0; i < fvtx.vertexAttributes.length; i++) {
            const vertexAttribute = fvtx.vertexAttributes[i];
            const attribLocation = AglProgram.a_Orders.indexOf(vertexAttribute.name);
            if (attribLocation < 0)
                continue;

            const bufferIndex = vertexAttribute.bufferIndex;
            const vertexBuffer = fvtx.vertexBuffers[bufferIndex];
            const convertedAttribute = this.convertVertexAttribute(vertexAttribute, vertexBuffer);
            if (convertedAttribute !== null) {
                const attribBufferIndex = nextBufferIndex++;

                this.vertexAttributeDescriptors.push({
                    location: attribLocation,
                    format: convertedAttribute.format,
                    bufferIndex: attribBufferIndex,
                    // When we convert the buffer we remove the byte offset.
                    bufferByteOffset: 0,
                    frequency: GfxVertexAttributeFrequency.PER_VERTEX,
                });

                const gfxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, convertedAttribute.data);
                this.vertexBufferDescriptors[attribBufferIndex] = { buffer: gfxBuffer, byteOffset: 0, byteStride: convertedAttribute.stride };
            } else {
                // Can use buffer data directly.
                this.vertexAttributeDescriptors.push({
                    location: attribLocation,
                    format: translateAttributeFormat(vertexAttribute.format),
                    bufferIndex: bufferIndex,
                    bufferByteOffset: vertexAttribute.offset,
                    frequency: GfxVertexAttributeFrequency.PER_VERTEX,
                });

                if (!this.vertexBufferDescriptors[bufferIndex]) {
                    const gfxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vertexBuffer.data.castToBuffer());
                    this.vertexBufferDescriptors[bufferIndex] = { buffer: gfxBuffer, byteOffset: 0, byteStride: vertexBuffer.stride };
                }
            }
        }
    }

    public convertVertexAttribute(vertexAttribute: FVTX_VertexAttribute, vertexBuffer: FVTX_VertexBuffer): ConvertedVertexAttribute {
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
            out[dst++] = signExtend10((n >>>  0) & 0x3FF) << 4;
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

export class FSHPMeshData {
    public inputState: GfxInputState;
    public inputLayout: GfxInputLayout;
    public indexBuffer: GfxBuffer;

    constructor(device: GfxDevice, public mesh: FSHP_Mesh, fvtxData: FVTXData) {
        const indexBufferFormat = translateIndexFormat(mesh.indexFormat);
        this.inputLayout = device.createInputLayout({
            vertexAttributeDescriptors: fvtxData.vertexAttributeDescriptors, indexBufferFormat,
        });
    
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, mesh.indexBufferData.castToBuffer());
        const indexBufferDescriptor: GfxVertexBufferDescriptor = { buffer: this.indexBuffer, byteOffset: 0, byteStride: 0 };
        this.inputState = device.createInputState(this.inputLayout, fvtxData.vertexBufferDescriptors, indexBufferDescriptor);
    }

    public destroy(device: GfxDevice): void {
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
        device.destroyBuffer(this.indexBuffer);
    }
}

export class FSHPData {
    public meshData: FSHPMeshData[] = [];

    constructor(device: GfxDevice, public fshp: FSHP, fvtxData: FVTXData) {
        for (let i = 0; i < fshp.mesh.length; i++)
            this.meshData.push(new FSHPMeshData(device, fshp.mesh[i], fvtxData));
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.meshData.length; i++)
            this.meshData[i].destroy(device);
    }
}

export class FMDLData {
    public fvtxData: FVTXData[] = [];
    public fshpData: FSHPData[] = [];

    constructor(device: GfxDevice, public fmdl: FMDL) {
        for (let i = 0; i < fmdl.fvtx.length; i++)
            this.fvtxData.push(new FVTXData(device, fmdl.fvtx[i]));
        for (let i = 0; i < fmdl.fshp.length; i++) {
            const fshp = fmdl.fshp[i];
            this.fshpData.push(new FSHPData(device, fshp, this.fvtxData[fshp.vertexIndex]));
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
    case IndexFormat.Uint8:  return GfxFormat.U8_R;
    case IndexFormat.Uint16: return GfxFormat.U16_R;
    case IndexFormat.Uint32: return GfxFormat.U32_R;
    default: throw "whoops";
    }
}

class FSHPMeshInstance {
    public renderInsts: GfxRenderInst[] = [];

    constructor(renderInstBuilder: GfxRenderInstBuilder, public meshData: FSHPMeshData) {
        const mesh = meshData.mesh;

        assert(mesh.offset === 0);

        // TODO(jstpierre): Do we have to care about submeshes?
        const renderInst = renderInstBuilder.pushRenderInst();
        renderInst.drawIndexes(mesh.count);
        renderInst.inputState = meshData.inputState;
        this.renderInsts.push(renderInst);
    }

    public prepareToRender(visible: boolean, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.renderInsts.length; i++) {
            this.renderInsts[i].visible = visible;
            if (visible) {
                const depth = computeViewSpaceDepth(viewerInput.camera, this.meshData.mesh.bbox);
                this.renderInsts[i].sortKey = setSortKeyDepth(this.renderInsts[i].sortKey, depth);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.renderInsts.length; i++)
            this.renderInsts[i].destroy();
    }
}

const scratchMatrix = mat4.create();
const bboxScratch = new AABB();
class FSHPInstance {
    private lodMeshInstances: FSHPMeshInstance[] = [];
    public templateRenderInst: GfxRenderInst;
    public visible = true;

    constructor(renderInstBuilder: GfxRenderInstBuilder, public fshpData: FSHPData) {
        // TODO(jstpierre): Joints.
        this.templateRenderInst = renderInstBuilder.pushTemplateRenderInst();
        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, AglProgram.ub_ShapeParams);

        // Only construct the first LOD mesh for now.
        for (let i = 0; i < 1; i++)
            this.lodMeshInstances.push(new FSHPMeshInstance(renderInstBuilder, fshpData.meshData[i]));

        renderInstBuilder.popTemplateRenderInst();
    }

    public computeModelView(modelMatrix: mat4, viewerInput: Viewer.ViewerRenderInput): mat4 {
        // Build view matrix
        const viewMatrix = scratchMatrix;
        computeViewMatrix(viewMatrix, viewerInput.camera);
        mat4.mul(viewMatrix, viewMatrix, modelMatrix);
        return viewMatrix;
    }

    public prepareToRender(shapeParamsBuffer: GfxRenderBuffer, mdlVisible: boolean, modelMatrix: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        let offs = this.templateRenderInst.getUniformBufferOffset(AglProgram.ub_ShapeParams);
        const mappedF32 = shapeParamsBuffer.mapBufferF32(offs, 12);
        offs += fillMatrix4x3(mappedF32, offs, this.computeModelView(modelMatrix, viewerInput));

        for (let i = 0; i < this.lodMeshInstances.length; i++) {
            let visible = mdlVisible;

            if (visible)
                visible = this.visible;

            if (visible) {
                bboxScratch.transform(this.lodMeshInstances[i].meshData.mesh.bbox, modelMatrix);
                visible = viewerInput.camera.frustum.contains(bboxScratch);
            }

            this.lodMeshInstances[i].prepareToRender(visible, viewerInput);
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.lodMeshInstances.length; i++)
            this.lodMeshInstances[i].destroy(device);
    }
}

export class FMDLRenderer {
    public fmatInst: FMATInstance[] = [];
    public fshpInst: FSHPInstance[] = [];
    public renderInstBuilder: GfxRenderInstBuilder;
    public sceneParamsBuffer: GfxRenderBuffer;
    public materialParamsBuffer: GfxRenderBuffer;
    public shapeParamsBuffer: GfxRenderBuffer;
    public templateRenderInst: GfxRenderInst;
    public modelMatrix = mat4.create();
    public visible = true;
    public name: string;

    constructor(device: GfxDevice, public textureHolder: BRTITextureHolder, public fmdlData: FMDLData) {
        this.name = fmdlData.fmdl.name;

        this.sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);
        this.materialParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_MaterialParams`);
        this.shapeParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_ShapeParams`);

        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 0 }, // Scene
            { numUniformBuffers: 1, numSamplers: 8 }, // Material
            { numUniformBuffers: 1, numSamplers: 0 }, // Shape
        ];
        const uniformBuffers = [ this.sceneParamsBuffer, this.materialParamsBuffer, this.shapeParamsBuffer ];

        this.renderInstBuilder = new GfxRenderInstBuilder(device, AglProgram.programReflection, bindingLayouts, uniformBuffers);

        this.templateRenderInst = this.renderInstBuilder.pushTemplateRenderInst();
        this.renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, AglProgram.ub_SceneParams);

        this.translateModel(device);
    }

    public setVisible(v: boolean) {
        this.visible = v;
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
            this.fshpInst[i].prepareToRender(this.shapeParamsBuffer, this.visible, this.modelMatrix, viewerInput);

        this.sceneParamsBuffer.prepareToRender(hostAccessPass);
        this.materialParamsBuffer.prepareToRender(hostAccessPass);
        this.shapeParamsBuffer.prepareToRender(hostAccessPass);
    }

    public translateModel(device: GfxDevice): void {
        for (let i = 0; i < this.fmdlData.fmdl.fmat.length; i++)
            this.fmatInst.push(new FMATInstance(device, this.textureHolder, this.renderInstBuilder, this.fmdlData.fmdl.fmat[i]));
        for (let i = 0; i < this.fmdlData.fshpData.length; i++) {
            const fshpData = this.fmdlData.fshpData[i];
            const fmatInstance = this.fmatInst[fshpData.fshp.materialIndex];
            this.renderInstBuilder.pushTemplateRenderInst(fmatInstance.templateRenderInst);
            this.fshpInst.push(new FSHPInstance(this.renderInstBuilder, fshpData));
            this.renderInstBuilder.popTemplateRenderInst();
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.fmatInst.length; i++)
            this.fmatInst[i].destroy(device);
        for (let i = 0; i < this.fshpInst.length; i++)
            this.fshpInst[i].destroy(device);
        this.sceneParamsBuffer.destroy(device);
        this.materialParamsBuffer.destroy(device);
        this.shapeParamsBuffer.destroy(device);
    }
}

export class BasicFRESRenderer extends BasicRendererHelper {
    public fmdlRenderers: FMDLRenderer[] = [];

    constructor(public textureHolder: BRTITextureHolder) {
        super();
    }

    public createPanels(): UI.Panel[] {
        const layersPanel = new UI.LayerPanel();
        layersPanel.setLayers(this.fmdlRenderers);
        return [layersPanel];
    }

    public addFMDLRenderer(device: GfxDevice, fmdlRenderer: FMDLRenderer): void {
        fmdlRenderer.addToViewRenderer(device, this.viewRenderer);
        this.fmdlRenderers.push(fmdlRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(10, 500000);
        for (let i = 0; i < this.fmdlRenderers.length; i++)
            this.fmdlRenderers[i].prepareToRender(hostAccessPass, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        for (let i = 0; i < this.fmdlRenderers.length; i++)
            this.fmdlRenderers[i].destroy(device);
    }
}
