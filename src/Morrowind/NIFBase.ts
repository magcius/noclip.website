
import { ReadonlyMat4, mat3, mat4, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { Color, White, colorCopy, colorNewCopy } from "../Color.js";
import { computeModelMatrixSRT, transformVec3Mat4w1 } from "../MathHelpers.js";
import { DeviceProgram } from "../Program.js";
import { TextureMapping } from "../TextureHolder.js";
import { makeStaticDataBufferFromSlice } from "../gfx/helpers/BufferHelpers.js";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { fillColor, fillMatrix4x3, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { GfxBlendFactor, GfxBufferUsage, GfxCompareMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayoutBufferDescriptor, GfxMegaStateDescriptor, GfxMipFilterMode, GfxSamplerDescriptor, GfxTexFilterMode, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform.js";
import { GfxBuffer, GfxInputLayout, GfxProgram } from "../gfx/platform/GfxPlatformImpl.js";
import { GfxRenderInst, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { assert, assertExists, fallbackUndefined, nArray, readString, setBitFlagEnabled } from "../util.js";
import { normalizeTexturePath } from "./ESM.js";
import { NIFParse } from "./NIFParse.js";
import { Globals, ModelCache } from "./Render.js";
import { AABB, Frustum } from "../Geometry.js";

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
        return this.view.getUint32(this.offset, (this.offset += 4, true));
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
        mat3.set(dst,
            this.readFloat32(), this.readFloat32(), this.readFloat32(),
            this.readFloat32(), this.readFloat32(), this.readFloat32(),
            this.readFloat32(), this.readFloat32(), this.readFloat32(),
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
        this.index = stream.readUint32();
    }

    public get(nif: NIF): T | null {
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

class NifShader extends DeviceProgram {
    public static MaxInstances = 64;

    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_Color0 = 2;
    public static a_TexCoord0 = 3;

    public static ub_InstanceParams = 1;
    public static ub_ObjectParams = 2;

    public override both = `
precision mediump float;
precision mediump sampler2DArray;

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
};

layout(std140) uniform ub_InstanceParams {
    Mat4x3 u_WorldFromLocal[${NifShader.MaxInstances}];
};

layout(std140) uniform ub_ObjectParams {
    Mat4x3 u_LocalFromNode;
    vec4 u_Misc[1];
    vec4 u_DiffuseColor;
};

#define u_FeatureFlags (uint(u_Misc[0].x))
#define u_AlphaThreshold (u_Misc[0].y)
`;

    public override vert = `
layout(location = ${NifShader.a_Position}) in vec3 a_Position;
layout(location = ${NifShader.a_Normal}) in vec3 a_Normal;
layout(location = ${NifShader.a_Color0}) in vec4 a_Color0;
layout(location = ${NifShader.a_TexCoord0}) in vec2 a_TexCoord0;

out vec3 v_NormalWorld;
out vec4 v_Color0;
out vec2 v_TexCoord0;

void main() {
    Mat4x3 t_WorldFromLocal = u_WorldFromLocal[gl_InstanceID];

    vec3 t_PositionLocal = Mul(u_LocalFromNode, vec4(a_Position, 1.0));
    vec3 t_PositionWorld = Mul(t_WorldFromLocal, vec4(t_PositionLocal, 1.0));
    gl_Position = Mul(u_ClipFromWorld, vec4(t_PositionWorld, 1.0));

    vec3 t_NormalLocal = normalize(Mul(u_LocalFromNode, vec4(t_PositionLocal, 0.0)));
    v_NormalWorld = normalize(Mul(t_WorldFromLocal, vec4(t_PositionLocal, 0.0)));
    v_Color0 = u_DiffuseColor;

    // TODO(jstpierre): Vertex lighting
    if ((u_FeatureFlags & (1u << 8)) != 0u) { // Emissive
        v_Color0 *= a_Color0;
    } else if ((u_FeatureFlags & (1u << 9)) != 0u) { // Diffuse & Ambient
        v_Color0 *= a_Color0;

        vec3 t_SunDirection = normalize(vec3(.2, .5, 1));
        // https://github.com/OpenMW/openmw/blob/master/files/openmw.cfg
        vec3 t_SunAmbient = vec3(137, 140, 160) / 255.0;
        vec3 t_SunDiffuse = vec3(255, 252, 238) / 255.0;
        v_Color0.rgb *= dot(v_NormalWorld, t_SunDirection) * t_SunDiffuse + t_SunAmbient;
    }

    v_TexCoord0 = a_TexCoord0; // TODO(jstpierre): TexGen
}
`;

    public override frag = `
layout(location = 0) uniform sampler2D u_TextureBase;
layout(location = 1) uniform sampler2D u_TextureDark;
layout(location = 2) uniform sampler2D u_TextureDetail;
layout(location = 3) uniform sampler2D u_TextureGloss;
layout(location = 4) uniform sampler2D u_TextureGlow;
layout(location = 5) uniform sampler2D u_TextureBump;
layout(location = 6) uniform sampler2D u_TextureDecal;

in vec3 v_NormalWorld;
in vec4 v_Color0;
in vec2 v_TexCoord0;

void main() {
    vec4 t_Work = v_Color0;
    t_Work *= texture(SAMPLER_2D(u_TextureBase), v_TexCoord0);
    gl_FragColor = t_Work;
}
`;
}

function calcModelMatrix(dst: mat4, obj: NIFParse.NiAVObject, parentMatrix: ReadonlyMat4 | null = null): void {
    computeModelMatrixSRT(dst, obj.scale, obj.scale, obj.scale,
        0, 0, 0,
        obj.translation[0], obj.translation[1], obj.translation[2]);
    if (parentMatrix !== null)
        mat4.mul(dst, parentMatrix, dst);
}

const scratchVec3a = vec3.create();
const scratchMatrix = mat4.create();
class NiTriShape {
    private data: NiTriShapeData;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private gfxProgram: GfxProgram;
    private textureMapping: TextureMapping[] = nArray(7, () => new TextureMapping());
    private alphaThreshold: number;
    private featureFlags: number = 0;
    private diffuseColor = colorNewCopy(White);
    private ambientColor = colorNewCopy(White);
    private emissiveColor = colorNewCopy(White);
    private specularColor = colorNewCopy(White);
    private modelMatrix = mat4.create();

    constructor(modelCache: ModelCache, private nif: NIFParse.NiTriShape, ctx: NIF, parentMatrix: ReadonlyMat4 | null) {
        calcModelMatrix(this.modelMatrix, this.nif, parentMatrix);

        const geometryData = this.nif.data.get(ctx);
        assert(geometryData instanceof NIFParse.NiTriShapeData);
        this.data = new NiTriShapeData(modelCache, geometryData);

        const program = new NifShader();

        if (this.data.nif.vertexColors !== null)
            this.featureFlags |= 1 << 9;

        for (let i = 0; i < this.nif.properties.length; i++) {
            const prop = this.nif.properties[i].get(ctx);
            if (prop instanceof NIFParse.NiAlphaProperty) {
                if (prop.flags.alphaBlend) {
                    setAttachmentStateSimple(this.megaStateFlags, {
                        blendSrcFactor: translateAlphaFunction(prop.flags.sourceBlendMode),
                        blendDstFactor: translateAlphaFunction(prop.flags.destinationBlendMode),
                    });
                }

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
                colorCopy(this.diffuseColor, prop.diffuseColor);
                colorCopy(this.ambientColor, prop.ambientColor);
                colorCopy(this.emissiveColor, prop.emissiveColor);
                colorCopy(this.specularColor, prop.specularColor, prop.glossiness);
            } else if (prop instanceof NIFParse.NiVertexColorProperty) {
                this.featureFlags &= ~0x0300;
                if (prop.vertexMode === NIFParse.SourceVertexMode.VERT_MODE_SRC_IGNORE) {
                    // Nothing
                } else if (prop.vertexMode === NIFParse.SourceVertexMode.VERT_MODE_SRC_EMISSIVE) {
                    this.featureFlags |= 1 << 8;
                } else if (prop.lightingMode === NIFParse.LightingMode.LIGHT_MODE_EMISSIVE) {
                    // ???
                } else if (prop.lightingMode === NIFParse.LightingMode.LIGHT_MODE_EMI_AMB_DIF) {
                    this.featureFlags |= 1 << 9;
                }
            }
        }

        this.gfxProgram = modelCache.renderCache.createProgram(program);
    }

    public getBoundingSphere(): NIFParse.NiBound {
        return this.data.nif.boundingSphere;
    }

    private bindTexture(i: number, has: boolean, desc: NIFParse.TexDesc | null, modelCache: ModelCache, ctx: NIF): void {
        this.featureFlags = setBitFlagEnabled(this.featureFlags, i, has);
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
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

        let offs = renderInst.allocateUniformBuffer(NifShader.ub_ObjectParams, 16 + 8);
        const d = renderInst.mapUniformBufferF32(NifShader.ub_ObjectParams);
        offs += fillMatrix4x3(d, offs, modelMatrix);
        offs += fillVec4(d, offs, this.featureFlags, this.alphaThreshold);
        offs += fillColor(d, offs, this.diffuseColor);
    }

    public checkFrustum(frustum: Frustum, parentMatrix: ReadonlyMat4 | null = null): boolean {
        const bound = this.getBoundingSphere();
        transformVec3Mat4w1(scratchVec3a, parentMatrix !== null ? mat4.mul(scratchMatrix, parentMatrix, this.modelMatrix) : this.modelMatrix, bound.center);
        return frustum.containsSphere(scratchVec3a, bound.radius);
    }

    public prepareToRender(globals: Globals, renderInstManager: GfxRenderInstManager): void {
        const renderInst = renderInstManager.newRenderInst();
        this.setOnRenderInst(renderInst, this.modelMatrix);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.data.destroy(device);
    }
}

class NiNode {
    public node: NiNode[] = [];
    public triShape: NiTriShape[] = [];
    public modelMatrix = mat4.create();

    constructor(modelCache: ModelCache, private nif: NIFParse.NiNode, ctx: NIF, parentMatrix: ReadonlyMat4 | null) {
        calcModelMatrix(this.modelMatrix, this.nif, parentMatrix);

        for (let i = 0; i < this.nif.children.length; i++) {
            const obj = this.nif.children[i].get(ctx);
            if (obj instanceof NIFParse.NiNode && !(obj instanceof NIFParse.RootCollisionNode))
                this.node.push(new NiNode(modelCache, obj, ctx, this.modelMatrix));
            else if (obj instanceof NIFParse.NiTriShape)
                this.triShape.push(new NiTriShape(modelCache, obj, ctx, this.modelMatrix));
        }
    }

    public checkFrustum(frustum: Frustum, parentMatrix: ReadonlyMat4): boolean {
        for (let i = 0; i < this.triShape.length; i++)
            if (this.triShape[i].checkFrustum(frustum, parentMatrix))
                return true;
        for (let i = 0; i < this.node.length; i++)
            if (this.node[i].checkFrustum(frustum, parentMatrix))
                return true;
        return false;
    }

    public prepareToRender(globals: Globals, renderInstManager: GfxRenderInstManager): void {
        for (let i = 0; i < this.node.length; i++)
            this.node[i].prepareToRender(globals, renderInstManager);
        for (let i = 0; i < this.triShape.length; i++)
            this.triShape[i].prepareToRender(globals, renderInstManager);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.node.length; i++)
            this.node[i].destroy(device);
        for (let i = 0; i < this.triShape.length; i++)
            this.triShape[i].destroy(device);
    }
}

export class NIFData {
    public node: NiNode[] = [];
    public triShape: NiTriShape[] = [];

    constructor(modelCache: ModelCache, private nif: NIF) {
        const ctx = this.nif;
        for (let i = 0; i < this.nif.rootRecord.length; i++) {
            const obj = this.nif.rootRecord[i];
            if (obj instanceof NIFParse.NiNode && !(obj instanceof NIFParse.RootCollisionNode))
                this.node.push(new NiNode(modelCache, obj, ctx, null));
            else if (obj instanceof NIFParse.NiTriShape)
                this.triShape.push(new NiTriShape(modelCache, obj, ctx, null));
        }
    }

    public checkFrustum(frustum: Frustum, parentMatrix: ReadonlyMat4): boolean {
        for (let i = 0; i < this.node.length; i++)
            if (this.node[i].checkFrustum(frustum, parentMatrix))
                return true;
        for (let i = 0; i < this.triShape.length; i++)
            if (this.triShape[i].checkFrustum(frustum, parentMatrix))
                return true;
        return false;
    }

    public prepareToRender(globals: Globals, renderInstManager: GfxRenderInstManager): void {
        for (let i = 0; i < this.node.length; i++)
            this.node[i].prepareToRender(globals, renderInstManager);
        for (let i = 0; i < this.triShape.length; i++)
            this.triShape[i].prepareToRender(globals, renderInstManager);
    }

    public getMaxInstances(): number {
        return NifShader.MaxInstances;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.node.length; i++)
            this.node[i].destroy(device);
        for (let i = 0; i < this.triShape.length; i++)
            this.triShape[i].destroy(device);
    }
}
