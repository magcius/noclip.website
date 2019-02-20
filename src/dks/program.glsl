
precision mediump float;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(row_major, std140) uniform ub_MeshFragParams {
    Mat4x3 u_BoneMatrix[1];
};

uniform sampler2D u_Texture[2];

varying vec4 v_Color;
varying vec2 v_TexCoord[2];

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec4 a_TexCoord;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[0]), vec4(a_Position, 1.0)));
    v_Color = a_Color;
    v_TexCoord[0] = (a_TexCoord.xy) / 1024.0;
    v_TexCoord[1] = (a_TexCoord.zw) / 1024.0;
}
#endif

#ifdef FRAG
void main() {
    vec4 t_Color = vec4(1.0);

    t_Color *= texture2D(u_Texture[0], v_TexCoord[0]);
    t_Color *= v_Color;

#ifdef USE_LIGHTMAP
    t_Color.rgb *= texture2D(u_Texture[1], v_TexCoord[1]).rgb;
#endif

#ifdef USE_ALPHATEST
    if (t_Color.a < 0.1)
        discard;
#endif

    gl_FragColor = t_Color;
}
#endif
