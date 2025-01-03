
precision mediump float;

// Expected to be constant across the entire scene.
layout(std140, row_major) uniform ub_SceneParams {
    mat4 u_ProjectionView;
    float u_Time;
};

layout(std140, row_major) uniform ub_DrawParams {
    mat4x3 u_Model;
    vec4 u_AnimOffset;
};

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_TexCoord;
varying vec4 v_TexClip;
varying vec2 v_TexRepeat;
varying vec4 v_TexScaleOffset;
varying vec2 v_TexScroll;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec2 a_TexCoord;
layout(location = 3) in vec4 a_TexClip;
layout(location = 4) in vec2 a_TexRepeat;
layout(location = 5) in vec4 a_TexScaleOffset;
layout(location = 6) in vec2 a_TexScroll;

void main() {
    vec3 t_PositionWorld = u_Model * vec4(a_Position, 1.0);
    gl_Position = u_ProjectionView * vec4(t_PositionWorld, 1.0);
    v_Color = a_Color;
    v_TexCoord = a_TexCoord;
    v_TexClip = a_TexClip;
    v_TexRepeat = a_TexRepeat;
    v_TexScaleOffset = a_TexScaleOffset;
    v_TexScroll = a_TexScroll;
}
#endif

#ifdef FRAG
void main() {
    vec4 t_Color = vec4(0.5, 0.5, 0.5, 1);

#ifdef USE_TEXTURE
    vec2 tc = v_TexCoord;
    tc += v_TexScroll * u_Time * 0.000005f + u_AnimOffset.xy;
    tc = fract(tc * v_TexRepeat) / v_TexRepeat;
    tc = clamp(tc, v_TexClip.xz + u_AnimOffset.xy, v_TexClip.yw + u_AnimOffset.xy);
    tc = tc * v_TexScaleOffset.xy + v_TexScaleOffset.zw;
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
