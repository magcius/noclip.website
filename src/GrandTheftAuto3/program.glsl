
precision mediump float;
precision lowp sampler2DArray;

layout(std140, row_major) uniform ub_SceneParams {
    mat4 u_Projection;
    mat4x3 u_ViewMatrix;
    mat4x3 u_WorldMatrix;
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
    vec3 t_PositionView = u_ViewMatrix * vec4(a_Position, 1.0);
    gl_Position = u_Projection * vec4(t_PositionView, 1.0);
    v_Color = a_Color;
    v_TexCoord = a_TexCoord;
    v_TexScroll = a_TexScroll;
}
#endif
#endif

#ifdef FRAG
#ifdef SKY
void main() {
    gl_FragColor = mix(u_SkyBotColor, u_SkyTopColor, v_Position.y);

    // TODO: get this working again
    vec3 nearPlane = v_Position * u_Frustum.xyz;
    vec3 cameraRay = u_WorldMatrix * vec4(nearPlane, 0.0);
    vec3 cameraPos = u_WorldMatrix * vec4(vec3(0.0), 1.0);
    float elevation = atan(cameraRay.y, length(cameraRay.zx));
    gl_FragColor = mix(u_SkyBotColor, u_SkyTopColor, clamp(abs(elevation / radians(45.0)), 0.0, 1.0));
    gl_FragDepth = 0.0;

    float t = (u_WaterOrigin.y - cameraPos.y) / cameraRay.y;
    vec3 oceanPlane = cameraPos + t * cameraRay;

    vec2 uv = (oceanPlane.zx - u_WaterOrigin.zx) / 32.0;
    vec4 oceanSample = texture(SAMPLER_2DArray(u_Texture), vec3(uv, 0));

    if (t > 0.0 && (abs(oceanPlane.z - u_WaterOrigin.z) >= u_WaterOrigin.w - 32.0 ||
                    abs(oceanPlane.x - u_WaterOrigin.x) >= u_WaterOrigin.w - 32.0)) {
        vec4 t_Color = u_WaterColor;
        t_Color *= oceanSample;
        gl_FragColor = mix(gl_FragColor, t_Color, t_Color.a);

        // slightly overlap water tiles to avoid seam
        vec3 clipOffset = 0.01 * vec3(0, 0, 1);
        vec3 viewSpacePos = (u_ViewMatrix * vec4(oceanPlane, 1.0)) + clipOffset;
        vec4 clipSpacePos = u_Projection * vec4(viewSpacePos, 1.0);
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

    vec3 uv = v_TexCoord;
    if (v_TexScroll.z > 0.0)
        uv.xy += v_TexScroll.xy * fract(u_Time / v_TexScroll.z);
    // Work around naga bug https://github.com/gfx-rs/wgpu/issues/6596
    uv.z = round(uv.z);
    vec4 tex = texture(SAMPLER_2DArray(u_Texture), uv);
    if (v_TexCoord.z >= 0.0)
        t_Color *= tex;

#ifdef ALPHA_TEST
    if (t_Color.a ALPHA_TEST) discard;
#endif
    gl_FragColor = t_Color;
}
#endif
#endif
