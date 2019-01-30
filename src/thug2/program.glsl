
precision mediump float;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    mat4 u_Projection;
};

layout(row_major, std140) uniform ub_MaterialParams {
    vec4 u_Misc0;
};
#define u_AlphaRef (u_Misc0[0])

layout(row_major, std140) uniform ub_MeshParams {
    mat4x3 u_BoneMatrix[1];
};

uniform sampler2D u_Texture[4];

varying vec4 v_Color;
varying vec2 v_TexCoord[2];

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec4 a_TexCoord;

void main() {
    gl_Position = u_Projection * mat4(u_BoneMatrix[0]) * vec4(a_Position, 1.0);
    v_Color = a_Color;
    v_TexCoord[0] = (a_TexCoord.xy);
    v_TexCoord[1] = (a_TexCoord.zw);
}
#endif

#ifdef FRAG
void main() {
    vec4 t_Color = vec4(1.0);

    t_Color *= texture2D(u_Texture[0], v_TexCoord[0]);

    // Dumb ambient.
    t_Color.rgb += vec3(0.5);

#ifdef USE_VERTEX_COLOR
    t_Color *= v_Color;
#endif

#ifdef USE_ALPHATEST
    if (t_Color.a < u_AlphaRef)
        discard;
#endif

    gl_FragColor = t_Color;
}
#endif
