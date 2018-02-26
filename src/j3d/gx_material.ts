
import { mat3 } from 'gl-matrix';

import * as GX from './gx_enum';

import * as Viewer from '../viewer';

import { CullMode, FrontFaceMode, RenderFlags, Program, BlendFactor } from '../render';

// #region Material definition.
export interface Color {
    r: number;
    g: number;
    b: number;
    a: number;
}

export interface ColorChannelControl {
    lightingEnabled: boolean;
    matColorSource: GX.ColorSrc;
    matColorReg: Color;
    ambColorSource: GX.ColorSrc;
}

export interface TexGen {
    index: number;

    type: GX.TexGenType;
    source: GX.TexGenSrc;
    matrix: GX.TexGenMatrix;
}

export const enum TexMtxProjection {
    ST = 0,
    STQ = 1,
}

export interface TexMtx {
    projection: TexMtxProjection;
    matrix: mat3;
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
    texCoordId: GX.TexCoordSlot;
    texMap: number;
    channelId: GX.ColorChannelId;

    konstColorSel: GX.KonstColorSel;
    konstAlphaSel: GX.KonstAlphaSel;
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

export interface GXMaterial {
    index: number;
    name: string;
    translucent: boolean;
    textureIndexes: number[];
    cullMode: GX.CullMode;
    colorRegisters: Color[];
    colorConstants: Color[];
    colorChannels: ColorChannelControl[];
    texGens: TexGen[];
    tevStages: TevStage[];
    alphaTest: AlphaTest;
    ropInfo: RopInfo;
    texMatrices: TexMtx[];
}
// #endregion

// #region Material shader generation.
interface VertexAttributeGenDef {
    attrib: GX.VertexAttribute;
    storage: string;
    name: string;
    scale: boolean;
};

const vtxAttributeGenDefs: VertexAttributeGenDef[] = [
    { attrib: GX.VertexAttribute.POS,  name: "Position", storage: "vec3", scale: true },
    { attrib: GX.VertexAttribute.NRM,  name: "Normal",   storage: "vec3", scale: true },
    { attrib: GX.VertexAttribute.CLR0, name: "Color0",   storage: "vec4", scale: false },
    { attrib: GX.VertexAttribute.CLR1, name: "Color1",   storage: "vec4", scale: false },
    { attrib: GX.VertexAttribute.TEX0, name: "Tex0",     storage: "vec2", scale: true },
    { attrib: GX.VertexAttribute.TEX1, name: "Tex1",     storage: "vec2", scale: true },
    { attrib: GX.VertexAttribute.TEX2, name: "Tex2",     storage: "vec2", scale: true },
    { attrib: GX.VertexAttribute.TEX3, name: "Tex3",     storage: "vec2", scale: true },
    { attrib: GX.VertexAttribute.TEX4, name: "Tex4",     storage: "vec2", scale: true },
    { attrib: GX.VertexAttribute.TEX5, name: "Tex5",     storage: "vec2", scale: true },
    { attrib: GX.VertexAttribute.TEX6, name: "Tex6",     storage: "vec2", scale: true },
    { attrib: GX.VertexAttribute.TEX7, name: "Tex7",     storage: "vec2", scale: true },
];

export class GX_Program extends Program {
    private vtxAttributeScaleLocations: WebGLUniformLocation[] = [];
    private texMtxLocations: WebGLUniformLocation[] = [];
    private samplerLocations: WebGLUniformLocation[] = [];

    private material: GXMaterial;

    constructor(material: GXMaterial) {
        super();
        this.material = material;
        this.generateShaders();
    }

    private generateFloat(v: number): string {
        let s = v.toString();
        if (!s.includes('.'))
            s += '.0';
        return s;
    }

    private generateColorConstant(c: Color) {
        return `vec4(${c.r}, ${c.g}, ${c.b}, ${c.a})`;
    }

    // Color Channels
    private generateColorChannel(chan: ColorChannelControl, vtxSource: string) {
        // TODO(jstpierre): Ambient and lighting.
        switch (chan.matColorSource) {
        case GX.ColorSrc.VTX: return vtxSource;
        case GX.ColorSrc.REG: return this.generateColorConstant(chan.matColorReg);
        }
    }

    // TexGen
    private generateTexGenSource(src: GX.TexGenSrc) {
        switch (src) {
        case GX.TexGenSrc.POS:       return `v_Position`;
        case GX.TexGenSrc.NRM:       return `v_Normal`;
        case GX.TexGenSrc.COLOR0:    return `v_Color0`;
        case GX.TexGenSrc.COLOR1:    return `v_Color1`;
        case GX.TexGenSrc.TEX0:      return `vec3(ReadAttrib_Tex0(), 1.0)`;
        case GX.TexGenSrc.TEX1:      return `vec3(ReadAttrib_Tex1(), 1.0)`;
        case GX.TexGenSrc.TEX2:      return `vec3(ReadAttrib_Tex2(), 1.0)`;
        case GX.TexGenSrc.TEX3:      return `vec3(ReadAttrib_Tex3(), 1.0)`;
        case GX.TexGenSrc.TEX4:      return `vec3(ReadAttrib_Tex4(), 1.0)`;
        case GX.TexGenSrc.TEX5:      return `vec3(ReadAttrib_Tex5(), 1.0)`;
        case GX.TexGenSrc.TEX6:      return `vec3(ReadAttrib_Tex6(), 1.0)`;
        case GX.TexGenSrc.TEX7:      return `vec3(ReadAttrib_Tex7(), 1.0)`;
        // Use a previously generated texcoordgen.
        case GX.TexGenSrc.TEXCOORD0: return `v_TexCoord0`;
        case GX.TexGenSrc.TEXCOORD1: return `v_TexCoord1`;
        case GX.TexGenSrc.TEXCOORD2: return `v_TexCoord2`;
        case GX.TexGenSrc.TEXCOORD3: return `v_TexCoord3`;
        case GX.TexGenSrc.TEXCOORD4: return `v_TexCoord4`;
        case GX.TexGenSrc.TEXCOORD5: return `v_TexCoord5`;
        case GX.TexGenSrc.TEXCOORD6: return `v_TexCoord6`;
        default:
            throw new Error("whoops");
        }
    }

    private generateTexGenMatrix(src: string, matrix: GX.TexGenMatrix) {
        if (matrix === GX.TexGenMatrix.IDENTITY)
            return `${src}`;

        const matrixIdx = (matrix - GX.TexGenMatrix.TEXMTX0) / 3;
        const matrixSrc = `u_TexMtx[${matrixIdx}]`;
        const texMtx = this.material.texMatrices[matrixIdx];
        if (texMtx.projection === TexMtxProjection.ST)
            return `(${matrixSrc} * vec3(${src}.xy, 1.0))`;
        else
            return `(${matrixSrc} * ${src})`;
    }

    private generateTexGenType(texCoordGen: TexGen) {
        const src = this.generateTexGenSource(texCoordGen.source);
        switch (texCoordGen.type) {
        // Expected to be used with colors, I suspect...
        case GX.TexGenType.SRTG:   return `vec3(${src}.rg, 1.0)`;
        case GX.TexGenType.MTX2x4: return `vec3(${this.generateTexGenMatrix(src, texCoordGen.matrix)}.xy, 1.0)`;
        case GX.TexGenType.MTX3x4: return `${this.generateTexGenMatrix(src, texCoordGen.matrix)}`;
        default:
            throw new Error("whoops");
        }
    }

    private generateTexGen(texCoordGen: TexGen) {
        const i = texCoordGen.index;
        return `
    // TexGen ${i}  Type: ${texCoordGen.type} Source: ${texCoordGen.source} Matrix: ${texCoordGen.matrix}
    v_TexCoord${i} = ${this.generateTexGenType(texCoordGen)};`;
    }

    private generateTexGens(texGens: TexGen[]) {
        return texGens.map((tg) => {
            return this.generateTexGen(tg);
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
        case GX.ColorChannelId.COLOR0:     return `v_Color0`;
        case GX.ColorChannelId.COLOR1:     return `v_Color1`;
        case GX.ColorChannelId.COLOR_ZERO: return `vec4(0, 0, 0, 0)`;
        // XXX(jstpierre): Shouldn't appear but do in practice? WTF?
        case GX.ColorChannelId.COLOR0A0:   return `v_Color0`;
        case GX.ColorChannelId.COLOR1A1:   return `v_Color1`;
        default:
            throw new Error(`whoops ${stage.channelId}`);
        }
    }

    private generateTexAccess(stage: TevStage) {
        return `textureProj(u_Texture[${stage.texMap}], v_TexCoord${stage.texCoordId})`;
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
        case GX.CombineColorInput.TEXC:  return `${this.generateTexAccess(stage)}.rgb`;
        case GX.CombineColorInput.TEXA:  return `${this.generateTexAccess(stage)}.aaa`;
        case GX.CombineColorInput.RASC:  return `${this.generateRas(stage)}.rgb`;
        case GX.CombineColorInput.RASA:  return `${this.generateRas(stage)}.aaa`;
        case GX.CombineColorInput.ONE:   return `vec3(1)`;
        case GX.CombineColorInput.HALF:  return `vec3(1/2)`;
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
        case GX.CombineAlphaInput.TEXA:  return `${this.generateTexAccess(stage)}.a`;
        case GX.CombineAlphaInput.RASA:  return `${this.generateRas(stage)}.a`;
        case GX.CombineAlphaInput.KONST: return `${this.generateKonstAlphaSel(stage.konstAlphaSel)}`;
        case GX.CombineAlphaInput.ZERO:  return `0.0`;
        }
    }

    private generateTevRegister(regId: GX.Register) {
        switch (regId) {
        case GX.Register.PREV: return `t_ColorPrev`;
        case GX.Register.REG0: return `t_Color0`;
        case GX.Register.REG1: return `t_Color1`;
        case GX.Register.REG2: return `t_Color2`;
        }
    }

    private generateTevOpBiasScaleClamp(value: string, bias: GX.TevBias, scale: GX.TevScale, clamp: boolean) {
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

        if (clamp)
            v = `TevSaturate(${v})`;

        return v;
    }

    private generateTevOpValue(op: GX.TevOp, bias: GX.TevBias, scale: GX.TevScale, clamp: boolean, a: string, b: string, c: string, d: string) {
        switch (op) {
        case GX.TevOp.ADD:
        case GX.TevOp.SUB:
            const o = (op === GX.TevOp.ADD) ? '+' : '-';
            const v = `mix(${a}, ${b}, ${c}) ${o} ${d}`;
            return this.generateTevOpBiasScaleClamp(v, bias, scale, clamp);
        default:
            throw new Error("whoops");
        }
    }

    private generateColorOp(stage: TevStage) {
        const a = this.generateColorIn(stage, stage.colorInA);
        const b = this.generateColorIn(stage, stage.colorInB);
        const c = this.generateColorIn(stage, stage.colorInC);
        const d = this.generateColorIn(stage, stage.colorInD);
        const value = this.generateTevOpValue(stage.colorOp, stage.colorBias, stage.colorScale, stage.colorClamp, a, b, c, d);
        return `${this.generateTevRegister(stage.colorRegId)}.rgb = ${value}`;
    }

    private generateAlphaOp(stage: TevStage) {
        const a = this.generateAlphaIn(stage, stage.alphaInA);
        const b = this.generateAlphaIn(stage, stage.alphaInB);
        const c = this.generateAlphaIn(stage, stage.alphaInC);
        const d = this.generateAlphaIn(stage, stage.alphaInD);
        const value = this.generateTevOpValue(stage.alphaOp, stage.alphaBias, stage.alphaScale, stage.alphaClamp, a, b, c, d);
        return `${this.generateTevRegister(stage.alphaRegId)}.a = ${value}`;
    }

    private generateTevStage(stage: TevStage) {
        const i = stage.index;

        return `
    // TEV Stage ${i}
    // colorIn: ${stage.colorInA} ${stage.colorInB} ${stage.colorInC} ${stage.colorInD}  colorOp: ${stage.colorOp} colorBias: ${stage.colorBias} colorScale: ${stage.colorScale} colorClamp: ${stage.colorClamp} colorRegId: ${stage.colorRegId}
    // alphaIn: ${stage.alphaInA} ${stage.alphaInB} ${stage.alphaInC} ${stage.alphaInD}  alphaOp: ${stage.alphaOp} alphaBias: ${stage.alphaBias} alphaScale: ${stage.alphaScale} alphaClamp: ${stage.alphaClamp} alphaRegId: ${stage.alphaRegId}
    // texCoordId: ${stage.texCoordId} texMap: ${stage.texMap} channelId: ${stage.channelId}
    ${this.generateColorOp(stage)};
    ${this.generateAlphaOp(stage)};`;
    }

    private generateTevStages(tevStages: TevStage[]) {
        return tevStages.map((s) => this.generateTevStage(s)).join(`\n`);
    }

    private generateAlphaTestCompare(compare: GX.CompareType, reference: number) {
        const reg = this.generateTevRegister(GX.Register.PREV);
        const ref = this.generateFloat(reference);
        switch (compare) {
        case GX.CompareType.NEVER:   return `false`;
        case GX.CompareType.LESS:    return `${reg}.a <  ${ref}`;
        case GX.CompareType.EQUAL:   return `${reg}.a == ${ref}`;
        case GX.CompareType.LEQUAL:  return `${reg}.a <= ${ref}`;
        case GX.CompareType.GREATER: return `${reg}.a >  ${ref}`;
        case GX.CompareType.NEQUAL:  return `${reg}.a != ${ref}`;
        case GX.CompareType.GEQUAL:  return `${reg}.a >= ${ref}`;
        case GX.CompareType.ALWAYS:  return `true`;
        }
    }

    private generateAlphaTestOp(op: GX.AlphaOp) {
        switch (op) {
        case GX.AlphaOp.AND:  return `t_alphaTestA && t_alphaTestB`;
        case GX.AlphaOp.OR:   return `t_alphaTestA || t_alphaTestB`;
        case GX.AlphaOp.XOR:  return `t_alphaTestA != t_alphaTestB`;
        case GX.AlphaOp.XNOR: return `t_alphaTestA == t_alphaTestB`;
        }
    }

    private generateAlphaTest(alphaTest: AlphaTest) {
        return `
    // Alpha Test: Op ${alphaTest.op}
    // Compare A: ${alphaTest.compareA} Reference A: ${this.generateFloat(alphaTest.referenceA)}
    // Compare B: ${alphaTest.compareB} Reference B: ${this.generateFloat(alphaTest.referenceB)}
    bool t_alphaTestA = ${this.generateAlphaTestCompare(alphaTest.compareA, alphaTest.referenceA)};
    bool t_alphaTestB = ${this.generateAlphaTestCompare(alphaTest.compareB, alphaTest.referenceB)};
    if (!(${this.generateAlphaTestOp(alphaTest.op)}))
        discard;
`;
    }

    private generateShaders() {
        const vertAttributeDefs = vtxAttributeGenDefs.map((a) => {
            return `
layout(location = ${a.attrib}) in ${a.storage} a_${a.name};
${a.scale ? `uniform float u_scale_${a.name};` : ``}
${a.storage} ReadAttrib_${a.name}() {
    return a_${a.name}${a.scale ? ` * u_scale_${a.name}` : ``};
}
`;
        }).join('');

        this.vert = `
precision highp float;
// Viewer
uniform mat4 u_projection;
uniform mat4 u_modelView;
// GX_Material
${vertAttributeDefs}
uniform mat3 u_TexMtx[10];

out vec3 v_Position;
out vec3 v_Normal;
out vec4 v_Color0;
out vec4 v_Color1;
out vec3 v_TexCoord0;
out vec3 v_TexCoord1;
out vec3 v_TexCoord2;
out vec3 v_TexCoord3;
out vec3 v_TexCoord4;
out vec3 v_TexCoord5;
out vec3 v_TexCoord6;
out vec3 v_TexCoord7;

void main() {
    v_Position = ReadAttrib_Position();
    v_Normal = ReadAttrib_Normal();
    v_Color0 = ${this.generateColorChannel(this.material.colorChannels[0], `ReadAttrib_Color0()`)};
    v_Color1 = ${this.generateColorChannel(this.material.colorChannels[1], `ReadAttrib_Color1()`)};
${this.generateTexGens(this.material.texGens)}
    gl_Position = u_projection * u_modelView * vec4(v_Position, 1.0);
}
`;

        const tevStages = this.material.tevStages;
        const alphaTest = this.material.alphaTest;
        const kColors = this.material.colorConstants;
        const rColors = this.material.colorRegisters;

        this.frag = `
precision mediump float;
uniform sampler2D u_Texture[8];

in vec3 v_Position;
in vec3 v_Normal;
in vec4 v_Color0;
in vec4 v_Color1;
in vec3 v_TexCoord0;
in vec3 v_TexCoord1;
in vec3 v_TexCoord2;
in vec3 v_TexCoord3;
in vec3 v_TexCoord4;
in vec3 v_TexCoord5;
in vec3 v_TexCoord6;
in vec3 v_TexCoord7;

vec3 TevBias(vec3 a, float b) { return a + vec3(b); }
float TevBias(float a, float b) { return a + b; }
vec3 TevSaturate(vec3 a) { return clamp(a, vec3(0), vec3(1)); }
float TevSaturate(float a) { return clamp(a, 0.0, 1.0); }

void main() {
    const vec4 s_kColor0 = ${this.generateColorConstant(kColors[0])};
    const vec4 s_kColor1 = ${this.generateColorConstant(kColors[1])};
    const vec4 s_kColor2 = ${this.generateColorConstant(kColors[2])};
    const vec4 s_kColor3 = ${this.generateColorConstant(kColors[3])};

    vec4 t_Color0    = ${this.generateColorConstant(rColors[0])};
    vec4 t_Color1    = ${this.generateColorConstant(rColors[1])};
    vec4 t_Color2    = ${this.generateColorConstant(rColors[2])};
    vec4 t_ColorPrev = ${this.generateColorConstant(rColors[3])};
${this.generateTevStages(tevStages)}
${this.generateAlphaTest(alphaTest)}
    gl_FragColor = t_ColorPrev;
}
`
    }

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram) {
        super.bind(gl, prog);

        for (const a of vtxAttributeGenDefs) {
            if (a.scale === false)
                continue;
            const uniformName = `u_scale_${a.name}`;
            this.vtxAttributeScaleLocations[a.attrib] = gl.getUniformLocation(prog, uniformName);
        }

        for (let i = 0; i < 10; i++)
            this.texMtxLocations[i] = gl.getUniformLocation(prog, `u_TexMtx[${i}]`);

        for (let i = 0; i < 8; i++)
            this.samplerLocations[i] = gl.getUniformLocation(prog, `u_Texture[${i}]`);
    }

    public getTexMtxLocation(i: number) {
        return this.texMtxLocations[i];
    }

    public getScaleUniformLocation(vtxAttrib: GX.VertexAttribute) {
        const location = this.vtxAttributeScaleLocations[vtxAttrib];
        if (location === undefined)
            return null;
        return location;
    }

    public getSamplerLocation(i: number) {
        return this.samplerLocations[i];
    }
}
// #endregion

// #region Material flags generation.
function translateCullMode(cullMode: GX.CullMode): CullMode {
    switch (cullMode) {
    case GX.CullMode.ALL:
        return CullMode.FRONT_AND_BACK;
    case GX.CullMode.FRONT:
        return CullMode.FRONT;
    case GX.CullMode.BACK:
        return CullMode.BACK;
    case GX.CullMode.NONE:
        return CullMode.NONE;
    }
}

function translateBlendFactor(blendFactor: GX.BlendFactor): BlendFactor {
    switch (blendFactor) {
    case GX.BlendFactor.ZERO:
        return BlendFactor.ZERO;
    case GX.BlendFactor.ONE:
        return BlendFactor.ONE;
    case GX.BlendFactor.SRCCLR:
        return BlendFactor.SRC_COLOR;
    case GX.BlendFactor.INVSRCCLR:
        return BlendFactor.ONE_MINUS_SRC_COLOR;
    case GX.BlendFactor.SRCALPHA:
        return BlendFactor.SRC_ALPHA;
    case GX.BlendFactor.INVSRCALPHA:
        return BlendFactor.ONE_MINUS_SRC_ALPHA;
    case GX.BlendFactor.DSTALPHA:
        return BlendFactor.DST_ALPHA;
    case GX.BlendFactor.INVDSTALPHA:
        return BlendFactor.ONE_MINUS_DST_ALPHA;
    }
}

export function translateRenderFlags(material: GXMaterial): RenderFlags {
    const renderFlags = new RenderFlags();
    renderFlags.cullMode = translateCullMode(material.cullMode);
    renderFlags.depthWrite = material.ropInfo.depthWrite;
    renderFlags.depthTest = material.ropInfo.depthTest;
    renderFlags.frontFace = FrontFaceMode.CW;
    renderFlags.blend = material.ropInfo.blendMode.type === GX.BlendMode.BLEND;
    renderFlags.blendSrc = translateBlendFactor(material.ropInfo.blendMode.srcFactor);
    renderFlags.blendDst = translateBlendFactor(material.ropInfo.blendMode.dstFactor);
    return renderFlags;
}
// #endregion
