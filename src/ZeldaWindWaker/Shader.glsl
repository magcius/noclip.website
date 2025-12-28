${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_Params {
    Mat4x4 u_ClipFromLocal;
    Mat4x4 u_LocalFromScreen;
};

layout(location = 0) sampler2D u_TextureShadow;
layout(location = 1) sampler2D u_TextureFramebufferDepth; // Depth buffer


#if defined VERT
layout(location = 0) in vec3 a_Position; // Unit cube coordinates (-0.5 to 0.5).

void main() {
    gl_Position = UnpackMatrix(u_ClipFromLocal) * vec4(a_Position.xyz, 1.0);
}


#elif defined FRAG
void main() {
    vec3 t_ScreenPos;
    t_ScreenPos.xy = gl_FragCoord.xy;
    // Tap the depth buffer to find the intersection point.
    t_ScreenPos.z = texelFetch(SAMPLER_2D(u_TextureFramebufferDepth), ivec2(gl_FragCoord.xy), 0).r;
    // Project back into local object space.
    vec4 t_ObjectPos = UnpackMatrix(u_LocalFromScreen) * t_ScreenPos;
    t_ObjectPos.xyz /= t_WorldPos.www;
    // Now that we have our object-space position, remove any samples outside of the box.
    if (any(lessThan(t_ObjectPos.xyz, vec3(-0.5)) || any(greaterThan(t_ObjectPos.xyz), vec3(0.5)))
        discard;
    // Top-down project our shadow texture. Our local space is between -0.5 and 0.5, we want to move into 0.0 to 1.0.
    vec2 t_ShadowTexCoord = t_ObjectPos.xz + vec2(0.5);
    gl_FragColor = texture(SAMPLER_2D(u_TextureShadow), t_ShadowTexCoord);
}
#endif