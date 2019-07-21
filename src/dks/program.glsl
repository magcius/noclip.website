
precision mediump float;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(row_major, std140) uniform ub_MeshFragParams {
    Mat4x3 u_BoneMatrix[1];
    Mat4x3 u_NormalMatrix[1];
};

uniform sampler2D u_Texture[3];

varying vec4 v_Color;
varying vec2 v_TexCoord[2];
varying vec3 v_NormalWorld;
varying vec3 v_TangentWorld;
varying vec3 v_BitangentWorld;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec4 a_TexCoord;
layout(location = 3) in vec4 a_Normal;
layout(location = 4) in vec4 a_Tangent;
layout(location = 5) in vec4 a_Bitangent;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[0]), vec4(a_Position, 1.0)));
    v_NormalWorld = normalize(Mul(_Mat4x4(u_NormalMatrix[0]), vec4(a_Normal.xyz, 0.0)).xyz);
    v_TangentWorld = normalize(Mul(_Mat4x4(u_NormalMatrix[0]), vec4(a_Tangent.xyz, 0.0)).xyz);
    v_BitangentWorld = normalize(Mul(_Mat4x4(u_NormalMatrix[0]), vec4(a_Bitangent.xyz, 0.0)).xyz);
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

#ifdef USE_BUMPMAP
    vec3 t_Normal = v_NormalWorld.xyz;
    vec3 t_Tangent = normalize(v_TangentWorld.xyz);
    vec3 t_Bitangent = normalize(v_BitangentWorld.xyz);

    // Perturb normal with map.
    vec3 t_LocalNormal = texture2D(u_Texture[1], v_TexCoord[0]).rgb;
    vec3 t_NormalDir = (t_LocalNormal.x * t_Tangent + t_LocalNormal.y * t_Bitangent + t_LocalNormal.z * t_Normal);
#else
    vec3 t_NormalDir = v_NormalWorld;
#endif

    // Basic fake directional.
    vec3 t_LightDirection = normalize(vec3(0.8, -1, 0.5));
    float t_LightIntensity = max(dot(-t_NormalDir, t_LightDirection), 0.0);
    t_Color.rgb *= mix(0.8, 1.5, t_LightIntensity);

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
