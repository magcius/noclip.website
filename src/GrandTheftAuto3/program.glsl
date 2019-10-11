
precision mediump float; precision lowp sampler2DArray;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    vec4 u_AmbientColor;
};

layout(row_major, std140) uniform ub_MeshFragParams {
    Mat4x3 u_ViewMatrix;
    float alphaThreshold;
};

uniform sampler2DArray u_Texture;

varying vec4 v_Color;
varying vec3 v_TexCoord;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec3 a_TexCoord;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ViewMatrix), vec4(a_Position, 1.0)));
    v_Color = a_Color;
    v_TexCoord = a_TexCoord;
}
#endif

#ifdef FRAG
void main() {
    vec4 t_Color = v_Color;
    t_Color.rgb += u_AmbientColor.rgb;
    if (v_TexCoord.z >= 0.0)
        t_Color *= texture(u_Texture, v_TexCoord);
    if (alphaThreshold >= 0.0 ? t_Color.a < alphaThreshold : t_Color.a >= -alphaThreshold) discard;
    gl_FragColor = t_Color;
}
#endif
