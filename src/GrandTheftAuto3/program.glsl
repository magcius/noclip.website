
precision mediump float;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(row_major, std140) uniform ub_MeshFragParams {
    Mat4x3 u_BoneMatrix[1];
    vec4 u_Color;
};

uniform sampler2D u_Texture[1];

varying vec4 v_Color;
varying vec2 v_TexCoord;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec2 a_TexCoord;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[0]), vec4(a_Position, 1.0)));
    v_Color = a_Color;
    v_TexCoord = a_TexCoord;
}
#endif

#ifdef FRAG
void main() {
    vec4 t_Color = vec4(1);

#ifdef USE_VERTEX_COLOR
    t_Color *= v_Color;
#endif

    t_Color.rgb += 0.1; // TODO: ambient lighting

    t_Color *= u_Color;

#ifdef USE_TEXTURE
    t_Color *= texture2D(u_Texture[0], v_TexCoord);
#endif

    if (t_Color.a < 1.0/255.0) discard;

    gl_FragColor = t_Color;
}
#endif
