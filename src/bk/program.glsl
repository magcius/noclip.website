
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
void main() {
    vec4 t_Color = vec4(1.0);

#ifdef USE_TEXTURE
    t_Color *= texture2D(u_Texture[0], v_TexCoord.xy);
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
