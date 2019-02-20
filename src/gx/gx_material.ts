
// GX materials.

import * as GX from './gx_enum';

import { DeviceProgram, DeviceProgramReflection } from '../Program';
import { colorCopy, colorFromRGBA8, colorToRGBA8 } from '../Color';
import { GfxFormat } from '../gfx/platform/GfxPlatformFormat';
import { GfxCompareMode, GfxFrontFaceMode, GfxBlendMode, GfxBlendFactor, GfxCullMode, GfxMegaStateDescriptor } from '../gfx/platform/GfxPlatform';
import { vec3, vec4, mat4 } from 'gl-matrix';
import { Camera } from '../Camera';

// TODO(jstpierre): Move somewhere better...
export const EFB_WIDTH = 640;
export const EFB_HEIGHT = 528;

// #region Material definition.
export interface GXMaterial {
    // Debugging & ID
    index: number;
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
}

export class Color {
    constructor(
        public r: number = 0,
        public g: number = 0,
        public b: number = 0,
        public a: number = 0,
    )
    {}

    public set(r: number, g: number, b: number, a: number): void {
        this.r = r;
        this.g = g;
        this.b = b;
        this.a = a;
    }

    public copy(c: Color, a: number = c.a): void {
        return colorCopy(this, c, a);
    }

    public copy32(c: number): void {
        return colorFromRGBA8(this, c);
    }

    public get32(): number {
        return colorToRGBA8(this);
    }
}

export class Light {
    public Position = vec3.create();
    public Direction = vec3.create();
    public DistAtten = vec3.create();
    public CosAtten = vec3.create();
    public Color = new Color();

    public copy(o: Light): void {
        vec3.copy(this.Position, o.Position);
        vec3.copy(this.Direction, o.Direction);
        vec3.copy(this.DistAtten, o.DistAtten);
        vec3.copy(this.CosAtten, o.CosAtten);
        colorCopy(this.Color, o.Color);
    }
}

const scratchVec4 = vec4.create();
export function lightSetWorldPosition(light: Light, camera: Camera, x: number, y: number, z: number, v: vec4 = scratchVec4): void {
    vec4.set(v, x, y, z, 1.0);
    vec4.transformMat4(v, v, camera.viewMatrix);
    vec3.set(light.Position, v[0], v[1], v[2]);
}

export function lightSetWorldDirection(light: Light, camera: Camera, x: number, y: number, z: number, v: vec4 = scratchVec4): void {
    vec4.set(v, x, y, z, 0.0);
    // TODO(jstpierre): In theory, we should multiply by the inverse-transpose of the view matrix.
    // However, I don't want to calculate that right now, and it shouldn't matter too much...
    vec4.transformMat4(v, v, camera.viewMatrix);
    vec4.normalize(v, v);
    vec3.set(light.Direction, v[0], v[1], v[2]);
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
    index: number;

    type: GX.TexGenType;
    source: GX.TexGenSrc;
    matrix: GX.TexGenMatrix;
    normalize: boolean;
    postMatrix: GX.PostTexGenMatrix;
}

export interface IndTexStage {
    index: number;

    texCoordId: GX.TexCoordID;
    texture: GX.TexMapID;
    scaleS: GX.IndTexScale;
    scaleT: GX.IndTexScale;
}

export interface TevStage {
    index: number;

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
export const enum UniformStorage {
    UINT,
    VEC2,
    VEC3,
    VEC4,
}

interface VertexAttributeGenDef {
    attrib: GX.VertexAttribute;
    format: GfxFormat;
    name: string;
}

const vtxAttributeGenDefs: VertexAttributeGenDef[] = [
    { attrib: GX.VertexAttribute.PNMTXIDX,   name: "PosMtxIdx",  format: GfxFormat.U8_R },
    { attrib: GX.VertexAttribute.POS,        name: "Position",   format: GfxFormat.F32_RGB },
    { attrib: GX.VertexAttribute.NRM,        name: "Normal",     format: GfxFormat.F32_RGB },
    { attrib: GX.VertexAttribute.CLR0,       name: "Color0",     format: GfxFormat.F32_RGBA },
    { attrib: GX.VertexAttribute.CLR1,       name: "Color1",     format: GfxFormat.F32_RGBA },
    { attrib: GX.VertexAttribute.TEX0,       name: "Tex0",       format: GfxFormat.F32_RG },
    { attrib: GX.VertexAttribute.TEX1,       name: "Tex1",       format: GfxFormat.F32_RG },
    { attrib: GX.VertexAttribute.TEX2,       name: "Tex2",       format: GfxFormat.F32_RG },
    { attrib: GX.VertexAttribute.TEX3,       name: "Tex3",       format: GfxFormat.F32_RG },
    { attrib: GX.VertexAttribute.TEX4,       name: "Tex4",       format: GfxFormat.F32_RG },
    { attrib: GX.VertexAttribute.TEX5,       name: "Tex5",       format: GfxFormat.F32_RG },
    { attrib: GX.VertexAttribute.TEX6,       name: "Tex6",       format: GfxFormat.F32_RG },
    { attrib: GX.VertexAttribute.TEX7,       name: "Tex7",       format: GfxFormat.F32_RG },
];

export function getVertexAttribLocation(vtxAttrib: GX.VertexAttribute): number {
    return vtxAttributeGenDefs.findIndex((genDef) => genDef.attrib === vtxAttrib);
}

export function getVertexAttribGenDef(vtxAttrib: GX.VertexAttribute): VertexAttributeGenDef {
    return vtxAttributeGenDefs.find((genDef) => genDef.attrib === vtxAttrib);
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

export class GX_Program extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_MaterialParams = 1;
    public static ub_PacketParams = 2;

    constructor(private material: GXMaterial, private hacks: GXMaterialHacks = null) {
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
        switch (chan.matColorSource) {
            case GX.ColorSrc.VTX: return `a_Color${i}`;
            case GX.ColorSrc.REG: return `u_ColorMatReg[${i}]`;
        }
    }

    private generateAmbientSource(chan: ColorChannelControl, i: number) {
        switch (chan.ambColorSource) {
            case GX.ColorSrc.VTX: return `a_Color${i}`;
            case GX.ColorSrc.REG: return `u_ColorAmbReg[${i}]`;
        }
    }

    private generateLightDiffFn(chan: ColorChannelControl, lightName: string) {
        const NdotL = `dot(t_Normal, normalize(t_LightDelta))`;

        switch (chan.diffuseFunction) {
        case GX.DiffuseFunction.NONE: return `1.0`;
        case GX.DiffuseFunction.SIGN: return `${NdotL}`;
        case GX.DiffuseFunction.CLAMP: return `max(${NdotL}, 0.0)`;
        }
    }

    private generateLightAttnFn(chan: ColorChannelControl, lightName: string) {
        const cosAttn = `ApplyCubic(${lightName}.CosAtten.xyz, dot(t_LightDelta, ${lightName}.Direction.xyz))`;

        switch (chan.attenuationFunction) {
        case GX.AttenuationFunction.NONE: return `1.0`;
        case GX.AttenuationFunction.SPOT: return `max(${cosAttn} / dot(${lightName}.DistAtten.xyz, vec3(1.0, Dist(t_LightDelta), DistSq(t_LightDelta))), 0.0)`;
        case GX.AttenuationFunction.SPEC: return `1.0`; // TODO(jtspierre): Specular
        }
    }

    private generateColorChannel(chan: ColorChannelControl, outputName: string, i: number) {
        const matSource = this.generateMaterialSource(chan, i);
        const ambSource = this.generateAmbientSource(chan, i);

        // HACK.
        if (chan.lightingEnabled && this.hacks && this.hacks.lightingFudge) {
            const vtx = `a_Color${i}`;
            const amb = `u_ColorAmbReg[${i}]`;
            const mat = `u_ColorMatReg[${i}]`;
            const fudged = this.hacks.lightingFudge({ vtx, amb, mat, ambSource, matSource });
            return `    ${outputName} = vec4(${fudged});`;
        }

        let generateLightAccum = ``;
        if (chan.lightingEnabled) {
            generateLightAccum = `
    t_LightAccum = ${ambSource};`;

            for (let j = 0; j < 8; j++) {
                if (!(chan.litMask & (1 << j)))
                    continue;

                const lightName = `u_LightParams[${j}]`;
                generateLightAccum += `
    t_LightDelta = ${lightName}.Position.xyz - v_Position.xyz;
    t_LightAccum += ${this.generateLightDiffFn(chan, lightName)} * ${this.generateLightAttnFn(chan, lightName)} * ${lightName}.Color;`;
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
        // If we have disabled vertex colors, then they are pure white.
        if (this.hacks !== null && this.hacks.disableVertexColors)
            return `    ${outputName} = vec4(1.0, 1.0, 1.0, 1.0);`;

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

    // TexGen
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

    private generateTexGenMatrix(src: string, texCoordGen: TexGen) {
        const matrix = texCoordGen.matrix;
        if (matrix === GX.TexGenMatrix.IDENTITY) {
            return `${src}.xyz`;
        } else if (matrix >= GX.TexGenMatrix.TEXMTX0) {
            const texMtxIdx = (matrix - GX.TexGenMatrix.TEXMTX0) / 3;
            return `Mul(u_TexMtx[${texMtxIdx}], ${src})`;
        } else if (matrix >= GX.TexGenMatrix.PNMTX0) {
            const pnMtxIdx = (matrix - GX.TexGenMatrix.PNMTX0) / 3;
            return `Mul(u_PosMtx[${pnMtxIdx}], ${src})`;
        } else {
            throw "whoops";
        }
    }

    private generateTexGenType(texCoordGen: TexGen) {
        const src = this.generateTexGenSource(texCoordGen.source);
        switch (texCoordGen.type) {
        case GX.TexGenType.SRTG:
            // Expected to be used with colors, I suspect...
            return `vec3(${src}.xy, 1.0)`;
        case GX.TexGenType.MTX2x4:
            if (texCoordGen.matrix === GX.TexGenMatrix.IDENTITY)
                return `${src}.xyz`;
            return `vec3(${this.generateTexGenMatrix(src, texCoordGen)}.xy, 1.0)`;
        case GX.TexGenType.MTX3x4:
            return `${this.generateTexGenMatrix(src, texCoordGen)}`;
        default:
            throw new Error("whoops");
        }
    }

    private generateTexGenNrm(texCoordGen: TexGen) {
        const type = this.generateTexGenType(texCoordGen);
        if (texCoordGen.normalize)
            return `normalize(${type})`;
        else
            return type;
    }

    private generateTexGenPost(texCoordGen: TexGen) {
        const tex = this.generateTexGenNrm(texCoordGen);
        if (texCoordGen.postMatrix === GX.PostTexGenMatrix.PTIDENTITY) {
            return tex;
        } else {
            const matrixIdx = (texCoordGen.postMatrix - GX.PostTexGenMatrix.PTTEXMTX0) / 3;
            return `Mul(u_PostTexMtx[${matrixIdx}], vec4(${tex}, 1.0))`;
        }
    }

    private generateTexGen(texCoordGen: TexGen) {
        const i = texCoordGen.index;
        return `
    // TexGen ${i}  Type: ${texCoordGen.type} Source: ${texCoordGen.source} Matrix: ${texCoordGen.matrix}
    v_TexCoord${i} = ${this.generateTexGenPost(texCoordGen)};`;
    }

    private generateTexGens(texGens: TexGen[]) {
        return texGens.map((tg) => {
            return this.generateTexGen(tg);
        }).join('');
    }

    private generateTexCoordGetters(): string {
        return this.material.texGens.map((n, i) => {
            return `vec2 ReadTexCoord${i}() { return v_TexCoord${i}.xy / v_TexCoord${i}.z; }\n`;
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
        }
    }

    private generateIndTexStageScale(stage: IndTexStage): string {
        const baseCoord = `ReadTexCoord${stage.texCoordId}()`;
        if (stage.scaleS === GX.IndTexScale._1 && stage.scaleT === GX.IndTexScale._1)
            return baseCoord;
        else
            return `${baseCoord} * vec2(${this.generateIndTexStageScaleN(stage.scaleS)}, ${this.generateIndTexStageScaleN(stage.scaleT)})`;
    }

    private generateIndTexStage(stage: IndTexStage): string {
        const i = stage.index;
        return `
    // Indirect ${i}
    vec3 t_IndTexCoord${i} = TextureSample(${stage.texture}, ${this.generateIndTexStageScale(stage)}).abg;`;
    }

    private generateIndTexStages(stages: IndTexStage[]): string {
        return stages.map((stage) => {
            if (stage.texCoordId >= this.material.texGens.length)
                return '';
            return this.generateIndTexStage(stage);
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

        return `TextureSample(${stage.texMap}, t_TexCoord)`;
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
        const i = stage.index;
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
        case GX.CombineColorInput.RASC:  return `${this.generateRas(stage)}.${this.generateColorSwizzle(stage.rasSwapTable, colorIn)}`;
        case GX.CombineColorInput.RASA:  return `${this.generateRas(stage)}.${this.generateColorSwizzle(stage.rasSwapTable, colorIn)}`;
        case GX.CombineColorInput.ONE:   return `vec3(1)`;
        case GX.CombineColorInput.HALF:  return `vec3(1.0/2.0)`;
        case GX.CombineColorInput.KONST: return `${this.generateKonstColorSel(stage.konstColorSel)}`;
        case GX.CombineColorInput.ZERO:  return `vec3(0)`;
        }
    }

    private generateAlphaIn(stage: TevStage, alphaIn: GX.CombineAlphaInput) {
        const i = stage.index;
        switch (alphaIn) {
        case GX.CombineAlphaInput.APREV: return `t_ColorPrev.a`;
        case GX.CombineAlphaInput.A0:    return `t_Color0.a`;
        case GX.CombineAlphaInput.A1:    return `t_Color1.a`;
        case GX.CombineAlphaInput.A2:    return `t_Color2.a`;
        case GX.CombineAlphaInput.TEXA:  return `${this.generateTexAccess(stage)}.${this.generateComponentSwizzle(stage.texSwapTable, GX.TevColorChan.A)}`;
        case GX.CombineAlphaInput.RASA:  return `${this.generateRas(stage)}.${this.generateComponentSwizzle(stage.rasSwapTable, GX.TevColorChan.A)}`;
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
        case GX.TevOp.COMP_RGB8_GT:   return `(TevPerCompGT(${a}, ${b}) * ${c}) + ${d}`;
        case GX.TevOp.COMP_RGB8_EQ:   return `(TevPerCompEQ(${a}, ${b}) * ${c}) + ${d}`;
        default:
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
        const baseCoord = `(t_IndTexCoord${stage.indTexStage} * 255.0)`;
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
        default:
        case GX.IndTexMtxID.OFF: throw new Error("whoops");
        }
    }

    private generateTevTexCoordIndirectTranslation(stage: TevStage): string {
        return `(${this.generateTevTexCoordIndirectMtx(stage)} / TextureSize(${stage.texCoordId}))`;
    }

    private generateTevTexCoordIndirect(stage: TevStage): string {
        const baseCoord = this.generateTevTexCoordWrap(stage);
        if (stage.indTexMatrix !== GX.IndTexMtxID.OFF && stage.indTexStage < this.material.indTexStages.length)
            return `${baseCoord} + ${this.generateTevTexCoordIndirectTranslation(stage)}`;
        else
            return baseCoord;
    }

    private generateTevTexCoord(stage: TevStage): string {
        if (stage.texCoordId === GX.TexCoordID.NULL)
            return '';

        const finalCoord = this.generateTevTexCoordIndirect(stage);
        if (stage.indTexAddPrev) {
            return `t_TexCoord += ${finalCoord};`;
        } else {
            return `t_TexCoord = ${finalCoord};`;
        }
    }

    private generateTevStage(stage: TevStage): string {
        const i = stage.index;

        return `
    // TEV Stage ${i}
    ${this.generateTevTexCoord(stage)}
    // Color Combine
    // colorIn: ${stage.colorInA} ${stage.colorInB} ${stage.colorInC} ${stage.colorInD}  colorOp: ${stage.colorOp} colorBias: ${stage.colorBias} colorScale: ${stage.colorScale} colorClamp: ${stage.colorClamp} colorRegId: ${stage.colorRegId}
    // alphaIn: ${stage.alphaInA} ${stage.alphaInB} ${stage.alphaInC} ${stage.alphaInD}  alphaOp: ${stage.alphaOp} alphaBias: ${stage.alphaBias} alphaScale: ${stage.alphaScale} alphaClamp: ${stage.alphaClamp} alphaRegId: ${stage.alphaRegId}
    // texCoordId: ${stage.texCoordId} texMap: ${stage.texMap} channelId: ${stage.channelId}
    ${this.generateTevInputs(stage)}
    ${this.generateColorOp(stage)}
    ${this.generateAlphaOp(stage)}`;
    }

    private generateTevStages(tevStages: TevStage[]) {
        return tevStages.map((s) => this.generateTevStage(s)).join(`\n`);
    }

    private generateTevStagesLastMinuteFixup(tevStages: TevStage[]) {
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

    private generateAlphaTest(alphaTest: AlphaTest) {
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
        case GfxFormat.U8_R:     return 'uint';
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

    public static BindingsDefinition = `
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
    Mat4x3 u_PostTexMtx[20];
    Mat4x2 u_IndTexMtx[3];
    // SizeX, SizeY, 0, Bias
    vec4 u_TextureParams[8];
    Light u_LightParams[8];
};

// Expected to change with each shape packet.
layout(row_major, std140) uniform ub_PacketParams {
    Mat4x3 u_PosMtx[10];
};

uniform sampler2D u_Texture[8];
`;

    public static programReflection: DeviceProgramReflection = DeviceProgram.parseReflectionDefinitions(GX_Program.BindingsDefinition);

    private generateShaders() {
        this.both = `
// ${this.material.name}
precision mediump float;
${GX_Program.BindingsDefinition}

varying vec3 v_Position;
varying vec4 v_Color0;
varying vec4 v_Color1;
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
${this.generateVertAttributeDefs()}

Mat4x4 GetPosTexMatrix(uint t_MtxIdx) {
    if (t_MtxIdx == ${GX.TexGenMatrix.IDENTITY}u)
        return _Mat4x4(1.0);
    else if (t_MtxIdx >= ${GX.TexGenMatrix.TEXMTX0}u)
        return _Mat4x4(u_TexMtx[(t_MtxIdx - ${GX.TexGenMatrix.TEXMTX0}u) / 3u]);
    else
        return _Mat4x4(u_PosMtx[t_MtxIdx / 3u]);
}

float ApplyCubic(vec3 t_Coeff, float t_Value) {
    return dot(t_Coeff, vec3(1.0, t_Value, t_Value*t_Value));
}

float DistSq(vec3 v) { return dot(v, v); }
float Dist(vec3 v) { return sqrt(DistSq(v)); }

void main() {
    Mat4x4 t_PosMtx = GetPosTexMatrix(a_PosMtxIdx);
    vec4 t_Position = Mul(t_PosMtx, vec4(a_Position, 1.0));
    v_Position = t_Position.xyz;
    // TODO(jstpierre): Move this calculation to the CPU? Is it worth it?
    Mat4x3 t_NrmMtx = _Mat4x3(t_PosMtx);
    vec3 t_Normal = Mul(t_NrmMtx, vec4(a_Normal, 0.0));

    vec4 t_LightAccum;
    vec3 t_LightDelta;
    vec4 t_ColorChanTemp;
${this.generateLightChannels()}
${this.generateTexGens(this.material.texGens)}
    gl_Position = Mul(u_Projection, t_Position);
}
`;

        const tevStages = this.material.tevStages;
        const indTexStages = this.material.indTexStages;
        const alphaTest = this.material.alphaTest;

        this.frag = `
${this.generateTexCoordGetters()}

float TextureLODBias(int index) { return u_SceneTextureLODBias + u_TextureParams[index].w; }
vec2 TextureSize(int index) { return u_TextureParams[index].xy; }
vec4 TextureSample(int index, vec2 coord) { return texture(u_Texture[index], coord, TextureLODBias(index)); }

vec3 TevBias(vec3 a, float b) { return a + vec3(b); }
float TevBias(float a, float b) { return a + b; }
vec3 TevSaturate(vec3 a) { return clamp(a, vec3(0), vec3(1)); }
float TevSaturate(float a) { return clamp(a, 0.0, 1.0); }
float TevOverflow(float a) { return float(int(a * 255.0) % 256) / 255.0; }
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

    vec2 t_TexCoord = vec2(0.0, 0.0);
${this.generateIndTexStages(indTexStages)}
    vec4 t_TevA, t_TevB, t_TevC, t_TevD;
${this.generateTevStages(tevStages)}

${this.generateTevStagesLastMinuteFixup(tevStages)}
    t_TevOutput = TevOverflow(t_TevOutput);
${this.generateAlphaTest(alphaTest)}
    gl_FragColor = t_TevOutput;
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

export function translateGfxMegaState(megaState: GfxMegaStateDescriptor, material: GXMaterial) {
    megaState.cullMode = translateCullMode(material.cullMode);
    megaState.depthWrite = material.ropInfo.depthWrite;
    megaState.depthCompare = material.ropInfo.depthTest ? translateCompareType(material.ropInfo.depthFunc) : GfxCompareMode.ALWAYS;
    megaState.frontFace = GfxFrontFaceMode.CW;

    if (material.ropInfo.blendMode.type === GX.BlendMode.NONE) {
        megaState.blendMode = GfxBlendMode.NONE;
    } else if (material.ropInfo.blendMode.type === GX.BlendMode.BLEND) {
        megaState.blendMode = GfxBlendMode.ADD;
        megaState.blendSrcFactor = translateBlendSrcFactor(material.ropInfo.blendMode.srcFactor);
        megaState.blendDstFactor = translateBlendDstFactor(material.ropInfo.blendMode.dstFactor);
    } else if (material.ropInfo.blendMode.type === GX.BlendMode.SUBTRACT) {
        megaState.blendMode = GfxBlendMode.REVERSE_SUBTRACT;
        megaState.blendSrcFactor = GfxBlendFactor.ONE;
        megaState.blendDstFactor = GfxBlendFactor.ONE;
    } else if (material.ropInfo.blendMode.type === GX.BlendMode.LOGIC) {
        throw new Error("whoops");
    }
}
// #endregion

export function getRasColorChannelID(v: GX.ColorChannelId): GX.RasColorChannelID {
    switch (v) {
    case GX.ColorChannelId.COLOR0:
    case GX.ColorChannelId.ALPHA0:
    case GX.ColorChannelId.COLOR0A0:
        return GX.RasColorChannelID.COLOR0A0;
    case GX.ColorChannelId.COLOR1:
    case GX.ColorChannelId.ALPHA1:
    case GX.ColorChannelId.COLOR1A1:
        return GX.RasColorChannelID.COLOR1A1;
    case GX.ColorChannelId.ALPHA_BUMP:
        return GX.RasColorChannelID.ALPHA_BUMP;
    case GX.ColorChannelId.ALPHA_BUMP_N:
        return GX.RasColorChannelID.ALPHA_BUMP_N;
    case GX.ColorChannelId.COLOR_ZERO:
    case GX.ColorChannelId.COLOR_NULL:
        return GX.RasColorChannelID.COLOR_ZERO;
    default:
        throw "whoops";
    }
}
