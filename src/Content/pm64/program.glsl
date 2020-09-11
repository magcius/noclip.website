
precision mediump float;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    vec4 u_Misc0;
};

#define u_ScreenSize (u_Misc0.xy)
#define u_LodBias (u_Misc0.z)

layout(row_major, std140) uniform ub_DrawParams {
    Mat4x3 u_BoneMatrix[1];
    Mat4x2 u_TexMatrix[2];
};

uniform sampler2D u_Texture[2];

varying vec4 v_Color;
varying vec4 v_TexCoord;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec2 a_TexCoord;

vec3 Monochrome(vec3 t_Color) {
    // NTSC primaries.
    return vec3(dot(t_Color.rgb, vec3(0.299, 0.587, 0.114)));
}

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[0]), vec4(a_Position, 1.0)));
    v_Color = a_Color;

#ifdef USE_MONOCHROME_VERTEX_COLOR
    v_Color.rgb = Monochrome(v_Color.rgb);
#endif

    v_TexCoord.xy = Mul(u_TexMatrix[0], vec4(a_TexCoord, 1.0, 1.0));
    v_TexCoord.zw = Mul(u_TexMatrix[1], vec4(a_TexCoord, 1.0, 1.0));
}
#endif

#ifdef FRAG
vec4 Texture2D_N64_Point(sampler2D t_Texture, vec2 t_TexCoord, float t_LodLevel) {
    return textureLod(t_Texture, t_TexCoord, t_LodLevel);
}

vec4 Texture2D_N64_Average(sampler2D t_Texture, vec2 t_TexCoord, float t_LodLevel) {
    // Unimplemented.
    return textureLod(t_Texture, t_TexCoord, t_LodLevel);
}

// Implements N64-style "triangle bilienar filtering" with three taps.
// Based on ArthurCarvalho's implementation, modified by NEC and Jasper for noclip.
vec4 Texture2D_N64_Bilerp(sampler2D t_Texture, vec2 t_TexCoord, float t_LodLevel) {
    vec2 t_Size = vec2(textureSize(t_Texture, 0));
    vec2 t_Offs = fract(t_TexCoord*t_Size - vec2(0.5));
    t_Offs -= step(1.0, t_Offs.x + t_Offs.y);
    vec4 t_S0 = textureLod(t_Texture, t_TexCoord - t_Offs / t_Size, t_LodLevel);
    vec4 t_S1 = textureLod(t_Texture, t_TexCoord - vec2(t_Offs.x - sign(t_Offs.x), t_Offs.y) / t_Size, t_LodLevel);
    vec4 t_S2 = textureLod(t_Texture, t_TexCoord - vec2(t_Offs.x, t_Offs.y - sign(t_Offs.y)) / t_Size, t_LodLevel);
    return t_S0 + abs(t_Offs.x)*(t_S1-t_S0) + abs(t_Offs.y)*(t_S2-t_S0);
}

vec4 Texture2D_N64(sampler2D t_Texture, vec2 t_TexCoord) {
    vec2 t_Dx = abs(dFdx(t_TexCoord)) * u_ScreenSize;
    float t_Lod = max(t_Dx.x, t_Dx.y);
    float t_LodTile = floor(log2(floor(t_Lod)));
    float t_LodFrac = fract(t_Lod/pow(2.0, t_LodTile));
    float t_LodLevel = (t_LodTile + t_LodFrac);
    // TODO(jstpierre): Figure out why we need this LOD bias. I don't believe the N64 even supports one...
    t_LodLevel += u_LodBias;

#if defined(USE_TEXTFILT_POINT)
    return Texture2D_N64_Point(t_Texture, t_TexCoord, t_LodLevel);
#elif defined(USE_TEXTFILT_AVERAGE)
    return Texture2D_N64_Average(t_Texture, t_TexCoord, t_LodLevel);
#elif defined(USE_TEXTFILT_BILERP)
    return Texture2D_N64_Bilerp(t_Texture, t_TexCoord, t_LodLevel);
#endif
}

void main() {
    vec4 t_Color = vec4(1.0);

#ifdef USE_TEXTURE

    vec4 t_Texel0 = Texture2D_N64(u_Texture[0], v_TexCoord.xy);

#ifdef USE_2CYCLE_MODE

    vec4 t_Texel1 = Texture2D_N64(u_Texture[1], v_TexCoord.zw);
#if defined(USE_COMBINE_MODULATE)
    t_Color = t_Texel0 * t_Texel1 * v_Color;
#elif defined(USE_COMBINE_DIFFERENCE)
    t_Color.rgb = v_Color.rgb;
    t_Color.a = (t_Texel0.a - t_Texel1.a) * v_Color.a;
#elif defined(USE_COMBINE_INTERP)
    t_Color.rgb = mix(t_Texel0.rgb, t_Texel1.rgb, v_Color.a);
    t_Color.a = t_Texel0.a;
#endif

#else /* USE_2CYCLE_MODE */
    t_Color = t_Texel0 * v_Color;
#endif /* USE_2CYCLE_MODE */

#else /* USE_TEXTURE */
    t_Color = v_Color;
#endif /* USE_TEXTURE */

#ifdef USE_ALPHA_MASK
    if (t_Color.a < 0.0125)
        discard;
#endif

    gl_FragColor = t_Color;
}
#endif
