import { mat4 } from 'gl-matrix';
import { MathConstants } from '../MathHelpers.js';
import { computeViewSpaceDepthFromWorldSpaceAABB, computeViewMatrix } from '../Camera.js';
import { FMAT, FMAT_RenderInfo, FMAT_RenderInfoType, FVTX_VertexAttribute, parseFMAT_ShaderParam_Float, parseFMAT_ShaderParam_Texsrt } from '../fres_nx/bfres.js';
import { ChannelSource, FilterMode, TextureAddressMode } from '../fres_nx/nngfx_enum.js';
import { GfxShaderLibrary } from '../gfx/helpers/GfxShaderLibrary.js';
import { fillMatrix4x4, fillMatrix4x3, fillMatrix4x2, fillVec4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxCullMode, GfxDevice, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxWrapMode } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxRenderInst, GfxRenderInstManager, setSortKeyDepth, makeSortKey, GfxRendererLayer } from '../gfx/render/GfxRenderInstManager.js';
import { DeviceProgram } from '../Program.js';
import { TextureMapping } from '../TextureHolder.js';
import { assert, nArray } from '../util.js';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers.js';
import { ModelData, ShapeData, ShapeMeshData } from './render_data.js';
import { ViewerRenderInput } from "../viewer.js";
import { OrigamiTextureHolder } from './texture.js';

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
            throw `Unknown texture address mode ${addrMode}`;
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
            throw `Unknown mip filter mode ${filterMode}`;
    }
}

function translateTexFilterMode(filterMode: FilterMode): GfxTexFilterMode {
    switch (filterMode) {
        case FilterMode.Linear:
            return GfxTexFilterMode.Bilinear;
        case FilterMode.Point:
            return GfxTexFilterMode.Point;
        default:
            throw `Unknown tex filter mode ${filterMode}`;
    }
}

function translateRenderInfoSingleString(renderInfo: FMAT_RenderInfo): string {
    assert(renderInfo.type === FMAT_RenderInfoType.String);
    if (renderInfo.values.length === 0) {
        return "opaque"; // sometimes blend can be empty???
    }
    return renderInfo.values[0] as string;
}

function translateCullMode(material: FMAT): GfxCullMode {
    const cullValue = material.renderInfo.get("culling");
    if (!cullValue) {
        return GfxCullMode.None;
    }
    const cullMode = translateRenderInfoSingleString(cullValue);
    if (cullMode === "front") {
        return GfxCullMode.Front;
    } else if (cullMode === "back") {
        return GfxCullMode.Back;
    } else if (cullMode === "none") {
        return GfxCullMode.None;
    } else {
        throw `Unknown cull mode ${cullMode}`;
    }
}

function translateBlendMode(blendMode: string): GfxBlendMode {
    if (blendMode === "transadd" || blendMode === "trans" || blendMode === "blend") {
        return GfxBlendMode.Add;
    } else {
        throw `Unknown blend mode ${blendMode}`;
    }
}

const SCRATCH_MATRIX = mat4.create();
const BINDING_LAYOUTS: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 2, numSamplers: 5 }];

export class OrigamiProgram extends DeviceProgram {
    private ATTRIBUTE_MAP: Map<string, string> = new Map<string, string>([
        ["_p0", "vec3"],
        ["_n0", "vec4"],
        ["_c0", "vec4"], // this is always black (???), just use albedo instead
        ["_t0", "vec4"],
        ["_b0", "vec4"],
        ["_u0", "vec2"],
        ["_u1", "vec2"],
        ["_i0", "vec4"],
        ["_w0", "vec4"]
    ]);
    public static samplers = ["_a0", "_d0", "_l0", "_m0", "_n0"];
    public static samplers2 = ["_a0", "_d0", "_n1", "_m0", "_n0"];
    public static ub_ShapeParams = 0;
    public static ub_MaterialParams = 1;

    constructor(private fmat: FMAT, private samplerChannels: ChannelSource[][], private vertexAttributes: FVTX_VertexAttribute[]) {
        super();
        this.name = this.fmat.name;
        this.frag = this.generateFrag();
    }

    private getVertAttributeDefs(): string {
        let s = "";
        for (let i = 0; i < this.vertexAttributes.length; i++) {
            const a = this.vertexAttributes[i].name;
            const type = this.ATTRIBUTE_MAP.get(a);
            if (!type) {
                console.warn("Unknown attribute", a, "for", this.fmat.name);
            } else {
                s += `layout(location = ${i}) in ${type} ${a};\n`;
            }
        }
        return s;
    }

    private translateChannelSource(cs: ChannelSource, name: string): string {
        switch (cs) {
            case ChannelSource.Red:
                return name + ".r";
            case ChannelSource.Green:
                return name + ".g";
            case ChannelSource.Blue:
                return name + ".b";
            case ChannelSource.Alpha:
                return name + ".a";
            case ChannelSource.One:
                return "1.0";
            case ChannelSource.Zero:
                return "0.0";
            default:
                console.warn("Unknown channel source:", cs);
                return "0.0";
        }
    }

    private remapTextureChannels(name: string, channels: ChannelSource[]): string {
        let s = "vec4(";
        for (const cs of channels) {
            s += this.translateChannelSource(cs, name) + ", ";
        }
        return s.substring(0, s.length - 2) + ")";
    }

    private getTextureColor(index: number, outName: string, name: string, uv: string): string {
        let s = "texture(SAMPLER_2D(" + name + "), " + uv + ")";
        const channels = this.samplerChannels[index];
        if (!channels) {
            console.warn("Could not find texture", index, "for", this.fmat.name);
            return "vec4 " + outName + " = vec4(0.0, 0.0, 0.0, 1.0)";
        }
        assert(channels.length === 4);
        if (channels[0] === ChannelSource.Red && channels[1] === ChannelSource.Green && channels[2] === ChannelSource.Blue && channels[3] === ChannelSource.Alpha) {
            // don't waste frame time remapping most textures that are already RGBA
            return "vec4 " + outName + " = " + s;
        } else {
            const remap = this.remapTextureChannels("t" + index.toString(), channels);
            return "vec4 t" + index.toString() + " = " + s + ";\nvec4 " + outName + " = " + remap;
        }
    }

    private getShaderOptionBoolean(optionName: string, dneValue: boolean = false): boolean {
        const optionValue = this.fmat.shaderAssign.shaderOption.get(optionName);
        if (optionValue === undefined) {
            return dneValue;
        }
        assert(optionValue === "0" || optionValue === "1");
        return optionValue === "1";
    }

    public getAttribute(name: string, dneValue: string): string {
        for (const a of this.vertexAttributes) {
            if (a.name === name) {
                return name;
            }
        }
        return dneValue;
    }

    public static globalDefinitions = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_ShapeParams {
    Mat4x4 u_Projection;
    Mat4x4 u_Shift;
    Mat3x4 u_ModelView;
};

layout(std140) uniform ub_MaterialParams {
    Mat2x4 u_TexCoordSRT0;
    Mat2x4 u_TexCoordSRT1;
    Mat2x4 u_TexCoordSRT2;
    vec4 u_Floats; // x=glossiness, y=alphaRef, z=yFlip, w=whiteBack
};

uniform sampler2D u_TextureAlbedo;   // _a0
uniform sampler2D u_TextureDepth;    // _d0
uniform sampler2D u_TextureLight;    // _l0
uniform sampler2D u_TextureMaterial; // _m0
uniform sampler2D u_TextureNormal;   // _n0
`;

    public override both = OrigamiProgram.globalDefinitions;

    public override vert = `
${this.getVertAttributeDefs()}

out vec4 v_NormalWorld;
out vec4 v_TangentWorld;
out vec4 v_BitangentWorld;
out vec2 v_TexCoord0;
out vec2 v_TexCoord1;
out vec2 v_TexCoord2;
out vec4 v_Floats;

void main() {
    vec3 t_PositionView = UnpackMatrix(u_ModelView) * UnpackMatrix(u_Shift) * vec4(_p0, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(t_PositionView, 1.0);
    v_NormalWorld = _n0;
    v_TangentWorld = ${this.getAttribute('_t0', 'vec4(0.0)')};
    v_BitangentWorld = ${this.getAttribute('_b0', 'vec4(0.0)')};
    v_TexCoord0 = UnpackMatrix(u_TexCoordSRT0) * vec4(${this.getAttribute('_u0', 'vec2(0.0)')}, 1.0, 1.0);
    v_TexCoord1 = ${this.getAttribute('_u1', this.getAttribute('_u0', 'vec2(0.0)'))};
    v_TexCoord2 = UnpackMatrix(u_TexCoordSRT1) * vec4(v_TexCoord1, 1.0, 1.0);
    // v_TexCoord3 = UnpackMatrix(u_TexCoordSRT2) * vec4(v_TexCoord1, 1.0, 1.0);
    v_Floats = u_Floats;
}
`;

    public generateFrag() {
        return `
precision highp float;

in vec4 v_NormalWorld;
in vec4 v_TangentWorld;
in vec4 v_BitangentWorld;
in vec2 v_TexCoord0;
in vec2 v_TexCoord1;
in vec2 v_TexCoord2;
in vec4 v_Floats;

void main() {
    ${this.getTextureColor(0, 'color', 'u_TextureAlbedo', 'v_TexCoord0')};

    ${this.getShaderOptionBoolean('alpha_test') ? `
    if (color.a < v_Floats.y) {
        discard;
    }` : ``}

    ${/*Adapted from Odyssey's shader*/
    this.getShaderOptionBoolean('use_normal_map') ? `
    ${this.getTextureColor(4, 'normalTex', 'u_TextureNormal', 'v_TexCoord0')};
    vec3 t_LocalNormal = vec3(normalTex.rg, 0);
    t_LocalNormal.z = sqrt(clamp(1.0 - t_LocalNormal.x*t_LocalNormal.x - t_LocalNormal.y*t_LocalNormal.y, 0.0, 1.0));
    vec3 t_NormalDir = (t_LocalNormal.x * normalize(v_TangentWorld.xyz) + t_LocalNormal.y * normalize(v_BitangentWorld.xyz) + t_LocalNormal.z * v_NormalWorld.xyz);
    vec3 t_LightDir = normalize(vec3(-0.5, -0.5, -1));
    float t_LightIntensity = clamp(dot(t_LightDir, -t_NormalDir), 0.0, 1.0);
    t_LightIntensity = mix(0.6, 1.0, t_LightIntensity);
    color.rgb *= t_LightIntensity;
    ` : ''}

    ${this.getShaderOptionBoolean('use_occlusion_map') || this.getShaderOptionBoolean('use_bakeshadow_map') ? `
    ${this.getTextureColor(3, 'materialColor', 'u_TextureMaterial', 'v_TexCoord1')};
    ` : ''}
    
    float ambientOcclusion = 1.0;
    ${this.getShaderOptionBoolean('use_occlusion_map') ? `
    ambientOcclusion = mix(1.0, materialColor.r, 0.7);
    ` : ''}

    float bakedShadow = 1.0;
    ${this.getShaderOptionBoolean('use_bakeshadow_map') ? `
    bakedShadow = mix(1.0, materialColor.g, 0.55);
    ` : ''}

    ${this.getTextureColor(1, 'depthColor', 'u_TextureDepth', 'v_TexCoord2')};

    color.rgb *= ambientOcclusion * bakedShadow * mix(1.0, depthColor.b, 0.55);
    color.rgb = pow(color.rgb, vec3(1.0 / 2.2));
    gl_FragColor = color;
}
`;
    }
}

export class OrigamiModelRenderer {
    public materials: (MaterialInstance | null)[] = [];
    public shapes: ShapeInstance[] = [];
    public shiftMatrices: mat4[] = [mat4.create()];
    public name: string;

    constructor(cache: GfxRenderCache, textureHolder: OrigamiTextureHolder, modelData: ModelData) {
        this.name = modelData.model.name;
        for (let matIndex = 0; matIndex < modelData.model.fmat.length; matIndex++) {
            const material = modelData.model.fmat[matIndex];
            const shaderAssignExec = material.userData.get("__ShaderAssignExec");
            let visible = true;
            if (shaderAssignExec) {
                for (const s of shaderAssignExec as string[]) {
                    if (s.includes("SetAttribute('visibility', 'false')")) {
                        visible = false;
                        break;
                    }
                }
            } else if (material.name.toLowerCase().includes("mt_shadow") || material.samplerInfo.length !== 5) {
                visible = false;
            }
            if (visible) {
                // patch texture names
                for (let i = 0; i < material.textureName.length; i++) {
                    if (!material.textureName[i].startsWith("Cmn_")) material.textureName[i] = `${this.name}_${material.textureName[i]}`;
                }
                // there's probably a better way to do this...
                let vd = null;
                for (const shapeData of modelData.shapeData) {
                    if (shapeData.shape.materialIndex === matIndex) {
                        // seems like each shape that shares a material will always have the same vertex attributes (don't care about other data here)
                        vd = modelData.vertexData[shapeData.shape.vertexIndex];
                        break;
                    }
                }
                if (!vd) {
                    console.warn("Could not find vertex data for", this.name, material.name);
                }
                this.materials.push(new MaterialInstance(cache, textureHolder, material, vd!.rawAttributes));
            } else {
                // append null for consistent indices
                this.materials.push(null);
            }
        }
        for (const shapeData of modelData.shapeData) {
            const material = this.materials[shapeData.shape.materialIndex];
            if (material) {
                this.shapes.push(new ShapeInstance(shapeData, material));
            }
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const template = renderInstManager.pushTemplate();
        template.setBindingLayouts(BINDING_LAYOUTS);
        for (const matrix of this.shiftMatrices) {
            for (const shape of this.shapes) {
                shape.prepareToRender(device, renderInstManager, matrix, viewerInput);
            }
        }
        renderInstManager.popTemplate();
    }
}

class TexSRT {
    public mode = 1; // unused for now
    public scaleS = 1.0;
    public scaleT = 1.0;
    public rotation = 0.0;
    public translationS = 0.0;
    public translationT = 0.0;

    public calc(dst: mat4): void {
        const theta = this.rotation * MathConstants.DEG_TO_RAD;
        const sinR = Math.sin(theta);
        const cosR = Math.cos(theta);
        mat4.identity(dst);
        dst[0] = this.scaleS * cosR;
        dst[4] = this.scaleS * sinR;
        dst[12] = this.scaleS * ((-0.5 * cosR) - (0.5 * sinR - 0.5) - this.translationS);
        dst[1] = this.scaleT * -sinR;
        dst[5] = this.scaleT * cosR;
        dst[13] = this.scaleT * ((-0.5 * cosR) + (0.5 * sinR - 0.5) + this.translationT) + 1.0;
    }

    public fillMatrix(d: Float32Array, offs: number): number {
        this.calc(SCRATCH_MATRIX);
        return fillMatrix4x2(d, offs, SCRATCH_MATRIX);
    }
}

class MaterialInstance {
    public gfxSamplers: GfxSampler[] = [];
    public textureMapping: TextureMapping[] = [];
    private program: OrigamiProgram;
    private gfxProgram: GfxProgram;
    private isTranslucent: boolean;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private texCoordSRT0 = new TexSRT();
    private texCoordSRT1 = new TexSRT();
    private texCoordSRT2 = new TexSRT();
    private glossiness = 0.0;
    private alphaRef = 1.0;
    private yFlip = 0.0;
    private whiteBack = 0.0;

    constructor(cache: GfxRenderCache, textureHolder: OrigamiTextureHolder, public material: FMAT, vertexAttributes: FVTX_VertexAttribute[]) {
        const channelSources: ChannelSource[][] = [];
        for (const name of material.textureName) {
            channelSources.push(textureHolder.channelSources.get(name)!);
        }
        this.program = new OrigamiProgram(material, channelSources, vertexAttributes);

        for (let i = 0; i < material.samplerInfo.length; i++) {
            const samplerInfo = material.samplerInfo[i];
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
        }

        assert(material.samplerInfo.length === material.textureName.length);
        this.textureMapping = nArray(OrigamiProgram.samplers.length, () => new TextureMapping());
        for (const [shaderSamplerName, samplerName] of material.shaderAssign.samplerAssign.entries()) {
            const samplerIndex = material.samplerInfo.findIndex((samplerInfo) => samplerInfo.name === samplerName);
            let shaderSamplerIndex = OrigamiProgram.samplers.indexOf(shaderSamplerName);
            if (shaderSamplerIndex < 0) {
                // lazy way to handle different sampler configs for now, should be dynamic like attributes
                shaderSamplerIndex = OrigamiProgram.samplers2.indexOf(shaderSamplerName);
                if (shaderSamplerIndex < 0) assert(false);
            }
            assert(samplerIndex >= 0 && shaderSamplerIndex >= 0);
            const shaderMapping = this.textureMapping[shaderSamplerIndex];
            textureHolder.fillTextureMapping(shaderMapping, material.textureName[samplerIndex]);
            shaderMapping.gfxSampler = this.gfxSamplers[samplerIndex];
        }

        this.gfxProgram = cache.createProgram(this.program);

        const blend = material.renderInfo.get("blend");
        const blendString = blend ? translateRenderInfoSingleString(blend) : "opaque";
        const blendMode = blendString !== "opaque" ? translateBlendMode(blendString) : null;
        this.isTranslucent = blendMode !== null;

        this.megaStateFlags = {
            cullMode: translateCullMode(material),
            // depthCompare: translateDepthCompare(fmat),
            depthWrite: !this.isTranslucent,
        };
        if (this.isTranslucent) {
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha
            });
        }

        const srt0 = material.shaderParam.find((p) => p.name === "texsrt0");
        const srt1 = material.shaderParam.find((p) => p.name === "texsrt1");
        const srt2 = material.shaderParam.find((p) => p.name === "texsrt2");
        const glossiness = material.shaderParam.find((p) => p.name === "glossiness");
        const alphaRef = material.shaderParam.find((p) => p.name === "alpha_ref");
        const yFlip = material.shaderParam.find((p) => p.name === "yflip");
        const whiteBack = material.shaderParam.find((p) => p.name === "white_back");

        if (srt0) parseFMAT_ShaderParam_Texsrt(this.texCoordSRT0, srt0);
        if (srt1) parseFMAT_ShaderParam_Texsrt(this.texCoordSRT1, srt1);
        if (srt2) parseFMAT_ShaderParam_Texsrt(this.texCoordSRT2, srt2);
        if (glossiness) this.glossiness = parseFMAT_ShaderParam_Float(glossiness);
        if (alphaRef) this.alphaRef = parseFMAT_ShaderParam_Float(alphaRef);
        if (yFlip) this.yFlip = parseFMAT_ShaderParam_Float(yFlip);
        if (whiteBack) this.whiteBack = parseFMAT_ShaderParam_Float(whiteBack);
    }

    public setOnRenderInst(renderInst: GfxRenderInst): void {
        const materialLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        renderInst.sortKey = makeSortKey(materialLayer, 0);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);

        let offs = renderInst.allocateUniformBuffer(OrigamiProgram.ub_MaterialParams, 28);
        const d = renderInst.mapUniformBufferF32(OrigamiProgram.ub_MaterialParams);
        offs += this.texCoordSRT0.fillMatrix(d, offs);
        offs += this.texCoordSRT1.fillMatrix(d, offs);
        offs += this.texCoordSRT2.fillMatrix(d, offs);
        offs += fillVec4(d, offs, this.glossiness, this.alphaRef, this.yFlip, this.whiteBack);
    }
}

class ShapeInstance {
    private meshData: ShapeMeshData;

    constructor(public fshpData: ShapeData, private material: MaterialInstance) {
        this.meshData = fshpData.meshData[0];
    }

    public computeModelView(modelMatrix: mat4, viewerInput: ViewerRenderInput): mat4 {
        const viewMatrix = SCRATCH_MATRIX;
        computeViewMatrix(viewMatrix, viewerInput.camera);
        mat4.mul(viewMatrix, viewMatrix, modelMatrix);
        return viewMatrix;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, modelMatrix: mat4, viewerInput: ViewerRenderInput): void {
        const template = renderInstManager.pushTemplate();
        let offs = template.allocateUniformBuffer(OrigamiProgram.ub_ShapeParams, 44);
        const d = template.mapUniformBufferF32(OrigamiProgram.ub_ShapeParams);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x4(d, offs, this.fshpData.shiftMatrix);
        offs += fillMatrix4x3(d, offs, this.computeModelView(modelMatrix, viewerInput));

        this.material.setOnRenderInst(template);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setDrawCount(this.meshData.mesh.count);
        renderInst.setVertexInput(this.meshData.inputLayout, this.meshData.vertexBufferDescriptors, this.meshData.indexBufferDescriptor);
        renderInst.sortKey = setSortKeyDepth(
            renderInst.sortKey,
            computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera.viewMatrix, this.meshData.mesh.bbox)
        );
        renderInstManager.submitRenderInst(renderInst);

        renderInstManager.popTemplate();
    }
}
