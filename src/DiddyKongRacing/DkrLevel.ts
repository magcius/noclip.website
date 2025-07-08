
import { mat4, vec3 } from "gl-matrix";
import { DkrLevelModel } from "./DkrLevelModel.js";
import { colorNewFromRGBA, Color } from "../Color.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { ViewerRenderInput } from "../viewer.js";
import { DataManager } from "./DataManager.js";
import { DkrTextureCache } from "./DkrTextureCache.js";
import { DkrObject } from "./DkrObject.js";
import { DkrLevelObjectMap } from "./DkrLevelObjectMap.js";
import { DkrSprites, SPRITE_LAYER_SOLID, SPRITE_LAYER_TRANSPARENT } from "./DkrSprites.js";
import { DkrControlGlobals } from "./DkrControlGlobals.js";
import { DkrAnimationTracks } from "./DkrAnimationTrack.js";
import { DkrDrawCall } from "./DkrDrawCall.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { Panel, Slider } from "../ui.js";
import { F3DDKR_Program } from "./F3DDKR_Program.js";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers.js";

export class DkrLevel {
    private headerData: Uint8Array;
    private model: DkrLevelModel;
    private skydome: DkrObject | null = null;
    private clearColor = colorNewFromRGBA(0, 0, 0);

    private animationTracks = new DkrAnimationTracks();

    private objectMap1: DkrLevelObjectMap;
    private objectMap2: DkrLevelObjectMap;
    private texScrollers: { texIndex: number, scrollU: number, scrollV: number }[] = [];
    private cameraInMirrorMode = false;

    // Remove when the Animator object is properly implemented.
    public id: number = -1;
    public hasCameraAnimation = false;
    private hackCresIslandTexScrollers: { drawCall: DkrDrawCall, scrollU: number, scrollV: number }[] = [];

    constructor(device: GfxDevice, renderHelper: GfxRenderHelper, private textureCache: DkrTextureCache, id: string, private dataManager: DataManager, private sprites: DkrSprites) {
        if (id.startsWith('model:')) {
            // Level model data only.
            const modelId = parseInt(id.slice(6));
            const modelDataBuffer = dataManager.getLevelModel(modelId);

            this.model = new DkrLevelModel(device, renderHelper, this, textureCache, modelDataBuffer);
        } else {
            this.id = parseInt(id);
            const headerDataBuffer = dataManager.getLevelHeader(this.id);
            this.headerData = headerDataBuffer.createTypedArray(Uint8Array);

            const dataView = new DataView(this.headerData.buffer);

            let modelId = dataView.getUint16(0x34);
            let objectMap1Id = dataView.getUint16(0x36);
            let objectMap2Id = dataView.getUint16(0xBA);
            let skydomeId = dataView.getUint16(0x38);

            this.clearColor = colorNewFromRGBA(
                this.headerData[0x9D] / 255,
                this.headerData[0x9E] / 255,
                this.headerData[0x9F] / 255
            );

            const modelDataBuffer = dataManager.getLevelModel(modelId);
            const objectMap1Buffer = dataManager.getLevelObjectMap(objectMap1Id);
            const objectMap2Buffer = dataManager.getLevelObjectMap(objectMap2Id);

            if (skydomeId !== 0xFFFF) {
                this.skydome = new DkrObject(skydomeId, device, this, renderHelper, dataManager, textureCache);
                this.skydome.setManualScale(100.0); 
                // ^ This is a hack that seems to work okay. I'm not sure how the skydomes are scaled/drawn yet.
            }
            this.model = new DkrLevelModel(device, renderHelper, this, textureCache, modelDataBuffer);

            this.objectMap1 = new DkrLevelObjectMap(objectMap1Buffer, this, device, renderHelper, dataManager, textureCache, sprites);
            this.animationTracks.addAnimationNodes(this.objectMap1.getObjects());
            this.objectMap2 = new DkrLevelObjectMap(objectMap2Buffer, this, device, renderHelper, dataManager, textureCache, sprites);
            this.animationTracks.addAnimationNodes(this.objectMap2.getObjects());
            this.animationTracks.compile(device, this, renderHelper, dataManager, textureCache);
            
            this.hasCameraAnimation = this.animationTracks.hasChannel(1);
            if (!this.hasCameraAnimation)
                DkrControlGlobals.ENABLE_ANIM_CAMERA.on = false;

            this.animationNodesReady();
        }
    }

    public destroy(device: GfxDevice): void {
        this.textureCache.destroy(device);
        this.sprites.destroy(device);
        this.model.destroy(device);

        if (this.objectMap1)
            this.objectMap1.destroy(device);
        if (this.objectMap2)
            this.objectMap2.destroy(device);

        if (this.skydome !== null)
            this.skydome.destroy(device);
        this.animationTracks.destroy(device);
    }

    private animationNodesReady(): void {
    }

    private mirrorCamera(viewerInput: ViewerRenderInput): void {
        // Mirror X position
        const camera = viewerInput.camera;

        viewerInput.camera.worldMatrix[12] = -viewerInput.camera.worldMatrix[12];
        camera.worldMatrixUpdated();

        this.cameraInMirrorMode = DkrControlGlobals.ADV2_MIRROR.on;
    }

    private previousChannel = -1;

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const template = renderInstManager.pushTemplate();

        // Set scene parameters
        let offs = template.allocateUniformBuffer(F3DDKR_Program.ub_SceneParams, 16);
        const d = template.mapUniformBufferF32(F3DDKR_Program.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);

        if(DkrControlGlobals.ADV2_MIRROR.on !== this.cameraInMirrorMode) {
            this.mirrorCamera(viewerInput);
        }
        if(this.texScrollers.length > 0) {
            this.textureCache.scrollTextures(this.texScrollers, viewerInput.deltaTime);
        }
        if(this.hackCresIslandTexScrollers.length > 0) {
            for(const texScroller of this.hackCresIslandTexScrollers) {
                const drawCall: DkrDrawCall = texScroller.drawCall;
                drawCall.scrollTexture(texScroller.scrollU, texScroller.scrollV, viewerInput.deltaTime);
            }
        }
        if(!!this.objectMap1) {
            this.objectMap1.updateObjects(viewerInput.deltaTime);
        }
        if(!!this.objectMap2) {
            this.objectMap2.updateObjects(viewerInput.deltaTime);
        }

        if(DkrControlGlobals.ENABLE_ANIM_CAMERA.on && this.animationTracks.isCompiled()) {
            // Uncomment this when cutscenes get properly implemented.
            //const channel = DkrControlGlobals.ANIM_TRACK_SELECT.currentChannel;
            const channel = 1; // For the main tracks channel #1 contains the flyby animation.

            if(channel !== this.previousChannel) {
                // User has changed the track channel.
                DkrControlGlobals.ANIM_PROGRESS.max = this.animationTracks.getMaxDuration(channel);
                (DkrControlGlobals.ANIM_PROGRESS.elem as Slider).setRange(
                    DkrControlGlobals.ANIM_PROGRESS.min,
                    DkrControlGlobals.ANIM_PROGRESS.max,
                    DkrControlGlobals.ANIM_PROGRESS.step
                );
                DkrControlGlobals.ANIM_PROGRESS.setValue(0);
                this.previousChannel = channel;
            }
            if(channel >= 0) {
                let curFlybyPos = DkrControlGlobals.ANIM_PROGRESS.value;
                if(!DkrControlGlobals.ANIM_THIRD_PERSON.on) {
                    this.animationTracks.setCameraToPoint(channel, curFlybyPos, viewerInput.camera);
                }

                this.animationTracks.setObjectsToPoint(channel, curFlybyPos);
                if(!DkrControlGlobals.ANIM_PAUSED.on) {
                    curFlybyPos += (viewerInput.deltaTime / 1000.0) * DkrControlGlobals.ANIM_SPEED.value;
                    const maxDuration = this.animationTracks.getMaxDuration(channel);
                    if(curFlybyPos >= maxDuration) {
                        if(this.animationTracks.doesTrackLoop(channel)) {
                            curFlybyPos -= maxDuration;
                        } else {
                            curFlybyPos = maxDuration;
                        }
                    }
                }
                DkrControlGlobals.ANIM_PROGRESS.setValue(curFlybyPos);
            }
        }

        if(!!this.skydome) {
            this.skydome!.prepareToRender(device, renderInstManager, viewerInput);
        }
        if(DkrControlGlobals.SHOW_ALL_OBJECTS.on) {
            if(!!this.objectMap1) {
                this.objectMap1.prepareToRender(device, renderInstManager, viewerInput, 0, true);
            }
            if(!!this.objectMap2) {
                this.objectMap2.prepareToRender(device, renderInstManager, viewerInput, 1, true);
            }

            // NOTE: This is a workaround! For some reason, the solid sprites flicker when assets are loading.
            if(!this.dataManager.isLoading()) {
                this.sprites.prepareToRender(device, renderInstManager, viewerInput, SPRITE_LAYER_SOLID);
            }
            this.animationTracks.prepareToRender(device, renderInstManager, viewerInput);
        }
        this.model.prepareToRender(device, renderInstManager, viewerInput);
        if(DkrControlGlobals.SHOW_ALL_OBJECTS.on) {
            if(!!this.objectMap1) {
                this.objectMap1.prepareToRender(device, renderInstManager, viewerInput, 0, false);
            }
            if(!!this.objectMap2) {
                this.objectMap2.prepareToRender(device, renderInstManager, viewerInput, 1, false);
            }
            this.sprites.prepareToRender(device, renderInstManager, viewerInput, SPRITE_LAYER_TRANSPARENT);
        }

        renderInstManager.popTemplate();

        this.sprites.advanceTime(viewerInput);
    }

    public getClearColor(): Color {
        return this.clearColor;
    }

    public addScrollerFromTexScroll(texIndex: number, scrollU: number, scrollV: number): void {
        this.texScrollers.push({
            texIndex: this.model.getTextureIndices()[texIndex],
            scrollU: scrollU,
            scrollV: scrollV,
        });
    }

    public addScrollerFromAnimator(objPos: vec3, batchNum: number, scrollU: number, scrollV: number): void {
        /* TODO: Properly implement this. */
        // This is only used in the Crescent Island track.
        // console.log(objPos, batchNum, scrollU, scrollV);
    }

    // This is a hack for the waterfalls in Crescent Island.
    public addDrawCallScrollerForCrescentIsland(drawCall: DkrDrawCall, batchNum: number): void {
        switch(batchNum) {
            case 15:
                this.hackCresIslandTexScrollers.push({
                    drawCall: drawCall,
                    scrollU: 0,
                    scrollV: -36,
                });
                break;
            case 16:
                this.hackCresIslandTexScrollers.push({
                    drawCall: drawCall,
                    scrollU: 0,
                    scrollV: 32,
                });
                break;
            case 17:
                this.hackCresIslandTexScrollers.push({
                    drawCall: drawCall,
                    scrollU: 0,
                    scrollV: 33,
                });
                break;
            default:
                throw 'This should not be possible.'
        }
    }
}
