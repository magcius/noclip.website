
precision mediump float;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(row_major, std140) uniform ub_ModelParams {
    Mat4x3 u_BoneMatrix[1];
    vec4 u_Color;
};

uniform sampler2D u_Texture[1];

varying vec3 v_Normal;
varying vec2 v_TexCoord;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in vec2 a_TexCoord;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[0]), vec4(a_Position, 1.0)));
    v_Normal = Mul(_Mat4x4(u_BoneMatrix[0]), vec4(a_Normal, 0.0)).xyz;
    v_TexCoord = a_TexCoord;
}
#endif

#ifdef FRAG
void main() {
    vec4 t_Color = vec4(1.0);

    t_Color = texture(u_Texture[0], v_TexCoord);

    vec3 t_LightDirection = normalize(vec3(.2, -1, .5));
    float t_LightIntensity = mix(0.5, 0.9, dot(t_LightDirection, v_Normal));
    t_Color.rgb *= t_LightIntensity;

    t_Color.rgba *= u_Color.rgba;

    // TODO(jstpierre): Configurable alpha ref?
    // if (t_Color.a < 0.5)
    //     discard;

    gl_FragColor = t_Color;
}
#endif
