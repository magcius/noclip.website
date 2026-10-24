import * as RDP from "../Common/N64/RDP";
import { CombineParams } from '../Common/N64/RDP.js';
import { DeviceProgram } from "../Program";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { TextFilt } from '../Common/N64/Image.js';

import { GeometryMode } from './f3dex.js';

// FIXME: Parts of this are c/c from BanjoKazooie.
export class Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_TexCoord = 1;
    public static a_VertexColor = 2;
    public static ub_SceneParams = 0;
    public static ub_DrawParams = 1;
    public static ub_CombineParams = 2;

    constructor(
        combine: CombineParams,
        SP_GeometryMode: number,
        private DP_OtherModeL: number,
        private DP_OtherModeH: number,
    ) {
        super();

        if (RDP.getCycleTypeFromOtherModeH(DP_OtherModeH) === RDP.OtherModeH_CycleType.G_CYC_2CYCLE) {
            this.defines.set("TWO_CYCLE", "1");
        }

        if (SP_GeometryMode & GeometryMode.G_TEXTURE_GEN) {
            this.defines.set("TEXTURE_GEN", "1");
        }

        if (SP_GeometryMode & GeometryMode.G_TEXTURE_GEN_LINEAR) {
            this.defines.set("TEXTURE_GEN_LINEAR", "1");
        }

        this.frag = this.generateFrag(combine);
    }

    private generateFrag(combine: CombineParams): string {
        return `
            ${Program.common}
            ${this.generateFragCombineFuncs(combine)}
            ${this.generateFragSamplerFuncs(this.DP_OtherModeH)}

            void main() {
                vec4 t_Color = t_One;
                vec4 t_Tex0 = t_One, t_Tex1 = t_One;

                #ifdef ENABLE_TEXTURES
                    if (u_hasValidTexture > 0.0) {
                        t_Tex0 = Texture2D_N64(PP_SAMPLER_2D(u_Texture0), v_TexCoord.xy);
                    }
                    #ifdef TWO_CYCLE
                        t_Tex1 = Texture2D_N64(PP_SAMPLER_2D(u_Texture1), v_TexCoord.zw);
                    #else
                        t_Tex1 = t_Tex0;
                    #endif
                #endif

                t_Color = vec4(
                    CombineColorCycle0(t_Half, t_Tex0, t_Tex1),
                    CombineAlphaCycle0(t_Half.a, t_Tex0.a, t_Tex1.a)
                );

                #ifdef TWO_CYCLE
                    t_Color = vec4(
                        CombineColorCycle1(t_Color, t_Tex1, t_Tex0),
                        CombineAlphaCycle1(t_Color.a, t_Tex1.a, t_Tex0.a)
                    );
                #endif

                ${this.generateAlphaTest()}

                gl_FragColor = vec4(t_Color.rgb, max(t_Color.a, u_minAlpha));
            }
        `;
    }

    private generateAlphaTest(): string {
        const alphaCompare = (this.DP_OtherModeL >>> 0) & 0x03;
        const cvgXAlpha = (this.DP_OtherModeL >>> RDP.OtherModeL_Layout.CVG_X_ALPHA) & 0x01;
        let alphaThreshold = 0;
        if (alphaCompare === 0x01) {
            alphaThreshold = 0.5;
        } else if (alphaCompare !== 0x00) {
            alphaThreshold = .0125; // should be dither
        } else if (cvgXAlpha !== 0x00) {
            // this line is taken from GlideN64, but here's some rationale:
            // With this bit set, the pixel coverage value is multiplied by alpha
            // before being sent to the blender. While coverage mostly matters for
            // the n64 antialiasing, a pixel with zero coverage will be ignored.
            // Since coverage is really an integer from 0 to 8, we assume anything
            // less than 1 would be truncated to 0, leading to the value below.
            alphaThreshold = 0.125;
        }

        if (alphaThreshold > 0) {
            return `
                if (t_Color.a < ${alphaThreshold}) {
                    discard;
                }
            `;
        } else {
            return "";
        }
    }

    private generateFragSamplerFuncs(DP_OtherModeH: number): string {
        let textFiltStr: string;
        switch(RDP.getTextFiltFromOtherModeH(DP_OtherModeH)) {
            case TextFilt.G_TF_POINT:
                textFiltStr = 'Point';
                break;
            case TextFilt.G_TF_AVERAGE:
                textFiltStr = 'Average';
                break;
            case TextFilt.G_TF_BILERP:
                textFiltStr = 'Bilerp';
                break;
            default:
                throw new Error("invalid texture filter");
        }

        return `
            vec4 Texture2D_N64_Point(PD_SAMPLER_2D(t_Texture), vec2 t_TexCoord) {
                return texture(PU_SAMPLER_2D(t_Texture), t_TexCoord);
            }

            vec4 Texture2D_N64_Average(PD_SAMPLER_2D(t_Texture), vec2 t_TexCoord) {
                // Unimplemented.
                return texture(PU_SAMPLER_2D(t_Texture), t_TexCoord);
            }

            // Implements N64-style "triangle bilinear filtering" with three taps.
            // Based on ArthurCarvalho's implementation, modified by NEC and Jasper for noclip.
            vec4 Texture2D_N64_Bilerp(PD_SAMPLER_2D(t_Texture), vec2 t_TexCoord) {
                vec2 t_Size = vec2(textureSize(PU_SAMPLER_2D(t_Texture), 0));
                vec2 t_Offs = fract(t_TexCoord*t_Size - vec2(0.5));
                t_Offs -= step(1.0, t_Offs.x + t_Offs.y);
                vec4 t_S0 = texture(PU_SAMPLER_2D(t_Texture), t_TexCoord - t_Offs / t_Size);
                vec4 t_S1 = texture(PU_SAMPLER_2D(t_Texture), t_TexCoord - vec2(t_Offs.x - sign(t_Offs.x), t_Offs.y) / t_Size);
                vec4 t_S2 = texture(PU_SAMPLER_2D(t_Texture), t_TexCoord - vec2(t_Offs.x, t_Offs.y - sign(t_Offs.y)) / t_Size);
                return t_S0 + abs(t_Offs.x)*(t_S1-t_S0) + abs(t_Offs.y)*(t_S2-t_S0);
            }

            #define Texture2D_N64 Texture2D_N64_${textFiltStr}
        `;
    }

    private generateFragCombineFuncs(combine: CombineParams): string {
        const colorInputs: string[] = [
            't_CombColor.rgb', 't_Tex0.rgb', 't_Tex1.rgb', 'u_PrimColor.rgb',
            'v_VertexColor.rgb', 'u_EnvColor.rgb', 't_One.rgb', 't_Zero.rgb'
        ];

        const multInputs: string[] = [
            't_CombColor.rgb', 't_Tex0.rgb', 't_Tex1.rgb', 'u_PrimColor.rgb',
            'v_VertexColor.rgb', 'u_EnvColor.rgb', 't_Zero.rgb' /* key */, 't_CombColor.aaa',
            't_Tex0.aaa', 't_Tex1.aaa', 'u_PrimColor.aaa', 'v_VertexColor.aaa',
            'u_EnvColor.aaa', 't_Zero.rgb' /* LOD */, 'u_MiscComb.rrr' /* prim LOD */, 't_Zero.rgb'
        ];

        const alphaInputs: string[] = [
            'combAlpha', 't_Tex0', 't_Tex1', 'u_PrimColor.a',
            'v_VertexColor.a', 'u_EnvColor.a', '1.0', '0.0'
        ];

        // For now setting the LOD fraction to 0 should be fine since I don't think anyone cares about mipmaps
        const alphaMultInputs: string[] = [
            '0.0' /* LOD_FRACTION */, 't_Tex0', 't_Tex1', 'u_PrimColor.a',
            'v_VertexColor.a', 'u_EnvColor.a', 'u_MiscComb.r', '0.0'
        ];

        return `
            vec3 CombineColorCycle0(vec4 t_CombColor, vec4 t_Tex0, vec4 t_Tex1) {
                return (${colorInputs[combine.c0.a]} - ${colorInputs[combine.c0.b]}) * ${multInputs[combine.c0.c]} + ${colorInputs[combine.c0.d]};
            }

            float CombineAlphaCycle0(float combAlpha, float t_Tex0, float t_Tex1) {
                return (${alphaInputs[combine.a0.a]} - ${alphaInputs[combine.a0.b]}) * ${alphaMultInputs[combine.a0.c]} + ${alphaInputs[combine.a0.d]};
            }

            vec3 CombineColorCycle1(vec4 t_CombColor, vec4 t_Tex0, vec4 t_Tex1) {
                return (${colorInputs[combine.c1.a]} - ${colorInputs[combine.c1.b]}) * ${multInputs[combine.c1.c]} + ${colorInputs[combine.c1.d]};
            }

            float CombineAlphaCycle1(float combAlpha, float t_Tex0, float t_Tex1) {
                return (${alphaInputs[combine.a1.a]} - ${alphaInputs[combine.a1.b]}) * ${alphaMultInputs[combine.a1.c]} + ${alphaInputs[combine.a1.d]};
            }
        `;
    }

    private static common = `
        ${GfxShaderLibrary.MatrixLibrary}

        layout(std140) uniform ub_SceneParams {
            Mat4x4 u_ClipFromWorld;
            Mat3x4 u_WorldFromLocal;
            vec4 u_LookAtVectors[2];
        };

        layout(std140) uniform ub_DrawParams {
            Mat2x4 u_TexMatrix[2];
            float u_hasValidTexture;
            float u_minAlpha;
        };

        layout(std140) uniform ub_CombineParams {
            vec4 u_PrimColor;
            vec4 u_EnvColor;
        };

        uniform sampler2D u_Texture0;
        uniform sampler2D u_Texture1;

        varying vec4 v_TexCoord;
        varying vec4 v_VertexColor;

        const vec4 t_Zero = vec4(0.0);
        const vec4 t_Half = vec4(0.5);
        const vec4 t_One = vec4(1.0);
    `;

    public override vert = `
        ${Program.common}

        layout(location = ${Program.a_Position}) in vec3 a_Position;
        layout(location = ${Program.a_TexCoord}) in vec2 a_TexCoord;
        layout(location = ${Program.a_VertexColor}) in vec4 a_VertexColor;

        // Convert from 0...1 UNORM range to SNORM range
        vec3 ConvertToSignedInt(vec3 t_Input) {
            ivec3 t_Num = ivec3(t_Input * 255.0);
            // Sign extend
            t_Num = t_Num << 24 >> 24;
            return vec3(t_Num) / 127.0;
        }

        void main() {
            vec3 t_PositionWorld = (UnpackMatrix(u_WorldFromLocal) * vec4(a_Position.xyz, 1.0f)).xyz;

            gl_Position = UnpackMatrix(u_ClipFromWorld) * vec4(t_PositionWorld, 1.0f);
            v_VertexColor = a_VertexColor;

            v_TexCoord.xy = UnpackMatrix(u_TexMatrix[0]) * vec4(a_TexCoord, 1.0, 1.0);
            v_TexCoord.zw = UnpackMatrix(u_TexMatrix[1]) * vec4(a_TexCoord, 1.0, 1.0);

            #ifdef TEXTURE_GEN
                vec4 t_Normal = vec4(ConvertToSignedInt(a_VertexColor.rgb), 0.0);
                t_Normal.xy = vec2(dot(t_Normal, u_LookAtVectors[0]), dot(t_Normal, u_LookAtVectors[1]));

                #ifdef TEXTURE_GEN_LINEAR
                    v_TexCoord.xy = acos(t_Normal.xy)/radians(180.0);
                #else
                    v_TexCoord.xy = (t_Normal.xy + vec2(1.0))/2.0;
                #endif

                v_TexCoord.zw = v_TexCoord.xy;
                v_VertexColor = vec4(1.0, 1.0, 1.0, 1.0);
            #endif
        }
    `;
}
