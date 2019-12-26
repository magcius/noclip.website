
// GX materials.

import * as GX from './gx_enum';

import { colorCopy, colorFromRGBA, TransparentBlack, colorNewCopy } from '../Color';
import { GfxFormat } from '../gfx/platform/GfxPlatformFormat';
import { GfxCompareMode, GfxFrontFaceMode, GfxBlendMode, GfxBlendFactor, GfxCullMode, GfxMegaStateDescriptor, GfxProgramDescriptorSimple, GfxDevice, GfxVendorInfo } from '../gfx/platform/GfxPlatform';
import { vec3, vec4, mat4 } from 'gl-matrix';
import { Camera } from '../Camera';
import { assert } from '../util';
import { reverseDepthForCompareMode } from '../gfx/helpers/ReversedDepthHelpers';
import { AttachmentStateSimple, setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { MathConstants } from '../MathHelpers';
import { preprocessShader_GLSL } from '../gfx/shaderc/GfxShaderCompiler';
import { DisplayListRegisters } from './gx_displaylist';
import { DeviceProgram } from '../Program';

// TODO(jstpierre): Move somewhere better...
export const EFB_WIDTH = 640;
export const EFB_HEIGHT = 528;

// #region Material definition.
export interface GXMaterial {
    // Debugging & ID
    name: string;

    // Polygon state
    cullMode: GX.CullMode;

    // Vertex state
    lightChannels: LightChannelControl[];
    texGens: TexGen[];

    // TEV state
    tevStages: TevStage[];
    // Indirect TEV state
    indTexStages: IndTexStage[];

    // Raster / blend state.
    alphaTest: AlphaTest;
    ropInfo: RopInfo;

    // Optimization and other state.
    usePnMtxIdx?: boolean;
    useTexMtxIdx?: boolean[];
    hasPostTexMtxBlock?: boolean;
    hasLightsBlock?: boolean;
}

export class Light {
    public Position = vec3.create();
    public Direction = vec3.create();
    public DistAtten = vec3.create();
    public CosAtten = vec3.create();
    public Color = colorNewCopy(TransparentBlack);

    constructor() {
        this.reset();
    }

    public reset(): void {
        vec3.set(this.Position, 0, 0, 0);
        vec3.set(this.Direction, 0, 0, -1);
        vec3.set(this.DistAtten, 1, 0, 0);
        vec3.set(this.CosAtten, 1, 0, 0);
        colorFromRGBA(this.Color, 0, 0, 0, 1);
    }

    public copy(o: Light): void {
        vec3.copy(this.Position, o.Position);
        vec3.copy(this.Direction, o.Direction);
        vec3.copy(this.DistAtten, o.DistAtten);
        vec3.copy(this.CosAtten, o.CosAtten);
        colorCopy(this.Color, o.Color);
    }
}

const scratchVec4 = vec4.create();
export function lightSetWorldPositionViewMatrix(light: Light, viewMatrix: mat4, x: number, y: number, z: number, v: vec4 = scratchVec4): void {
    vec4.set(v, x, y, z, 1.0);
    vec4.transformMat4(v, v, viewMatrix);
    vec3.set(light.Position, v[0], v[1], v[2]);
}

export function lightSetWorldPosition(light: Light, camera: Camera, x: number, y: number, z: number, v: vec4 = scratchVec4): void {
    return lightSetWorldPositionViewMatrix(light, camera.viewMatrix, x, y, z, v);
}

export function lightSetViewPosition(light: Light, v: vec3): void {
    vec3.set(light.Position, v[0], v[1], -v[2]);
}

export function lightSetWorldDirectionNormalMatrix(light: Light, normalMatrix: mat4, x: number, y: number, z: number, v: vec4 = scratchVec4): void {
    vec4.set(v, x, y, z, 0.0);
    vec4.transformMat4(v, v, normalMatrix);
    vec4.normalize(v, v);
    vec3.set(light.Direction, v[0], v[1], v[2]);
}

export function lightSetWorldDirection(light: Light, camera: Camera, x: number, y: number, z: number, v: vec4 = scratchVec4): void {
    // TODO(jstpierre): In theory, we should multiply by the inverse-transpose of the view matrix.
    // However, I don't want to calculate that right now, and it shouldn't matter too much...
    return lightSetWorldDirectionNormalMatrix(light, camera.viewMatrix, x, y, z, v);
}

export function lightSetSpot(light: Light, cutoff: number, spotFunc: GX.SpotFunction): void {
    if (cutoff <= 0 || cutoff >= 90)
        spotFunc = GX.SpotFunction.OFF;

    const cr = Math.cos(cutoff * MathConstants.DEG_TO_RAD);
    if (spotFunc === GX.SpotFunction.FLAT) {
        vec3.set(light.CosAtten, -1000.0 * cr, 1000.0, 0.0);
    } else if (spotFunc === GX.SpotFunction.COS) {
        vec3.set(light.CosAtten, -cr / (1.0 - cr), 1.0 / (1.0 - cr), 0.0);
    } else if (spotFunc === GX.SpotFunction.COS2) {
        vec3.set(light.CosAtten, 0.0, -cr / (1.0 - cr), 1.0 / (1.0 - cr));
    } else if (spotFunc === GX.SpotFunction.SHARP) {
        const d = (1.0 - cr) * (1.0 - cr);
        vec3.set(light.CosAtten, cr * (cr - 2.0) / d, 2.0 / d, -1.0 / d);
    } else if (spotFunc === GX.SpotFunction.RING1) {
        const d = (1.0 - cr) * (1.0 - cr);
        vec3.set(light.CosAtten, -4.0 * cr / d, 4.0 * (1.0 + cr) / d, -4.0 / d);
    } else if (spotFunc === GX.SpotFunction.RING2) {
        const d = (1.0 - cr) * (1.0 - cr);
        vec3.set(light.CosAtten, 1.0 - 2.0 * cr * cr / d, 4.0 * cr / d, -2.0 / d);
    } else if (spotFunc === GX.SpotFunction.OFF) {
        vec3.set(light.CosAtten, 1.0, 0.0, 0.0);
    }
}

export function lightSetDistAttn(light: Light, refDist: number, refBrightness: number, distFunc: GX.DistAttnFunction): void {
    if (refDist < 0 || refBrightness <= 0 || refBrightness >= 1)
        distFunc = GX.DistAttnFunction.OFF;

    if (distFunc === GX.DistAttnFunction.GENTLE)
        vec3.set(light.DistAtten, 1.0, (1.0 - refBrightness) / (refBrightness * refDist), 0.0);
    else if (distFunc === GX.DistAttnFunction.MEDIUM)
        vec3.set(light.DistAtten, 1.0, 0.5 * (1.0 - refBrightness) / (refBrightness * refDist), 0.5 * (1.0 - refBrightness) / (refBrightness * refDist * refDist));
    else if (distFunc === GX.DistAttnFunction.STEEP)
        vec3.set(light.DistAtten, 1.0, 0.0, (1.0 - refBrightness) / (refBrightness * refDist * refDist));
    else if (distFunc === GX.DistAttnFunction.OFF)
        vec3.set(light.DistAtten, 1.0, 0.0, 0.0);
}

export interface ColorChannelControl {
    lightingEnabled: boolean;
    matColorSource: GX.ColorSrc;
    ambColorSource: GX.ColorSrc;
    litMask: number;
    diffuseFunction: GX.DiffuseFunction;
    attenuationFunction: GX.AttenuationFunction;
}

export interface LightChannelControl {
    alphaChannel: ColorChannelControl;
    colorChannel: ColorChannelControl;
}

export interface TexGen {
    type: GX.TexGenType;
    source: GX.TexGenSrc;
    matrix: GX.TexGenMatrix;
    normalize: boolean;
    postMatrix: GX.PostTexGenMatrix;
}

export interface IndTexStage {
    texCoordId: GX.TexCoordID;
    texture: GX.TexMapID;
    scaleS: GX.IndTexScale;
    scaleT: GX.IndTexScale;
}

export interface TevStage {
    colorInA: GX.CombineColorInput;
    colorInB: GX.CombineColorInput;
    colorInC: GX.CombineColorInput;
    colorInD: GX.CombineColorInput;
    colorOp: GX.TevOp;
    colorBias: GX.TevBias;
    colorScale: GX.TevScale;
    colorClamp: boolean;
    colorRegId: GX.Register;

    alphaInA: GX.CombineAlphaInput;
    alphaInB: GX.CombineAlphaInput;
    alphaInC: GX.CombineAlphaInput;
    alphaInD: GX.CombineAlphaInput;
    alphaOp: GX.TevOp;
    alphaBias: GX.TevBias;
    alphaScale: GX.TevScale;
    alphaClamp: boolean;
    alphaRegId: GX.Register;

    // SetTevOrder
    texCoordId: GX.TexCoordID;
    texMap: GX.TexMapID;
    channelId: GX.RasColorChannelID;

    konstColorSel: GX.KonstColorSel;
    konstAlphaSel: GX.KonstAlphaSel;

    // SetTevSwapMode / SetTevSwapModeTable
    // TODO(jstpierre): Make these non-optional at some point?
    rasSwapTable?: GX.TevColorChan[];
    texSwapTable?: GX.TevColorChan[];

    // SetTevIndirect
    indTexStage: GX.IndTexStageID;
    indTexFormat: GX.IndTexFormat;
    indTexBiasSel: GX.IndTexBiasSel;
    indTexMatrix: GX.IndTexMtxID;
    indTexWrapS: GX.IndTexWrap;
    indTexWrapT: GX.IndTexWrap;
    indTexAddPrev: boolean;
    indTexUseOrigLOD: boolean;
}

export interface AlphaTest {
    op: GX.AlphaOp;
    compareA: GX.CompareType;
    referenceA: number;
    compareB: GX.CompareType;
    referenceB: number;
}

export interface BlendMode {
    type: GX.BlendMode;
    srcFactor: GX.BlendFactor;
    dstFactor: GX.BlendFactor;
    logicOp: GX.LogicOp;
}

export interface RopInfo {
    blendMode: BlendMode;
    depthTest: boolean;
    depthFunc: GX.CompareType;
    depthWrite: boolean;
}
// #endregion

// #region Material shader generation.
interface VertexAttributeGenDef {
    attrib: GX.Attr;
    format: GfxFormat;
    name: string;
}

const vtxAttributeGenDefs: VertexAttributeGenDef[] = [
    { attrib: GX.Attr.POS,        name: "Position",      format: GfxFormat.F32_RGB },
    { attrib: GX.Attr.PNMTXIDX,   name: "PnMtxIdx",      format: GfxFormat.F32_R },
    // These are packed separately since we would run out of attribute space otherwise.
    { attrib: GX.Attr.TEX0MTXIDX, name: "TexMtx0123Idx", format: GfxFormat.F32_RGBA },
    { attrib: GX.Attr.TEX4MTXIDX, name: "TexMtx4567Idx", format: GfxFormat.F32_RGBA },
    { attrib: GX.Attr.NRM,        name: "Normal",        format: GfxFormat.F32_RGB },
    { attrib: GX.Attr.CLR0,       name: "Color0",        format: GfxFormat.F32_RGBA },
    { attrib: GX.Attr.CLR1,       name: "Color1",        format: GfxFormat.F32_RGBA },
    { attrib: GX.Attr.TEX0,       name: "Tex0",          format: GfxFormat.F32_RG },
    { attrib: GX.Attr.TEX1,       name: "Tex1",          format: GfxFormat.F32_RG },
    { attrib: GX.Attr.TEX2,       name: "Tex2",          format: GfxFormat.F32_RG },
    { attrib: GX.Attr.TEX3,       name: "Tex3",          format: GfxFormat.F32_RG },
    { attrib: GX.Attr.TEX4,       name: "Tex4",          format: GfxFormat.F32_RG },
    { attrib: GX.Attr.TEX5,       name: "Tex5",          format: GfxFormat.F32_RG },
    { attrib: GX.Attr.TEX6,       name: "Tex6",          format: GfxFormat.F32_RG },
    { attrib: GX.Attr.TEX7,       name: "Tex7",          format: GfxFormat.F32_RG },
];

export function getVertexAttribLocation(vtxAttrib: GX.Attr): number {
    return vtxAttributeGenDefs.findIndex((genDef) => genDef.attrib === vtxAttrib);
}

export function getVertexAttribGenDef(vtxAttrib: GX.Attr): VertexAttributeGenDef {
    return vtxAttributeGenDefs.find((genDef) => genDef.attrib === vtxAttrib)!;
}

export interface LightingFudgeParams {
    vtx: string;
    amb: string;
    mat: string;
    ambSource: string;
    matSource: string;
}

type LightingFudgeGenerator = (p: LightingFudgeParams) => string;

export interface GXMaterialHacks {
    lightingFudge?: LightingFudgeGenerator;
    disableTextures?: boolean;
    disableVertexColors?: boolean;
    disableLighting?: boolean;
}

function colorChannelsEqual(a: ColorChannelControl, b: ColorChannelControl): boolean {
    if (a.lightingEnabled !== b.lightingEnabled) return false;
    if (a.litMask !== b.litMask) return false;
    if (a.ambColorSource !== b.ambColorSource) return false;
    if (a.matColorSource !== b.matColorSource) return false;
    if (a.attenuationFunction !== b.attenuationFunction) return false;
    if (a.diffuseFunction !== b.diffuseFunction) return false;
    return true;
}

export function materialHasPostTexMtxBlock(material: { hasPostTexMtxBlock?: boolean }): boolean {
    return material.hasPostTexMtxBlock !== undefined ? material.hasPostTexMtxBlock : true;
}

export function materialHasLightsBlock(material: { hasLightsBlock?: boolean }): boolean {
    return material.hasLightsBlock !== undefined ? material.hasLightsBlock : true;
}

function generateBindingsDefinition(material: { hasPostTexMtxBlock?: boolean, hasLightsBlock?: boolean }): string {
    return `
// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    vec4 u_Misc0;
};

#define u_SceneTextureLODBias u_Misc0[0]

struct Light {
    vec4 Color;
    vec4 Position;
    vec4 Direction;
    vec4 DistAtten;
    vec4 CosAtten;
};

// Expected to change with each material.
layout(row_major, std140) uniform ub_MaterialParams {
    vec4 u_ColorMatReg[2];
    vec4 u_ColorAmbReg[2];
    vec4 u_KonstColor[4];
    vec4 u_Color[4];
    Mat4x3 u_TexMtx[10];
    // SizeX, SizeY, 0, Bias
    vec4 u_TextureParams[8];
    Mat4x2 u_IndTexMtx[3];

    // Optional parameters.
${materialHasPostTexMtxBlock(material) ? `
    Mat4x3 u_PostTexMtx[20];
` : ``}
${materialHasLightsBlock(material) ? `
    Light u_LightParams[8];
` : ``}
};

// Expected to change with each shape packet.
layout(row_major, std140) uniform ub_PacketParams {
    Mat4x3 u_PosMtx[10];
};

uniform sampler2D u_Texture[8];
`;
}

export function getMaterialParamsBlockSize(material: GXMaterial): number {
    const hasPostTexMtxBlock = material.hasPostTexMtxBlock !== undefined ? material.hasPostTexMtxBlock : true;
    const hasLightsBlock = material.hasLightsBlock !== undefined ? material.hasLightsBlock : true;

    let size = 4*2 + 4*2 + 4*4 + 4*4 + 4*3*10 + 4*2*3 + 4*8;
    if (hasPostTexMtxBlock)
        size += 4*3*20;
    if (hasLightsBlock)
        size += 4*5*8;

    return size;
}

export class GX_Program extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_MaterialParams = 1;
    public static ub_PacketParams = 2;

    public name: string;

    constructor(private material: GXMaterial, private hacks: GXMaterialHacks | null = null) {
        super();
        this.name = material.name;
        this.generateShaders();
    }

    private generateFloat(v: number): string {
        let s = v.toString();
        if (!s.includes('.'))
            s += '.0';
        return s;
    }

    // Color Channels
    private generateMaterialSource(chan: ColorChannelControl, i: number) {
        if (this.hacks !== null && this.hacks.disableVertexColors && chan.matColorSource === GX.ColorSrc.VTX)
            return `vec4(1.0, 1.0, 1.0, 1.0)`;

        switch (chan.matColorSource) {
            case GX.ColorSrc.VTX: return `a_Color${i}`;
            case GX.ColorSrc.REG: return `u_ColorMatReg[${i}]`;
        }
    }

    private generateAmbientSource(chan: ColorChannelControl, i: number) {
        if (this.hacks !== null && this.hacks.disableVertexColors && chan.ambColorSource === GX.ColorSrc.VTX)
            return `vec4(1.0, 1.0, 1.0, 1.0)`;

        switch (chan.ambColorSource) {
            case GX.ColorSrc.VTX: return `a_Color${i}`;
            case GX.ColorSrc.REG: return `u_ColorAmbReg[${i}]`;
        }
    }

    private generateLightDiffFn(chan: ColorChannelControl, lightName: string) {
        const NdotL = `dot(t_Normal, t_LightDeltaDir)`;

        switch (chan.diffuseFunction) {
        case GX.DiffuseFunction.NONE: return `1.0`;
        case GX.DiffuseFunction.SIGN: return `${NdotL}`;
        case GX.DiffuseFunction.CLAMP: return `max(${NdotL}, 0.0)`;
        }
    }

    private generateLightAttnFn(chan: ColorChannelControl, lightName: string) {
        const attn = `max(0.0, dot(t_LightDeltaDir, ${lightName}.Direction.xyz))`;
        const cosAttn = `max(0.0, ApplyCubic(${lightName}.CosAtten.xyz, ${attn}))`;

        switch (chan.attenuationFunction) {
        case GX.AttenuationFunction.NONE: return `1.0`;
        case GX.AttenuationFunction.SPOT: return `${cosAttn} / dot(${lightName}.DistAtten.xyz, vec3(1.0, t_LightDeltaDist, t_LightDeltaDist2))`;
        case GX.AttenuationFunction.SPEC: return `${cosAttn} / ApplyCubic(${lightName}.DistAtten.xyz, ${attn})`;
        }
    }

    private generateColorChannel(chan: ColorChannelControl, outputName: string, i: number) {
        const matSource = this.generateMaterialSource(chan, i);
        const ambSource = this.generateAmbientSource(chan, i);

        let lightingEnabled = chan.lightingEnabled;
        if (this.hacks !== null && this.hacks.disableLighting)
            lightingEnabled = false;

        // HACK.
        if (lightingEnabled && this.hacks !== null && this.hacks.lightingFudge) {
            const vtx = `a_Color${i}`;
            const amb = `u_ColorAmbReg[${i}]`;
            const mat = `u_ColorMatReg[${i}]`;
            const fudged = this.hacks.lightingFudge({ vtx, amb, mat, ambSource, matSource });
            return `${outputName} = vec4(${fudged}); // Fudge!`;
        }

        let generateLightAccum = ``;
        if (lightingEnabled) {
            generateLightAccum = `
    t_LightAccum = ${ambSource};`;

            if (chan.litMask !== 0)
                assert(materialHasLightsBlock(this.material));

            for (let j = 0; j < 8; j++) {
                if (!(chan.litMask & (1 << j)))
                    continue;

                const lightName = `u_LightParams[${j}]`;
                generateLightAccum += `
    t_LightDelta = ${lightName}.Position.xyz - v_Position.xyz;
    t_LightDeltaDist2 = dot(t_LightDelta, t_LightDelta);
    t_LightDeltaDist = sqrt(t_LightDeltaDist2);
    t_LightDeltaDir = t_LightDelta / t_LightDeltaDist;
    t_LightAccum += ${this.generateLightDiffFn(chan, lightName)} * ${this.generateLightAttnFn(chan, lightName)} * ${lightName}.Color;
`;
            }
        } else {
            // Without lighting, everything is full-bright.
            generateLightAccum += `
    t_LightAccum = vec4(1.0);`;
        }

        return `${generateLightAccum}
    ${outputName} = ${matSource} * clamp(t_LightAccum, 0.0, 1.0);`.trim();
    }

    private generateLightChannel(lightChannel: LightChannelControl, outputName: string, i: number) {
        if (colorChannelsEqual(lightChannel.colorChannel, lightChannel.alphaChannel)) {
            return `
    ${this.generateColorChannel(lightChannel.colorChannel, outputName, i)}`;
        } else {
            return `
    ${this.generateColorChannel(lightChannel.colorChannel, `t_ColorChanTemp`, i)}
    ${outputName}.rgb = t_ColorChanTemp.rgb;

    ${this.generateColorChannel(lightChannel.alphaChannel, `t_ColorChanTemp`, i)}
    ${outputName}.a = t_ColorChanTemp.a;`;
        }
    }

    private generateLightChannels(): string {
        return this.material.lightChannels.map((lightChannel, i) => {
            return this.generateLightChannel(lightChannel, `v_Color${i}`, i);
        }).join('\n');
    }

    // Output is a vec3, src is a vec4.
    private generateMulPntMatrixStatic(pnt: GX.TexGenMatrix, src: string): string {
        if (pnt === GX.TexGenMatrix.IDENTITY) {
            return `${src}.xyz`;
        } else if (pnt >= GX.TexGenMatrix.TEXMTX0) {
            const texMtxIdx = (pnt - GX.TexGenMatrix.TEXMTX0) / 3;
            return `Mul(u_TexMtx[${texMtxIdx}], ${src})`;
        } else if (pnt >= GX.TexGenMatrix.PNMTX0) {
            const pnMtxIdx = (pnt - GX.TexGenMatrix.PNMTX0) / 3;
            return `Mul(u_PosMtx[${pnMtxIdx}], ${src})`;
        } else {
            throw "whoops";
        }
    }

    // Output is a vec3, src is a vec4.
    private generateMulPntMatrixDynamic(attrStr: string, src: string): string {
        return `Mul(GetPosTexMatrix(${attrStr}), ${src})`;
    }

    private generateTexMtxIdxAttr(index: GX.TexCoordID): string {
        if (index === GX.TexCoordID.TEXCOORD0) return `uint(a_TexMtx0123Idx.x)`;
        if (index === GX.TexCoordID.TEXCOORD1) return `uint(a_TexMtx0123Idx.y)`;
        if (index === GX.TexCoordID.TEXCOORD2) return `uint(a_TexMtx0123Idx.z)`;
        if (index === GX.TexCoordID.TEXCOORD3) return `uint(a_TexMtx0123Idx.w)`;
        if (index === GX.TexCoordID.TEXCOORD4) return `uint(a_TexMtx4567Idx.x)`;
        if (index === GX.TexCoordID.TEXCOORD5) return `uint(a_TexMtx4567Idx.y)`;
        if (index === GX.TexCoordID.TEXCOORD6) return `uint(a_TexMtx4567Idx.z)`;
        if (index === GX.TexCoordID.TEXCOORD7) return `uint(a_TexMtx4567Idx.w)`;
        throw "whoops";
    }

    // TexGen

    // Output is a vec4.
    private generateTexGenSource(src: GX.TexGenSrc) {
        switch (src) {
        case GX.TexGenSrc.POS:       return `vec4(a_Position, 1.0)`;
        case GX.TexGenSrc.NRM:       return `vec4(a_Normal, 1.0)`;
        case GX.TexGenSrc.COLOR0:    return `v_Color0`;
        case GX.TexGenSrc.COLOR1:    return `v_Color1`;
        case GX.TexGenSrc.TEX0:      return `vec4(a_Tex0, 1.0, 1.0)`;
        case GX.TexGenSrc.TEX1:      return `vec4(a_Tex1, 1.0, 1.0)`;
        case GX.TexGenSrc.TEX2:      return `vec4(a_Tex2, 1.0, 1.0)`;
        case GX.TexGenSrc.TEX3:      return `vec4(a_Tex3, 1.0, 1.0)`;
        case GX.TexGenSrc.TEX4:      return `vec4(a_Tex4, 1.0, 1.0)`;
        case GX.TexGenSrc.TEX5:      return `vec4(a_Tex5, 1.0, 1.0)`;
        case GX.TexGenSrc.TEX6:      return `vec4(a_Tex6, 1.0, 1.0)`;
        case GX.TexGenSrc.TEX7:      return `vec4(a_Tex7, 1.0, 1.0)`;
        // Use a previously generated texcoordgen.
        case GX.TexGenSrc.TEXCOORD0: return `vec4(v_TexCoord0, 1.0)`;
        case GX.TexGenSrc.TEXCOORD1: return `vec4(v_TexCoord1, 1.0)`;
        case GX.TexGenSrc.TEXCOORD2: return `vec4(v_TexCoord2, 1.0)`;
        case GX.TexGenSrc.TEXCOORD3: return `vec4(v_TexCoord3, 1.0)`;
        case GX.TexGenSrc.TEXCOORD4: return `vec4(v_TexCoord4, 1.0)`;
        case GX.TexGenSrc.TEXCOORD5: return `vec4(v_TexCoord5, 1.0)`;
        case GX.TexGenSrc.TEXCOORD6: return `vec4(v_TexCoord6, 1.0)`;
        default:
            throw new Error("whoops");
        }
    }

    // Output is a vec3, src is a vec4.
    private generatePostTexGenMatrixMult(texCoordGen: TexGen, src: string): string {
        if (texCoordGen.postMatrix === GX.PostTexGenMatrix.PTIDENTITY) {
            return `${src}.xyz`;
        } else if (texCoordGen.postMatrix >= GX.PostTexGenMatrix.PTTEXMTX0) {
            const texMtxIdx = (texCoordGen.postMatrix - GX.PostTexGenMatrix.PTTEXMTX0) / 3;
            return `Mul(u_PostTexMtx[${texMtxIdx}], ${src})`;
        } else {
            throw "whoops";
        }
    }

    // Output is a vec3, src is a vec3.
    private generateTexGenMatrixMult(texCoordGenIndex: number, src: string) {
        // Dynamic TexMtxIdx is off by default.
        let useTexMtxIdx = false;
        if (this.material.useTexMtxIdx !== undefined && !!this.material.useTexMtxIdx[texCoordGenIndex])
            useTexMtxIdx = true;
        if (useTexMtxIdx) {
            const attrStr = this.generateTexMtxIdxAttr(texCoordGenIndex);
            return this.generateMulPntMatrixDynamic(attrStr, src);
        } else {
            return this.generateMulPntMatrixStatic(this.material.texGens[texCoordGenIndex].matrix, src);
        }
    }

    // Output is a vec3, src is a vec4.
    private generateTexGenType(texCoordGenIndex: number) {
        const texCoordGen = this.material.texGens[texCoordGenIndex];
        const src = this.generateTexGenSource(texCoordGen.source);

        if (texCoordGen.type === GX.TexGenType.SRTG)
            return `vec3(${src}.xy, 1.0)`;
        else if (texCoordGen.type === GX.TexGenType.MTX2x4)
            return `vec3(${this.generateTexGenMatrixMult(texCoordGenIndex, src)}.xy, 1.0)`;
        else if (texCoordGen.type === GX.TexGenType.MTX3x4)
            return `${this.generateTexGenMatrixMult(texCoordGenIndex, src)}`;
        else
            throw new Error("whoops");
    }

    // Output is a vec3.
    private generateTexGenNrm(texCoordGenIndex: number) {
        const texCoordGen = this.material.texGens[texCoordGenIndex];
        const src = this.generateTexGenType(texCoordGenIndex);

        if (texCoordGen.normalize)
            return `normalize(${src})`;
        else
            return src;
    }

    // Output is a vec3.
    private generateTexGenPost(texCoordGenIndex: number) {
        const texCoordGen = this.material.texGens[texCoordGenIndex];
        const src = this.generateTexGenNrm(texCoordGenIndex);

        if (texCoordGen.postMatrix === GX.PostTexGenMatrix.PTIDENTITY) {
            return src;
        } else {
            return this.generatePostTexGenMatrixMult(texCoordGen, `vec4(${src}, 1.0)`);
        }
    }

    private generateTexGen(texCoordGenIndex: number) {
        const texCoordGen = this.material.texGens[texCoordGenIndex];
        return `
    // TexGen ${texCoordGenIndex} Type: ${texCoordGen.type} Source: ${texCoordGen.source} Matrix: ${texCoordGen.matrix}
    v_TexCoord${texCoordGenIndex} = ${this.generateTexGenPost(texCoordGenIndex)};`;
    }

    private generateTexGens(): string {
        return this.material.texGens.map((tg, i) => {
            return this.generateTexGen(i);
        }).join('');
    }

    private generateTexCoordGetters(): string {
        return this.material.texGens.map((tg, i) => {
            if (tg.type === GX.TexGenType.MTX2x4 || tg.type === GX.TexGenType.SRTG)
                return `vec2 ReadTexCoord${i}() { return v_TexCoord${i}.xy; }\n`;
            else if (tg.type === GX.TexGenType.MTX3x4)
                return `vec2 ReadTexCoord${i}() { return v_TexCoord${i}.xy / v_TexCoord${i}.z; }\n`;
            else
                throw "whoops";
        }).join('');
    }

    // IndTex
    private generateIndTexStageScaleN(scale: GX.IndTexScale): string {
        switch (scale) {
        case GX.IndTexScale._1: return `1.0`;
        case GX.IndTexScale._2: return `1.0/2.0`;
        case GX.IndTexScale._4: return `1.0/4.0`;
        case GX.IndTexScale._8: return `1.0/8.0`;
        case GX.IndTexScale._16: return `1.0/16.0`;
        case GX.IndTexScale._32: return `1.0/32.0`;
        case GX.IndTexScale._64: return `1.0/64.0`;
        case GX.IndTexScale._128: return `1.0/128.0`;
        case GX.IndTexScale._256: return `1.0/256.0`;
        default: throw "whoops";
        }
    }

    private generateIndTexStageScale(stage: IndTexStage): string {
        const baseCoord = `ReadTexCoord${stage.texCoordId}()`;
        if (stage.scaleS === GX.IndTexScale._1 && stage.scaleT === GX.IndTexScale._1)
            return baseCoord;
        else
            return `${baseCoord} * vec2(${this.generateIndTexStageScaleN(stage.scaleS)}, ${this.generateIndTexStageScaleN(stage.scaleT)})`;
    }

    private generateTextureSample(index: number, coord: string): string {
        return `texture(u_Texture[${index}], ${coord}, TextureLODBias(${index}))`;
    }

    private generateIndTexStage(indTexStageIndex: number): string {
        const stage = this.material.indTexStages[indTexStageIndex];
        return `
    // Indirect ${indTexStageIndex}
    vec3 t_IndTexCoord${indTexStageIndex} = 255.0 * ${this.generateTextureSample(stage.texture, this.generateIndTexStageScale(stage))}.abg;`;
    }

    private generateIndTexStages(): string {
        return this.material.indTexStages.map((stage, i) => {
            if (stage.texCoordId >= this.material.texGens.length)
                return '';
            return this.generateIndTexStage(i);
        }).join('');
    }

    // TEV
    private generateKonstColorSel(konstColor: GX.KonstColorSel): string {
        switch (konstColor) {
        case GX.KonstColorSel.KCSEL_1:    return 'vec3(8.0/8.0)';
        case GX.KonstColorSel.KCSEL_7_8:  return 'vec3(7.0/8.0)';
        case GX.KonstColorSel.KCSEL_3_4:  return 'vec3(6.0/8.0)';
        case GX.KonstColorSel.KCSEL_5_8:  return 'vec3(5.0/8.0)';
        case GX.KonstColorSel.KCSEL_1_2:  return 'vec3(4.0/8.0)';
        case GX.KonstColorSel.KCSEL_3_8:  return 'vec3(3.0/8.0)';
        case GX.KonstColorSel.KCSEL_1_4:  return 'vec3(2.0/8.0)';
        case GX.KonstColorSel.KCSEL_1_8:  return 'vec3(1.0/8.0)';
        case GX.KonstColorSel.KCSEL_K0:   return 's_kColor0.rgb';
        case GX.KonstColorSel.KCSEL_K0_R: return 's_kColor0.rrr';
        case GX.KonstColorSel.KCSEL_K0_G: return 's_kColor0.ggg';
        case GX.KonstColorSel.KCSEL_K0_B: return 's_kColor0.bbb';
        case GX.KonstColorSel.KCSEL_K0_A: return 's_kColor0.aaa';
        case GX.KonstColorSel.KCSEL_K1:   return 's_kColor1.rgb';
        case GX.KonstColorSel.KCSEL_K1_R: return 's_kColor1.rrr';
        case GX.KonstColorSel.KCSEL_K1_G: return 's_kColor1.ggg';
        case GX.KonstColorSel.KCSEL_K1_B: return 's_kColor1.bbb';
        case GX.KonstColorSel.KCSEL_K1_A: return 's_kColor1.aaa';
        case GX.KonstColorSel.KCSEL_K2:   return 's_kColor2.rgb';
        case GX.KonstColorSel.KCSEL_K2_R: return 's_kColor2.rrr';
        case GX.KonstColorSel.KCSEL_K2_G: return 's_kColor2.ggg';
        case GX.KonstColorSel.KCSEL_K2_B: return 's_kColor2.bbb';
        case GX.KonstColorSel.KCSEL_K2_A: return 's_kColor2.aaa';
        case GX.KonstColorSel.KCSEL_K3:   return 's_kColor3.rgb';
        case GX.KonstColorSel.KCSEL_K3_R: return 's_kColor3.rrr';
        case GX.KonstColorSel.KCSEL_K3_G: return 's_kColor3.ggg';
        case GX.KonstColorSel.KCSEL_K3_B: return 's_kColor3.bbb';
        case GX.KonstColorSel.KCSEL_K3_A: return 's_kColor3.aaa';
        }
    }

    private generateKonstAlphaSel(konstAlpha: GX.KonstAlphaSel): string {
        switch (konstAlpha) {
        case GX.KonstAlphaSel.KASEL_1:    return '(8.0/8.0)';
        case GX.KonstAlphaSel.KASEL_7_8:  return '(7.0/8.0)';
        case GX.KonstAlphaSel.KASEL_3_4:  return '(6.0/8.0)';
        case GX.KonstAlphaSel.KASEL_5_8:  return '(5.0/8.0)';
        case GX.KonstAlphaSel.KASEL_1_2:  return '(4.0/8.0)';
        case GX.KonstAlphaSel.KASEL_3_8:  return '(3.0/8.0)';
        case GX.KonstAlphaSel.KASEL_1_4:  return '(2.0/8.0)';
        case GX.KonstAlphaSel.KASEL_1_8:  return '(1.0/8.0)';
        case GX.KonstAlphaSel.KASEL_K0_R: return 's_kColor0.r';
        case GX.KonstAlphaSel.KASEL_K0_G: return 's_kColor0.g';
        case GX.KonstAlphaSel.KASEL_K0_B: return 's_kColor0.b';
        case GX.KonstAlphaSel.KASEL_K0_A: return 's_kColor0.a';
        case GX.KonstAlphaSel.KASEL_K1_R: return 's_kColor1.r';
        case GX.KonstAlphaSel.KASEL_K1_G: return 's_kColor1.g';
        case GX.KonstAlphaSel.KASEL_K1_B: return 's_kColor1.b';
        case GX.KonstAlphaSel.KASEL_K1_A: return 's_kColor1.a';
        case GX.KonstAlphaSel.KASEL_K2_R: return 's_kColor2.r';
        case GX.KonstAlphaSel.KASEL_K2_G: return 's_kColor2.g';
        case GX.KonstAlphaSel.KASEL_K2_B: return 's_kColor2.b';
        case GX.KonstAlphaSel.KASEL_K2_A: return 's_kColor2.a';
        case GX.KonstAlphaSel.KASEL_K3_R: return 's_kColor3.r';
        case GX.KonstAlphaSel.KASEL_K3_G: return 's_kColor3.g';
        case GX.KonstAlphaSel.KASEL_K3_B: return 's_kColor3.b';
        case GX.KonstAlphaSel.KASEL_K3_A: return 's_kColor3.a';
        }
    }

    private generateRas(stage: TevStage) {
        switch (stage.channelId) {
        case GX.RasColorChannelID.COLOR0A0:   return `v_Color0`;
        case GX.RasColorChannelID.COLOR1A1:   return `v_Color1`;
        case GX.RasColorChannelID.COLOR_ZERO: return `vec4(0, 0, 0, 0)`;
        default:
            throw new Error(`whoops ${stage.channelId}`);
        }
    }

    private generateTexAccess(stage: TevStage) {
        // Skyward Sword is amazing sometimes. I hope you're happy...
        // assert(stage.texMap !== GX.TexMapID.TEXMAP_NULL);
        if (stage.texMap === GX.TexMapID.TEXMAP_NULL)
            return 'vec4(1.0, 1.0, 1.0, 1.0)';

        // If we disable textures, then return sampled white.
        if (this.hacks !== null && this.hacks.disableTextures)
            return 'vec4(1.0, 1.0, 1.0, 1.0)';

        return this.generateTextureSample(stage.texMap, `t_TexCoord`);
    }

    private generateComponentSwizzle(swapTable: GX.TevColorChan[] | undefined, channel: GX.TevColorChan): string {
        const suffixes = ['r', 'g', 'b', 'a'];
        if (swapTable)
            channel = swapTable[channel];
        return suffixes[channel];
    }

    private generateColorSwizzle(swapTable: GX.TevColorChan[] | undefined, colorIn: GX.CombineColorInput): string {
        const swapR = this.generateComponentSwizzle(swapTable, GX.TevColorChan.R);
        const swapG = this.generateComponentSwizzle(swapTable, GX.TevColorChan.G);
        const swapB = this.generateComponentSwizzle(swapTable, GX.TevColorChan.B);
        const swapA = this.generateComponentSwizzle(swapTable, GX.TevColorChan.A);

        switch (colorIn) {
        case GX.CombineColorInput.TEXC:
        case GX.CombineColorInput.RASC:
            return `${swapR}${swapG}${swapB}`;
        case GX.CombineColorInput.TEXA:
        case GX.CombineColorInput.RASA:
            return `${swapA}${swapA}${swapA}`;
        default:
            throw "whoops";
        }
    }

    private generateColorIn(stage: TevStage, colorIn: GX.CombineColorInput) {
        switch (colorIn) {
        case GX.CombineColorInput.CPREV: return `t_ColorPrev.rgb`;
        case GX.CombineColorInput.APREV: return `t_ColorPrev.aaa`;
        case GX.CombineColorInput.C0:    return `t_Color0.rgb`;
        case GX.CombineColorInput.A0:    return `t_Color0.aaa`;
        case GX.CombineColorInput.C1:    return `t_Color1.rgb`;
        case GX.CombineColorInput.A1:    return `t_Color1.aaa`;
        case GX.CombineColorInput.C2:    return `t_Color2.rgb`;
        case GX.CombineColorInput.A2:    return `t_Color2.aaa`;
        case GX.CombineColorInput.TEXC:  return `${this.generateTexAccess(stage)}.${this.generateColorSwizzle(stage.texSwapTable, colorIn)}`;
        case GX.CombineColorInput.TEXA:  return `${this.generateTexAccess(stage)}.${this.generateColorSwizzle(stage.texSwapTable, colorIn)}`;
        case GX.CombineColorInput.RASC:  return `TevSaturate(${this.generateRas(stage)}.${this.generateColorSwizzle(stage.rasSwapTable, colorIn)})`;
        case GX.CombineColorInput.RASA:  return `TevSaturate(${this.generateRas(stage)}.${this.generateColorSwizzle(stage.rasSwapTable, colorIn)})`;
        case GX.CombineColorInput.ONE:   return `vec3(1)`;
        case GX.CombineColorInput.HALF:  return `vec3(1.0/2.0)`;
        case GX.CombineColorInput.KONST: return `${this.generateKonstColorSel(stage.konstColorSel)}`;
        case GX.CombineColorInput.ZERO:  return `vec3(0)`;
        }
    }

    private generateAlphaIn(stage: TevStage, alphaIn: GX.CombineAlphaInput) {
        switch (alphaIn) {
        case GX.CombineAlphaInput.APREV: return `t_ColorPrev.a`;
        case GX.CombineAlphaInput.A0:    return `t_Color0.a`;
        case GX.CombineAlphaInput.A1:    return `t_Color1.a`;
        case GX.CombineAlphaInput.A2:    return `t_Color2.a`;
        case GX.CombineAlphaInput.TEXA:  return `${this.generateTexAccess(stage)}.${this.generateComponentSwizzle(stage.texSwapTable, GX.TevColorChan.A)}`;
        case GX.CombineAlphaInput.RASA:  return `TevSaturate(${this.generateRas(stage)}.${this.generateComponentSwizzle(stage.rasSwapTable, GX.TevColorChan.A)})`;
        case GX.CombineAlphaInput.KONST: return `${this.generateKonstAlphaSel(stage.konstAlphaSel)}`;
        case GX.CombineAlphaInput.ZERO:  return `0.0`;
        }
    }

    private generateTevInputs(stage: TevStage) {
        return `
    t_TevA = TevOverflow(vec4(${this.generateColorIn(stage, stage.colorInA)}, ${this.generateAlphaIn(stage, stage.alphaInA)}));
    t_TevB = TevOverflow(vec4(${this.generateColorIn(stage, stage.colorInB)}, ${this.generateAlphaIn(stage, stage.alphaInB)}));
    t_TevC = TevOverflow(vec4(${this.generateColorIn(stage, stage.colorInC)}, ${this.generateAlphaIn(stage, stage.alphaInC)}));
    t_TevD = vec4(${this.generateColorIn(stage, stage.colorInD)}, ${this.generateAlphaIn(stage, stage.alphaInD)});
`.trim();
    }

    private generateTevRegister(regId: GX.Register) {
        switch (regId) {
        case GX.Register.PREV: return `t_ColorPrev`;
        case GX.Register.REG0: return `t_Color0`;
        case GX.Register.REG1: return `t_Color1`;
        case GX.Register.REG2: return `t_Color2`;
        }
    }

    private generateTevOpBiasScaleClamp(value: string, bias: GX.TevBias, scale: GX.TevScale) {
        let v = value;

        if (bias === GX.TevBias.ADDHALF)
            v = `TevBias(${v}, 0.5)`;
        else if (bias === GX.TevBias.SUBHALF)
            v = `TevBias(${v}, -0.5)`;

        if (scale === GX.TevScale.SCALE_2)
            v = `(${v}) * 2.0`;
        else if (scale === GX.TevScale.SCALE_4)
            v = `(${v}) * 4.0`;
        else if (scale === GX.TevScale.DIVIDE_2)
            v = `(${v}) * 0.5`;

        return v;
    }

    private generateTevOp(op: GX.TevOp, bias: GX.TevBias, scale: GX.TevScale, a: string, b: string, c: string, d: string, zero: string) {
        switch (op) {
        case GX.TevOp.ADD:
        case GX.TevOp.SUB:
            const neg = (op === GX.TevOp.SUB) ? '-' : '';
            const v = `${neg}mix(${a}, ${b}, ${c}) + ${d}`;
            return this.generateTevOpBiasScaleClamp(v, bias, scale);
        case GX.TevOp.COMP_R8_GT:     return `((t_TevA.r >  t_TevB.r) ? ${c} : ${zero}) + ${d}`;
        case GX.TevOp.COMP_R8_EQ:     return `((t_TevA.r == t_TevB.r) ? ${c} : ${zero}) + ${d}`;
        case GX.TevOp.COMP_GR16_GT:   return `((TevPack16(t_TevA.rg) >  TevPack16(t_TevB.rg)) ? ${c} : ${zero}) + ${d}`;
        case GX.TevOp.COMP_GR16_EQ:   return `((TevPack16(t_TevA.rg) == TevPack16(t_TevB.rg)) ? ${c} : ${zero}) + ${d}`;
        case GX.TevOp.COMP_BGR24_GT:  return `((TevPack24(t_TevA.rgb) >  TevPack24(t_TevB.rgb)) ? ${c} : ${zero}) + ${d}`;
        case GX.TevOp.COMP_BGR24_EQ:  return `((TevPack24(t_TevA.rgb) == TevPack24(t_TevB.rgb)) ? ${c} : ${zero}) + ${d}`;
        case GX.TevOp.COMP_RGB8_GT:   return `(TevPerCompGT(${a}, ${b}) * ${c}) + ${d}`;
        case GX.TevOp.COMP_RGB8_EQ:   return `(TevPerCompEQ(${a}, ${b}) * ${c}) + ${d}`;
        default:
            debugger;
            throw new Error("whoops");
        }
    }

    private generateTevOpValue(op: GX.TevOp, bias: GX.TevBias, scale: GX.TevScale, clamp: boolean, a: string, b: string, c: string, d: string, zero: string) {
        const expr = this.generateTevOp(op, bias, scale, a, b, c, d, zero);

        if (clamp)
            return `TevSaturate(${expr})`;
        else
            return expr;
    }

    private generateColorOp(stage: TevStage) {
        const a = `t_TevA.rgb`, b = `t_TevB.rgb`, c = `t_TevC.rgb`, d = `t_TevD.rgb`, zero = `vec3(0)`;
        const value = this.generateTevOpValue(stage.colorOp, stage.colorBias, stage.colorScale, stage.colorClamp, a, b, c, d, zero);
        return `${this.generateTevRegister(stage.colorRegId)}.rgb = ${value};`;
    }

    private generateAlphaOp(stage: TevStage) {
        const a = `t_TevA.a`, b = `t_TevB.a`, c = `t_TevC.a`, d = `t_TevD.a`, zero = '0.0';
        const value = this.generateTevOpValue(stage.alphaOp, stage.alphaBias, stage.alphaScale, stage.alphaClamp, a, b, c, d, zero);
        return `${this.generateTevRegister(stage.alphaRegId)}.a = ${value};`;
    }

    private generateTevTexCoordWrapN(texCoord: string, wrap: GX.IndTexWrap): string {
        switch (wrap) {
        case GX.IndTexWrap.OFF:  return texCoord;
        case GX.IndTexWrap._0:   return '0.0';
        case GX.IndTexWrap._256: return `mod(${texCoord}, 256.0)`;
        case GX.IndTexWrap._128: return `mod(${texCoord}, 128.0)`;
        case GX.IndTexWrap._64:  return `mod(${texCoord}, 64.0)`;
        case GX.IndTexWrap._32:  return `mod(${texCoord}, 32.0)`;
        case GX.IndTexWrap._16:  return `mod(${texCoord}, 16.0)`;
        }
    }

    private generateTevTexCoordWrap(stage: TevStage): string {
        const lastTexGenId = this.material.texGens.length - 1;
        let texGenId = stage.texCoordId;

        if (texGenId >= lastTexGenId)
            texGenId = lastTexGenId;
        if (texGenId < 0)
            return `vec2(0.0, 0.0)`;

        const baseCoord = `ReadTexCoord${texGenId}()`;
        if (stage.indTexWrapS === GX.IndTexWrap.OFF && stage.indTexWrapT === GX.IndTexWrap.OFF)
            return baseCoord;
        else
            return `vec2(${this.generateTevTexCoordWrapN(`${baseCoord}.x`, stage.indTexWrapS)}, ${this.generateTevTexCoordWrapN(`${baseCoord}.y`, stage.indTexWrapT)})`;
    }

    private generateTevTexCoordIndTexCoordBias(stage: TevStage): string {
        const bias = (stage.indTexFormat === GX.IndTexFormat._8) ? '-128.0' : `1.0`;

        switch (stage.indTexBiasSel) {
        case GX.IndTexBiasSel.NONE: return ``;
        case GX.IndTexBiasSel.S:    return ` + vec3(${bias}, 0.0, 0.0)`;
        case GX.IndTexBiasSel.ST:   return ` + vec3(${bias}, ${bias}, 0.0)`;
        case GX.IndTexBiasSel.SU:   return ` + vec3(${bias}, 0.0, ${bias})`;
        case GX.IndTexBiasSel.T:    return ` + vec3(0.0, ${bias}, 0.0)`;
        case GX.IndTexBiasSel.TU:   return ` + vec3(0.0, ${bias}, ${bias})`;
        case GX.IndTexBiasSel.U:    return ` + vec3(0.0, 0.0, ${bias})`;
        case GX.IndTexBiasSel.STU:  return ` + vec3(${bias})`;
        }
    }

    private generateTevTexCoordIndTexCoord(stage: TevStage): string {
        const baseCoord = `(t_IndTexCoord${stage.indTexStage})`;
        switch (stage.indTexFormat) {
        case GX.IndTexFormat._8: return baseCoord;
        default:
        case GX.IndTexFormat._5: throw new Error("whoops");
        }
    }

    private generateTevTexCoordIndirectMtx(stage: TevStage): string {
        const indTevCoord = `(${this.generateTevTexCoordIndTexCoord(stage)}${this.generateTevTexCoordIndTexCoordBias(stage)})`;

        switch (stage.indTexMatrix) {
        case GX.IndTexMtxID._0:  return `Mul(u_IndTexMtx[0], vec4(${indTevCoord}, 0.0))`;
        case GX.IndTexMtxID._1:  return `Mul(u_IndTexMtx[1], vec4(${indTevCoord}, 0.0))`;
        case GX.IndTexMtxID._2:  return `Mul(u_IndTexMtx[2], vec4(${indTevCoord}, 0.0))`;
        // TODO(jstpierre): These other options. BossBakkunPlanet.arc uses them.
        default:
            console.warn(`Unimplemented indTexMatrix mode: ${stage.indTexMatrix}`);
            return `${indTevCoord}.xy`;
        }
    }

    private generateTevTexCoordIndirectTranslation(stage: TevStage): string {
        return `(${this.generateTevTexCoordIndirectMtx(stage)} * TextureInvScale(${stage.texMap}))`;
    }

    private generateTevTexCoordIndirect(stage: TevStage): string {
        const baseCoord = this.generateTevTexCoordWrap(stage);
        if (stage.indTexMatrix !== GX.IndTexMtxID.OFF && stage.indTexStage < this.material.indTexStages.length)
            return `${baseCoord} + ${this.generateTevTexCoordIndirectTranslation(stage)}`;
        else
            return baseCoord;
    }

    private generateTevTexCoord(stage: TevStage): string {
        if (stage.texCoordId === GX.TexCoordID.TEXCOORD_NULL)
            return '';

        const finalCoord = this.generateTevTexCoordIndirect(stage);
        if (stage.indTexAddPrev) {
            return `t_TexCoord += ${finalCoord};`;
        } else {
            return `t_TexCoord = ${finalCoord};`;
        }
    }

    private generateTevStage(tevStageIndex: number): string {
        const stage = this.material.tevStages[tevStageIndex];

        return `
    // TEV Stage ${tevStageIndex}
    ${this.generateTevTexCoord(stage)}
    // Color Combine
    // colorIn: ${stage.colorInA} ${stage.colorInB} ${stage.colorInC} ${stage.colorInD}  colorOp: ${stage.colorOp} colorBias: ${stage.colorBias} colorScale: ${stage.colorScale} colorClamp: ${stage.colorClamp} colorRegId: ${stage.colorRegId}
    // alphaIn: ${stage.alphaInA} ${stage.alphaInB} ${stage.alphaInC} ${stage.alphaInD}  alphaOp: ${stage.alphaOp} alphaBias: ${stage.alphaBias} alphaScale: ${stage.alphaScale} alphaClamp: ${stage.alphaClamp} alphaRegId: ${stage.alphaRegId}
    // texCoordId: ${stage.texCoordId} texMap: ${stage.texMap} channelId: ${stage.channelId}
    ${this.generateTevInputs(stage)}
    ${this.generateColorOp(stage)}
    ${this.generateAlphaOp(stage)}`;
    }

    private generateTevStages() {
        return this.material.tevStages.map((s, i) => this.generateTevStage(i)).join(`\n`);
    }

    private generateTevStagesLastMinuteFixup() {
        const tevStages = this.material.tevStages;
        // Despite having a destination register, the output of the last stage
        // is what gets output from the color combinations...
        const lastTevStage = tevStages[tevStages.length - 1];
        const colorReg = this.generateTevRegister(lastTevStage.colorRegId);
        const alphaReg = this.generateTevRegister(lastTevStage.alphaRegId);
        if (colorReg === alphaReg) {
            return `
    vec4 t_TevOutput = ${colorReg};`;
        } else {
            return `
    vec4 t_TevOutput = vec4(${colorReg}.rgb, ${alphaReg}.a);`;
        }
    }

    private generateAlphaTestCompare(compare: GX.CompareType, reference: number) {
        const ref = this.generateFloat(reference);
        switch (compare) {
        case GX.CompareType.NEVER:   return `false`;
        case GX.CompareType.LESS:    return `t_TevOutput.a <  ${ref}`;
        case GX.CompareType.EQUAL:   return `t_TevOutput.a == ${ref}`;
        case GX.CompareType.LEQUAL:  return `t_TevOutput.a <= ${ref}`;
        case GX.CompareType.GREATER: return `t_TevOutput.a >  ${ref}`;
        case GX.CompareType.NEQUAL:  return `t_TevOutput.a != ${ref}`;
        case GX.CompareType.GEQUAL:  return `t_TevOutput.a >= ${ref}`;
        case GX.CompareType.ALWAYS:  return `true`;
        }
    }

    private generateAlphaTestOp(op: GX.AlphaOp) {
        switch (op) {
        case GX.AlphaOp.AND:  return `t_AlphaTestA && t_AlphaTestB`;
        case GX.AlphaOp.OR:   return `t_AlphaTestA || t_AlphaTestB`;
        case GX.AlphaOp.XOR:  return `t_AlphaTestA != t_AlphaTestB`;
        case GX.AlphaOp.XNOR: return `t_AlphaTestA == t_AlphaTestB`;
        }
    }

    private generateAlphaTest() {
        const alphaTest = this.material.alphaTest;
        return `
    // Alpha Test: Op ${alphaTest.op}
    // Compare A: ${alphaTest.compareA} Reference A: ${this.generateFloat(alphaTest.referenceA)}
    // Compare B: ${alphaTest.compareB} Reference B: ${this.generateFloat(alphaTest.referenceB)}
    bool t_AlphaTestA = ${this.generateAlphaTestCompare(alphaTest.compareA, alphaTest.referenceA)};
    bool t_AlphaTestB = ${this.generateAlphaTestCompare(alphaTest.compareB, alphaTest.referenceB)};
    if (!(${this.generateAlphaTestOp(alphaTest.op)}))
        discard;`;
    }

    private generateAttributeStorageType(fmt: GfxFormat): string {
        switch (fmt) {
        case GfxFormat.F32_R:    return 'float';
        case GfxFormat.F32_RG:   return 'vec2';
        case GfxFormat.F32_RGB:  return 'vec3';
        case GfxFormat.F32_RGBA: return 'vec4';
        default: throw "whoops";
        }
    }

    private generateVertAttributeDefs() {
        return vtxAttributeGenDefs.map((a, i) => {
            return `layout(location = ${i}) in ${this.generateAttributeStorageType(a.format)} a_${a.name};`;
        }).join('\n');
    }

    private generateMulPos(): string {
        // Default to using pnmtxidx.
        const usePnMtxIdx = this.material.usePnMtxIdx !== undefined ? this.material.usePnMtxIdx : true;
        const src = `vec4(a_Position, 1.0)`;
        if (usePnMtxIdx)
            return this.generateMulPntMatrixDynamic(`uint(a_PnMtxIdx)`, src);
        else
            return this.generateMulPntMatrixStatic(GX.TexGenMatrix.PNMTX0, src);
    }

    private generateMulNrm(): string {
        // Default to using pnmtxidx.
        const usePnMtxIdx = this.material.usePnMtxIdx !== undefined ? this.material.usePnMtxIdx : true;
        const src = `vec4(a_Normal, 0.0)`;
        // TODO(jstpierre): Move to a normal matrix calculated on the CPU
        if (usePnMtxIdx)
            return this.generateMulPntMatrixDynamic(`uint(a_PnMtxIdx)`, src);
        else
            return this.generateMulPntMatrixStatic(GX.TexGenMatrix.PNMTX0, src);
    }

    private generateWire(): string {
return `
    vec3 t_BaryWire = v_Color1.rgb / (fwidth(v_Color1.rgb) * 0.5);
    if (!any(lessThan(t_BaryWire, vec3(1.5))))
        discard;
`;
    }

    public generateShaders(): void {
        const bindingsDefinition = generateBindingsDefinition(this.material);

        const both = `
// ${this.material.name}
precision highp float;
${bindingsDefinition}

varying vec3 v_Position;
varying vec4 v_Color0;
varying vec4 v_Color1; // bary
varying vec4 v_Color2; // extra tint
varying vec3 v_TexCoord0;
varying vec3 v_TexCoord1;
varying vec3 v_TexCoord2;
varying vec3 v_TexCoord3;
varying vec3 v_TexCoord4;
varying vec3 v_TexCoord5;
varying vec3 v_TexCoord6;
varying vec3 v_TexCoord7;
`;

        this.vert = `
${both}
${this.generateVertAttributeDefs()}

vec3 Bary() {
    int m = gl_VertexID % 3;
    float t_WireBase = -u_LightParams[7].CosAtten.x;
    float v0 = ((m == 0) ? 1.0 : 0.0) + t_WireBase;
    float v1 = ((m == 1) ? 1.0 : 0.0) + t_WireBase;
    float v2 = ((m == 2) ? 1.0 : 0.0) + t_WireBase;
    return vec3(v0, v1, v2);
}

Mat4x3 GetPosTexMatrix(uint t_MtxIdx) {
    if (t_MtxIdx == ${GX.TexGenMatrix.IDENTITY}u)
        return _Mat4x3(1.0);
    else if (t_MtxIdx >= ${GX.TexGenMatrix.TEXMTX0}u)
        return u_TexMtx[(t_MtxIdx - ${GX.TexGenMatrix.TEXMTX0}u) / 3u];
    else
        return u_PosMtx[t_MtxIdx / 3u];
}

float ApplyCubic(vec3 t_Coeff, float t_Value) {
    return max(dot(t_Coeff, vec3(1.0, t_Value, t_Value*t_Value)), 0.0);
}

float hash( in uint n )
{
    // integer hash copied from Hugo Elias
	n = (n<<13U)^n; 
    n = n*(n*n*15731U+789221U)+1376312589U;
    return float(n&uvec3(0x0fffffffU))/float(0x0fffffff);
}

float bnoise( in float x )
{
    // setup    
    float i = floor(x);
    float f = fract(x);
    float s = sign(fract(x/2.0)-0.5);
    
    // use some hash to create a random value k in [0..1] from i
    float k = hash(uint(i));

    // quartic polynomial
    return s*f*(f-1.0)*((16.0*k-4.0)*f*(f-1.0)-1.0);
}

float pulse(in float time) {
    return sin(clamp(time, 0.0, 1.0) * 3.1415);
}

vec3 posnoise(in vec3 pos, in float time) {
    return vec3(bnoise(pos.x + time), bnoise(pos.y + time), bnoise(pos.z + time));
}

void main() {
    vec3 t_Position = ${this.generateMulPos()};
    v_Position = t_Position;
    vec3 t_Normal = ${this.generateMulNrm()};

    vec4 t_LightAccum;
    vec3 t_LightDelta, t_LightDeltaDir;
    float t_LightDeltaDist2, t_LightDeltaDist;
    vec4 t_ColorChanTemp;
${this.generateLightChannels()}
${this.generateTexGens()}

    float t_Key = (-t_Position.x + t_Position.y) / 100.0 - 1.0;

    float t_Time = u_LightParams[7].DistAtten.x;
    float t_PosAnimTime = u_LightParams[7].DistAtten.z;
    t_Position.xyz += (t_Normal * posnoise(a_Position, t_Time * 10.0)) * pulse(t_PosAnimTime + t_Key) * u_LightParams[7].DistAtten.y;
    v_TexCoord0.xy += (vec2(bnoise(a_Position.x + t_Time), bnoise(a_Position.y + t_Time))) * u_LightParams[7].CosAtten.z;
    v_Color2.rgb = vec3(1.0) + (posnoise(a_Position, t_Time * 3.0) * u_LightParams[7].CosAtten.y);
    v_Color2.a = 1.0;

    v_Color1 = vec4(Bary(), 1.0);
    gl_Position = Mul(u_Projection, vec4(t_Position, 1.0));
}
`;

        this.frag = `
${both}
${this.generateTexCoordGetters()}

float TextureLODBias(int index) { return u_SceneTextureLODBias + u_TextureParams[index].w; }
vec2 TextureInvScale(int index) { return 1.0 / u_TextureParams[index].xy; }
vec2 TextureScale(int index) { return u_TextureParams[index].xy; }

vec3 TevBias(vec3 a, float b) { return a + vec3(b); }
float TevBias(float a, float b) { return a + b; }
vec3 TevSaturate(vec3 a) { return clamp(a, vec3(0), vec3(1)); }
float TevSaturate(float a) { return clamp(a, 0.0, 1.0); }
float TevOverflow(float a) { return float(int(a * 255.0) & 255) / 255.0; }
vec4 TevOverflow(vec4 a) { return vec4(TevOverflow(a.r), TevOverflow(a.g), TevOverflow(a.b), TevOverflow(a.a)); }
float TevPack16(vec2 a) { return dot(a, vec2(1.0, 256.0)); }
float TevPack24(vec3 a) { return dot(a, vec3(1.0, 256.0, 256.0 * 256.0)); }
float TevPerCompGT(float a, float b) { return float(a >  b); }
float TevPerCompEQ(float a, float b) { return float(a == b); }
vec3 TevPerCompGT(vec3 a, vec3 b) { return vec3(greaterThan(a, b)); }
vec3 TevPerCompEQ(vec3 a, vec3 b) { return vec3(greaterThan(a, b)); }

void main() {
    vec4 s_kColor0   = u_KonstColor[0];
    vec4 s_kColor1   = u_KonstColor[1];
    vec4 s_kColor2   = u_KonstColor[2];
    vec4 s_kColor3   = u_KonstColor[3];

    vec4 t_ColorPrev = u_Color[0];
    vec4 t_Color0    = u_Color[1];
    vec4 t_Color1    = u_Color[2];
    vec4 t_Color2    = u_Color[3];

${this.generateIndTexStages()}

    vec2 t_TexCoord = vec2(0.0, 0.0);
    vec4 t_TevA, t_TevB, t_TevC, t_TevD;
${this.generateTevStages()}

${this.generateTevStagesLastMinuteFixup()}
    t_TevOutput = TevOverflow(t_TevOutput);
    t_TevOutput.rgb *= v_Color2.rgb;
${this.generateAlphaTest()}
    gl_FragColor = t_TevOutput;
${this.generateWire()}
}
`;
    }
}
// #endregion

// #region Material flags generation.
export function translateCullMode(cullMode: GX.CullMode): GfxCullMode {
    switch (cullMode) {
    case GX.CullMode.ALL:
        return GfxCullMode.FRONT_AND_BACK;
    case GX.CullMode.FRONT:
        return GfxCullMode.FRONT;
    case GX.CullMode.BACK:
        return GfxCullMode.BACK;
    case GX.CullMode.NONE:
        return GfxCullMode.NONE;
    }
}

function translateBlendFactorCommon(blendFactor: GX.BlendFactor): GfxBlendFactor {
    switch (blendFactor) {
    case GX.BlendFactor.ZERO:
        return GfxBlendFactor.ZERO;
    case GX.BlendFactor.ONE:
        return GfxBlendFactor.ONE;
    case GX.BlendFactor.SRCALPHA:
        return GfxBlendFactor.SRC_ALPHA;
    case GX.BlendFactor.INVSRCALPHA:
        return GfxBlendFactor.ONE_MINUS_SRC_ALPHA;
    case GX.BlendFactor.DSTALPHA:
        return GfxBlendFactor.DST_ALPHA;
    case GX.BlendFactor.INVDSTALPHA:
        return GfxBlendFactor.ONE_MINUS_DST_ALPHA;
    default:
        throw new Error("whoops");
    }
}

function translateBlendSrcFactor(blendFactor: GX.BlendFactor): GfxBlendFactor {
    switch (blendFactor) {
    case GX.BlendFactor.SRCCLR:
        return GfxBlendFactor.DST_COLOR;
    case GX.BlendFactor.INVSRCCLR:
        return GfxBlendFactor.ONE_MINUS_DST_COLOR;
    default:
        return translateBlendFactorCommon(blendFactor);
    }
}

function translateBlendDstFactor(blendFactor: GX.BlendFactor): GfxBlendFactor {
    switch (blendFactor) {
    case GX.BlendFactor.SRCCLR:
        return GfxBlendFactor.SRC_COLOR;
    case GX.BlendFactor.INVSRCCLR:
        return GfxBlendFactor.ONE_MINUS_SRC_COLOR;
    default:
        return translateBlendFactorCommon(blendFactor);
    }
}

function translateCompareType(compareType: GX.CompareType): GfxCompareMode {
    switch (compareType) {
    case GX.CompareType.NEVER:
        return GfxCompareMode.NEVER;
    case GX.CompareType.LESS:
        return GfxCompareMode.LESS;
    case GX.CompareType.EQUAL:
        return GfxCompareMode.EQUAL;
    case GX.CompareType.LEQUAL:
        return GfxCompareMode.LEQUAL;
    case GX.CompareType.GREATER:
        return GfxCompareMode.GREATER;
    case GX.CompareType.NEQUAL:
        return GfxCompareMode.NEQUAL;
    case GX.CompareType.GEQUAL:
        return GfxCompareMode.GEQUAL;
    case GX.CompareType.ALWAYS:
        return GfxCompareMode.ALWAYS;
    }
}

export function translateGfxMegaState(megaState: Partial<GfxMegaStateDescriptor>, material: GXMaterial) {
    megaState.cullMode = translateCullMode(material.cullMode);
    megaState.depthWrite = material.ropInfo.depthWrite;
    megaState.depthCompare = material.ropInfo.depthTest ? reverseDepthForCompareMode(translateCompareType(material.ropInfo.depthFunc)) : GfxCompareMode.ALWAYS;
    megaState.frontFace = GfxFrontFaceMode.CW;

    const attachmentStateSimple: Partial<AttachmentStateSimple> = {};

    if (material.ropInfo.blendMode.type === GX.BlendMode.NONE) {
        attachmentStateSimple.blendMode = GfxBlendMode.ADD;
        attachmentStateSimple.blendSrcFactor = GfxBlendFactor.ONE;
        attachmentStateSimple.blendDstFactor = GfxBlendFactor.ZERO;
    } else if (material.ropInfo.blendMode.type === GX.BlendMode.BLEND) {
        attachmentStateSimple.blendMode = GfxBlendMode.ADD;
        attachmentStateSimple.blendSrcFactor = translateBlendSrcFactor(material.ropInfo.blendMode.srcFactor);
        attachmentStateSimple.blendDstFactor = translateBlendDstFactor(material.ropInfo.blendMode.dstFactor);
    } else if (material.ropInfo.blendMode.type === GX.BlendMode.SUBTRACT) {
        attachmentStateSimple.blendMode = GfxBlendMode.REVERSE_SUBTRACT;
        attachmentStateSimple.blendSrcFactor = GfxBlendFactor.ONE;
        attachmentStateSimple.blendDstFactor = GfxBlendFactor.ONE;
    } else if (material.ropInfo.blendMode.type === GX.BlendMode.LOGIC) {
        // Sonic Colors uses this? WTF?
        attachmentStateSimple.blendMode = GfxBlendMode.ADD;
        attachmentStateSimple.blendSrcFactor = GfxBlendFactor.ONE;
        attachmentStateSimple.blendDstFactor = GfxBlendFactor.ZERO;
        console.warn(`Unimplemented LOGIC blend mode`);
    }

    setAttachmentStateSimple(megaState, attachmentStateSimple);
}
// #endregion

// #region Material parsing
export function parseTexGens(r: DisplayListRegisters, numTexGens: number): TexGen[] {
    const texGens: TexGen[] = [];

    for (let i = 0; i < numTexGens; i++) {
        const v = r.xfg(GX.XFRegister.XF_TEX0_ID + i);

        const enum TexProjection {
            ST = 0x00,
            STQ = 0x01,
        }
        const enum TexForm {
            AB11 = 0x00,
            ABC1 = 0x01,
        }
        const enum TexGenType {
            REGULAR = 0x00,
            EMBOSS_MAP = 0x01,
            COLOR_STRGBC0 = 0x02,
            COLOR_STRGBC1 = 0x02,
        }
        const enum TexSourceRow {
            GEOM = 0x00,
            NRM = 0x01,
            CLR = 0x02,
            BNT = 0x03,
            BNB = 0x04,
            TEX0 = 0x05,
            TEX1 = 0x06,
            TEX2 = 0x07,
            TEX3 = 0x08,
            TEX4 = 0x09,
            TEX5 = 0x0A,
            TEX6 = 0x0B,
            TEX7 = 0x0C,
        }

        const proj: TexProjection = (v >>>  1) & 0x01;
        const form: TexForm =       (v >>>  2) & 0x01;
        const tgType: TexGenType =  (v >>>  4) & 0x02;
        const src: TexSourceRow =   (v >>>  7) & 0x0F;
        const embossSrc =           (v >>> 12) & 0x07;
        const embossLgt =           (v >>> 15) & 0x07;

        let texGenType: GX.TexGenType;
        let texGenSrc: GX.TexGenSrc;

        if (tgType === TexGenType.REGULAR) {
            const srcLookup = [
                GX.TexGenSrc.POS,
                GX.TexGenSrc.NRM,
                GX.TexGenSrc.COLOR0,
                GX.TexGenSrc.BINRM,
                GX.TexGenSrc.TANGENT,
                GX.TexGenSrc.TEX0,
                GX.TexGenSrc.TEX1,
                GX.TexGenSrc.TEX2,
                GX.TexGenSrc.TEX3,
                GX.TexGenSrc.TEX4,
                GX.TexGenSrc.TEX5,
                GX.TexGenSrc.TEX6,
                GX.TexGenSrc.TEX7,
            ];

            texGenType = proj === TexProjection.ST ? GX.TexGenType.MTX2x4 : GX.TexGenType.MTX3x4;
            texGenSrc = srcLookup[src];
        } else if (tgType === TexGenType.EMBOSS_MAP) {
            texGenType = GX.TexGenType.BUMP0 + embossLgt;
            texGenSrc = GX.TexGenSrc.TEXCOORD0 + embossSrc;
        } else if (tgType === TexGenType.COLOR_STRGBC0) {
            texGenType = GX.TexGenType.SRTG;
            texGenSrc = GX.TexGenSrc.COLOR0;
        } else if (tgType === TexGenType.COLOR_STRGBC1) {
            texGenType = GX.TexGenType.SRTG;
            texGenSrc = GX.TexGenSrc.COLOR1;
        } else {
            throw "whoops";
        }

        const matrix: GX.TexGenMatrix = GX.TexGenMatrix.IDENTITY;

        const dv = r.xfg(GX.XFRegister.XF_DUALTEX0_ID + i);
        const postMatrix: GX.PostTexGenMatrix = ((dv >>> 0) & 0xFF) + GX.PostTexGenMatrix.PTTEXMTX0;
        const normalize: boolean = !!((dv >>> 8) & 0x01);

        texGens.push({ type: texGenType, source: texGenSrc, matrix, normalize, postMatrix });
    }

    return texGens;
}

function findTevOp(bias: GX.TevBias, scale: GX.TevScale, sub: boolean): GX.TevOp {
    if (bias === GX.TevBias.$HWB_COMPARE) {
        switch (scale) {
        case GX.TevScale.$HWB_R8: return sub ? GX.TevOp.COMP_R8_EQ : GX.TevOp.COMP_R8_GT;
        case GX.TevScale.$HWB_GR16: return sub ? GX.TevOp.COMP_GR16_EQ : GX.TevOp.COMP_GR16_GT;
        case GX.TevScale.$HWB_BGR24: return sub ? GX.TevOp.COMP_BGR24_EQ : GX.TevOp.COMP_BGR24_GT;
        case GX.TevScale.$HWB_RGB8: return sub ? GX.TevOp.COMP_RGB8_EQ : GX.TevOp.COMP_RGB8_GT;
        default:
            throw "whoops 2";
        }
    } else {
        return sub ? GX.TevOp.SUB : GX.TevOp.ADD;
    }
}

export function parseTevStages(r: DisplayListRegisters, numTevs: number): TevStage[] {
    const tevStages: TevStage[] = [];

    interface TevOrder {
        texMapId: GX.TexMapID;
        texCoordId: GX.TexCoordID;
        channelId: GX.RasColorChannelID;
    }

    const tevOrders: TevOrder[] = [];

    // First up, parse RAS1_TREF into tev orders.
    for (let i = 0; i < 8; i++) {
        const v = r.bp[GX.BPRegister.RAS1_TREF_0_ID + i];
        const ti0: GX.TexMapID =          (v >>>  0) & 0x07;
        const tc0: GX.TexCoordID =        (v >>>  3) & 0x07;
        const te0: boolean =           !!((v >>>  6) & 0x01);
        const cc0: GX.RasColorChannelID = (v >>>  7) & 0x07;
        // 7-10 = pad
        const ti1: GX.TexMapID =          (v >>> 12) & 0x07;
        const tc1: GX.TexCoordID =        (v >>> 15) & 0x07;
        const te1: boolean =           !!((v >>> 18) & 0x01);
        const cc1: GX.RasColorChannelID = (v >>> 19) & 0x07;

        if (i*2+0 >= numTevs)
            break;

        const order0 = {
            texMapId: te0 ? ti0 : GX.TexMapID.TEXMAP_NULL,
            texCoordId: tc0,
            channelId: cc0,
        };
        tevOrders.push(order0);

        if (i*2+1 >= numTevs)
            break;

        const order1 = {
            texMapId: te1 ? ti1 : GX.TexMapID.TEXMAP_NULL,
            texCoordId: tc1,
            channelId: cc1,
        };
        tevOrders.push(order1);
    }

    assert(tevOrders.length === numTevs);

    // Now parse out individual stages.
    for (let i = 0; i < tevOrders.length; i++) {
        const color = r.bp[GX.BPRegister.TEV_COLOR_ENV_0_ID + (i * 2)];

        const colorInD: GX.CombineColorInput = (color >>>  0) & 0x0F;
        const colorInC: GX.CombineColorInput = (color >>>  4) & 0x0F;
        const colorInB: GX.CombineColorInput = (color >>>  8) & 0x0F;
        const colorInA: GX.CombineColorInput = (color >>> 12) & 0x0F;
        const colorBias: GX.TevBias =          (color >>> 16) & 0x03;
        const colorSub: boolean =           !!((color >>> 18) & 0x01);
        const colorClamp: boolean =         !!((color >>> 19) & 0x01);
        const colorScale: GX.TevScale =        (color >>> 20) & 0x03;
        const colorRegId: GX.Register =        (color >>> 22) & 0x03;

        const colorOp: GX.TevOp = findTevOp(colorBias, colorScale, colorSub);

        // Find the op.
        const alpha = r.bp[GX.BPRegister.TEV_ALPHA_ENV_0_ID + (i * 2)];

        const rswap: number =                  (alpha >>>  0) & 0x03;
        const tswap: number =                  (alpha >>>  2) & 0x03;
        const alphaInD: GX.CombineAlphaInput = (alpha >>>  4) & 0x07;
        const alphaInC: GX.CombineAlphaInput = (alpha >>>  7) & 0x07;
        const alphaInB: GX.CombineAlphaInput = (alpha >>> 10) & 0x07;
        const alphaInA: GX.CombineAlphaInput = (alpha >>> 13) & 0x07;
        const alphaBias: GX.TevBias =          (alpha >>> 16) & 0x03;
        const alphaSub: boolean =           !!((alpha >>> 18) & 0x01);
        const alphaClamp: boolean =         !!((alpha >>> 19) & 0x01);
        const alphaScale: GX.TevScale =        (alpha >>> 20) & 0x03;
        const alphaRegId: GX.Register =        (alpha >>> 22) & 0x03;

        const alphaOp: GX.TevOp = findTevOp(alphaBias, alphaScale, alphaSub);

        const ksel = r.bp[GX.BPRegister.TEV_KSEL_0_ID + (i >>> 1)];
        const konstColorSel: GX.KonstColorSel = ((i & 1) ? (ksel >>> 14) : (ksel >>> 4)) & 0x1F;
        const konstAlphaSel: GX.KonstAlphaSel = ((i & 1) ? (ksel >>> 19) : (ksel >>> 9)) & 0x1F;

        const indCmd = r.bp[GX.BPRegister.IND_CMD0_ID + i];
        const indTexStage: GX.IndTexStageID =   (indCmd >>>  0) & 0x03;
        const indTexFormat: GX.IndTexFormat =   (indCmd >>>  2) & 0x03;
        const indTexBiasSel: GX.IndTexBiasSel = (indCmd >>>  4) & 0x07;
        // alpha sel
        const indTexMatrix: GX.IndTexMtxID =    (indCmd >>>  9) & 0x0F;
        const indTexWrapS: GX.IndTexWrap =      (indCmd >>> 13) & 0x07;
        const indTexWrapT: GX.IndTexWrap =      (indCmd >>> 16) & 0x07;
        const indTexUseOrigLOD: boolean =    !!((indCmd >>> 19) & 0x01);
        const indTexAddPrev: boolean =       !!((indCmd >>> 20) & 0x01);

        const rasSwapTableRG = r.bp[GX.BPRegister.TEV_KSEL_0_ID + (rswap * 2)];
        const rasSwapTableBA = r.bp[GX.BPRegister.TEV_KSEL_0_ID + (rswap * 2) + 1];

        const rasSwapTable: number[] = [
            (rasSwapTableRG >>> 0) & 0x03,
            (rasSwapTableRG >>> 2) & 0x03,
            (rasSwapTableBA >>> 0) & 0x03,
            (rasSwapTableBA >>> 2) & 0x03,
        ];

        const texSwapTableRG = r.bp[GX.BPRegister.TEV_KSEL_0_ID + (tswap * 2)];
        const texSwapTableBA = r.bp[GX.BPRegister.TEV_KSEL_0_ID + (tswap * 2) + 1];

        const texSwapTable: number[] = [
            (texSwapTableRG >>> 0) & 0x03,
            (texSwapTableRG >>> 2) & 0x03,
            (texSwapTableBA >>> 0) & 0x03,
            (texSwapTableBA >>> 2) & 0x03,
        ];

        const tevStage: TevStage = {
            colorInA, colorInB, colorInC, colorInD, colorOp, colorBias, colorClamp, colorScale, colorRegId,
            alphaInA, alphaInB, alphaInC, alphaInD, alphaOp, alphaBias, alphaClamp, alphaScale, alphaRegId,

            texCoordId: tevOrders[i].texCoordId,
            texMap: tevOrders[i].texMapId,
            channelId: tevOrders[i].channelId,

            konstColorSel, konstAlphaSel,
            rasSwapTable, texSwapTable,

            indTexStage, indTexFormat, indTexBiasSel, indTexMatrix, indTexWrapS, indTexWrapT, indTexAddPrev, indTexUseOrigLOD,
        };

        tevStages.push(tevStage);
    }

    return tevStages;
}

export function parseIndirectStages(r: DisplayListRegisters, numInds: number): IndTexStage[] {
    const indTexStages: IndTexStage[] = [];
    const iref = r.bp[GX.BPRegister.RAS1_IREF_ID];
    for (let i = 0; i < numInds; i++) {
        const ss = r.bp[GX.BPRegister.RAS1_SS0_ID + (i >>> 2)];
        const scaleS: GX.IndTexScale = (ss >>> ((0x08 * (i & 1)) + 0x00) & 0x0F);
        const scaleT: GX.IndTexScale = (ss >>> ((0x08 * (i & 1)) + 0x04) & 0x0F);
        const texture: GX.TexMapID = (iref >>> (0x06*i)) & 0x07;
        const texCoordId: GX.TexCoordID = (iref >>> (0x06*i)) & 0x07;
        indTexStages.push({ scaleS, scaleT, texCoordId, texture });
    }
    return indTexStages;
}

export function parseRopInfo(r: DisplayListRegisters): RopInfo {
    // Blend mode.
    const cm0 = r.bp[GX.BPRegister.PE_CMODE0_ID];
    const bmboe = (cm0 >>> 0) & 0x01;
    const bmloe = (cm0 >>> 1) & 0x01;
    const bmbop = (cm0 >>> 11) & 0x01;

    const blendType: GX.BlendMode =
        bmboe ? (bmbop ? GX.BlendMode.SUBTRACT : GX.BlendMode.BLEND) :
        bmloe ? GX.BlendMode.LOGIC : GX.BlendMode.NONE;;
    const dstFactor: GX.BlendFactor = (cm0 >>> 5) & 0x07;
    const srcFactor: GX.BlendFactor = (cm0 >>> 8) & 0x07;
    const logicOp: GX.LogicOp = (cm0 >>> 12) & 0x0F;
    const blendMode: BlendMode = {
        type: blendType,
        dstFactor, srcFactor, logicOp,
    };

    // Depth state.
    const zm = r.bp[GX.BPRegister.PE_ZMODE_ID];
    const depthTest = !!((zm >>> 0) & 0x01);
    const depthFunc = (zm >>> 1) & 0x07;
    const depthWrite = !!((zm >>> 4) & 0x01);

    const ropInfo: RopInfo = {
        blendMode, depthFunc, depthTest, depthWrite,
    };

    return ropInfo;
}

export function parseAlphaTest(r: DisplayListRegisters): AlphaTest {
    const ap = r.bp[GX.BPRegister.TEV_ALPHAFUNC_ID];
    const alphaTest: AlphaTest = {
        referenceA: ((ap >>>  0) & 0xFF) / 0xFF,
        referenceB: ((ap >>>  8) & 0xFF) / 0xFF,
        compareA:    (ap >>> 16) & 0x07,
        compareB:    (ap >>> 19) & 0x07,
        op:          (ap >>> 22) & 0x07,
    };
    return alphaTest;
}

export function parseColorChannelControlRegister(chanCtrl: number): ColorChannelControl {
    const matColorSource: GX.ColorSrc =           (chanCtrl >>>  0) & 0x01;
    const lightingEnabled: boolean =           !!((chanCtrl >>>  1) & 0x01);
    const litMaskL: number =                      (chanCtrl >>>  2) & 0x0F;
    const ambColorSource: GX.ColorSrc =           (chanCtrl >>>  6) & 0x01;
    const diffuseFunction: GX.DiffuseFunction =   (chanCtrl >>>  7) & 0x03;
    const attnEn: boolean =                    !!((chanCtrl >>>  9) & 0x01);
    const attnSelect: boolean =                !!((chanCtrl >>> 10) & 0x01);
    const litMaskH: number =                      (chanCtrl >>> 11) & 0x0F;

    const litMask: number =                       (litMaskH << 4) | litMaskL;
    const attenuationFunction = attnEn ? (attnSelect ? GX.AttenuationFunction.SPOT : GX.AttenuationFunction.SPEC) : GX.AttenuationFunction.NONE;
    return { lightingEnabled, matColorSource, ambColorSource, litMask, diffuseFunction, attenuationFunction };
}

export function parseLightChannels(r: DisplayListRegisters): LightChannelControl[] {
    const lightChannels: LightChannelControl[] = [];
    const numColors = r.xfg(GX.XFRegister.XF_NUMCOLORS_ID);
    for (let i = 0; i < numColors; i++) {
        const colorCntrl = r.xfg(GX.XFRegister.XF_COLOR0CNTRL_ID + i);
        const alphaCntrl = r.xfg(GX.XFRegister.XF_ALPHA0CNTRL_ID + i);
        const colorChannel = parseColorChannelControlRegister(colorCntrl); 
        const alphaChannel = parseColorChannelControlRegister(alphaCntrl);
        lightChannels.push({ colorChannel, alphaChannel });

        const colorUsesReg = colorChannel.lightingEnabled &&  
            colorChannel.matColorSource === GX.ColorSrc.REG ||
            colorChannel.ambColorSource === GX.ColorSrc.REG;
        
        const alphaUsesReg = colorChannel.lightingEnabled &&  
            colorChannel.matColorSource === GX.ColorSrc.REG ||
            colorChannel.ambColorSource === GX.ColorSrc.REG;
        
        if (colorUsesReg || alphaUsesReg)
            console.warn(`CommandList ${name} uses register color values, but these are not yet supported`);
    }
    return lightChannels;
}

export function parseMaterial(r: DisplayListRegisters, name: string): GXMaterial {
    const hw2cm: GX.CullMode[] = [ GX.CullMode.NONE, GX.CullMode.BACK, GX.CullMode.FRONT, GX.CullMode.ALL ];

    const genMode = r.bp[GX.BPRegister.GEN_MODE_ID];
    const numTexGens = (genMode >>> 0) & 0x0F;
    const numTevs = ((genMode >>> 10) & 0x0F) + 1;
    const numInds = ((genMode >>> 16) & 0x07);
    const cullMode = hw2cm[((genMode >>> 14)) & 0x03];

    const texGens: TexGen[] = parseTexGens(r, numTexGens);
    const tevStages: TevStage[] = parseTevStages(r, numTevs);
    const indTexStages: IndTexStage[] = parseIndirectStages(r, numInds);
    const ropInfo: RopInfo = parseRopInfo(r);
    const alphaTest: AlphaTest = parseAlphaTest(r);
    const lightChannels: LightChannelControl[] = parseLightChannels(r);

    const gxMaterial: GXMaterial = {
        name,
        lightChannels, cullMode,
        tevStages, texGens,
        indTexStages, alphaTest, ropInfo,
    };

    return gxMaterial;
}
// #endregion

export function getRasColorChannelID(v: GX.ColorChannelID): GX.RasColorChannelID {
    switch (v) {
    case GX.ColorChannelID.COLOR0:
    case GX.ColorChannelID.ALPHA0:
    case GX.ColorChannelID.COLOR0A0:
        return GX.RasColorChannelID.COLOR0A0;
    case GX.ColorChannelID.COLOR1:
    case GX.ColorChannelID.ALPHA1:
    case GX.ColorChannelID.COLOR1A1:
        return GX.RasColorChannelID.COLOR1A1;
    case GX.ColorChannelID.ALPHA_BUMP:
        return GX.RasColorChannelID.ALPHA_BUMP;
    case GX.ColorChannelID.ALPHA_BUMP_N:
        return GX.RasColorChannelID.ALPHA_BUMP_N;
    case GX.ColorChannelID.COLOR_ZERO:
    case GX.ColorChannelID.COLOR_NULL:
        return GX.RasColorChannelID.COLOR_ZERO;
    default:
        throw "whoops";
    }
}
