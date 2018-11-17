
precision mediump float;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    mat4 u_Projection;
};

layout(row_major, std140) uniform ub_AreaParams {
    mat4x3 u_ModelView;
};

uniform highp sampler2DArray u_MaterialAlb;
uniform highp sampler2DArray u_MaterialCmb;
uniform sampler2D u_MateData;

varying float v_LightIntensity;
varying vec2 v_GridPosition;
varying vec3 v_Normal;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;

void main() {
    vec4 t_Position = vec4(a_Position, 1.0);
    gl_Position = u_Projection * mat4(u_ModelView) * t_Position;

    vec3 t_LightDirection = normalize(vec3(.2, -1, .5));
    v_GridPosition = a_Position.xz;
    v_LightIntensity = max(0.0, dot(-a_Normal, t_LightDirection));
    v_Normal = a_Normal;
}
#endif

#ifdef FRAG
vec4 SampleMaterialAlb(int MaterialIndex, vec2 UV) {
    return texture(u_MaterialAlb, vec3(UV, MaterialIndex));
}

vec4 SampleMateGridAlb(vec4 MateInfo, vec2 UV) {
    return mix(SampleMaterialAlb(int(MateInfo.x * 255.0), UV), SampleMaterialAlb(int(MateInfo.y * 255.0), UV), MateInfo.z);
}

vec4 BilinearInterp(vec4 v00, vec4 v10, vec4 v01, vec4 v11, vec2 st) {
    return mix(mix(v00, v10, st.s), mix(v01, v11, st.s), st.t);
}

vec4 SampleMateGrid(vec2 GP) {
    vec4 Mate00 = texelFetch(u_MateData, ivec2(floor(GP.x), floor(GP.y)), 0);
    vec4 Mate10 = texelFetch(u_MateData, ivec2(ceil(GP.x), floor(GP.y)), 0);
    vec4 Mate01 = texelFetch(u_MateData, ivec2(floor(GP.x), ceil(GP.y)), 0);
    vec4 Mate11 = texelFetch(u_MateData, ivec2(ceil(GP.x), ceil(GP.y)), 0);
    vec2 GridFrac = fract(GP);

    vec4 Alb00 = SampleMateGridAlb(Mate00, GridFrac);
    vec4 Alb10 = SampleMateGridAlb(Mate10, GridFrac);
    vec4 Alb01 = SampleMateGridAlb(Mate01, GridFrac);
    vec4 Alb11 = SampleMateGridAlb(Mate11, GridFrac);

    return BilinearInterp(Alb00, Alb10, Alb01, Alb11, GridFrac);
}

void main() {
    vec4 t_AlbColor = SampleMateGrid(v_GridPosition);

    vec4 t_Color = t_AlbColor;
    t_Color.rgb += 0.4 * v_LightIntensity;
    t_Color.rgb += vec3(0.10);
    gl_FragColor = t_Color;
}
#endif
