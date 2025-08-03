
import { GfxDevice, GfxBuffer, GfxInputLayout, GfxFormat, GfxVertexBufferFrequency, GfxVertexAttributeDescriptor, GfxBufferUsage, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxCullMode, GfxCompareMode, GfxProgram, GfxMegaStateDescriptor, GfxBlendMode, GfxBlendFactor, GfxInputLayoutBufferDescriptor, GfxVertexBufferDescriptor, GfxTexture, makeTextureDescriptor2D, GfxIndexBufferDescriptor, GfxBindingLayoutDescriptor } from "../gfx/platform/GfxPlatform.js";
import { DeviceProgram } from "../Program.js";
import * as Viewer from "../viewer.js";
import * as BIN from "./bin.js";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers.js";
import { mat4, ReadonlyMat4, ReadonlyVec3, vec3 } from "gl-matrix";
import { fillMatrix4x2, fillMatrix4x3, fillVec3v, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { TextureMapping } from "../TextureHolder.js";
import { GfxRenderInstList, GfxRenderInstManager, GfxRendererLayer, makeSortKey } from "../gfx/render/GfxRenderInstManager.js";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache.js";
import { AttachmentStateSimple, setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { assert, assertExists, nArray } from "../util.js";
import { convertToCanvas } from "../gfx/helpers/TextureConversionHelpers.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { CalcBillboardFlags, calcBillboardMatrix, getMatrixAxisX, getMatrixTranslation, invlerp, Mat4Identity, transformVec3Mat4w0 } from "../MathHelpers.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxShaderLibrary } from "../gfx/helpers/GfxShaderLibrary.js";
export class WarpedProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;
    public static ub_TexParams = 2;

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    vec4 u_WorldX;
    vec4 u_WorldZ;
};
layout(std140) uniform ub_ModelParams {
    Mat3x4 u_ModelView;
    vec4 u_Params;
    vec4 u_BlendColor;
    vec4 u_Diffuse;
    vec4 u_Specular;
};
layout(std140) uniform ub_TexParams {
    Mat2x4 u_TexMatrix;
    vec4 u_DrawParams;
};
varying vec3 v_TexCoord;

uniform sampler2D u_Texture;
uniform sampler2D u_VertexAnimation;

varying vec3 v_Color;
flat varying vec3 v_FlatColor;
`;

    public override vert = `
#ifdef ANIMATED
layout(location = 0) in float a_PositionIndex;
#else
layout(location = 0) in vec3 a_Position;
#endif
layout(location = 1) in vec3 a_Color;
layout(location = 2) in vec2 a_TexCoord;


vec3 ConvertToSignedInt(vec3 t_Input) {
    ivec3 t_Num = ivec3(t_Input * 255.0);
    // Sign extend
    t_Num = t_Num << 24 >> 24;
    return vec3(t_Num) / 127.0;
}

void main() {
    int mode = int(u_Params.z);
    int drawMode = int(u_DrawParams.x);
#ifdef ANIMATED
    vec4 viewPosition = textureLod(SAMPLER_2D(u_VertexAnimation), vec2(a_PositionIndex, u_Params.x), 0.);
    viewPosition.xyz *= 255./8.;
    viewPosition.w = 1.0;
#else
    vec4 viewPosition = vec4(a_Position, 1.0);
#endif
    viewPosition.xyz = UnpackMatrix(u_ModelView)*viewPosition;

v_Color = mod(a_Color, 2.0);

#ifdef EFFECT_UNDERWATER
    if (a_Color.r > 1.5 || a_Color.g > 1.5) {
        float wibbleSpace = (dot(u_WorldX.xyz + u_WorldZ.xyz, viewPosition.xyz) + u_WorldZ.w)/4.;
        float wibbleT = radians((wibbleSpace + u_WorldX.w)*180./32.);
        if (mod(wibbleSpace, 64.) > 31.85)
            wibbleT *= -1.;
        if (a_Color.g > 1.5) {
            viewPosition.xyz += 8.*(sin(wibbleT)*u_WorldX.xyz + cos(wibbleT)*u_WorldZ.xyz);
        }
        if (a_Color.r > 1.5) {
            vec3 highlight = vec3(40.,44.,48.)/255.;
            v_Color = mix(v_Color, highlight, abs(sin(wibbleT)));
        }
    }
#endif

#ifdef EFFECT_WATERSURFACE
    if (a_Color.g > 1.5) {
        float wibbleSpace = (dot(u_WorldX.xyz + u_WorldZ.xyz, viewPosition.xyz) + u_WorldZ.w)/4.;
        float wibbleT = radians((wibbleSpace + u_WorldX.w/2.)*180./32.);
        if (mod(wibbleSpace, 64.) > 31.85)
            wibbleT *= -1.;
        viewPosition.xyz += 8.*(sin(wibbleT)*u_WorldX.xyz + cos(wibbleT)*u_WorldZ.xyz);
    }
    // if (a_Color.r < 1.5) {
    // TODO: set from a global, maybe unused,
    // would only affect some lava in dino levels
    // }
#endif

#ifdef EFFECT_DEPTHFADE
    if (a_Color.r < 1.5) {
        float depthFactor = -clamp(viewPosition.z + 100., -100., 0.)/100.;
        v_Color *= depthFactor;
    }
#endif

    gl_Position = UnpackMatrix(u_Projection) * viewPosition;
    // compute shifted depth
    // viewPosition.z += u_Params.y;
    // float altZ = dot(u_Projection.mz, viewPosition);
    // gl_Position.z = -altZ * gl_Position.w / viewPosition.z;
#ifdef RETRO
    vec2 resolution = vec2(256.0, 120.0); // base on aspect ratio?
    gl_Position.xy = floor(resolution*gl_Position.xy/gl_Position.w)*gl_Position.w/resolution;
#endif

    if (mode == ${RenderMode.DEFAULT}) {
        v_Color = mix(v_Color, u_BlendColor.rgb, u_BlendColor.a);
    } else if (mode == ${RenderMode.FOG}) {
        // v_Color = mix(v_Color, u_BlendColor.rgb, (gl_Position.w + 1.)/2.);
    } else if (mode == ${RenderMode.LIT} || mode == ${RenderMode.CRYSTAL}) {
        vec3 norm = ConvertToSignedInt(a_Color.rgb);
        float specDot = abs(dot(norm, u_Specular.xyz));
        v_Color = vec3(exp(-32.0*max(1.0-specDot, 0.0)));
        float diffuseFactor = (9. + 7.*dot(norm, u_Diffuse.xyz))/16.;
        if (drawMode == 1) {
            v_Color /= 8.;
            diffuseFactor /= 2.;
        }
        v_Color += u_BlendColor.rgb * max(0.0, diffuseFactor - u_BlendColor.a);
        v_Color = clamp(v_Color, 0.0, 1.0);
    }
#ifdef DISABLE_VERTEX_COLOR
    v_Color = vec3(1.0);
#endif

    v_FlatColor = v_Color;
    if (drawMode == 2)
        v_Color = vec3(u_BlendColor.a);
#ifdef TEXTURE
    v_TexCoord = vec3(a_TexCoord, 1.0);
    v_TexCoord.xy = UnpackMatrix(u_TexMatrix)*vec4(v_TexCoord.xy, 0.0, 1.0);
#ifdef RETRO
    v_TexCoord *= gl_Position.w;
#endif
#endif
}
`;

    public override frag = `
void main() {
    int mode = int(u_Params.z);
    vec4 t_Color = vec4(v_Color, 1.0);
    if (mode == ${RenderMode.CRYSTAL})
        t_Color.rgb = v_FlatColor;
#if (defined TEXTURE) && !(defined DISABLE_TEXTURE)
    float base = 1.0;
#ifdef RETRO
    base = v_TexCoord.z;
#endif
    t_Color *= texture(SAMPLER_2D(u_Texture), v_TexCoord.xy/base);
#ifndef DISABLE_VERTEX_COLORS
    t_Color *= 2.0;
#endif
#endif
    // default to transparency enabled (.5), unless the texture explicitly was opaque
    t_Color.a /= 2.0;
    if (t_Color.a < u_DrawParams.y || t_Color.a > u_DrawParams.z)
        discard;

    gl_FragColor = vec4(t_Color.rgb, u_DrawParams.a);
#ifdef DEBUG_BITS
    int bits = DEBUG_BITS;
    gl_FragColor = vec4(float(bits & 4)/4.0 +.1, float(bits & 2)/2.0 +.1, float(bits & 1) +.1, 1.0);
#endif
#ifdef DEBUG_SCALAR
    float val = float(DEBUG_SCALAR);
    gl_FragColor = vec4(1./(1.+exp(min(val, 0.0))) - .5, 1./(1.+exp(-max(val, 0.0))) - .5, .2, 1.0);
#endif
}
`;

    constructor() {
        super();
    }
}


export class TextureData {
    public gfxTexture: GfxTexture;
    public viewerTexture: Viewer.Texture;

    constructor(device: GfxDevice, public page: BIN.TexturePage) {
        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, page.width, page.height, 1));
        device.setResourceName(gfxTexture, page.name);

        device.uploadTextureData(gfxTexture, 0, [page.data]);
        this.gfxTexture = gfxTexture;

        this.viewerTexture = textureToCanvas(page);
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}

function textureToCanvas(texture: BIN.TexturePage): Viewer.Texture {
    const canvas = convertToCanvas(ArrayBufferSlice.fromView(texture.data), texture.width, texture.height, GfxFormat.U8_RGBA_NORM);
    canvas.title = texture.name;

    const surfaces = [canvas];
    const extraInfo = new Map<string, string>();
    return { name: texture.name, surfaces, extraInfo };
}

const additiveBlend: Partial<AttachmentStateSimple> = {
    blendMode: GfxBlendMode.Add,
    blendSrcFactor: GfxBlendFactor.SrcAlpha,
    blendDstFactor: GfxBlendFactor.One,
}
    ;
const subtractiveBlend: Partial<AttachmentStateSimple> = {
    blendMode: GfxBlendMode.ReverseSubtract,
    blendSrcFactor: GfxBlendFactor.One,
    blendDstFactor: GfxBlendFactor.One,
};

const simpleBlend: Partial<AttachmentStateSimple> = {
    blendMode: GfxBlendMode.Add,
    blendSrcFactor: GfxBlendFactor.SrcAlpha,
    blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
};

const opaqueBlend: Partial<AttachmentStateSimple> = {
    blendMode: GfxBlendMode.Add,
    blendSrcFactor: GfxBlendFactor.One,
    blendDstFactor: GfxBlendFactor.Zero,
};

function translateBlendMode(mode: BIN.XLUBlendMode): Partial<AttachmentStateSimple> {
    switch (mode) {
        case BIN.XLUBlendMode.ADD:
        case BIN.XLUBlendMode.ADD_QUARTER:
            return additiveBlend;
        case BIN.XLUBlendMode.SUB:
            return subtractiveBlend;
        case BIN.XLUBlendMode.DISABLED:
            return opaqueBlend;
    }
    return simpleBlend;
}

export class TextureAnimator {
    public frame: number;
    constructor(private uvs: BIN.UV[], private anims: BIN.TextureAnimation[], private inds: number[], public textures: TextureData[]) { }

    public setTime(time: number): void {
        this.frame = time * 30 / 1000;
    }

    public setFrame(frame: number): void {
        this.frame = frame;
    }

    public fillTexture(index: number, mapping: TextureMapping, mtx: mat4): BIN.TexturePage {
        const anim = this.anims[index];
        if (anim.mipMapped) {
            index = anim.start;
        } else {
            index = anim.start + (((this.frame >>> anim.frameShift) + anim.offset) & anim.countMask);
        }
        index--;
        // if (index >= Math.min(this.inds.length, this.uvs.length))
        //     return;
        const tex = this.textures[this.inds[index]];
        const uv = this.uvs[index];
        mapping.gfxTexture = tex.gfxTexture;
        mtx[12] = invlerp(tex.page.bounds[0], tex.page.bounds[1] + 1, uv.us[0] + .5);
        mtx[13] = invlerp(tex.page.bounds[2], tex.page.bounds[3] + 1, uv.vs[0] + .5);

        mtx[0] = invlerp(tex.page.bounds[0], tex.page.bounds[1] + 1, uv.us[1] + .5) - mtx[12];
        mtx[1] = invlerp(tex.page.bounds[2], tex.page.bounds[3] + 1, uv.vs[1] + .5) - mtx[13];

        mtx[4] = invlerp(tex.page.bounds[0], tex.page.bounds[1] + 1, uv.us[2] + .5) - mtx[12];
        mtx[5] = invlerp(tex.page.bounds[2], tex.page.bounds[3] + 1, uv.vs[2] + .5) - mtx[13];
        return tex.page;
    }
}

export class RenderGlobals {
    public fadeProgram = new WarpedProgram();
    public fadeGFXProgram: GfxProgram;
    public fadeGFXState: Partial<GfxMegaStateDescriptor>;
    public spriteMesh: SimpleMeshData;
    public renderHelper: GfxRenderHelper;
    public renderInstManager: GfxRenderInstManager;
    public renderInstListMain = new GfxRenderInstList();
    public renderInstListSkybox = new GfxRenderInstList();
    public textureRemaps: WarpTextureRemap[] = nArray(4, () => ({
        id: -1,
        from: -1,
        to: -1,
    }));

    constructor(device: GfxDevice, public textures: TextureData[], public meshData: AnyGFXData[]) {
        this.renderHelper = new GfxRenderHelper(device);
        this.renderInstManager = this.renderHelper.renderInstManager;
        const sprite: BIN.SimpleMeshGFX = {
            kind: "simple",
            vertexData: new Float32Array([
            //  r  g  b  u  v  x     y     z
                .5, .5, .5, 0, 0, -12.5,  12.5, 0,
                .5, .5, .5, 1, 0,  12.5,  12.5, 0,
                .5, .5, .5, 0, 1, -12.5, -12.5, 0,
                .5, .5, .5, 1, 1,  12.5, -12.5, 0,
            ]),
            indexData: new Uint16Array([0,1,2,1,2,3]),
            drawCalls: [{
                startIndex: 0,
                indexCount: 6,
                texAnimIndex: -1,
                textureIndex: 0, // we'll overwrite this
                oneSided: false,
            }],
        }
        const cache = this.renderHelper.renderCache;
        this.spriteMesh = new SimpleMeshData(device, cache, -1, sprite, new TextureAnimator([], [], [], textures));
        meshData.push(this.spriteMesh);
        this.fadeGFXProgram = cache.createProgram(this.fadeProgram);
        this.fadeGFXState = {
            depthCompare: GfxCompareMode.GreaterEqual,
            depthWrite: false,
            cullMode: GfxCullMode.Back,
        };
    }

    public setCurrentList(isSkybox: boolean) {
        this.renderInstManager.setCurrentList(isSkybox ? this.renderInstListSkybox : this.renderInstListMain);
    }
}

class DrawCallInstance {
    private gfxProgram: GfxProgram;
    private program: WarpedProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private textureMappings = nArray(1, () => new TextureMapping());
    private textureMatrix = mat4.create();
    public layer = GfxRendererLayer.OPAQUE;
    public visible = true;
    private texMode = BIN.XLUBlendMode.DISABLED;
    private blendMode = BIN.XLUBlendMode.DISABLED;
    private staleShader = false;
    public spriteFrame: BIN.SpriteFrame | null = null;

    constructor(cache: GfxRenderCache, levelIndex: number, private drawCall: BIN.DrawCall, animation: TextureMapping | null) {
        this.program = new WarpedProgram();

        this.megaStateFlags = {
            depthCompare: GfxCompareMode.GreaterEqual,
            depthWrite: true,
            cullMode: GfxCullMode.None,
        };

        if (drawCall.textureIndex >= 0 || drawCall.texAnimIndex >= 0) {
            const magFilter = GfxTexFilterMode.Point;
            const minFilter = GfxTexFilterMode.Point;
            const mipFilter = GfxMipFilterMode.Nearest;

            const wrapS = GfxWrapMode.Clamp;
            const wrapT = GfxWrapMode.Clamp;

            this.textureMappings[0].gfxSampler = cache.createSampler({
                minFilter, magFilter, mipFilter,
                wrapS, wrapT,
                minLOD: 0, maxLOD: 100,
            });

            this.program.setDefineBool('TEXTURE', true);
        }
        this.program.setDefineBool('ANIMATED', animation !== null);
        // effects are set based on level flags, but we'll just hard code them
        switch (levelIndex) {
            case 0xE: case 0x1C: // underwater levels
                // case 0x4: // ntropy has a weaker version of this during transitions
                this.program.setDefineBool('EFFECT_UNDERWATER', true); break;
            case 0xB: case 0xC: case 0xF: case 0x10: case 0x1D: // medieval and dino
                this.program.setDefineBool('EFFECT_WATERSURFACE', true); break;
            case 0x12: case 0x1E:
                this.program.setDefineBool('EFFECT_DEPTHFADE', true); break;
        }
        if (animation)
            this.textureMappings.push(animation);
        setAttachmentStateSimple(this.megaStateFlags, translateBlendMode(this.texMode));

        this.gfxProgram = cache.createProgram(this.program);
    }

    private fillMappingFromTexture(texture: TextureData): void {
        this.textureMappings[0].gfxTexture = texture.gfxTexture;

        this.textureMatrix[0] = 1 / texture.page.width;
        this.textureMatrix[5] = 1 / texture.page.height;
        this.textureMatrix[12] = (- texture.page.bounds[0]) / texture.page.width;
        this.textureMatrix[13] = (- texture.page.bounds[2]) / texture.page.height;

        this.texMode = texture.page.blendMode;
    }

    public fillMappingFromSprite(uv: BIN.UV, code: number, textures: TextureData[]): BIN.XLUBlendMode {
        // overwrite texture index, only makes sense for sprite
        this.drawCall.textureIndex = uv.texIndex;
        const tex = textures[uv.texIndex];
        this.textureMappings[0].gfxTexture = tex.gfxTexture;

        this.textureMatrix[0] = (uv.us[1] - uv.us[0]) / tex.page.width;
        this.textureMatrix[5] = (uv.vs[2] - uv.vs[0]) / tex.page.height;
        this.textureMatrix[12] = (uv.us[0] - tex.page.bounds[0]) / tex.page.width;
        this.textureMatrix[13] = (uv.vs[0] - tex.page.bounds[2]) / tex.page.height;

        if (code & 2)
            return tex.page.blendMode;
        else
            return BIN.XLUBlendMode.DISABLED;
    }

    public checkStale(globals: RenderGlobals): void {
        if (this.staleShader) {
            this.staleShader = false;
            this.gfxProgram = globals.renderInstManager.gfxRenderCache.createProgram(this.program);
        }
    }

    public prepareToRender(globals: RenderGlobals, params: RenderParams, texAnim: TextureAnimator): void {
        if (!this.visible)
            return;

        this.checkStale(globals);

        let currTex: BIN.TexturePage | null = null;
        if (this.drawCall.textureIndex >= 0) {
            this.fillMappingFromTexture(texAnim.textures[this.drawCall.textureIndex]);
            for (let i = 0; i < globals.textureRemaps.length; i++) {
                if (this.drawCall.textureIndex === globals.textureRemaps[i].from) {
                    this.textureMappings[0].gfxTexture = texAnim.textures[globals.textureRemaps[i].to].gfxTexture;
                }
            }
            currTex = texAnim.textures[this.drawCall.textureIndex].page;
        } else if (this.drawCall.texAnimIndex >= 0) {
            currTex = texAnim.fillTexture(this.drawCall.texAnimIndex, this.textureMappings[0], this.textureMatrix);
            this.texMode = currTex.blendMode;
        }
        let blendMode = this.texMode;
        const mode = params.mode;
        const fading = mode === RenderMode.GLOW && params.blendFactor > 0;
        if (fading)
            this.prepareToRenderFlat(globals);

        switch (mode) {
            case RenderMode.GLOW:
                if (fading) {
                    blendMode = BIN.XLUBlendMode.ADD;
                    break;
                }
            // otherwise, fallthrough to
            case RenderMode.DEFAULT: case RenderMode.ALT_DEPTH:
                if (this.texMode === BIN.XLUBlendMode.ADD_QUARTER)
                    blendMode = BIN.XLUBlendMode.DISABLED;
                break;
            case RenderMode.XLU:
                blendMode = BIN.XLUBlendMode.ADD;
                break;
            case RenderMode.CRYSTAL: case RenderMode.LIT:
                if (this.texMode === BIN.XLUBlendMode.AVERAGE)
                    blendMode = BIN.XLUBlendMode.ADD;
                else
                    blendMode = BIN.XLUBlendMode.DISABLED;
                break;
            case RenderMode.QUAD_LIST:
                // xlu is enabled depending on quad list rect data, need to pipe that through
                break;
        }

        // instead of doing transparency sorting, split textures which are partially opaque into two draw calls
        if (!currTex || currTex.hasXLU)
            this.renderWithMode(globals, mode, blendMode, params.mirrored);
        if (currTex && currTex.hasOPA && blendMode !== BIN.XLUBlendMode.DISABLED)
            this.renderWithMode(globals, mode, BIN.XLUBlendMode.OPAQUE_ONLY, params.mirrored);
        if (mode === RenderMode.CRYSTAL) {
            this.renderWithMode(globals, RenderMode.CRYSTAL_BACK, BIN.XLUBlendMode.DISABLED, params.mirrored);
        }
    }

    public renderWithMode(globals: RenderGlobals, mode: RenderMode, blendMode: BIN.XLUBlendMode, mirrored: boolean): void {
        this.blendMode = blendMode;
        const treatAsOpaque = this.blendMode === BIN.XLUBlendMode.DISABLED || this.blendMode === BIN.XLUBlendMode.OPAQUE_ONLY;

        const renderInst = globals.renderInstManager.newRenderInst();
        this.megaStateFlags.depthWrite = treatAsOpaque;//mode !== RenderMode.CRYSTAL && mode !== RenderMode.XLU && mode !== RenderMode.LIT;
        setAttachmentStateSimple(this.megaStateFlags, translateBlendMode(this.blendMode));
        this.megaStateFlags.cullMode = GfxCullMode.None;
        if (mode === RenderMode.CRYSTAL)
            this.megaStateFlags.cullMode = GfxCullMode.Back;
        else if (mode === RenderMode.CRYSTAL_BACK)
            this.megaStateFlags.cullMode = GfxCullMode.Front;
        else if (this.drawCall.oneSided)
            this.megaStateFlags.cullMode = GfxCullMode.Back;

        if (mirrored) {
            if (this.megaStateFlags.cullMode === GfxCullMode.Back)
                this.megaStateFlags.cullMode = GfxCullMode.Front;
            else if (this.megaStateFlags.cullMode === GfxCullMode.Front)
                this.megaStateFlags.cullMode = GfxCullMode.Back;
        }

        if (!treatAsOpaque) {
            // only place we have to address transparency sorting
            // averaging textures are mostly used for smooth sprite edges,
            // so bias them to sort earlier, resulting in brighter pixels;
            // the alternative gives a bad dark fringe when a sprite is behind an additive texture
            let offset = 1;
            if (blendMode === BIN.XLUBlendMode.AVERAGE)
                offset = 0;
            // something special with crystal front/back?
            renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + offset);
        } else {
            renderInst.sortKey = makeSortKey(GfxRendererLayer.OPAQUE, this.drawCall.textureIndex);
        }

        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.setGfxProgram(this.gfxProgram);

        let offset = renderInst.allocateUniformBuffer(WarpedProgram.ub_TexParams, 8 + 4);
        const mapped = renderInst.mapUniformBufferF32(WarpedProgram.ub_TexParams);

        let lowerAlpha = .25;
        let upperAlpha = .75;
        let fixedAlpha = 1;
        switch (blendMode) {
            case BIN.XLUBlendMode.OPAQUE_ONLY:
                lowerAlpha = .75; // translucent pixels will be drawn separately
            // fallthrough
            case BIN.XLUBlendMode.DISABLED:
                upperAlpha = 2; // both these modes include opaque pixels
                break;
            case BIN.XLUBlendMode.ADD_QUARTER:
                fixedAlpha = .25; break;
            case BIN.XLUBlendMode.AVERAGE:
                fixedAlpha = .5; break;
        }

        // this.program.setDefineString("DEBUG_BITS", blendMode.toString());
        // this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.program);

        offset += fillMatrix4x2(mapped, offset, this.textureMatrix);
        offset += fillVec4(mapped, offset, mode === RenderMode.CRYSTAL_BACK ? 1 : 0, lowerAlpha, upperAlpha, fixedAlpha);

        renderInst.setDrawCount(this.drawCall.indexCount, this.drawCall.startIndex);
        globals.renderInstManager.submitRenderInst(renderInst);
    }

    public prepareToRenderFlat(globals: RenderGlobals): void {
        const renderInst = globals.renderInstManager.newRenderInst();

        setAttachmentStateSimple(globals.fadeGFXState, translateBlendMode(BIN.XLUBlendMode.SUB));
        renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);
        renderInst.setMegaStateFlags(globals.fadeGFXState);
        renderInst.setGfxProgram(globals.fadeGFXProgram);

        let offset = renderInst.allocateUniformBuffer(WarpedProgram.ub_TexParams, 8 + 4);
        const mapped = renderInst.mapUniformBufferF32(WarpedProgram.ub_TexParams);
        offset += fillMatrix4x2(mapped, offset, this.textureMatrix);
        offset += fillVec4(mapped, offset, 2, 0, 2, 1);

        renderInst.setDrawCount(this.drawCall.indexCount, this.drawCall.startIndex);
        globals.renderInstManager.submitRenderInst(renderInst);
    }

    public setVertexColorsEnabled(enabled: boolean): void {
        this.program.setDefineBool("DISABLE_VERTEX_COLOR", !enabled);
        this.staleShader = true;
    }

    public setTexturesEnabled(enabled: boolean): void {
        this.program.setDefineBool("DISABLE_TEXTURE", !enabled);
        this.staleShader = true;
    }

    public setRetroMode(enabled: boolean): void {
        this.program.setDefineBool("RETRO", enabled);
        this.staleShader = true;
    }
}

export type AnyGFXData = ModelData | QuadListData;

export abstract class ModelData {
    protected indexBuffer: GfxBuffer;

    public indexBufferDescriptor: GfxIndexBufferDescriptor;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];

    public inputLayout: GfxInputLayout;
    public drawCalls: DrawCallInstance[] = [];

    constructor(public animator: TextureAnimator) {
    }

    static fromTGEO(device: GfxDevice, cache: GfxRenderCache, info: BIN.MeshInfo, textures: TextureData[]): ModelData {
        const mesh = info.mesh;
        const animator = new TextureAnimator(mesh.tgeo.uvs, mesh.tgeo.texAnims, mesh.textureIndices, textures);
        if (mesh.gfx.kind === "simple")
            return new SimpleMeshData(device, cache, -1, mesh.gfx, animator);
        else
            return new AnimatedMeshData(device, cache, mesh.gfx, animator);
    }

    static fromWGEO(device: GfxDevice, cache: GfxRenderCache, levelIndex: number, wgeo: BIN.WGEO, textures: TextureData[]): SimpleMeshData {
        const animator = new TextureAnimator(wgeo.uvs, wgeo.texAnims, wgeo.textureIndices, textures);
        return new SimpleMeshData(device, cache, levelIndex, wgeo.gfx, animator);
    }

    public setVertexColorsEnabled(enabled: boolean): void {
        for (let i = 0; i < this.drawCalls.length; i++)
            this.drawCalls[i].setVertexColorsEnabled(enabled);
    }

    public setTexturesEnabled(enabled: boolean): void {
        for (let i = 0; i < this.drawCalls.length; i++)
            this.drawCalls[i].setTexturesEnabled(enabled);
    }

    public setRetroMode(enabled: boolean): void {
        for (let i = 0; i < this.drawCalls.length; i++)
            this.drawCalls[i].setRetroMode(enabled);
    }

    abstract destroy(device: GfxDevice): void;

    public paramFromFrame(frame: number): number {
        return 0;
    }

    public applyVertexRescaling(dst: mat4, src: ReadonlyMat4, frame: number) {
        mat4.copy(dst, src);
    }
}

export class AnimatedMeshData extends ModelData {
    private attrBuffer: GfxBuffer;
    public vertexTextureMapping = new TextureMapping();

    constructor(device: GfxDevice, cache: GfxRenderCache, public mesh: BIN.AnimatedMeshGFX, animator: TextureAnimator) {
        super(animator);

        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, mesh.vertexData.vtxCount, mesh.vertexData.frameCount, 1));
        device.uploadTextureData(gfxTexture, 0, [mesh.vertexData.buffer]);

        this.vertexTextureMapping.gfxTexture = gfxTexture;
        this.vertexTextureMapping.gfxSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Repeat, // allow lerping between first and last frame
            minLOD: 0, maxLOD: 100,
        });

        for (let dc of mesh.drawCalls)
            this.drawCalls.push(new DrawCallInstance(cache, -1, dc, this.vertexTextureMapping));

        this.attrBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, assertExists(mesh.attrData).buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: WarpedProgram.a_Position, bufferIndex: 0, bufferByteOffset: 5 * 4, format: GfxFormat.F32_R },
            { location: WarpedProgram.a_Color, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB },
            { location: WarpedProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 3 * 4, format: GfxFormat.F32_RG },
        ];
        const vertexLayoutDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 4 * (1 + 3 + 2), frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        this.vertexBufferDescriptors = [{ buffer: this.attrBuffer }];

        const indexData = this.mesh.indexData;
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, Uint16Array.from(indexData).buffer);
        const indexBufferFormat = GfxFormat.U16_R;
        this.indexBufferDescriptor = { buffer: this.indexBuffer };

        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors: vertexLayoutDescriptors, indexBufferFormat });
    }

    public override paramFromFrame(frame: number): number {
        return (frame + .5) / this.mesh.vertexData.frameCount;
    }

    public override applyVertexRescaling(dst: mat4, src: ReadonlyMat4, frame: number) {
        const base = (frame | 0) % this.mesh.vertexData.frameCount;
        const next = (base + 1) % this.mesh.vertexData.frameCount;
        const origins = this.mesh.vertexData.origins;
        vec3.lerp(scratchVec, origins[base], origins[next], frame % 1);
        vec3.scale(scratchVec, scratchVec, 1 / 8);
        mat4.fromScaling(dst, this.mesh.vertexData.scale);
        mat4.translate(dst, dst, scratchVec);
        mat4.mul(dst, src, dst);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.attrBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyTexture(this.vertexTextureMapping.gfxTexture!);
    }
}

export class SimpleMeshData extends ModelData {
    private vertexBuffer: GfxBuffer;

    constructor(device: GfxDevice, cache: GfxRenderCache, levelIndex: number, public mesh: BIN.SimpleMeshGFX, animator: TextureAnimator) {
        super(animator);
        for (let dc of mesh.drawCalls)
            this.drawCalls.push(new DrawCallInstance(cache, levelIndex, dc, null));

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, mesh.vertexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: WarpedProgram.a_Position, bufferIndex: 0, bufferByteOffset: 5 * 4, format: GfxFormat.F32_RGB },
            { location: WarpedProgram.a_Color, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB },
            { location: WarpedProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 3 * 4, format: GfxFormat.F32_RG },
        ];
        const vertexLayoutDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 4 * (3 + 3 + 2), frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        this.vertexBufferDescriptors = [{ buffer: this.vertexBuffer }];

        const indexData = this.mesh.indexData;
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, Uint16Array.from(indexData).buffer);
        const indexBufferFormat = GfxFormat.U16_R;
        this.indexBufferDescriptor = { buffer: this.indexBuffer };

        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors: vertexLayoutDescriptors, indexBufferFormat });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

export const enum RenderMode {
    DEFAULT,
    FOG,
    XLU,
    CRYSTAL,
    LIT,
    CONST,
    ALT_DEPTH,
    GLOW,

    // not in game
    CRYSTAL_BACK,
    QUAD_LIST,
}

export interface WarpTextureRemap {
    from: number;
    to: number;
    id: number;
}

export interface RenderParams {
    mode: RenderMode;
    billboard: boolean;
    skybox: boolean;
    blendFactor: number;
    blendColor: vec3;
    diffuse: vec3;
    specular: vec3;
    depthOffset: number;
    debug: number;
    mirrored: boolean;
}

const scratchMatrices = nArray(2, () => mat4.create());
const scratchVec = vec3.create();
export function renderMesh(globals: RenderGlobals, viewerInput: Viewer.ViewerRenderInput, data: ModelData, mtx: ReadonlyMat4, pos: ReadonlyVec3, vtxFrame: number, uvFrame: number, params: RenderParams): void {
    if (uvFrame >= 0)
        data.animator.setFrame(uvFrame);
    else
        data.animator.setTime(viewerInput.time);

    const template = globals.renderInstManager.pushTemplate();
    template.setVertexInput(data.inputLayout, data.vertexBufferDescriptors, data.indexBufferDescriptor);
    globals.setCurrentList(params.skybox);

    let offs = template.allocateUniformBuffer(WarpedProgram.ub_ModelParams, 12 + 4 * 4);
    const mapped = template.mapUniformBufferF32(WarpedProgram.ub_ModelParams);

    modelView(scratchMatrices[0], viewerInput, mtx, pos, params.billboard);
    data.applyVertexRescaling(scratchMatrices[1], scratchMatrices[0], vtxFrame);

    let simpleMode = params.mode;
    switch (params.mode) {
        case RenderMode.ALT_DEPTH: case RenderMode.XLU:
        case RenderMode.GLOW: case RenderMode.QUAD_LIST:
            simpleMode = RenderMode.DEFAULT; break;
    }

    offs += fillMatrix4x3(mapped, offs, scratchMatrices[1]);
    offs += fillVec4(mapped, offs, data.paramFromFrame(vtxFrame), params.depthOffset, simpleMode);
    offs += fillVec3v(mapped, offs, params.blendColor, params.blendFactor);
    // game doesn't check or correct for scaling here
    mat4.transpose(scratchMatrices[1], scratchMatrices[0]);
    transformVec3Mat4w0(scratchVec, scratchMatrices[1], params.diffuse);
    offs += fillVec3v(mapped, offs, scratchVec);
    transformVec3Mat4w0(scratchVec, scratchMatrices[1], params.specular);
    offs += fillVec3v(mapped, offs, scratchVec);

    for (let i = 0; i < data.drawCalls.length; i++)
        data.drawCalls[i].prepareToRender(globals, params, data.animator);

    globals.renderInstManager.popTemplate();
}

const lightScratch: RenderParams = {
    billboard: false,
    skybox: false,
    mode: 0,
    blendFactor: 0,
    blendColor: vec3.create(),
    diffuse: vec3.create(),
    specular: vec3.create(),
    depthOffset: 0,
    debug: -1,
    mirrored: false,
};

export function renderWorldMesh(globals: RenderGlobals, viewerInput: Viewer.ViewerRenderInput, data: ModelData, pos: vec3, skybox: boolean): void {
    if (skybox) {
        getMatrixTranslation(scratchVec, viewerInput.camera.worldMatrix);
        vec3.add(scratchVec, scratchVec, pos);
    } else
        vec3.copy(scratchVec, pos);
    lightScratch.skybox = skybox;
    renderMesh(globals, viewerInput, data, Mat4Identity, scratchVec, 0, -1, lightScratch);
}

export class QuadListData {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;

    public indexBufferDescriptor: GfxIndexBufferDescriptor;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];

    public inputLayout: GfxInputLayout;

    public drawCalls: DrawCallInstance[][] = [];
    public static textureAnimator: TextureAnimator;

    constructor(device: GfxDevice, cache: GfxRenderCache, public info: BIN.QuadListInfo) {
        const data = info.data;
        for (let frame of data.drawCalls) {
            const curr: DrawCallInstance[] = [];
            for (let dc of frame)
                curr.push(new DrawCallInstance(cache, -1, dc, null));
            this.drawCalls.push(curr);
        }

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, data.vertexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: WarpedProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB },
            { location: WarpedProgram.a_Color, bufferIndex: 0, bufferByteOffset: 3 * 4, format: GfxFormat.F32_RGB },
            { location: WarpedProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 6 * 4, format: GfxFormat.F32_RG },
        ];
        const vertexLayoutDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 4 * (3 + 3 + 2), frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        this.vertexBufferDescriptors = [{ buffer: this.vertexBuffer }];

        const indexData = this.info.data.indexData;
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, Uint16Array.from(indexData).buffer);
        const indexBufferFormat = GfxFormat.U16_R;
        this.indexBufferDescriptor = { buffer: this.indexBuffer };

        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors: vertexLayoutDescriptors, indexBufferFormat });
    }

    public setVertexColorsEnabled(enabled: boolean): void {
        for (let frame = 0; frame < this.drawCalls.length; frame++)
            for (let i = 0; i < this.drawCalls[frame].length; i++)
                this.drawCalls[frame][i].setVertexColorsEnabled(enabled);
    }

    public setTexturesEnabled(enabled: boolean): void {
        for (let frame = 0; frame < this.drawCalls.length; frame++)
            for (let i = 0; i < this.drawCalls[frame].length; i++)
                this.drawCalls[frame][i].setTexturesEnabled(enabled);
    }

    public setRetroMode(enabled: boolean): void {
        for (let frame = 0; frame < this.drawCalls.length; frame++)
            for (let i = 0; i < this.drawCalls[frame].length; i++)
                this.drawCalls[frame][i].setRetroMode(enabled);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

function modelView(dst: mat4, viewerInput: Viewer.ViewerRenderInput, mtx: ReadonlyMat4, pos: ReadonlyVec3, billboard: boolean): void {
    mat4.fromTranslation(dst, pos);
    mat4.mul(dst, viewerInput.camera.viewMatrix, dst);
    // the game does Z billboarding, but the camera rarely points up or down in game
    if (billboard) {
        calcBillboardMatrix(dst, dst, CalcBillboardFlags.UseRollLocal | CalcBillboardFlags.PriorityY | CalcBillboardFlags.UseZSphere);
    }
    mat4.mul(dst, dst, mtx); // preserve rotation in original matrix for billboards
}

export function renderQuadList(globals: RenderGlobals, viewerInput: Viewer.ViewerRenderInput, data: QuadListData, mtx: ReadonlyMat4, pos: ReadonlyVec3, frame: number, params: RenderParams): void {
    const template = globals.renderInstManager.pushTemplate();

    template.setVertexInput(data.inputLayout, data.vertexBufferDescriptors, data.indexBufferDescriptor);
    globals.setCurrentList(params.skybox);

    let offs = template.allocateUniformBuffer(WarpedProgram.ub_ModelParams, 12 + 4 * 4);
    const mapped = template.mapUniformBufferF32(WarpedProgram.ub_ModelParams);
    modelView(scratchMatrices[0], viewerInput, mtx, pos, true);
    offs += fillMatrix4x3(mapped, offs, scratchMatrices[0]);
    offs += fillVec4(mapped, offs, 0);

    offs += fillMatrix4x3(mapped, offs, scratchMatrices[1]);
    offs += fillVec4(mapped, offs, 0, params.depthOffset);
    offs += fillVec3v(mapped, offs, params.blendColor, params.blendFactor);
    // no lighting
    offs += fillVec4(mapped, offs, 0);
    offs += fillVec4(mapped, offs, 0);

    for (let i = 0; i < data.drawCalls[frame].length; i++)
        data.drawCalls[frame][i].prepareToRender(globals, params, QuadListData.textureAnimator);
    globals.renderInstManager.popTemplate();
}

export function renderSprite(globals: RenderGlobals, viewerInput: Viewer.ViewerRenderInput, mtx: ReadonlyMat4, pos: ReadonlyVec3, billboard: boolean, uv: BIN.UV, code: number, color: ReadonlyVec3): void {
    getMatrixAxisX(scratchVec, mtx);
    const scale = vec3.len(scratchVec);
    if (!viewerInput.camera.frustum.containsSphere(pos, 12.5 * scale))
        return;

    const template = globals.renderInstManager.pushTemplate();

    template.setVertexInput(globals.spriteMesh.inputLayout, globals.spriteMesh.vertexBufferDescriptors, globals.spriteMesh.indexBufferDescriptor);

    let offs = template.allocateUniformBuffer(WarpedProgram.ub_ModelParams, 12 + 4 * 4);
    const mapped = template.mapUniformBufferF32(WarpedProgram.ub_ModelParams);
    modelView(scratchMatrices[0], viewerInput, mtx, pos, billboard);
    offs += fillMatrix4x3(mapped, offs, scratchMatrices[0]);
    offs += fillVec4(mapped, offs, 0, 0, RenderMode.DEFAULT);
    // set param to 1 to use this instead of the color in the vertex buffer
    offs += fillVec3v(mapped, offs, color, 1);
    const dc = globals.spriteMesh.drawCalls[0];
    dc.checkStale(globals);

    const blendMode = dc.fillMappingFromSprite(uv, code, globals.textures);
    const currTex = globals.textures[uv.texIndex].page;
    // instead of doing transparency sorting, split textures which are partially opaque into two draw calls
    if (currTex.hasXLU)
        dc.renderWithMode(globals, RenderMode.DEFAULT, blendMode, false);
    if (currTex && currTex.hasOPA && blendMode !== BIN.XLUBlendMode.DISABLED)
        dc.renderWithMode(globals, RenderMode.DEFAULT, BIN.XLUBlendMode.OPAQUE_ONLY, false);

    globals.renderInstManager.popTemplate();
}

class WaterProgram extends DeviceProgram {
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
    Mat3x4 u_ModelViewMatrix;
    vec4 u_Params;
};

varying vec2 v_TexCoord;
varying float v_Color;

uniform sampler2D u_Waves_0;
uniform sampler2D u_Waves_1;
uniform sampler2D u_Texture;
`;

    public override vert = `
layout(location = 0) in uvec3 a_Position;

void main() {
    vec2 pos = vec2(a_Position.xz);
    vec2 camPos = u_Params.yz;
#ifdef FAKE
    pos = floor(pos + camPos - 64.);
#endif
    vec2 reduced = (pos + .5)/32.;
    vec4 begin = textureLod(SAMPLER_2D(u_Waves_0), reduced, 0.);
    vec4 end = textureLod(SAMPLER_2D(u_Waves_1), reduced, 0.);
    vec4 attrs = mix(begin, end, u_Params.x);
    vec4 realPos = vec4(pos.x, float(a_Position.y) * (attrs.w - .5) *2. , pos.y, 1.);
    gl_Position = UnpackMatrix(u_Projection) * vec4(UnpackMatrix(u_ModelViewMatrix) * realPos, 1.);
    v_TexCoord = attrs.xy;
    float dist = clamp(distance(pos, camPos)/16., 1., 3.);
    v_Color = attrs.z * (3. - dist)/2.;
}
`;

    public override frag = `
void main() {
    gl_FragColor = texture(SAMPLER_2D(u_Texture), v_TexCoord) * vec4(vec3(v_Color), 2.);
}
`;

    constructor() {
        super();
    }
}

export class WaterMeshData {
    private vertexBuffer: GfxBuffer;
    protected indexBuffer: GfxBuffer;

    private indexBufferDescriptor: GfxIndexBufferDescriptor;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];

    public inputLayout: GfxInputLayout;

    public program: WaterProgram;
    public gfxProgram: GfxProgram;

    public textureMappings: TextureMapping[] = nArray(3, () => new TextureMapping());
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    private bindingLayout: GfxBindingLayoutDescriptor[] = [{
        numUniformBuffers: 2,
        numSamplers: 3,
    }];

    public visible = true;

    constructor(device: GfxDevice, cache: GfxRenderCache, fakeMesh: boolean, public vertexData: Uint8Array, public indexData: Uint16Array, private waterTextureUV: BIN.UV, private animTextures: number[]) {
        this.program = new WaterProgram();
        this.program.setDefineBool("FAKE", fakeMesh);
        this.gfxProgram = cache.createProgram(this.program);

        const pointSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minLOD: 0, maxLOD: 100,
        });
        for (let i = 0; i < this.textureMappings.length; i++)
            this.textureMappings[i].gfxSampler = pointSampler;

        this.megaStateFlags = {
            depthCompare: GfxCompareMode.GreaterEqual,
            depthWrite: false,
            cullMode: GfxCullMode.None,
        };
        setAttachmentStateSimple(this.megaStateFlags, translateBlendMode(BIN.XLUBlendMode.ADD));

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, vertexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: WaterProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.U8_RGB },
        ];
        const vertexLayoutDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 4, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        this.vertexBufferDescriptors = [{ buffer: this.vertexBuffer }];

        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, Uint16Array.from(indexData).buffer);
        const indexBufferFormat = GfxFormat.U16_R;
        this.indexBufferDescriptor = { buffer: this.indexBuffer };

        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors: vertexLayoutDescriptors, indexBufferFormat });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, frame: number, textures: TextureData[]): void {
        if (!this.visible)
            return;

        const animIndex = frame >> 3;

        this.textureMappings[0].gfxTexture = textures[this.animTextures[animIndex % this.animTextures.length]].gfxTexture;
        this.textureMappings[1].gfxTexture = textures[this.animTextures[(animIndex + 1) % this.animTextures.length]].gfxTexture;
        this.textureMappings[2].gfxTexture = textures[this.waterTextureUV.texIndex].gfxTexture;

        const renderInst = renderInstManager.newRenderInst();

        renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT, 0);
        renderInst.setBindingLayouts(this.bindingLayout);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);

        let offs = renderInst.allocateUniformBuffer(WaterProgram.ub_ModelParams, 12 + 4);
        const mapped = renderInst.mapUniformBufferF32(WaterProgram.ub_ModelParams);
        vec3.set(scratchVec, 64, 4, 64);
        mat4.scale(scratchMatrices[0], viewerInput.camera.viewMatrix, scratchVec);
        mat4.getTranslation(scratchVec, viewerInput.camera.worldMatrix);
        vec3.scale(scratchVec, scratchVec, 1/64);
        offs += fillMatrix4x3(mapped, offs, scratchMatrices[0]);
        offs += fillVec4(mapped, offs, (frame % 8)/8, scratchVec[0], scratchVec[2]);

        renderInst.setDrawCount(this.indexData.length, 0);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

class TerrainProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_QuadIndex = 1;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;
    public static ub_DrawParams = 2;

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};
layout(std140) uniform ub_ModelParams {
    Mat3x4 u_ModelViewMatrix;
    vec4 u_Params;
};
layout(std140) uniform ub_DrawParams {
    Mat2x4 u_TexMatrix;
};

varying vec2 v_TexCoord;
varying vec4 v_Color;

uniform sampler2D u_Terrain;
uniform sampler2D u_Texture;
`;

    public override vert = `
layout(location = 0) in uvec3 a_Position;
layout(location = 1) in uint a_QuadIndex;

void main() {
    vec2 pos = vec2(a_Position.xy);
    vec2 camPos = u_Params.xy;
    pos += 8.*floor(camPos/8.) - 32.;
    vec4 data = textureLod(SAMPLER_2D(u_Terrain), (pos + .5)/64., 0.);
    vec4 realPos = vec4(pos.x, data.a, pos.y, 1.);
    gl_Position = UnpackMatrix(u_Projection) * vec4(UnpackMatrix(u_ModelViewMatrix) * realPos, 1.);
    uint index = a_QuadIndex;
    v_TexCoord = vec2(index & 1u, .5*float(index & 2u));
    v_TexCoord = UnpackMatrix(u_TexMatrix) * vec4(v_TexCoord, 0, 1);
    float dist = clamp(distance(pos, camPos)/4., 4., 5.);
    v_Color = vec4(data.rgb, 5. - dist);
}
`;

    public override frag = `
void main() {
    gl_FragColor = texture(SAMPLER_2D(u_Texture), v_TexCoord) * v_Color * 2.;
}
`;

    constructor() {
        super();
    }
}

export class TerrainMeshData {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;

    private indexBufferDescriptor: GfxIndexBufferDescriptor;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];

    public inputLayout: GfxInputLayout;

    public program: WaterProgram;
    public gfxProgram: GfxProgram;

    public textureMappings: TextureMapping[] = nArray(2, () => new TextureMapping());
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    public textureMatrix = mat4.create();

    public visible = true;

    constructor(device: GfxDevice, cache: GfxRenderCache, public vertexData: Uint8Array, public indexData: Uint16Array, private terrainIndex: number, private drawCalls: BIN.DrawCall[]) {
        this.program = new TerrainProgram();
        this.gfxProgram = cache.createProgram(this.program);

        const pointSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Point,
            magFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minLOD: 0, maxLOD: 100,
        });
        for (let i = 0; i < this.textureMappings.length; i++)
            this.textureMappings[i].gfxSampler = pointSampler;

        this.megaStateFlags = {
            depthCompare: GfxCompareMode.GreaterEqual,
            depthWrite: true,
            cullMode: GfxCullMode.None,
        };
        setAttachmentStateSimple(this.megaStateFlags, translateBlendMode(BIN.XLUBlendMode.AVERAGE));

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, vertexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: TerrainProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.U8_RGB },
            { location: TerrainProgram.a_QuadIndex, bufferIndex: 0, bufferByteOffset: 2, format: GfxFormat.U8_R },
        ];
        const vertexLayoutDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 4, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        this.vertexBufferDescriptors = [{ buffer: this.vertexBuffer }];

        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, Uint16Array.from(indexData).buffer);
        const indexBufferFormat = GfxFormat.U16_R;
        this.indexBufferDescriptor = { buffer: this.indexBuffer };

        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors: vertexLayoutDescriptors, indexBufferFormat });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, textures: TextureData[]): void {
        if (!this.visible)
            return;

        this.textureMappings[0].gfxTexture = textures[this.terrainIndex].gfxTexture;
        const template = renderInstManager.pushTemplate();

        template.sortKey = makeSortKey(GfxRendererLayer.OPAQUE, 0);
        template.setMegaStateFlags(this.megaStateFlags);
        template.setGfxProgram(this.gfxProgram);
        template.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);

        let offs = template.allocateUniformBuffer(TerrainProgram.ub_ModelParams, 12 + 4);
        const mapped = template.mapUniformBufferF32(TerrainProgram.ub_ModelParams);
        vec3.set(scratchVec, 256, 512, 256);
        mat4.scale(scratchMatrices[0], viewerInput.camera.viewMatrix, scratchVec);
        mat4.getTranslation(scratchVec, viewerInput.camera.worldMatrix);
        vec3.scale(scratchVec, scratchVec, 1 / 256);
        offs += fillMatrix4x3(mapped, offs, scratchMatrices[0]);
        offs += fillVec4(mapped, offs, scratchVec[0], scratchVec[2]);


        for (let i = 0; i < this.drawCalls.length; i++) {
            const dc = this.drawCalls[i];
            this.textureMappings[1].gfxTexture = textures[dc.textureIndex].gfxTexture;
            const renderInst = renderInstManager.newRenderInst();

            renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
            let offs = renderInst.allocateUniformBuffer(TerrainProgram.ub_DrawParams, 8);
            const mapped = renderInst.mapUniformBufferF32(TerrainProgram.ub_DrawParams);
            fillMatrix4x2(mapped, offs, this.textureMatrix);
            renderInst.setDrawCount(dc.indexCount, dc.startIndex);

            renderInstManager.submitRenderInst(renderInst);
        }

        template.setDrawCount(this.indexData.length);
        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}
