import { mat4 } from 'gl-matrix';
import { MathConstants } from '../MathHelpers.js';
import { computeViewSpaceDepthFromWorldSpaceAABB, computeViewMatrix } from '../Camera.js';
import { FMAT, FMAT_RenderInfo, FMAT_RenderInfoType, FVTX_VertexAttribute, parseFMAT_ShaderParam_Float, parseFMAT_ShaderParam_Texsrt } from '../fres_nx/bfres.js';
import { ChannelSource, FilterMode, TextureAddressMode } from '../fres_nx/nngfx_enum.js';
import { GfxShaderLibrary } from '../gfx/helpers/GfxShaderLibrary.js';
import { fillMatrix4x4, fillMatrix4x3, fillMatrix4x2, fillVec4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { GfxBlendFactor, GfxBlendMode, GfxCullMode, GfxDevice, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxWrapMode } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxRenderInst, GfxRenderInstManager, setSortKeyDepth, makeSortKey, GfxRendererLayer } from '../gfx/render/GfxRenderInstManager.js';
import { DeviceProgram } from '../Program.js';
import { TextureMapping } from '../TextureHolder.js';
import { assert, nArray } from '../util.js';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers.js';
import { ModelData, ShapeData, ShapeMeshData } from './render_data.js';
import { ViewerRenderInput } from "../viewer.js";
import { OrigamiTextureHolder } from './texture.js';
import { AABB } from '../Geometry.js';

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

const ATTRIBUTE_MAP: Map<string, string> = new Map<string, string>([
    ["_p0", "vec3"], // position
    ["_n0", "vec4"], // normal
    ["_c0", "vec4"], // color, this is always black (???) and extremely rare, just use albedo instead
    ["_t0", "vec4"], // tangent
    ["_b0", "vec4"], // bitangent
    ["_u0", "vec2"], // uv 1
    ["_u1", "vec2"], // uv 2
    ["_i0", "vec4"], // index, varying sizes, assume vec4
    ["_w0", "vec4"], // weight, varying sizes, assume vec4
    ["albedo", ""], // Same format as UVs but doesn't have any data (???)
    ["detail", ""], // Same format as UVs but doesn't have any data (???)
    ["lightmap", ""] // Same format as UVs but doesn't have any data (???)
]);

export class OrigamiProgram extends DeviceProgram {
    public static ub_ShapeParams = 0;
    public static ub_MaterialParams = 1;

    constructor(private fmat: FMAT, private samplers: Map<string, ChannelSource[]>, private vertexAttributes: FVTX_VertexAttribute[]) {
        super();
        this.name = this.fmat.name;
    }

    private getVertAttributeDefs(): string {
        let s = "";
        for (let i = 0; i < this.vertexAttributes.length; i++) {
            const a = this.vertexAttributes[i].name;
            const type = ATTRIBUTE_MAP.get(a);
            if (type === undefined) {
                console.warn("Unknown attribute", a, "for", this.fmat.name);
            } else if (type.length > 0) {
                s += `layout(location = ${i}) in ${type} ${a};\n`;
            }
        }
        return s;
    }

    private getSamplerDefs(): string {
        let s = "";
        for (const sampler of this.samplers.keys()) {
            s += `uniform sampler2D u${sampler};\n`;
        }
        return s;
    }

    private getRemappedColor(name: string, channels: ChannelSource[]): string {
        let s = "vec4(";
        for (const cs of channels) {
            switch (cs) {
                case ChannelSource.Red:
                    s += name + ".r" + ", ";
                    break;
                case ChannelSource.Green:
                    s += name + ".g" + ", ";
                    break;
                case ChannelSource.Blue:
                    s += name + ".b" + ", ";
                    break;
                case ChannelSource.Alpha:
                    s += name + ".a" + ", ";
                    break;
                case ChannelSource.One:
                    s += "1.0, ";
                    break;
                default:
                    s += "0.0, ";
                    break;
            }
        }
        return s.substring(0, s.length - 2) + ")";
    }

    private getTextureColor(samplerName: string, outName: string, uv: string): string {
        let s = "texture(SAMPLER_2D(u" + samplerName + "), " + uv + ")";
        const channels = this.samplers.get(samplerName);
        if (!channels) {
            console.warn("Could not find sampler", samplerName, "for", this.fmat.name);
            return "vec4 " + outName + " = vec4(0.0, 0.0, 0.0, 1.0)";
        }
        assert(channels.length === 4);
        if (channels[0] === ChannelSource.Red && channels[1] === ChannelSource.Green && channels[2] === ChannelSource.Blue && channels[3] === ChannelSource.Alpha) {
            // don't waste frame time remapping most textures that are already RGBA
            return "vec4 " + outName + " = " + s;
        } else {
            const remap = this.getRemappedColor("t" + samplerName, channels);
            return "vec4 t" + samplerName + " = " + s + ";\nvec4 " + outName + " = " + remap;
        }
    }

    private getOptionBoolean(optionName: string, dneValue: boolean = false): boolean {
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

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_ShapeParams {
    Mat4x4 u_Projection;
    Mat3x4 u_ModelView;
};

layout(std140) uniform ub_MaterialParams {
    Mat2x4 u_TexCoordSRT0;
    Mat2x4 u_TexCoordSRT1;
    vec4 u_Floats; // x=glossiness, y=alphaRef, z=yFlip, w=whiteBack
};

${this.getSamplerDefs()}

#ifdef VERT
${this.getVertAttributeDefs()}

out vec4 v_NormalWorld;
out vec4 v_TangentWorld;
out vec4 v_BitangentWorld;
out vec2 v_TexCoord0;
out vec2 v_TexCoord1;
out vec2 v_TexCoord2;
out vec4 v_Floats;

void main() {
    vec3 t_PositionView = UnpackMatrix(u_ModelView) * vec4(_p0, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(t_PositionView, 1.0);
    v_NormalWorld = _n0;
    v_TangentWorld = ${this.getAttribute('_t0', 'vec4(0.0)')};
    v_BitangentWorld = ${this.getAttribute('_b0', 'vec4(0.0)')};
    v_TexCoord0 = UnpackMatrix(u_TexCoordSRT0) * vec4(${this.getAttribute('_u0', 'vec2(0.0)')}, 1.0, 1.0);
    v_TexCoord1 = ${this.getAttribute('_u1', this.getAttribute('_u0', 'vec2(0.0)'))};
    v_TexCoord2 = UnpackMatrix(u_TexCoordSRT1) * vec4(v_TexCoord1, 1.0, 1.0);
    v_Floats = u_Floats;
}
#endif

#ifdef FRAG
in vec4 v_NormalWorld;
in vec4 v_TangentWorld;
in vec4 v_BitangentWorld;
in vec2 v_TexCoord0;
in vec2 v_TexCoord1;
in vec2 v_TexCoord2;
in vec4 v_Floats;

void main() {
    ${this.getTextureColor('_a0', 'color', 'v_TexCoord0')};

    ${this.getOptionBoolean('alpha_test') ? `
    if (color.a < v_Floats.y) {
        discard;
    }` : ``}

    ${this.getOptionBoolean('use_normal_map') ? `
    vec3 t_LightDir = vec3(-0.5, -0.5, -1);
    ${this.getOptionBoolean('metal_mask') ? /* Crude attempt at foil effect, fine for now but a little too bright */`
    ${this.getTextureColor('_n0', 'normalColor', 'v_TexCoord1')};
    vec3 normal = normalize(vec3(normalColor.rg * 2.0 - 1.0, normalColor.b));
    float diffuse = max(dot(normal, normalize(t_LightDir)), 0.0);
    float spec = pow(max(dot(normal, normalize(t_LightDir + vec3(0.0, 0.0, 1.0))), 0.0), 64.0);
    color.rgb *= (diffuse + 0.3) + (spec * 0.8);
    `: /* Adapted from Odyssey's shader */`
    ${this.getTextureColor('_n0', 'normalColor', 'v_TexCoord0')};
    vec3 t_LocalNormal = vec3(normalColor.rg, 0);
    t_LocalNormal.z = sqrt(clamp(1.0 - t_LocalNormal.x*t_LocalNormal.x - t_LocalNormal.y*t_LocalNormal.y, 0.0, 1.0));
    vec3 t_NormalDir = (t_LocalNormal.x * normalize(v_TangentWorld.xyz) + t_LocalNormal.y * normalize(v_BitangentWorld.xyz) + t_LocalNormal.z * v_NormalWorld.xyz);
    float t_LightIntensity = clamp(dot(normalize(t_LightDir), -t_NormalDir), 0.0, 1.0);
    t_LightIntensity = mix(0.6, 1.0, t_LightIntensity);
    color.rgb *= t_LightIntensity;`}
    ` : ''}

    ${this.getOptionBoolean('use_occlusion_map') || this.getOptionBoolean('use_bakeshadow_map') ? `
    ${this.getTextureColor('_m0', 'materialColor', 'v_TexCoord1')};
    ` : ''}
    
    float ambientOcclusion = 1.0;
    ${this.getOptionBoolean('use_occlusion_map') ? `
    ambientOcclusion = mix(1.0, materialColor.r, 0.7);
    ` : ''}

    float bakedShadow = 1.0;
    ${this.getOptionBoolean('use_bakeshadow_map') ? `
    bakedShadow = mix(1.0, materialColor.g, 0.55);
    ` : ''}

    ${this.getTextureColor('_d0', 'detailColor', 'v_TexCoord2')};

    color.rgb *= ambientOcclusion * bakedShadow * mix(1.0, detailColor.b, 0.55);
    color.rgb = pow(color.rgb, vec3(1.0 / 2.2));
    gl_FragColor = color;
}
#endif
`;
}

export class OrigamiModelRenderer {
    public materials: (MaterialInstance | null)[] = [];
    public shapes: ShapeInstance[] = [];
    public shiftMatrices: mat4[] = [];
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
            } else if (material.name.toLowerCase().includes("mt_shadow") || material.name.toLowerCase().endsWith("_sm") || material.samplerInfo.length !== 5) {
                // sometimes the casing is inconsistent for materials (whoops!)
                visible = false;
            }
            if (visible && modelData.config) {
                if (modelData.config.materialWhitelist && !modelData.config.materialWhitelist.includes(material.name)) {
                    visible = false;
                }
                if (modelData.config.materialBlacklist && modelData.config.materialBlacklist.includes(material.name)) {
                    visible = false;
                }
            }
            if (visible) {
                // patch texture names
                for (let i = 0; i < material.textureName.length; i++) {
                    if (!material.textureName[i].startsWith("Cmn_")) material.textureName[i] = `${this.name}_${material.textureName[i]}`;
                }
                // there's probably a better way to do this...
                let attrs = null;
                for (const shapeData of modelData.shapeData) {
                    if (shapeData.shape.materialIndex === matIndex) {
                        // seems like each shape that shares a material will always have the same vertex attributes (don't care about other data here)
                        attrs = shapeData.vertexData.rawAttributes;
                        break;
                    }
                }
                if (!attrs) {
                    console.warn("Could not find associated vertex data for", material.name, "of", this.name);
                } else {
                    this.materials.push(new MaterialInstance(cache, textureHolder, material, attrs));
                }
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
        for (const matrix of this.shiftMatrices) {
            for (const shape of this.shapes) {
                shape.prepareToRender(device, renderInstManager, matrix, viewerInput);
            }
        }
    }
}

class TexSRT {
    public mode = 1;
    public scaleS = 1.0;
    public scaleT = 1.0;
    public rotation = 0.0;
    public translationS = 0.0;
    public translationT = 0.0;
    private matrix: mat4 = mat4.create();

    /**
     * Call this *once* to pre-compute the matrix (rather than calculating the same one each frame)
     */
    public compute(): void {
        const theta = this.rotation * MathConstants.DEG_TO_RAD;
        const sinR = Math.sin(theta);
        const cosR = Math.cos(theta);
        // hardcoded to Maya calcs for now, can't find any other SRT modes in the files
        this.matrix[0] = this.scaleS * cosR;
        this.matrix[4] = this.scaleS * sinR;
        this.matrix[12] = this.scaleS * ((-0.5 * cosR) - (0.5 * sinR - 0.5) - this.translationS);
        this.matrix[1] = this.scaleT * -sinR;
        this.matrix[5] = this.scaleT * cosR;
        this.matrix[13] = this.scaleT * ((-0.5 * cosR) + (0.5 * sinR - 0.5) + this.translationT) + 1.0;
    }

    public fillMatrix(d: Float32Array, offs: number): number {
        return fillMatrix4x2(d, offs, this.matrix);
    }
}

class MaterialInstance {
    public gfxSamplers: GfxSampler[] = [];
    public textureMapping: TextureMapping[] = [];
    private gfxProgram: GfxProgram;
    private isTranslucent: boolean;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private texCoordSRT0 = new TexSRT();
    private texCoordSRT1 = new TexSRT();
    // private texCoordSRT2 = new TexSRT();
    private glossiness = 0.0;
    private alphaRef = 1.0;
    private yFlip = 0.0;
    private whiteBack = 0.0;

    constructor(cache: GfxRenderCache, textureHolder: OrigamiTextureHolder, public material: FMAT, vertexAttributes: FVTX_VertexAttribute[]) {
        for (let i = 0; i < material.samplerInfo.length; i++) {
            const samplerInfo = material.samplerInfo[i];
            const gfxSampler = cache.createSampler({
                wrapS: translateAddressMode(samplerInfo.addrModeU),
                wrapT: translateAddressMode(samplerInfo.addrModeV),
                mipFilter: translateMipFilterMode((samplerInfo.filterMode >>> FilterMode.MipShift) & 3),
                minFilter: translateTexFilterMode((samplerInfo.filterMode >>> FilterMode.MinShift) & 3),
                magFilter: translateTexFilterMode((samplerInfo.filterMode >>> FilterMode.MagShift) & 3),
                maxLOD: samplerInfo.maxLOD,
                minLOD: samplerInfo.minLOD,
            });
            this.gfxSamplers.push(gfxSampler);
        }

        assert(material.samplerInfo.length === material.textureName.length);
        const samplers: Map<string, ChannelSource[]> = new Map();
        this.textureMapping = nArray(material.shaderAssign.samplerAssign.size, () => new TextureMapping());
        let i = 0;
        for (const samplerName of material.shaderAssign.samplerAssign.values()) {
            const samplerIndex = material.samplerInfo.findIndex((samplerInfo) => samplerInfo.name === samplerName);
            if (samplerIndex < 0) {
                assert(false);
            }
            const shaderMapping = this.textureMapping[i++];
            textureHolder.fillTextureMapping(shaderMapping, material.textureName[samplerIndex]);
            shaderMapping.gfxSampler = this.gfxSamplers[samplerIndex];

            const cs = textureHolder.channelSources.get(material.textureName[samplerIndex])!;
            samplers.set(samplerName, cs);
        }

        const program = new OrigamiProgram(material, samplers, vertexAttributes);
        this.gfxProgram = cache.createProgram(program);

        const blend = material.renderInfo.get("blend");
        const blendString = blend ? translateRenderInfoSingleString(blend) : "opaque";
        const blendMode = blendString !== "opaque" ? translateBlendMode(blendString) : null;
        this.isTranslucent = blendMode !== null;

        this.megaStateFlags = {
            cullMode: translateCullMode(material),
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
        // const srt2 = material.shaderParam.find((p) => p.name === "texsrt2");
        const glossiness = material.shaderParam.find((p) => p.name === "glossiness");
        const alphaRef = material.shaderParam.find((p) => p.name === "alpha_ref");
        const yFlip = material.shaderParam.find((p) => p.name === "yflip");
        const whiteBack = material.shaderParam.find((p) => p.name === "white_back");

        if (srt0) {
            parseFMAT_ShaderParam_Texsrt(this.texCoordSRT0, srt0);
            this.texCoordSRT0.compute();
        }
        if (srt1) {
            parseFMAT_ShaderParam_Texsrt(this.texCoordSRT1, srt1);
            this.texCoordSRT1.compute();
        }
        // if (srt2) {
        //     parseFMAT_ShaderParam_Texsrt(this.texCoordSRT2, srt2);
        //     this.texCoordSRT2.compute();
        // }
        if (glossiness) this.glossiness = parseFMAT_ShaderParam_Float(glossiness);
        if (alphaRef) this.alphaRef = parseFMAT_ShaderParam_Float(alphaRef);
        if (yFlip) this.yFlip = parseFMAT_ShaderParam_Float(yFlip);
        if (whiteBack) this.whiteBack = parseFMAT_ShaderParam_Float(whiteBack);
    }

    public fillTemplate(template: GfxRenderInst): void {
        const materialLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        template.sortKey = makeSortKey(materialLayer, 0);
        template.setSamplerBindingsFromTextureMappings(this.textureMapping);
        template.setGfxProgram(this.gfxProgram);
        template.setMegaStateFlags(this.megaStateFlags);

        let offs = template.allocateUniformBuffer(OrigamiProgram.ub_MaterialParams, 20);
        const d = template.mapUniformBufferF32(OrigamiProgram.ub_MaterialParams);
        offs += this.texCoordSRT0.fillMatrix(d, offs);
        offs += this.texCoordSRT1.fillMatrix(d, offs);
        // offs += this.texCoordSRT2.fillMatrix(d, offs);
        offs += fillVec4(d, offs, this.glossiness, this.alphaRef, this.yFlip, this.whiteBack);
    }
}

const viewScratch = mat4.create();
const shiftScratch = mat4.create();
const bboxScratch = new AABB();
class ShapeInstance {
    private meshData: ShapeMeshData;

    constructor(public fshpData: ShapeData, private material: MaterialInstance) {
        this.meshData = fshpData.meshData[0];
    }

    private computeModelView(modelMatrix: mat4, viewerInput: ViewerRenderInput): mat4 {
        const viewMatrix = viewScratch;
        computeViewMatrix(viewMatrix, viewerInput.camera);
        mat4.mul(viewMatrix, viewMatrix, modelMatrix);
        return viewMatrix;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, modelMatrix: mat4, viewerInput: ViewerRenderInput): void {
        mat4.mul(shiftScratch, modelMatrix, this.fshpData.shiftMatrix);
        bboxScratch.transform(this.meshData.mesh.bbox, shiftScratch);
        if (viewerInput.camera.frustum.contains(bboxScratch)) {
            const template = renderInstManager.pushTemplate();

            template.setBindingLayouts([{ numUniformBuffers: 2, numSamplers: this.material.gfxSamplers.length }]);
            let offs = template.allocateUniformBuffer(OrigamiProgram.ub_ShapeParams, 28);
            const d = template.mapUniformBufferF32(OrigamiProgram.ub_ShapeParams);
            offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);
            offs += fillMatrix4x3(d, offs, this.computeModelView(shiftScratch, viewerInput));

            this.material.fillTemplate(template);

            const renderInst = renderInstManager.newRenderInst();
            renderInst.setDrawCount(this.meshData.mesh.count);
            renderInst.setVertexInput(this.meshData.inputLayout, this.meshData.vertexBufferDescriptors, this.meshData.indexBufferDescriptor);
            renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera.viewMatrix, this.meshData.mesh.bbox));
            renderInstManager.submitRenderInst(renderInst);

            renderInstManager.popTemplate();
        }        
    }
}
