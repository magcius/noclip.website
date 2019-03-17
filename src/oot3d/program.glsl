
precision mediump float;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

// Expected to change with each material.
layout(row_major, std140) uniform ub_MaterialParams {
    vec4 u_MaterialColor;
    Mat4x3 u_TexMtx[3];
    vec4 u_MaterialMisc[1];
};

#define u_AlphaReference (u_MaterialMisc[0][0])

layout(row_major, std140) uniform ub_PrmParams {
    Mat4x3 u_BoneMatrix[16];
    vec4 u_PrmMisc[2];
};

#define u_PosScale (u_PrmMisc[0].x)
#define u_TexCoord0Scale (u_PrmMisc[0].y)
#define u_TexCoord1Scale (u_PrmMisc[0].z)
#define u_TexCoord2Scale (u_PrmMisc[0].w)
#define u_BoneWeightScale (u_PrmMisc[1].x)
#define u_BoneDimension   (u_PrmMisc[1].y)

uniform sampler2D u_Texture[3];

varying vec4 v_Color;
varying vec4 v_Position;
varying vec3 v_Normal;
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
layout(location = 7) in vec4 a_BoneIndices;
layout(location = 8) in vec4 a_BoneWeights;

vec3 Monochrome(vec3 t_Color) {
    // NTSC primaries.
    return vec3(dot(t_Color.rgb, vec3(0.299, 0.587, 0.114)));
}

void main() {
    // Compute our matrix.
    Mat4x3 t_BoneMatrix;

    vec4 t_BoneWeights = a_BoneWeights * u_BoneWeightScale;

    // Mask off bone dimension.
    if (u_BoneDimension == 0.0)
        t_BoneWeights.xyzw = vec4(0.0);
    else if (u_BoneDimension == 1.0)
        t_BoneWeights.yzw  = vec3(0.0);
    else if (u_BoneDimension == 2.0)
        t_BoneWeights.zw   = vec2(0.0);

    if ((t_BoneWeights.x + t_BoneWeights.y + t_BoneWeights.z + t_BoneWeights.w) > 0.0) {
        t_BoneMatrix = _Mat4x3(0.0);

        Fma(t_BoneMatrix, u_BoneMatrix[int(a_BoneIndices.x)], t_BoneWeights.x);
        Fma(t_BoneMatrix, u_BoneMatrix[int(a_BoneIndices.y)], t_BoneWeights.y);
        Fma(t_BoneMatrix, u_BoneMatrix[int(a_BoneIndices.z)], t_BoneWeights.z);
        Fma(t_BoneMatrix, u_BoneMatrix[int(a_BoneIndices.w)], t_BoneWeights.w);
    } else {
        // If we have no bone weights, then we're in rigid skinning, so take the first bone index.
        // If we're single-bone, then our bone indices will be 0, so this also works for that.
        t_BoneMatrix = u_BoneMatrix[int(a_BoneIndices.x)];
    }

    vec4 t_Position = vec4(a_Position * u_PosScale, 1.0);
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(t_BoneMatrix), t_Position));

    v_Position = gl_Position;

    v_Color = a_Color;

#ifdef USE_MONOCHROME_VERTEX_COLOR
    v_Color.rgb = Monochrome(v_Color.rgb);
#endif

    vec2 t_TexCoord0 = a_TexCoord0 * u_TexCoord0Scale;
    v_TexCoord0 = Mul(u_TexMtx[0], vec4(t_TexCoord0, 0.0, 1.0)).st;
    v_TexCoord0.t = 1.0 - v_TexCoord0.t;

    vec2 t_TexCoord1 = a_TexCoord1 * u_TexCoord1Scale;
    v_TexCoord1 = Mul(u_TexMtx[1], vec4(t_TexCoord1, 0.0, 1.0)).st;
    v_TexCoord1.t = 1.0 - v_TexCoord1.t;

    vec2 t_TexCoord2 = a_TexCoord2 * u_TexCoord2Scale;
    v_TexCoord2 = Mul(u_TexMtx[2], vec4(t_TexCoord2, 0.0, 1.0)).st;
    v_TexCoord2.t = 1.0 - v_TexCoord2.t;

    vec3 t_LightDirection = normalize(vec3(.2, -1, .5));
    // Disable normals for now until I can solve them.
    v_LightIntensity = 1.0;
    // v_LightIntensity = dot(-a_Normal, t_LightDirection);

    v_Normal = a_Normal;

    // Hacky Ambient.
    //v_Color.rgb = clamp(v_Color.rgb + 0.3, vec3(0), vec3(1));
    //v_LightIntensity = clamp(v_LightIntensity + 0.6, 0.0, 1.0);
}
#endif

#ifdef FRAG

#endif
