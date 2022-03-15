import * as Viewer from '../viewer';
import * as Textures from './textures';
import * as RDP from '../Common/N64/RDP';
import * as RSP from '../Common/N64/RSP';
import * as F3DEX from '../BanjoKazooie/f3dex';
import * as Shadows from './shadows';
import * as Render from './render';

import { assert, assertExists, align, nArray } from "../util";
import { F3DEX_Program } from "../BanjoKazooie/render";
import { mat4, vec3, vec4, quat } from "gl-matrix";
import { fillMatrix4x4, fillMatrix4x3, fillMatrix4x2, fillVec3v, fillVec4, fillVec4v } from '../gfx/helpers/UniformBufferHelpers';
import { GfxRenderInstManager, GfxRendererLayer, makeSortKey, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager";
import { GfxDevice, GfxFormat, GfxTexture, GfxSampler, GfxBuffer, GfxBufferUsage, GfxInputLayout, GfxInputState, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxCullMode, GfxCompareMode, GfxMegaStateDescriptor, GfxProgram, GfxBufferFrequencyHint, GfxInputLayoutBufferDescriptor, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { ImageFormat, getImageFormatName, ImageSize, getImageSizeName, getSizBitsPerPixel } from "../Common/N64/Image";
import { DeviceProgram } from "../Program";
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';

import { Color } from "../Color";

import { GloverTexbank } from './parsers';
import { Flipbook, FlipbookType } from './particles';
import { SRC_FRAME_TO_MS } from './timing';
import { subtractAngles, lerp } from './util';

const depthScratch = vec3.create();
const lookatScratch = vec3.create();
const projectionMatrixScratch = mat4.create();

interface SpriteRect {
    sX: number;
    sY: number;
    sW: number;
    sH: number;
    ulS: number;
    ulT: number;
    lrS: number;
    lrT: number;
};

class GloverBaseSpriteRenderer {
    protected drawCall: Render.DrawCall;
    protected textureCache: RDP.TextureCache;
    protected drawCallInstance: Render.DrawCallInstance;

    protected megaStateFlags: Partial<GfxMegaStateDescriptor>;

    protected frames: number[] = [];
    protected frame_textures: GloverTexbank.Texture[] = [];

    protected spriteRect: SpriteRect;

    protected sortKey: number;

    public visible: boolean = true;
    
    protected isBillboard: boolean = true;
    protected isOrtho: boolean = false;

    constructor(
        protected device: GfxDevice,
        protected cache: GfxRenderCache,
        protected textures: Textures.GloverTextureHolder,
        protected frameset: number[],
        protected xlu: boolean = false)
    {
        if (xlu) {
            this.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + Render.GloverRendererLayer.XLU);
        } else {
            this.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + Render.GloverRendererLayer.OPAQUE_BILLBOARD);
        }

        this.megaStateFlags = {};

        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });
    }

    protected initialize() {
        this.loadFrameset(this.frameset);
        const rect = {
            sW: 1.0,
            sH: 1.0,
            sX: -1/2,
            sY: -1/2,
            ulS: 0,
            ulT: 0,
            lrS: this.frame_textures[0].width * 32,
            lrT: this.frame_textures[0].height * 32
        };
        this.buildDrawCall(rect);
    }

    public cacheKey(): string {
        return String(this.frameset);
    }

    protected initializePipeline(rspState: Render.GloverRSPState) {
        Render.initializeRenderState(rspState);
        rspState.gSPSetGeometryMode(F3DEX.RSP_Geometry.G_ZBUFFER); // 0xB7000000 0x00000001
        if (this.xlu) {
            rspState.gDPSetCombine(0xfc119623, 0xff2fffff); // G_CC_MODULATEIA_PRIM, G_CC_MODULATEIA_PRIM
            rspState.gDPSetRenderMode(RDP.RENDER_MODES.G_RM_ZB_CLD_SURF, RDP.RENDER_MODES.G_RM_ZB_CLD_SURF2); // 0xb900031d 0x00504b50
        } else {
            rspState.gDPSetCombine(0xfc119623, 0xff2fffff); // G_CC_MODULATEIDECALA, G_CC_PASS2
            rspState.gDPSetRenderMode(RDP.RENDER_MODES.G_RM_AA_ZB_TEX_EDGE, RDP.RENDER_MODES.G_RM_AA_ZB_TEX_EDGE2);
        }
        rspState.gDPSetPrimColor(0, 0, 0xFF, 0xFF, 0xFF, 0xFF); // 0xFA000000, (*0x801ec878) & 0xFF);
        rspState.gSPTexture(true, 0, 5, 0.999985 * 0x10000 / 32, 0.999985 * 0x10000 / 32);
    }

    protected loadFrameset(frameset: number[]): void {
        this.frame_textures = []
        for (let frame_id of frameset) {
            const texFile = this.textures.idToTexture.get(frame_id);
            if (texFile === undefined) {
                throw `Texture 0x${frame_id.toString(16)} not loaded`;
            }
            this.frame_textures.push(texFile);
        }
    }

    protected buildDrawCall(rect: SpriteRect, texSFlags: number = Render.G_TX_CLAMP | Render.G_TX_NOMIRROR, texTFlags: number = Render.G_TX_CLAMP | Render.G_TX_NOMIRROR) {
        const segments = this.textures.textureSegments();

        const rspState = new Render.GloverRSPState(segments, this.textures);

        this.initializePipeline(rspState);

        let drawCall = rspState._newDrawCall();

        this.frames = []
        for (let texture of this.frame_textures) {
            this.frames.push(Render.loadRspTexture(rspState, this.textures, texture.id, 
                texSFlags,
                texTFlags
            ))
        }

        drawCall.textureIndices.push(0);

        const spriteCoords = [
            [rect.sX, rect.sY + rect.sH, rect.ulS, rect.ulT],
            [rect.sX, rect.sY, rect.ulS, rect.lrT],
            [rect.sX + rect.sW, rect.sY + rect.sH, rect.lrS, rect.ulT],

            [rect.sX, rect.sY, rect.ulS, rect.lrT],
            [rect.sX + rect.sW, rect.sY, rect.lrS, rect.lrT],
            [rect.sX + rect.sW, rect.sY + rect.sH, rect.lrS, rect.ulT],
        ];

        for (let coords of spriteCoords) {
            const v = new F3DEX.Vertex();
            v.x = coords[0];
            v.y = coords[1];
            v.z = 0;
            v.tx = coords[2];
            v.ty = coords[3];
            v.c0 = 0xFF;
            v.c1 = 0xFF;
            v.c2 = 0xFF;
            v.a = 1.0;
            drawCall.vertexCount += 1;
            drawCall.vertices.push(v)
        }

        drawCall.renderData = new Render.DrawCallRenderData(this.device, this.cache, rspState.textureCache, rspState.segmentBuffers, drawCall);
        this.drawCall = drawCall;
        this.textureCache = rspState.textureCache;
        this.drawCallInstance = new Render.DrawCallInstance(this.drawCall, this.textureCache);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, drawMatrix: mat4, frame: number, prim_color: Color | null = null): void {
        if (this.visible !== true) {
            return;
        }

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(Render.bindingLayouts);
        template.setMegaStateFlags(this.megaStateFlags);

        if (!this.isOrtho) {
            mat4.getTranslation(depthScratch, viewerInput.camera.worldMatrix);
            mat4.getTranslation(lookatScratch, drawMatrix);

            template.sortKey = setSortKeyDepth(this.sortKey, vec3.distance(depthScratch, lookatScratch));
        } else {
            template.sortKey = this.sortKey;
        }

        const sceneParamsSize = 16;

        let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, sceneParamsSize);
        const mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);

        if (!this.isOrtho) {
            offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);
        } else {
            const aspect = viewerInput.backbufferWidth / viewerInput.backbufferHeight;
            mat4.ortho(projectionMatrixScratch, 0, 640, 640 / aspect, 0, -1, 1);
            offs += fillMatrix4x4(mappedF32, offs, projectionMatrixScratch);
        }

        this.drawCall.textureIndices[0] = this.frames[frame];
        if (prim_color !== null) {
            // TODO: this could accidentally latch prim colors across
            //       independent objects if one of them renders a sprite
            //       with prim color and the other does not. be careful
            //       here.
            this.drawCall.DP_PrimColor = prim_color;
        }

        this.drawCallInstance.reloadTextureMappings();
        this.drawCallInstance.prepareToRender(device, renderInstManager, viewerInput, drawMatrix, this.isOrtho, this.isBillboard);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.drawCall.destroy(device);
    }
}


export class GloverSpriteRenderer extends GloverBaseSpriteRenderer {
    constructor(
        device: GfxDevice,
        cache: GfxRenderCache,
        textures: Textures.GloverTextureHolder,
        frameset: number[],
        xlu: boolean = false) {
        super(device, cache, textures, frameset, xlu);
        this.initialize();
    }

}

export class GloverBackdropRenderer extends GloverBaseSpriteRenderer {

    private drawMatrix = mat4.create();

    private backdropWidth: number = 0; 
    private backdropHeight: number = 0; 

    public backdropSortKey: number;
    public textureId: number;

    protected override isOrtho = true;
    protected override isBillboard = false;

    constructor(
        device: GfxDevice,
        cache: GfxRenderCache,
        textures: Textures.GloverTextureHolder,
        protected backdropObject: GloverLevel.Backdrop,
        protected primitiveColor: number[])
    {
        super(device, cache, textures, [backdropObject.textureId]);

        this.initialize();

        this.backdropSortKey = backdropObject.sortKey;
        this.sortKey = makeSortKey(this.backdropSortKey);
        this.textureId = backdropObject.textureId;
    }

    protected override initialize() {
        this.loadFrameset(this.frameset);
        const rect = {
            sX: 0,
            sY: 0,
            sW: this.frame_textures[0].width * 2,
            sH: this.frame_textures[0].height,
            ulS: 0,
            ulT: 0,
            lrS: 0,
            lrT: 0
        };
        rect.ulS = rect.sW * 32;
        rect.ulT = rect.sH * 32;

        if (this.backdropObject.flipY != 0) {
            [rect.ulT, rect.lrT] = [rect.lrT, rect.ulT];
        } 

        rect.sW *= this.backdropObject.scaleX / 1024;
        rect.sH *= this.backdropObject.scaleY / 1024;
        this.buildDrawCall(rect, Render.G_TX_WRAP | Render.G_TX_NOMIRROR);

        this.backdropWidth = rect.sW;
        this.backdropHeight = rect.sH;
    }

    protected override initializePipeline(rspState: Render.GloverRSPState) {
        Render.initializeRenderState(rspState);
        Render.setRenderMode(rspState, true, false, false, 1.0);

        rspState.gDPSetOtherModeH(0x14, 0x02, 0x0000); // gsDPSetCycleType(G_CYC_1CYCLE)
        rspState.gDPSetCombine(0xFC119623, 0xFF2FFFFF);
        rspState.gDPSetRenderMode(RDP.RENDER_MODES.G_RM_AA_XLU_SURF, RDP.RENDER_MODES.G_RM_AA_XLU_SURF2);
        rspState.gSPTexture(true, 0, 5, 0.999985 * 0x10000 / 32, 0.999985 * 0x10000 / 32);
        if (this.primitiveColor !== undefined) {
            rspState.gDPSetPrimColor(0, 0, this.primitiveColor[0], this.primitiveColor[1], this.primitiveColor[2], 0xFF);
        } else {
            rspState.gDPSetPrimColor(0, 0, 0xFF, 0xFF, 0xFF, 0xFF);
        }

    }

    public override prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const view = viewerInput.camera.viewMatrix;
        const yaw = Math.atan2(-view[2], view[0]) / (Math.PI * 2);
        const pitch = Math.asin(view[6]) / (Math.PI * 2);

        mat4.fromTranslation(this.drawMatrix, [
            -(yaw + 0.5) * this.backdropObject.scrollSpeedX * this.backdropWidth / 2,
            Math.min(((-Math.sin(pitch*2*Math.PI)*500 + this.backdropObject.offsetY)/2) + (136/(this.backdropObject.scaleY/1024)), 0),
            0
        ]);

        super.prepareToRender(device, renderInstManager, viewerInput, this.drawMatrix, 0); 
    }
}

export class GloverFlipbookRenderer implements Shadows.ShadowCaster {
    private static renderCache: Map<string, GloverSpriteRenderer> = new Map<string, GloverSpriteRenderer>();
 
    private spriteRenderer: GloverSpriteRenderer;

    private frameDelay: number;
    private lastFrameAdvance: number = 0;
    private frameCounter: number = 0;
    public curFrame: number;
    
    public startSize: number;
    public endSize: number;
    public startAlpha: number;
    public endAlpha: number;

    private lifetime: number = -1;
    private timeRemaining: number = 0;

    public isGarib: boolean = false;

    public loop: boolean = true;
    public playing: boolean = true;

    public shadow: Shadows.Shadow | null = null;
    public shadowSize: number = 8;

    public visible: boolean = true;

    public drawMatrix: mat4 = mat4.create();

    private drawMatrixScratch: mat4 = mat4.create();

    private vec3Scratch: vec3 = vec3.create();

    private primColor: Color = {r: 1, g: 1, b: 1, a: 1};

    constructor(
        private device: GfxDevice,
        private cache: GfxRenderCache,
        private textures: Textures.GloverTextureHolder,
        public flipbookMetadata: Flipbook)
    {
        this.setSprite(flipbookMetadata);

    }

    public setLifetime(time: number) {
        this.lifetime = time;
        this.timeRemaining = time;
    }

    public getPosition(): vec3 {
        mat4.getTranslation(this.vec3Scratch, this.drawMatrix);
        return this.vec3Scratch;
    }

    public setPrimColor(r: number, g: number, b: number) {
        this.primColor.r = r / 255;
        this.primColor.g = g / 255;
        this.primColor.b = b / 255;
    }

    public setSprite(flipbookMetadata: Flipbook): void {
        this.flipbookMetadata = flipbookMetadata;

        this.startAlpha = this.flipbookMetadata.startAlpha;
        this.endAlpha = this.flipbookMetadata.endAlpha;
        this.startSize = this.flipbookMetadata.startSize;
        this.endSize = this.flipbookMetadata.endSize;

        let key = String(flipbookMetadata.frameset)
        if (GloverFlipbookRenderer.renderCache.has(key)) {
            this.spriteRenderer = GloverFlipbookRenderer.renderCache.get(key)!;
        } else {
            const xlu = (flipbookMetadata.startAlpha != flipbookMetadata.endAlpha) || (flipbookMetadata.flags & 0x10000) != 0;
            this.spriteRenderer = new GloverSpriteRenderer(this.device, this.cache, this.textures, flipbookMetadata.frameset, xlu);
            GloverFlipbookRenderer.renderCache.set(key, this.spriteRenderer);
        }        

        // TODO: implement these types:
        // MirrorLooping = 3, // TODO
        // OneshotBackwards = 6, // TODO
        // NotTweened = 7 // TODO


        this.playing = true;

        if (flipbookMetadata.type === FlipbookType.RandomStartLooping) {
            this.curFrame = Math.floor(Math.random() * flipbookMetadata.frameset.length);
        } else {
            this.curFrame = 0;
        }
        this.frameDelay = flipbookMetadata.frameDelay;
        this.frameCounter = this.frameDelay;

        if (flipbookMetadata.type === FlipbookType.Oneshot) {
            this.loop = false;
        } else {
            this.loop = true;
        }
    }

    public reset() {
        this.playing = true;
        this.frameCounter = this.frameDelay;
        if (this.flipbookMetadata.type === FlipbookType.RandomStartLooping) {
            this.curFrame = Math.floor(Math.random() * this.flipbookMetadata.frameset.length);
        } else {
            this.curFrame = 0;
        }
        this.lifetime = -1;
        this.timeRemaining = 0;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.flipbookMetadata.frameset.length > 1 && this.frameDelay >= 0) {
            this.lastFrameAdvance += viewerInput.deltaTime;
            if (this.lastFrameAdvance > 50) {
                this.lastFrameAdvance = 0;

                if (this.flipbookMetadata.type !== FlipbookType.OnlyTweened) {
                    if (this.frameCounter > 0) {
                        this.frameCounter -= 0x20;
                    } else {
                        this.frameCounter += this.frameDelay;
                        this.curFrame += 1;
                        if (this.curFrame >= this.flipbookMetadata.frameset.length) {
                            if (this.loop) {
                                this.curFrame = 0;
                                this.playing = true;
                            } else {
                                this.curFrame = this.flipbookMetadata.frameset.length - 1;
                                this.playing = false;
                            }
                        }
                    }
                }
            }
        }

        let alpha = this.endAlpha;
        if (this.startAlpha != this.endAlpha) {
            alpha = this.startAlpha;
            if (this.lifetime < 0) {
                const nFrames = this.flipbookMetadata.frameset.length;
                alpha += (this.endAlpha - this.startAlpha) * (nFrames - this.curFrame - 1) / (nFrames - 1);
            } else {
                alpha += (this.endAlpha - this.startAlpha) * this.timeRemaining / this.lifetime;
            }
        }
        this.primColor.a = alpha / 255;

        let size = this.startSize;
        if (this.startSize != this.endSize) {
            if (this.lifetime < 0) {
                const nFrames = this.flipbookMetadata.frameset.length;
                size += (this.endSize - this.startSize) * (nFrames - this.curFrame - 1) / (nFrames - 1);
            } else {
                size += (this.endSize - this.startSize) * this.timeRemaining / this.lifetime;
            }
        }
        size /= 3;

        if (this.lifetime > 0) {
            this.timeRemaining -= viewerInput.deltaTime;
            if (this.timeRemaining <= 0) {
                this.playing = false;
            }
        }

        if (this.visible) {
            mat4.scale(this.drawMatrixScratch, this.drawMatrix, [size, size, size]);
            this.spriteRenderer.prepareToRender(device, renderInstManager, viewerInput, this.drawMatrixScratch, this.curFrame, this.primColor);
        }
    }

    public destroy(device: GfxDevice): void {
        this.spriteRenderer.destroy(device);
        GloverFlipbookRenderer.renderCache.delete(this.spriteRenderer.cacheKey());
    }
}

export class GloverShadowRenderer extends GloverSpriteRenderer {
    protected override isBillboard: boolean = false;

    public drawMatrix: mat4 = mat4.create();

    protected override initializePipeline(rspState: Render.GloverRSPState) {
        Render.initializeRenderState(rspState);
        rspState.gSPSetGeometryMode(F3DEX.RSP_Geometry.G_ZBUFFER); // 0xB7000000 0x00000001
        rspState.gDPSetRenderMode(RDP.RENDER_MODES.G_RM_ZB_CLD_SURF, RDP.RENDER_MODES.G_RM_ZB_CLD_SURF2); // 0xb900031d 0x00504b50
        rspState.gDPSetCombine(0xfc119623, 0xff2fffff); // G_CC_MODULATEIA_PRIM, G_CC_MODULATEIA_PRIM
        rspState.gSPTexture(true, 0, 5, 0.999985 * 0x10000 / 32, 0.999985 * 0x10000 / 32);
        rspState.gDPSetPrimColor(0, 0, 0, 0, 0, 0xFF);
    }
    
    constructor(
        device: GfxDevice,
        cache: GfxRenderCache,
        textures: Textures.GloverTextureHolder)
    {
        super(device, cache, textures, [0x147b7297]);
        this.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + Render.GloverRendererLayer.FOOTPRINTS);
    }

    public override prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        super.prepareToRender(device, renderInstManager, viewerInput, this.drawMatrix, 0, {r: 0, g: 0, b: 0, a: 1});
    }
}

export enum WeatherType {
    Rain,
    Snow
}


export class GloverUISpriteRenderer extends GloverBaseSpriteRenderer {
    protected override isOrtho = true;
    protected override isBillboard = false;
    public primColor: Color = {r: 1, g: 1, b: 1, a: 1};

    constructor(
        device: GfxDevice,
        cache: GfxRenderCache,
        textures: Textures.GloverTextureHolder,
        protected textureId: number)
    {
        super(device, cache, textures, [textureId]);
        this.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + Render.GloverRendererLayer.WEATHER);
        this.initialize();
    }

    protected override initialize() {
        this.loadFrameset(this.frameset);
        let tex = this.frame_textures[0];
        const rect = {
            sW: tex.width,
            sH: tex.height,
            sX: -tex.width/2,
            sY: -tex.height/2,
            ulS: 0,
            ulT: 0,
            lrS: tex.width * 32,
            lrT: tex.height * 32
        };
        this.buildDrawCall(rect);
    }

    protected override initializePipeline(rspState: Render.GloverRSPState) {
        Render.initializeRenderState(rspState);
        Render.setRenderMode(rspState, true, false, false, 1.0);

        rspState.gDPSetOtherModeH(0x14, 0x02, 0x0000); // gsDPSetCycleType(G_CYC_1CYCLE)
        rspState.gDPSetCombine(0xFC119623, 0xFF2FFFFF);
        rspState.gDPSetRenderMode(RDP.RENDER_MODES.G_RM_AA_XLU_SURF, RDP.RENDER_MODES.G_RM_AA_XLU_SURF2);
        
        // TODO: should be .5 rather than .99?
        rspState.gSPTexture(true, 0, 5, 0.999985 * 0x10000 / 32, 0.999985 * 0x10000 / 32);
        rspState.gDPSetPrimColor(0, 0, 0xFF, 0xFF, 0xFF, 0xFF);
    }

    public override prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, drawMatrix: mat4, alpha: number | null = null): void {
        if (alpha !== null) {
            this.primColor.a = alpha / 0xFF;
        }
        super.prepareToRender(device, renderInstManager, viewerInput, drawMatrix, 0, this.primColor);
    }
}

export interface WeatherParams {
    type: WeatherType;
    iterations_per_frame: number;
    particles_per_iteration: number;
    lifetime: number;
    alphas: [number, number, number];
    velocity: [number, number];
    particle_lifetime_min: number;
};

class Debris {
    public active: boolean = false;
    public pos: [number, number] = [0, 0];
    public vel: [number, number] = [0, 0];
    public scale: [number, number] = [1, 1];
    public curAlpha: number = 0xFF;
    public targetAlpha: number = 0xFF;
    public curParallaxEffect: number = 1;
    public targetParallaxEffect: number = 1;
    public lifetimeCounter: number = 0;
    public countdownToFadeout: number = 0;
}

export class GloverWeatherRenderer {
    // TODO: not sure why the speeds direct-from-engine need
    //  to be so radically hand-tweaked to look right.
    //  Investigate more into this.

    private spriteRenderer: GloverUISpriteRenderer;
    private lightningRenderer: GloverUISpriteRenderer;
    
    public visible: boolean = true;

    private drawMatrixScratch: mat4 = mat4.create();
    private vec3Scratch: vec3 = vec3.create();

    private debris: Debris[] = [];

    private curIterCount: number = 0;
    private curParticleCycle: number = 0;

    private lastFrameAdvance: number = 0;

    private lastYaw: number = 0;
    private lastCamPos: vec3 = vec3.create();

    private lightningFrame: number = 0
    private lightningColor: Color = {r: 0, g: 0, b: 0, a: 0};

    constructor(
        private device: GfxDevice,
        private cache: GfxRenderCache,
        private textures: Textures.GloverTextureHolder,
        private params: WeatherParams)
    {
        this.spriteRenderer = new GloverUISpriteRenderer(
            this.device, this.cache, this.textures,
            (params.type === WeatherType.Rain) ? 0xCB588DD9 : 0x1AF9F784 // raindrop.bmp / ai_snow.bmp
        );
        this.lightningRenderer = new GloverUISpriteRenderer(
            this.device, this.cache, this.textures,
            0xC4B329C3  
        );

        for (let x=0; x<40; x++) {
            this.debris.push(new Debris());
        }
        for (let i=0; i<3; i++) {
            this.generateWeatherParticles(true);
        }
    }

    private generateWeatherParticles(random_y: boolean = false) {
        if (this.params.type === WeatherType.Rain && this.lightningFrame === 0) {
            // TODO: these are the in-game odds for a lightning strike,
            //       but they don't happen often enough with non-engine RNG:
            // const strike = Math.floor(Math.random()*2000) < 5;
            const strike = Math.floor(Math.random()*600) < 5;
            if (strike) {
                this.lightningFrame = (5 + Math.floor(Math.random()*5)) * 2;
            }
        }

        for (this.curIterCount += this.params.iterations_per_frame; this.curIterCount > 0x40; this.curIterCount -= 0x40) {
            for (let particleCount = 0; particleCount < this.params.particles_per_iteration; particleCount += 1) {
                let found = false;
                for (let singleDebris of this.debris) {
                    if (singleDebris.active) {
                        continue;
                    }
                    found = true;
                    
                    singleDebris.active = true;
                    singleDebris.pos = [Math.floor(Math.random()*640), 0];
                    if (random_y) {
                        singleDebris.pos[1] = Math.floor(Math.random()*480);
                    }
                    singleDebris.vel = [this.params.velocity[0], this.params.velocity[1]];
                    singleDebris.countdownToFadeout = 0xf;
                    if (this.curParticleCycle == 0) {
                        singleDebris.curParallaxEffect = 0x400;
                    } else if (this.curParticleCycle == 1) {
                        singleDebris.curParallaxEffect = 0x300;
                        singleDebris.vel[0] *= 0.75;
                        singleDebris.vel[1] *= 0.75;
                    } else {
                        singleDebris.curParallaxEffect = 0x200;
                        singleDebris.vel[0] *= 0.5;
                        singleDebris.vel[1] *= 0.5;
                    }
                    singleDebris.scale = [singleDebris.curParallaxEffect, singleDebris.curParallaxEffect];
                    singleDebris.targetParallaxEffect = singleDebris.curParallaxEffect;
                    singleDebris.curAlpha = this.params.alphas[this.curParticleCycle];
                    singleDebris.targetAlpha = singleDebris.curAlpha;
                    singleDebris.lifetimeCounter = this.params.particle_lifetime_min + Math.floor(Math.random()*2);

                    this.curParticleCycle = (this.curParticleCycle < 3) ? this.curParticleCycle + 1 : 0;
                }
                if (!found) {
                    let tmp = this.curIterCount;
                    if (tmp < 0) {
                        tmp += 0x3f;
                    }
                    this.curIterCount -= ((tmp & 0xFFFF)>>6)*-0x40;
                    return;
                }
            }            
        }

    }

    private advanceActiveParticles(viewerInput: Viewer.ViewerRenderInput) {
        // Advance state
        const view = viewerInput.camera.viewMatrix;
        const aspect = viewerInput.backbufferWidth / viewerInput.backbufferHeight;
        const yaw = Math.atan2(-view[2], view[0]) / (Math.PI * 2);
        const camPosition = lookatScratch;
        mat4.getTranslation(lookatScratch, view);

        if (this.lightningFrame > 0) {
            this.lightningFrame -= 1;
            if ((this.lightningFrame & 1) == 0) {
                if ((Math.floor(Math.random()*10) & 1)==0) {
                    this.lightningColor.r = 0;
                    this.lightningColor.g = 0;
                    this.lightningColor.b = 0;
                    this.lightningColor.a = 0.9;
                } else {
                    this.lightningColor.r = 0.863;
                    this.lightningColor.g = 0.863;
                    this.lightningColor.b = 1;
                    this.lightningColor.a = 0.9;
                }
            }
        }

        if (this.lightningColor.a > 0) {
            this.lightningColor.a -= this.lightningColor.a / 6;
            if (this.lightningColor.a < .1) {
                this.lightningColor.a = 0;
            }            
        }

        let camVelocity = [camPosition[0]-this.lastCamPos[0], camPosition[2]-this.lastCamPos[2]];

        for (let singleDebris of this.debris) {
            if (!singleDebris.active) {
                continue;
            }

            // [1,0] rotated by camera yaw:
            let tmp_vec = [ 
                Math.cos(-yaw),
                Math.sin(-yaw)
            ]

            singleDebris.pos[0] -= (tmp_vec[0] * camVelocity[0] + tmp_vec[1] * camVelocity[1]) * Math.pow(singleDebris.curParallaxEffect, 2) / 2000000;

            let angleDiff = subtractAngles(this.lastYaw, yaw);
            singleDebris.pos[0] += angleDiff * Math.pow(singleDebris.curParallaxEffect,2) / -3000;

            if (singleDebris.pos[0] > 640) {
                singleDebris.pos[0] -= 640;
            } else if (singleDebris.pos[0] < 0) {
                singleDebris.pos[0] += 640;
            }

            if (this.params.type === WeatherType.Snow) {
                const drift = Math.sin(singleDebris.lifetimeCounter/10);
                singleDebris.vel[0] = drift * -40 * singleDebris.curParallaxEffect / 256;
 
                tmp_vec = [-tmp_vec[1], -tmp_vec[0]];

                singleDebris.targetParallaxEffect += (tmp_vec[0] * camVelocity[0] + tmp_vec[1] * camVelocity[1]) * -3;
                if (singleDebris.targetParallaxEffect > 1200 || singleDebris.targetParallaxEffect < 100) {
                    singleDebris.targetParallaxEffect = 1200;
                }

                singleDebris.curParallaxEffect = singleDebris.targetParallaxEffect;

                const a = Math.floor(this.params.alphas[2]/2);
                singleDebris.targetAlpha = a + (0xff - a) * singleDebris.curParallaxEffect / 1200;
                singleDebris.curAlpha = singleDebris.targetAlpha;

                singleDebris.vel[1] = this.params.velocity[1] * (0.25 + singleDebris.curParallaxEffect / 1200);
            }

            singleDebris.pos[0] -= singleDebris.vel[0] / 8;
            singleDebris.pos[1] += singleDebris.vel[1] / 8;
            singleDebris.lifetimeCounter -= 1;

            if (singleDebris.pos[1] > 640 / aspect) {
                singleDebris.active = false;
            }
        }

        this.lastYaw = yaw;
        vec3.copy(this.lastCamPos, camPosition);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible) {
            return;
        }

        const screenWidth = 640;

        this.lastFrameAdvance += viewerInput.deltaTime;
        if(this.lastFrameAdvance >= SRC_FRAME_TO_MS) {
            this.advanceActiveParticles(viewerInput);
            this.generateWeatherParticles();
            this.lastFrameAdvance = 0;
        }

        for (let singleDebris of this.debris) {
            if (!singleDebris.active) {
                continue;
            }
            mat4.fromTranslation(this.drawMatrixScratch,
                [singleDebris.pos[0], singleDebris.pos[1], 0]);
            mat4.scale(this.drawMatrixScratch, this.drawMatrixScratch,
                [singleDebris.scale[0]/screenWidth, -singleDebris.scale[1]/screenWidth, 1]);
            this.spriteRenderer.prepareToRender(device, renderInstManager, viewerInput, this.drawMatrixScratch, singleDebris.curAlpha);
        }

        if (this.lightningColor.a > 0) {
            mat4.fromTranslation(this.drawMatrixScratch, [0, 0, 0]);
            mat4.scale(this.drawMatrixScratch, this.drawMatrixScratch, [640, 480, 1]);
            this.lightningRenderer.primColor = this.lightningColor
            this.lightningRenderer.prepareToRender(device, renderInstManager, viewerInput, this.drawMatrixScratch);

        }

    }

    public destroy(device: GfxDevice): void {
        this.spriteRenderer.destroy(device);
        this.lightningRenderer.destroy(device);
    }
}


export class GloverFootprintRenderer extends GloverSpriteRenderer {
    protected override isBillboard: boolean = false;

    private drawMatrix: mat4 = mat4.create();

    private scaleDelta: number;
    private dstScale: number;
    private scale: number;
    private nextScale: number;
    private lastScale: number;

    private alphaDelta: number;
    private dstAlpha: number;
    private alpha: number;

    private rotation: quat = quat.create();
    private position: vec3 = vec3.create();

    public active: boolean = false;
    private lifetime: number;
    private lastFrameAdvance: number = 0;

    protected override initializePipeline(rspState: Render.GloverRSPState) {
        Render.initializeRenderState(rspState);
        rspState.gSPSetGeometryMode(F3DEX.RSP_Geometry.G_ZBUFFER); // 0xB7000000 0x00000001
        rspState.gDPSetRenderMode(RDP.RENDER_MODES.G_RM_ZB_CLD_SURF, RDP.RENDER_MODES.G_RM_ZB_CLD_SURF2); // 0xb900031d 0x00504b50
        rspState.gDPSetCombine(0xfc119623, 0xff2fffff); // G_CC_MODULATEIA_PRIM, G_CC_MODULATEIA_PRIM
        rspState.gSPTexture(true, 0, 5, 0.999985 * 0x10000 / 32, 0.999985 * 0x10000 / 32);
        rspState.gDPSetPrimColor(0, 0, 0, 0, 0, 0xFF);
    }
    
    constructor(
        device: GfxDevice,
        cache: GfxRenderCache,
        textures: Textures.GloverTextureHolder,
        private textureID: number)
    {
        super(device, cache, textures, [textureID]);
        this.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + Render.GloverRendererLayer.FOOTPRINTS);
    }

    public reset(scale: number, dstScale: number, scaleDelta: number,
                 alpha: number, dstAlpha: number, alphaDelta: number,
                 lifetimeFrames: number,
                 position: vec3, normal: vec3)        
    {
        assert(alpha >= 0 && alpha <= 1);
        assert(alphaDelta >= 0 && alphaDelta <= 1);

        this.active = true;
        this.lifetime = lifetimeFrames * SRC_FRAME_TO_MS;

        this.scaleDelta = scaleDelta;
        this.dstScale = dstScale;
        this.nextScale = scale;
        this.lastScale = scale;

        this.alphaDelta = alphaDelta / SRC_FRAME_TO_MS;
        this.dstAlpha = dstAlpha;
        this.alpha = alpha;

        vec3.copy(this.position, position);
        quat.rotationTo(this.rotation, normal, [0,0,-1]);
        quat.conjugate(this.rotation, this.rotation);


    }

    public override prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.active) {
            return;
        }

        this.lastFrameAdvance += viewerInput.deltaTime;
        this.lifetime -= viewerInput.deltaTime;

        if (this.lifetime <= 0 || (this.dstAlpha == 0 && this.alpha == 0)) {
            this.active = false;
            return;
        }

        if (this.alpha < this.dstAlpha) {
            this.alpha += this.alphaDelta * viewerInput.deltaTime;
        } else if (this.alpha > this.dstAlpha) {
            this.alpha -= this.alphaDelta * viewerInput.deltaTime;
        }

        if (this.lastFrameAdvance >= SRC_FRAME_TO_MS) {
            this.lastFrameAdvance = 0;
            this.lastScale = this.nextScale
            if (0.0 < this.scaleDelta) {
                this.nextScale += (this.dstScale - this.nextScale) * this.scaleDelta;
            } else {
                let scaleMidpoint = (this.dstScale - this.nextScale) / 2;
                if ((scaleMidpoint < -this.scaleDelta && this.scaleDelta > 0) || scaleMidpoint < this.scaleDelta) {
                    if (scaleMidpoint < -this.scaleDelta) {
                        this.nextScale += this.scaleDelta;
                    } else {
                        this.nextScale -= scaleMidpoint;
                    }
                } else {
                    this.nextScale -= this.scaleDelta;
                }
            }
        }

        this.scale = lerp(this.lastScale, this.nextScale, Math.min(1.0, this.lastFrameAdvance/(SRC_FRAME_TO_MS*1.1)));

        mat4.fromRotationTranslationScale(this.drawMatrix,
            this.rotation,
            this.position,
            [this.scale*10, this.scale*10, this.scale*10]
        );

        super.prepareToRender(device, renderInstManager, viewerInput, this.drawMatrix, 0, {r: 1, g: 1, b: 1, a: this.alpha});
    }
}