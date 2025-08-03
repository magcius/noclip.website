
import { ReadonlyMat4, mat3, mat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { computeViewSpaceDepthFromWorldSpacePoint } from "../Camera.js";
import { Color, White, colorCopy, colorNewCopy } from "../Color.js";
import { Frustum } from "../Geometry.js";
import { getMatrixTranslation, scaleMatrix, transformVec3Mat4w1 } from "../MathHelpers.js";
import { DeviceProgram } from "../Program.js";
import { TextureMapping } from "../TextureHolder.js";
import { makeStaticDataBufferFromSlice } from "../gfx/helpers/BufferHelpers.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers.js";
import { fillColor, fillMatrix4x3, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxBuffer, GfxInputLayout, GfxProgram, GfxBlendFactor, GfxBufferUsage, GfxCompareMode, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayoutBufferDescriptor, GfxMegaStateDescriptor, GfxMipFilterMode, GfxSamplerDescriptor, GfxTexFilterMode, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderInst, GfxRenderInstManager, makeDepthKey, setSortKeyTranslucentDepth } from "../gfx/render/GfxRenderInstManager.js";
import { assert, assertExists, fallbackUndefined, nArray, readString, setBitFlagEnabled } from "../util.js";
import { normalizeTexturePath } from "./ESM.js";
import { NIFParse } from "./NIFParse.js";
import { Globals, ModelCache } from "./Render.js";

export class Stream {
    private offset: number = 0;
    private view: DataView;

    public version: number;

    constructor(private buffer: ArrayBufferSlice) {
        this.view = buffer.createDataView();
    }

    public readBool(): boolean {
        return !!this.readUint32();
    }

    public readUint8(): number {
        return this.view.getUint8(this.offset++);
    }

    public readUint16(): number {
        return this.view.getUint16(this.offset, (this.offset += 2, true));
    }

    public readInt16(): number {
        return this.view.getInt16(this.offset, (this.offset += 2, true));
    }

    public readUint32(): number {
        return this.view.getUint32(this.offset, (this.offset += 4, true));
    }

    public readInt32(): number {
        return this.view.getInt32(this.offset, (this.offset += 4, true));
    }

    public readFloat32(): number {
        return this.view.getFloat32(this.offset, (this.offset += 4, true));
    }

    public readBytes(n: number): ArrayBufferSlice {
        return this.buffer.subarray(this.offset, (this.offset += n, n));
    }

    public readSizedString(): string {
        const num = this.readUint32();
        return readString(this.buffer, this.offset, (this.offset += num, num));
    }

    public readString(): string {
        return this.readSizedString();
    }

    public readLine(max = 0x100): string {
        const buf = this.buffer.createTypedArray(Uint8Array, this.offset);
        let S = '';
        for (let i = 0; i < max; i++) {
            const ch = buf[i];
            this.offset++;
            if (ch === 0x0A)
                break;
            S += String.fromCharCode(ch);
        }
        return S;
    }

    public readVector3(dst: vec3): void {
        vec3.set(dst, this.readFloat32(), this.readFloat32(), this.readFloat32());
    }

    public readMatrix33(dst: mat3): void {
        const m00 = this.readFloat32(), m01 = this.readFloat32(), m02 = this.readFloat32();
        const m10 = this.readFloat32(), m11 = this.readFloat32(), m12 = this.readFloat32();
        const m20 = this.readFloat32(), m21 = this.readFloat32(), m22 = this.readFloat32();
        mat3.set(dst,
            m00, m10, m20,
            m01, m11, m21,
            m02, m12, m22,
        );
    }

    public readColor4(dst: Color): void {
        dst.r = this.readFloat32();
        dst.g = this.readFloat32();
        dst.b = this.readFloat32();
        dst.a = this.readFloat32();
    }

    public readColor3(dst: Color): void {
        dst.r = this.readFloat32();
        dst.g = this.readFloat32();
        dst.b = this.readFloat32();
        dst.a = 1;
    }
}

export interface NiParse {
    parse(stream: Stream): void;
}

export class RecordRef<T> {
    public index: number = -1;

    public parse(stream: Stream): void {
        this.index = stream.readInt32();
    }

    public get(nif: NIF): T | null {
        if (this.index < 0)
            return null;
        return nif.records[this.index] as T;
    }
}

export class NIF {
    public records: NiParse[] = [];
    public rootRecord: NiParse[] = [];

    constructor(buffer: ArrayBufferSlice) {
        const stream = new Stream(buffer);

        const versionString = stream.readLine();
        assert(versionString === 'NetImmerse File Format, Version 4.0.0.2');
    
        const version = stream.readUint32();
        assert(version === 0x04000002);
        stream.version = version;
    
        const numRecords = stream.readUint32();
        for (let i = 0; i < numRecords; i++) {
            const type = stream.readSizedString();
            const record = NIFParse.newRecord(type);
            record.parse(stream);
            this.records.push(record);
        }

        const rootCount = stream.readUint32();
        for (let i = 0; i < rootCount; i++) {
            const idx = stream.readUint32();
            this.rootRecord.push(this.records[idx]);
        }
    }
}

class NiTriShapeData {
    private posBuffer: GfxBuffer;
    private nrmBuffer: GfxBuffer | null = null;
    private clrBuffer: GfxBuffer | null = null;
    private uvBuffer: GfxBuffer[] = [];
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    private indexBufferDescriptor: GfxIndexBufferDescriptor;

    constructor(modelCache: ModelCache, public nif: NIFParse.NiTriShapeData) {
        const cache = modelCache.renderCache, device = modelCache.device;
        this.posBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, assertExists(this.nif.vertices));
        if (this.nif.normals !== null)
            this.nrmBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, this.nif.normals);
        if (this.nif.vertexColors !== null)
            this.clrBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, this.nif.vertexColors);
        for (let i = 0; i < this.nif.uVSets.length; i++)
            this.uvBuffer.push(makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, this.nif.uVSets[i]));
        this.indexBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Index, this.nif.triangles);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: NifShader.a_Position,  format: GfxFormat.F32_RGB,  bufferByteOffset: 0, bufferIndex: 0 },
            { location: NifShader.a_Normal,    format: GfxFormat.F32_RGB,  bufferByteOffset: 0, bufferIndex: 1 },
            { location: NifShader.a_Color0,    format: GfxFormat.F32_RGBA, bufferByteOffset: 0, bufferIndex: 2 },
            { location: NifShader.a_TexCoord0, format: GfxFormat.F32_RG,   bufferByteOffset: 0, bufferIndex: 3 },
        ];

        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 3*4, frequency: GfxVertexBufferFrequency.PerVertex, },
            { byteStride: 3*4, frequency: this.nrmBuffer ? GfxVertexBufferFrequency.PerVertex : GfxVertexBufferFrequency.Constant, },
            { byteStride: 4*4, frequency: this.clrBuffer ? GfxVertexBufferFrequency.PerVertex : GfxVertexBufferFrequency.Constant, },
            { byteStride: 2*4, frequency: this.uvBuffer[0] ? GfxVertexBufferFrequency.PerVertex : GfxVertexBufferFrequency.Constant, },
        ];

        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat: GfxFormat.U16_R });
        this.vertexBufferDescriptors = [
            { buffer: this.posBuffer, byteOffset: 0 },
            { buffer: fallbackUndefined(this.nrmBuffer, modelCache.zeroBuffer), byteOffset: 0 },
            { buffer: fallbackUndefined(this.clrBuffer, modelCache.zeroBuffer), byteOffset: 0 },
            { buffer: fallbackUndefined(this.uvBuffer[0], modelCache.zeroBuffer), byteOffset: 0 },
        ];
        this.indexBufferDescriptor = { buffer: this.indexBuffer, byteOffset: 0 };
    }

    public setOnRenderInst(renderInst: GfxRenderInst): void {
        renderInst.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);
        renderInst.setDrawCount(this.nif.numTrianglePoints);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.posBuffer);
        if (this.nrmBuffer !== null)
            device.destroyBuffer(this.nrmBuffer);
        if (this.clrBuffer !== null)
            device.destroyBuffer(this.clrBuffer);
        for (let i = 0; i < this.uvBuffer.length; i++)
            device.destroyBuffer(this.uvBuffer[i]);
        device.destroyBuffer(this.indexBuffer);
    }
}

function translateAlphaFunction(mode: NIFParse.AlphaFunction): GfxBlendFactor {
    switch (mode) {
    case NIFParse.AlphaFunction.ONE: return GfxBlendFactor.One;
    case NIFParse.AlphaFunction.ZERO: return GfxBlendFactor.Zero;
    case NIFParse.AlphaFunction.SRC_COLOR: return GfxBlendFactor.Src;
    case NIFParse.AlphaFunction.INV_SRC_COLOR: return GfxBlendFactor.OneMinusSrc;
    case NIFParse.AlphaFunction.DEST_COLOR: return GfxBlendFactor.Dst;
    case NIFParse.AlphaFunction.INV_DEST_COLOR: return GfxBlendFactor.OneMinusDst;
    case NIFParse.AlphaFunction.SRC_ALPHA: return GfxBlendFactor.SrcAlpha;
    case NIFParse.AlphaFunction.INV_SRC_ALPHA: return GfxBlendFactor.OneMinusSrcAlpha;
    case NIFParse.AlphaFunction.DEST_ALPHA: return GfxBlendFactor.DstAlpha;
    case NIFParse.AlphaFunction.INV_DEST_ALPHA: return GfxBlendFactor.OneMinusDstAlpha;
    case NIFParse.AlphaFunction.SRC_ALPHA_SATURATE: return GfxBlendFactor.Src; // ???
    default: throw "whoops";
    }
}

function translateTestFunction(mode: NIFParse.TestFunction): GfxCompareMode {
    switch (mode) {
    case NIFParse.TestFunction.TEST_ALWAYS: return GfxCompareMode.Always;
    case NIFParse.TestFunction.TEST_LESS: return GfxCompareMode.Less;
    case NIFParse.TestFunction.TEST_EQUAL: return GfxCompareMode.Equal;
    case NIFParse.TestFunction.TEST_LESS_EQUAL: return GfxCompareMode.LessEqual;
    case NIFParse.TestFunction.TEST_GREATER: return GfxCompareMode.Greater;
    case NIFParse.TestFunction.TEST_NOT_EQUAL: return GfxCompareMode.NotEqual;
    case NIFParse.TestFunction.TEST_GREATER_EQUAL: return GfxCompareMode.GreaterEqual;
    case NIFParse.TestFunction.TEST_NEVER: return GfxCompareMode.Never;
    default: throw "whoops";
    }
}

enum FeatureFlag {
    HasBaseTexture = 1 << 0,
    HasVertexColor = 1 << 8,
    ColorEmission  = 1 << 9,
}

class NifShader extends DeviceProgram {
    public static MaxInstances = 64;

    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_Color0 = 2;
    public static a_TexCoord0 = 3;

    public static ub_ObjectParams = 1;
    public static ub_InstanceParams = 2;

    public override both = `
precision mediump float;
precision mediump sampler2DArray;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
    vec4 u_SunDirection;
    vec4 u_SunDiffuse;
    vec4 u_SunAmbient;
};

layout(std140) uniform ub_ObjectParams {
    Mat3x4 u_LocalFromNode;
    vec4 u_Misc[1];
    vec4 u_DiffuseColor;
    vec4 u_AmbientColor;
    vec4 u_EmissiveColor;
};

layout(location = 0) uniform sampler2D u_TextureBase;
layout(location = 1) uniform sampler2D u_TextureDark;
layout(location = 2) uniform sampler2D u_TextureDetail;
layout(location = 3) uniform sampler2D u_TextureGloss;
layout(location = 4) uniform sampler2D u_TextureGlow;
layout(location = 5) uniform sampler2D u_TextureBump;
layout(location = 6) uniform sampler2D u_TextureDecal;

#if USE_INSTANCING()
layout(std140) uniform ub_InstanceParams {
    Mat3x4 u_WorldFromLocal[${NifShader.MaxInstances}];
};
#endif

#define u_FeatureFlags (uint(u_Misc[0].x))
#define u_AlphaThreshold (u_Misc[0].y)

bool CheckFeatureFlag(int t_Flag) {
    return (u_FeatureFlags & uint(t_Flag)) != 0u;
}
`;

    public override vert = `
layout(location = ${NifShader.a_Position}) in vec3 a_Position;
layout(location = ${NifShader.a_Normal}) in vec3 a_Normal;
layout(location = ${NifShader.a_Color0}) in vec4 a_Color0;
layout(location = ${NifShader.a_TexCoord0}) in vec2 a_TexCoord0;

${GfxShaderLibrary.saturate}
${GfxShaderLibrary.MulNormalMatrix}

out vec4 v_Color0;
out vec2 v_TexCoord0;

void main() {
    vec3 t_PositionWorld;
    vec3 t_NormalWorld;

#if USE_INSTANCING()
    mat4x3 t_WorldFromNode = mat4x3(mat4(UnpackMatrix(u_WorldFromLocal[gl_InstanceID])) * mat4(UnpackMatrix(u_LocalFromNode)));
#else
    mat4x3 t_WorldFromNode = UnpackMatrix(u_LocalFromNode);
#endif

    t_PositionWorld = t_WorldFromNode * vec4(a_Position, 1.0);
    t_NormalWorld = MulNormalMatrix(t_WorldFromNode, a_Normal);

    gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(t_PositionWorld, 1.0);

    vec4 t_DiffuseColor = u_DiffuseColor;
    vec4 t_AmbientColor = u_AmbientColor;
    vec4 t_EmissiveColor = u_EmissiveColor;
    if (CheckFeatureFlag(${FeatureFlag.HasVertexColor})) {
        if (CheckFeatureFlag(${FeatureFlag.ColorEmission})) {
            t_EmissiveColor = a_Color0;
        } else {
            t_DiffuseColor = a_Color0;
            t_AmbientColor = a_Color0;
        }
    }

    v_Color0 = vec4(0.0);
    v_Color0 += t_DiffuseColor * saturate(dot(t_NormalWorld, u_SunDirection.xyz)) * u_SunDiffuse;
    v_Color0 += t_AmbientColor * u_SunAmbient;
    v_Color0 += t_EmissiveColor;

    v_Color0.a = u_AmbientColor.a;

    v_TexCoord0 = a_TexCoord0; // TODO(jstpierre): TexGen
}
`;

    public override frag = `
in vec4 v_Color0;
in vec2 v_TexCoord0;

void main() {
    vec4 t_Work = v_Color0;

    if (CheckFeatureFlag(${FeatureFlag.HasBaseTexture})) {
        t_Work *= texture(SAMPLER_2D(u_TextureBase), v_TexCoord0);
    }

    gl_FragColor = t_Work;
}
`;
}

const scratchMatrix = mat4.create();
function calcModelMatrix(dst: mat4, obj: NIFParse.NiAVObject, parentMatrix: ReadonlyMat4 | null = null): void {
    mat4.set(dst,
        obj.rotation[0], obj.rotation[1], obj.rotation[2], 0,
        obj.rotation[3], obj.rotation[4], obj.rotation[5], 0,
        obj.rotation[6], obj.rotation[7], obj.rotation[8], 0,
        0, 0, 0, 1,
    );
    scaleMatrix(dst, dst, obj.scale);
    dst[12] += obj.translation[0];
    dst[13] += obj.translation[1];
    dst[14] += obj.translation[2];
    if (parentMatrix !== null)
        mat4.mul(dst, parentMatrix, dst);
}

const scratchVec3a = vec3.create();
class NiTriShape {
    private data: NiTriShapeData;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private gfxProgramSingle: GfxProgram;
    private gfxProgramInstanced: GfxProgram;
    private textureMapping: TextureMapping[] = nArray(7, () => new TextureMapping());
    private alphaThreshold: number;
    private featureFlags: number = 0;
    public diffuseColor = colorNewCopy(White);
    public ambientColor = colorNewCopy(White);
    public emissiveColor = colorNewCopy(White);
    public specularColor = colorNewCopy(White);
    public isOpa: boolean = true;
    private modelMatrix = mat4.create();

    constructor(modelCache: ModelCache, private nif: NIFParse.NiTriShape, ctx: NIF, parentMatrix: ReadonlyMat4 | null) {
        calcModelMatrix(this.modelMatrix, this.nif, parentMatrix);

        const geometryData = this.nif.data.get(ctx);
        assert(geometryData instanceof NIFParse.NiTriShapeData);
        this.data = new NiTriShapeData(modelCache, geometryData);

        const program = new NifShader();

        if (this.data.nif.vertexColors !== null)
            this.featureFlags |= FeatureFlag.HasVertexColor;

        this.megaStateFlags.cullMode = GfxCullMode.Back;

        for (let i = 0; i < this.nif.properties.length; i++) {
            const prop = this.nif.properties[i].get(ctx);
            if (prop instanceof NIFParse.NiAlphaProperty) {
                if (prop.flags.alphaBlend) {
                    setAttachmentStateSimple(this.megaStateFlags, {
                        blendSrcFactor: translateAlphaFunction(prop.flags.sourceBlendMode),
                        blendDstFactor: translateAlphaFunction(prop.flags.destinationBlendMode),
                    });
                }

                this.isOpa = prop.flags.noSorter;

                if (prop.flags.alphaTest) {
                    this.alphaThreshold = prop.threshold;
                    assert(prop.flags.testFunc === NIFParse.TestFunction.TEST_GREATER_EQUAL);
                }
            } else if (prop instanceof NIFParse.NiTexturingProperty) {
                this.bindTexture(0, prop.hasBaseTexture, prop.baseTexture, modelCache, ctx);
                this.bindTexture(1, prop.hasDarkTexture, prop.darkTexture, modelCache, ctx);
                this.bindTexture(2, prop.hasDetailTexture, prop.detailTexture, modelCache, ctx);
                this.bindTexture(3, prop.hasGlossTexture, prop.glossTexture, modelCache, ctx);
                this.bindTexture(4, prop.hasGlowTexture, prop.glowTexture, modelCache, ctx);
                this.bindTexture(5, prop.hasBumpMapTexture!, prop.bumpMapTexture, modelCache, ctx);
                this.bindTexture(6, prop.hasDecal0Texture!, prop.decal0Texture, modelCache, ctx);
                // XXX(jstpierre): ApplyMode?
            } else if (prop instanceof NIFParse.NiMaterialProperty) {
                colorCopy(this.diffuseColor, prop.diffuseColor, prop.alpha);
                colorCopy(this.ambientColor, prop.ambientColor);
                colorCopy(this.emissiveColor, prop.emissiveColor);
                colorCopy(this.specularColor, prop.specularColor, prop.glossiness);
            } else if (prop instanceof NIFParse.NiZBufferProperty) {
                this.megaStateFlags.depthCompare = prop.flags.zBufferTest ? reverseDepthForCompareMode(translateTestFunction(prop.flags.testFunc)) : GfxCompareMode.Always;
                this.megaStateFlags.depthWrite = prop.flags.zBufferWrite;
            } else if (prop instanceof NIFParse.NiVertexColorProperty) {
                if (prop.vertexMode === NIFParse.SourceVertexMode.VERT_MODE_SRC_IGNORE) {
                    this.featureFlags &= ~FeatureFlag.HasVertexColor;
                } else if (prop.vertexMode === NIFParse.SourceVertexMode.VERT_MODE_SRC_EMISSIVE) {
                    this.featureFlags |= FeatureFlag.ColorEmission;
                } else if (prop.lightingMode === NIFParse.LightingMode.LIGHT_MODE_EMISSIVE) {
                    // ???
                    this.featureFlags &= ~FeatureFlag.HasVertexColor;
                } else if (prop.lightingMode === NIFParse.LightingMode.LIGHT_MODE_EMI_AMB_DIF) {
                }
            }
        }

        program.setDefineString('USE_INSTANCING()', '0');
        this.gfxProgramSingle = modelCache.renderCache.createProgram(program);

        program.setDefineString('USE_INSTANCING()', '1');
        this.gfxProgramInstanced = modelCache.renderCache.createProgram(program);
    }

    public getBoundingSphere(): NIFParse.NiBound {
        return this.data.nif.boundingSphere;
    }

    private bindTexture(i: number, has: boolean, desc: NIFParse.TexDesc | null, modelCache: ModelCache, ctx: NIF): void {
        this.featureFlags = setBitFlagEnabled(this.featureFlags, 1 << i, has);
        if (!has || desc === null)
            return;

        const dst = this.textureMapping[i];
        const tex = assertExists(desc.source.get(ctx));
        if (tex.useExternal) {
            const filename = normalizeTexturePath(tex.fileName!.string);
            dst.gfxTexture = modelCache.getTexture(filename);
        } else {
            assert(false);
        }

        assert(desc.uVSet <= 1);
        const samplerDesc: GfxSamplerDescriptor = {
            wrapS: desc.clampMode & 2 ? GfxWrapMode.Repeat : GfxWrapMode.Clamp,
            wrapT: desc.clampMode & 1 ? GfxWrapMode.Repeat : GfxWrapMode.Clamp,
            magFilter: GfxTexFilterMode.Point,
            minFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.NoMip,
        };
        switch (desc.filterMode) {
        case NIFParse.TexFilterMode.FILTER_NEAREST:
            break;
        case NIFParse.TexFilterMode.FILTER_BILERP:
            samplerDesc.minFilter = samplerDesc.magFilter = GfxTexFilterMode.Bilinear;
            break;
        case NIFParse.TexFilterMode.FILTER_TRILERP:
            samplerDesc.minFilter = samplerDesc.magFilter = GfxTexFilterMode.Bilinear;
            samplerDesc.mipFilter = GfxMipFilterMode.Linear;
            break;
        case NIFParse.TexFilterMode.FILTER_NEAREST_MIPNEAREST:
            samplerDesc.mipFilter = GfxMipFilterMode.Nearest;
            break;
        case NIFParse.TexFilterMode.FILTER_NEAREST_MIPLERP:
            samplerDesc.mipFilter = GfxMipFilterMode.Linear;
            break;
        case NIFParse.TexFilterMode.FILTER_BILERP_MIPNEAREST:
            samplerDesc.minFilter = samplerDesc.magFilter = GfxTexFilterMode.Bilinear;
            samplerDesc.mipFilter = GfxMipFilterMode.Nearest;
            break;
        case NIFParse.TexFilterMode.FILTER_ANISOTROPIC:
            samplerDesc.minFilter = samplerDesc.magFilter = GfxTexFilterMode.Bilinear;
            samplerDesc.mipFilter = GfxMipFilterMode.Linear;
            samplerDesc.maxAnisotropy = 16;
            break;
        }
        dst.gfxSampler = modelCache.renderCache.createSampler(samplerDesc);
    }

    public setOnRenderInst(renderInst: GfxRenderInst, modelMatrix: ReadonlyMat4): void {
        this.data.setOnRenderInst(renderInst);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

        let offs = renderInst.allocateUniformBuffer(NifShader.ub_ObjectParams, 12 + 4 + 4*3);
        const d = renderInst.mapUniformBufferF32(NifShader.ub_ObjectParams);
        offs += fillMatrix4x3(d, offs, modelMatrix);
        offs += fillVec4(d, offs, this.featureFlags, this.alphaThreshold);
        offs += fillColor(d, offs, this.diffuseColor);
        offs += fillColor(d, offs, this.ambientColor);
        offs += fillColor(d, offs, this.emissiveColor);
    }

    public checkFrustum(frustum: Frustum, parentMatrix: ReadonlyMat4 | null = null): boolean {
        const bound = this.getBoundingSphere();
        transformVec3Mat4w1(scratchVec3a, parentMatrix !== null ? mat4.mul(scratchMatrix, parentMatrix, this.modelMatrix) : this.modelMatrix, bound.center);
        return frustum.containsSphere(scratchVec3a, bound.radius);
    }

    public prepareToRenderInstanced(globals: Globals, renderInstManager: GfxRenderInstManager): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgramInstanced);
        this.setOnRenderInst(renderInst, this.modelMatrix);
        renderInstManager.submitRenderInst(renderInst);
    }

    public prepareToRenderSingle(globals: Globals, renderInstManager: GfxRenderInstManager, parentMatrix: ReadonlyMat4): void {
        const renderInst = renderInstManager.newRenderInst();
        mat4.mul(scratchMatrix, parentMatrix, this.modelMatrix);
        this.setOnRenderInst(renderInst, scratchMatrix);
        getMatrixTranslation(scratchVec3a, scratchMatrix);
        const depth = computeViewSpaceDepthFromWorldSpacePoint(globals.view.viewFromWorldMatrix, scratchVec3a);
        const depthKey = makeDepthKey(depth, true);
        renderInst.sortKey = setSortKeyTranslucentDepth(0, depthKey);
        renderInst.setGfxProgram(this.gfxProgramSingle);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.data.destroy(device);
    }
}

class NodeBase {
    public node: NiNode[] = [];
    public triShape: NiTriShape[] = [];
    public visible = true;

    public parseChildren(modelCache: ModelCache, children: (NiParse | null)[], ctx: NIF, modelMatrix: ReadonlyMat4 | null): void {
        for (let i = 0; i < children.length; i++) {
            const obj = children[i];
            if (obj instanceof NIFParse.NiNode && !(obj instanceof NIFParse.RootCollisionNode))
                this.node.push(new NiNode(modelCache, obj, ctx, modelMatrix));
            else if (obj instanceof NIFParse.NiTriShape)
                this.triShape.push(new NiTriShape(modelCache, obj, ctx, modelMatrix));
        }
    }

    public getTriShapes(): NiTriShape[] {
        if (!this.visible)
            return [];

        const triShape = this.triShape.slice();
        for (let i = 0; i < this.node.length; i++)
            triShape.push(...this.node[i].getTriShapes());
        return triShape;
    }

    public checkFrustum(frustum: Frustum, parentMatrix: ReadonlyMat4): boolean {
        if (!this.visible)
            return false;

        for (let i = 0; i < this.triShape.length; i++)
            if (this.triShape[i].checkFrustum(frustum, parentMatrix))
                return true;
        for (let i = 0; i < this.node.length; i++)
            if (this.node[i].checkFrustum(frustum, parentMatrix))
                return true;
        return false;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.node.length; i++)
            this.node[i].destroy(device);
        for (let i = 0; i < this.triShape.length; i++)
            this.triShape[i].destroy(device);
    }
}

class NiNode extends NodeBase {
    public modelMatrix = mat4.create();

    constructor(modelCache: ModelCache, private nif: NIFParse.NiNode, ctx: NIF, parentMatrix: ReadonlyMat4 | null) {
        super();
        calcModelMatrix(this.modelMatrix, this.nif, parentMatrix);
        const children = this.nif.children.map((child) => child.get(ctx));
        this.parseChildren(modelCache, children, ctx, this.modelMatrix);

        let extraData = this.nif.extraData.get(ctx);
        while (extraData !== null) {
            if (extraData instanceof NIFParse.NiStringExtraData) {
                if (extraData.stringData === 'MRK')
                    this.visible = false;
            }

            extraData = extraData.nextExtraData.get(ctx);
        }
    }
}

export class NIFData extends NodeBase {
    constructor(modelCache: ModelCache, private nif: NIF) {
        super();
        this.parseChildren(modelCache, this.nif.rootRecord, this.nif, null);
    }

    public getMaxInstances(): number {
        return NifShader.MaxInstances;
    }
}
