import * as Bin from './bin';
import * as BinTex from './bin_tex';
import * as UI from '../ui';
import * as Viewer from '../viewer';

// @ts-ignore
import { readFileSync } from 'fs';
import { BasicRenderTarget, depthClearRenderPassDescriptor, transparentBlackFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { DeviceProgram, DeviceProgramReflection, ProgramCache } from "../Program";
import { fillMatrix4x3, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCompareMode, GfxCullMode, GfxDevice, GfxFormat, GfxHostAccessPass, GfxInputLayout, GfxInputState, GfxMipFilterMode, GfxRenderPass, GfxSampler, GfxTexFilterMode, GfxTexture, GfxTextureDimension, GfxVertexAttributeDescriptor, GfxVertexAttributeFrequency, GfxWrapMode } from '../gfx/platform/GfxPlatform';
import { GfxRenderInst, GfxRenderInstBuilder, GfxRenderInstViewRenderer } from '../gfx/render/GfxRenderer';
import { GfxRenderBuffer } from '../gfx/render/GfxRenderBuffer';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { mat4, vec2, vec4 } from 'gl-matrix';
import { RENDER_HACKS_ICON } from '../bk/scenes';
import { TextureHolder, TextureMapping } from '../TextureHolder';

export function textureToCanvas(texture: BinTex.Texture): Viewer.Texture {
    const canvas = document.createElement("canvas");
    const width = texture.width();
    const height = texture.height();
    const name = texture.name();
    canvas.width = width;
    canvas.height = height;
    canvas.title = name;

    const context = canvas.getContext("2d");
    const imgData = context.createImageData(canvas.width, canvas.height);
    imgData.data.set(texture.pixels());
    context.putImageData(imgData, 0, 0);
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

    private static program = readFileSync('src/kh/program.glsl', { encoding: 'utf8' });
    public static programReflection: DeviceProgramReflection = DeviceProgram.parseReflectionDefinitions(KingdomHeartsProgram.program);
    public both = KingdomHeartsProgram.program;
}

const enum RenderPass {
    MAIN = 0x01,
    SKYBOX = 0x02,
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
    public layer: Layer = null;
    public spriteAnim: BinTex.TextureSpriteAnim = null;
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
    public inputState: GfxInputState;

    public textures: GfxTexture[] = [];
    public sampler: GfxSampler;

    public layers: Layer[] = [];
    public mapDrawCalls: DrawCall[] = [];
    public skyboxDrawCalls: DrawCall[] = [];

    private vertices = 0;
    private indices = 0;

    constructor(device: GfxDevice, bin: Bin.BIN) {
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
        this.sampler = this.createSampler(device);

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
            if (submesh.textureBlock == null) {
                return;
            }
            for (let i = 0; i < submesh.vtx.length; i++) {
                const texScaleOffs = vec4.create();
                texScaleOffs.set([1, 1, 0, 0]);
                const atlasPos = bin.mapTextureAtlas.getTextureBlockPos(submesh.textureBlock);
                if (atlasPos) {
                    texScaleOffs.set([
                        submesh.textureBlock.width / bin.mapTextureAtlas.width,
                        submesh.textureBlock.height / bin.mapTextureAtlas.height,
                        atlasPos[0] * 256 / bin.mapTextureAtlas.width,
                        atlasPos[1] * 256 / bin.mapTextureAtlas.height,
                    ]);
                }
                const texture = submesh.textureBlock.textures[submesh.textureIndex];
                const texClip = vec4.create();
                let clipRight = texture.clipRight;
                let clipBottom = texture.clipBottom;
                const spriteAnim = submesh.textureBlock.textures[submesh.textureIndex].spriteAnim;
                if (spriteAnim) {
                    clipRight = texture.clipLeft + spriteAnim.spriteWidth - 1;
                    clipBottom = texture.clipTop + spriteAnim.spriteHeight - 1;
                }
                texClip.set([
                    (texture.clipLeft + 0.5) / submesh.textureBlock.width,
                    (clipRight + 0.5) / submesh.textureBlock.width,
                    (texture.clipTop + 0.5) / submesh.textureBlock.height,
                    (clipBottom + 0.5) / submesh.textureBlock.height,
                ]);
                const texRepeat = vec2.create();
                texRepeat.set([
                    texture.tiledU ? submesh.textureBlock.width / (texture.width()) : 0.5,
                    texture.tiledV ? submesh.textureBlock.height / (texture.height()) : 0.5
                ]);
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

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vBuf.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, iBuf.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: KingdomHeartsProgram.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0*0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
            { location: KingdomHeartsProgram.a_Color, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 3*0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
            { location: KingdomHeartsProgram.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 7*0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
            { location: KingdomHeartsProgram.a_TexClip, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 9*0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
            { location: KingdomHeartsProgram.a_TexRepeat, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 13*0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
            { location: KingdomHeartsProgram.a_TexScaleOffs, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 15*0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
            { location: KingdomHeartsProgram.a_TexScroll, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 19*0x04, frequency: GfxVertexAttributeFrequency.PER_VERTEX, },
        ];

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U32_R,
            vertexAttributeDescriptors,
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, byteStride: 21*0x04, },
        ], { buffer: this.indexBuffer, byteOffset: 0, byteStride: 0x0 });
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
                if (submesh.textureBlock == null) {
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
                    textureIndex = skyboxTexIndexMap.get(submesh.textureBlock.dataOffs)
                }
                const batchKey: RenderBatchKey = {layerIndex, textureIndex, spriteAnimIndex};
                const batchKeyStr = JSON.stringify(batchKey);
                if (!meshes[i].translucent) {
                    if (!opaqueSubmeshMap.has(batchKeyStr)) {
                        opaqueSubmeshMap.set(batchKeyStr, []);
                    }
                    opaqueSubmeshMap.get(batchKeyStr).push(submesh);
                } else if (lastIndex >= 0 && translucentSubmeshes[lastIndex][0] == batchKeyStr) {
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
            drawCall.layer = layerMap.get(batchKey.layerIndex);
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
        const gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2D, pixelFormat: GfxFormat.U8_RGBA,
            width: width, height: height, depth: 1, numLevels: 1,
        });
        device.setResourceName(gfxTexture, texture.name());
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [texture.pixels()]);
        device.submitPass(hostAccessPass);
        return gfxTexture;
    }

    private translateTextureFromAtlas(device: GfxDevice, textureAtlas: BinTex.TextureAtlas) {
        const gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2D, pixelFormat: GfxFormat.U8_RGBA,
            width: textureAtlas.width, height: textureAtlas.height, depth: 1, numLevels: 1,
        });
        // device.setResourceName(gfxTexture, texture.name());
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [textureAtlas.pixels]);
        device.submitPass(hostAccessPass);
        return gfxTexture;
    }

    private createSampler(device: GfxDevice) {
        return device.createSampler({
            wrapS: GfxWrapMode.REPEAT,
            wrapT: GfxWrapMode.REPEAT,
            minFilter: GfxTexFilterMode.POINT,
            magFilter: GfxTexFilterMode.POINT,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0, maxLOD: 0,
        });
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.textures.length; i++) {
            device.destroyTexture(this.textures[i]);
        }
        device.destroySampler(this.sampler);
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

const modelMatrixScratch = mat4.create();
const uvAnimOffsetScratch = vec2.create();
const textureMapping = new TextureMapping();
class DrawCallInstance{
    private renderInst: GfxRenderInst;
    private vertexColorsEnabled = true;
    private texturesEnabled = true;
    
    constructor(device: GfxDevice, renderInstBuilder: GfxRenderInstBuilder, private mapData: MapData, private drawCall: DrawCall, private drawCallIndex: number) {
        this.renderInst = renderInstBuilder.pushRenderInst();
        renderInstBuilder.newUniformBufferInstance(this.renderInst, KingdomHeartsProgram.ub_DrawParams);
        this.renderInst.inputState = this.mapData.inputState;
        this.renderInst.sortKey = drawCallIndex;
        this.createProgram();

        if (!drawCall.cullBackfaces) {
            this.renderInst.setMegaStateFlags({
                cullMode: GfxCullMode.NONE
            });
        }
        if (drawCall.translucent) {
            this.renderInst.setMegaStateFlags({
                blendMode: GfxBlendMode.ADD,
                depthWrite: false,
            });
        }

        textureMapping.reset();
        textureMapping.gfxTexture = mapData.textures[drawCall.textureIndex];
        textureMapping.gfxSampler = mapData.sampler;
        this.renderInst.setSamplerBindingsFromTextureMappings([textureMapping]);

        this.renderInst.drawIndexes(this.drawCall.indexCount, this.drawCall.firstIndex);
    }

    public prepareToRender(isSkybox: boolean, meshParamsBuffer: GfxRenderBuffer, modelMatrix: mat4, viewerInput: Viewer.ViewerRenderInput) {
        this.renderInst.visible = this.drawCall.layer.visible;
        if (!this.renderInst.visible) {
            return;
        }

        mat4.copy(modelMatrixScratch, modelMatrix);
        if (isSkybox) {
            modelMatrixScratch[12] = viewerInput.camera.worldMatrix[12];
            modelMatrixScratch[13] = viewerInput.camera.worldMatrix[13];
            modelMatrixScratch[14] = viewerInput.camera.worldMatrix[14];
            mat4.rotateY(modelMatrixScratch, modelMatrixScratch, this.drawCall.rotYFactor * viewerInput.time / (Math.PI * 6));
        }

        let offs = this.renderInst.getUniformBufferOffset(KingdomHeartsProgram.ub_DrawParams);
        const mapped = meshParamsBuffer.mapBufferF32(offs, 32);
        offs += fillMatrix4x4(mapped, offs, modelMatrixScratch);
        offs += fillMatrix4x3(mapped, offs, viewerInput.camera.viewMatrix);
        
        if (this.drawCall.spriteAnim) {
            this.drawCall.spriteAnim.getUVOffset(viewerInput.time, uvAnimOffsetScratch);
            mapped[offs++] = uvAnimOffsetScratch[0];
            mapped[offs++] = uvAnimOffsetScratch[1];
        }
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.vertexColorsEnabled = v;
        this.createProgram();
    }

    public setTexturesEnabled(v: boolean): void {
        this.texturesEnabled = v;
        this.createProgram();
    }

    public destroy(device: GfxDevice): void {
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
        this.renderInst.setDeviceProgram(program);
    }
}

export class SceneRenderer {
    private sceneParamsBuffer: GfxRenderBuffer;
    private meshParamsBuffer: GfxRenderBuffer;
    private renderInstBuilder: GfxRenderInstBuilder;
    private templateRenderInst: GfxRenderInst;
    private worldTransform: mat4;
    private drawCallInstances: DrawCallInstance[] = [];

    constructor(device: GfxDevice, mapData: MapData, drawCalls: DrawCall[], private isSkybox: boolean) {
        this.sceneParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_SceneParams`);
        this.meshParamsBuffer = new GfxRenderBuffer(GfxBufferUsage.UNIFORM, GfxBufferFrequencyHint.DYNAMIC, `ub_DrawParams`);

        const bindingLayouts: GfxBindingLayoutDescriptor[] = [
            { numUniformBuffers: 1, numSamplers: 0 }, // Scene
            { numUniformBuffers: 1, numSamplers: 1 }, // Mesh
        ];
        const uniformBuffers = [ this.sceneParamsBuffer, this.meshParamsBuffer ];

        this.renderInstBuilder = new GfxRenderInstBuilder(device, KingdomHeartsProgram.programReflection, bindingLayouts, uniformBuffers);
        this.templateRenderInst = this.renderInstBuilder.pushTemplateRenderInst();
        this.renderInstBuilder.newUniformBufferInstance(this.templateRenderInst, KingdomHeartsProgram.ub_SceneParams);

        this.templateRenderInst.setMegaStateFlags({
            cullMode: GfxCullMode.BACK,
            blendMode: GfxBlendMode.NONE,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            depthWrite: true,
            depthCompare: GfxCompareMode.LEQUAL
        });

        for (let i = 0; i < drawCalls.length; i++) {
            this.drawCallInstances.push(new DrawCallInstance(device, this.renderInstBuilder, mapData, drawCalls[i], i));
        }

        this.worldTransform = mat4.create();
        mat4.rotateZ(this.worldTransform, this.worldTransform, Math.PI);
    }

    public addToViewRenderer(device: GfxDevice, viewRenderer: GfxRenderInstViewRenderer): void {
        this.renderInstBuilder.popTemplateRenderInst();
        this.renderInstBuilder.finish(device, viewRenderer);
    }

    public prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.templateRenderInst.passMask = this.isSkybox ? RenderPass.SKYBOX : RenderPass.MAIN;
        viewerInput.camera.setClipPlanes(20, 5000000);

        let offs = this.templateRenderInst.getUniformBufferOffset(KingdomHeartsProgram.ub_SceneParams);
        const sceneParamsMapped = this.sceneParamsBuffer.mapBufferF32(offs, 20);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);
        sceneParamsMapped[offs] = viewerInput.time;

        for (let i = 0; i < this.drawCallInstances.length; i++) {
            this.drawCallInstances[i].prepareToRender(this.isSkybox, this.meshParamsBuffer, this.worldTransform, viewerInput);
        }

        this.sceneParamsBuffer.prepareToRender(hostAccessPass);
        this.meshParamsBuffer.prepareToRender(hostAccessPass);
    }

    public setVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setTexturesEnabled(v);
    }

    public destroy(device: GfxDevice): void {
        this.sceneParamsBuffer.destroy(device);
        this.meshParamsBuffer.destroy(device);
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].destroy(device);
    }
}

export class KingdomHeartsRenderer implements Viewer.SceneGfx {
    private viewRenderer = new GfxRenderInstViewRenderer();
    private renderTarget = new BasicRenderTarget();
    private sceneRenderers: SceneRenderer[] = [];

    private mapData: MapData;

    constructor(device: GfxDevice, public textureHolder: TextureHolder<any>, bin: Bin.BIN) {
        this.mapData = new MapData(device, bin);

        const mapSceneRenderer = new SceneRenderer(device, this.mapData, this.mapData.mapDrawCalls, /*isSkybox=*/false);
        const skyboxSceneRenderer = new SceneRenderer(device, this.mapData, this.mapData.skyboxDrawCalls, /*isSkybox=*/true);
        this.addSceneRenderer(device, mapSceneRenderer);
        this.addSceneRenderer(device, skyboxSceneRenderer);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            this.sceneRenderers.forEach((sceneRenderer: SceneRenderer) => {
                sceneRenderer.setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
            });
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            this.sceneRenderers.forEach((sceneRenderer: SceneRenderer) => {
                sceneRenderer.setTexturesEnabled(enableTextures.checked);
            });
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        const layersPanel = new UI.LayerPanel(this.mapData.layers);

        return [renderHacksPanel, layersPanel];
    }

    private addSceneRenderer(device: GfxDevice, sceneRenderer: SceneRenderer): void {
        this.sceneRenderers.push(sceneRenderer);
        sceneRenderer.addToViewRenderer(device, this.viewRenderer);
    }

    protected prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        for (let i = 0; i < this.sceneRenderers.length; i++) {
            this.sceneRenderers[i].prepareToRender(hostAccessPass, viewerInput);
        }
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);
        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.viewRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);

        this.viewRenderer.prepareToRender(device);

        // Create render pass for skybox.
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, transparentBlackFullClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, skyboxPassRenderer, RenderPass.SKYBOX);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);
        // Create main render pass.
        const passRenderer = this.renderTarget.createRenderPass(device, depthClearRenderPassDescriptor);
        this.viewRenderer.executeOnPass(device, passRenderer, RenderPass.MAIN);
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.sceneRenderers.length; i++) {
            this.sceneRenderers[i].destroy(device);
        }
        this.viewRenderer.destroy(device);
        this.renderTarget.destroy(device);
        this.textureHolder.destroy(device);
    }
};