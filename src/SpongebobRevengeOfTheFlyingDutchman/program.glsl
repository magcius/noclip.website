struct DirectionalLight {
    vec3 direction;
    vec3 color;
    vec3 ambient;
};

struct OmniLight {
    vec4 position;
    vec4 color;
    vec4 attenuation;
};

struct HFog {
    Mat4x4 transform;
    vec4 color;
};

#define NUM_OMNI_LIGHTS 4

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(std140) uniform ub_MaterialParams {
    Mat4x3 u_ModelView;
    Mat4x3 u_View;
    vec4 u_Color;
    vec4 u_Emit;
    Mat4x2 u_TexTransform;
};

layout(std140) uniform ub_InstanceParams {
    DirectionalLight u_light;
    HFog u_hFog;
    OmniLight u_omni[NUM_OMNI_LIGHTS];
};

uniform sampler2D u_Texture;
uniform sampler2D u_TextureReflection;

varying vec2 v_TexCoord;
varying vec4 v_WorldPosition;
varying vec3 v_LightColor;
varying vec3 v_ClipNormal;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec2 a_TexCoord;
layout(location = 2) in vec3 a_Normal;

void main() {
    v_WorldPosition = Mul(_Mat4x4(u_ModelView), vec4(a_Position, 1.0));
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_View), vec4(a_Position, 1.0)));
    v_TexCoord = Mul(_Mat4x4(u_TexTransform), vec4(a_TexCoord.xy, 1.0, 1.0)).xy;
    vec3 worldNormal = normalize(Mul(_Mat4x4(u_ModelView), vec4(a_Normal, 0.0)).xyz);
    v_ClipNormal = normalize(Mul(_Mat4x4(u_View), vec4(worldNormal, 0.0)).xyz);
    // AMBIENT
    v_LightColor = u_light.ambient;
    // DIFFUSE
    float lightDot = max(0.0, dot(worldNormal, u_light.direction));
    v_LightColor += lightDot * u_light.color;
    // OMNI
    for (int i = 0; i < 4; i++) {
        OmniLight omni = u_omni[i];
        if (omni.color.a > 0.0) {
            vec3 diff = omni.position.xyz - v_WorldPosition.xyz;
            vec3 lightDirection = normalize(diff);
            float minrange = omni.attenuation[0];
            float maxrange = omni.attenuation[1] - minrange;
            float dist = max(0.0, length(diff) - minrange);
            vec4 color = omni.color;
            float att = clamp(maxrange/dist, 0.0, 1.0);
            v_LightColor += color.rgb * att * max(0.0, dot(worldNormal, lightDirection));
        }
    }
}
#endif

#ifdef FRAG
void main() {
    vec4 texcol = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    vec3 surfacecol = texcol.rgb * u_Color.rgb;
    float alpha = texcol.a * u_Color.a;
    // SPECULAR
    vec3 reflectLight = normalize(reflect(u_light.direction, v_ClipNormal));
    vec4 reflectionColor = texture(SAMPLER_2D(u_TextureReflection), reflectLight.xy);
    // APPLY
    gl_FragColor = vec4(surfacecol * v_LightColor + reflectionColor.rgb, alpha);
    // FOG
    if (u_hFog.color.a > 0.0) {
        vec4 fogPos = Mul(u_hFog.transform, v_WorldPosition);
        float fogAmount = clamp(1.0 - fogPos.y, 0.0, 1.0);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, u_hFog.color.rgb, fogAmount * u_hFog.color.a);
    }
    // EMIT
    gl_FragColor.rgb += texcol.rgb * u_Emit.rgb;
}
#endif
