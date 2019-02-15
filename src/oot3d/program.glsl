
precision mediump float;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    mat4 u_Projection;
};

// Expected to change with each material.
layout(row_major, std140) uniform ub_MaterialParams {
    vec4 u_MaterialColor;
    mat4x3 u_TexMtx[3];
    vec4 u_MaterialMisc[1];
};

#define u_AlphaReference (u_MaterialMisc[0][0])

layout(row_major, std140) uniform ub_PrmParams {
    mat4x3 u_BoneMatrix[1];
    vec4 u_PrmMisc[1];
};

uniform sampler2D u_Texture[3];

#define u_PosScale (u_PrmMisc[0].x)
#define u_TexCoord0Scale (u_PrmMisc[0].y)
#define u_TexCoord1Scale (u_PrmMisc[0].z)
#define u_TexCoord2Scale (u_PrmMisc[0].w)

varying vec4 v_Color;
varying vec2 v_TexCoord0;
varying vec2 v_TexCoord1;
varying vec2 v_TexCoord2;
varying float v_LightIntensity;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 3) in vec4 a_Color;
layout(location = 4) in vec2 a_TexCoord0;
layout(location = 5) in vec2 a_TexCoord1;
layout(location = 6) in vec2 a_TexCoord2;

void main() {
    vec4 t_Position = vec4(a_Position * u_PosScale, 1.0);
    gl_Position = u_Projection * mat4(u_BoneMatrix[0]) * t_Position;

    v_Color = a_Color;

    vec2 t_TexCoord0 = a_TexCoord0 * u_TexCoord0Scale;
    v_TexCoord0 = (u_TexMtx[0] * vec4(t_TexCoord0, 0.0, 1.0)).st;
    v_TexCoord0.t = 1.0 - v_TexCoord0.t;

    vec2 t_TexCoord1 = a_TexCoord1 * u_TexCoord1Scale;
    v_TexCoord1 = (u_TexMtx[1] * vec4(t_TexCoord1, 0.0, 1.0)).st;
    v_TexCoord1.t = 1.0 - v_TexCoord1.t;

    vec2 t_TexCoord2 = a_TexCoord2 * u_TexCoord2Scale;
    v_TexCoord2 = (u_TexMtx[2] * vec4(t_TexCoord2, 0.0, 1.0)).st;
    v_TexCoord2.t = 1.0 - v_TexCoord2.t;

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

    // TODO(jstpierre): Figure out the different textures in use.
#ifdef USE_TEXTURE_0
    t_Color *= texture2D(u_Texture[0], v_TexCoord0);
#endif

#ifdef USE_TEXTURE_1
    t_Color *= texture2D(u_Texture[1], v_TexCoord0);
#endif

#ifdef USE_TEXTURE_2
    t_Color *= texture2D(u_Texture[2], v_TexCoord0);
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
