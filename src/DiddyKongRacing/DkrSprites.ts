
import { mat4, vec3 } from 'gl-matrix';
import { Camera, computeViewMatrix } from '../Camera.js';
import { CalcBillboardFlags, calcBillboardMatrix } from '../MathHelpers.js';
import { TextureMapping } from '../TextureHolder.js';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers.js';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers.js';
import { fillMatrix4x3, fillVec4v } from '../gfx/helpers/UniformBufferHelpers.js';
import {
    GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferUsage, GfxDevice, GfxFormat, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxMipFilterMode, GfxProgram, GfxTexFilterMode,
    GfxVertexAttributeDescriptor,
    GfxVertexBufferDescriptor,
    GfxVertexBufferFrequency,
    GfxWrapMode, makeTextureDescriptor2D
} from '../gfx/platform/GfxPlatform.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxRenderInst, GfxRenderInstManager, GfxRendererLayer, makeSortKey, setSortKeyDepth } from '../gfx/render/GfxRenderInstManager.js';
import { assert } from '../util.js';
import { ViewerRenderInput } from '../viewer.js';
import { DataManager } from './DataManager.js';
import { DkrControlGlobals } from './DkrControlGlobals.js';
import { DkrObject, MODEL_TYPE_2D_BILLBOARD } from './DkrObject.js';
import { F3DDKR_Sprite_Program, MAX_NUM_OF_SPRITE_FRAMES, MAX_NUM_OF_SPRITE_INSTANCES } from './F3DDKR_Sprite_Program.js';

const viewMatrixScratch = mat4.create();
const viewMatrixCalcScratch = mat4.create();
const viewMatrixCalc2Scratch = mat4.create();
const mirrorMatrix = mat4.fromValues(
    -1, 0, 0, 0,
     0, 1, 0, 0,
     0, 0, 1, 0,
     0, 0, 0, 1
);

export const SPRITE_LAYER_SOLID = 0;
export const SPRITE_LAYER_TRANSPARENT = 1;

export class DkrSprites {
    private spritesInfo: any[];
    private spriteSheetWidth = 0;
    private spriteSheetHeight = 0;
    private spriteIndexOffsets = new Array<number>();

    public spriteData: Float32Array;
    private inputLayout: GfxInputLayout;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    private indexBufferDescriptor: GfxIndexBufferDescriptor;
    private textureMappings: TextureMapping[];
    private gfxProgram: GfxProgram | null = null;
    private program: F3DDKR_Sprite_Program;

    private currentFrame = 0;
    private spriteInstances = [new Array<DkrObject>(), new Array<DkrObject>()];

    private indexBuffer: GfxBuffer;
    private vertexBuffer: GfxBuffer;

    private hasBeenDestroyed = false;

    constructor(device: GfxDevice, cache: GfxRenderCache, dataManager: DataManager) {
        this.program = new F3DDKR_Sprite_Program();
        dataManager.getSpriteSheet().then(([spritesInfo, spriteSheetImageData]) => {
            this.spritesInfo = spritesInfo;
            this.spriteSheetWidth = spriteSheetImageData.width;
            this.spriteSheetHeight = spriteSheetImageData.height;

            let totalNumberOfFrames = 0;
            for(let i = 0; i < spritesInfo.length; i++) {
                this.spriteIndexOffsets.push(totalNumberOfFrames);
                for(let j = 0; j < spritesInfo[i].length; j++) {
                    totalNumberOfFrames++;
                }
            }

            let currentFrame = 0;
            this.spriteData = new Float32Array(totalNumberOfFrames * 4);
            for(let i = 0; i < spritesInfo.length; i++) {
                for(let j = 0; j < spritesInfo[i].length; j++) {
                    let currentSpriteInfo = spritesInfo[i][j];
                    this.spriteData[currentFrame * 4 + 0] = currentSpriteInfo.x / this.spriteSheetWidth;
                    this.spriteData[currentFrame * 4 + 1] = currentSpriteInfo.y / this.spriteSheetHeight;
                    this.spriteData[currentFrame * 4 + 2] = currentSpriteInfo.w / this.spriteSheetWidth;
                    this.spriteData[currentFrame * 4 + 3] = currentSpriteInfo.h / this.spriteSheetHeight;
                    currentFrame++;
                }
            }


            // Create input state & layout
            const halfsize = 500.0;
            const vertices = new Float32Array([
                -halfsize, halfsize,
                halfsize, halfsize,
                -halfsize, -halfsize,
                halfsize, -halfsize,
            ]);

            const indices = new Uint16Array([
                // Real Indices
                1, 0, 2, 
                1, 2, 3
            ]);

            this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, vertices.buffer);
            this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, indices.buffer);
    
            const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
                { location: F3DDKR_Sprite_Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 0 * 0x04, }
            ];
            const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
                { byteStride: 2 * 0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
            ];
            
            this.inputLayout = cache.createInputLayout({
                indexBufferFormat: GfxFormat.U16_R,
                vertexAttributeDescriptors,
                vertexBufferDescriptors,
            });
    
            this.vertexBufferDescriptors = [{ buffer: this.vertexBuffer, byteOffset: 0 }];
            this.indexBufferDescriptor = { buffer: this.indexBuffer, byteOffset: 0 };

            // Setup sprite sheet texture
            const sampler = cache.createSampler({
                wrapS: GfxWrapMode.Clamp,
                wrapT: GfxWrapMode.Clamp,
                minFilter: GfxTexFilterMode.Point,
                magFilter: GfxTexFilterMode.Point,
                mipFilter: GfxMipFilterMode.Linear,
                minLOD: 0, maxLOD: 0,
            });

            this.textureMappings = [new TextureMapping()];

            const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, 
                spriteSheetImageData.width, spriteSheetImageData.height, 1));
            device.uploadTextureData(gfxTexture, 0, [spriteSheetImageData.data]);

            this.textureMappings[0].gfxSampler = sampler;
            this.textureMappings[0].gfxTexture = gfxTexture;
        });
    }

    public destroy(device: GfxDevice): void {
        if(!this.hasBeenDestroyed) {
            device.destroyBuffer(this.indexBuffer);
            device.destroyBuffer(this.vertexBuffer);
            device.destroyTexture(this.textureMappings[0].gfxTexture!);
            // The sampler is already destroyed from renderHelper.destroy()
            this.hasBeenDestroyed = true;
        }
    }

    private bind(renderInst: GfxRenderInst): void {
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
    }

    public addInstances(instances: Array<DkrObject>): void {
        for(let i = 0; i < instances.length; i++) {
            if(instances[i].getModelType() != MODEL_TYPE_2D_BILLBOARD) {
                continue;
            }
            const layer = instances[i].getSpriteLayer();
            this.spriteInstances[layer].push(instances[i]);
        }
    }

    private lastCameraPosition = vec3.create();

    private hasCameraMoved(camera: Camera): boolean {
        return !(
            camera.worldMatrix[12] === this.lastCameraPosition[0] &&
            camera.worldMatrix[13] === this.lastCameraPosition[1] &&
            camera.worldMatrix[14] === this.lastCameraPosition[2]
        );
    }

    private checkCameraDistanceToObjects(camera: Camera, layer: number): void {
        if(this.hasCameraMoved(camera)) {
            this.lastCameraPosition[0] = camera.worldMatrix[12];
            this.lastCameraPosition[1] = camera.worldMatrix[13];
            this.lastCameraPosition[2] = camera.worldMatrix[14];
            for(let instance of this.spriteInstances[layer]) {
                instance.updateDistanceToCamera(this.lastCameraPosition);
            };
        }
    }

    private sortInstances(layer: number): void {
        this.spriteInstances[layer].sort((a, b) => (a.getDistanceToCamera() < b.getDistanceToCamera()) ? 1 : -1);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, layer: number) {
        if (!this.spritesInfo || !this.spriteInstances || !DkrControlGlobals.ENABLE_TEXTURES.on)
            return;

        const layerInstances = this.spriteInstances[layer];
        if (layerInstances.length === 0)
            return;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts([{ numUniformBuffers: 3, numSamplers: 1, },]);
        template.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);

        if (layer === SPRITE_LAYER_TRANSPARENT) {
            this.checkCameraDistanceToObjects(viewerInput.camera, layer);
            this.sortInstances(layer);
            template.setMegaStateFlags(setAttachmentStateSimple({
                depthWrite: true
            }, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            }));
            template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);
            if (viewerInput.deltaTime > 0.0)
                this.currentFrame += 0.1 * ((1000 / 30) / viewerInput.deltaTime);
        }

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.program);

        const renderInst = renderInstManager.newRenderInst();

        // Set draw parameters
        let offs = renderInst.allocateUniformBuffer(F3DDKR_Sprite_Program.ub_DrawParams, 4 + (20 * MAX_NUM_OF_SPRITE_INSTANCES));
        const d = renderInst.mapUniformBufferF32(F3DDKR_Sprite_Program.ub_DrawParams);
        d[offs] = this.currentFrame;
        offs += 4;

        // Use the texture.
        this.bind(renderInst);
        renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, 0);

        computeViewMatrix(viewMatrixScratch, viewerInput.camera);

        assert(layerInstances.length <= MAX_NUM_OF_SPRITE_INSTANCES);
        for (let i = 0; i < layerInstances.length; i++) {
            const instanceObject: DkrObject = layerInstances[i];
            const spriteIndex = instanceObject.getSpriteIndex();
            d[offs + 0] = this.spriteIndexOffsets[spriteIndex];
            d[offs + 1] = this.spritesInfo[spriteIndex].length;
            d[offs + 2] = instanceObject.getSpriteAlphaTest();
            d[offs + 3] = instanceObject.isSpriteCentered() ? 0.0 : 500.0;
            offs += 4;
            const color = instanceObject.getSpriteColor();
            offs += fillVec4v(d, offs, color);
            if (DkrControlGlobals.ADV2_MIRROR.on) {
                mat4.mul(viewMatrixCalcScratch, mirrorMatrix, instanceObject.getModelMatrix());
                mat4.mul(viewMatrixCalcScratch, viewMatrixScratch, viewMatrixCalcScratch);
            } else {
                mat4.mul(viewMatrixCalcScratch, viewMatrixScratch, instanceObject.getModelMatrix());
            }
            calcBillboardMatrix(viewMatrixCalc2Scratch, viewMatrixCalcScratch, CalcBillboardFlags.UseRollLocal | CalcBillboardFlags.PriorityZ | CalcBillboardFlags.UseZPlane);
            offs += fillMatrix4x3(d, offs, viewMatrixCalc2Scratch);
        }

        // Set tex parameters
        let offs2 = renderInst.allocateUniformBuffer(F3DDKR_Sprite_Program.ub_TexParams, 4 * MAX_NUM_OF_SPRITE_FRAMES);
        const d2 = renderInst.mapUniformBufferF32(F3DDKR_Sprite_Program.ub_TexParams);
        d2.set(this.spriteData, offs2);

        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.drawIndexesInstanced(6, layerInstances.length);

        renderInstManager.submitRenderInst(renderInst);
        renderInstManager.popTemplateRenderInst();
    }
}
