import * as BIN from "./bin.js";
import { GfxDevice, GfxBuffer, GfxInputLayout, GfxFormat, GfxVertexBufferFrequency, GfxVertexAttributeDescriptor, GfxBufferUsage, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxCullMode, GfxCompareMode, makeTextureDescriptor2D, GfxProgram, GfxMegaStateDescriptor, GfxBlendMode, GfxBlendFactor, GfxInputLayoutBufferDescriptor, GfxTexture, GfxVertexBufferDescriptor, GfxIndexBufferDescriptor, GfxBindingLayoutDescriptor, GfxBufferFrequencyHint, GfxSampler, GfxTextureDimension, GfxSamplerFormatKind, GfxTextureUsage } from "../gfx/platform/GfxPlatform.js";
import { DeviceProgram } from "../Program.js";
import * as Viewer from "../viewer.js";
import { mat4, ReadonlyMat4, ReadonlyVec3, ReadonlyVec4, vec2, vec3, vec4 } from "gl-matrix";
import { fillMatrix4x3, fillMatrix4x2, fillVec3v, fillVec4v, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { TextureMapping } from "../TextureHolder.js";
import { assert, assertExists, hexzero, nArray } from "../util.js";
import { GfxRenderInstManager, GfxRendererLayer, makeSortKey, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers.js";
import { GSAlphaCompareMode, GSAlphaFailMode, GSTextureFunction, GSDepthCompareMode, GSTextureFilter, psmToString, GSWrapMode } from "../Common/PS2/GS.js";
import { AttachmentStateSimple, setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { Vec3UnitZ, Vec3Zero, clamp, computeModelMatrixR, getMatrixTranslation, scaleMatrix, setMatrixTranslation, transformVec3Mat4w0, transformVec3Mat4w1 } from "../MathHelpers.js";
import { getPointHermite } from "../Spline.js";
import { convertToCanvas } from "../gfx/helpers/TextureConversionHelpers.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { Flipbook, ParticleGeometryEntry, TrailArgs, WaterArgs } from "./particle.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
import { createBufferFromData } from "../gfx/helpers/BufferHelpers.js";

export class FFXProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;
    public static a_Extra = 3;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4   u_Projection;
    Mat3x4 u_LightDirection;
    Mat3x4 u_LightColor;
    vec4   u_FogColor;
    vec2   u_ScreenSize;
    float  u_FogStrength;
    float  u_RenderHacks;
};

layout(std140) uniform ub_ModelParams {
    Mat3x4 u_BoneMatrix;
    Mat3x4 u_EnvMapMatrix;
    Mat2x4 u_TextureMatrix;
    vec4   u_Params;
};

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_TexCoord;
`;

    public override vert = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec2 a_TexCoord;
layout(location = 3) in vec4 a_Extra;

void main() {
    int hackFlags = int(u_RenderHacks);

    vec3 t_PositionLocal = a_Position;
#if EFFECT == 1
    t_PositionLocal = mix(t_PositionLocal, a_Extra.xyz, u_Params.x);
#endif

    vec3 t_PositionView = UnpackMatrix(u_BoneMatrix) * vec4(t_PositionLocal, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(t_PositionView, 1.0);

#if EFFECT == 4
    v_Color = mix(a_Color, a_Extra, u_Params.x);
#else
    v_Color = a_Color;
#endif

    if ((hackFlags & 1) == 0)
        v_Color = vec4(1.);

#if EFFECT == 6
    vec3 t_ViewNormal = UnpackMatrix(u_BoneMatrix) * vec4(a_Extra.xyz, 0.0);
    t_ViewNormal = UnpackMatrix(u_EnvMapMatrix) * vec4(t_ViewNormal, 0.0);
    v_TexCoord = .5*(t_ViewNormal.xy + 1.);
#elif EFFECT == 3
    v_TexCoord = mix(a_TexCoord, a_Extra.xy, u_Params.x);
#elif EFFECT == 5
    v_TexCoord = a_TexCoord + u_Params.xy/256.0;
#else
    v_TexCoord = a_TexCoord;
#endif

    v_TexCoord = UnpackMatrix(u_TextureMatrix) * vec4(v_TexCoord, 0.0, 1.0);
}
`;

    constructor(gsConfiguration: BIN.GSConfiguration) {
        super();
        this.frag = this.generateFrag(gsConfiguration);
    }

    private generateAlphaCompareOp(atst: GSAlphaCompareMode, lhs: string, rhs: string): string {
        switch (atst) {
            case GSAlphaCompareMode.ALWAYS: return `true`;
            case GSAlphaCompareMode.NEVER: return `false`;
            case GSAlphaCompareMode.LESS: return `${lhs} < ${rhs}`;
            case GSAlphaCompareMode.LEQUAL: return `${lhs} <= ${rhs}`;
            case GSAlphaCompareMode.EQUAL: return `${lhs} == ${rhs}`;
            case GSAlphaCompareMode.GEQUAL: return `${lhs} >= ${rhs}`;
            case GSAlphaCompareMode.GREATER: return `${lhs} > ${rhs}`;
            case GSAlphaCompareMode.NOTEQUAL: return `${lhs} != ${rhs}`;
        }
    }

    private generateAlphaTest(ate: boolean, atst: GSAlphaCompareMode, aref: number, afail: GSAlphaFailMode): string {
        const floatRef = aref / 0xFF;
        const cmp = this.generateAlphaCompareOp(atst, `t_Color.a`, floatRef.toFixed(5));

        if (ate && afail === 0x00) {
            return `
    if (!(${cmp}))
        discard;
`;
        } else {
            return '';
        }
    }

    private generateFrag(gsConfiguration: BIN.GSConfiguration): string {
        assert((gsConfiguration.prim & 0x10) === 0 || gsConfiguration.tex0.tfx === GSTextureFunction.MODULATE);

        // Contains depth & alpha test settings.
        const ate = !!((gsConfiguration.test_1_data0 >>> 0) & 0x01);
        const atst = (gsConfiguration.test_1_data0 >>> 1) & 0x07;
        const aref = (gsConfiguration.test_1_data0 >>> 4) & 0xFF;
        const afail = (gsConfiguration.test_1_data0 >>> 12) & 0x03;
        const date = !!((gsConfiguration.test_1_data0 >>> 14) & 0x01);
        const datm = !!((gsConfiguration.test_1_data0 >>> 15) & 0x01);

        return `
void main() {
    int hackFlags = int(u_RenderHacks);
    vec4 t_Color = v_Color;

#ifdef TEXTURE
    if ((hackFlags & 2) != 0)
        t_Color *= texture(SAMPLER_2D(u_Texture), v_TexCoord);
#endif

${this.generateAlphaTest(ate, atst, aref, afail)}
#ifdef FOG
    float fogParam = clamp(u_FogStrength/gl_FragCoord.w, 0.0, u_FogColor.a);
    t_Color.rgb = mix(t_Color.rgb, u_FogColor.rgb, fogParam);
#endif
    gl_FragColor = t_Color;
}
`;
    }
}

class FFXActorProgram extends DeviceProgram {
    public static a_Indices = 0;
    public static a_TexCoord = 1;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat3x4 u_LightDirection;
    Mat3x4 u_LightColor;
    vec4   u_FogColor;
    vec2   u_ScreenSize;
    float  u_FogStrength;
    float  u_RenderHacks;
};

layout(std140) uniform ub_ModelParams {
    Mat3x4 u_BoneMatrix;
    Mat3x4 u_NormalMatrix;
    vec4 u_EnvMapUp;
    vec4 u_EnvMapSide;
    vec4 u_Specular;
    vec2 u_EnvMapParams;
    float u_BakedShadow;
};

uniform sampler2D u_Texture;
uniform sampler2D u_Vertices;
uniform sampler2D u_EnvMap;

varying vec4 v_TexCoord;
varying vec4 v_Color;
`;

    public override vert = `
layout(location = 0) in vec2 a_Indices;
layout(location = 1) in vec2 a_TexCoord;

void main() {
    int hackFlags = int(u_RenderHacks);
    vec3 pos = texelFetch(TEXTURE(u_Vertices), ivec2(int(a_Indices.x), 0), 0).xyz;
    vec3 norm = texelFetch(TEXTURE(u_Vertices), ivec2(int(a_Indices.y), 1), 0).xyz;
    norm = UnpackMatrix(u_NormalMatrix) * vec4(norm, 0.);

    vec3 viewPos = UnpackMatrix(u_BoneMatrix) * vec4(pos, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(viewPos, 1.0);
    v_TexCoord.xy = a_TexCoord;

#ifdef ENV_MAP
    vec3 dirToVtx = normalize(viewPos.xyz);
    vec3 reflectDir = dirToVtx - u_EnvMapParams.x * dot(dirToVtx, norm) * norm;
    v_TexCoord.z = dot(reflectDir, u_EnvMapSide.xyz);
    v_TexCoord.w = dot(reflectDir, u_EnvMapUp.xyz);
    v_TexCoord.zw = .5 + u_EnvMapParams.y * v_TexCoord.zw;
#endif

    vec3 weights = max(UnpackMatrix(u_LightDirection) * vec4(norm, 0.), 0.);
    v_Color.rgb = UnpackMatrix(u_LightColor) * vec4(weights, 1.) * u_BakedShadow;
    if ((hackFlags & 1) == 0)
        v_Color.rgb = vec3(1.);
    v_Color.a = 1.;
}
`;

public override frag = `
void main() {
    int hackFlags = int(u_RenderHacks);
    vec4 t_Color = v_Color;

#ifdef TEXTURE
    if ((hackFlags & 2) != 0)
        t_Color *= texture(SAMPLER_2D(u_Texture), v_TexCoord.xy);
#endif

    if (t_Color.a <= 0.0)
        discard;

#ifdef FOG
    float fogParam = clamp(u_FogStrength/gl_FragCoord.w, 0.0, u_FogColor.a);
    t_Color.rgb = mix(t_Color.rgb, u_FogColor.rgb, fogParam);
#endif

#ifdef ENV_MAP
    // on PS2 this is drawn as a separate triangle with 1.0 additive blend, alpha is ignored
    t_Color.rgb += u_Specular.rgb * texture(SAMPLER_2D(u_EnvMap), v_TexCoord.zw).rgb / t_Color.a;
#endif

    gl_FragColor = t_Color;
}
`;
}

class FlipbookProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat3x4 u_LightDirection;
    Mat3x4 u_LightColor;
    vec4   u_FogColor;
    vec2   u_ScreenSize;
    float  u_FogStrength;
    float  u_RenderHacks;
};

layout(std140) uniform ub_ModelParams {
    Mat3x4 u_ModelView;
    vec4 u_Color;
    vec4 u_Misc;
};

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_TexCoord;
`;

    public override vert = `
layout(location = 0) in vec2 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec2 a_TexCoord;

void main() {
    int hackFlags = int(u_RenderHacks);
    vec4 viewPos;
    viewPos.xyz = UnpackMatrix(u_ModelView) * vec4(a_Position, 0.0, 1.0);
    viewPos.w = 1.0;
    gl_Position = UnpackMatrix(u_Projection) * viewPos;
    if (u_Misc.x != 0.0) {
        viewPos.z -= u_Misc.x;
        float fixedZ = dot(u_Projection.mz, viewPos);
        float fixedW = dot(u_Projection.mw, viewPos);
        gl_Position.z = fixedZ/fixedW * gl_Position.w;
    }
    v_TexCoord = a_TexCoord;
    v_Color = a_Color*u_Color;
    if ((hackFlags & 1) == 0)
        v_Color = vec4(1.);
}
`;

    public override frag = `
void main() {
    int hackFlags = int(u_RenderHacks);
    gl_FragColor = v_Color;
    if ((hackFlags & 2) != 0)
        gl_FragColor *= texture(SAMPLER_2D(u_Texture), v_TexCoord);
    if (gl_FragColor.a == 0.0)
        discard;
}
`;
}

class TrailProgram extends FlipbookProgram {
    public static a_InstancePos = 3;
    public static a_VertexRange = 4;
    public static a_Scale = 5;

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat3x4 u_LightDirection;
    Mat3x4 u_LightColor;
    vec4   u_FogColor;
    vec2   u_ScreenSize;
    float  u_FogStrength;
    float  u_RenderHacks;
};

layout(std140) uniform ub_ModelParams {
    Mat3x4 u_ModelView;
    vec4 u_HeadColor;
    vec4 u_TailColor;
    vec4 u_Scales; // head, tail, range, length
    vec4 u_Params;
};

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_TexCoord;
`;

    public override vert = `
layout(location = 0) in vec2 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec2 a_TexCoord;
layout(location = 3) in vec4 a_InstancePos;
layout(location = 4) in vec2 a_VertexRange;
layout(location = 5) in float a_Scale;

void main() {
    int id = int(gl_VertexID) - int(u_Params.x);
    if (id < int(a_VertexRange.x) || id >= int(a_VertexRange.y)) {
        gl_Position = vec4(1., 1., 1., 0.);
        return;
    }
    int hackFlags = int(u_RenderHacks);
    float trailFrac = float(gl_InstanceID)/u_Scales.w;
    float taper = mix(u_Scales.x, u_Scales.y, trailFrac) * a_Scale;
    vec4 color = mix(u_HeadColor, u_TailColor, trailFrac);
    vec2 vtx = a_Position * taper;
    float z = a_InstancePos.w * 6.28318;
    vtx.xy = vec2(cos(z)*vtx.x + sin(z)*vtx.y, cos(z)*vtx.y - sin(z)*vtx.x);
    vec3 viewPos = UnpackMatrix(u_ModelView) * vec4(vtx, 0.0, 1.0);
    viewPos += a_InstancePos.xyz;
    gl_Position = UnpackMatrix(u_Projection) * vec4(viewPos, 1.0);
    v_TexCoord = a_TexCoord;
    v_Color = a_Color*color;
    if ((hackFlags & 1) == 0)
        v_Color = vec4(1.);
}
`;
}

export enum GeoParticleMode {
    DEFAULT,
    BLUR,
    BLUR_Z,
    MASK = 7,
    FOG = 8,
}

class ParticleProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;
    public static a_Normal = 3;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;
    public static ub_DrawParams = 2;

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat3x4 u_LightDirection;
    Mat3x4 u_LightColor;
    vec4   u_FogColor;
    vec2   u_ScreenSize;
    float  u_FogStrength;
    float  u_RenderHacks;
};

layout(std140) uniform ub_ModelParams {
    Mat3x4 u_ModelView;
    vec4 u_ColorFactor;
    vec4 u_Misc; // depthOffset; mode; param
};

layout(std140) uniform ub_DrawParams {
    Mat2x4 u_TexMatrix;
};

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_TexCoord;
`;

    public override vert = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec2 a_TexCoord;
layout(location = 3) in vec4 a_Normal;

void main() {
    int hackFlags = int(u_RenderHacks);
    vec3 viewPos = UnpackMatrix(u_ModelView) * vec4(a_Position, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(viewPos, 1.0);
    int mode = int(u_Misc.y) & ${GeoParticleMode.MASK};
    if (u_Misc.x != 0.) {
        viewPos.z -= u_Misc.x;
        vec4 forDepth = UnpackMatrix(u_Projection) * vec4(viewPos, 1.0);
        gl_Position.z = forDepth.z * gl_Position.w / forDepth.w;
    }
    if (mode == ${GeoParticleMode.BLUR} || mode == ${GeoParticleMode.BLUR_Z}) {
        v_TexCoord = vec2(0.);
        if (u_Misc.z != 0.) {
            vec3 dir = normalize(viewPos.xyz - UnpackMatrix(u_ModelView)[3]);
            if (mode == ${GeoParticleMode.BLUR_Z})
                dir.xy *= dir.z; // ??? effectively cancels this out for the save sphere effect
            v_TexCoord += dir.xy * u_Misc.z;
            v_TexCoord = (UnpackMatrix(u_Projection) * vec4(v_TexCoord, 0., 0.)).xy;
            v_TexCoord /= gl_Position.w;
        }
    } else {
        v_TexCoord = UnpackMatrix(u_TexMatrix) * vec4(a_TexCoord, 0.0, 1.0);
    }

    v_Color = a_Color*u_ColorFactor;
    if ((hackFlags & 1) == 0)
        v_Color = vec4(1.);
}
`;

    public override frag = `
void main() {
    int hackFlags = int(u_RenderHacks);
    gl_FragColor = v_Color;
    vec2 texCoord = v_TexCoord;
    int mode = int(u_Misc.y);
    bool fog = (mode & ${GeoParticleMode.FOG}) > 0;
    mode = mode & ${GeoParticleMode.MASK};
    if (mode == ${GeoParticleMode.BLUR} || mode == ${GeoParticleMode.BLUR_Z}) {
        texCoord += gl_FragCoord.xy/u_ScreenSize.xy;
    }
#ifdef TEXTURE
    if ((hackFlags & 2) != 0)
        gl_FragColor *= texture(SAMPLER_2D(u_Texture), texCoord);
#endif
    if (fog) {
        float fogParam = clamp(u_FogStrength/gl_FragCoord.w, 0.0, u_FogColor.a);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, u_FogColor.rgb, fogParam);
    }
}
`;
}

class ShatterProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;
    public static a_Normal = 3;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;
    public static ub_DrawParams = 2;

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    vec4   u_LightPos[2];
    vec4   u_LightColor[2];
    vec4   u_Params;
};

layout(std140) uniform ub_ModelParams {
    Mat3x4 u_ModelView;
    Mat3x4 u_Directions;
    Mat2x4 u_TexMatrix;
};

uniform sampler2D u_Texture;
uniform sampler2D u_EnvMap;

varying vec4 v_Color;
varying vec4 v_TexCoord;
`;

    public override vert = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec2 a_TexCoord;
layout(location = 3) in vec4 a_Normal;

void main() {
    vec3 viewPos = UnpackMatrix(u_ModelView) * vec4(a_Position, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(viewPos, 1.0);
    v_TexCoord.xy = UnpackMatrix(u_TexMatrix) * vec4(a_TexCoord, 0.0, 1.0);

    // note this uses the y component which is actually the depth
    vec2 relPos = (UnpackMatrix(u_Directions) * vec4(a_Position, 1)).xy;
    vec3 relNormal = UnpackMatrix(u_Directions) * vec4(a_Normal.xyz, 0.);
    vec2 posMod = -trunc(relPos/16.)/128.;
    posMod -= trunc(posMod); // get C-style modulo
    v_TexCoord.zw = .5*(relNormal.xy + 3.) + posMod;

    v_Color = vec4(0.);
    for (int i = 0; i < 2; i++) {
        vec3 toLight = u_LightPos[i].xyz - viewPos;
        float strength = max(0., dot(toLight, relNormal))/dot(toLight, toLight);
        v_Color += u_LightPos[i].w * strength * u_LightColor[i];
    }
    v_Color *= u_Params.x;
}
`;

    public override frag = `
void main() {
    gl_FragColor = v_Color;
    gl_FragColor *= texture(SAMPLER_2D(u_Texture), v_TexCoord.xy);
    vec4 reflection = texture(SAMPLER_2D(u_EnvMap), v_TexCoord.zw);
    gl_FragColor.rgb += reflection.rgb * reflection.a * u_Params.y;
    gl_FragColor.rgb = clamp(gl_FragColor.rgb, 0.0, 1.0);
}
`;
}

class WaterProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;
    public static a_Normal = 3;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;
    public static ub_DrawParams = 2;

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat3x4 u_LightDirection;
    Mat3x4 u_LightColor;
    vec4   u_FogColor;
    vec2   u_ScreenSize;
    float  u_FogStrength;
    float  u_RenderHacks;
};

layout(std140) uniform ub_ModelParams {
    Mat3x4 u_ModelView;
    vec4 u_ColorFactor;
    vec4 u_Size;
    vec4 u_xPhase;
    vec4 u_xAmp;
    vec4 u_xFreq;
    vec4 u_diagPhase;
    vec4 u_diagAmp;
    vec4 u_diagFreq;
};

layout(std140) uniform ub_DrawParams {
    Mat2x4 u_TexMatrix;
};

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_TexCoord;
`;

    public override vert = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec2 a_TexCoord;
layout(location = 3) in vec4 a_Normal;

void main() {
    int hackFlags = int(u_RenderHacks);
    float tau = 6.28318;
    float xPhase = a_Position.x/u_Size.x;
    float zPhase = a_Position.z/u_Size.y;
    vec3 newPos = u_xAmp.xyz * sin((xPhase + u_xPhase.xyz/256.) * u_xFreq.xyz * tau);
    newPos += u_diagAmp.xyz * sin((xPhase + zPhase + u_diagPhase.xyz/256.) * u_diagFreq.xyz * tau);
    newPos += a_Position;

    newPos.x += u_Size.x*(float(gl_InstanceID % int(2.*u_Size.z + 1.)) - u_Size.z);
    newPos.z += u_Size.y*(float(gl_InstanceID/int(2.*u_Size.z + 1.)) - u_Size.z);

    gl_Position = UnpackMatrix(u_Projection) * vec4(UnpackMatrix(u_ModelView) * vec4(newPos, 1.0), 1.0);
    v_TexCoord = UnpackMatrix(u_TexMatrix) * vec4(a_TexCoord, 0., 1.);
    v_Color = a_Color*u_ColorFactor;
    if ((hackFlags & 1) == 0)
        v_Color = vec4(1.);
}
`;

    public override frag = `
void main() {
    int hackFlags = int(u_RenderHacks);
    gl_FragColor = v_Color;
    if ((hackFlags & 2) != 0)
        gl_FragColor *= texture(SAMPLER_2D(u_Texture), v_TexCoord);
    if (u_Size.w > 0.) {
        float fogParam = clamp(u_FogStrength/gl_FragCoord.w, 0.0, u_FogColor.a);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, u_FogColor.rgb, fogParam);
    }
}
`;
}

interface BasicModel {
    vertexData: Float32Array;
    indexData: Uint16Array | Uint32Array;
}

export class LevelModelData {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;

    public inputLayout: GfxInputLayout;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;

    constructor(device: GfxDevice, cache: GfxRenderCache, public model: BasicModel) {
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, this.model.vertexData.buffer);
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, this.model.indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: FFXProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0 * 4, format: GfxFormat.F32_RGB },
            { location: FFXProgram.a_Color, bufferIndex: 0, bufferByteOffset: 3 * 4, format: GfxFormat.F32_RGBA },
            { location: FFXProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 7 * 4, format: GfxFormat.F32_RG },
            { location: FFXProgram.a_Extra, bufferIndex: 0, bufferByteOffset: 9 * 4, format: GfxFormat.F32_RGBA },
        ];
        const VERTEX_STRIDE = 3 + 4 + 2 + 4;
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: VERTEX_STRIDE * 4, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];
        const indexBufferFormat = model.indexData instanceof Uint16Array ? GfxFormat.U16_R : GfxFormat.U32_R;

        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.vertexBufferDescriptors = [
            { buffer: this.vertexBuffer },
        ];
        this.indexBufferDescriptor = { buffer: this.indexBuffer };
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

export class ActorModelData {
    private attrBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    public vertexTexture: GfxTexture;
    public vertexSampler: GfxSampler;

    public inputLayout: GfxInputLayout;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;

    constructor(device: GfxDevice, cache: GfxRenderCache, public model: BIN.ActorPart) {
        this.attrBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, this.model.attrData.buffer);
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, this.model.indexData.buffer);
        this.vertexTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.F32_RGBA, model.texWidth, 2, 1));
        device.uploadTextureData(this.vertexTexture, 0, [model.vertexData]);
        this.vertexSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Point, magFilter: GfxTexFilterMode.Point, mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp, wrapT: GfxWrapMode.Clamp,
            minLOD: 0, maxLOD: 0,
        });

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: FFXActorProgram.a_Indices, bufferIndex: 0, bufferByteOffset: 0 * 4, format: GfxFormat.F32_RG },
            { location: FFXActorProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 2 * 4, format: GfxFormat.F32_RG },
        ];
        const VERTEX_STRIDE = 2 + 2;
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: VERTEX_STRIDE * 4, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;

        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.vertexBufferDescriptors = [
            { buffer: this.attrBuffer },
        ];
        this.indexBufferDescriptor = { buffer: this.indexBuffer };
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.attrBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyTexture(this.vertexTexture);
    }
}

export class FlipbookData {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;

    public inputLayout: GfxInputLayout;
    public indexBufferDesc: GfxIndexBufferDescriptor;
    public vertexBufferDesc: GfxVertexBufferDescriptor[];

    public totalQuads: number;

    constructor(device: GfxDevice, cache: GfxRenderCache, public flipbook: Flipbook) {
        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, this.flipbook.vertexData.buffer as ArrayBuffer);
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, this.flipbook.indexData.buffer as ArrayBuffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: FlipbookProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0 * 4, format: GfxFormat.F32_RG },
            { location: FlipbookProgram.a_Color, bufferIndex: 0, bufferByteOffset: 2 * 4, format: GfxFormat.F32_RGBA },
            { location: FlipbookProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 6 * 4, format: GfxFormat.F32_RG },
            { location: TrailProgram.a_InstancePos, bufferIndex: 1, bufferByteOffset: 0 * 4, format: GfxFormat.F32_RGBA },
            { location: TrailProgram.a_VertexRange, bufferIndex: 1, bufferByteOffset: 4 * 4, format: GfxFormat.F32_RG },
            { location: TrailProgram.a_Scale, bufferIndex: 1, bufferByteOffset: 6 * 4, format: GfxFormat.F32_R },
        ];
        const VERTEX_STRIDE = 2 + 4 + 2;
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: VERTEX_STRIDE * 4, frequency: GfxVertexBufferFrequency.PerVertex, },
            { byteStride: 8 * 4, frequency: GfxVertexBufferFrequency.PerInstance, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;
        this.totalQuads = this.flipbook.vertexData.length / VERTEX_STRIDE / 4;
        this.inputLayout = cache.createInputLayout( { vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.vertexBufferDesc = [
            { buffer: this.vertexBuffer },
            { buffer: this.vertexBuffer }, // only used by trails
        ];
        this.indexBufferDesc = { buffer: this.indexBuffer };
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

function translateWrapMode(wm: GSWrapMode): GfxWrapMode {
    switch (wm) {
        // region_ modes are handled by modifying the texture, so ignore them here
        case GSWrapMode.REGION_CLAMP:
        case GSWrapMode.CLAMP:
            return GfxWrapMode.Clamp;
        case GSWrapMode.REGION_REPEAT:
        case GSWrapMode.REPEAT:
            return GfxWrapMode.Repeat;
    }
}

function translateDepthCompareMode(cmp: GSDepthCompareMode): GfxCompareMode {
    switch (cmp) {
        case GSDepthCompareMode.NEVER: return GfxCompareMode.Never;
        case GSDepthCompareMode.ALWAYS: return GfxCompareMode.Always;
        // We use a LESS-style depth buffer.
        case GSDepthCompareMode.GEQUAL: return GfxCompareMode.LessEqual;
        case GSDepthCompareMode.GREATER: return GfxCompareMode.Less;
    }
}

function translateTextureFilter(filter: GSTextureFilter): [GfxTexFilterMode, GfxMipFilterMode] {
    switch (filter) {
        case GSTextureFilter.NEAREST:
            return [GfxTexFilterMode.Point, GfxMipFilterMode.Nearest];
        case GSTextureFilter.LINEAR:
            return [GfxTexFilterMode.Bilinear, GfxMipFilterMode.Nearest];
        case GSTextureFilter.NEAREST_MIPMAP_NEAREST:
            return [GfxTexFilterMode.Point, GfxMipFilterMode.Nearest];
        case GSTextureFilter.NEAREST_MIPMAP_LINEAR:
            return [GfxTexFilterMode.Point, GfxMipFilterMode.Linear];
        case GSTextureFilter.LINEAR_MIPMAP_NEAREST:
            return [GfxTexFilterMode.Bilinear, GfxMipFilterMode.Nearest];
        case GSTextureFilter.LINEAR_MIPMAP_LINEAR:
            return [GfxTexFilterMode.Bilinear, GfxMipFilterMode.Linear];
        default: throw new Error();
    }
}

class ActorDrawCallInstance {
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private textureMappings: TextureMapping[] = [];
    public visible = true;

    constructor(cache: GfxRenderCache, public drawCall: BIN.ActorDrawCall, textures: TextureData[], isObject = false) {
        const program = new FFXActorProgram();

        this.megaStateFlags = {
            depthCompare: reverseDepthForCompareMode(GfxCompareMode.LessEqual),
            depthWrite: true,
            cullMode: drawCall.cullingEnabled ? GfxCullMode.Back : GfxCullMode.None, // opposite from level, for some reason
        };

        if (drawCall.blendMode === 0x44) {
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            });
        } else if (drawCall.blendMode === 0x48) {
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.One,
            });
        } else if (drawCall.blendMode === 0) {
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.One,
                blendDstFactor: GfxBlendFactor.Zero,
            });
        } else {
            throw `unknown alpha blend setting ${hexzero(drawCall.blendMode, 2)}`;
        }

        program.defines.set("FOG", "1");

        if (drawCall.textureIndex >= 0) {
            program.defines.set("TEXTURE", "1");

            this.textureMappings.push(new TextureMapping());
            this.textureMappings[0].gfxSampler = cache.createSampler({
                minFilter: GfxTexFilterMode.Bilinear,
                magFilter: GfxTexFilterMode.Bilinear,
                mipFilter: GfxMipFilterMode.Nearest,
                wrapS: GfxWrapMode.Repeat, wrapT: GfxWrapMode.Repeat,
                minLOD: 0, maxLOD: 0,
            });
            const tex = textures[drawCall.textureIndex];
            this.textureMappings[0].gfxTexture = tex.gfxTexture;
        }

        if (drawCall.effectType & 4)
            program.defines.set("ENV_MAP", "1");

        this.gfxProgram = cache.createProgram(program);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, textureRemaps: GfxTexture[], vtxTexture: TextureMapping, envMap: TextureMapping): void {
        if (!this.visible)
            return;
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);

        renderInst.setDrawCount(this.drawCall.indexCount, this.drawCall.indexOffset);

        if (textureRemaps.length > 0 && this.drawCall.textureIndex >= 0)
            this.textureMappings[0].gfxTexture = textureRemaps[this.drawCall.textureIndex];
        this.textureMappings[1] = vtxTexture;
        this.textureMappings[2] = envMap;
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInstManager.submitRenderInst(renderInst);
    }
}

export const FFXToNoclip = mat4.create();
mat4.fromXRotation(FFXToNoclip, Math.PI);

enum RenderLayer {
    OPA_SKYBOX,
    OPA,
    OPA_LIGHTING,
    SHADOW,
    ACTOR,
    XLU_SKYBOX,
    XLU,
    XLU_LIGHTING,
    LATE_SHADOW,
    LATE_ACTOR,
    OPA_PARTICLES,
    PARTICLES,
}

const scratchMatrix = mat4.create();
const posScrath = vec3.create();
// LevelModelInstance is the basic unit of geometry
export class LevelDrawCallInstance {
    public layer = GfxRendererLayer.TRANSLUCENT;
    public depthSort = false;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private textureMappings: TextureMapping[] = [];
    private textureMatrix = mat4.create();
    public visible = true;

    constructor(cache: GfxRenderCache, public drawCall: BIN.LevelDrawCall, textures: TextureData[], isSkybox: boolean) {
        if (isSkybox)
            this.layer += drawCall.isTranslucent ? RenderLayer.XLU_SKYBOX : RenderLayer.OPA_SKYBOX;
        else if (drawCall.flags & 0x10)
            this.layer += drawCall.isTranslucent ? RenderLayer.XLU_LIGHTING : RenderLayer.OPA_LIGHTING;
        else {
            this.layer += drawCall.isTranslucent ? RenderLayer.XLU : RenderLayer.OPA;
            this.depthSort = true;
        }
        const gsConfiguration = this.drawCall.gsConfiguration;
        const program = new FFXProgram(gsConfiguration);

        const zte = !!((gsConfiguration.test_1_data0 >>> 16) & 0x01);
        const ztst: GSDepthCompareMode = (gsConfiguration!.test_1_data0 >>> 17) & 0x03;
        assert(zte);

        this.megaStateFlags = {
            depthCompare: reverseDepthForCompareMode(translateDepthCompareMode(ztst)),
            depthWrite: gsConfiguration.depthWrite,
            cullMode: gsConfiguration.cullingEnabled ? GfxCullMode.Front : GfxCullMode.None,
        };

        if ((gsConfiguration.prim & 0x40) !== 0 && gsConfiguration.alpha_data0 !== 0) {
            if (gsConfiguration.alpha_data0 === 0x44) {
                setAttachmentStateSimple(this.megaStateFlags, {
                    blendMode: GfxBlendMode.Add,
                    blendSrcFactor: GfxBlendFactor.SrcAlpha,
                    blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                });
            } else if (gsConfiguration.alpha_data0 === 0x48) {
                setAttachmentStateSimple(this.megaStateFlags, {
                    blendMode: GfxBlendMode.Add,
                    blendSrcFactor: GfxBlendFactor.SrcAlpha,
                    blendDstFactor: GfxBlendFactor.One,
                });
            } else {
                throw `unknown alpha blend setting ${hexzero(gsConfiguration.alpha_data0, 2)}`;
            }
        } else { // alpha blending disabled
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.One,
                blendDstFactor: GfxBlendFactor.Zero,
            });
        }

        if (gsConfiguration.prim & 0x20)
            program.defines.set("FOG", "1");

        program.defines.set("EFFECT", drawCall.effectType.toString());

        if (drawCall.textureIndex >= 0) {
            program.defines.set("TEXTURE", "1");

            const lcm = (gsConfiguration.tex1_1_data0 >>> 0) & 0x01;
            const mxl = (gsConfiguration.tex1_1_data0 >>> 2) & 0x07;
            assert(lcm === 0x00);
            assert(mxl === 0x00);

            const texMagFilter: GSTextureFilter = (gsConfiguration.tex1_1_data0 >>> 5) & 0x01;
            const texMinFilter: GSTextureFilter = (gsConfiguration.tex1_1_data0 >>> 6) & 0x07;
            const [minFilter, mipFilter] = translateTextureFilter(texMinFilter);
            const [magFilter] = translateTextureFilter(texMagFilter);
            const isNoMip = texMagFilter === GSTextureFilter.LINEAR || texMagFilter === GSTextureFilter.NEAREST;

            const wrapS = translateWrapMode(gsConfiguration.clamp.wms);
            const wrapT = translateWrapMode(gsConfiguration.clamp.wmt);

            this.textureMappings.push(new TextureMapping());
            this.textureMappings[0].gfxSampler = cache.createSampler({
                minFilter, magFilter, mipFilter,
                wrapS, wrapT,
                minLOD: 0,
                maxLOD: isNoMip ? 0 : 100,
            });
            const tex = textures[drawCall.textureIndex];
            this.textureMappings[0].gfxTexture = tex.gfxTexture;

            // we cropped region_* textures, so we need to remap the UVs to compensate
            // there are some areas (The Nucleus)
            if (gsConfiguration.clamp.wms >= GSWrapMode.REGION_CLAMP) {
                this.textureMatrix[0] = (1 << gsConfiguration.tex0.tw) / tex.data.width;
                if (gsConfiguration.clamp.wms === GSWrapMode.REGION_CLAMP)
                    this.textureMatrix[12] = -gsConfiguration.clamp.minu / tex.data.width;
            }
            if (gsConfiguration.clamp.wmt >= GSWrapMode.REGION_CLAMP) {
                this.textureMatrix[5] = (1 << gsConfiguration.tex0.th) / tex.data.height;
                if (gsConfiguration.clamp.wmt === GSWrapMode.REGION_CLAMP)
                    this.textureMatrix[13] = -gsConfiguration.clamp.minv / tex.data.height;
            }
        }

        this.gfxProgram = cache.createProgram(program);
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: ReadonlyMat4, envMap: ReadonlyMat4, params: vec3, textureRemaps: GfxTexture[]): void {
        if (!this.visible)
            return;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = makeSortKey(this.layer);
        // TODO: should we not merge the ones that need depth sorting?
        if (this.depthSort) {
            transformVec3Mat4w1(posScrath, scratchMatrix, this.drawCall.center);
            renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, -posScrath[2], 2000);
        }
        renderInst.setDrawCount(this.drawCall.indexCount, this.drawCall.indexOffset);

        if (this.drawCall.textureIndex >= 0) {
            const newTex = textureRemaps[this.drawCall.textureIndex];
            if (newTex !== undefined)
                this.textureMappings[0].gfxTexture = newTex;
            renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        }

        let offs = renderInst.allocateUniformBuffer(FFXProgram.ub_ModelParams, 12*2 + 8 + 4);
        const mapped = renderInst.mapUniformBufferF32(FFXProgram.ub_ModelParams);
        mat4.mul(scratchMatrix, FFXToNoclip, modelMatrix);
        mat4.mul(scratchMatrix, viewerInput.camera.viewMatrix, scratchMatrix);
        offs += fillMatrix4x3(mapped, offs, scratchMatrix);
        offs += fillMatrix4x3(mapped, offs, envMap);
        offs += fillMatrix4x2(mapped, offs, this.textureMatrix);
        offs += fillVec3v(mapped, offs, params)
        renderInstManager.submitRenderInst(renderInst);
    }
}

const actorBindingLayout: GfxBindingLayoutDescriptor[] = [{
    numUniformBuffers: 2,
    numSamplers: 3,
    samplerEntries: [
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.UnfilterableFloat },
        { dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.Float },
    ]
}];

export class ActorPartInstance {
    public drawCalls: ActorDrawCallInstance[] = [];
    public visible = true;
    public vtxTexMapping: TextureMapping = new TextureMapping();
    public envMapTexMapping: TextureMapping = new TextureMapping();

    constructor(cache: GfxRenderCache, public data: ActorModelData, public part: BIN.ActorPart, textures: TextureData[], private envMap: TextureData) {
        for (let i = 0; i < this.part.drawCalls.length; i++)
            this.drawCalls.push(new ActorDrawCallInstance(cache, this.part.drawCalls[i], textures, true));

        this.envMapTexMapping.gfxTexture = envMap.gfxTexture;
        this.envMapTexMapping.gfxSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear, magFilter: GfxTexFilterMode.Bilinear, mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp, wrapT: GfxWrapMode.Clamp,
            minLOD: 0, maxLOD: 0,
        });
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4, scale: number, params: BIN.ScaleData, bakedShadow: number, textureRemaps: GfxTexture[], lateActors: boolean, updatedTexture?: GfxTexture): void {
        if (!this.visible)
            return;

        mat4.mul(scratchMatrix, FFXToNoclip, modelMatrix);
        mat4.mul(scratchMatrix, viewerInput.camera.viewMatrix, scratchMatrix);


        const template = renderInstManager.pushTemplate();
        template.setBindingLayouts(actorBindingLayout);
        template.setVertexInput(this.data.inputLayout, this.data.vertexBufferDescriptors, this.data.indexBufferDescriptor);
        const layer = GfxRendererLayer.TRANSLUCENT + (lateActors ? RenderLayer.LATE_ACTOR : RenderLayer.ACTOR);
        template.sortKey = makeSortKey(layer);
        if (updatedTexture) {
            this.vtxTexMapping.gfxTexture = updatedTexture;
        } else {
            this.vtxTexMapping.gfxTexture = this.data.vertexTexture;
        }
        this.vtxTexMapping.gfxSampler = this.data.vertexSampler;
        let offs = template.allocateUniformBuffer(FFXProgram.ub_ModelParams, 12*2 + 4*4);
        const mapped = template.mapUniformBufferF32(FFXProgram.ub_ModelParams);
        offs += fillMatrix4x3(mapped, offs, scratchMatrix);
        getMatrixTranslation(posScrath, scratchMatrix);
        scaleMatrix(scratchMatrix, scratchMatrix, 1/scale);
        offs += fillMatrix4x3(mapped, offs, scratchMatrix);
        // compute side and up vectors for env map
        vec3.cross(scratchVec, Vec3UnitZ, posScrath);
        vec3.normalize(scratchVec, scratchVec);
        offs += fillVec3v(mapped, offs, scratchVec);
        vec3.cross(scratchVec, scratchVec, posScrath);
        vec3.normalize(scratchVec, scratchVec);
        offs += fillVec3v(mapped, offs, scratchVec);

        offs += fillVec4v(mapped, offs, params.specular);
        offs += fillVec4(mapped, offs, params.envMap, params.deflection, bakedShadow);

        for (let i = 0; i < this.drawCalls.length; i++)
            this.drawCalls[i].prepareToRender(renderInstManager, textureRemaps, this.vtxTexMapping, this.envMapTexMapping);

        renderInstManager.popTemplate();
    }
}

export function findTextureIndex(frame: number, effect: BIN.PartEffect): number {
    frame = frame % effect.length;
    let key = effect.keyframes[0];
    for (let i = 0; i < effect.keyframes.length; i++) {
        key = effect.keyframes[i];
        if (frame < key.start + key.duration) {
            break;
        }
    }
    return key.data[1][0];
}

export enum EulerOrder {
    XYZ,
    YXZ,
    ZXY,
    XZY,
    YZX,
    ZYX,
}

export function rotationMatrixFromEuler(dst: mat4, angles: vec3, order: EulerOrder): void {
    switch (order) {
    case EulerOrder.XYZ:
        computeModelMatrixR(dst, angles[0], angles[1], angles[2]);
        break;
    case EulerOrder.ZXY:
        mat4.fromYRotation(dst, angles[1]);
        mat4.rotateX(dst, dst, angles[0]);
        mat4.rotateZ(dst, dst, angles[2]);
        break;
    case EulerOrder.ZYX:
        mat4.fromXRotation(dst, angles[0]);
        mat4.rotateY(dst, dst, angles[1]);
        mat4.rotateZ(dst, dst, angles[2]);
        break;
    case EulerOrder.XZY:
        mat4.fromYRotation(dst, angles[1]);
        mat4.rotateZ(dst, dst, angles[2]);
        mat4.rotateX(dst, dst, angles[0]);
        break;
    case EulerOrder.YZX:
        mat4.fromXRotation(dst, angles[0]);
        mat4.rotateZ(dst, dst, angles[2]);
        mat4.rotateY(dst, dst, angles[1]);
        break;
    default:
        console.warn('unimplemented euler order', order);
    }
}

const scratchVec = vec3.create();
export function applyEffect(dst: mat4, params: vec3, basePos: vec3, frame: number, effect: BIN.PartEffect, eulerOrder: EulerOrder, runOnce: boolean): void {
    if (runOnce)
        frame = clamp(frame, 0, effect.length)
    else
        frame = frame % effect.length;

    let key = effect.keyframes[0];
    for (let i = 0; i < effect.keyframes.length; i++) {
        key = effect.keyframes[i];
        if (frame < key.start + key.duration) {
            break;
        }
    }
    const t = (frame - key.start) / key.duration;
    switch (key.format) {
        case BIN.KeyframeFormat.CONSTANT: {
            vec3.copy(scratchVec, key.data[0]);
        } break;
        case BIN.KeyframeFormat.LINEAR: {
            vec3.lerp(scratchVec, key.data[0], key.data[1], t);
        } break;
        case BIN.KeyframeFormat.SPLINE: {
            for (let i = 0; i < 3; i++)
                scratchVec[i] = getPointHermite(key.data[2][i], key.data[3][i], key.data[0][i], key.data[1][i], t);
        } break;
    }

    switch (effect.type) {
        case BIN.EffectType.MOTION: {
            setMatrixTranslation(dst, scratchVec);
        } break;
        case BIN.EffectType.ROTATION: {
            mat4.copy(scratchMatrix, dst);
            rotationMatrixFromEuler(dst, scratchVec, eulerOrder);

            dst[12] = scratchMatrix[12];
            dst[13] = scratchMatrix[13];
            dst[14] = scratchMatrix[14];
        } break;
        case BIN.EffectType.PARAMETER: {
            vec3.copy(params, scratchVec);
        } break;
        case BIN.EffectType.COMBINED: {
            rotationMatrixFromEuler(dst, key.data[0], eulerOrder);
            vec3.add(scratchVec, basePos, key.data[1]);

            setMatrixTranslation(dst, scratchVec);
        } break;
        default: return;
    }
}

// LevelPartInstance is a logical grouping of level models that move together and act on the same effect data
export class LevelPartInstance {
    public modelMatrix = mat4.create();
    public effectParams = vec3.create();
    public visible = true;
    public drawCalls: LevelDrawCallInstance[] = [];

    constructor(cache: GfxRenderCache, public part: BIN.LevelPart, public data: LevelModelData, textures: TextureData[]) {
        computeModelMatrixR(this.modelMatrix, part.euler[0], part.euler[1], part.euler[2]);
        setMatrixTranslation(this.modelMatrix, vec3.fromValues(part.position[0], part.position[1], part.position[2]));
        for (let dc of assertExists(part.model).drawCalls) {
            const drawCall = new LevelDrawCallInstance(cache, dc, textures, part.isSkybox);
            this.drawCalls.push(drawCall);
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, envMap: ReadonlyMat4, textureRemaps: GfxTexture[]): void {
        if (!this.visible)
            return;

        const template = renderInstManager.pushTemplate();
        template.setVertexInput(this.data.inputLayout, this.data.vertexBufferDescriptors, this.data.indexBufferDescriptor);
        for (let i = 0; i < this.drawCalls.length; i++)
            this.drawCalls[i].prepareToRender(renderInstManager, viewerInput, this.modelMatrix, envMap, this.effectParams, textureRemaps);
        renderInstManager.popTemplate();
    }
}

const blendScratch: Partial<AttachmentStateSimple> = {
    blendMode: GfxBlendMode.Add,
    blendSrcFactor: GfxBlendFactor.SrcAlpha,
    blendDstFactor: GfxBlendFactor.One,
}

function translateBlendMode(dst: Partial<GfxMegaStateDescriptor>, blend: number): void {
    switch (blend) {
        case 0x00:
            blendScratch.blendMode = GfxBlendMode.Add;
            blendScratch.blendSrcFactor = GfxBlendFactor.One;
            blendScratch.blendDstFactor = GfxBlendFactor.Zero;
            break;
        case 0x42:
            blendScratch.blendMode = GfxBlendMode.ReverseSubtract;
            blendScratch.blendSrcFactor = GfxBlendFactor.SrcAlpha;
            blendScratch.blendDstFactor = GfxBlendFactor.One;
            break;
        case 0x44: case 0x04:
            // 4 is actually (1+alpha), (1-alpha), so extra additive...
            blendScratch.blendMode = GfxBlendMode.Add;
            blendScratch.blendSrcFactor = GfxBlendFactor.SrcAlpha;
            blendScratch.blendDstFactor = GfxBlendFactor.OneMinusSrcAlpha;
            break;
        case 0x48:
            blendScratch.blendMode = GfxBlendMode.Add;
            blendScratch.blendSrcFactor = GfxBlendFactor.SrcAlpha;
            blendScratch.blendDstFactor = GfxBlendFactor.One;
            break;
        case 0x46: // only for magic??
            blendScratch.blendMode = GfxBlendMode.Add;
            blendScratch.blendSrcFactor = GfxBlendFactor.Zero;
            blendScratch.blendDstFactor = GfxBlendFactor.OneMinusSrcAlpha;
            break;
        case 0x88:
            blendScratch.blendMode = GfxBlendMode.Add;
            blendScratch.blendSrcFactor = GfxBlendFactor.SrcAlpha;
            blendScratch.blendDstFactor = GfxBlendFactor.Zero;
            break;
        default:
            throw `bad blend type ${hexzero(blend, 2)}`;
    }
    setAttachmentStateSimple(dst, blendScratch);
}

interface ReusableBuffer {
    buffer: Float32Array;
    u8View: Uint8Array;
    gfxBuffer: GfxBuffer;
    descs: GfxVertexBufferDescriptor[];
}

class BufferPool {
    private buffers: ReusableBuffer[] = [];
    private nextIndex = 0;

    constructor(public floatCount: number) {}

    public get(device: GfxDevice): ReusableBuffer {
        const prevIndex = this.nextIndex;
        this.nextIndex++;
        if (prevIndex < this.buffers.length) {
            const toUse = this.buffers[prevIndex];
            toUse.descs[0].buffer = toUse.gfxBuffer;
            toUse.descs[0].byteOffset = 0;
            toUse.descs[1].buffer = toUse.gfxBuffer;
            toUse.descs[1].byteOffset = 0;
            return toUse;
        }
        // allocate new buffer
        const buffer = new Float32Array(this.floatCount);
        const gfxBuffer = device.createBuffer(buffer.byteLength, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Dynamic);
        const descs: GfxVertexBufferDescriptor[] = nArray(2, () => ({ buffer: gfxBuffer } as GfxVertexBufferDescriptor));

        const b: ReusableBuffer = { buffer, gfxBuffer, descs, u8View: new Uint8Array(buffer.buffer) };
        this.buffers.push(b);
        return b;
    }

    public postRender(device: GfxDevice): void {
        for (let i = 0; i < this.nextIndex; i++)
            device.uploadBufferData(this.buffers[i].gfxBuffer, 0, this.buffers[i].u8View);
        this.nextIndex = 0;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.buffers.length; i++)
            device.destroyBuffer(this.buffers[i].gfxBuffer);
    }
}

export class BufferPoolManager {
    private pools = new Map<number, BufferPool>();

    public getBuffer(device: GfxDevice, floatCount: number): ReusableBuffer {
        const rounded = (floatCount + 0xFF) & (~0xFF);
        let pool = this.pools.get(rounded);
        if (!pool) {
            pool = new BufferPool(rounded);
            this.pools.set(rounded, pool);
        }
        return pool.get(device);
    }

    public postRender(device: GfxDevice): void {
        for (let pool of this.pools.values())
            pool.postRender(device);
    }

    public destroy(device: GfxDevice): void {
        for (let pool of this.pools.values())
            pool.destroy(device);
    }
}


export class FlipbookRenderer {
    private gfxProgram: GfxProgram;
    private trailProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private textureMappings: TextureMapping[] = [new TextureMapping()];

    constructor(cache: GfxRenderCache, private textures: TextureData[]) {
        const program = new FlipbookProgram();

        this.megaStateFlags = {
            depthCompare: GfxCompareMode.GreaterEqual,
            depthWrite: false,
            cullMode: GfxCullMode.None,
        };

        const [magFilter] = translateTextureFilter(GSTextureFilter.LINEAR);
        const [minFilter, mipFilter] = translateTextureFilter(GSTextureFilter.LINEAR);

        const wrapS = GfxWrapMode.Clamp;
        const wrapT = GfxWrapMode.Clamp;

        this.textureMappings[0].gfxSampler = cache.createSampler({
            minFilter, magFilter, mipFilter,
            wrapS, wrapT,
            minLOD: 0, maxLOD: 100,
        });
        this.gfxProgram = cache.createProgram(program);
        this.trailProgram = cache.createProgram(new TrailProgram());
    }

    public render(renderInstManager: GfxRenderInstManager, data: FlipbookData, frameIndex: number, color: ReadonlyVec4, modelMatrix: mat4, depthOffset = 0, isGlare = false): void {
        const template = renderInstManager.pushTemplate();
        const frame = data.flipbook.frames[frameIndex];
        this.textureMappings[0].gfxTexture = this.textures[data.flipbook.textureIndex].gfxTexture;
        template.setGfxProgram(this.gfxProgram);
        template.setVertexInput(data.inputLayout, data.vertexBufferDesc, data.indexBufferDesc);
        template.setSamplerBindingsFromTextureMappings(this.textureMappings);

        let offs = template.allocateUniformBuffer(FlipbookProgram.ub_ModelParams, 12 + 8);
        const mapped = template.mapUniformBufferF32(FlipbookProgram.ub_ModelParams);
        offs += fillMatrix4x3(mapped, offs, modelMatrix);
        offs += fillVec4v(mapped, offs, color);
        offs += fillVec4(mapped, offs, depthOffset);

        getMatrixTranslation(scratchVec, modelMatrix);
        const dist = vec3.len(scratchVec);
        template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + RenderLayer.PARTICLES);
        template.sortKey = setSortKeyDepth(template.sortKey, dist, 500);

        // draw glare without depth test, obviously not good for arbitrary camera angles, but the game can get away with it
        // really only important for oasis, maybe we should just make that water translucent
        this.megaStateFlags.depthCompare = isGlare ? GfxCompareMode.Always : GfxCompareMode.GreaterEqual;
        for (let i =0; i < frame.draws.length; i++) {
            const renderInst = renderInstManager.newRenderInst();
            translateBlendMode(this.megaStateFlags, frame.draws[i].blend);
            renderInst.setMegaStateFlags(this.megaStateFlags);
            renderInst.setDrawCount(frame.draws[i].rectCount*6, frame.draws[i].indexStart);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplate();
    }

    public renderTrail(device: GfxDevice, renderInstManager: GfxRenderInstManager, bufferManager: BufferPoolManager, data: FlipbookData, frameIndex: number, modelMatrix: ReadonlyMat4, args: TrailArgs): void {
        const template = renderInstManager.pushTemplate();
        this.textureMappings[0].gfxTexture = this.textures[data.flipbook.textureIndex].gfxTexture;
        template.setGfxProgram(this.trailProgram);
        // fill in instanced vertex buffer with positions
        let offs = 0;
        const buf = bufferManager.getBuffer(device, args.pointCount*8);
        for (let i = 0; i < args.pointCount; i++) {
            offs += fillVec3v(buf.buffer, offs, args.points[i], args.params[i][1]);
            const myIndex = frameIndex + args.params[i][0]/data.flipbook.frames[0].duration;
            const frame = data.flipbook.frames[(myIndex | 0) % data.flipbook.frames.length];
            let minVertex = 0, maxVertex = 0;
            if (args.commonFrame) {
                // allow drawing every vertex
                minVertex = 0;
                maxVertex = data.totalQuads * 4;
            } else {
                assert(data.flipbook.trailCompatible);
                // fill in vertex range to select frame
                minVertex = frame.draws[0].indexStart * 2 / 3; // 6 indices vs 4 vertices (per quad)
                maxVertex = minVertex + frame.draws[0].rectCount*4;
            }
            offs += fillVec4(buf.buffer, offs, minVertex, maxVertex, args.params[i][2]);
        }
        buf.descs[0].buffer = data.vertexBufferDesc[0].buffer;
        buf.descs[1].buffer = buf.gfxBuffer;
        template.setVertexInput(data.inputLayout, buf.descs, data.indexBufferDesc);
        template.setSamplerBindingsFromTextureMappings(this.textureMappings);

        const baseDraws = data.flipbook.frames[frameIndex | 0].draws;
        for (let i = 0; i < baseDraws.length; i++) {
            const renderInst = renderInstManager.newRenderInst();
            offs = renderInst.allocateUniformBuffer(FlipbookProgram.ub_ModelParams, 12 + 4*4);
            const mapped = renderInst.mapUniformBufferF32(FlipbookProgram.ub_ModelParams);
            offs += fillMatrix4x3(mapped, offs, modelMatrix);
            offs += fillVec4v(mapped, offs, args.headColor);
            offs += fillVec4v(mapped, offs, args.tailColor);
            offs += fillVec4(mapped, offs, args.headScale, args.tailScale, args.scaleRange, args.maxLength);
            if (args.commonFrame)
                offs += fillVec4(mapped, offs, 0);
            else // shift the vertex range we want by the number of previous rects
                offs += fillVec4(mapped, offs, baseDraws[0].rectCount * 4 * i);

            renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + RenderLayer.PARTICLES);
            renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, -args.points[0][2], 500);
            translateBlendMode(this.megaStateFlags, baseDraws[i].blend);
            renderInst.setMegaStateFlags(this.megaStateFlags);
            renderInst.setInstanceCount(args.pointCount);
            if (args.commonFrame) {
                renderInst.setDrawCount(baseDraws[i].rectCount * 6, baseDraws[i].indexStart);
            } else { // draw everything, shader will pick the frame
                renderInst.setDrawCount(data.totalQuads * 6, 0);
            }

            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplate();
    }
}

enum ParticleGeoFlags {
    XLU = 1,
    DRAW_BACK = 2,
    TEX_WRAP = 4,
}

enum ParticleArgFlags {
    ZTEST = 8,
    BACK_CULL = 0x10,
    NORMALS = 0x40,
    RESEND_REGS = 0x80, // still confused here
    FADE = 0x100,
    FOG = 0x200,
    FLOAT_FORMAT = 0x400, // hopefully unused?
}

export const prevFrameBinding = "prevFrame";

class ParticleDrawCallInstance {
    private gfxProgram: GfxProgram;
    private waterProgram: GfxProgram;
    private textureSize = vec2.create();
    public textureMappings: TextureMapping[] = [];
    public textureMatrix = mat4.create();

    constructor(cache: GfxRenderCache, public geo: ParticleGeometryEntry, public index: number, textures: TextureData[]) {
        const program = new ParticleProgram();
        assert(geo.geometry !== undefined);
        const dc = geo.geometry.drawCalls[index];

        if (dc.texIndex >= 0 || geo.lateBindingTex) {
            program.defines.set("TEXTURE", "1");
            this.textureMappings.push(new TextureMapping());

            let wrapMode = (geo.flags & ParticleGeoFlags.TEX_WRAP) ? GfxWrapMode.Repeat : GfxWrapMode.Clamp;

            if (dc.texIndex >= 0) {
                const tex = textures[dc.texIndex];
                this.textureMappings[0].gfxTexture = tex.gfxTexture;
                vec2.set(this.textureSize, tex.data.width, tex.data.height);
            } else {
                this.textureMappings[0].lateBinding = geo.lateBindingTex!;
                wrapMode = GfxWrapMode.Clamp;
            }
            this.textureMappings[0].gfxSampler = cache.createSampler({
                minFilter: GfxTexFilterMode.Bilinear,
                magFilter: GfxTexFilterMode.Bilinear,
                mipFilter: GfxMipFilterMode.Nearest,
                wrapS: wrapMode, wrapT: wrapMode,
                minLOD: 0, maxLOD: 0,
            });
        }

        this.gfxProgram = cache.createProgram(program);
        this.waterProgram = cache.createProgram(new WaterProgram());
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, uShift: number, vShift: number, waterCount = 0): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram((waterCount > 0)? this.waterProgram : this.gfxProgram);

        const dc = this.geo.geometry!.drawCalls[this.index];

        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);

        if (this.textureMappings.length > 0) {
            if (!this.textureMappings[0].lateBinding) {
                this.textureMatrix[12] = uShift / this.textureSize[0];
                this.textureMatrix[13] = vShift / this.textureSize[1];
            }
        }

        let offs = renderInst.allocateUniformBuffer(ParticleProgram.ub_DrawParams, 8);
        const mapped = renderInst.mapUniformBufferF32(ParticleProgram.ub_DrawParams);
        offs += fillMatrix4x2(mapped, offs, this.textureMatrix);

        if (waterCount > 0) {
            renderInst.setDrawCount(dc.indexCount, dc.startIndex);
            renderInst.setInstanceCount(waterCount);
        } else
            renderInst.setDrawCount(dc.indexCount, dc.startIndex);

        renderInstManager.submitRenderInst(renderInst);
    }
}

class ShatterDrawCallInstance {
    private shatterProgram: GfxProgram;
    private textureMappings: TextureMapping[] = [];

    constructor(cache: GfxRenderCache, public geo: ParticleGeometryEntry, public index: number, texture: TextureData) {
        assert(geo.geometry !== undefined);
        this.textureMappings.push(new TextureMapping(), new TextureMapping());

        this.textureMappings[0].lateBinding = geo.lateBindingTex!;
        this.textureMappings[0].gfxSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp, wrapT: GfxWrapMode.Clamp,
            minLOD: 0, maxLOD: 0,
        });
        this.textureMappings[1].gfxTexture = texture.gfxTexture;
        this.textureMappings[1].gfxSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Repeat, wrapT: GfxWrapMode.Repeat,
            minLOD: 0, maxLOD: 0,
        });

        this.shatterProgram = cache.createProgram(new ShatterProgram());
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.shatterProgram);

        const dc = this.geo.geometry!.drawCalls[this.index];
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setDrawCount(dc.indexCount, dc.startIndex);
        renderInstManager.submitRenderInst(renderInst);
    }
}

enum GeoParticleRenderFlags {
    DEFAULT = 0,
    MULTIPART = 1, // each part is depth sorted independently
    EARLY = 2,
    OPAQUE = 4,
}

const particleBindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 3, numSamplers: 1 }];
const shatterBindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 2, numSamplers: 2 }];
export class GeoParticleInstance {
    public drawCalls: ParticleDrawCallInstance[] = [];
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    constructor(cache: GfxRenderCache, public geo: ParticleGeometryEntry, public data: LevelModelData, textures: TextureData[]) {
        assert(geo.geometry !== undefined);
        for (let i = 0; i < geo.geometry?.drawCalls.length; i++) {
            this.drawCalls.push(new ParticleDrawCallInstance(cache, geo, i, textures))
        }

        this.megaStateFlags = {
            depthCompare: GfxCompareMode.GreaterEqual,
            depthWrite: (geo.flags & ParticleGeoFlags.XLU) === 0,
            // TODO: look at kilika forest sun beams
            cullMode: GfxCullMode.None,// (geo.flags & ParticleGeoFlags.DRAW_BACK) ? GfxCullMode.None : GfxCullMode.Back,
            polygonOffset: true,
        };
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, modelViewMatrix: mat4, blend: number, uShift: number, vShift: number, colorFactor: vec4, depthOffset = 0, mode = GeoParticleMode.DEFAULT, flags = GeoParticleRenderFlags.DEFAULT, param = 0): void {
        const template = renderInstManager.pushTemplate();
        if (blend < 0)
            blend = this.geo.blendSettings;
        if (this.geo.lateBindingTex === prevFrameBinding)
            blend = 0x44;
        translateBlendMode(this.megaStateFlags, blend);
        let sort = true;
        this.megaStateFlags.depthWrite = (this.geo.flags & ParticleGeoFlags.XLU) === 0;
        if (flags & GeoParticleRenderFlags.OPAQUE) {
            this.megaStateFlags.depthWrite = true;
            sort = false;
        } else if (flags & GeoParticleRenderFlags.EARLY) {
            sort = false;
        }
        template.setMegaStateFlags(this.megaStateFlags);
        template.setVertexInput(this.data.inputLayout, this.data.vertexBufferDescriptors, this.data.indexBufferDescriptor);
        template.setBindingLayouts(particleBindingLayouts);

        template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + (sort ? RenderLayer.PARTICLES : RenderLayer.OPA_PARTICLES));
        if (sort) {
            getMatrixTranslation(scratchVec, modelViewMatrix);
            if (vec3.len(scratchVec) < 1) {
                // "simple" particles compute their depth based on where they would send the origin (in model coordinates)
                // for particles exactly at the camera, this ends up dividing by negative zero, which has the effect of making these render *last*
                // I can't tell if it's intentional, but the requiem effect is wrong without this sorting behavior
                template.sortKey = setSortKeyDepth(template.sortKey, 500, 500);

            } else {
                // some particle meshes are positioned "at" the origin, with the mesh actually modeled in level-space
                // so look at some notion of center to improve sorting
                const geo = assertExists(this.geo.geometry);
                transformVec3Mat4w1(scratchVec, modelViewMatrix, geo.center);
                const centerDepth = vec3.len(scratchVec);
                template.sortKey = setSortKeyDepth(template.sortKey, centerDepth + depthOffset, 500);
            }
        }

        let offs = template.allocateUniformBuffer(ParticleProgram.ub_ModelParams, 12  + 2*4);
        const mapped = template.mapUniformBufferF32(ParticleProgram.ub_ModelParams);
        offs += fillMatrix4x3(mapped, offs, modelViewMatrix);
        offs += fillVec4v(mapped, offs, colorFactor);
        offs += fillVec4(mapped, offs, depthOffset, mode, param);

        for (let i = 0; i < this.drawCalls.length; i++) {
            this.drawCalls[i].prepareToRender(renderInstManager, uShift, vShift);
        }

        renderInstManager.popTemplate();
    }

    public renderWater(renderInstManager: GfxRenderInstManager, modelViewMatrix: mat4, uShift: number, vShift: number, colorFactor: vec4, args: WaterArgs): void {
        const template = renderInstManager.pushTemplate();
        translateBlendMode(this.megaStateFlags, this.geo.blendSettings);
        template.setMegaStateFlags(this.megaStateFlags);
        template.setVertexInput(this.data.inputLayout, this.data.vertexBufferDescriptors, this.data.indexBufferDescriptor);
        template.setBindingLayouts(particleBindingLayouts);
        template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + RenderLayer.PARTICLES);
        template.sortKey = setSortKeyDepth(template.sortKey, -modelViewMatrix[14], 500);

        let offs = template.allocateUniformBuffer(ParticleProgram.ub_ModelParams, 12 + 8*4);
        const mapped = template.mapUniformBufferF32(ParticleProgram.ub_ModelParams);
        offs += fillMatrix4x3(mapped, offs, modelViewMatrix);
        offs += fillVec4v(mapped, offs, colorFactor);
        const geo = assertExists(this.geo.geometry);
        const xRange = geo.vtxMax[0] - geo.vtxMin[0];
        const zRange = geo.vtxMax[2] - geo.vtxMin[2];
        const halfSide = Math.floor(1 + args.radius/Math.hypot(xRange, zRange));
        const squareCount = Math.pow(2*halfSide + 1, 2);
        offs += fillVec4(mapped, offs, xRange, zRange, halfSide, args.fog ? 1 : 0);
        offs += fillVec4v(mapped, offs, args.xPhase);
        offs += fillVec4v(mapped, offs, args.xAmplitude);
        offs += fillVec4v(mapped, offs, args.xFrequency);
        offs += fillVec4v(mapped, offs, args.diagPhase);
        offs += fillVec4v(mapped, offs, args.diagAmplitude);
        offs += fillVec4v(mapped, offs, args.diagFrequency);
        for (let i = 0; i < this.drawCalls.length; i++) {
            this.drawCalls[i].prepareToRender(renderInstManager, uShift, vShift, squareCount);
        }
        renderInstManager.popTemplate();
    }
}

export class ShatterParticleInstance {
    public drawCalls: ShatterDrawCallInstance[] = [];
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    public textureMatrix = mat4.create();
    public visible = true;

    constructor(cache: GfxRenderCache, public geo: ParticleGeometryEntry, public data: LevelModelData, envMapTexture: TextureData) {
        assert(geo.geometry !== undefined);
        for (let i = 0; i < geo.geometry?.drawCalls.length; i++) {
            this.drawCalls.push(new ShatterDrawCallInstance(cache, geo, i, envMapTexture))
        }
        this.megaStateFlags = {
            depthCompare: GfxCompareMode.GreaterEqual,
            depthWrite: true,
            cullMode: GfxCullMode.Back,
        };
        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.One,
            blendDstFactor: GfxBlendFactor.Zero,
        });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, modelViewMatrix: ReadonlyMat4, justRotation: ReadonlyMat4): void {
        if (!this.visible)
            return;
        const template = renderInstManager.pushTemplate();
        template.setMegaStateFlags(this.megaStateFlags);
        template.setVertexInput(this.data.inputLayout, this.data.vertexBufferDescriptors, this.data.indexBufferDescriptor);
        template.setBindingLayouts(shatterBindingLayouts);
        template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + RenderLayer.PARTICLES);
        let offs = template.allocateUniformBuffer(ParticleProgram.ub_ModelParams, 12*2 + 8 + 4*5);
        const mapped = template.mapUniformBufferF32(ParticleProgram.ub_ModelParams);
        offs += fillMatrix4x3(mapped, offs, modelViewMatrix);
        offs += fillMatrix4x3(mapped, offs, justRotation);
        offs += fillMatrix4x2(mapped, offs, this.textureMatrix);

        for (let i = 0; i < this.drawCalls.length; i++) {
            this.drawCalls[i].prepareToRender(renderInstManager);
        }
        renderInstManager.popTemplate();
    }
}

class RainProgram extends DeviceProgram {
    public static a_Position = 0;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(std140) uniform ub_ModelParams {
    Mat3x4 u_View;
    vec4 u_Color;
    vec4 u_Down;
    vec4 u_Across;
};
`;

    public override vert = `
layout(location = 0) in vec4 a_Position;

void main() {
    vec3 viewPos = UnpackMatrix(u_View) * vec4(a_Position.xyz, 1.0);
    if ((gl_VertexID & 2) != 0)
        viewPos += a_Position.w * u_Down.xyz;
    // these were lines on PS2, so constant width about what a pixel would have looked like
    if ((gl_VertexID & 1) != 0)
        viewPos += .002*viewPos.z*u_Across.xyz;
    gl_Position = UnpackMatrix(u_Projection) * vec4(viewPos, 1.0);
}
`;

    public override frag = `
void main() {
    gl_FragColor = u_Color;
}
`;
}

const rectIndices = new Uint16Array([0, 1, 2, 1, 2, 3]);

export class RainData {
    private indexBuffer: GfxBuffer;

    public inputLayout: GfxInputLayout;
    public indexBufferDesc: GfxIndexBufferDescriptor;

    constructor(cache: GfxRenderCache) {
        this.indexBuffer = createBufferFromData(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, rectIndices.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: RainProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGBA },
        ];
        const VERTEX_STRIDE = 4;
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: VERTEX_STRIDE * 4, frequency: GfxVertexBufferFrequency.PerInstance, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;

        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
        this.indexBufferDesc = { buffer: this.indexBuffer };
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
    }
}

export class RainRenderer {
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private data: RainData;

    constructor(cache: GfxRenderCache) {
        const program = new RainProgram();

        this.data = new RainData(cache);

        this.megaStateFlags = {
            depthCompare: GfxCompareMode.GreaterEqual,
            depthWrite: false,
            cullMode: GfxCullMode.None,
        };
        setAttachmentStateSimple(this.megaStateFlags, {
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendMode: GfxBlendMode.Add,
        });
        this.gfxProgram = cache.createProgram(program);
    }

    public render(device: GfxDevice, renderInstManager: GfxRenderInstManager, bufferManager: BufferPoolManager, viewerInput: Viewer.ViewerRenderInput, color: vec4, direction: ReadonlyVec4, positions: Float32Array, count: number): void {
        const renderInst = renderInstManager.newRenderInst();

        renderInst.setGfxProgram(this.gfxProgram);
        const buf = bufferManager.getBuffer(device, count * 4);
        buf.buffer.set(positions.subarray(0, count*4));
        renderInst.setVertexInput(this.data.inputLayout, buf.descs, this.data.indexBufferDesc);
        renderInst.setBindingLayouts(noTexBindingLayouts);

        renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + RenderLayer.PARTICLES);
        renderInst.setMegaStateFlags(this.megaStateFlags);

        let offs = renderInst.allocateUniformBuffer(RainProgram.ub_ModelParams, 12 + 3 * 4);
        const mapped = renderInst.mapUniformBufferF32(RainProgram.ub_ModelParams);
        mat4.mul(scratchMatrix, viewerInput.camera.viewMatrix, FFXToNoclip);
        offs += fillMatrix4x3(mapped, offs, scratchMatrix);
        // this color isn't used to modulate a texture, so 0x80 is only half color
        color[0] /= 2;
        color[1] /= 2;
        color[2] /= 2;
        offs += fillVec4v(mapped, offs, color);
        vec3.set(scratchVec, direction[0], direction[1], direction[2]);
        transformVec3Mat4w0(scratchVec, scratchMatrix, scratchVec);
        vec3.normalize(scratchVec, scratchVec);
        offs += fillVec3v(mapped, offs, scratchVec);
        vec3.cross(scratchVec, Vec3UnitZ, scratchVec);
        offs += fillVec3v(mapped, offs, scratchVec);

        renderInst.setDrawCount(6, 0);
        renderInst.setInstanceCount(count);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.data.destroy(device);
    }
}

/*
    0 - 1 - 2 - 3 - 4
    | / | / | / | / |
    5 - 6 - 7 - 8 - 9
*/

const noTexBindingLayouts: GfxBindingLayoutDescriptor[] = [{numUniformBuffers: 2, numSamplers: 0}];

const electricIndices = new Uint16Array([0, 1, 5, 1, 6, 5, 1, 2, 6, 2, 6, 7, 2, 3, 7, 3, 7, 8, 3, 4, 8, 4, 8, 9]);

class ElectricProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Edge = 1;
    public static a_NextPosition = 2;
    public static a_NextEdge = 3;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(std140) uniform ub_ModelParams {
    vec4 u_CoreStartColor;
    vec4 u_EdgeStartColor;
    vec4 u_CoreColorStep;
    vec4 u_EdgeColorStep;
    float u_totalCount;
    float u_coreWidth;
};

varying vec4 v_Color;
`;

    public override vert = `
layout(location = 0) in vec4 a_Position;
layout(location = 1) in vec4 a_Edge;
layout(location = 2) in vec4 a_NextPosition;
layout(location = 3) in vec4 a_NextEdge;

void main() {
    vec4 edge = a_Edge;
    vec4 pos = a_Position;
    float stepCount = float(gl_InstanceID);
    if (gl_VertexID >= 5) {
        pos = a_NextPosition;
        edge = a_NextEdge;
        stepCount += 1.;
    }
    float side = 0.;
    vec4 start = u_EdgeStartColor;
    vec4 step = u_EdgeColorStep;

    // at the start and end, we only want a single point with the "edge" color
    // we marked them by setting edge.w to 0
    int mod = int(gl_VertexID % 5) * int(edge.w);
    if (mod == 0) {
        side = -1.;
        start.a = 0.;
        step.a = 0.;
    } else if (mod == 1) {
        side = -u_coreWidth;
    }  else if (mod == 2) {
        side = 0.;
        start = u_CoreStartColor;
        step = u_CoreColorStep;
    }  else if (mod == 3) {
        side = u_coreWidth;
    }  else if (mod == 4) {
        side = 1.;
        start.a = 0.;
        step.a = 0.;
    }
    vec3 viewPos = pos.xyz + side * edge.xyz;
    gl_Position = UnpackMatrix(u_Projection) * vec4(viewPos, 1.);
    v_Color = clamp(start + stepCount * step, 0., 1.);
}
`;

    public override frag = `
void main() {
    gl_FragColor = v_Color;
}
`;
}

export class ElectricData {
    private indexBuffer: GfxBuffer;

    public inputLayout: GfxInputLayout;
    public indexBufferDesc: GfxIndexBufferDescriptor;
    public vertexBufferDesc: GfxVertexBufferDescriptor[];

    public inUse = false;

    constructor(cache: GfxRenderCache) {
        this.indexBuffer = createBufferFromData(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, electricIndices.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: ElectricProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0 * 4, format: GfxFormat.F32_RGBA },
            { location: ElectricProgram.a_Edge, bufferIndex: 0, bufferByteOffset: 4 * 4, format: GfxFormat.F32_RGBA },
            { location: ElectricProgram.a_NextPosition, bufferIndex: 1, bufferByteOffset: 0 * 4, format: GfxFormat.F32_RGBA },
            { location: ElectricProgram.a_NextEdge, bufferIndex: 1, bufferByteOffset: 4 * 4, format: GfxFormat.F32_RGBA },
        ];

        const VERTEX_STRIDE = 2 * 4;
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: VERTEX_STRIDE * 4, frequency: GfxVertexBufferFrequency.PerInstance, },
            { byteStride: VERTEX_STRIDE * 4, frequency: GfxVertexBufferFrequency.PerInstance, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;

        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.vertexBufferDesc = [{ buffer: null! }];
        this.indexBufferDesc = { buffer: this.indexBuffer };
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
    }
}

export interface BufferFiller {
    fillBuffer(buf: Float32Array, viewerInput: Viewer.ViewerRenderInput): void;
}

const colorScratch = vec4.create();
export class ElectricRenderer {
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private data: ElectricData;

    constructor(cache: GfxRenderCache) {
        const program = new ElectricProgram();

        this.data = new ElectricData(cache);

        this.megaStateFlags = {
            depthCompare: GfxCompareMode.GreaterEqual,
            depthWrite: false,
            cullMode: GfxCullMode.None,
        };
        setAttachmentStateSimple(this.megaStateFlags, {
            blendDstFactor: GfxBlendFactor.One,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendMode: GfxBlendMode.Add,
        });
        this.gfxProgram = cache.createProgram(program);
    }

    public render(device: GfxDevice, renderInstManager: GfxRenderInstManager, bufferManager: BufferPoolManager, viewerInput: Viewer.ViewerRenderInput, colors: vec4[], colorStart: number, count: number, filler: BufferFiller, coreWidth: number, colorOffset: number): void {
        const renderInst = renderInstManager.newRenderInst();

        renderInst.setGfxProgram(this.gfxProgram);
        const buf = bufferManager.getBuffer(device, 8 * count);
        filler.fillBuffer(buf.buffer, viewerInput);
        buf.descs[0].byteOffset = 0;
        buf.descs[1].byteOffset = 4*(4 + 4);
        renderInst.setVertexInput(this.data.inputLayout, buf.descs, this.data.indexBufferDesc);
        renderInst.setBindingLayouts(noTexBindingLayouts);
        renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + RenderLayer.PARTICLES);
        renderInst.setMegaStateFlags(this.megaStateFlags);

        let offs = renderInst.allocateUniformBuffer(ElectricProgram.ub_ModelParams, 4 * 4 + 4);
        const mapped = renderInst.mapUniformBufferF32(ElectricProgram.ub_ModelParams);
        mat4.mul(scratchMatrix, viewerInput.camera.viewMatrix, FFXToNoclip);
        for (let i = 0; i < 4; i++) {
            vec4.scale(colorScratch, colors[i + colorStart], 1/0x8000);
            if (i < 2 && colorOffset > 0) {
                vec4.scaleAndAdd(colorScratch, colorScratch, colors[i + colorStart + 2], colorOffset / 0x8000);
            }
            offs += fillVec4v(mapped, offs, colorScratch);
        }
        offs += fillVec4(mapped, offs, count - 1, coreWidth)

        renderInst.setDrawCount(8 * 3, 0);
        renderInst.setInstanceCount(count - 1);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.data.destroy(device);
    }
}

class FullScreenColorProgram extends DeviceProgram {
    public override vert = GfxShaderLibrary.fullscreenVS;

    public override frag = `
uniform ub_buf {
    vec4 u_Color;
};
void main() {
    gl_FragColor = u_Color;
}
`;
}

const simpleBindingLayouts: GfxBindingLayoutDescriptor[] = [{numUniformBuffers: 1, numSamplers: 0}];
export class FullScreenColor {
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    constructor(cache: GfxRenderCache) {
        const program = new FullScreenColorProgram();

        this.megaStateFlags = {
            depthWrite: false,
            cullMode: GfxCullMode.None,
        };
        setAttachmentStateSimple(this.megaStateFlags, {
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendMode: GfxBlendMode.Add,
        });
        this.gfxProgram = cache.createProgram(program);
    }

    public render(renderInstManager: GfxRenderInstManager, color: vec4): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setBindingLayouts(simpleBindingLayouts);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.setDrawCount(3);
        let offs = renderInst.allocateUniformBuffer(0, 4);
        const mapped = renderInst.mapUniformBufferF32(0);
        fillVec4v(mapped, offs, color);
        renderInstManager.submitRenderInst(renderInst);
    }
}

class ShadowProgram extends DeviceProgram {
    override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

varying float v_Intensity;
`;

    public override vert = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in float a_Scale;

void main() {
    v_Intensity = 0.0;
    vec3 pos = a_Position + .6 * a_Normal; // this offset is configurable
    if (gl_VertexID == 12) {
        v_Intensity = 104./128.;
    } else {
        vec3 xDir = normalize(cross(a_Normal, vec3(0., 1., 0.)));
        vec3 zDir = cross(a_Normal, xDir);
        float c = a_Scale * cos(float(gl_VertexID) * 3.14159/6.);
        float s = a_Scale * sin(float(gl_VertexID) * 3.14159/6.);
        pos += c*xDir + s*zDir;
    }
    gl_Position = UnpackMatrix(u_Projection) * vec4(pos, 1.0);
}
`;

    public override frag = `
void main() {
    gl_FragColor.rgb = vec3(0.);
    gl_FragColor.a = v_Intensity;
}
`;
}

export class ShadowRenderer {
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private indexBufferDesc: GfxIndexBufferDescriptor;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private gfxProgram: GfxProgram;

    private centers: vec3[] = [];
    private normals: vec3[] = [];
    private radii: number[] = [];

    private currCount = 0;

    constructor(cache: GfxRenderCache, private bufferManager: BufferPoolManager) {

        const circleIndices = new Uint16Array(12 * 3);
        for (let i = 0; i < 12; i++) {
            circleIndices[i * 3 + 0] = 12;
            circleIndices[i * 3 + 1] = i;
            circleIndices[i * 3 + 2] = (i + 1) % 12;
        }
        this.indexBuffer = createBufferFromData(cache.device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, circleIndices.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: 0, bufferIndex: 0, bufferByteOffset: 0 * 4, format: GfxFormat.F32_RGB },
            { location: 1, bufferIndex: 0, bufferByteOffset: 4 * 4, format: GfxFormat.F32_RGB },
            { location: 2, bufferIndex: 0, bufferByteOffset: 7 * 4, format: GfxFormat.F32_R },
        ];
        const VERTEX_STRIDE = 3 + 3 + 2;
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: VERTEX_STRIDE * 4, frequency: GfxVertexBufferFrequency.PerInstance, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;

        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
        this.indexBufferDesc = { buffer: this.indexBuffer };

        this.gfxProgram = cache.createProgram(new ShadowProgram());
        this.megaStateFlags = {
            depthCompare: reverseDepthForCompareMode(GfxCompareMode.LessEqual),
            depthWrite: false,
            cullMode: GfxCullMode.None,
            polygonOffset: true,
        };
        // fractionally darken ground
        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.Zero,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });
    }

    public addShadow(viewerInput: Viewer.ViewerRenderInput, pos: ReadonlyVec3, normal: ReadonlyVec3, radius: number): void {
        if (this.currCount >= this.centers.length) {
            this.centers.push(vec3.create());
            this.normals.push(vec3.create());
        }
        transformVec3Mat4w1(this.centers[this.currCount], FFXToNoclip, pos);
        transformVec3Mat4w1(this.centers[this.currCount], viewerInput.camera.viewMatrix, this.centers[this.currCount]);
        transformVec3Mat4w1(this.normals[this.currCount], FFXToNoclip, normal);
        transformVec3Mat4w0(this.normals[this.currCount], viewerInput.camera.viewMatrix, this.normals[this.currCount]);
        this.radii[this.currCount] = radius;
        this.currCount++;
    }

    public endFrame(device: GfxDevice, renderInstManager: GfxRenderInstManager, late: boolean) {
        if (this.currCount === 0)
            return;
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        const layer = GfxRendererLayer.TRANSLUCENT + (late ? RenderLayer.LATE_SHADOW : RenderLayer.SHADOW);
        renderInst.sortKey = makeSortKey(layer);
        renderInst.setBindingLayouts(simpleBindingLayouts);

        const buf = this.bufferManager.getBuffer(device, this.currCount * 8);
        let offs = 0;
        for (let i = 0; i < this.currCount; i++) {
            offs += fillVec3v(buf.buffer, offs, this.centers[i]);
            offs += fillVec3v(buf.buffer, offs, this.normals[i], this.radii[i]);
        }
        renderInst.setVertexInput(this.inputLayout, buf.descs, this.indexBufferDesc);
        renderInst.setDrawCount(36);
        renderInst.setInstanceCount(this.currCount);
        renderInstManager.submitRenderInst(renderInst);
        this.currCount = 0;
    }

    public destroy(device: GfxDevice) {
        device.destroyBuffer(this.indexBuffer);
    }

}

export class TextureData {
    public gfxTexture: GfxTexture;
    public viewerTexture: Viewer.Texture;

    constructor(device: GfxDevice, public data: BIN.Texture) {
        const desc = makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, data.width, data.height, 1);
        const gfxTexture = device.createTexture(desc);
        device.setResourceName(gfxTexture, data.name);

        device.uploadTextureData(gfxTexture, 0, [data.pixels]);
        this.gfxTexture = gfxTexture;

        this.viewerTexture = textureToCanvas(data);
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}

function textureToCanvas(texture: BIN.Texture): Viewer.Texture {
    const canvas = convertToCanvas(ArrayBufferSlice.fromView(texture.pixels), texture.width, texture.height);
    canvas.title = texture.name;

    const surfaces = [canvas];
    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', psmToString(texture.tex0.psm));

    return { name: texture.name, surfaces, extraInfo };
}