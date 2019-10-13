
precision mediump float; precision lowp sampler2DArray;

layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    vec4 u_AmbientColor;
};

layout(row_major, std140) uniform ub_MeshFragParams {
    Mat4x3 u_ViewMatrix;
#ifdef SKY
    Mat4x3 u_WorldMatrix;
    vec4 u_Frustum;
#else
    float alphaThreshold;
#endif
};

uniform sampler2DArray u_Texture;

#ifdef SKY
varying vec3 v_Position;
#else
varying vec4 v_Color;
varying vec3 v_TexCoord;
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

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ViewMatrix), vec4(a_Position, 1.0)));
    v_Color = a_Color;
    v_TexCoord = a_TexCoord;
}
#endif
#endif

#ifdef FRAG
#ifdef SKY
void main() {
    vec3 nearPlane = v_Position * u_Frustum.xyz;
    vec3 cameraRay = Mul(u_WorldMatrix, vec4(nearPlane, 0.0));
    vec3 cameraPos = Mul(u_WorldMatrix, vec4(vec3(0.0), 1.0));
    float t = -cameraPos.y / cameraRay.y;

    if (t > 0.0) {
        vec3 oceanPlane = cameraPos + t * cameraRay;
        vec2 uv = fract(oceanPlane.zx / 32.0);
        if (abs(oceanPlane.z) < 2000.0 && abs(oceanPlane.x) < 2000.0) discard;

        vec4 t_Color = vec4(100.0 / 255.0, 100.0 / 255.0, 107.0 / 255.0, 1.0);
        t_Color.rgb += u_AmbientColor.rgb;
        t_Color *= texture(u_Texture, vec3(uv, 0));
        gl_FragColor = t_Color;
    } else {
        discard;
    }
}
#else
void main() {
    vec4 t_Color = v_Color;
    t_Color.rgb += u_AmbientColor.rgb;
    if (v_TexCoord.z >= 0.0)
        t_Color *= texture(u_Texture, v_TexCoord);
    if (alphaThreshold >= 0.0 ? t_Color.a < alphaThreshold : t_Color.a >= -alphaThreshold) discard;
    gl_FragColor = t_Color;
}
#endif
#endif
