import { mat4, ReadonlyVec3, vec3 } from "gl-matrix";
import { makeBackbufferDescSimple, makeAttachmentClearDescriptor, opaqueBlackFullClearRenderPassDescriptor } from "../../gfx/helpers/RenderGraphHelpers.js";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBuffer, GfxBufferUsage, GfxChannelWriteMask, GfxCompareMode, GfxCullMode, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgram, GfxTexFilterMode, GfxTexture, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D } from "../../gfx/platform/GfxPlatform.js";
import { GfxrAttachmentSlot } from "../../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../../gfx/render/GfxRenderHelper.js";
import { GfxRenderInst, GfxRenderInstList } from "../../gfx/render/GfxRenderInstManager.js";
import { SceneContext } from "../../SceneBase.js";
import { ViewerRenderInput } from "../../viewer.js";
import { RwAlphaTestFunction, RwBlendFunction, RwCamera, RwCullMode, RwRasterFormat, RwTexture, RwTextureAddressMode, RwTextureFilterMode } from "./rwcore.js";
import { makeStaticDataBuffer } from "../../gfx/helpers/BufferHelpers.js";
import { convertToTriangleIndexBuffer, filterDegenerateTriangleIndexBuffer, GfxTopology } from "../../gfx/helpers/TopologyHelpers.js";
import { makeMegaState } from "../../gfx/helpers/GfxMegaStateDescriptorHelpers.js";
import { reverseDepthForCompareMode } from "../../gfx/helpers/ReversedDepthHelpers.js";
import { fillColor, fillMatrix4x4, fillVec3v, fillVec4 } from "../../gfx/helpers/UniformBufferHelpers.js";
import { Color, colorCopy, colorNewCopy, OpaqueBlack, TransparentBlack, White } from "../../Color.js";
import { assert, nArray } from "../../util.js";
import { TextureMapping } from "../../TextureHolder.js";
import { DeviceProgram } from "../../Program.js";
import { GfxShaderLibrary } from "../../gfx/helpers/GfxShaderLibrary.js";
import { RpLightFlag, RpLightType, RpWorld } from "./rpworld.js";
import { getMatrixAxisZ } from "../../MathHelpers.js";
import { IS_DEVELOPMENT } from "../../BuildVersion.js";

interface RwGfxProgramDefines {
    useNormalArray: boolean;
    useColorArray: boolean;
    useTextureCoordArray: boolean;
    useTexture: boolean;
    useFog: boolean;
    useLighting: boolean;
    useAlphaTest: boolean;
    alphaTestFunction: RwAlphaTestFunction;
}

class RwGfxProgram extends DeviceProgram {
    public static readonly a_Position = 0;
    public static readonly a_Normal = 1;
    public static readonly a_Color = 2;
    public static readonly a_TexCoord = 3;

    public static readonly ub_SceneParams = 0;

    public ub_SceneParamsSIZE: number;

    public static readonly bindingLayouts: GfxBindingLayoutDescriptor[] = [
        { numUniformBuffers: 1, numSamplers: 1 }
    ];

    public static readonly vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
        { location: RwGfxProgram.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB,  bufferByteOffset: 0*0x04 },
        { location: RwGfxProgram.a_Normal,   bufferIndex: 0, format: GfxFormat.F32_RGB,  bufferByteOffset: 3*0x04 },
        { location: RwGfxProgram.a_Color,    bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 6*0x04 },
        { location: RwGfxProgram.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG,   bufferByteOffset: 10*0x04 },
    ];

    public static readonly vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
        { byteStride: 12*0x04, frequency: GfxVertexBufferFrequency.PerVertex },
    ];

    constructor(d: RwGfxProgramDefines) {
        super();

        this.defines.set('USE_NORMAL_ARRAY', d.useNormalArray ? '1' : '0');
        this.defines.set('USE_COLOR_ARRAY', d.useColorArray ? '1' : '0');
        this.defines.set('USE_TEXTURE_COORD_ARRAY', d.useTextureCoordArray ? '1' : '0');
        this.defines.set('USE_TEXTURE', d.useTexture ? '1' : '0');
        this.defines.set('USE_FOG', d.useFog ? '1' : '0');
        this.defines.set('USE_LIGHTING', d.useLighting ? '1' : '0');
        this.defines.set('USE_ALPHA_TEST', d.useAlphaTest ? '1' : '0');
        this.defines.set('ALPHA_TEST_FUNCTION', d.alphaTestFunction.toString());

        this.ub_SceneParamsSIZE = 16*3 + 4*3;
        if (d.useLighting) {
            this.ub_SceneParamsSIZE += 12*RwGfx.MAX_LIGHTS;
        }
        if (d.useFog) {
            this.ub_SceneParamsSIZE += 4;
        }
    }
    
    public override both = `
precision mediump float;

#if USE_LIGHTING
#define MAX_LIGHTS ${RwGfx.MAX_LIGHTS}

struct Light {
    vec4 ambient;
    vec4 diffuse;
    vec4 direction;
};
#endif

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x4 u_ViewMatrix;
    Mat4x4 u_ModelMatrix;
#if USE_LIGHTING
    Light u_Lights[MAX_LIGHTS];
#endif
#if USE_FOG
    vec4 u_FogColor;
#endif
    vec4 u_MaterialColor;
    vec4 u_Misc1;
    vec4 u_Misc2;
};

#define u_MaterialAmbient u_Misc1.x
#define u_MaterialDiffuse u_Misc1.y
#define u_FogStart u_Misc1.z
#define u_FogEnd u_Misc1.w

#define u_AlphaRef u_Misc2.x

uniform sampler2D u_Texture;

varying vec4 v_Color;

#if USE_TEXTURE_COORD_ARRAY
varying vec2 v_TexCoord;
#endif

#if USE_FOG
varying float v_FogAmount;
#endif
`;

    public override vert = `
${GfxShaderLibrary.invlerp}
${GfxShaderLibrary.saturate}

layout(location = ${RwGfxProgram.a_Position}) in vec3 a_Position;
layout(location = ${RwGfxProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${RwGfxProgram.a_Color}) in vec4 a_Color;
layout(location = ${RwGfxProgram.a_TexCoord}) in vec2 a_TexCoord;

void main() {
    gl_Position = Mul(u_Projection, Mul(u_ViewMatrix, Mul(u_ModelMatrix, vec4(a_Position, 1.0))));

#if USE_COLOR_ARRAY
    vec4 t_Color = a_Color;
#elif USE_LIGHTING
    vec4 t_Color = vec4(0, 0, 0, 1);
#else
    vec4 t_Color = vec4(1.0);
#endif

#if (USE_NORMAL_ARRAY && USE_LIGHTING)
    vec3 t_Normal = normalize(Mul(u_ModelMatrix, vec4(a_Normal, 0.0)).xyz);
    vec3 t_LightColor = vec3(0.0);
    for (int i = 0; i < MAX_LIGHTS; i++) {
        Light light = u_Lights[i];
        t_LightColor += light.ambient.rgb * light.ambient.a * u_MaterialAmbient;
        t_LightColor += max(dot(t_Normal, light.direction.xyz), 0.0) * light.diffuse.rgb * light.diffuse.a * u_MaterialDiffuse;
    }
    t_LightColor = min(t_LightColor, vec3(1.0));
    t_Color.rgb += t_LightColor;
#endif

    t_Color *= u_MaterialColor;

    v_Color = t_Color;

#if USE_TEXTURE_COORD_ARRAY
    v_TexCoord = a_TexCoord;
#endif

#if USE_FOG
    v_FogAmount = saturate(invlerp(u_FogStart, u_FogEnd, gl_Position.w) * u_FogColor.a);
#endif
}
`;

    public override frag = `
void main() {
    vec4 t_Color = v_Color;
    
#if (USE_TEXTURE_COORD_ARRAY && USE_TEXTURE)
    t_Color *= texture(SAMPLER_2D(u_Texture), v_TexCoord);
#endif

#if USE_ALPHA_TEST
#if ALPHA_TEST_FUNCTION == 0
    discard;
#elif ALPHA_TEST_FUNCTION == 1
    if (!(t_Color.a < u_AlphaRef)) discard;
#elif ALPHA_TEST_FUNCTION == 2
    if (!(t_Color.a == u_AlphaRef)) discard;
#elif ALPHA_TEST_FUNCTION == 3
    if (!(t_Color.a <= u_AlphaRef)) discard;
#elif ALPHA_TEST_FUNCTION == 4
    if (!(t_Color.a > u_AlphaRef)) discard;
#elif ALPHA_TEST_FUNCTION == 5
    if (!(t_Color.a != u_AlphaRef)) discard;
#elif ALPHA_TEST_FUNCTION == 6
    if (!(t_Color.a >= u_AlphaRef)) discard;
#endif
#endif

#if USE_FOG
    t_Color.rgb = mix(t_Color.rgb, u_FogColor.rgb, v_FogAmount);
#endif

    gl_FragColor = t_Color;
}
`;
}

interface RwGfxProgramInfo {
    program: RwGfxProgram;
    gfxProgram: GfxProgram;
}

export interface RwGfxVertexBuffer {
    buffer: GfxBuffer;
    descriptors: GfxVertexBufferDescriptor[];
}

export interface RwGfxIndexBuffer {
    buffer: GfxBuffer;
    descriptor: GfxIndexBufferDescriptor;
    indexCount: number;
}

export interface RwGfxRaster {
    width: number;
    height: number;
    levels: Uint8Array[];
    lockedMipLevel: number;
    gfxTexture: GfxTexture | null;
    gfxFormat: GfxFormat;
    textureMapping: TextureMapping[];
}

function convertRwRasterFormat(format: RwRasterFormat): GfxFormat {
    switch (format & RwRasterFormat.PIXELFORMATMASK) {
    case RwRasterFormat._8888:
    case RwRasterFormat._888:
        return GfxFormat.U8_RGBA_NORM;
    default: // TODO
        return GfxFormat.U8_RGBA_NORM;
    }
}

function convertRwTextureFilterMode(filter: RwTextureFilterMode): GfxTexFilterMode {
    switch (filter) {
    case RwTextureFilterMode.NEAREST:          return GfxTexFilterMode.Point;
    case RwTextureFilterMode.LINEAR:           return GfxTexFilterMode.Bilinear;
    case RwTextureFilterMode.MIPNEAREST:       return GfxTexFilterMode.Point;
    case RwTextureFilterMode.MIPLINEAR:        return GfxTexFilterMode.Bilinear;
    case RwTextureFilterMode.LINEARMIPNEAREST: return GfxTexFilterMode.Point;
    case RwTextureFilterMode.LINEARMIPLINEAR:  return GfxTexFilterMode.Bilinear;
    default:                                   return GfxTexFilterMode.Point;
    }
}

function convertRwTextureFilterModeMip(filter: RwTextureFilterMode): GfxMipFilterMode {
    switch (filter) {
    case RwTextureFilterMode.NEAREST:          return GfxMipFilterMode.NoMip;
    case RwTextureFilterMode.LINEAR:           return GfxMipFilterMode.NoMip;
    case RwTextureFilterMode.MIPNEAREST:       return GfxMipFilterMode.Nearest;
    case RwTextureFilterMode.MIPLINEAR:        return GfxMipFilterMode.Nearest;
    case RwTextureFilterMode.LINEARMIPNEAREST: return GfxMipFilterMode.Linear;
    case RwTextureFilterMode.LINEARMIPLINEAR:  return GfxMipFilterMode.Linear;
    default:                                   return GfxMipFilterMode.NoMip;
    }
}

function convertRwTextureAddressMode(address: RwTextureAddressMode): GfxWrapMode {
    switch (address) {
    case RwTextureAddressMode.WRAP:             return GfxWrapMode.Repeat;
    case RwTextureAddressMode.MIRROR:           return GfxWrapMode.Mirror;
    case RwTextureAddressMode.CLAMP:            return GfxWrapMode.Clamp;
    case RwTextureAddressMode.BORDER:           return GfxWrapMode.Clamp; // unsupported
    default:                                    return GfxWrapMode.Repeat;
    }
}

function convertRwZTest(ztest: boolean): GfxCompareMode {
    return ztest ? reverseDepthForCompareMode(GfxCompareMode.LessEqual) : reverseDepthForCompareMode(GfxCompareMode.Always);
}

function convertGfxCompareMode(mode: GfxCompareMode): boolean {
    return reverseDepthForCompareMode(mode) === GfxCompareMode.LessEqual;
}

function convertRwBlendFunction(blend: RwBlendFunction): GfxBlendFactor {
    switch (blend) {
    case RwBlendFunction.NABLEND:      return GfxBlendFactor.Zero;
    case RwBlendFunction.ZERO:         return GfxBlendFactor.Zero;
    case RwBlendFunction.ONE:          return GfxBlendFactor.One;
    case RwBlendFunction.SRCCOLOR:     return GfxBlendFactor.Src;
    case RwBlendFunction.INVSRCCOLOR:  return GfxBlendFactor.OneMinusSrc;
    case RwBlendFunction.SRCALPHA:     return GfxBlendFactor.SrcAlpha;
    case RwBlendFunction.INVSRCALPHA:  return GfxBlendFactor.OneMinusSrcAlpha;
    case RwBlendFunction.DESTALPHA:    return GfxBlendFactor.DstAlpha;
    case RwBlendFunction.INVDESTALPHA: return GfxBlendFactor.OneMinusDstAlpha;
    case RwBlendFunction.DESTCOLOR:    return GfxBlendFactor.Dst;
    case RwBlendFunction.INVDESTCOLOR: return GfxBlendFactor.OneMinusDst;
    case RwBlendFunction.SRCALPHASAT:  return GfxBlendFactor.SrcAlpha; // unsupported
    default:                           return GfxBlendFactor.Zero;
    }
}

function convertGfxBlendFactor(blend: GfxBlendFactor): RwBlendFunction {
    switch (blend) {
    case GfxBlendFactor.Zero:             return RwBlendFunction.ZERO;
    case GfxBlendFactor.One:              return RwBlendFunction.ONE;
    case GfxBlendFactor.Src:              return RwBlendFunction.SRCCOLOR;
    case GfxBlendFactor.OneMinusSrc:      return RwBlendFunction.INVSRCCOLOR;
    case GfxBlendFactor.SrcAlpha:         return RwBlendFunction.SRCALPHA;
    case GfxBlendFactor.OneMinusSrcAlpha: return RwBlendFunction.INVSRCALPHA;
    case GfxBlendFactor.DstAlpha:         return RwBlendFunction.DESTALPHA;
    case GfxBlendFactor.OneMinusDstAlpha: return RwBlendFunction.INVDESTALPHA;
    case GfxBlendFactor.Dst:              return RwBlendFunction.DESTCOLOR;
    case GfxBlendFactor.OneMinusDst:      return RwBlendFunction.INVDESTCOLOR;
    default:                              return RwBlendFunction.ZERO;
    }
}

function convertRwCullMode(cull: RwCullMode): GfxCullMode {
    switch (cull) {
    case RwCullMode.NONE:  return GfxCullMode.None;
    case RwCullMode.BACK:  return GfxCullMode.Back;
    case RwCullMode.FRONT: return GfxCullMode.Front;
    default:               return GfxCullMode.None;
    }
}

function convertGfxCullMode(cull: GfxCullMode): RwCullMode {
    switch (cull) {
    case GfxCullMode.None:  return RwCullMode.NONE;
    case GfxCullMode.Back:  return RwCullMode.BACK;
    case GfxCullMode.Front: return RwCullMode.FRONT;
    default:                return RwCullMode.NONE;
    }
}

interface RwGfxLight {
    ambient: Color;
    diffuse: Color;
    direction: vec3;
}

export class RwGfx {
    public static readonly MAX_LIGHTS = 8;
    
    private renderHelper: GfxRenderHelper;
    private viewerInput: ViewerRenderInput;
    private renderInstList = new GfxRenderInstList();
    private megaState: Partial<GfxMegaStateDescriptor> = makeMegaState();
    private programs = new Map<number, RwGfxProgramInfo>();
    private inputLayout: GfxInputLayout;

    private clearColor = colorNewCopy(TransparentBlack);

    private viewMatrix = mat4.create();
    private projectionMatrix = mat4.create();
    private modelMatrix = mat4.create();

    private normalArrayEnabled = false;
    private texCoordArrayEnabled = false;
    private colorArrayEnabled = false;

    private texture: RwTexture | null = null;
    private textureMapping = nArray(1, () => new TextureMapping());

    private fogEnabled = false;
    private fogStart = 0;
    private fogEnd = 1;
    private fogColor = colorNewCopy(TransparentBlack);

    private lightingEnabled = false;
    private lights: RwGfxLight[] = [];

    private materialAmbient = 0.2;
    private materialDiffuse = 0.8;
    private materialColor = colorNewCopy(White);

    private alphaTestEnabled = false;
    private alphaFunc = RwAlphaTestFunction.ALWAYS;
    private alphaRef = 0; // 0 to 1

    constructor(private device: GfxDevice, context: SceneContext) {
        this.renderHelper = new GfxRenderHelper(device, context);
        this.viewerInput = context.viewerInput;

        this.inputLayout = this.renderHelper.renderCache.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors: RwGfxProgram.vertexAttributeDescriptors,
            vertexBufferDescriptors: RwGfxProgram.vertexBufferDescriptors
        });

        for (let i = 0; i < RwGfx.MAX_LIGHTS; i++) {
            this.lights.push({
                ambient: colorNewCopy(OpaqueBlack),
                diffuse: (i === 0) ? colorNewCopy(White) : colorNewCopy(TransparentBlack),
                direction: vec3.fromValues(0, 0, 1)
            });
        }

        this.megaState.attachmentsState![0].channelWriteMask = GfxChannelWriteMask.AllChannels;
    }

    public destroy() {
        this.renderHelper.destroy();
    }

    public render() {
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, this.viewerInput, makeAttachmentClearDescriptor(this.clearColor));
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, this.viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        
        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstList.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, this.viewerInput, mainColorTargetID);

        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, this.viewerInput.onscreenTexture);
        
        this.renderHelper.prepareToRender();
        this.renderHelper.renderGraph.execute(builder);

        this.renderInstList.reset();
    }

    public cameraBegin(camera: RwCamera) {
        mat4.copy(camera.viewMatrix, this.viewerInput.camera.viewMatrix);
        mat4.copy(camera.worldMatrix, this.viewerInput.camera.worldMatrix);

        mat4.copy(this.viewMatrix, this.viewerInput.camera.viewMatrix);

        if (camera.nearPlane !== this.viewerInput.camera.near || camera.farPlane !== this.viewerInput.camera.far) {
            this.viewerInput.camera.setClipPlanes(camera.nearPlane, camera.farPlane);
        }

        mat4.copy(this.projectionMatrix, this.viewerInput.camera.projectionMatrix);
    }

    public cameraEnd(camera: RwCamera) {
    }

    public cameraFrustumContainsSphere(center: ReadonlyVec3, radius: number) {
        return this.viewerInput.camera.frustum.containsSphere(center, radius);
    }

    public createVertexBuffer(vertices: Float32Array, normals?: Float32Array, colors?: Float32Array, texCoords?: Float32Array): RwGfxVertexBuffer {
        const numVerts = vertices.length / 3;

        const attrCount = 3 + 3 + 4 + 2; // Position + Normal + Color + TexCoord
        const data = new Float32Array(attrCount * numVerts);

        let offs = 0, voff = 0, noff = 0, coff = 0, toff = 0;
        for (let i = 0; i < numVerts; i++) {
            data[offs++] = vertices[voff++];
            data[offs++] = vertices[voff++];
            data[offs++] = vertices[voff++];

            if (normals) {
                data[offs++] = normals[noff++];
                data[offs++] = normals[noff++];
                data[offs++] = normals[noff++];
            } else {
                data[offs++] = 0.0;
                data[offs++] = 0.0;
                data[offs++] = 0.0;
            }

            if (colors) {
                data[offs++] = colors[coff++];
                data[offs++] = colors[coff++];
                data[offs++] = colors[coff++];
                data[offs++] = colors[coff++];
            } else {
                data[offs++] = 0.0;
                data[offs++] = 0.0;
                data[offs++] = 0.0;
                data[offs++] = 0.0;
            }

            if (texCoords) {
                data[offs++] = texCoords[toff++];
                data[offs++] = texCoords[toff++];
            } else {
                data[offs++] = 0.0;
                data[offs++] = 0.0;
            }
        }

        const buffer = makeStaticDataBuffer(this.device, GfxBufferUsage.Vertex, data.buffer);
        const descriptors = [{ buffer, byteOffset: 0 }];

        return { buffer, descriptors };
    }

    public destroyVertexBuffer(buffer: RwGfxVertexBuffer) {
        this.device.destroyBuffer(buffer.buffer);
    }

    public createIndexBuffer(indices: Uint16Array): RwGfxIndexBuffer {
        const data = filterDegenerateTriangleIndexBuffer(convertToTriangleIndexBuffer(GfxTopology.TriStrips, indices));

        const buffer = makeStaticDataBuffer(this.device, GfxBufferUsage.Index, data.buffer);
        const descriptor = { buffer, byteOffset: 0 };
        const indexCount = data.length;

        return { buffer, descriptor, indexCount };
    }

    public destroyIndexBuffer(buffer: RwGfxIndexBuffer) {
        this.device.destroyBuffer(buffer.buffer);
    }

    public createRaster(width: number, height: number, format: RwRasterFormat): RwGfxRaster {
        const levels: Uint8Array[] = [];
        const lockedMipLevel = -1;
        const gfxTexture = null;
        const gfxFormat = convertRwRasterFormat(format);
        const textureMapping = nArray(1, () => new TextureMapping());

        return { width, height, levels, lockedMipLevel, gfxTexture, gfxFormat, textureMapping };
    }

    public destroyRaster(raster: RwGfxRaster) {
        if (raster.gfxTexture) {
            this.device.destroyTexture(raster.gfxTexture);
            raster.gfxTexture = null;
        }

        raster.levels.length = 0;
        raster.lockedMipLevel = -1;
    }

    public lockRaster(raster: RwGfxRaster, mipLevel: number) {
        assert(mipLevel >= 0);

        if (raster.gfxTexture) {
            this.device.destroyTexture(raster.gfxTexture);
            raster.gfxTexture = null;
        }

        for (let i = raster.levels.length; i <= mipLevel; i++) {
            const mipWidth = (raster.width >>> i);
            const mipHeight = (raster.height >>> i);
            raster.levels[i] = new Uint8Array(4 * mipWidth * mipHeight);
        }
        
        raster.lockedMipLevel = mipLevel;

        return raster.levels[mipLevel];
    }

    public unlockRaster(raster: RwGfxRaster) {
        assert(raster.lockedMipLevel >= 0);

        raster.gfxTexture = this.device.createTexture(makeTextureDescriptor2D(raster.gfxFormat, raster.width, raster.height, raster.levels.length));

        this.device.uploadTextureData(raster.gfxTexture, 0, raster.levels);

        const mapping = raster.textureMapping[0];
        mapping.width = raster.width;
        mapping.height = raster.height;
        mapping.flipY = false;
        mapping.gfxTexture = raster.gfxTexture;
    }

    public enableDepthTest() {
        this.megaState.depthCompare = convertRwZTest(true);
    }

    public disableDepthTest() {
        this.megaState.depthCompare = convertRwZTest(false);
    }

    public getDepthTest() {
        return convertGfxCompareMode(this.megaState.depthCompare!);
    }
    
    public enableDepthWrite() {
        this.megaState.depthWrite = true;
    }

    public disableDepthWrite() {
        this.megaState.depthWrite = false;
    }

    public getDepthWrite() {
        return this.megaState.depthWrite!;
    }

    public setCullMode(cull: RwCullMode) {
        this.megaState.cullMode = convertRwCullMode(cull);
    }

    public getCullMode() {
        return convertGfxCullMode(this.megaState.cullMode!);
    }

    public setSrcBlend(src: RwBlendFunction) {
        const attachmentState = this.megaState.attachmentsState![0];

        const gfxSrc = convertRwBlendFunction(src);
        attachmentState.rgbBlendState.blendSrcFactor = gfxSrc;
        attachmentState.alphaBlendState.blendSrcFactor = gfxSrc;
    }

    public getSrcBlend(): RwBlendFunction {
        return convertGfxBlendFactor(this.megaState.attachmentsState![0].rgbBlendState.blendSrcFactor);
    }

    public setDstBlend(dst: RwBlendFunction) {
        const attachmentState = this.megaState.attachmentsState![0];

        const gfxDst = convertRwBlendFunction(dst);
        attachmentState.rgbBlendState.blendDstFactor = gfxDst;
        attachmentState.alphaBlendState.blendDstFactor = gfxDst;
    }

    public getDstBlend(): RwBlendFunction {
        return convertGfxBlendFactor(this.megaState.attachmentsState![0].rgbBlendState.blendDstFactor);
    }

    public setChannelWriteMask(mask: GfxChannelWriteMask) {
        this.megaState.attachmentsState![0].channelWriteMask = mask;
    }

    public getChannelWriteMask() {
        return this.megaState.attachmentsState![0].channelWriteMask;
    }

    public setClearColor(clearColor: Color) {
        colorCopy(this.clearColor, clearColor);
    }

    public getClearColor() {
        return this.clearColor;
    }

    public setModelMatrix(mat: mat4) {
        mat4.copy(this.modelMatrix, mat);
    }

    public getModelMatrix() {
        return this.modelMatrix;
    }

    public enableNormalArray() {
        this.normalArrayEnabled = true;
    }

    public disableNormalArray() {
        this.normalArrayEnabled = false;
    }

    public isNormalArrayEnabled() {
        return this.normalArrayEnabled;
    }

    public enableTexCoordArray() {
        this.texCoordArrayEnabled = true;
    }

    public disableTexCoordArray() {
        this.texCoordArrayEnabled = false;
    }

    public isTexCoordArrayEnabled() {
        return this.texCoordArrayEnabled;
    }

    public enableColorArray() {
        this.colorArrayEnabled = true;
    }

    public disableColorArray() {
        this.colorArrayEnabled = false;
    }

    public isColorArrayEnabled() {
        return this.colorArrayEnabled;
    }

    public setTexture(texture: RwTexture | null) {
        this.texture = texture;
    }

    public getTexture(): RwTexture | null {
        return this.texture;
    }

    public enableFog() {
        this.fogEnabled = true;
    }

    public disableFog() {
        this.fogEnabled = false;
    }

    public isFogEnabled() {
        return this.fogEnabled;
    }

    public setFogStart(fogStart: number) {
        this.fogStart = fogStart;
    }

    public getFogStart() {
        return this.fogStart;
    }

    public setFogEnd(fogEnd: number) {
        this.fogEnd = fogEnd;
    }

    public getFogEnd() {
        return this.fogEnd;
    }

    public setFogColor(fogColor: Color) {
        colorCopy(this.fogColor, fogColor);
    }

    public getFogColor(): Color {
        return this.fogColor;
    }

    public enableLighting() {
        this.lightingEnabled = true;
    }

    public disableLighting() {
        this.lightingEnabled = false;
    }

    public isLightingEnabled() {
        return this.lightingEnabled;
    }

    public setLightAmbientColor(index: number, color: Color) {
        colorCopy(this.lights[index].ambient, color);
    }

    public getLightAmbientColor(index: number): Color {
        return this.lights[index].ambient;
    }

    public setLightDiffuseColor(index: number, color: Color) {
        colorCopy(this.lights[index].diffuse, color);
    }

    public getLightDiffuseColor(index: number) {
        return this.lights[index].diffuse;
    }

    public setLightDirection(index: number, direction: vec3) {
        vec3.copy(this.lights[index].direction, direction);
    }

    public getLightDirection(index: number) {
        return this.lights[index].direction;
    }

    public setMaterialAmbient(ambient: number) {
        this.materialAmbient = ambient;
    }

    public getMaterialAmbient() {
        return this.materialAmbient;
    }

    public setMaterialDiffuse(diffuse: number) {
        this.materialDiffuse = diffuse;
    }

    public getMaterialDiffuse() {
        return this.materialDiffuse;
    }

    public setMaterialColor(color: Color) {
        colorCopy(this.materialColor, color);
    }

    public getMaterialColor() {
        return this.materialColor;
    }

    public enableAlphaTest() {
        this.alphaTestEnabled = true;
    }

    public disableAlphaTest() {
        this.alphaTestEnabled = false;
    }

    public isAlphaTestEnabled() {
        return this.alphaTestEnabled;
    }

    public setAlphaFunc(func: RwAlphaTestFunction) {
        this.alphaFunc = func;
    }

    public getAlphaFunc() {
        return this.alphaFunc;
    }

    // 0 to 1
    public setAlphaRef(ref: number) {
        this.alphaRef = ref;
    }

    // 0 to 1
    public getAlphaRef() {
        return this.alphaRef;
    }

    public loadWorldLights(world: RpWorld) {
        let lightIndex = 0;
        for (const light of world.lights) {
            if (light.flags & RpLightFlag.LIGHTATOMICS) {
                let handled = true;

                if (light.type === RpLightType.DIRECTIONAL) {
                    colorCopy(this.lights[lightIndex].ambient, TransparentBlack);
                    colorCopy(this.lights[lightIndex].diffuse, light.color);

                    getMatrixAxisZ(this.lights[lightIndex].direction, light.frame.matrix);
                    vec3.normalize(this.lights[lightIndex].direction, this.lights[lightIndex].direction);
                } else if (light.type === RpLightType.AMBIENT) {
                    colorCopy(this.lights[lightIndex].ambient, light.color);
                    colorCopy(this.lights[lightIndex].diffuse, TransparentBlack);
                } else {
                    handled = false;
                }

                if (handled) {
                    lightIndex++;
                    if (lightIndex === RwGfx.MAX_LIGHTS) {
                        break;
                    }
                }
            }
        }
        for (let i = lightIndex; i < RwGfx.MAX_LIGHTS; i++) {
            colorCopy(this.lights[i].ambient, TransparentBlack);
            colorCopy(this.lights[i].diffuse, TransparentBlack);
        }
    }

    public clearLights() {
        for (let i = 0; i < RwGfx.MAX_LIGHTS; i++) {
            colorCopy(this.lights[i].ambient, TransparentBlack);
            colorCopy(this.lights[i].diffuse, TransparentBlack);
            vec3.zero(this.lights[i].direction);
        }
    }

    public drawElements(vertexBuffer: RwGfxVertexBuffer, indexBuffer: RwGfxIndexBuffer) {
        const renderInst = this.renderHelper.renderInstManager.newRenderInst();

        renderInst.setUniformBuffer(this.renderHelper.uniformBuffer);
        renderInst.setVertexInput(this.inputLayout, vertexBuffer.descriptors, indexBuffer.descriptor);
        renderInst.setDrawCount(indexBuffer.indexCount);
        renderInst.setMegaStateFlags(this.megaState);

        const programInfo = this.getProgramInfo();
        renderInst.setGfxProgram(programInfo.gfxProgram);
        renderInst.setBindingLayouts(RwGfxProgram.bindingLayouts);

        this.fillUniformBuffer(renderInst, programInfo.program.ub_SceneParamsSIZE);

        this.bindTexture(renderInst);

        this.renderInstList.submitRenderInst(renderInst);
    }

    private getProgramInfo(): RwGfxProgramInfo {
        var stateMask = 0;
        if (this.normalArrayEnabled) stateMask |= 0x1;
        if (this.texCoordArrayEnabled) stateMask |= 0x2;
        if (this.colorArrayEnabled) stateMask |= 0x4;
        if (this.texture) stateMask |= 0x8;
        if (this.fogEnabled) stateMask |= 0x10;
        if (this.lightingEnabled) stateMask |= 0x20;
        if (this.alphaTestEnabled) stateMask |= 0x40;
        stateMask |= (this.alphaFunc << 7);

        if (this.programs.has(stateMask)) {
            return this.programs.get(stateMask)!;
        }

        if (IS_DEVELOPMENT) {
            console.log(`Compiling shader ${stateMask}`);
        }

        const program = new RwGfxProgram({
            useNormalArray: this.normalArrayEnabled,
            useColorArray: this.colorArrayEnabled,
            useTextureCoordArray: this.texCoordArrayEnabled,
            useTexture: (this.texture != null),
            useFog: this.fogEnabled,
            useLighting: this.lightingEnabled,
            useAlphaTest: this.alphaTestEnabled,
            alphaTestFunction: this.alphaFunc,
        });
        
        const gfxProgram = this.renderHelper.renderCache.createProgram(program);

        const programInfo: RwGfxProgramInfo = { program, gfxProgram };

        this.programs.set(stateMask, programInfo);

        return programInfo;
    }

    private fillUniformBuffer(renderInst: GfxRenderInst, size: number) {
        let offs = renderInst.allocateUniformBuffer(RwGfxProgram.ub_SceneParams, size);
        const mapped = renderInst.mapUniformBufferF32(RwGfxProgram.ub_SceneParams);

        // u_Projection
        offs += fillMatrix4x4(mapped, offs, this.projectionMatrix);

        // u_ViewMatrix
        offs += fillMatrix4x4(mapped, offs, this.viewMatrix);

        // u_ModelMatrix
        offs += fillMatrix4x4(mapped, offs, this.modelMatrix);

        if (this.lightingEnabled) {
            // u_Lights
            for (let i = 0; i < RwGfx.MAX_LIGHTS; i++) {
                offs += fillColor(mapped, offs, this.lights[i].ambient);
                offs += fillColor(mapped, offs, this.lights[i].diffuse);
                offs += fillVec3v(mapped, offs, this.lights[i].direction);
            }
        }

        if (this.fogEnabled) {
            // u_FogColor
            offs += fillColor(mapped, offs, this.fogColor);
        }

        // u_MaterialColor
        offs += fillColor(mapped, offs, this.materialColor);

        // u_Misc1
        offs += fillVec4(mapped, offs, this.materialAmbient, this.materialDiffuse, this.fogStart, this.fogEnd);

        // u_Misc2
        offs += fillVec4(mapped, offs, this.alphaRef);
    }

    private bindTexture(renderInst: GfxRenderInst) {
        if (this.texture && this.texture.raster && this.texture.raster.gfxRaster.gfxTexture) {
            const mapping = this.textureMapping[0];
            mapping.width = this.texture.raster.width;
            mapping.height = this.texture.raster.height;
            mapping.flipY = false;
            mapping.gfxTexture = this.texture.raster.gfxRaster.gfxTexture;

            const texFilter = convertRwTextureFilterMode(this.texture.filter);
            const mipFilter = convertRwTextureFilterModeMip(this.texture.filter);
            const wrapS = convertRwTextureAddressMode(this.texture.addressingU);
            const wrapT = convertRwTextureAddressMode(this.texture.addressingV);

            mapping.gfxSampler = this.renderHelper.renderCache.createSampler({
                magFilter: texFilter,
                minFilter: texFilter,
                mipFilter: mipFilter,
                wrapS: wrapS,
                wrapT: wrapT,
            });

            renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        }
    }
}