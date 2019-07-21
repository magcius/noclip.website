
import { FLVER, VertexInputSemantic, Material, Primitive, Batch, VertexAttribute } from "./flver";
import { GfxDevice, GfxInputState, GfxInputLayout, GfxFormat, GfxVertexAttributeDescriptor, GfxVertexAttributeFrequency, GfxBufferUsage, GfxBuffer, GfxVertexBufferDescriptor, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxCullMode, GfxMegaStateDescriptor, GfxProgram } from "../gfx/platform/GfxPlatform";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { coalesceBuffer, GfxCoalescedBuffer } from "../gfx/helpers/BufferHelpers";
import { convertToTriangleIndexBuffer, GfxTopology, getTriangleIndexCountForTopologyIndexCount } from "../gfx/helpers/TopologyHelpers";
import { makeSortKey, GfxRendererLayer, setSortKeyDepth } from "../gfx/render/GfxRenderer";
import { DeviceProgram, DeviceProgramReflection } from "../Program";
import { DDSTextureHolder } from "./dds";
import { nArray, assert, assertExists } from "../util";
import { TextureMapping } from "../TextureHolder";
import { mat4, vec4 } from "gl-matrix";
import * as Viewer from "../viewer";
import { Camera, computeViewMatrix, computeViewSpaceDepthFromWorldSpaceAABB } from "../Camera";
import { fillMatrix4x4, fillMatrix4x3, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import { AABB } from "../Geometry";
import { ModelHolder, MaterialDataHolder } from "./scenes";
import { MSB, Part } from "./msb";
import { MathConstants, computeNormalMatrix } from "../MathHelpers";
import { MTD, MTDTexture } from './mtd';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer2';
import { interactiveVizSliderSelect } from '../DebugJunk';

function shouldRenderPrimitive(primitive: Primitive): boolean {
    return primitive.flags === 0;
}

function isLODModel(name: string): boolean {
    // The original game handles LOD models through "draw groups" where when you are on a certain
    // collision mesh, the game will only show models that have any draw group bits in common with the
    // collision triangle. While a reasonable approximation might be to calculate the collision bounds
    // and check if the camera is inside that, parsing collision is too much for us right now. So this
    // is a manual approach.

    const lodModels = [
        // Undead Burg / Parish
        "m2000B1",
        "m2380B1",
        "m2430B1",
        "m2410B1",
        "m3301B1",
        // Anor Londo
        "m8000B1_0000",
        "m8010B1_0000",
        "m8020B1_0000",
        "m8030B1_0000",
    ];

    return lodModels.includes(name);
}

class BatchData {
    public inputStates: GfxInputState[] = [];

    constructor(device: GfxDevice, flverData: FLVERData, public batch: Batch, vertexBuffer: GfxCoalescedBuffer, indexBuffers: GfxCoalescedBuffer[]) {
        const flverInputState = flverData.flver.inputStates[batch.inputStateIndex];
        const buffers: GfxVertexBufferDescriptor[] = [{ buffer: vertexBuffer.buffer, byteOffset: vertexBuffer.wordOffset * 0x04, byteStride: flverInputState.vertexSize }];

        for (let j = 0; j < batch.primitiveIndexes.length; j++) {
            const coaIndexBuffer = indexBuffers.shift();
            const indexBuffer: GfxVertexBufferDescriptor = { buffer: coaIndexBuffer.buffer, byteOffset: coaIndexBuffer.wordOffset * 0x04, byteStride: 0x02 };
            const inputState = device.createInputState(flverData.inputLayouts[flverInputState.inputLayoutIndex], buffers, indexBuffer);
            this.inputStates.push(inputState);
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.inputStates.length; i++)
            device.destroyInputState(this.inputStates[i]);
    }
}

// TODO(jstpierre): Refactor with BatchData
export class FLVERData {
    public inputLayouts: GfxInputLayout[] = [];
    public batchData: BatchData[] = [];
    private indexBuffer: GfxBuffer;
    private vertexBuffer: GfxBuffer;

    constructor(device: GfxDevice, public flver: FLVER) {
        for (let i = 0; i < flver.inputLayouts.length; i++) {
            const inputLayout = flver.inputLayouts[i];

            const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];

            for (let j = 0; j < inputLayout.vertexAttributes.length; j++) {
                const vertexAttributes = inputLayout.vertexAttributes[j];
                const location = this.translateLocation(vertexAttributes);
                if (location < 0)
                    continue;

                vertexAttributeDescriptors.push({
                    location,
                    format: this.translateDataType(vertexAttributes.dataType),
                    bufferByteOffset: vertexAttributes.offset,
                    bufferIndex: 0,
                    frequency: GfxVertexAttributeFrequency.PER_VERTEX,
                });
            }

            this.inputLayouts[i] = device.createInputLayout({
                indexBufferFormat: GfxFormat.U16_R,
                vertexAttributeDescriptors,
            });
        }

        const vertexBufferDatas: ArrayBufferSlice[] = [];
        const indexBufferDatas: ArrayBufferSlice[] = [];
        for (let i = 0; i < flver.inputStates.length; i++)
            vertexBufferDatas.push(flver.inputStates[i].vertexData);
        const vertexBuffers = coalesceBuffer(device, GfxBufferUsage.VERTEX, vertexBufferDatas);
        this.vertexBuffer = vertexBuffers[0].buffer;

        for (let i = 0; i < flver.batches.length; i++) {
            const batch = flver.batches[i];
            for (let j = 0; j < batch.primitiveIndexes.length; j++) {
                const primitive = flver.primitives[batch.primitiveIndexes[j]];
                const triangleIndexData = convertToTriangleIndexBuffer(GfxTopology.TRISTRIP, primitive.indexData.createTypedArray(Uint16Array));
                indexBufferDatas.push(new ArrayBufferSlice(triangleIndexData.buffer));
            }
        }

        const indexBuffers = coalesceBuffer(device, GfxBufferUsage.INDEX, indexBufferDatas);
        this.indexBuffer = indexBuffers[0].buffer;

        for (let i = 0; i < flver.batches.length; i++) {
            const batch = flver.batches[i];
            const coaVertexBuffer = vertexBuffers[batch.inputStateIndex];
            const batchData = new BatchData(device, this, batch, coaVertexBuffer, indexBuffers);
            this.batchData.push(batchData);
        }
    }

    private translateLocation(attr: VertexAttribute): number {
        switch (attr.semantic) {
        case VertexInputSemantic.Position:  return DKSProgram.a_Position;
        case VertexInputSemantic.Color:     return DKSProgram.a_Color;
        case VertexInputSemantic.UV:        {
            if (attr.index === 0)
                return DKSProgram.a_TexCoord0;
            else if (attr.index === 1)
                return DKSProgram.a_TexCoord1;
            else
                throw "whoops";
        }
        case VertexInputSemantic.Normal:    return DKSProgram.a_Normal;
        case VertexInputSemantic.Tangent:   return DKSProgram.a_Tangent;
        case VertexInputSemantic.Bitangent: return DKSProgram.a_Bitangent;
        default: return -1;
        }
    }

    private translateDataType(dataType: number): GfxFormat {
        switch (dataType) {
            case 17:
                // Bone indices -- four bytes.
                return GfxFormat.U8_RGBA_NORM;
            case 19:
                // Colors and normals -- four bytes.
                return GfxFormat.U8_RGBA_NORM;
            case 21:
                // One set of UVs -- two shorts.
                return GfxFormat.S16_RG;
            case 22:
                // Two sets of UVs -- four shorts.
                return GfxFormat.S16_RGBA;
            case 26:
                // Bone weight -- four shorts.
                return GfxFormat.S16_RGBA_NORM;
            case 2:
            case 18:
            case 20:
            case 23:
            case 24:
            case 25:
                // Everything else -- three floats.
                return GfxFormat.F32_RGBA;
            default:
                throw "whoops";
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);

        for (let i = 0; i < this.inputLayouts.length; i++)
            device.destroyInputLayout(this.inputLayouts[i]);
        for (let i = 0; i < this.batchData.length; i++)
            this.batchData[i].destroy(device);
    }
}

function getTexAssign(mtd: MTD, name: string): number {
    return mtd.textures.findIndex((t) => t.name === name);
}

class DKSProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord0 = 2;
    public static a_TexCoord1 = 3;
    public static a_Normal = 4;
    public static a_Tangent = 5;
    public static a_Bitangent = 6;

    public static ub_SceneParams = 0;
    public static ub_MeshFragParams = 1;

    public static BindingDefinitions = `
// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(row_major, std140) uniform ub_MeshFragParams {
    Mat4x3 u_BoneMatrix[1];
    Mat4x3 u_NormalMatrix[1];
    Mat4x3 u_ModelMatrix[1];
    // Fourth element has g_DiffuseMapColorPower
    vec4 u_DiffuseMapColor;
    vec4 u_TexScroll[3];
};

uniform sampler2D u_Texture[8];
`;

    public both = `
precision mediump float;

${DKSProgram.BindingDefinitions}

varying vec4 v_Color;
varying vec2 v_TexCoord[3];
varying vec3 v_NormalWorld;
varying vec3 v_TangentWorld;
varying vec3 v_BitangentWorld;
`;

    public vert = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec4 a_TexCoord0;
layout(location = 3) in vec4 a_TexCoord1;
layout(location = 4) in vec4 a_Normal;
layout(location = 5) in vec4 a_Tangent;
layout(location = 6) in vec4 a_Bitangent;

#define UNORM_TO_SNORM(xyz) ((xyz - 0.5) * 2.0)

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[0]), vec4(a_Position, 1.0)));
    v_NormalWorld = normalize(Mul(_Mat4x4(u_NormalMatrix[0]), vec4(UNORM_TO_SNORM(a_Normal.xyz), 0.0)).xyz);
    v_TangentWorld = normalize(Mul(_Mat4x4(u_ModelMatrix[0]), vec4(UNORM_TO_SNORM(a_Tangent.xyz), 0.0)).xyz);
    v_BitangentWorld = normalize(Mul(_Mat4x4(u_ModelMatrix[0]), vec4(UNORM_TO_SNORM(a_Bitangent.xyz), 0.0)).xyz);
    v_Color = a_Color;
    v_TexCoord[0] = ((a_TexCoord0.xy) / 1024.0) + u_TexScroll[0].xy;
    v_TexCoord[1] = ((a_TexCoord0.zw) / 1024.0) + u_TexScroll[1].xy;
    v_TexCoord[2] = ((a_TexCoord1.xy) / 1024.0) + u_TexScroll[2].xy;
}
`;

    constructor(private mtd: MTD) {
        super();
        this.frag = this.genFrag();
    }

    private getTexture(name: string): MTDTexture | null {
        const texDef = this.mtd.textures.find((t) => t.name === name);
        if (texDef !== undefined)
            return texDef;
        else
            return null;
    }

    private buildTexAccess(texParam: MTDTexture): string {
        const texAssign = getTexAssign(this.mtd, texParam.name);
        assert(texAssign > -1);
        return `texture2D(u_Texture[${texAssign}], v_TexCoord[${texParam.uvNumber}])`;
    }

    private genDiffuse(): string {
        const diffuse1 = this.getTexture('g_Diffuse');
        const diffuse2 = this.getTexture('g_Diffuse_2');

        const diffuseEpi = `
    t_Diffuse.rgb = t_Diffuse.rgb * u_DiffuseMapColor.rgb * u_DiffuseMapColor.w;
    t_Color *= t_Diffuse;
`;

        if (diffuse1 !== null && diffuse2 !== null) {
            return `
    vec4 t_Diffuse1 = ${this.buildTexAccess(diffuse1)};
    vec4 t_Diffuse2 = ${this.buildTexAccess(diffuse2)};
    vec4 t_Diffuse = mix(t_Diffuse1, t_Diffuse2, v_Color.a);
${diffuseEpi}
`;
        } else if (diffuse1 !== null) {
            return `
    vec4 t_Diffuse1 = ${this.buildTexAccess(diffuse1)};
    vec4 t_Diffuse = t_Diffuse1;
${diffuseEpi}
    `;
        } else {
            return '';
        }
    }

    private genNormalDir(): string {
        const bumpmap1 = this.getTexture('g_Bumpmap');
        const bumpmap2 = this.getTexture('g_Bumpmap_2');

        const bumpmapPro = `
    vec3 t_Normal = v_NormalWorld.xyz;
    vec3 t_Tangent = v_TangentWorld.xyz;
    vec3 t_Bitangent = v_BitangentWorld.xyz;
`;

        const bumpmapEpi = `
    vec3 t_NormalDir = (t_LocalNormal.x * t_Tangent + t_LocalNormal.y * t_Bitangent + t_LocalNormal.z * t_Normal);
`;

        if (bumpmap1 !== null && bumpmap2 !== null) {
            return `
${bumpmapPro}
    vec3 t_Bumpmap1 = ${this.buildTexAccess(bumpmap1)}.rgb;
    vec3 t_Bumpmap2 = ${this.buildTexAccess(bumpmap2)}.rgb;
    vec3 t_LocalNormal = mix(t_Bumpmap1, t_Bumpmap2, v_Color.a);
${bumpmapEpi}
`;
        } else if (bumpmap1 !== null) {
            return `
${bumpmapPro}
    vec3 t_Bumpmap1 = ${this.buildTexAccess(bumpmap1)}.rgb;
    vec3 t_LocalNormal = t_Bumpmap1;
${bumpmapEpi}
`;
        } else {
            return `
    vec3 t_NormalDir = v_NormalWorld;
`;
        }
    }

    private genLightMap(): string {
        const lightmap = this.getTexture('g_Lightmap');

        if (lightmap !== null) {
            return `
    t_DirectIrradiance *= ${this.buildTexAccess(lightmap)}.rgb;
`;
        } else {
            return '';
        }
    }

    private buildAlphaTest(): string {
        const blendMode = getBlendMode(this.mtd);

        if (blendMode === BlendMode.TexEdge) {
            return `
    if (t_Color.a < 0.1)
        discard;
`;
        } else {
            return '';
        }
    }

    private genFrag(): string {
        return `
void main() {
    vec4 t_Color = vec4(1.0);

    t_Color *= v_Color;

    ${this.genDiffuse()}

#ifdef USE_LIGHTING
    vec3 t_DirectIrradiance = vec3(1.0);

    ${this.genNormalDir()}

    // Basic fake directional.
    vec3 t_LightDirection = normalize(vec3(0.8, -1, 0.5));
    t_DirectIrradiance *= mix(0.0, 2.0, max(dot(-t_NormalDir, t_LightDirection), 0.0));

    ${this.genLightMap()}

    // Add in some fake ambient.
    t_DirectIrradiance += 0.5;

    t_Color.rgb *= t_DirectIrradiance;
#endif

    ${this.buildAlphaTest()}

    // Convert to gamma-space
    t_Color.rgb = pow(t_Color.rgb, vec3(1.0 / 2.2));

    gl_FragColor = t_Color;
}
`;
    }

    public static programReflection: DeviceProgramReflection = DeviceProgram.parseReflectionDefinitions(DKSProgram.BindingDefinitions);
}

function lookupTextureParameter(material: Material, paramName: string): string | null {
    const param = material.parameters.find((param) => param.name === paramName);
    if (param === undefined)
        return null;
    return param.value.split('\\').pop()!.replace(/\.tga|\.psd/, '');
}

const enum BlendMode {
    Normal,
    TexEdge,
    Blend,
    Water,
    Add,
    Sub,
    Mul,
    AddMul,
    SubMul,
    WaterWave,

    // Below are "linear space" variants, but as far as the community can tell, all lighting is in linear space.
    // It's likely that these were used at some point during development and the values were never removed.
    LSNormal = 0x20,
    LSTexEdge,
    LSBlend,
    LSWater,
    LSAdd,
    LSSub,
    LSMul,
    LSAddMul,
    LSSubMul,
    LSWaterWave,
};

function getMaterialParam(mtd: MTD, name: string): number[] | null {
    const params = mtd.params.find((param) => param.name === name);
    return params !== undefined ? params.value : null;
}

function getBlendMode(mtd: MTD): BlendMode {
    const v = assertExists(getMaterialParam(mtd, 'g_BlendMode'));
    assert(v.length === 1);
    let blendMode: BlendMode = v[0];

    // Remove LS
    if (blendMode >= BlendMode.LSNormal)
        blendMode -= BlendMode.LSNormal;

    return blendMode;
}

function linkTextureParameter(textureMapping: TextureMapping[], textureHolder: DDSTextureHolder, name: string, material: Material, mtd: MTD): void {
    const texDef = mtd.textures.find((t) => t.name === name);
    if (texDef === undefined)
        return;

    const textureName = assertExists(lookupTextureParameter(material, name));
    if (textureHolder.hasTexture(textureName)) {
        const texAssign = getTexAssign(mtd, name);
        textureHolder.fillTextureMapping(textureMapping[texAssign], textureName);
    }
}

const scratchVec4 = vec4.create();
class BatchInstance {
    private visible = true;
    private diffuseColor = vec4.fromValues(1, 1, 1, 1);
    private texScroll = nArray(3, () => vec4.create());
    private textureMapping = nArray(8, () => new TextureMapping());
    private megaState: Partial<GfxMegaStateDescriptor>;
    private gfxProgram: GfxProgram;
    private sortKey: number;

    constructor(device: GfxDevice, private flverData: FLVERData, private batchData: BatchData, textureHolder: DDSTextureHolder, material: Material, mtd: MTD) {
        const program = new DKSProgram(mtd);

        // If this is a Phong shader, then turn on lighting.
        if (mtd.shaderPath.includes('_Phn_'))
            program.defines.set('USE_LIGHTING', '1');

        linkTextureParameter(this.textureMapping, textureHolder, 'g_Diffuse',   material, mtd);
        linkTextureParameter(this.textureMapping, textureHolder, 'g_Bumpmap',   material, mtd);
        linkTextureParameter(this.textureMapping, textureHolder, 'g_Diffuse_2', material, mtd);
        linkTextureParameter(this.textureMapping, textureHolder, 'g_Bumpmap_2', material, mtd);
        linkTextureParameter(this.textureMapping, textureHolder, 'g_Lightmap',  material, mtd);

        const blendMode = getBlendMode(mtd);
        let isTranslucent = false;
        if (blendMode === BlendMode.Normal) {
            // Default
            this.megaState = {};
        } else if (blendMode === BlendMode.Blend) {
            this.megaState = {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
                depthWrite: false,
            };
            isTranslucent = true;
        } else if (blendMode === BlendMode.Add) {
            this.megaState = {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                blendDstFactor: GfxBlendFactor.ONE,
                depthWrite: false,
            };
            isTranslucent = true;
        } else if (blendMode === BlendMode.TexEdge) {
            this.megaState = {};
        } else {
            this.megaState = {};
            console.warn(`Unknown blend mode ${blendMode} in material ${material.mtdName}`);
        }

        const diffuseMapColor = getMaterialParam(mtd, 'g_DiffuseMapColor');
        if (diffuseMapColor !== undefined) {
            const diffuseMapColorPower = assertExists(getMaterialParam(mtd, `g_DiffuseMapColorPower`))[0];
            vec4.set(this.diffuseColor, diffuseMapColor[0], diffuseMapColor[1], diffuseMapColor[2], diffuseMapColorPower);
        }

        for (let i = 0; i < 3; i++) {
            const param = getMaterialParam(mtd, `g_TexScroll_${i}`);
            if (param)
                vec4.set(this.texScroll[i], param[0], param[1], 0, 0);
        }

        this.gfxProgram = device.createProgram(program);

        const layer = isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKey = makeSortKey(layer, 0);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4): void {
        if (!this.visible)
            return;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setSamplerBindingsFromTextureMappings(this.textureMapping);
        template.setGfxProgram(this.gfxProgram);

        let offs = template.allocateUniformBuffer(DKSProgram.ub_MeshFragParams, 12*3 + 4*4);
        const d = template.mapUniformBufferF32(DKSProgram.ub_MeshFragParams);

        computeViewMatrix(matrixScratch, viewerInput.camera);
        mat4.mul(matrixScratch, matrixScratch, modelMatrix);
        offs += fillMatrix4x3(d, offs, matrixScratch);

        computeNormalMatrix(matrixScratch, modelMatrix, false);
        offs += fillMatrix4x3(d, offs, matrixScratch);

        offs += fillMatrix4x3(d, offs, modelMatrix);

        offs += fillVec4v(d, offs, this.diffuseColor);

        const scrollTime = viewerInput.time / 120;
        offs += fillVec4v(d, offs, vec4.scale(scratchVec4, this.texScroll[0], scrollTime));
        offs += fillVec4v(d, offs, vec4.scale(scratchVec4, this.texScroll[1], scrollTime));
        offs += fillVec4v(d, offs, vec4.scale(scratchVec4, this.texScroll[2], scrollTime));

        const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera, bboxScratch);

        for (let j = 0; j < this.batchData.batch.primitiveIndexes.length; j++) {
            const primitive = this.flverData.flver.primitives[this.batchData.batch.primitiveIndexes[j]];
            if (!shouldRenderPrimitive(primitive))
                continue;

            const inputState = this.flverData.flver.inputStates[this.batchData.batch.inputStateIndex];
            const gfxInputState = this.batchData.inputStates[j];
            const gfxInputLayout = this.flverData.inputLayouts[inputState.inputLayoutIndex];

            const renderInst = renderInstManager.pushRenderInst();
            renderInst.setInputLayoutAndState(gfxInputLayout, gfxInputState);
            renderInst.setMegaStateFlags(this.megaState);
            if (primitive.cullMode)
                renderInst.getMegaStateFlags().cullMode = GfxCullMode.BACK;
            renderInst.drawIndexes(getTriangleIndexCountForTopologyIndexCount(GfxTopology.TRISTRIP, primitive.indexCount));
            renderInst.sortKey = setSortKeyDepth(this.sortKey, depth);
        }

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        device.destroyProgram(this.gfxProgram);
    }
}

const matrixScratch = mat4.create();
const bboxScratch = new AABB();
export class FLVERInstance {
    private batchInstances: BatchInstance[] = [];
    public modelMatrix = mat4.create();
    public visible = true;
    public name: string;

    constructor(device: GfxDevice, textureHolder: DDSTextureHolder, materialDataHolder: MaterialDataHolder, public flverData: FLVERData) {
        for (let i = 0; i < this.flverData.flver.batches.length; i++) {
            const batchData = this.flverData.batchData[i];
            const batch = batchData.batch;
            const material = this.flverData.flver.materials[batch.materialIndex];

            const diffuseTextureName = lookupTextureParameter(material, 'g_Diffuse');

            // TODO(jstpierre): Implement untextured materials.
            if (diffuseTextureName === null || !textureHolder.hasTexture(diffuseTextureName))
                continue;

            const mtdFilePath = material.mtdName;
            const mtdName = mtdFilePath.split('\\').pop();
            const mtd = materialDataHolder.getMaterial(mtdName);

            this.batchInstances.push(new BatchInstance(device, flverData, batchData, textureHolder, material, mtd));
        }
    }

    public setVisible(v: boolean) {
        this.visible = v;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        bboxScratch.transform(this.flverData.flver.bbox, this.modelMatrix);
        if (!viewerInput.camera.frustum.contains(bboxScratch))
            return;

        for (let i = 0; i < this.batchInstances.length; i++)
            this.batchInstances[i].prepareToRender(device, renderInstManager, viewerInput, this.modelMatrix);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.batchInstances.length; i++)
            this.batchInstances[i].destroy(device);
    }
}

function fillSceneParamsData(d: Float32Array, camera: Camera, offs: number = 0): void {
    offs += fillMatrix4x4(d, offs, camera.projectionMatrix);
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 8 },
];

function modelMatrixFromPart(m: mat4, part: Part): void {
    const modelScale = 100;

    // Game uses +x = left convention for some reason.
    mat4.scale(m, m, [-modelScale, modelScale, modelScale]);

    mat4.translate(m, m, part.translation);
    mat4.rotateX(m, m, part.rotation[0] * MathConstants.DEG_TO_RAD);
    mat4.rotateY(m, m, part.rotation[1] * MathConstants.DEG_TO_RAD);
    mat4.rotateZ(m, m, part.rotation[2] * MathConstants.DEG_TO_RAD);
    mat4.scale(m, m, part.scale);
}

export class MSBRenderer {
    public flverInstances: FLVERInstance[] = [];

    constructor(device: GfxDevice, private textureHolder: DDSTextureHolder, private modelHolder: ModelHolder, private materialDataHolder: MaterialDataHolder, private msb: MSB) {
        for (let i = 0; i < msb.parts.length; i++) {
            const part = msb.parts[i];
            if (part.type === 0) {
                const flverData = this.modelHolder.flverData[part.modelIndex];
                if (flverData === undefined)
                    continue;

                const instance = new FLVERInstance(device, this.textureHolder, this.materialDataHolder, flverData);
                instance.visible = !isLODModel(part.name);
                instance.name = part.name;
                modelMatrixFromPart(instance.modelMatrix, part);
                this.flverInstances.push(instance);
            }
        }
    }

    private lodModels: string[] = [];
    public chooseLODModel(): void {
        interactiveVizSliderSelect(this.flverInstances, (index) => {
            const instance = this.flverInstances[index];
            this.lodModels.push(instance.name);
            setTimeout(() => { instance.visible = false; }, 2000);

            this.chooseLODModel();
        });
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(20, 500000);

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        const offs = template.allocateUniformBuffer(DKSProgram.ub_SceneParams, 16);
        const sceneParamsMapped = template.mapUniformBufferF32(DKSProgram.ub_SceneParams);
        fillSceneParamsData(sceneParamsMapped, viewerInput.camera, offs);

        for (let i = 0; i < this.flverInstances.length; i++)
            this.flverInstances[i].prepareToRender(device, renderInstManager, viewerInput);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.flverInstances.length; i++)
            this.flverInstances[i].destroy(device);
    }
}
