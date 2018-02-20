
import * as BMD from './bmd';
import * as GX from './gx';
import * as Texture from './texture';
import * as Viewer from 'viewer';

import { fetch } from 'util';
import { Progressable } from '../progress';

interface VertexAttributeGenDef {
    attrib: GX.VertexAttribute;
    storage: string;
    name: string;
    scale: boolean;
};

class BMDProgram extends Viewer.Program {
    private static vtxAttributeGenDefs: VertexAttributeGenDef[] = [
        { attrib: GX.VertexAttribute.POS,  name: "Position",  storage: "vec3", scale: true },
        { attrib: GX.VertexAttribute.NRM,  name: "Normal",    storage: "vec3", scale: true },
        { attrib: GX.VertexAttribute.CLR0, name: "Color0",    storage: "vec4", scale: false },
        { attrib: GX.VertexAttribute.CLR1, name: "Color1",    storage: "vec4", scale: false },
        { attrib: GX.VertexAttribute.TEX0, name: "TexCoord0", storage: "vec2", scale: true },
        { attrib: GX.VertexAttribute.TEX1, name: "TexCoord1", storage: "vec2", scale: true },
        { attrib: GX.VertexAttribute.TEX2, name: "TexCoord2", storage: "vec2", scale: true },
        { attrib: GX.VertexAttribute.TEX3, name: "TexCoord3", storage: "vec2", scale: true },
        { attrib: GX.VertexAttribute.TEX4, name: "TexCoord4", storage: "vec2", scale: true },
        { attrib: GX.VertexAttribute.TEX5, name: "TexCoord5", storage: "vec2", scale: true },
        { attrib: GX.VertexAttribute.TEX6, name: "TexCoord6", storage: "vec2", scale: true },
        { attrib: GX.VertexAttribute.TEX7, name: "TexCoord7", storage: "vec2", scale: true },
    ];

    private vtxAttributeScaleLocations: WebGLUniformLocation[] = [];

    private material: BMD.MaterialEntry;

    constructor(material: BMD.MaterialEntry) {
        super();
        this.material = material;

        this.generateShaders();
    }

    // Color Channels
    private generateColorConstant(c: BMD.Color) {
        return `vec4(${c.r}, ${c.g}, ${c.b}, ${c.a})`;
    }

    private generateColorChannel(chan: BMD.ColorChannelControl, vtxSource: string) {
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
        case GX.TexGenSrc.TEX0:      return `Read_Tex0()`;
        case GX.TexGenSrc.TEX1:      return `Read_Tex1()`;
        case GX.TexGenSrc.TEX2:      return `Read_Tex2()`;
        case GX.TexGenSrc.TEX3:      return `Read_Tex3()`;
        case GX.TexGenSrc.TEX4:      return `Read_Tex4()`;
        case GX.TexGenSrc.TEX5:      return `Read_Tex5()`;
        case GX.TexGenSrc.TEX6:      return `Read_Tex6()`;
        case GX.TexGenSrc.TEX7:      return `Read_Tex7()`;
        // Use a previously generated texcoordgen.
        case GX.TexGenSrc.TEXCOORD0: return `v_TexCoord0`;
        case GX.TexGenSrc.TEXCOORD1: return `v_TexCoord1`;
        case GX.TexGenSrc.TEXCOORD2: return `v_TexCoord2`;
        case GX.TexGenSrc.TEXCOORD3: return `v_TexCoord3`;
        case GX.TexGenSrc.TEXCOORD4: return `v_TexCoord4`;
        case GX.TexGenSrc.TEXCOORD5: return `v_TexCoord5`;
        case GX.TexGenSrc.TEXCOORD6: return `v_TexCoord6`;
        default:
            throw "whoops";
        }
    }

    private generateTexGenMatrix(src: string, matrix: GX.TexGenMatrix) {
        switch (matrix) {
        case GX.TexGenMatrix.IDENTITY: return src;
        // TODO(jstpierre): TexMtx
        default: return src;
        }
    }

    private generateTexGenType(texCoordGen: BMD.TexGen) {
        const src = this.generateTexGenSource(texCoordGen.source);
        switch (texCoordGen.type) {
        // Expected to be used with colors, I suspect...
        case GX.TexGenType.SRTG:   return `${src}.rg`;
        case GX.TexGenType.MTX2x4: return this.generateTexGenMatrix(src, texCoordGen.matrix);
        // TODO(jstpierre): Support projected textures.
        case GX.TexGenType.MTX3x4:
            throw "whoops";
        default:
            throw "whoops";
        }
    }

    private generateTexGen(texCoordGen: BMD.TexGen) {
        const i = texCoordGen.index;
        return `
    // TexGen ${i}  Type: ${texCoordGen.type} Source: ${texCoordGen.source} Matrix: ${texCoordGen.matrix}
    v_TexCoord${i} = ${this.generateTexGenType(texCoordGen)};
`;
    }

    // TEV
    private generateKonstColorSel(konstColor: GX.KonstColorSel): string {
        switch (konstColor) {
        case GX.KonstColorSel.KCSEL_1:    return 'vec3(8/8)';
        case GX.KonstColorSel.KCSEL_7_8:  return 'vec3(7/8)';
        case GX.KonstColorSel.KCSEL_3_4:  return 'vec3(6/8)';
        case GX.KonstColorSel.KCSEL_5_8:  return 'vec3(5/8)';
        case GX.KonstColorSel.KCSEL_1_2:  return 'vec3(4/8)';
        case GX.KonstColorSel.KCSEL_3_8:  return 'vec3(3/8)';
        case GX.KonstColorSel.KCSEL_1_4:  return 'vec3(2/8)';
        case GX.KonstColorSel.KCSEL_1_8:  return 'vec3(1/8)';
        case GX.KonstColorSel.KCSEL_K0:   return 's_kColor[0].rgb';
        case GX.KonstColorSel.KCSEL_K0_R: return 's_kColor[0].rrr';
        case GX.KonstColorSel.KCSEL_K0_G: return 's_kColor[0].ggg';
        case GX.KonstColorSel.KCSEL_K0_B: return 's_kColor[0].bbb';
        case GX.KonstColorSel.KCSEL_K0_A: return 's_kColor[0].aaa';
        case GX.KonstColorSel.KCSEL_K1:   return 's_kColor[1].rgb';
        case GX.KonstColorSel.KCSEL_K1_R: return 's_kColor[1].rrr';
        case GX.KonstColorSel.KCSEL_K1_G: return 's_kColor[1].ggg';
        case GX.KonstColorSel.KCSEL_K1_B: return 's_kColor[1].bbb';
        case GX.KonstColorSel.KCSEL_K1_A: return 's_kColor[1].aaa';
        case GX.KonstColorSel.KCSEL_K2:   return 's_kColor[2].rgb';
        case GX.KonstColorSel.KCSEL_K2_R: return 's_kColor[2].rrr';
        case GX.KonstColorSel.KCSEL_K2_G: return 's_kColor[2].ggg';
        case GX.KonstColorSel.KCSEL_K2_B: return 's_kColor[2].bbb';
        case GX.KonstColorSel.KCSEL_K2_A: return 's_kColor[2].aaa';
        case GX.KonstColorSel.KCSEL_K3:   return 's_kColor[3].rgb';
        case GX.KonstColorSel.KCSEL_K3_R: return 's_kColor[3].rrr';
        case GX.KonstColorSel.KCSEL_K3_G: return 's_kColor[3].ggg';
        case GX.KonstColorSel.KCSEL_K3_B: return 's_kColor[3].bbb';
        case GX.KonstColorSel.KCSEL_K3_A: return 's_kColor[3].aaa';
        }
    }

    private generateKonstAlphaSel(konstAlpha: GX.KonstAlphaSel): string {
        switch (konstAlpha) {
        case GX.KonstAlphaSel.KASEL_1:    return '8/8';
        case GX.KonstAlphaSel.KASEL_7_8:  return '7/8';
        case GX.KonstAlphaSel.KASEL_3_4:  return '6/8';
        case GX.KonstAlphaSel.KASEL_5_8:  return '5/8';
        case GX.KonstAlphaSel.KASEL_1_2:  return '4/8';
        case GX.KonstAlphaSel.KASEL_3_8:  return '3/8';
        case GX.KonstAlphaSel.KASEL_1_4:  return '2/8';
        case GX.KonstAlphaSel.KASEL_1_8:  return '1/8';
        case GX.KonstAlphaSel.KASEL_K0_R: return 's_kColor[0].r';
        case GX.KonstAlphaSel.KASEL_K0_G: return 's_kColor[0].g';
        case GX.KonstAlphaSel.KASEL_K0_B: return 's_kColor[0].b';
        case GX.KonstAlphaSel.KASEL_K0_A: return 's_kColor[0].a';
        case GX.KonstAlphaSel.KASEL_K1_R: return 's_kColor[1].r';
        case GX.KonstAlphaSel.KASEL_K1_G: return 's_kColor[1].g';
        case GX.KonstAlphaSel.KASEL_K1_B: return 's_kColor[1].b';
        case GX.KonstAlphaSel.KASEL_K1_A: return 's_kColor[1].a';
        case GX.KonstAlphaSel.KASEL_K2_R: return 's_kColor[2].r';
        case GX.KonstAlphaSel.KASEL_K2_G: return 's_kColor[2].g';
        case GX.KonstAlphaSel.KASEL_K2_B: return 's_kColor[2].b';
        case GX.KonstAlphaSel.KASEL_K2_A: return 's_kColor[2].a';
        case GX.KonstAlphaSel.KASEL_K3_R: return 's_kColor[3].r';
        case GX.KonstAlphaSel.KASEL_K3_G: return 's_kColor[3].g';
        case GX.KonstAlphaSel.KASEL_K3_B: return 's_kColor[3].b';
        case GX.KonstAlphaSel.KASEL_K3_A: return 's_kColor[3].a';
        }
    }

    private generateRas(stage: BMD.TevStage) {
        switch (stage.channelId) {
        case GX.ColorChannelId.COLOR0: return `v_Color0`;
        case GX.ColorChannelId.COLOR1: return `v_Color1`;
        case GX.ColorChannelId.COLOR_ZERO: return `vec4(0, 0, 0, 0)`;
        default: throw "whoops";
        }
    }

    private generateTexAccess(stage: BMD.TevStage) {
        return `texture(u_Texture[${stage.texMap}], v_TexCoord${stage.texCoordId})`;
    }

    private generateColorIn(stage: BMD.TevStage, colorIn: GX.CombineColorInput) {
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
        case GX.CombineColorInput.KONST: return `${this.generateKonstColorSel(stage.konstColorSel)}.rgb`;
        case GX.CombineColorInput.ZERO:  return `vec3(0)`;
        }
    }

    private generateAlphaIn(stage: BMD.TevStage, alphaIn: GX.CombineAlphaInput) {
        const i = stage.index;
        switch (alphaIn) {
        case GX.CombineAlphaInput.APREV: return `t_ColorPrev.a`;
        case GX.CombineAlphaInput.A0:    return `t_Color0.a`;
        case GX.CombineAlphaInput.A1:    return `t_Color1.a`;
        case GX.CombineAlphaInput.A2:    return `t_Color2.a`;
        case GX.CombineAlphaInput.TEXA:  return `${this.generateTexAccess(stage)}.a`;
        case GX.CombineAlphaInput.RASA:  return `${this.generateRas(stage)}.a`;
        case GX.CombineAlphaInput.KONST: return `${this.generateKonstAlphaSel(stage.konstAlphaSel)}.a`;
        case GX.CombineAlphaInput.ZERO:  return `0`;
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
            v = `(${v}) * 2`;
        else if (scale === GX.TevScale.SCALE_4)
            v = `(${v}) * 4`;
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
            const oper = (op === GX.TevOp.ADD) ? '+' : '-';
            const bare = `${d} ${op} mix(${a}, ${b}, ${c})`;
            return this.generateTevOpBiasScaleClamp(bare, bias, scale, clamp);
        default:
            throw "whoops";
        }
    }

    private generateColorOp(stage: BMD.TevStage) {
        const a = this.generateColorIn(stage, stage.colorInA);
        const b = this.generateColorIn(stage, stage.colorInB);
        const c = this.generateColorIn(stage, stage.colorInC);
        const d = this.generateColorIn(stage, stage.colorInD);
        const value = this.generateTevOpValue(stage.colorOp, stage.colorBias, stage.colorScale, stage.colorClamp, a, b, c, d);
        return `${this.generateTevRegister(stage.colorRegId)}.rgb = ${value}`;
    }

    private generateAlphaOp(stage: BMD.TevStage) {
        const a = this.generateAlphaIn(stage, stage.alphaInA);
        const b = this.generateAlphaIn(stage, stage.alphaInB);
        const c = this.generateAlphaIn(stage, stage.alphaInC);
        const d = this.generateAlphaIn(stage, stage.alphaInD);
        const value = this.generateTevOpValue(stage.alphaOp, stage.alphaBias, stage.alphaScale, stage.alphaClamp, a, b, c, d);
        return `${this.generateTevRegister(stage.alphaRegId)}.a = ${value}`;
    }

    private generateTevStage(stage: BMD.TevStage) {
        const i = stage.index;
        const header = `
    // TEV Stage ${i}
    // colorIn: ${stage.colorInA} ${stage.colorInB} ${stage.colorInC} ${stage.colorInD}  colorOp: ${stage.colorOp} colorBias: ${stage.colorBias} colorScale: ${stage.colorScale} colorClamp: ${stage.colorClamp} colorRegId: ${stage.colorRegId}
    // alphaIn: ${stage.alphaInA} ${stage.alphaInB} ${stage.alphaInC} ${stage.alphaInD}  alphaOp: ${stage.alphaOp} alphaBias: ${stage.alphaBias} alphaScale: ${stage.alphaScale} alphaClamp: ${stage.alphaClamp} alphaRegId: ${stage.alphaRegId}
    // texCoordId: ${stage.texCoordId} texMap: ${stage.texMap} channelId: ${stage.channelId}
    ${this.generateColorOp(stage)}
    ${this.generateAlphaOp(stage)}
`;
    }

    private generateTevStages(tevStages: BMD.TevStage[]) {
        return tevStages.map((s) => this.generateTevStage(s)).join('\n');
    }

    private generateAlphaTestCompare(compare: GX.CompareType, reference: number) {
        const reg = this.generateTevRegister(GX.Register.PREV);
        const ref = `${reference}`;
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

    private generateAlphaTest(alphaTest: BMD.AlphaTest) {
        return `
    bool t_alphaTestA = ${this.generateAlphaTestCompare(alphaTest.compareA, alphaTest.referenceA)};
    bool t_alphaTestB = ${this.generateAlphaTestCompare(alphaTest.compareB, alphaTest.referenceB)};
    if (!(${this.generateAlphaTestOp(alphaTest.op)}))
        discard;
`;
    }

    private generateShaders() {
        const vertAttributeDefs = BMDProgram.vtxAttributeGenDefs.map((a) => {
            return `
layout(location = ${a.attrib}) in ${a.storage} a_${a.name};
out ${a.storage} v_${a.name};
${a.scale ? `uniform float u_scale_${a.name};` : ``}
${a.storage} ReadAttrib_${a.name}() {
    return a_${a.name}${a.scale ? ` * u_scale_${a.name}` : ``};
}
`;
        }).join('');

        this.vert = `
precision mediump float;
uniform mat4 u_projection;
uniform mat4 u_modelView;
${vertAttributeDefs}

vec3 TevBias(vec3 a, float b) { return a + vec3(b); }
float TevBias(float a, float b) { return a + b; }
vec3 TevSaturate(vec3 a) { return clamp(a, vec3(0), vec3(1)); }
float TevSaturate(float a) { return clamp(a, 0, 1); }

void main() {
    v_Position = ReadAttrib_Position();
    v_Normal = ReadAttrib_Normal();
    vec3 t_Color0 = ReadAttrib_Color0();
    vec3 t_Color1 = ReadAttrib_Color1();
    v_Color0 = ${this.generateColorChannel(this.material.colorChannels[0], `ReadAttrib_Color0()`)};
    v_Color1 = ${this.generateColorChannel(this.material.colorChannels[1], `ReadAttrib_Color1()`)};
    gl_Position = u_projection * u_modelView * vec4(v_Position, 1.0);
}
`;

        const fragAttributeDefs = BMDProgram.vtxAttributeGenDefs.map((a) => {
            return `
in ${a.storage} v_${a.name};
`;
        }).join('');

        const tevStages = this.material.tevStages;
        const alphaTest = this.material.alphaTest;
        const kColors = this.material.colorConstants;
        const rColors = this.material.colorRegisters;

        this.frag = `
precision mediump float;
${fragAttributeDefs}

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

    // Alpha Test: Op ${alphaTest.op}
    // Compare A: ${alphaTest.compareA} Reference A: ${alphaTest.referenceA}
    // Compare B: ${alphaTest.compareB} Reference B: ${alphaTest.referenceB}
    ${this.generateAlphaTest(alphaTest)}

    gl_FragColor = t_ColorPrev;
}
`
    }

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram) {
        super.bind(gl, prog);

        for (const a of BMDProgram.vtxAttributeGenDefs) {
            if (a.scale === false)
                continue;
            const uniformName = `u_scale_${a.name}`;
            this.vtxAttributeScaleLocations[a.attrib] = gl.getUniformLocation(prog, uniformName);
        }
    }

    public getScaleUniformLocation(vtxAttrib: GX.VertexAttribute) {
        const location = this.vtxAttributeScaleLocations[vtxAttrib];
        if (location === undefined)
            return null;
        return location;
    }
}

function translateCompType(gl: WebGL2RenderingContext, compType: GX.CompType): { type: GLenum, normalized: boolean } {
    switch (compType) {
    case GX.CompType.F32:
        return { type: gl.FLOAT, normalized: false };
    case GX.CompType.S8:
        return { type: gl.BYTE, normalized: false };
    case GX.CompType.S16:
        return { type: gl.SHORT, normalized: false };
    case GX.CompType.U16:
        return { type: gl.UNSIGNED_SHORT, normalized: false };
    case GX.CompType.U8:
        return { type: gl.UNSIGNED_BYTE, normalized: false };
    case GX.CompType.RGBA8: // XXX: Is this right?
        return { type: gl.UNSIGNED_BYTE, normalized: true };
    default:
        throw new Error(`Unknown CompType ${compType}`);
    }
}

function translatePrimType(gl: WebGL2RenderingContext, primType: GX.PrimitiveType): number {
    switch (primType) {
    case GX.PrimitiveType.TRIANGLESTRIP:
        return gl.TRIANGLE_STRIP;
    case GX.PrimitiveType.TRIANGLEFAN:
        return gl.TRIANGLE_FAN;
    default:
        throw new Error(`Unknown PrimType ${primType}`);
    }
}

class Command_Shape {
    public bmd: BMD.BMD;
    public shape: BMD.Shape;
    public buffer: WebGLBuffer;
    public vao: WebGLVertexArrayObject;

    constructor(gl: WebGL2RenderingContext, bmd: BMD.BMD, shape: BMD.Shape) {
        this.bmd = bmd;
        this.shape = shape;
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        this.buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.shape.packedData, gl.STATIC_DRAW);

        for (const attrib of this.shape.packedVertexAttributes) {
            const vertexArray = this.bmd.vtx1.vertexArrays.get(attrib.vtxAttrib);

            const attribLocation = attrib.vtxAttrib;
            gl.enableVertexAttribArray(attribLocation);

            const { type, normalized } = translateCompType(gl, vertexArray.compType);

            gl.vertexAttribPointer(
                attribLocation,
                vertexArray.compCount,
                type, normalized,
                this.shape.packedVertexSize,
                attrib.offset,
            );
        }
    }

    public exec(state: Viewer.RenderState) {
        const gl = state.gl;

        gl.bindVertexArray(this.vao);

        // Do draw calls.
        for (const drawCall of this.shape.drawCalls) {
            gl.drawArrays(translatePrimType(gl, drawCall.primType), drawCall.first, drawCall.vertexCount);
        }

        gl.bindVertexArray(null);
    }
}

class Command_Material {
    public bmd: BMD.BMD;
    public material: BMD.MaterialEntry;

    private tex0: WebGLTexture = null;
    private renderFlags: Viewer.RenderFlags;
    private program: BMDProgram;

    constructor(gl: WebGL2RenderingContext, bmd: BMD.BMD, material: BMD.MaterialEntry) {
        this.bmd = bmd;
        this.material = material;
        this.program = new BMDProgram(material);

        this.renderFlags = Command_Material.translateRenderFlags(this.material);

        const tex0Index = this.material.textureIndexes[6];
        if (tex0Index > 0)
            this.tex0 = Command_Material.translateTexture(gl, this.bmd.tex1.textures[tex0Index]);
    }

    private static translateTexFilter(gl: WebGL2RenderingContext, texFilter: GX.TexFilter) {
        // TODO(jstpierre): Upload mipmaps as well.
        switch (texFilter) {
        case GX.TexFilter.LIN_MIP_NEAR:
        case GX.TexFilter.LIN_MIP_LIN:
        case GX.TexFilter.LINEAR:
            return gl.LINEAR;
        case GX.TexFilter.NEAR_MIP_NEAR:
        case GX.TexFilter.NEAR_MIP_LIN:
        case GX.TexFilter.NEAR:
            return gl.NEAREST;
        }
    }

    private static translateWrapMode(gl: WebGL2RenderingContext, wrapMode: GX.WrapMode) {
        switch (wrapMode) {
        case GX.WrapMode.CLAMP:
            return gl.CLAMP_TO_EDGE;
        case GX.WrapMode.MIRROR:
            return gl.MIRRORED_REPEAT;
        case GX.WrapMode.REPEAT:
            return gl.REPEAT;
        }
    }

    private static translateTexture(gl: WebGL2RenderingContext, texture: BMD.TEX1_Texture) {
        const texId = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texId);

        const ext_compressed_texture_s3tc = gl.getExtension('WEBGL_compressed_texture_s3tc');
        const decodedTexture = Texture.decodeTexture(texture, !!ext_compressed_texture_s3tc);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.translateTexFilter(gl, texture.minFilter));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.translateTexFilter(gl, texture.magFilter));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.translateWrapMode(gl, texture.wrapS));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, this.translateWrapMode(gl, texture.wrapT));

        if (decodedTexture.type === 'RGBA') {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, decodedTexture.width, decodedTexture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, decodedTexture.pixels);
        } else if (decodedTexture.type === 'S3TC') {
            gl.compressedTexImage2D(gl.TEXTURE_2D, 0, ext_compressed_texture_s3tc.COMPRESSED_RGBA_S3TC_DXT1_EXT, decodedTexture.width, decodedTexture.height, 0, decodedTexture.pixels);
        }

        return texId;
    }

    private static translateCullMode(cullMode: GX.CullMode): Viewer.RenderCullMode {
        switch (cullMode) {
        case GX.CullMode.ALL:
            return Viewer.RenderCullMode.FRONT_AND_BACK;
        case GX.CullMode.FRONT:
            return Viewer.RenderCullMode.FRONT;
        case GX.CullMode.BACK:
            return Viewer.RenderCullMode.BACK;
        case GX.CullMode.NONE:
            return Viewer.RenderCullMode.NONE;
        }
    }

    private static translateRenderFlags(material: BMD.MaterialEntry): Viewer.RenderFlags {
        const renderFlags = new Viewer.RenderFlags();
        renderFlags.cullMode = this.translateCullMode(material.cullMode);
        renderFlags.depthWrite = material.ropInfo.depthWrite;
        renderFlags.depthTest = material.ropInfo.depthTest;
        renderFlags.frontFace = Viewer.RenderFrontFaceMode.CW;
        return renderFlags;
    }

    public exec(state: Viewer.RenderState) {
        const gl = state.gl;

        state.useProgram(this.program);

        // Bind our scale uniforms.
        for (const vertexArray of this.bmd.vtx1.vertexArrays.values()) {
            const location = this.program.getScaleUniformLocation(vertexArray.vtxAttrib);
            if (location === null)
                continue;
            gl.uniform1f(location, vertexArray.scale);
        }

        state.useFlags(this.renderFlags);
        gl.bindTexture(gl.TEXTURE_2D, this.tex0);
    }
}

type Command = Command_Shape | Command_Material;

export class Scene implements Viewer.Scene {
    public gl: WebGL2RenderingContext;
    public cameraController = Viewer.FPSCameraController;
    public textures: HTMLCanvasElement[];
    private bmd: BMD.BMD;
    private commands: Command[];

    constructor(gl: WebGL2RenderingContext, bmd: BMD.BMD) {
        this.gl = gl;
        this.bmd = bmd;
        this.translateModel(this.bmd);

        this.textures = this.bmd.tex1.textures.map((tex) => this.translateTextureToCanvas(tex));
    }

    private translateTextureToCanvas(texture: BMD.TEX1_Texture): HTMLCanvasElement {
        const rgbaTexture = Texture.decodeTexture(texture, false);
        // Should never happen.
        if (rgbaTexture.type === 'S3TC')
            return null;
        const canvas = document.createElement('canvas');
        canvas.width = rgbaTexture.width;
        canvas.height = rgbaTexture.height;
        canvas.title = `${texture.name} ${texture.format}`;
        const ctx = canvas.getContext('2d');
        const imgData = new ImageData(rgbaTexture.width, rgbaTexture.height);
        imgData.data.set(new Uint8Array(rgbaTexture.pixels.buffer));
        ctx.putImageData(imgData, 0, 0);
        return canvas;
    }

    public render(state: Viewer.RenderState) {
        for (const command of this.commands)
            command.exec(state);
    }

    private translateModel(bmd: BMD.BMD) {
        this.commands = [];
        // Iterate through scene graph.
        this.translateSceneGraph(bmd.inf1.sceneGraph);
    }

    private translateSceneGraph(node: BMD.HierarchyNode) {
        switch (node.type) {
        case BMD.HierarchyType.Open:
            for (const child of node.children)
                this.translateSceneGraph(child);
            break;
        case BMD.HierarchyType.Shape:
            const shape = this.bmd.shp1.shapes[node.shapeIdx];
            this.commands.push(new Command_Shape(this.gl, this.bmd, shape));
            break;
        case BMD.HierarchyType.Joint:
            // XXX: Implement joints...
            break;
        case BMD.HierarchyType.Material:
            const material = this.bmd.mat3.materialEntries[node.materialIdx];
            this.commands.push(new Command_Material(this.gl, this.bmd, material));
            break;
        }
    }
}

export class SceneDesc implements Viewer.SceneDesc {
    public id: string;
    public name: string;
    public path: string;

    constructor(name: string, path: string) {
        this.name = name;
        this.path = path;
        this.id = this.path;
    }

    public createScene(gl: WebGL2RenderingContext): Progressable<Scene> {
        return fetch(this.path).then((result: ArrayBuffer) => {
            const bmd = BMD.parse(result);
            return new Scene(gl, bmd);
        });
    }
}
