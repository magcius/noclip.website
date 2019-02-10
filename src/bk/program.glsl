
precision mediump float;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    mat4 u_Projection;
};

layout(row_major, std140) uniform ub_DrawParams {
    mat4x3 u_BoneMatrix[1];
    mat4x2 u_TexMatrix[2];
};

uniform sampler2D u_Texture[2];

varying vec4 v_Color;
varying vec4 v_TexCoord;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec2 a_TexCoord;

void main() {
    gl_Position = u_Projection * mat4(u_BoneMatrix[0]) * vec4(a_Position, 1.0);
    v_Color = a_Color;
    v_TexCoord.xy = (u_TexMatrix[0] * vec4(a_TexCoord, 1.0, 1.0));
    v_TexCoord.zw = (u_TexMatrix[1] * vec4(a_TexCoord, 1.0, 1.0));
}
#endif

#ifdef FRAG
// Implements N64-style "triangle bilienar filtering" with three taps.
// Based on ArthurCarvalho's implementation, modified by NEC and Jasper for noclip.
vec4 Texture2D_N64Bilinear(sampler2D t_Texture, vec2 t_TexCoord)
{
    vec2 t_Size = vec2(textureSize(t_Texture, 0));
    vec2 t_Offs = fract(t_TexCoord*t_Size - vec2(0.5));
    t_Offs -= step(1.0, t_Offs.x + t_Offs.y);
    vec4 t_S0 = texture(t_Texture, t_TexCoord - t_Offs / t_Size);
    vec4 t_S1 = texture(t_Texture, t_TexCoord - vec2(t_Offs.x - sign(t_Offs.x), t_Offs.y) / t_Size);
    vec4 t_S2 = texture(t_Texture, t_TexCoord - vec2(t_Offs.x, t_Offs.y - sign(t_Offs.y)) / t_Size);
    return t_S0 + abs(t_Offs.x)*(t_S1-t_S0) + abs(t_Offs.y)*(t_S2-t_S0);
}

void main() {
    vec4 t_Color = vec4(1.0);

#ifdef USE_TEXTURE
    t_Color *= Texture2D_N64Bilinear(u_Texture[0], v_TexCoord.xy);
#endif

#ifdef USE_VERTEX_COLOR
    t_Color.rgba *= v_Color.rgba;
#endif

#ifdef USE_ALPHA_MASK
    if (t_Color.a < 0.0125)
        discard;
#endif

    gl_FragColor = t_Color;
}
#endif
