precision mediump float;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    float u_Time;
};

layout(row_major, std140) uniform ub_DrawParams {
    Mat4x4 u_Model;
    Mat4x3 u_View;
    vec4 u_AnimOffset;
};

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_TexCoord;
varying vec4 v_TexClip;
varying vec2 v_TexRepeat;
varying vec4 v_TexScaleOffset;
varying vec2 v_TexScroll;
varying vec3 v_Normal;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec2 a_TexCoord;
layout(location = 3) in vec4 a_TexClip;
layout(location = 4) in vec2 a_TexRepeat;
layout(location = 5) in vec4 a_TexScaleOffset;
layout(location = 6) in vec2 a_TexScroll;
layout(location = 7) in vec3 a_Normal;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_View), Mul(u_Model, vec4(a_Position, 1.0))));
    v_Color = a_Color;
    v_TexCoord = a_TexCoord;
    v_TexClip = a_TexClip;
    v_TexRepeat = a_TexRepeat;
    v_TexScaleOffset = a_TexScaleOffset;
    v_TexScroll = a_TexScroll;
    v_Normal = a_Normal;
}
#endif

#ifdef FRAG
void main() {
    vec4 t_Color = vec4(0.5, 0.5, 0.5, 1);

#ifdef USE_TEXTURE
#ifdef USE_NORMAL
    vec2 tc = Mul(u_View, vec4(v_Normal, 0.0)).xy;
    tc.y *= -1.0;
    tc = tc * v_TexScaleOffset.xy + v_TexScaleOffset.zw;
#else
    vec2 tc = v_TexCoord;
    tc += v_TexScroll * u_Time * 2e-10f;
    tc = fract(tc * v_TexRepeat) / v_TexRepeat;
    tc = clamp(tc, v_TexClip.xz, v_TexClip.yw);
    tc = tc * v_TexScaleOffset.xy + v_TexScaleOffset.zw + u_AnimOffset.xy;
#endif
    t_Color = texture(SAMPLER_2D(u_Texture), tc);
#endif

#ifdef USE_VERTEX_COLOR
    t_Color.rgb *= v_Color.rgb * 2.0f;
    t_Color.a *= v_Color.a;
#endif

#ifdef USE_ALPHA_MASK
    if (t_Color.a < 0.125) {
        discard;
    }
#endif

    gl_FragColor = t_Color;
}
#endif
