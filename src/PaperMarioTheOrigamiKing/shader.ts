import { FMAT_ShaderAssign, FVTX_VertexAttribute } from "../fres_nx/bfres";
import { ChannelSource } from "../fres_nx/nngfx_enum";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary";
import { DeviceProgram } from "../Program";
import { assert } from "../util";

// Adapated code from MK8D/Odyessy and TMSFE. Switch Toolbox was a big help too

const ATTRIBUTE_MAP: Map<string, string> = new Map<string, string>([
    ["_p0", "vec3"], // position
    ["_n0", "vec4"], // normal
    ["_c0", "vec4"], // color, this is always black (???) and extremely rare, just use albedo instead
    ["_t0", "vec4"], // tangent
    ["_b0", "vec4"], // bitangent
    ["_u0", "vec2"], // uv 1
    ["_u1", "vec2"], // uv 2
    ["_i0", ""], // index, dynamic type
    ["_w0", ""], // weight, dynamic type
    ["albedo", "vec2"], // same format as UVs but doesn't have any data (???)
    ["detail", "vec2"], // same format as UVs but doesn't have any data (???)
    ["lightmap", "vec2"] // same format as UVs but doesn't have any data (???)
]);

export class OrigamiProgram extends DeviceProgram {
    public static ub_ShapeParams = 0;
    public static ub_MaterialParams = 1;

    constructor(override name: string, private shaderAssign: FMAT_ShaderAssign, private samplers: Map<string, ChannelSource[]>, private boneMatricesCount: number, private vertexSkinWeightCount: number, private vertexAttributes: FVTX_VertexAttribute[]) {
        super();
    }

    private getVertAttributeDefs(): string {
        let s = "";
        for (let i = 0; i < this.vertexAttributes.length; i++) {
            const attribute = this.vertexAttributes[i].name;
            let type = ATTRIBUTE_MAP.get(attribute);

            // override type for index/weight based on skin weights
            if (["_i0", "_w0"].includes(attribute)) {
                switch (this.vertexSkinWeightCount) {
                    case 1:
                        type = attribute === "_i0" ? "uint" : "int";
                        break;
                    case 2:
                        type = attribute === "_i0" ? "uvec2" : "vec2";
                        break;
                    case 3:
                        type = attribute === "_i0" ? "uvec3" : "vec3";
                        break;
                    case 4:
                    case -1:
                    default:
                        // default to vec4 when -1 since that's the safest bet, even if slightly inefficent. Ain't building rockets here...
                        type = attribute === "_i0" ? "uvec4" : "vec4";
                        break;
                }
            }

            if (type === undefined) {
                console.warn("Unknown attribute", attribute, "in", this.name);
            } else if (type.length > 0) {
                s += `layout(location = ${i}) in ${type} ${attribute};\n`;
            } else {
                console.warn("Could not determine type for", attribute, "in", this.name);
            }
        }
        return s;
    }

    private getSamplerDefs(): string {
        let s = "";
        for (const sampler of this.samplers.keys()) {
            s += `uniform sampler2D u${sampler};\n`;
        }
        return s;
    }

    private getRemappedColor(name: string, channels: ChannelSource[]): string {
        let s = "vec4(";
        for (const cs of channels) {
            switch (cs) {
                case ChannelSource.Red:
                    s += name + ".r" + ", ";
                    break;
                case ChannelSource.Green:
                    s += name + ".g" + ", ";
                    break;
                case ChannelSource.Blue:
                    s += name + ".b" + ", ";
                    break;
                case ChannelSource.Alpha:
                    s += name + ".a" + ", ";
                    break;
                case ChannelSource.One:
                    s += "1.0, ";
                    break;
                default:
                    s += "0.0, ";
                    break;
            }
        }
        return s.substring(0, s.length - 2) + ")";
    }

    private getTextureColor(samplerName: string, outName: string, uv: string): string {
        let s = "texture(SAMPLER_2D(u" + samplerName + "), " + uv + ")";
        const channels = this.samplers.get(samplerName);
        if (!channels) {
            console.warn("Could not find sampler", samplerName, "for", this.name);
            return "vec4 " + outName + " = vec4(1.0, 1.0, 1.0, 1.0)";
        }
        assert(channels.length === 4);
        if (channels[0] === ChannelSource.Red && channels[1] === ChannelSource.Green &&
            channels[2] === ChannelSource.Blue && channels[3] === ChannelSource.Alpha) {
            // don't remap if already rgba, most textures are
            return "vec4 " + outName + " = " + s;
        } else {
            const remap = this.getRemappedColor("t" + samplerName, channels);
            return "vec4 t" + samplerName + " = " + s + ";\nvec4 " + outName + " = " + remap;
        }
    }

    private getOptionBoolean(optionName: string, dneValue: boolean = false): boolean {
        const optionValue = this.shaderAssign.shaderOption.get(optionName);
        if (optionValue === undefined) {
            return dneValue;
        }
        assert(optionValue === "0" || optionValue === "1");
        return optionValue === "1";
    }

    public getAttribute(name: string, dneValue: string): string {
        for (const a of this.vertexAttributes) {
            if (a.name === name) {
                return name;
            }
        }
        return dneValue;
    }

    private getPositionWorld(): string {
        let s = "";
        switch (this.vertexSkinWeightCount) {
            case 1:
                s = "vec3 PositionWorld = UnpackMatrix(u_BoneMatrices[_i0]) * vec4(_p0, 1.0)";
                break;
            case 2:
                s = `mat4x3 LocalToWorld = mat4x3(0.0);
                LocalToWorld += UnpackMatrix(u_BoneMatrices[_i0.x]) * _w0.x;
                LocalToWorld += UnpackMatrix(u_BoneMatrices[_i0.y]) * _w0.y;
                vec3 PositionWorld = LocalToWorld * vec4(_p0, 1.0)`;
                break;
            case 3:
                s = `mat4x3 LocalToWorld = mat4x3(0.0);
                LocalToWorld += UnpackMatrix(u_BoneMatrices[_i0.x]) * _w0.x;
                LocalToWorld += UnpackMatrix(u_BoneMatrices[_i0.y]) * _w0.y;
                LocalToWorld += UnpackMatrix(u_BoneMatrices[_i0.z]) * _w0.z;
                vec3 PositionWorld = LocalToWorld * vec4(_p0, 1.0)`;
                break;
            case 4:
                s = `mat4x3 LocalToWorld = mat4x3(0.0);
                LocalToWorld += UnpackMatrix(u_BoneMatrices[_i0.x]) * _w0.x;
                LocalToWorld += UnpackMatrix(u_BoneMatrices[_i0.y]) * _w0.y;
                LocalToWorld += UnpackMatrix(u_BoneMatrices[_i0.z]) * _w0.z;
                LocalToWorld += UnpackMatrix(u_BoneMatrices[_i0.w]) * _w0.w;
                vec3 PositionWorld = LocalToWorld * vec4(_p0, 1.0)`;
                break;
            case 0:
            case -1:
            default:
                s = "vec3 PositionWorld = UnpackMatrix(u_BoneMatrices[0]) * vec4(_p0, 1.0)";
                break;
        }
        return s;
    }

    public override both = `
precision highp float;

${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_ShapeParams {
    Mat4x4 u_Projection;
    Mat3x4 u_View;
    Mat3x4 u_Shift;
    Mat3x4 u_BoneMatrices[${this.boneMatricesCount}];
};

layout(std140) uniform ub_MaterialParams {
    Mat2x4 u_TexCoordSRT0;
    Mat2x4 u_TexCoordSRT1;
    vec4 u_Floats; // x=glossiness, y=alphaRef, z=yFlip, w=whiteBack
};

${this.getSamplerDefs()}

#ifdef VERT
${this.getVertAttributeDefs()}

out vec4 v_NormalWorld;
out vec4 v_TangentWorld;
out vec4 v_BitangentWorld;
out vec2 v_TexCoord0;
out vec2 v_TexCoord1;
out vec2 v_TexCoord2;
out vec4 v_Floats;

void main() {
    ${this.getPositionWorld()};
    PositionWorld = UnpackMatrix(u_Shift) * vec4(PositionWorld, 1.0);
    gl_Position = UnpackMatrix(u_Projection) * vec4(UnpackMatrix(u_View) * vec4(PositionWorld, 1.0), 1.0);
    v_NormalWorld = _n0;
    v_TangentWorld = ${this.getAttribute('_t0', 'vec4(0.0)')};
    v_BitangentWorld = ${this.getAttribute('_b0', 'vec4(0.0)')};
    v_TexCoord0 = UnpackMatrix(u_TexCoordSRT0) * vec4(${this.getAttribute('_u0', 'vec2(0.0)')}, 1.0, 1.0);
    v_TexCoord1 = ${this.getAttribute('_u1', this.getAttribute('_u0', 'vec2(0.0)'))};
    v_TexCoord2 = UnpackMatrix(u_TexCoordSRT1) * vec4(v_TexCoord1, 1.0, 1.0);
    v_Floats = u_Floats;
}
#endif

#ifdef FRAG
in vec4 v_NormalWorld;
in vec4 v_TangentWorld;
in vec4 v_BitangentWorld;
in vec2 v_TexCoord0;
in vec2 v_TexCoord1;
in vec2 v_TexCoord2;
in vec4 v_Floats;

void main() {
    ${this.getTextureColor('_a0', 'color', 'v_TexCoord0')};

    ${this.getOptionBoolean('alpha_test') ? `
    if (color.a < v_Floats.y) {
        discard;
    }` : ``}

    ${this.getOptionBoolean('use_normal_map') ? `
    vec3 t_LightDir = vec3(-0.5, -0.5, -1);
    ${this.getOptionBoolean('metal_mask') ? /* Crude attempt at foil effect */`
    ${this.getTextureColor('_n0', 'normalColor', 'v_TexCoord1')};
    vec3 normal = normalize(vec3(normalColor.rg * 2.0 - 1.0, normalColor.b));
    float diffuse = max(dot(normal, normalize(t_LightDir)), 0.0);
    float spec = pow(max(dot(normal, normalize(t_LightDir + vec3(0.0, 0.0, 1.0))), 0.0), 64.0);
    color.rgb *= (diffuse + 0.3) + (spec * 0.8);
    `: /* Adapted from Odyssey's shader */`
    ${this.getTextureColor('_n0', 'normalColor', 'v_TexCoord0')};
    vec3 t_LocalNormal = vec3(normalColor.rg, 0);
    t_LocalNormal.z = sqrt(clamp(1.0 - t_LocalNormal.x*t_LocalNormal.x - t_LocalNormal.y*t_LocalNormal.y, 0.0, 1.0));
    vec3 t_NormalDir = (t_LocalNormal.x * normalize(v_TangentWorld.xyz) + t_LocalNormal.y * normalize(v_BitangentWorld.xyz) + t_LocalNormal.z * v_NormalWorld.xyz);
    float t_LightIntensity = clamp(dot(normalize(t_LightDir), -t_NormalDir), 0.0, 1.0);
    t_LightIntensity = mix(0.6, 1.0, t_LightIntensity);
    color.rgb *= t_LightIntensity;`}
    ` : ''}

    ${this.getOptionBoolean('use_occlusion_map') || this.getOptionBoolean('use_bakeshadow_map') ? `
    ${this.getTextureColor('_m0', 'materialColor', 'v_TexCoord1')};
    ` : ''}
    
    float ambientOcclusion = 1.0;
    ${this.getOptionBoolean('use_occlusion_map') ? `
    ambientOcclusion = mix(1.0, materialColor.r, 0.7);
    ` : ''}

    float bakedShadow = 1.0;
    ${this.getOptionBoolean('use_bakeshadow_map') ? `
    bakedShadow = mix(1.0, materialColor.g, 0.55);
    ` : ''}

    ${this.samplers.get('_d0') ? this.getTextureColor('_d0', 'detailColor', 'v_TexCoord2') : ''};

    color.rgb *= ambientOcclusion * bakedShadow${this.samplers.get('_d0') ? ' * mix(1.0, detailColor.b, 0.55)' : ''};
    color.rgb = pow(color.rgb, vec3(1.0 / 2.2));
    gl_FragColor = color;
}
#endif
`;
}
