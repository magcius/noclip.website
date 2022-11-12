import { DeviceProgram } from "../Program";

export const MAX_NUM_OF_INSTANCES = 256;

export const MAX_NUM_OF_OBJ_ANIM_VERTICES = 1024; 

export class F3DDKR_Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_Position_2 = 1;
    public static a_Color = 2;
    public static a_TexCoord = 3;
    public static a_OriginalIndex = 4; // Used only as a reference for object animations.

    public static ub_SceneParams = 0;
    public static ub_DrawParams = 1;
    
    public override both = `
precision mediump float;

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(std140) uniform ub_DrawParams {
    vec4 u_Color;
    vec4 u_Misc[1];
    Mat4x3 u_ViewMatrix[${MAX_NUM_OF_INSTANCES}];
};

#define u_TexCoordOffset (u_Misc[0].xy)
#define u_AnimProgress   (u_Misc[0].z)

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_TexCoord;

bvec4 DecodeOptions() {
    // u_Options.x = Use texture
    // u_Options.y = Use vertex colors
    // u_Options.z = Use vertex normals
    // u_Options.w = Use object animation

    int t_Options = int(u_Misc[0].w);
    bvec4 t_OptionsRet = bvec4(false);
    t_OptionsRet.x = (t_Options & 1) != 0;
    t_OptionsRet.y = (t_Options & 2) != 0;
    t_OptionsRet.z = (t_Options & 4) != 0;
    t_OptionsRet.w = (t_Options & 8) != 0;
    return t_OptionsRet;
}
`;

    public override vert = `
layout(location = ${F3DDKR_Program.a_Position}) in vec3 a_Position;
layout(location = ${F3DDKR_Program.a_Position_2}) in vec3 a_Position_2;
layout(location = ${F3DDKR_Program.a_Color}) in vec4 a_Color;
layout(location = ${F3DDKR_Program.a_TexCoord}) in vec2 a_TexCoord;

void main() {
    vec3 pos;
    bvec4 t_Options = DecodeOptions();

    if(t_Options.w) { // t_Options.w = Use object animation
        pos = mix(a_Position, a_Position_2, u_AnimProgress); // lerp between the keyframes.
    } else {
        pos = a_Position; // Just use the default position.
    }

    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ViewMatrix[gl_InstanceID]), vec4(pos, 1.0)));
    if(t_Options.z) {
        v_Color = vec4(1.0, 1.0, 1.0, 1.0);
    } else {
        v_Color = vec4(a_Color.xyz, a_Color.w * u_Color.w);
    }
    v_TexCoord = a_TexCoord + u_TexCoordOffset.xy;
}
`;

    public override frag = `
// Implements N64-style "triangle bilienar filtering" with three taps.
// Based on ArthurCarvalho's implementation, modified by NEC and Jasper for noclip.
vec4 Texture2D_N64_Bilerp(PD_SAMPLER_2D(t_Texture), vec2 t_TexCoord) {
    vec2 t_Size = vec2(textureSize(PU_SAMPLER_2D(t_Texture), 0));
    vec2 t_Offs = fract(t_TexCoord*t_Size - vec2(0.5));
    t_Offs -= step(1.0, t_Offs.x + t_Offs.y);
    vec4 t_S0 = texture(PU_SAMPLER_2D(t_Texture), t_TexCoord - t_Offs / t_Size);
    vec4 t_S1 = texture(PU_SAMPLER_2D(t_Texture), t_TexCoord - vec2(t_Offs.x - sign(t_Offs.x), t_Offs.y) / t_Size);
    vec4 t_S2 = texture(PU_SAMPLER_2D(t_Texture), t_TexCoord - vec2(t_Offs.x, t_Offs.y - sign(t_Offs.y)) / t_Size);
    return t_S0 + abs(t_Offs.x)*(t_S1-t_S0) + abs(t_Offs.y)*(t_S2-t_S0);
}

void main() { 
    vec4 textureColor = vec4(1.0, 1.0, 1.0, 1.0);
    vec4 vertexColor = vec4(1.0, 1.0, 1.0, 1.0);

    bvec4 t_Options = DecodeOptions();

    if(t_Options.x) {
        textureColor = Texture2D_N64_Bilerp(PP_SAMPLER_2D(u_Texture), v_TexCoord);
    }

    if(t_Options.y) {
        vertexColor = v_Color;
    }

    gl_FragColor = vertexColor * textureColor;

    if(gl_FragColor.a == 0.0) discard; 
}
`;

    constructor() {
        super();
    }
}