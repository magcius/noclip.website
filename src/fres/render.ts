
import { GX2AttribFormat, GX2TexClamp, GX2TexXYFilterType, GX2TexMipFilterType, GX2FrontFaceMode, GX2CompareFunction, GX2IndexFormat, GX2SurfaceFormat, GX2BlendCombine, GX2BlendFunction, GX2Dimension } from './gx2_enum';
import * as GX2Texture from './gx2_texture';

import * as Viewer from '../viewer';
import * as UI from '../ui';

import { DeviceProgramReflection, DeviceProgram } from '../Program';
import { assert, nArray } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { Endianness } from '../endian';
import { TextureHolder, LoadedTexture, TextureMapping } from '../TextureHolder';
import { GfxDevice, GfxFormat, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxCompareMode, GfxFrontFaceMode, GfxCullMode, GfxBlendMode, GfxBlendFactor, GfxTextureDescriptor, GfxTextureDimension, GfxInputState, GfxBuffer, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexAttributeFrequency, GfxInputLayout, GfxHostAccessPass, GfxBindingLayoutDescriptor, GfxBufferFrequencyHint, GfxTexture } from '../gfx/platform/GfxPlatform';
import { GX2Surface } from './gx2_surface';
import { DecodedSurface, surfaceToCanvas } from './bc_texture';
import { getFormatCompByteSize, getFormatComponentCount } from '../gfx/platform/GfxPlatformFormat';
import { makeStaticDataBuffer, makeStaticDataBufferFromSlice } from '../gfx/helpers/BufferHelpers';
import { FVTX_VertexAttribute, FVTX_VertexBuffer, FTEXEntry, FRES, FVTX, FSHP_Mesh, FMAT, FSHP, FMDL } from './bfres';
import { GfxRenderInst, GfxRenderInstBuilder, setSortKeyDepth, GfxRenderInstViewRenderer, GfxRendererLayer, makeSortKey } from '../gfx/render/GfxRenderer';
import { computeViewSpaceDepthFromWorldSpaceAABB, computeViewMatrix, computeViewMatrixSkybox } from '../Camera';
import { mat4 } from 'gl-matrix';
import { AABB } from '../Geometry';
import { GfxRenderBuffer } from '../gfx/render/GfxRenderBuffer';
import { fillMatrix4x3, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { BasicRendererHelper } from '../oot3d/render';
import { reverseDepthForCompareMode } from '../gfx/helpers/ReversedDepthHelpers';

class AglProgram extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_MaterialParams = 1;
    public static ub_ShapeParams = 2;

    public static _p0: number = 0;
    public static _c0: number = 1;
    public static _n0: number = 2;
    public static _t0: number = 3;
    public static _u0: number = 4;
    public static _u1: number = 5;
    public static a_Orders = [ '_p0', '_c0', '_n0', '_t0', '_u0', '_u1' ];

    public static s_Orders = [ '_a0', '_n0', '_e0', '_s0' ];

    public static globalDefinitions = `
precision mediump float;

layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(row_major, std140) uniform ub_MaterialParams {
    vec4 u_Misc0;
};

layout(row_major, std140) uniform ub_ShapeParams {
    Mat4x3 u_View;
    Mat4x3 u_ModelView;
};

uniform sampler2D s_a0;
uniform sampler2D s_n0;
uniform sampler2D s_e0;
uniform sampler2D s_s0;
`;

    public static programReflection: DeviceProgramReflection = DeviceProgram.parseReflectionDefinitions(AglProgram.globalDefinitions);
    public both = AglProgram.globalDefinitions;

    public vert = `
layout(location = ${AglProgram._p0}) in vec3 a_p0;
layout(location = ${AglProgram._c0}) in vec3 a_c0;
layout(location = ${AglProgram._n0}) in vec3 a_n0;
layout(location = ${AglProgram._t0}) in vec4 a_t0;
layout(location = ${AglProgram._u0}) in vec2 a_u0;
layout(location = ${AglProgram._u1}) in vec2 a_u1;

out vec3 v_PositionWorld;
out vec2 v_TexCoord0;
out vec2 v_TexCoord1;
out vec3 v_NormalWorld;
out vec4 v_TangentWorld;

out vec3 v_CameraWorld;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ModelView), vec4(a_p0, 1.0)));
    v_PositionWorld = a_p0.xyz;
    v_TexCoord0 = a_u0;
    v_TexCoord1 = a_u1;
    v_NormalWorld = a_n0;
    v_TangentWorld = a_t0;
    // TODO(jstpierre): Don't be dumb.
    // TODO(jstpierre): What to do on Mac?
    v_CameraWorld = inverse(mat4(u_View))[3].xyz;
}
`;

    public frag = `
in vec3 v_PositionWorld;
in vec2 v_TexCoord0;
in vec3 v_NormalWorld;
in vec4 v_TangentWorld;

in vec3 v_CameraWorld;

vec4 textureSRGB(sampler2D s, vec2 uv) {
    return texture(s, uv);
}

void main() {
    vec4 t_TexAlbedo0  = textureSRGB(s_a0, v_TexCoord0);
    vec4 t_TexEmissive = textureSRGB(s_e0, v_TexCoord0);
    vec4 t_TexNormal   = textureSRGB(s_n0, v_TexCoord0);
    vec4 t_TexSpecular = textureSRGB(s_s0, v_TexCoord0);

    // Perturb normal with map.
    vec3 t_Normal = v_NormalWorld.xyz;
    vec3 t_Tangent = normalize(v_TangentWorld.xyz);
    vec3 t_Bitangent = cross(t_Normal, t_Tangent) * v_TangentWorld.w;

    vec3 t_LocalNormal = vec3(t_TexNormal.xy, 0);
    float t_Len2 = 1.0 - t_LocalNormal.x*t_LocalNormal.x - t_LocalNormal.y*t_LocalNormal.y;
    t_LocalNormal.z = sqrt(clamp(t_Len2, 0.0, 1.0));
    vec3 t_NormalDir = (t_LocalNormal.x * t_Tangent + t_LocalNormal.y * t_Bitangent + t_LocalNormal.z * t_Normal);

    vec3 t_ViewDir = normalize(v_PositionWorld.xyz - v_CameraWorld);
    vec3 t_HalfDir = reflect(-t_ViewDir, t_NormalDir);

    // Calulate incident light.
    float t_IncidentDiffuse = 0.0;
    float t_IncidentSpecular = 0.0;

    // Basic directional lighting.
    vec3 t_LightDir = normalize(vec3(-u_View[2].x, 0.0, u_View[2].z));
    // Sky-ish color. If we were better we would use a cubemap...
    const vec3 t_LightColor = vec3(0.9, 0.9, 1.4);
    const float t_SpecPower = 35.0;

    t_IncidentDiffuse += clamp(dot(t_NormalDir, t_LightDir), 0.0, 1.0);
    t_IncidentSpecular += pow(clamp(dot(t_HalfDir, t_LightDir), 0.0, 1.0), t_SpecPower);

    // Dumb constant ambient.
    t_IncidentDiffuse += 0.6;
    t_IncidentSpecular += 0.012;

    vec3 t_DiffuseLight = t_LightColor * t_IncidentDiffuse;
    vec3 t_SpecularLight = t_LightColor * t_IncidentSpecular * t_TexSpecular.x;

    vec4 t_AlbedoColor = t_TexAlbedo0;
    // TODO(jstpierre): Multitex?

    o_color = vec4(0, 0, 0, 0);
    o_color.rgb += t_AlbedoColor.rgb * t_DiffuseLight;
    o_color.rgb += t_SpecularLight;
    o_color.a = t_AlbedoColor.a;

    // TODO(jstpierre): Configurable alpha test
    if (o_color.a < 0.5)
        discard;

    o_color.rgb += t_TexEmissive.rgb;

    // Gamma correction.
    o_color.rgb = pow(o_color.rgb, vec3(1.0 / 2.2));
}
`;
}

export class GX2TextureHolder extends TextureHolder<FTEXEntry> {
    public addFRESTextures(device: GfxDevice, fres: FRES): void {
        this.addTextures(device, fres.ftex);
    }

    public static translateTextureDescriptor(device: GfxDevice, surface: GX2Surface): GfxTextureDescriptor {
        function translateSurfaceFormat(device: GfxDevice, format: GX2SurfaceFormat): GfxFormat {
            // We always decode to software rn.
            if (format & GX2SurfaceFormat.FLAG_SNORM)
                return GfxFormat.S8_RGBA_NORM;
            else if (format & GX2SurfaceFormat.FLAG_SRGB)
                return GfxFormat.U8_RGBA_SRGB;
            else
                return GfxFormat.U8_RGBA;
        }

        function translateSurfaceDimension(dimension: GX2Dimension): GfxTextureDimension {
            switch (dimension) {
            case GX2Dimension._2D:
            case GX2Dimension._2D_MSAA:
                return GfxTextureDimension.n2D;
            case GX2Dimension._2D_ARRAY:
                return GfxTextureDimension.n2D_ARRAY;
            }
        }

        return {
            dimension: translateSurfaceDimension(surface.dimension),
            pixelFormat: translateSurfaceFormat(device, surface.format),
            width: surface.width,
            height: surface.height,
            depth: surface.depth,
            numLevels: surface.numMips,
        };
    }

    protected loadTexture(device: GfxDevice, textureEntry: FTEXEntry): LoadedTexture | null {
        const texture = textureEntry.ftex;
        const surface = texture.surface;

        const gfxTexture = device.createTexture(GX2TextureHolder.translateTextureDescriptor(device, surface));
        device.setResourceName(gfxTexture, textureEntry.name);
        const canvases: HTMLCanvasElement[] = [];

        for (let i = 0; i < surface.numMips; i++) {
            const mipLevel = i;
            const firstCanvas = canvases.length;

            for (let j = 0; j < surface.depth; j++) {
                const canvas = document.createElement('canvas');
                canvas.width = 1;
                canvas.height = 1;
                canvases.push(canvas);
            }

            GX2Texture.decodeSurface(surface, texture.texData, texture.mipData, mipLevel).then((decodedSurface: DecodedSurface) => {
                // Sometimes the surfaces appear to have garbage sizes.
                if (decodedSurface.width === 0 || decodedSurface.height === 0)
                    return;

                // For now, always decompress surfaces in software.
                // TODO(jstpierre): Proper mip streaming.
                const decompressedSurface = GX2Texture.decompressSurface(decodedSurface);
                const hostAccessPass = device.createHostAccessPass();
                hostAccessPass.uploadTextureData(gfxTexture, mipLevel, [decompressedSurface.pixels]);
                device.submitPass(hostAccessPass);

                for (let j = 0; j < surface.depth; j++) {
                    const canvas = canvases[firstCanvas + j];
                    surfaceToCanvas(canvas, decompressedSurface, j);
                }
            });
        }

        const viewerTexture = { name: textureEntry.entry.name, surfaces: canvases };
        return { viewerTexture, gfxTexture };
    }
}

function translateAttributeFormat(format: GX2AttribFormat): GfxFormat | null {
    switch (format) {
    case GX2AttribFormat._8_UINT:            return GfxFormat.U8_R;
    case GX2AttribFormat._8_UNORM:           return GfxFormat.U8_R_NORM;
    case GX2AttribFormat._8_SINT:            return GfxFormat.S8_R; 
    case GX2AttribFormat._8_SNORM:           return GfxFormat.S8_R_NORM;
    case GX2AttribFormat._8_8_UNORM:         return GfxFormat.U8_RG_NORM;
    case GX2AttribFormat._8_8_SNORM:         return GfxFormat.S8_RG_NORM;
    case GX2AttribFormat._8_8_8_8_UNORM:     return GfxFormat.U8_RGBA_NORM;
    case GX2AttribFormat._8_8_8_8_SNORM:     return GfxFormat.S8_RGBA_NORM;
    case GX2AttribFormat._16_16_UNORM:       return GfxFormat.U16_RG_NORM;
    case GX2AttribFormat._16_16_SNORM:       return GfxFormat.S16_RG_NORM;
    case GX2AttribFormat._16_16_FLOAT:       return GfxFormat.F16_RG;
    case GX2AttribFormat._16_16_16_16_FLOAT: return GfxFormat.F16_RGBA;
    case GX2AttribFormat._16_16_16_16_UNORM: return GfxFormat.U16_RGBA_NORM;
    case GX2AttribFormat._16_16_16_16_SNORM: return GfxFormat.S16_RGBA_NORM;
    case GX2AttribFormat._32_32_FLOAT:       return GfxFormat.F32_RG;
    case GX2AttribFormat._32_32_32_FLOAT:    return GfxFormat.F32_RGB;

    case GX2AttribFormat._10_10_10_2_UNORM:
    case GX2AttribFormat._10_10_10_2_SNORM:
        // No native equivalent.
        return null;

    default:
        throw new Error(`Unsupported attribute format ${format}`);
    }
}

function convertVertexBufferCopy(buffer: FVTX_VertexBuffer, attrib: FVTX_VertexAttribute, fmt: GfxFormat, vtxCount: number): ArrayBufferSlice {
    const stride = buffer.stride;
    assert(stride !== 0);

    const compCount = getFormatComponentCount(fmt);
    const compByteSize = getFormatCompByteSize(fmt);
    const numValues = vtxCount * compCount;

    function getOutputBuffer() {
        if (compByteSize === 1)
            return new Uint8Array(numValues);
        else if (compByteSize === 2)
            return new Uint16Array(numValues);
        else if (compByteSize === 4)
            return new Uint32Array(numValues);
        else
            throw new Error();
    }

    const dataView = buffer.data.createDataView();
    const out = getOutputBuffer();

    let offs = attrib.offset;
    let dst = 0;
    for (let i = 0; i < vtxCount; i++) {
        for (let j = 0; j < compCount; j++) {
            let srcOffs = offs + j * compByteSize;
            if (compByteSize === 1)
                out[dst] = dataView.getUint8(srcOffs);
            else if (compByteSize === 2)
                out[dst] = dataView.getUint16(srcOffs);
            else if (compByteSize === 4)
                out[dst] = dataView.getUint32(srcOffs);
            dst++;
        }
        offs += stride;
    }
    return new ArrayBufferSlice(out.buffer);
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
            const convertedAttribute = this.convertVertexAttribute(vertexAttribute, vertexBuffer, fvtx.vtxCount);
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
                // Can use buffer data directly, just need to swizzle it to the correct endianness.
                const fmt = translateAttributeFormat(vertexAttribute.format);
                this.vertexAttributeDescriptors.push({
                    location: attribLocation,
                    format: fmt,
                    bufferIndex: bufferIndex,
                    bufferByteOffset: vertexAttribute.offset,
                    frequency: GfxVertexAttributeFrequency.PER_VERTEX,
                });

                if (!this.vertexBufferDescriptors[bufferIndex]) {
                    const compByteSize = getFormatCompByteSize(fmt);
                    const gfxBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.VERTEX, vertexBuffer.data.convertFromEndianness(Endianness.BIG_ENDIAN, compByteSize));
                    this.vertexBufferDescriptors[bufferIndex] = { buffer: gfxBuffer, byteOffset: 0, byteStride: vertexBuffer.stride };
                }
            }
        }
    }

    public convertVertexAttribute(vertexAttribute: FVTX_VertexAttribute, vertexBuffer: FVTX_VertexBuffer, vtxCount: number): ConvertedVertexAttribute | null {
        // No native WebGL equivalent. Let's see what we can do...
        switch (vertexAttribute.format) {
        case GX2AttribFormat._10_10_10_2_SNORM:
        case GX2AttribFormat._10_10_10_2_UNORM:
            return this.convertVertexAttribute_10_10_10_2(vertexAttribute, vertexBuffer, vtxCount);
        default:
            break;
        }

        const fmt = translateAttributeFormat(vertexAttribute.format);
        const compByteSize = getFormatCompByteSize(fmt);
        const compCount = getFormatComponentCount(fmt);
        const byteStride = compCount * compByteSize;
        if (vertexBuffer.stride <= byteStride && vertexAttribute.offset === 0) {
            // In this case, we can't simply endian-swap, since we don't know the rest of the buffer layout.
            // Will need to convert it to something we can control.
            const newVertexBufferData = convertVertexBufferCopy(vertexBuffer, vertexAttribute, fmt, vtxCount);
            return { format: fmt, data: newVertexBufferData.arrayBuffer, stride: byteStride };
        }

        return null;
    }

    private convertVertexAttribute_10_10_10_2(attrib: FVTX_VertexAttribute, buffer: FVTX_VertexBuffer, vtxCount: number): ConvertedVertexAttribute {
        assert(buffer.stride !== 0);
    
        const compCount = 4;
    
        const numValues = vtxCount * compCount;
    
        let signed: boolean;
        let format: GfxFormat;
        const stride = 8;
        function getOutputBuffer() {
            if (attrib.format === GX2AttribFormat._10_10_10_2_SNORM) {
                format = GfxFormat.S16_RGBA_NORM;
                signed = true;
                return new Int16Array(numValues);
            } else if (attrib.format === GX2AttribFormat._10_10_10_2_UNORM) {
                format = GfxFormat.U16_RGBA_NORM;
                signed = false;
                return new Uint16Array(numValues);
            } else {
                throw new Error("whoops");
            }
        }
    
        const view = buffer.data.createDataView();
        const out = getOutputBuffer();
    
        function signExtend10(n: number): number {
            if (signed)
                return (n << 22) >> 22;
            else
                return n;
        }
    
        let offs = attrib.offset;
        let dst = 0;
        for (let i = 0; i < vtxCount; i++) {
            const n = view.getUint32(offs, false);
            out[dst++] = signExtend10((n >>>  0) & 0x3FF) << 4;
            out[dst++] = signExtend10((n >>> 10) & 0x3FF) << 4;
            out[dst++] = signExtend10((n >>> 20) & 0x3FF) << 4;
            out[dst++] = ((n >>> 30) & 0x03) << 14;
            offs += buffer.stride;
        }

        return { format, stride, data: out.buffer };
    }
    
    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.vertexBufferDescriptors.length; i++)
            if (this.vertexBufferDescriptors[i])
                device.destroyBuffer(this.vertexBufferDescriptors[i].buffer);
    }
}

class FSHPMeshData {
    public inputState: GfxInputState;
    public inputLayout: GfxInputLayout;
    public indexBuffer: GfxBuffer;

    constructor(device: GfxDevice, public mesh: FSHP_Mesh, fvtxData: FVTXData) {
        const indexBufferFormat = translateIndexFormat(mesh.indexFormat);
        this.inputLayout = device.createInputLayout({
            vertexAttributeDescriptors: fvtxData.vertexAttributeDescriptors, indexBufferFormat,
        });
    
        const indexBufferData = this.convertIndexBufferData(mesh.indexFormat, mesh.indexBufferData.data);
        this.indexBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.INDEX, indexBufferData);
        const indexBufferDescriptor: GfxVertexBufferDescriptor = { buffer: this.indexBuffer, byteOffset: 0, byteStride: 0 };
        this.inputState = device.createInputState(this.inputLayout, fvtxData.vertexBufferDescriptors, indexBufferDescriptor);
    }

    private convertIndexBufferData(indexFormat: GX2IndexFormat, indexBufferData: ArrayBufferSlice): ArrayBufferSlice {
        switch (indexFormat) {
        case GX2IndexFormat.U16_LE:
        case GX2IndexFormat.U32_LE:
            return indexBufferData;
        case GX2IndexFormat.U16:
            return indexBufferData.convertFromEndianness(Endianness.BIG_ENDIAN, 2);
        case GX2IndexFormat.U32:
            return indexBufferData.convertFromEndianness(Endianness.BIG_ENDIAN, 4);
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
        device.destroyBuffer(this.indexBuffer);
    }
}

class FSHPData {
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

function translateTexClamp(clampMode: GX2TexClamp): GfxWrapMode {
    switch (clampMode) {
    case GX2TexClamp.CLAMP:
        return GfxWrapMode.CLAMP;
    case GX2TexClamp.WRAP:
        return GfxWrapMode.REPEAT;
    case GX2TexClamp.MIRROR:
        return GfxWrapMode.MIRROR;
    default:
        throw new Error(`Unknown tex clamp mode ${clampMode}`);
    }
}

function translateTexFilter(texFilter: GX2TexXYFilterType): GfxTexFilterMode {
    switch (texFilter) {
    case GX2TexXYFilterType.BILINEAR:
        return GfxTexFilterMode.BILINEAR;
    case GX2TexXYFilterType.POINT:
        return GfxTexFilterMode.POINT;
    }
}

function translateMipFilter(mipFilter: GX2TexMipFilterType): GfxMipFilterMode {
    switch (mipFilter) {
    case GX2TexMipFilterType.NO_MIP:
        return GfxMipFilterMode.NO_MIP;
    case GX2TexMipFilterType.LINEAR:
        return GfxMipFilterMode.LINEAR;
    case GX2TexMipFilterType.POINT:
        return GfxMipFilterMode.NEAREST;
    }
}

function translateFrontFaceMode(frontFaceMode: GX2FrontFaceMode): GfxFrontFaceMode {
    switch (frontFaceMode) {
    case GX2FrontFaceMode.CCW:
        return GfxFrontFaceMode.CCW;
    case GX2FrontFaceMode.CW:
        return GfxFrontFaceMode.CW;
    }
}

function translateCompareFunction(compareFunc: GX2CompareFunction): GfxCompareMode {
    switch (compareFunc) {
    case GX2CompareFunction.NEVER:
        return GfxCompareMode.NEVER;
    case GX2CompareFunction.LESS:
        return GfxCompareMode.LESS;
    case GX2CompareFunction.EQUAL:
        return GfxCompareMode.EQUAL;
    case GX2CompareFunction.LEQUAL:
        return GfxCompareMode.LEQUAL;
    case GX2CompareFunction.GREATER:
        return GfxCompareMode.GREATER;
    case GX2CompareFunction.NOTEQUAL:
        return GfxCompareMode.NEQUAL;
    case GX2CompareFunction.GEQUAL:
        return GfxCompareMode.GEQUAL;
    case GX2CompareFunction.ALWAYS:
        return GfxCompareMode.ALWAYS;
    }
}

function translateCullMode(cullFront: boolean, cullBack: boolean): GfxCullMode {
    if (cullFront && cullBack)
        return GfxCullMode.FRONT_AND_BACK;
    else if (cullFront)
        return GfxCullMode.FRONT;
    else if (cullBack)
        return GfxCullMode.BACK;
    else
        return GfxCullMode.NONE;
}

function translateBlendCombine(enabled: boolean, combine: GX2BlendCombine): GfxBlendMode {
    if (enabled) {
        switch (combine) {
        case GX2BlendCombine.ADD:
            return GfxBlendMode.ADD;
        case GX2BlendCombine.DST_MINUS_SRC:
            return GfxBlendMode.SUBTRACT;
        case GX2BlendCombine.SRC_MINUS_DST:
            return GfxBlendMode.REVERSE_SUBTRACT;
        default:
            throw "whoops";
        }
    } else {
        return GfxBlendMode.NONE;
    }
}

function translateBlendFunction(func: GX2BlendFunction): GfxBlendFactor {
    switch (func) {
    case GX2BlendFunction.ZERO:
        return GfxBlendFactor.ZERO;
    case GX2BlendFunction.ONE:
        return GfxBlendFactor.ONE;

    case GX2BlendFunction.SRC_ALPHA:
    case GX2BlendFunction.SRC1_ALPHA:
        return GfxBlendFactor.SRC_ALPHA;
    case GX2BlendFunction.ONE_MINUS_SRC_ALPHA:
    case GX2BlendFunction.ONE_MINUS_SRC1_ALPHA:
        return GfxBlendFactor.ONE_MINUS_SRC_ALPHA;

    case GX2BlendFunction.DST_ALPHA:
        return GfxBlendFactor.DST_ALPHA;
    case GX2BlendFunction.ONE_MINUS_DST_ALPHA:
        return GfxBlendFactor.ONE_MINUS_DST_ALPHA;

    case GX2BlendFunction.SRC_COLOR:
    case GX2BlendFunction.SRC1_COLOR:
        return GfxBlendFactor.SRC_COLOR;
    case GX2BlendFunction.ONE_MINUS_SRC_COLOR:
    case GX2BlendFunction.ONE_MINUS_SRC1_COLOR:
        return GfxBlendFactor.ONE_MINUS_SRC_COLOR;

    case GX2BlendFunction.DST_COLOR:
        return GfxBlendFactor.DST_COLOR;
    case GX2BlendFunction.ONE_MINUS_DST_COLOR:
        return GfxBlendFactor.ONE_MINUS_DST_COLOR;

    default:
        throw "whoops";
    }
}

class FMATInstance {
    public gfxSamplers: GfxSampler[] = [];
    public textureMapping: TextureMapping[] = [];
    public templateRenderInst: GfxRenderInst;
    private blankTexture: GfxTexture;

    constructor(device: GfxDevice, textureHolder: GX2TextureHolder, renderInstBuilder: GfxRenderInstBuilder, public fmat: FMAT) {
        this.blankTexture = device.createTexture({
            dimension: GfxTextureDimension.n2D, pixelFormat: GfxFormat.U8_RGBA,
            width: 1, height: 1, depth: 1, numLevels: 1
        });

        this.templateRenderInst = renderInstBuilder.newRenderInst();

        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, AglProgram.ub_MaterialParams);

        const program = new AglProgram();
        this.templateRenderInst.setDeviceProgram(program);

        // Fill in our texture mappings.
        this.textureMapping = nArray(8, () => new TextureMapping());
        for (let i = 0; i < AglProgram.s_Orders.length; i++) {
            const samplerName = AglProgram.s_Orders[i];
            const textureAssign = fmat.textureAssigns.find((textureAssign) => textureAssign.attribName === samplerName);

            let boundTexture = false;
            if (textureAssign !== undefined) {
                if (textureHolder.hasTexture(textureAssign.textureName)) {
                    textureHolder.fillTextureMapping(this.textureMapping[i], textureAssign.textureName);

                    const sampler = device.createSampler({
                        wrapS: translateTexClamp(textureAssign.texClampU),
                        wrapT: translateTexClamp(textureAssign.texClampV),
                        minFilter: translateTexFilter(textureAssign.texFilterMin),
                        mipFilter: translateMipFilter(textureAssign.texFilterMip),
                        magFilter: translateTexFilter(textureAssign.texFilterMag),
                        minLOD: textureAssign.minLOD,
                        maxLOD: textureAssign.maxLOD,
                    })
                    this.gfxSamplers.push(sampler);

                    this.textureMapping[i].gfxSampler = sampler;
                    boundTexture = true;
                }
            }

            if (!boundTexture)
                this.textureMapping[i].gfxTexture = this.blankTexture;
        }

        this.templateRenderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

        const isTranslucent = fmat.renderState.blendEnabled;

        // Render flags.
        this.templateRenderInst.setMegaStateFlags({
            cullMode:       translateCullMode(fmat.renderState.cullFront, fmat.renderState.cullBack),
            blendMode:      translateBlendCombine(fmat.renderState.blendEnabled, fmat.renderState.blendColorCombine),
            blendSrcFactor: translateBlendFunction(fmat.renderState.blendSrcColorFunc),
            blendDstFactor: translateBlendFunction(fmat.renderState.blendDstColorFunc),
            depthCompare:   reverseDepthForCompareMode(translateCompareFunction(fmat.renderState.depthCompareFunc)),
            depthWrite:     isTranslucent ? false : fmat.renderState.depthWrite,
            frontFace:      translateFrontFaceMode(fmat.renderState.frontFaceMode),
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
        device.destroyTexture(this.blankTexture);
    }
}

function translateIndexFormat(indexFormat: GX2IndexFormat): GfxFormat {
    // Little-endian translation was done above.
    switch (indexFormat) {
    case GX2IndexFormat.U16:
    case GX2IndexFormat.U16_LE:
        return GfxFormat.U16_R;
    case GX2IndexFormat.U32:
    case GX2IndexFormat.U32_LE:
        return GfxFormat.U32_R;
    default:
        throw new Error(`Unsupported index format ${indexFormat}`);
    }
}

class FSHPMeshInstance {
    public renderInsts: GfxRenderInst[] = [];

    constructor(renderInstBuilder: GfxRenderInstBuilder, public meshData: FSHPMeshData) {
        const mesh = meshData.mesh;

        assert(mesh.offset === 0);

        // TODO(jstpierre): Do we have to care about submeshes?
        const renderInst = renderInstBuilder.pushRenderInst();
        renderInst.setSamplerBindingsInherit();
        renderInst.drawIndexes(mesh.count);
        renderInst.inputState = meshData.inputState;
        this.renderInsts.push(renderInst);
    }

    public prepareToRender(visible: boolean, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.renderInsts.length; i++) {
            this.renderInsts[i].visible = visible;
            if (visible) {
                const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera, this.meshData.mesh.bbox);
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
        this.templateRenderInst.setSamplerBindingsInherit();
        renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, AglProgram.ub_ShapeParams);

        // Only construct the first LOD mesh for now.
        for (let i = 0; i < 1; i++)
            this.lodMeshInstances.push(new FSHPMeshInstance(renderInstBuilder, fshpData.meshData[i]));

        renderInstBuilder.popTemplateRenderInst();
    }

    public prepareToRender(shapeParamsBuffer: GfxRenderBuffer, mdlVisible: boolean, modelMatrix: mat4, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean): void {
        let offs = this.templateRenderInst.getUniformBufferOffset(AglProgram.ub_ShapeParams);
        const mappedF32 = shapeParamsBuffer.mapBufferF32(offs, 24);

        const viewMatrix = scratchMatrix;
        if (isSkybox)
            computeViewMatrixSkybox(viewMatrix, viewerInput.camera);
        else
            computeViewMatrix(viewMatrix, viewerInput.camera);

        offs += fillMatrix4x3(mappedF32, offs, viewMatrix);

        mat4.mul(viewMatrix, viewMatrix, modelMatrix);
        offs += fillMatrix4x3(mappedF32, offs, viewMatrix);

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
    public isSkybox = false;
    public passMask: number = 0x01;
    public name: string;

    constructor(device: GfxDevice, public textureHolder: GX2TextureHolder, public fmdlData: FMDLData) {
        this.name = fmdlData.fmdl.name;

        this.sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);
        this.materialParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_MaterialParams`);
        this.shapeParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_ShapeParams`);

        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 0 }, // Scene
            { numUniformBuffers: 1, numSamplers: 4 }, // Material
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
        this.templateRenderInst.passMask = this.passMask;

        let offs = this.templateRenderInst.getUniformBufferOffset(AglProgram.ub_SceneParams);
        const sceneParamsMapped = this.sceneParamsBuffer.mapBufferF32(offs, 16);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < this.fshpInst.length; i++)
            this.fshpInst[i].prepareToRender(this.shapeParamsBuffer, this.visible, this.modelMatrix, viewerInput, this.isSkybox);

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

    constructor(public textureHolder: GX2TextureHolder) {
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
        for (let i = 0; i < this.fmdlRenderers.length; i++)
            this.fmdlRenderers[i].prepareToRender(hostAccessPass, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        for (let i = 0; i < this.fmdlRenderers.length; i++)
            this.fmdlRenderers[i].destroy(device);
    }
}
