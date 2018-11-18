
precision mediump float;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    mat4 u_ViewProjection;
    vec4 u_Misc0;
};

uniform highp sampler2DArray u_MaterialAlb;
uniform highp sampler2DArray u_MaterialCmb;
uniform sampler2D u_MateData;

varying vec2 v_TerrainPosition;
varying vec2 v_AreaLocalPosition;
varying vec3 v_Normal;
varying vec3 v_Bitangent;
varying vec3 v_Tangent;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in vec3 a_Bitangent;
layout(location = 3) in vec2 a_AreaLocalPosition;
layout(location = 4) in vec4 a_GridAttributes;

vec2 ComputeTerrainPosition() {
    return (a_AreaLocalPosition * a_GridAttributes.w) + a_GridAttributes.xy;
}

void main() {
    vec4 t_Position = vec4(a_Position, 1.0);
    t_Position.y *= u_Misc0.x;
    gl_Position = u_ViewProjection * t_Position;

    v_TerrainPosition = ComputeTerrainPosition();
    v_AreaLocalPosition = a_AreaLocalPosition;

    v_Normal = a_Normal;
    v_Bitangent = a_Bitangent;
    v_Tangent = cross(a_Normal, a_Bitangent);
}
#endif

#ifdef FRAG
struct s_VertexProps {
    vec3 LightDirection;
    vec3 LightColor;
    mat3x3 TangentToWorld;
};

vec4 SampleMaterialAlb(int MaterialIndex, vec2 UV) {
    return texture(u_MaterialAlb, vec3(UV, MaterialIndex));
}

vec4 SampleMaterialCmb(int MaterialIndex, vec2 UV) {
    return texture(u_MaterialCmb, vec3(UV, MaterialIndex));
}

vec3 DecodeRGNormalMap(vec2 Input) {
    float Denom = 2.0 / (1.0 + dot(Input, Input));
    return vec3(Input * Denom, Denom - 1.0);
}

vec3 ComputeMaterialLayerColor(s_VertexProps Props, int MaterialIndex, vec2 UV) {
    // Something is probably packed into Alb.w.
    vec3 Alb = SampleMaterialAlb(MaterialIndex, UV).xyz;
    vec4 Cmb = SampleMaterialCmb(MaterialIndex, UV);
    vec3 TangentNormal = DecodeRGNormalMap(Cmb.xy);
    vec3 WorldNormal = Props.TangentToWorld * TangentNormal;
    float LightIntensity = dot(WorldNormal, Props.LightDirection);
    // Cmb.zw... probably roughness and spec??? Not sure.
    return Alb + (Props.LightColor * LightIntensity);
}

vec3 SampleMateGridLayer(s_VertexProps Props, vec4 MateInfo, vec2 UV) {
    return mix(
        ComputeMaterialLayerColor(Props, int(MateInfo.x * 255.0), UV),
        ComputeMaterialLayerColor(Props, int(MateInfo.y * 255.0), UV),
        MateInfo.z
    );
}

vec3 BilinearInterp(vec3 v00, vec3 v10, vec3 v01, vec3 v11, vec2 st) {
    return mix(mix(v00, v10, st.s), mix(v01, v11, st.s), st.t);
}

const float UVScale = (64.0);

vec3 SampleMateGrid(s_VertexProps Props) {
    vec2 GP = v_AreaLocalPosition * 255.0;
    vec4 Mate00 = texelFetch(u_MateData, ivec2(floor(GP.x), floor(GP.y)), 0);
    vec4 Mate10 = texelFetch(u_MateData, ivec2(ceil(GP.x), floor(GP.y)), 0);
    vec4 Mate01 = texelFetch(u_MateData, ivec2(floor(GP.x), ceil(GP.y)), 0);
    vec4 Mate11 = texelFetch(u_MateData, ivec2(ceil(GP.x), ceil(GP.y)), 0);

    vec2 UVCoord = v_TerrainPosition * UVScale;
    vec3 Alb00 = SampleMateGridLayer(Props, Mate00, UVCoord);
    vec3 Alb10 = SampleMateGridLayer(Props, Mate10, UVCoord);
    vec3 Alb01 = SampleMateGridLayer(Props, Mate01, UVCoord);
    vec3 Alb11 = SampleMateGridLayer(Props, Mate11, UVCoord);

    return BilinearInterp(Alb00, Alb10, Alb01, Alb11, fract(GP));
}

vec3 SampleMateGridBasic(s_VertexProps Props) {
    vec2 UVCoord = v_TerrainPosition * UVScale;
    vec2 GP = v_AreaLocalPosition * 255.0;
    vec4 Mate00 = texelFetch(u_MateData, ivec2(floor(GP.x), floor(GP.y)), 0);
    vec3 Alb00 = SampleMateGridLayer(Props, Mate00, UVCoord);
    return Alb00;
}

vec3 DebugGridUV() {
    vec2 TPNorm = (v_TerrainPosition + 16.0) / 32.0;
    return vec3(TPNorm, 1.0);
}

void main() {
    s_VertexProps Props;
    Props.LightDirection = normalize(vec3(.2, -1, .5));
    Props.LightColor = vec3(0.05, 0.05, 0.08);
    Props.TangentToWorld = mat3x3(v_Tangent, v_Bitangent, v_Normal);
    vec3 t_AlbColor = SampleMateGrid(Props);

    vec4 t_Color = vec4(t_AlbColor, 1.0);
    gl_FragColor = t_Color;
}
#endif
