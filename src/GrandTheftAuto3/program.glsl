
precision mediump float; precision lowp sampler2DArray;

layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x3 u_ViewMatrix;
    Mat4x3 u_WorldMatrix;
    vec4 u_Frustum;
    vec4 u_AmbientColor;
    vec4 u_SkyTopColor;
    vec4 u_SkyBotColor;
    vec4 u_WaterColor;
    vec4 u_WaterOrigin;
    float u_Time;
};

uniform sampler2DArray u_Texture;

#ifdef SKY
varying vec3 v_Position;
#else
varying vec4 v_Color;
varying vec3 v_TexCoord;
varying vec3 v_TexScroll;
#endif

#ifdef VERT
layout(location = 0) in vec3 a_Position;
#ifdef SKY
void main() {
    gl_Position = vec4(a_Position, 1.0);
    v_Position = a_Position;
}
#else
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec3 a_TexCoord;
layout(location = 3) in vec3 a_TexScroll;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ViewMatrix), vec4(a_Position, 1.0)));
    v_Color = a_Color;
    v_TexCoord = a_TexCoord;
    v_TexScroll = a_TexScroll;
}
#endif
#endif

#ifdef FRAG
#ifdef SKY
void main() {
    vec3 nearPlane = v_Position * u_Frustum.xyz;
    vec3 cameraRay = Mul(u_WorldMatrix, vec4(nearPlane, 0.0));
    vec3 cameraPos = Mul(u_WorldMatrix, vec4(vec3(0.0), 1.0));
    float elevation = atan(cameraRay.y, length(cameraRay.zx)) * 180.0 / radians(180.0);
    gl_FragColor = mix(u_SkyBotColor, u_SkyTopColor, clamp(abs(elevation / 45.0), 0.0, 1.0));
    gl_FragDepth = 0.0;

    float t = (u_WaterOrigin.y - cameraPos.y) / cameraRay.y;
    vec3 oceanPlane = cameraPos + t * cameraRay;
    if (t > 0.0 && (abs(oceanPlane.z - u_WaterOrigin.z) >= u_WaterOrigin.w - 32.0 ||
                    abs(oceanPlane.x - u_WaterOrigin.x) >= u_WaterOrigin.w - 32.0)) {
        vec2 uv = (oceanPlane.zx - u_WaterOrigin.zx) / 32.0;
        vec4 t_Color = u_WaterColor;
        t_Color *= texture(SAMPLER_2D(u_Texture), vec3(uv, 0));
        gl_FragColor = mix(gl_FragColor, t_Color, t_Color.a);

        // slightly overlap water tiles to avoid seam
        vec4 clipOffset = 0.01 * vec4(0,0,1,0);
        vec4 clipSpacePos = Mul(u_Projection, Mul(_Mat4x4(u_ViewMatrix), vec4(oceanPlane, 1.0)) + clipOffset);
        float depthNDC = clipSpacePos.z / clipSpacePos.w;
        gl_FragDepth = 0.5 + 0.5 * depthNDC;
    }
}
#else
void main() {
#ifdef WATER
    vec4 t_Color = u_WaterColor;
#else
    vec4 t_Color = v_Color;
    t_Color.rgb += u_AmbientColor.rgb;
#endif

    if (v_TexCoord.z >= 0.0) {
        vec3 uv = v_TexCoord;
        if (v_TexScroll.z > 0.0)
            uv.xy += v_TexScroll.xy * fract(u_Time / v_TexScroll.z);
        t_Color *= texture(SAMPLER_2D(u_Texture), uv);
    }

#ifdef ALPHA_TEST
    if (t_Color.a ALPHA_TEST) discard;
#endif
    gl_FragColor = t_Color;
}
#endif
#endif
