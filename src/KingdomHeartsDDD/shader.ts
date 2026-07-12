import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { DeviceProgram } from "../Program";

export class DreamDropShader extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_UV = 2;
    public static a_Weight = 3;
    public static a_Joint = 4;
    public static ub_SceneParams = 0;
    public static ub_EnvParams = 1;
    public static ub_ModelParams = 2;
    public static ub_ShapeParams = 3;

    constructor(protected attributeCount: number, protected boneSRTCount: number, protected isSkybox: boolean = false, protected weightCount = 0, protected doRigidSkinning = false) {
        super();
        this.both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    float u_Time;
    float u_ApplyTextures;
    float u_DoScrolling;
    float u_ShowFog;
};

layout(std140) uniform ub_EnvParams {
    vec4 u_FogColor;
    float u_FogNear;
    float u_FogFar;
};

layout(std140) uniform ub_ModelParams {
    Mat3x4 u_View;
    ${boneSRTCount > 0 ? `Mat3x4 u_BoneSRT[${boneSRTCount}];` : ''}
};

layout(std140) uniform ub_ShapeParams {
    vec2 u_Scroll;
    float u_HasTexture;
};

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_UV;
varying float v_Depth;

#ifdef VERT
layout(location = ${DreamDropShader.a_Position}) in vec3 a_Position;
layout(location = ${DreamDropShader.a_Color}) in vec4 a_Color;
layout(location = ${DreamDropShader.a_UV}) in vec2 a_UV;
${attributeCount >= 4 ? `layout(location = ${DreamDropShader.a_Weight}) in vec4 a_Weight;` : ''}
${attributeCount >= 5 ? `layout(location = ${DreamDropShader.a_Joint}) in uvec4 a_Joint;` : ''}
${this.getAdditionalAttributes()}

void main() {
    v_Color = a_Color;
    if (u_DoScrolling > 0.1) {
        v_UV = a_UV + (u_Time * u_Scroll);
    } else {
        v_UV = a_UV;
    }
    ${!this.isSkybox ? `    if (u_ShowFog > 0.1) {
        v_Depth = -(UnpackMatrix(u_View) * vec4(a_Position, 1.0)).z;
    }` : ""}
    ${this.getVertPosition()}
}
#endif

#ifdef FRAG
void main() {
    vec4 finalColor;
    if (u_HasTexture > 0.1 && u_ApplyTextures > 0.1) {
        vec4 texColor = texture(SAMPLER_2D(u_Texture), v_UV);
        if (texColor.a < 0.1) {
            discard;
        }
        finalColor = texColor * vec4(clamp(v_Color.rgb + vec3(0.08), 0.0, 1.0), v_Color.a);
    } else {
        finalColor = v_Color;
    }
    ${!this.isSkybox ? `    if (u_ShowFog > 0.1) {
        float fogFactor = clamp((u_FogFar - v_Depth) / (u_FogFar - u_FogNear), 0.0, 1.0);
        gl_FragColor = vec4(mix(u_FogColor.rgb, finalColor.rgb, fogFactor), finalColor.a);
    } else {
        gl_FragColor = finalColor;
    }` : "  gl_FragColor = finalColor;"}
}
#endif
    `;
    }

    protected getVertPosition(): string {
        if (this.boneSRTCount > 0) {
            let s = "";
            if (this.doRigidSkinning) {
                s = "mat4x3 t_BoneMatrix = UnpackMatrix(u_BoneSRT[a_Joint.x]);";
            } else {
                s = `mat4x3 t_BoneMatrix = mat4x3(0.0);
    t_BoneMatrix += UnpackMatrix(u_BoneSRT[a_Joint.x]) * a_Weight.x;
    t_BoneMatrix += UnpackMatrix(u_BoneSRT[a_Joint.y]) * a_Weight.y;
    t_BoneMatrix += UnpackMatrix(u_BoneSRT[a_Joint.z]) * a_Weight.z;
    t_BoneMatrix += UnpackMatrix(u_BoneSRT[a_Joint.w]) * a_Weight.w;`;
            }
            return `${s}
    vec3 t_ViewPosition = UnpackMatrix(u_View) * vec4(t_BoneMatrix * vec4(a_Position, 1.0), 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(t_ViewPosition, 1.0);`;
        } else {
            return "gl_Position = UnpackMatrix(u_Projection) * vec4(UnpackMatrix(u_View) * vec4(a_Position, 1.0), 1.0);";
        }
    }

    protected getAdditionalAttributes(): string {
        return "";
    }
}

// same as dream drop's shader, except there can be up to 8 weights per vertex, instead of either 0 or 4
export class BBSShader extends DreamDropShader {
    public static a_Weight2 = 5;
    public static a_Joint2 = 6;

    protected override getVertPosition(): string {
        if (this.boneSRTCount > 0 && this.weightCount > 0) {
            return this.getBoneMatrixTransform(this.weightCount);
        } else {
            return "gl_Position = UnpackMatrix(u_Projection) * vec4(UnpackMatrix(u_View) * vec4(a_Position, 1.0), 1.0);";
        }
    }

    protected override getAdditionalAttributes(): string {
        return `${this.attributeCount >= 6 ? `layout(location = ${BBSShader.a_Weight2}) in vec4 a_Weight2;` : ''}
    ${this.attributeCount >= 7 ? `layout(location = ${BBSShader.a_Joint2}) in uvec4 a_Joint2;` : ''}`;
    }

    private getBoneMatrixTransform(weightCount: number) {
        let s = "mat4x3 t_BoneMatrix = UnpackMatrix(u_BoneSRT[a_Joint.x]);";
        if (!this.doRigidSkinning) {
            s = `mat4x3 t_BoneMatrix = mat4x3(0.0);
    t_BoneMatrix += UnpackMatrix(u_BoneSRT[a_Joint.x]) * a_Weight.x;`;
            if (weightCount > 1) {
                s += `
    t_BoneMatrix += UnpackMatrix(u_BoneSRT[a_Joint.y]) * a_Weight.y;`;
            }
            if (weightCount > 2) {
                s += `
    t_BoneMatrix += UnpackMatrix(u_BoneSRT[a_Joint.z]) * a_Weight.z;`;
            }
            if (weightCount > 3) {
                s += `
    t_BoneMatrix += UnpackMatrix(u_BoneSRT[a_Joint.w]) * a_Weight.w;`;
            }
            if (weightCount > 4) {
                s += `
    t_BoneMatrix += UnpackMatrix(u_BoneSRT[a_Joint2.x]) * a_Weight2.x;`;
            }
            if (weightCount > 5) {
                s += `
    t_BoneMatrix += UnpackMatrix(u_BoneSRT[a_Joint2.y]) * a_Weight2.y;`;
            }
            if (weightCount > 6) {
                s += `
    t_BoneMatrix += UnpackMatrix(u_BoneSRT[a_Joint2.z]) * a_Weight2.z;`;
            }
            if (weightCount > 7) {
                s += `
    t_BoneMatrix += UnpackMatrix(u_BoneSRT[a_Joint2.w]) * a_Weight2.w;`;
            }
        }
        return `${s}
    vec3 t_ViewPosition = UnpackMatrix(u_View) * vec4(t_BoneMatrix * vec4(a_Position, 1.0), 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(t_ViewPosition, 1.0);`;
    }
}
