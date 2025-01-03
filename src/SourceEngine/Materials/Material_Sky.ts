
import { vec4 } from "gl-matrix";
import { TextureMapping } from "../../TextureHolder.js";
import { fillVec4v, fillColor } from "../../gfx/helpers/UniformBufferHelpers.js";
import { GfxMegaStateDescriptor } from "../../gfx/platform/GfxPlatform.js";
import { GfxProgram } from "../../gfx/platform/GfxPlatformImpl.js";
import { makeSortKey, GfxRendererLayer, setSortKeyProgramKey, GfxRenderInst } from "../../gfx/render/GfxRenderInstManager.js";
import { assertExists, assert } from "../../util.js";
import { SourceRenderContext } from "../Main.js";
import { MaterialShaderTemplateBase, BaseMaterial, AlphaBlendMode, MaterialUtil } from "./MaterialBase.js";
import { UberShaderInstanceBasic } from "../UberShader.js";
import * as P from "./MaterialParameters.js";
import { MaterialCache } from "./MaterialCache.js";
import { colorScale } from "../../Color.js";

//#region Sky
export class ShaderTemplate_Sky extends MaterialShaderTemplateBase {
    public static ub_ObjectParams = 2;

    public override program = `
precision mediump float;

${MaterialShaderTemplateBase.Common}

layout(std140, row_major) uniform ub_ObjectParams {
    Mat4x2 u_BaseTextureTransform;
    vec4 u_ColorScale;
};

varying vec2 v_TexCoord0;

layout(binding = 0) uniform sampler2D u_Texture;

#if defined VERT
void mainVS() {
    mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    vec3 t_PositionWorld = t_WorldFromLocalMatrix * vec4(a_Position, 1.0);
    gl_Position = u_ProjectionView * vec4(t_PositionWorld, 1.0);
    v_TexCoord0.xy = u_BaseTextureTransform * vec4(a_TexCoord01.xy, 0.0, 1.0);
}
#endif

#if defined FRAG
void mainPS() {
    vec4 t_FinalColor = texture(SAMPLER_2D(u_Texture), v_TexCoord0.xy);

    OutputLinearColor(vec4(t_FinalColor.rgb * u_ColorScale.rgb, 1.0));
}
#endif
`;
}

export class ShaderTemplate_SkyHDRCompressed extends MaterialShaderTemplateBase {
    public static ub_ObjectParams = 2;

    public override program = `
precision mediump float;

${MaterialShaderTemplateBase.Common}

layout(std140, row_major) uniform ub_ObjectParams {
    mat4x2 u_BaseTextureTransform;
    vec4 u_TextureSizeInfo;
    vec4 u_ColorScale;
};

#define u_TexelXIncr               (u_TextureSizeInfo.x)
#define u_TexelYIncr               (u_TextureSizeInfo.y)
#define u_UToPixelCoordScale       (u_TextureSizeInfo.z)
#define u_VToPixelCoordScale       (u_TextureSizeInfo.w)

varying vec4 v_TexCoord0;
varying vec4 v_TexCoord1;
varying vec2 v_TexCoordInPixels;

layout(binding = 0) uniform sampler2D u_TextureHdrCompressed;

#if defined VERT
void mainVS() {
    mat4x3 t_WorldFromLocalMatrix = CalcWorldFromLocalMatrix();
    vec3 t_PositionWorld = t_WorldFromLocalMatrix * vec4(a_Position, 1.0);
    gl_Position = u_ProjectionView * vec4(t_PositionWorld, 1.0);

    vec2 t_TexCoord = u_BaseTextureTransform * vec4(a_TexCoord01.xy, 0.0, 1.0);

    v_TexCoord0.xy = t_TexCoord + vec2(-u_TexelXIncr, -u_TexelYIncr);
    v_TexCoord0.zw = t_TexCoord + vec2( u_TexelXIncr, -u_TexelYIncr);

    v_TexCoord1.xy = t_TexCoord + vec2(-u_TexelXIncr,  u_TexelYIncr);
    v_TexCoord1.zw = t_TexCoord + vec2( u_TexelXIncr,  u_TexelYIncr);

    v_TexCoordInPixels = v_TexCoord0.xy * vec2(u_UToPixelCoordScale, u_VToPixelCoordScale);
}
#endif

#if defined FRAG
void mainPS() {
    vec4 t_S00 = texture(SAMPLER_2D(u_TextureHdrCompressed), v_TexCoord0.xy);
    vec4 t_S01 = texture(SAMPLER_2D(u_TextureHdrCompressed), v_TexCoord0.zw);
    vec4 t_S10 = texture(SAMPLER_2D(u_TextureHdrCompressed), v_TexCoord1.xy);
    vec4 t_S11 = texture(SAMPLER_2D(u_TextureHdrCompressed), v_TexCoord1.zw);

    vec2 t_FracCoord = fract(v_TexCoordInPixels);

    t_S00.rgb *= t_S00.a;
    t_S10.rgb *= t_S10.a;
    t_S00.rgb = mix(t_S00.rgb, t_S10.rgb, t_FracCoord.x);

    t_S01.rgb *= t_S01.a;
    t_S11.rgb *= t_S11.a;
    t_S01.rgb = mix(t_S01.rgb, t_S11.rgb, t_FracCoord.x);

    vec3 t_FinalColor = mix(t_S00.rgb, t_S01.rgb, t_FracCoord.y);

    OutputLinearColor(vec4(t_FinalColor * u_ColorScale.rgb, 1.0));
}
#endif
`;
}

const enum Material_Sky_Type {
    SkyHDRCompressed, Sky,
}

export class Material_Sky extends BaseMaterial {
    private shaderInstance: UberShaderInstanceBasic;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;
    private textureSizeInfo: vec4 | null = null;
    private type: Material_Sky_Type;

    protected override initParameters(): void {
        super.initParameters();

        const p = this.param;

        p['$hdrcompressedtexture'] = new P.ParameterTexture(false);
        p['$hdrbasetexture']       = new P.ParameterTexture(true);
    }

    protected override initStatic(materialCache: MaterialCache) {
        super.initStatic(materialCache);

        if (this.paramGetVTF('$hdrcompressedtexture') !== null) {
            this.shaderInstance = new UberShaderInstanceBasic(materialCache.shaderTemplates.SkyHDRCompressed);

            const texture = assertExists(this.paramGetVTF('$hdrcompressedtexture'));
            const w = texture.width, h = texture.height;
            const fudge = 0.01 / Math.max(w, h);
            this.textureSizeInfo = vec4.fromValues(0.5 / w - fudge, 0.5 / h - fudge, w, h);

            this.type = Material_Sky_Type.SkyHDRCompressed;
        } else {
            this.shaderInstance = new UberShaderInstanceBasic(materialCache.shaderTemplates.Sky);

            this.type = Material_Sky_Type.Sky;
        }

        this.setAlphaBlendMode(this.megaStateFlags, AlphaBlendMode.None);
        this.sortKeyBase = makeSortKey(GfxRendererLayer.OPAQUE);

        this.setSkinningMode(this.shaderInstance);
        this.setFogMode(this.shaderInstance);
        this.setCullMode(this.megaStateFlags);

        this.gfxProgram = this.shaderInstance.getGfxProgram(materialCache.cache);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    private updateTextureMappings(dst: TextureMapping[]): void {
        MaterialUtil.resetTextureMappings(dst);

        if (this.type === Material_Sky_Type.SkyHDRCompressed) {
            this.paramGetTexture('$hdrcompressedtexture').fillTextureMapping(dst[0], this.paramGetInt('$frame'));
        } else if (this.type === Material_Sky_Type.Sky) {
            let texture = this.paramGetTexture('$hdrbasetexture');
            if (texture.texture === null)
                texture = assertExists(this.paramGetTexture('$basetexture'));
            texture.fillTextureMapping(dst[0], this.paramGetInt('$frame'));
        }
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings(MaterialUtil.textureMappings);

        this.setupOverrideSceneParams(renderContext, renderInst);

        if (this.type === Material_Sky_Type.SkyHDRCompressed) {
            let offs = renderInst.allocateUniformBuffer(ShaderTemplate_SkyHDRCompressed.ub_ObjectParams, 16);
            const d = renderInst.mapUniformBufferF32(ShaderTemplate_SkyHDRCompressed.ub_ObjectParams);
            offs += this.paramFillTextureMatrix(d, offs, '$basetexturetransform');
            offs += fillVec4v(d, offs, this.textureSizeInfo!);

            this.paramGetVector('$color').fillColor(MaterialUtil.scratchColor, 1.0);
            colorScale(MaterialUtil.scratchColor, MaterialUtil.scratchColor, 8.0);

            offs += fillColor(d, offs, MaterialUtil.scratchColor);
        } else if (this.type === Material_Sky_Type.Sky) {
            let offs = renderInst.allocateUniformBuffer(ShaderTemplate_Sky.ub_ObjectParams, 12);
            const d = renderInst.mapUniformBufferF32(ShaderTemplate_Sky.ub_ObjectParams);
            offs += this.paramFillTextureMatrix(d, offs, '$basetexturetransform');
            this.paramGetVector('$color').fillColor(MaterialUtil.scratchColor, 1.0);
            offs += fillColor(d, offs, MaterialUtil.scratchColor);
        }

        renderInst.setSamplerBindingsFromTextureMappings(MaterialUtil.textureMappings);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }
}
//#endregion
