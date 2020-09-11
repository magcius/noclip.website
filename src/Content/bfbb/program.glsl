
precision mediump float; precision lowp sampler2D;

struct Light {
    float type;
    float radius;
    float angle;
    float pad;
    vec4 position;
    vec4 direction;
    vec4 color;
};

#define LIGHT_TYPE_AMBIENT     1.0 // rpLIGHTAMBIENT
#define LIGHT_TYPE_DIRECTIONAL 2.0 // rpLIGHTDIRECTIONAL
#define LIGHT_TYPE_POINT       3.0 // rpLIGHTPOINT
#define LIGHT_TYPE_SPOT        4.0 // rpLIGHTSPOTSOFT

#define LIGHT_COUNT 8

layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x3 u_ViewMatrix;
    vec4 u_FogColor;
    vec4 u_FogParams;
    Light u_ObjectLights[LIGHT_COUNT];
    Light u_PlayerLights[LIGHT_COUNT];
};

#define u_FogStart (u_FogParams.x)
#define u_FogStop (u_FogParams.y)

#ifdef PLAYER
#define u_Lights u_PlayerLights
#else
#define u_Lights u_ObjectLights
#endif

layout(row_major, std140) uniform ub_ModelParams {
    Mat4x3 u_ModelMatrix;
    vec4 u_ModelColor;
};

uniform sampler2D u_Texture;

varying vec4 v_Position;
varying vec4 v_Color;
varying vec2 v_TexCoord;
varying vec3 v_LightColor;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in vec4 a_Color;
layout(location = 3) in vec2 a_TexCoord;

void main() {
    v_Position = Mul(u_Projection, Mul(_Mat4x4(u_ViewMatrix), Mul(_Mat4x4(u_ModelMatrix), vec4(a_Position, 1.0))));
    v_Color = a_Color;
    v_TexCoord = a_TexCoord;

    vec3 t_Normal = normalize(Mul(_Mat4x4(u_ModelMatrix), vec4(a_Normal, 0.0)).xyz);

#ifdef USE_LIGHTING
    if (USE_LIGHTING == 1) {
        v_LightColor = vec3(0.0);

        for (int i = 0; i < LIGHT_COUNT; i++) {
            Light light = u_Lights[i];
            if (light.type == 0.0) break;

            vec3 lightColor = light.color.rgb; // alpha is ignored

            if (light.type == LIGHT_TYPE_AMBIENT) {
                v_LightColor += lightColor;
            } else if (light.type == LIGHT_TYPE_DIRECTIONAL) {
                vec3 lightDir = normalize(light.direction.xyz);
                float diffuse = max(dot(t_Normal, lightDir), 0.0);
                v_LightColor += diffuse * lightColor;
                v_LightColor = min(v_LightColor, vec3(1.0));
            }
        }
    }
#endif

    gl_Position = v_Position;
}
#endif

#ifdef FRAG
void main() {
    float t_Distance = abs(v_Position.z);
    if (u_FogColor.a > 0.0 && t_Distance > u_FogStop) discard;

    vec4 t_Color = v_Color;

#ifdef PLAYER
    t_Color.rgb = vec3(1.0, 1.0, 1.0);
#endif

#ifdef USE_TEXTURE
    if (USE_TEXTURE == 1)
        t_Color *= texture(SAMPLER_2D(u_Texture), v_TexCoord);
#endif

    t_Color *= u_ModelColor;

#ifdef ALPHA_REF
    if (t_Color.a <= ALPHA_REF) discard;
#endif

#ifdef USE_LIGHTING
    if (USE_LIGHTING == 1 && u_Lights[0].type != 0.0)
        t_Color *= vec4(v_LightColor, 1.0);
#endif

#ifdef USE_FOG
    if (USE_FOG == 1) {
        if (u_FogColor.w > 0.0) {
            float t_FogFactor = 1.0 - (u_FogStop - t_Distance)/(u_FogStop - u_FogStart);
            t_FogFactor = clamp(t_FogFactor, 0.0, 1.0);

            vec4 t_FogColor = u_FogColor;
            t_FogColor.a = t_Color.a;

            t_Color = mix(t_Color, t_FogColor, t_FogFactor);
        }
    }
#endif

#ifdef SKY
    gl_FragDepth = float(SKY_DEPTH);
#endif

    gl_FragColor = t_Color;
    
}
#endif