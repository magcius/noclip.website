
precision mediump float;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(row_major, std140) uniform ub_MeshFragParams {
    Mat4x3 u_BoneMatrix[1];
    Mat4x3 u_NormalMatrix[1];
    Mat4x3 u_ModelMatrix[1];
    // Fourth element has g_DiffuseMapColorPower
    vec4 u_DiffuseMapColor;
    vec4 u_TexScroll[3];
};

uniform sampler2D u_Texture[5];

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

#define UNORM_TO_SNORM(xyz) ((xyz - 0.5) * 2.0)

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[0]), vec4(a_Position, 1.0)));
    v_NormalWorld = normalize(Mul(_Mat4x4(u_NormalMatrix[0]), vec4(UNORM_TO_SNORM(a_Normal.xyz), 0.0)).xyz);
    v_TangentWorld = normalize(Mul(_Mat4x4(u_ModelMatrix[0]), vec4(UNORM_TO_SNORM(a_Tangent.xyz), 0.0)).xyz);
    v_BitangentWorld = normalize(Mul(_Mat4x4(u_ModelMatrix[0]), vec4(UNORM_TO_SNORM(a_Bitangent.xyz), 0.0)).xyz);
    v_Color = a_Color;
    v_TexCoord[0] = ((a_TexCoord.xy) / 1024.0) + u_TexScroll[0].xy;
    v_TexCoord[1] = ((a_TexCoord.zw) / 1024.0) + u_TexScroll[1].xy;
}
#endif

#ifdef FRAG
void main() {
    vec4 t_Color = vec4(1.0);

    vec4 t_Diffuse1 = texture2D(u_Texture[0], v_TexCoord[0]);

#ifdef USE_DIFFUSE_2
    vec4 t_Diffuse2 = texture2D(u_Texture[2], v_TexCoord[0]);
    vec4 t_Diffuse = mix(t_Diffuse1, t_Diffuse2, v_Color.a);
#else
    vec4 t_Diffuse = t_Diffuse1;
#endif

    t_Diffuse.rgb = t_Diffuse.rgb * u_DiffuseMapColor.rgb * u_DiffuseMapColor.w;

    t_Color *= t_Diffuse;
    t_Color *= v_Color;

#ifdef USE_BUMPMAP
    vec3 t_Normal = v_NormalWorld.xyz;
    vec3 t_Tangent = v_TangentWorld.xyz;
    vec3 t_Bitangent = v_BitangentWorld.xyz;

    // Perturb normal with map.
    vec3 t_Bumpmap1 = texture2D(u_Texture[1], v_TexCoord[0]).rgb;

#ifdef USE_BUMPMAP_2
    vec3 t_Bumpmap2 = texture2D(u_Texture[3], v_TexCoord[0]).rgb;
    vec3 t_LocalNormal = mix(t_Bumpmap1, t_Bumpmap2, v_Color.a);
#else
    vec3 t_LocalNormal = t_Bumpmap1;
#endif

    vec3 t_NormalDir = (t_LocalNormal.x * t_Tangent + t_LocalNormal.y * t_Bitangent + t_LocalNormal.z * t_Normal);
#else
    vec3 t_NormalDir = v_NormalWorld;
#endif

#ifdef USE_LIGHTING
    vec3 t_DirectIrradiance = vec3(1.0);

    // Basic fake directional.
    vec3 t_LightDirection = normalize(vec3(0.8, -1, 0.5));
    t_DirectIrradiance *= mix(0.0, 2.0, max(dot(-t_NormalDir, t_LightDirection), 0.0));

#ifdef USE_LIGHTMAP
    t_DirectIrradiance *= texture2D(u_Texture[4], v_TexCoord[1]).rgb;
#endif

    // Add in some fake ambient.
    t_DirectIrradiance += 0.5;

    t_Color.rgb *= t_DirectIrradiance;
#endif

#ifdef USE_ALPHATEST
    if (t_Color.a < 0.1)
        discard;
#endif

    // Convert to gamma-space
    t_Color.rgb = pow(t_Color.rgb, vec3(1.0 / 2.2));

    gl_FragColor = t_Color;
}
#endif
