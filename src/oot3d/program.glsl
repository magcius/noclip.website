
precision mediump float;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    mat4 u_Projection;
};

// Expected to change with each material.
layout(row_major, std140) uniform ub_MaterialParams {
    vec4 u_MaterialColor;
    mat4x3 u_TexMtx[1];
    vec4 u_MaterialMisc[1];
};

#define u_AlphaReference (u_MaterialMisc[0][0])

layout(row_major, std140) uniform ub_PrmParams {
    mat4x3 u_BoneMatrix[1];
    vec4 u_PrmMisc[1];
};

uniform sampler2D u_Texture[1];

#define u_PosScale (u_PrmMisc[0][0])
#define u_TexCoordScale (u_PrmMisc[0][1])

varying vec4 v_Color;
varying vec2 v_TexCoord;
varying float v_LightIntensity;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in vec4 a_Color;
layout(location = 3) in vec2 a_TexCoord;

void main() {
    vec4 t_Position = vec4(a_Position * u_PosScale, 1.0);
    gl_Position = u_Projection * mat4(u_BoneMatrix[0]) * t_Position;

    v_Color = a_Color;

    vec2 t_TexCoord = a_TexCoord * u_TexCoordScale;
    v_TexCoord = (u_TexMtx[0] * vec4(t_TexCoord, 0.0, 1.0)).st;
    v_TexCoord.t = 1.0 - v_TexCoord.t;

    vec3 t_LightDirection = normalize(vec3(.2, -1, .5));
    // Disable normals for now until I can solve them.
    v_LightIntensity = 1.0;
    // v_LightIntensity = dot(-a_Normal, t_LightDirection);

    // Hacky Ambient.
    v_Color.rgb = clamp(v_Color.rgb + 0.3, vec3(0), vec3(1));
    v_LightIntensity = clamp(v_LightIntensity + 0.6, 0.0, 1.0);
}
#endif

#ifdef FRAG
void main() {
    vec4 t_Color = vec4(1.0, 1.0, 1.0, 1.0);

#ifdef USE_TEXTURE
    t_Color *= texture2D(u_Texture[0], v_TexCoord);
#endif

#ifdef USE_VERTEX_COLOR
    t_Color *= v_Color;
#endif

    t_Color.rgb *= v_LightIntensity;
    t_Color *= u_MaterialColor;

    if (t_Color.a <= u_AlphaReference)
        discard;

    gl_FragColor = t_Color;
}
#endif
