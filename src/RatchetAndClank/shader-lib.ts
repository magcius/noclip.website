import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";

export const RatchetShaderLib = {
    SceneParamsSizeInFloats: [
        16, // camera transform
        12, // camera data
        4, // lod settings
        4, // render settings
        4, // background color
        12, // fog params
        16 * 16, // directional lights
        4 * 256 * 3, // texture remaps (3 arrays of 256 vec4s)
    ].reduce((a, b) => a + b, 0),
    SceneParams: `

// size 12
struct CameraData {
    vec4 position;
    vec4 direction;
    vec4 extras; // x = near, y = far, z = isOrtho
};

// size 12
struct FogParams {
    vec4 color;
    vec4 distanceNearFar; // x = near, y = far
    vec4 intensityNearFar; // x = near intensity, y = far intensity
};

// size 16
struct DirectionLight {
    vec4 directionA;
    vec4 colorA;
    vec4 directionB;
    vec4 colorB;
};

// size 4*256*3
struct TextureRemaps {
    // x = size bucket, y = index within bucket, z/w unused padding
    vec4 tfrags[256];
    vec4 ties[256];
    vec4 shrubs[256];
};

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ClipFromWorld;
    CameraData u_CameraData;
    vec4 u_LodSettings; // x = preset, y = bias
    vec4 u_RenderSettings; // x = enable textures
    vec4 u_BackgroundColor;
    FogParams u_FogParams;
    DirectionLight u_DirectionLights[16];
    TextureRemaps u_TextureRemaps;
};

    `,
    LightingFunctions: `

bool isNullLight(int position, int dirLightIndex) {
    if (dirLightIndex == 15) return true;
    if (position > 0 && dirLightIndex == 0) return true;
    return false;
}

vec4 applyDirectionalLight(vec3 normal, int dirLightIndex) {
    DirectionLight dirlight = u_DirectionLights[dirLightIndex];

    vec4 light = vec4(0.0);
    float nDotL_A = dot(normal, dirlight.directionA.xyz);
    if (nDotL_A > 0.0) light += nDotL_A * dirlight.colorA;
    float nDotL_B = dot(normal, dirlight.directionB.xyz);
    if (nDotL_B > 0.0) light += nDotL_B * dirlight.colorB;
    return light;
}

vec4 commonVertexLighting(vec4 rgba, vec3 normal, vec4 dirLightIndices) {
    vec4 light = rgba;

    for(int i = 0; i < 4; i++) {
        int dirLightIndex = int(dirLightIndices[i]);
        if (isNullLight(i, dirLightIndex)) continue;
        light += applyDirectionalLight(normalize(normal), dirLightIndex);
    }

    if (rgba.a >= 1.0 && light.a < 1.0) {
        light.a = rgba.a;
    }

    return light;
}

float fogFactor(vec3 vertexPosWorld) {
    float nearDist = u_FogParams.distanceNearFar.x;
    float farDist = u_FogParams.distanceNearFar.y;
    float nearIntensity = u_FogParams.intensityNearFar.x;
    float farIntensity = u_FogParams.intensityNearFar.y;

    // for ortho, use arbitrary constant fog factor
    if (u_CameraData.extras.z == 1.0) return (nearIntensity + farIntensity) / 2.0;

    float distWorld = length(vertexPosWorld - u_CameraData.position.xyz);
    float distFogRange01 = 1.0 - clamp((farDist - distWorld) / (farDist - nearDist), 0.0, 1.0);
    return nearIntensity + distFogRange01 * (farIntensity - nearIntensity);
}

    `,
    CommonFragmentShader: `
${GfxShaderLibrary.MonochromeNTSCLinear}

const float SATURATION_ADJUST = 1.15;

vec4 commonFragmentShader(vec4 rgba, vec4 textureSample, float fogFactor) {
    // texture color is multiplied with vertex color immediately
    rgba *= textureSample;

    // fog step (ignores alpha)
    vec3 rgb = rgba.rgb;
    vec3 fogColor = u_FogParams.color.rgb;
    rgb = mix(rgb, fogColor, fogFactor);

    // bring back alpha
    rgba = vec4(rgb, rgba.a);

    // alpha test
    // this should be configured per object but I can't find the data
    if (rgba.a < 0.01) discard;

    // with saturation filter (not authentic but looks washed out without it)
    rgba.rgb = mix(vec3(MonochromeNTSCLinear(rgba.rgb)), rgba.rgb, SATURATION_ADJUST);

    return rgba;
}

    `,
    Sampler: `
/*
Custom texture sampling function that can dynamically select textures and sampling parameters.
- bucket: the atlas to read from
- slice: the slice within the atlas
- clampRegister: bit 1 = S clamp, bit 3 = T clamp (other bits are used for region clamp, not supported)
- st: the texture coordinates
*/
vec4 ratchetSampler(float bucket, float slice, int clampRegister, vec2 st) {
    int lod = 0;

    if (u_CameraData.extras.z == 0.0) { // skip mip selection for ortho
        // GS manual page 62
        // ps2 selects mips based on depth not texcoords
        // L and K are guesses
        // the mesh classes have mip biases that aren't implemented yet
        float K = log2(bucket) - 10.0 - (u_LodSettings.y / 40.0);
        float L = 0.0;
        float LOD = (log2(1.0 / gl_FragCoord.w) * pow(2.0, L)) + K;

        float maxLod = log2(bucket) - 2.0;
        lod = int(clamp(LOD, 0.0, maxLod));
    }

    vec2 texSize = vec2(bucket) / pow(2.0, float(lod));
    vec2 texelCoord = st * texSize - 0.5;
    
    vec2 texelFloor = floor(texelCoord);
    vec2 frac = texelCoord - texelFloor;
    
    ivec2 tc00 = ivec2(texelFloor);
    ivec2 tc10 = tc00 + ivec2(1, 0);
    ivec2 tc01 = tc00 + ivec2(0, 1);
    ivec2 tc11 = tc00 + ivec2(1, 1);
    
    int iTexSize = int(texSize.x);
    bool clampS = (clampRegister & 1) != 0;
    bool clampT = (clampRegister & 4) != 0;
    
    if (clampS) {
        tc00.x = clamp(tc00.x, 0, iTexSize - 1);
        tc10.x = clamp(tc10.x, 0, iTexSize - 1);
        tc01.x = clamp(tc01.x, 0, iTexSize - 1);
        tc11.x = clamp(tc11.x, 0, iTexSize - 1);
    } else {
        tc00.x = int(mod(float(tc00.x), texSize.x));
        tc10.x = int(mod(float(tc10.x), texSize.x));
        tc01.x = int(mod(float(tc01.x), texSize.x));
        tc11.x = int(mod(float(tc11.x), texSize.x));
    }
    
    if (clampT) {
        tc00.y = clamp(tc00.y, 0, iTexSize - 1);
        tc10.y = clamp(tc10.y, 0, iTexSize - 1);
        tc01.y = clamp(tc01.y, 0, iTexSize - 1);
        tc11.y = clamp(tc11.y, 0, iTexSize - 1);
    } else {
        tc00.y = int(mod(float(tc00.y), texSize.x));
        tc10.y = int(mod(float(tc10.y), texSize.x));
        tc01.y = int(mod(float(tc01.y), texSize.x));
        tc11.y = int(mod(float(tc11.y), texSize.x));
    }
    
    vec4 s00, s10, s01, s11;
    if (bucket == 16.0) {
        s00 = texelFetch(TEXTURE(u_Texture_16), ivec3(tc00, slice), lod);
        s10 = texelFetch(TEXTURE(u_Texture_16), ivec3(tc10, slice), lod);
        s01 = texelFetch(TEXTURE(u_Texture_16), ivec3(tc01, slice), lod);
        s11 = texelFetch(TEXTURE(u_Texture_16), ivec3(tc11, slice), lod);
    } else if (bucket == 32.0) {
        s00 = texelFetch(TEXTURE(u_Texture_32), ivec3(tc00, slice), lod);
        s10 = texelFetch(TEXTURE(u_Texture_32), ivec3(tc10, slice), lod);
        s01 = texelFetch(TEXTURE(u_Texture_32), ivec3(tc01, slice), lod);
        s11 = texelFetch(TEXTURE(u_Texture_32), ivec3(tc11, slice), lod);
    } else if (bucket == 64.0) {
        s00 = texelFetch(TEXTURE(u_Texture_64), ivec3(tc00, slice), lod);
        s10 = texelFetch(TEXTURE(u_Texture_64), ivec3(tc10, slice), lod);
        s01 = texelFetch(TEXTURE(u_Texture_64), ivec3(tc01, slice), lod);
        s11 = texelFetch(TEXTURE(u_Texture_64), ivec3(tc11, slice), lod);
    } else if (bucket == 128.0) {
        s00 = texelFetch(TEXTURE(u_Texture_128), ivec3(tc00, slice), lod);
        s10 = texelFetch(TEXTURE(u_Texture_128), ivec3(tc10, slice), lod);
        s01 = texelFetch(TEXTURE(u_Texture_128), ivec3(tc01, slice), lod);
        s11 = texelFetch(TEXTURE(u_Texture_128), ivec3(tc11, slice), lod);
    } else if (bucket == 256.0) {
        s00 = texelFetch(TEXTURE(u_Texture_256), ivec3(tc00, slice), lod);
        s10 = texelFetch(TEXTURE(u_Texture_256), ivec3(tc10, slice), lod);
        s01 = texelFetch(TEXTURE(u_Texture_256), ivec3(tc01, slice), lod);
        s11 = texelFetch(TEXTURE(u_Texture_256), ivec3(tc11, slice), lod);
    } else {
        return vec4(1.0, 0.0, 1.0, 1.0);
    }

    vec4 s0 = mix(s00, s10, frac.x);
    vec4 s1 = mix(s01, s11, frac.x);
    vec4 res = mix(s0, s1, frac.y);
    return res;
}
`
};

