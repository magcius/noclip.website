
// Utility library of default shader snippets.

export namespace GfxShaderLibrary {

export const MatrixLibrary = `
struct Mat2x4 { vec4 mx; vec4 my; };
struct Mat3x4 { vec4 mx; vec4 my; vec4 mz; };
struct Mat4x4 { vec4 mx; vec4 my; vec4 mz; vec4 mw; };

mat4x2 UnpackMatrix(Mat2x4 m) { return mat4x2(transpose(mat4(m.mx, m.my, vec4(0, 0, 0, 0), vec4(0, 0, 0, 1)))); }
mat4x3 UnpackMatrix(Mat3x4 m) { return mat4x3(transpose(mat4(m.mx, m.my, m.mz, vec4(0, 0, 0, 1)))); }
mat4 UnpackMatrix(Mat4x4 m) { return transpose(mat4(m.mx, m.my, m.mz, m.mw)); }
`;

// Helper math utility
export const saturate: string = `
float saturate(float v) { return clamp(v, 0.0, 1.0); }
vec2 saturate(vec2 v) { return clamp(v, vec2(0.0), vec2(1.0)); }
vec3 saturate(vec3 v) { return clamp(v, vec3(0.0), vec3(1.0)); }
vec4 saturate(vec4 v) { return clamp(v, vec4(0.0), vec4(1.0)); }
`;

export const invlerp: string = `
float invlerp(float a, float b, float v) { return (v - a) / (b - a); }
`;

export const MulNormalMatrix: string = `
vec3 MulNormalMatrix(mat4x3 t_Matrix, vec3 t_Value) {
    // Pull out the squared scaling.
    vec3 t_SqScale = vec3(dot(t_Matrix[0], t_Matrix[0]), dot(t_Matrix[1], t_Matrix[1]), dot(t_Matrix[2], t_Matrix[2]));
    return normalize(t_Matrix * vec4(t_Value / t_SqScale, 0.0));
}
`;

export const CalcScaleBias: string = `
vec2 CalcScaleBias(in vec2 t_Pos, in vec4 t_SB) {
    return t_Pos.xy * t_SB.xy + t_SB.zw;
}
`;

export function makeFullscreenVS(z: string = `1.0`, w: string = `1.0`): string {
    return `
out vec2 v_TexCoord;

void main() {
    v_TexCoord.x = (gl_VertexID == 1) ? 2.0 : 0.0;
    v_TexCoord.y = (gl_VertexID == 2) ? 2.0 : 0.0;
    gl_Position.xy = v_TexCoord * vec2(2) - vec2(1);
    gl_Position.zw = vec2(${z}, ${w});

#if GFX_CLIPSPACE_NEAR_ZERO()
    gl_Position.z = (gl_Position.z + gl_Position.w) * 0.5;
#endif

#if GFX_VIEWPORT_ORIGIN_TL()
    v_TexCoord.y = 1.0 - v_TexCoord.y;
#endif
}
`;
}

// Vertex shader for indexbuffer-less full-screen triangle
export const fullscreenVS: string = makeFullscreenVS();

export const fullscreenBlitOneTexPS: string = `
uniform sampler2D u_Texture;
in vec2 v_TexCoord;

void main() {
    gl_FragColor = texture(SAMPLER_2D(u_Texture), v_TexCoord);
}
`;

export const MonochromeNTSC: string = `
float MonochromeNTSC(vec3 t_Color) {
    // NTSC primaries. Note that this is designed for gamma-space values.
    return dot(t_Color.rgb, vec3(0.299, 0.587, 0.114));
}
`;

export const MonochromeNTSCLinear: string = `
float MonochromeNTSCLinear(vec3 t_Color) {
    // NTSC primaries. Note that this is designed for linear-space values.
    return dot(t_Color.rgb, vec3(0.2125, 0.7154, 0.0721));
}
`;

}

export function glslGenerateFloat(v: number): string {
    let s = v.toString();
    if (!s.includes('.'))
        s += '.0';
    if (s.includes('e'))
        s = v.toFixed(5); // hack! how best to stringify a number for glsl??
    return s;
}
