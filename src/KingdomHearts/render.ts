
import * as Bin from './bin.js';
import * as BinTex from './bin_tex.js';
import * as UI from '../ui.js';
import * as Viewer from '../viewer.js';
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { DeviceProgram } from "../Program.js";
import { fillMatrix4x3, fillMatrix4x4, fillVec4 } from '../gfx/helpers/UniformBufferHelpers.js';
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferUsage, GfxCompareMode, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxMipFilterMode, GfxRenderPass, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxWrapMode, GfxProgram, GfxMegaStateDescriptor, GfxInputLayoutBufferDescriptor, makeTextureDescriptor2D, GfxVertexBufferDescriptor, GfxIndexBufferDescriptor } from '../gfx/platform/GfxPlatform.js';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers.js';
import { mat4, vec2, vec4 } from 'gl-matrix';
import { TextureHolder, TextureMapping } from '../TextureHolder.js';
import { nArray, assertExists } from '../util.js';
import { GfxRenderInstList, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager.js';
import { reverseDepthForCompareMode } from '../gfx/helpers/ReversedDepthHelpers.js';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { convertToCanvas } from '../gfx/helpers/TextureConversionHelpers.js';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxShaderLibrary } from '../gfx/helpers/GfxShaderLibrary.js';

export function textureToCanvas(texture: BinTex.Texture): Viewer.Texture {
    const canvas = convertToCanvas(ArrayBufferSlice.fromView(texture.pixels()), texture.width(), texture.height());
    const name = texture.name();
    canvas.title = name;

    const surfaces = [canvas];
    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', texture.parent.format);
    return { name: name, surfaces, extraInfo };
}

class KingdomHeartsProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;
    public static a_TexClip = 3;
    public static a_TexRepeat = 4;
    public static a_TexScaleOffs = 5;
    public static a_TexScroll = 6;

    public static ub_SceneParams = 0;
    public static ub_DrawParams = 1;

    public override both = `
precision mediump float;

${GfxShaderLibrary.MatrixLibrary}

// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    float u_Time;
};

layout(std140) uniform ub_DrawParams {
    Mat3x4 u_Model;
    vec4 u_AnimOffset;
};

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_TexCoord;
varying vec4 v_TexClip;
varying vec2 v_TexRepeat;
varying vec4 v_TexScaleOffset;
varying vec2 v_TexScroll;

#ifdef VERT
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec2 a_TexCoord;
layout(location = 3) in vec4 a_TexClip;
layout(location = 4) in vec2 a_TexRepeat;
layout(location = 5) in vec4 a_TexScaleOffset;
layout(location = 6) in vec2 a_TexScroll;

void main() {
    vec3 t_PositionWorld = UnpackMatrix(u_Model) * vec4(a_Position, 1.0);
    gl_Position = UnpackMatrix(u_ProjectionView) * vec4(t_PositionWorld, 1.0);
    v_Color = a_Color;
    v_TexCoord = a_TexCoord;
    v_TexClip = a_TexClip;
    v_TexRepeat = a_TexRepeat;
    v_TexScaleOffset = a_TexScaleOffset;
    v_TexScroll = a_TexScroll;
}
#endif

#ifdef FRAG
void main() {
    vec4 t_Color = vec4(0.5, 0.5, 0.5, 1);

#ifdef USE_TEXTURE
    vec2 tc = v_TexCoord;
    tc += v_TexScroll * u_Time * 0.000005f + u_AnimOffset.xy;
    tc = fract(tc * v_TexRepeat) / v_TexRepeat;
    tc = clamp(tc, v_TexClip.xz + u_AnimOffset.xy, v_TexClip.yw + u_AnimOffset.xy);
    tc = tc * v_TexScaleOffset.xy + v_TexScaleOffset.zw;
    t_Color = texture(SAMPLER_2D(u_Texture), tc);
#endif

#ifdef USE_VERTEX_COLOR
    t_Color.rgb *= v_Color.rgb * 2.0f;
    t_Color.a *= v_Color.a;
#endif

#ifdef USE_ALPHA_MASK
    if (t_Color.a < 0.125) {
        discard;
    }
#endif

    gl_FragColor = t_Color;
}
#endif
`;
}

class Layer implements UI.Layer {
    public name: string;
    public visible: boolean = true;

    constructor(public layerIndex: number) {
    }

    public setVisible(v: boolean) {
        this.visible = v;
    }
}

class DrawCall {
    public firstIndex: number = 0;
    public indexCount: number = 0;
    public textureIndex: number = 0;

    public translucent: boolean = false;
    public cullBackfaces: boolean = true;
    public rotYFactor: number = 0;  // Rotation used for SKY1.
    public layer: Layer | null = null;
    public spriteAnim: BinTex.TextureSpriteAnim | null = null;
}

interface RenderBatchKey {
    layerIndex: number;
    textureIndex: number;
    spriteAnimIndex: number;
};

export class MapData {
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    public indexBufferDescriptor: GfxIndexBufferDescriptor;

    public textures: GfxTexture[] = [];
    public sampler: GfxSampler;

    public layers: Layer[] = [];
    public mapDrawCalls: DrawCall[] = [];
    public skyboxDrawCalls: DrawCall[] = [];

    private vertices = 0;
    private indices = 0;

    constructor(device: GfxDevice, cache: GfxRenderCache, bin: Bin.BIN) {
        this.textures.push(this.translateTextureFromAtlas(device, bin.mapTextureAtlas));
        const skyboxTexIndexMap : Map<number, number> = new Map();
        for (let i = 0; i < bin.sky0TextureBlocks.length; i++) {
            this.textures.push(this.translateTexture(device, bin.sky0TextureBlocks[i].textures[0]));
            skyboxTexIndexMap.set(bin.sky0TextureBlocks[i].dataOffs, i + 1);
        }
        for (let i = 0; i < bin.sky1TextureBlocks.length; i++) {
            this.textures.push(this.translateTexture(device, bin.sky1TextureBlocks[i].textures[0]));
            skyboxTexIndexMap.set(bin.sky1TextureBlocks[i].dataOffs, bin.sky0TextureBlocks.length + i + 1);
        }
        this.sampler = this.createSampler(cache);

        const submeshes: Bin.Submesh[] = [];
        const mapLayers: Layer[] = [];
        this.mapDrawCalls = this.createBatchedDrawCalls(/*isSkybox=*/false, bin.mapMeshes, skyboxTexIndexMap, submeshes, mapLayers);
        mapLayers.sort((a: Layer, b: Layer) => {
            return a.layerIndex < b.layerIndex ? -1 : 1;
        })
        mapLayers.forEach((layer: Layer) => {
            layer.name = `map_${layer.layerIndex}`
        });

        const sky0Layers: Layer[] = [];
        const sky0DrawCalls = this.createBatchedDrawCalls(/*isSkybox=*/true, bin.sky0Meshes, skyboxTexIndexMap, submeshes, sky0Layers);
        sky0Layers[0].name = "sky_0";

        const sky1Layers: Layer[] = [];
        const sky1DrawCalls = this.createBatchedDrawCalls(/*isSkybox=*/true, bin.sky1Meshes, skyboxTexIndexMap, submeshes, sky1Layers);
        sky1Layers[0].name = "sky_1";

        this.layers.push(sky0Layers[0]);
        this.layers.push(sky1Layers[0]);
        for (let i = 0; i < mapLayers.length; i++) {
            this.layers.push(mapLayers[i]);
        }
        for (let i = 0; i < sky0DrawCalls.length; i++) {
            sky0DrawCalls[i].cullBackfaces = false;
            sky0DrawCalls[i].translucent = true;
            this.skyboxDrawCalls.push(sky0DrawCalls[i]);
        }
        for (let i = 0; i < sky1DrawCalls.length; i++) {
            sky1DrawCalls[i].rotYFactor = bin.uvAnimInfo.sky1RotYFactor;
            sky1DrawCalls[i].translucent = true;
            this.skyboxDrawCalls.push(sky1DrawCalls[i]);
        }

        const vBuf = new Float32Array(this.vertices * 21);
        const iBuf = new Uint32Array(this.indices);

        let vBufIndex = 0;
        let iBufIndex = 0;
        let n = 0;
        submeshes.forEach(function (submesh) {
            if (submesh.textureBlock === null) {
                return;
            }
            for (let i = 0; i < submesh.vtx.length; i++) {
                const texScaleOffs = vec4.fromValues(1, 1, 0, 0);
                const atlasPos = bin.mapTextureAtlas.getTextureBlockPos(submesh.textureBlock);
                if (atlasPos) {
                    vec4.set(texScaleOffs,
                        submesh.textureBlock.width / bin.mapTextureAtlas.width,
                        submesh.textureBlock.height / bin.mapTextureAtlas.height,
                        atlasPos[0] * 256 / bin.mapTextureAtlas.width,
                        atlasPos[1] * 256 / bin.mapTextureAtlas.height,
                    );
                }
                const texture = submesh.textureBlock.textures[submesh.textureIndex];
                let clipRight = texture.clipRight;
                let clipBottom = texture.clipBottom;
                const spriteAnim = submesh.textureBlock.textures[submesh.textureIndex].spriteAnim;
                if (spriteAnim) {
                    clipRight = texture.clipLeft + spriteAnim.spriteWidth - 1;
                    clipBottom = texture.clipTop + spriteAnim.spriteHeight - 1;
                }
                const texClip = vec4.fromValues(
                    (texture.clipLeft + 0.5) / submesh.textureBlock.width,
                    (clipRight + 0.5) / submesh.textureBlock.width,
                    (texture.clipTop + 0.5) / submesh.textureBlock.height,
                    (clipBottom + 0.5) / submesh.textureBlock.height,
                );
                const texRepeat = vec2.fromValues(
                    texture.tiledU ? submesh.textureBlock.width / (texture.width()) : 0.5,
                    texture.tiledV ? submesh.textureBlock.height / (texture.height()) : 0.5
                );
                vBuf[vBufIndex++] = submesh.vtx[i][0];
                vBuf[vBufIndex++] = submesh.vtx[i][1];
                vBuf[vBufIndex++] = submesh.vtx[i][2];
                vBuf[vBufIndex++] = submesh.vcol[i][0];
                vBuf[vBufIndex++] = submesh.vcol[i][1];
                vBuf[vBufIndex++] = submesh.vcol[i][2];
                vBuf[vBufIndex++] = submesh.vcol[i][3];
                vBuf[vBufIndex++] = submesh.uv[i][0];
                vBuf[vBufIndex++] = submesh.uv[i][1];
                vBuf[vBufIndex++] = texClip[0];
                vBuf[vBufIndex++] = texClip[1];
                vBuf[vBufIndex++] = texClip[2];
                vBuf[vBufIndex++] = texClip[3];
                vBuf[vBufIndex++] = texRepeat[0];
                vBuf[vBufIndex++] = texRepeat[1];
                vBuf[vBufIndex++] = texScaleOffs[0];
                vBuf[vBufIndex++] = texScaleOffs[1];
                vBuf[vBufIndex++] = texScaleOffs[2];
                vBuf[vBufIndex++] = texScaleOffs[3];
                vBuf[vBufIndex++] = bin.uvAnimInfo.uvScrollTable[submesh.uvScrollIndex[i][0] * 2];
                vBuf[vBufIndex++] = bin.uvAnimInfo.uvScrollTable[submesh.uvScrollIndex[i][1] * 2 + 1];
            }
            for (let i = 0; i < submesh.ind.length; i++) {
                iBuf[iBufIndex++] = submesh.ind[i] + n;
            }
            n += submesh.vtx.length;
        });

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, vBuf.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, iBuf.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: KingdomHeartsProgram.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0*0x04, },
            { location: KingdomHeartsProgram.a_Color, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 3*0x04, },
            { location: KingdomHeartsProgram.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 7*0x04, },
            { location: KingdomHeartsProgram.a_TexClip, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 9*0x04, },
            { location: KingdomHeartsProgram.a_TexRepeat, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 13*0x04, },
            { location: KingdomHeartsProgram.a_TexScaleOffs, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 15*0x04, },
            { location: KingdomHeartsProgram.a_TexScroll, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 19*0x04, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 21*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];

        this.inputLayout = cache.createInputLayout({
            indexBufferFormat: GfxFormat.U32_R,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });

        this.vertexBufferDescriptors = [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ];
        this.indexBufferDescriptor = { buffer: this.indexBuffer, byteOffset: 0 };
    }

    private createBatchedDrawCalls(isSkybox: boolean, meshes: Bin.Mesh[], skyboxTexIndexMap: Map<number, number>, submeshesOut: Bin.Submesh[], layersOut: Layer[]): DrawCall[] {
        // Layer index -> Layer object
        const layerMap: Map<number, Layer> = new Map();
        const spriteAnims: BinTex.TextureSpriteAnim[] = [];
        // Batch key -> Submesh[]
        const opaqueSubmeshMap: Map<string, Bin.Submesh[]> = new Map();
        // [Batch key, Submesh[]]
        const translucentSubmeshes: Array<[string, Bin.Submesh[]]> = [];
        let lastIndex = -1;
        for (let i = 0; i < meshes.length; i++) {
            const layerIndex = meshes[i].layer;
            if (!layerMap.has(layerIndex)) {
                layerMap.set(layerIndex, new Layer(layerIndex));
            }
            for (let j = 0; j < meshes[i].submeshes.length; j++) {
                const submesh = meshes[i].submeshes[j];
                if (submesh.textureBlock === null) {
                    continue;
                }
                let spriteAnimIndex = -1;
                const texture = submesh.textureBlock.textures[submesh.textureIndex];
                if (texture.spriteAnim) {
                    spriteAnimIndex = spriteAnims.indexOf(texture.spriteAnim);
                    if (spriteAnimIndex < 0) {
                        spriteAnims.push(texture.spriteAnim);
                        spriteAnimIndex = spriteAnims.length - 1;
                    }
                }
                if (texture.spriteAnim && !spriteAnims.includes(texture.spriteAnim)) {

                }
                let textureIndex = 0;
                if (submesh.textureBlock.bank < 0 && skyboxTexIndexMap.has(submesh.textureBlock.dataOffs)) {
                    textureIndex = skyboxTexIndexMap.get(submesh.textureBlock.dataOffs)!;
                }
                const batchKey: RenderBatchKey = {layerIndex, textureIndex, spriteAnimIndex};
                const batchKeyStr = JSON.stringify(batchKey);
                if (!meshes[i].translucent) {
                    if (!opaqueSubmeshMap.has(batchKeyStr)) {
                        opaqueSubmeshMap.set(batchKeyStr, []);
                    }
                    opaqueSubmeshMap.get(batchKeyStr)!.push(submesh);
                } else if (lastIndex >= 0 && translucentSubmeshes[lastIndex][0] === batchKeyStr) {
                    translucentSubmeshes[lastIndex][1].push(submesh);
                } else {
                    translucentSubmeshes.push([batchKeyStr, [submesh]]);
                    lastIndex++;
                }
            }
        }
        layerMap.forEach((layer: Layer) => {
            layersOut.push(layer);
        });

        const drawCalls: DrawCall[] = [];
        opaqueSubmeshMap.forEach((value: Bin.Submesh[], key: string) => {
            const batchKey: RenderBatchKey = JSON.parse(key);
            const drawCall = this.createDrawCall(batchKey, /*translucent=*/false, layerMap, spriteAnims);
            drawCall.firstIndex = this.indices;
            value.forEach((submesh: Bin.Submesh) => {
                submeshesOut.push(submesh);
                this.vertices += submesh.vtx.length;
                this.indices += submesh.ind.length;
            });
            drawCall.indexCount = this.indices - drawCall.firstIndex;
            drawCalls.push(drawCall);
        });
        translucentSubmeshes.forEach((value: [string, Bin.Submesh[]]) => {
            const batchKey: RenderBatchKey = JSON.parse(value[0]);
            const drawCall = this.createDrawCall(batchKey, /*translucent=*/true, layerMap, spriteAnims);
            drawCall.firstIndex = this.indices;
            value[1].forEach((submesh: Bin.Submesh) => {
                submeshesOut.push(submesh);
                this.vertices += submesh.vtx.length;
                this.indices += submesh.ind.length;
            });
            drawCall.indexCount = this.indices - drawCall.firstIndex;
            drawCalls.push(drawCall);
        });
        return drawCalls;
    }

    private createDrawCall(batchKey: RenderBatchKey, translucent: boolean, layerMap: Map<number, Layer>, spriteAnims: BinTex.TextureSpriteAnim[]): DrawCall {
        const drawCall = new DrawCall;
        if (layerMap.has(batchKey.layerIndex)) {
            drawCall.layer = layerMap.get(batchKey.layerIndex)!;
        }
        if (batchKey.spriteAnimIndex >= 0) {
            drawCall.spriteAnim = spriteAnims[batchKey.spriteAnimIndex];
        }
        drawCall.textureIndex = batchKey.textureIndex;
        drawCall.translucent = translucent;
        return drawCall;
    }

    private translateTexture(device: GfxDevice, texture: BinTex.Texture) {
        const width = texture.clipRight - texture.clipLeft + 1;
        const height = texture.clipBottom - texture.clipTop + 1;
        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        device.setResourceName(gfxTexture, texture.name());

        device.uploadTextureData(gfxTexture, 0, [texture.pixels()]);
        return gfxTexture;
    }

    private translateTextureFromAtlas(device: GfxDevice, textureAtlas: BinTex.TextureAtlas) {
        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, textureAtlas.width, textureAtlas.height, 1));
        // device.setResourceName(gfxTexture, texture.name());

        device.uploadTextureData(gfxTexture, 0, [assertExists(textureAtlas.pixels)]);
        return gfxTexture;
    }

    private createSampler(cache: GfxRenderCache) {
        return cache.createSampler({
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            minLOD: 0, maxLOD: 0,
        });
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.textures.length; i++) {
            device.destroyTexture(this.textures[i]);
        }
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
    }
}

const modelMatrixScratch = mat4.create();
const uvAnimOffsetScratch = vec2.create();
class DrawCallInstance {
    private vertexColorsEnabled = true;
    private texturesEnabled = true;
    private textureMappings = nArray(1, () => new TextureMapping());
    private program!: DeviceProgram;
    private gfxProgram: GfxProgram | null = null;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    constructor(private mapData: MapData, private drawCall: DrawCall, private drawCallIndex: number) {
        this.createProgram();

        this.megaStateFlags = {};
        if (!drawCall.cullBackfaces) {
            this.megaStateFlags.cullMode = GfxCullMode.None;
        }

        if (drawCall.translucent) {
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            });
            this.megaStateFlags.depthWrite = false;
        }

        const textureMapping = this.textureMappings[0];
        textureMapping.gfxTexture = mapData.textures[drawCall.textureIndex];
        textureMapping.gfxSampler = mapData.sampler;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, isSkybox: boolean, modelMatrix: mat4, viewerInput: Viewer.ViewerRenderInput) {
        if (!this.drawCall.layer!.visible)
            return;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setVertexInput(this.mapData.inputLayout, this.mapData.vertexBufferDescriptors, this.mapData.indexBufferDescriptor);
        renderInst.sortKey = this.drawCallIndex;

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.program);

        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setDrawCount(this.drawCall.indexCount, this.drawCall.firstIndex);

        mat4.copy(modelMatrixScratch, modelMatrix);
        if (isSkybox) {
            modelMatrixScratch[12] = viewerInput.camera.worldMatrix[12];
            modelMatrixScratch[13] = viewerInput.camera.worldMatrix[13];
            modelMatrixScratch[14] = viewerInput.camera.worldMatrix[14];
            mat4.rotateY(modelMatrixScratch, modelMatrixScratch, this.drawCall.rotYFactor * viewerInput.time / (Math.PI * 6));
        }

        let offs = renderInst.allocateUniformBuffer(KingdomHeartsProgram.ub_DrawParams, 16);
        const mapped = renderInst.mapUniformBufferF32(KingdomHeartsProgram.ub_DrawParams);
        offs += fillMatrix4x3(mapped, offs, modelMatrixScratch);

        if (this.drawCall.spriteAnim) {
            this.drawCall.spriteAnim.getUVOffset(viewerInput.time, uvAnimOffsetScratch);
        } else {
            vec2.zero(uvAnimOffsetScratch);
        }
        offs += fillVec4(mapped, offs, uvAnimOffsetScratch[0], uvAnimOffsetScratch[1], 0, 0);

        renderInstManager.submitRenderInst(renderInst);
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.vertexColorsEnabled = v;
        this.createProgram();
    }

    public setTexturesEnabled(v: boolean): void {
        this.texturesEnabled = v;
        this.createProgram();
    }

    private createProgram(): void {
        const program = new KingdomHeartsProgram();
        if (this.vertexColorsEnabled) {
            program.defines.set('USE_VERTEX_COLOR', '1');
        }
        if (this.texturesEnabled) {
            program.defines.set('USE_TEXTURE', '1');
        }
        if (!this.drawCall.translucent) {
            program.defines.set(`USE_ALPHA_MASK`, '1');
        }

        this.gfxProgram = null;
        this.program = program;
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 1 },
];

export class SceneRenderer {
    private worldTransform: mat4;
    private drawCallInstances: DrawCallInstance[] = [];
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    constructor(device: GfxDevice, mapData: MapData, drawCalls: DrawCall[], private isSkybox: boolean) {
        this.megaStateFlags = {
            cullMode: GfxCullMode.Back,
            depthWrite: true,
            depthCompare: reverseDepthForCompareMode(GfxCompareMode.LessEqual),
        };

        for (let i = 0; i < drawCalls.length; i++)
            this.drawCallInstances.push(new DrawCallInstance(mapData, drawCalls[i], i));

        this.worldTransform = mat4.create();
        mat4.rotateZ(this.worldTransform, this.worldTransform, Math.PI);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplate();
        template.setBindingLayouts(bindingLayouts);
        template.setMegaStateFlags(this.megaStateFlags);

        viewerInput.camera.setClipPlanes(20, 5000000);

        let offs = template.allocateUniformBuffer(KingdomHeartsProgram.ub_SceneParams, 20);
        const sceneParamsMapped = template.mapUniformBufferF32(KingdomHeartsProgram.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.clipFromWorldMatrix);
        sceneParamsMapped[offs] = viewerInput.time;

        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].prepareToRender(device, renderInstManager, this.isSkybox, this.worldTransform, viewerInput);

        renderInstManager.popTemplate();
    }

    public setVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setTexturesEnabled(v);
    }
}

export class KingdomHeartsRenderer implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;
    private renderInstListSky = new GfxRenderInstList();
    private renderInstListMain = new GfxRenderInstList();
    private skyRenderer: SceneRenderer;
    private mapRenderer: SceneRenderer;

    private mapData: MapData;

    constructor(device: GfxDevice, public textureHolder: TextureHolder<any>, bin: Bin.BIN) {
        this.renderHelper = new GfxRenderHelper(device);

        this.mapData = new MapData(device, this.renderHelper.renderCache, bin);

        this.mapRenderer = new SceneRenderer(device, this.mapData, this.mapData.mapDrawCalls, /*isSkybox=*/false);
        this.skyRenderer = new SceneRenderer(device, this.mapData, this.mapData.skyboxDrawCalls, /*isSkybox=*/true);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            this.mapRenderer.setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
            this.skyRenderer.setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            this.mapRenderer.setTexturesEnabled(enableTextures.checked);
            this.skyRenderer.setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        const layersPanel = new UI.LayerPanel(this.mapData.layers);

        return [renderHacksPanel, layersPanel];
    }

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;
        renderInstManager.setCurrentList(this.renderInstListMain);
        this.mapRenderer.prepareToRender(device, renderInstManager, viewerInput);
        renderInstManager.setCurrentList(this.renderInstListSky);
        this.skyRenderer.prepareToRender(device, renderInstManager, viewerInput);
        renderInstManager.popTemplate();

        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListSky.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
        this.renderInstListSky.reset();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.textureHolder.destroy(device);
        this.mapData.destroy(device);
    }
}
