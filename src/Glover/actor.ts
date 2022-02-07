import * as Viewer from '../viewer';
import * as Textures from './textures';
import * as RDP from '../Common/N64/RDP';
import * as RSP from '../Common/N64/RSP';
import * as F3DEX from '../BanjoKazooie/f3dex';
import * as Shadows from './shadows';
import * as Render from './render';
import * as RDPRenderModes from './rdp_render_modes';

import { assert, assertExists, align, nArray } from "../util";
import { F3DEX_Program } from "../BanjoKazooie/render";
import { mat4, vec3, vec4, ReadonlyVec3 } from "gl-matrix";
import { fillMatrix4x4, fillMatrix4x3, fillMatrix4x2, fillVec3v, fillVec4, fillVec4v } from '../gfx/helpers/UniformBufferHelpers';
import { GfxRenderInstManager, GfxRendererLayer, makeSortKey, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager";
import { GfxDevice, GfxFormat, GfxTexture, GfxSampler, GfxBuffer, GfxBufferUsage, GfxInputLayout, GfxInputState, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxCullMode, GfxCompareMode, GfxMegaStateDescriptor, GfxProgram, GfxBufferFrequencyHint, GfxInputLayoutBufferDescriptor, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { computeViewMatrixSkybox } from '../Camera';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import ArrayBufferSlice from '../ArrayBufferSlice';

import { Color, colorNewFromRGBA, colorNewCopy, White } from "../Color";
import { drawWorldSpaceLine, drawWorldSpacePoint, drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk";

import { GloverObjbank, GloverTexbank } from './parsers';

import { SRC_FRAME_TO_MS } from './timing';

const depthScratch = vec3.create();
const lookatScratch = vec3.create();

interface ActorKeyframeSet {
    scale: number;
    rotation: number;
    translation: number;
}

function keyframeLerp(cur: GloverObjbank.AffineFrame, next: GloverObjbank.AffineFrame, t: number): vec3 {
    let duration = next.t - cur.t
    if (duration == 0) {
        t = 1
    } else {
        t = (t - cur.t) / duration;
    }
    return vec3.fromValues(
        cur.v1*(1-t) + next.v1*t,
        cur.v2*(1-t) + next.v2*t,
        cur.v3*(1-t) + next.v3*t
    );
}

function keyframeSlerp(cur: GloverObjbank.AffineFrame, next: GloverObjbank.AffineFrame, t: number): vec4 {
    let duration = next.t - cur.t
    if (duration == 0) {
        t = 1
    } else {
        t = (t - cur.t) / duration;
    }

    let dot = ((cur.v1 * next.v1) +
           (cur.v2 * next.v2) + 
           (cur.v3 * next.v3) +
           (cur.v4 * next.v4))

    let tmp = vec4.fromValues(next.v1, next.v2, next.v3, next.v4);
    if (dot < 0.0) {
        dot = -dot
        vec4.negate(tmp, tmp);
    }

    if (dot < 0.95) {
        let theta = Math.acos(dot);
        let sin_1minust = Math.sin(theta * (1-t));
        let sin_t = Math.sin(theta * t);
        let sin_theta = Math.sin(theta);
        return vec4.fromValues(
            (cur.v1 * sin_1minust + tmp[0] * sin_t) / sin_theta,
            (cur.v2 * sin_1minust + tmp[1] * sin_t) / sin_theta,
            (cur.v3 * sin_1minust + tmp[2] * sin_t) / sin_theta,
            (cur.v4 * sin_1minust + tmp[3] * sin_t) / sin_theta);
    } else {
        return vec4.fromValues(
            cur.v1*(1-t) + next.v1*t,
            cur.v2*(1-t) + next.v2*t,
            cur.v3*(1-t) + next.v3*t,
            cur.v4*(1-t) + next.v4*t
        )
    }
}

class ActorMeshNode {
    private static rendererCache = new Map<[number, number], GloverMeshRenderer>();

    public renderer: GloverMeshRenderer;

    public children: ActorMeshNode[] = [];

    private keyframeState: ActorKeyframeSet = {scale: 0, rotation: 0, translation: 0};

    constructor(
        device: GfxDevice,
        cache: GfxRenderCache,
        segments: ArrayBufferSlice[],
        textures: Textures.GloverTextureHolder,
        sceneLights: Render.SceneLighting,
        overlay: boolean,
        private actorId: number,
        public mesh: GloverObjbank.Mesh)
    {
        if (ActorMeshNode.rendererCache.get([actorId, mesh.id]) === undefined) {
            this.renderer = new GloverMeshRenderer(device, cache, segments, textures, sceneLights, overlay, mesh);
            ActorMeshNode.rendererCache.set([actorId, mesh.id], this.renderer);
        } else {
            this.renderer = ActorMeshNode.rendererCache.get([actorId, mesh.id])!;
        }

        let current_child = mesh.child;
        while (current_child !== undefined) {
            this.children.push(new ActorMeshNode(device, cache, segments, textures, sceneLights, overlay, actorId, current_child));
            current_child = current_child.sibling;
        }
    }

    public setBackfaceCullingEnabled(enabled: boolean): void {
        this.renderer.setBackfaceCullingEnabled(enabled);
        for (let child of this.children) {
            child.setBackfaceCullingEnabled(enabled);
        }
    }

    public setVertexColorsEnabled(enabled: boolean): void {
        this.renderer.setVertexColorsEnabled(enabled);
        for (let child of this.children) {
            child.setVertexColorsEnabled(enabled);
        }
    }

    public forEachMesh(callback: (node: ActorMeshNode)=>void): void {
        // TODO: provide draw matrix for node
        callback(this);
        for (let child of this.children) {
            child.forEachMesh(callback);
        }
    }

    prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, curAnimTime: number, parentMatrix: mat4, parentScale: vec3 = vec3.fromValues(1,1,1)) {
        const drawMatrix = mat4.clone(parentMatrix);

        if (this.mesh.numRotation > 1 || this.mesh.numTranslation > 1 || this.mesh.numScale > 1) {
            
            const nextKeyframes = {
                scale: Math.min(this.keyframeState.scale + 1, this.mesh.numScale - 1),
                translation: Math.min(this.keyframeState.translation + 1, this.mesh.numTranslation - 1),
                rotation: Math.min(this.keyframeState.rotation + 1, this.mesh.numRotation - 1),
            };
            let startIdx = this.keyframeState.scale;
            while (!(curAnimTime >= this.mesh.scale[this.keyframeState.scale].t && curAnimTime <= this.mesh.scale[nextKeyframes.scale].t)) {
                this.keyframeState.scale += 1;
                if (this.keyframeState.scale >= this.mesh.numScale) {
                    this.keyframeState.scale = 0;
                }
                nextKeyframes.scale = this.keyframeState.scale + 1;
                if (nextKeyframes.scale >= this.mesh.numScale) {
                    nextKeyframes.scale = this.keyframeState.scale;
                }
                if (this.keyframeState.scale == startIdx) {
                    console.error("WARNING: Couldn't find keyframe covering time " + curAnimTime);
                    break;
                }
            }
            startIdx = this.keyframeState.translation;
            while (!(curAnimTime >= this.mesh.translation[this.keyframeState.translation].t && curAnimTime <= this.mesh.translation[nextKeyframes.translation].t)) {
                this.keyframeState.translation += 1;
                if (this.keyframeState.translation >= this.mesh.numTranslation) {
                    this.keyframeState.translation = 0;
                }
                nextKeyframes.translation = this.keyframeState.translation + 1;
                if (nextKeyframes.translation >= this.mesh.numTranslation) {
                    nextKeyframes.translation = this.keyframeState.translation;
                }
                if (this.keyframeState.translation == startIdx) {
                    console.error("WARNING: Couldn't find keyframe covering time " + curAnimTime);
                    break;
                }
            }
            startIdx = this.keyframeState.rotation;
            while (!(curAnimTime >= this.mesh.rotation[this.keyframeState.rotation].t && curAnimTime <= this.mesh.rotation[nextKeyframes.rotation].t)) {
                this.keyframeState.rotation += 1;
                if (this.keyframeState.rotation >= this.mesh.numRotation) {
                    this.keyframeState.rotation = 0;
                }
                nextKeyframes.rotation = this.keyframeState.rotation + 1;
                if (nextKeyframes.rotation >= this.mesh.numRotation) {
                    nextKeyframes.rotation = this.keyframeState.rotation;
                }
                if (this.keyframeState.rotation == startIdx) {
                    console.error("WARNING: Couldn't find keyframe covering time " + curAnimTime);
                    break;
                }
            }
            var scale = keyframeLerp(
                this.mesh.scale[this.keyframeState.scale],
                this.mesh.scale[nextKeyframes.scale],
                curAnimTime);

            var translation = keyframeLerp(
                this.mesh.translation[this.keyframeState.translation],
                this.mesh.translation[nextKeyframes.translation],
                curAnimTime);

            var rotation = keyframeSlerp(
                this.mesh.rotation[this.keyframeState.rotation],
                this.mesh.rotation[nextKeyframes.rotation],
                curAnimTime);

        } else {
            var rotation = vec4.fromValues(this.mesh.rotation[0].v1, this.mesh.rotation[0].v2, this.mesh.rotation[0].v3, this.mesh.rotation[0].v4);
            var translation = vec3.fromValues(this.mesh.translation[0].v1, this.mesh.translation[0].v2, this.mesh.translation[0].v3);
            var scale = vec3.fromValues(this.mesh.scale[0].v1, this.mesh.scale[0].v2, this.mesh.scale[0].v3);
        }

        const rotXlateMatrix = mat4.create();
        mat4.fromQuat(rotXlateMatrix, rotation);
        rotXlateMatrix[12] = translation[0] * parentScale[0];
        rotXlateMatrix[13] = translation[1] * parentScale[1];
        rotXlateMatrix[14] = translation[2] * parentScale[2];

        mat4.mul(drawMatrix, drawMatrix, rotXlateMatrix);

        for (let child of this.children) {
            child.prepareToRender(device, renderInstManager, viewerInput, curAnimTime, drawMatrix, scale);
        }
 
        mat4.scale(drawMatrix, drawMatrix, scale); 

        this.renderer.prepareToRender(device, renderInstManager, viewerInput, drawMatrix);
    }

    public destroy(device: GfxDevice): void {
        if (ActorMeshNode.rendererCache.has([this.actorId, this.renderer.id])) {
            ActorMeshNode.rendererCache.delete([this.actorId, this.renderer.id]);
            this.renderer.destroy(device);
        }
        for (let child of this.children) {
            child.destroy(device);
        }
    }


}

interface QueuedSkeletalAnimation {
    anim: GloverObjbank.AnimationDefinition;
    startPlaying: boolean;
    playbackSpeed: number;
}

export class GloverActorRenderer implements Shadows.Collidable, Shadows.ShadowCaster {


    private vec3Scratch: vec3 = vec3.create();

    // General
    
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    private inputState: GfxInputState;

    public rootMesh: ActorMeshNode;

    // Render state

    private allocateLightingBuffer: boolean;

    public modelMatrix: mat4 = mat4.create();

    public visible: boolean = true;

    public sortKey: number;

    private showDebugInfo: boolean = false;

    public shadow: Shadows.Shadow | null = null;
    public shadowSize: number = 1;

    // Animation state
    
    public isPlaying: boolean = false;

    private currentPlaybackSpeed: number = 0;
    private currentAnim: GloverObjbank.AnimationDefinition | null = null;
    private currentAnimTime: number = 0;
    private animQueue: QueuedSkeletalAnimation[] = [];

    constructor(
        public device: GfxDevice,
        public cache: GfxRenderCache,
        public textures: Textures.GloverTextureHolder,
        public actorObject: GloverObjbank.ObjectRoot,
        public sceneLights: Render.SceneLighting)
    {
        /* Object bank in first segment, then one
           texture bank for each subsequent */
        const segments = textures.textureSegments();
        segments[0] = new ArrayBufferSlice(actorObject._io.buffer);

        this.megaStateFlags = {};

        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });

        const overlay = (this.actorObject.mesh.renderMode & 0x80) != 0;
        const xlu = (this.actorObject.mesh.renderMode & 0x2) != 0;

        this.rootMesh = new ActorMeshNode(device, cache, segments, textures, sceneLights, overlay, actorObject.objId, actorObject.mesh)

        this.allocateLightingBuffer = false;
        this.rootMesh.forEachMesh((node) => {
            if ((node.mesh.renderMode & 0x8) == 0) {
                this.allocateLightingBuffer = true;
            }
        })

        if (overlay) {
            this.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + Render.GloverRendererLayer.OVERLAY);
        } else if (xlu) {
            this.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + Render.GloverRendererLayer.XLU);
        } else {
            this.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + Render.GloverRendererLayer.OPAQUE);
        }
    }

    public playSkeletalAnimation(animIdx: number, startPlaying: boolean, queue: boolean, playbackSpeed: number | null = null) {
        const animDefs = this.actorObject.animation.animationDefinitions;
        const animDef = (animIdx < animDefs.length) ? animDefs[animIdx] : animDefs[0];
        if (playbackSpeed === null) {
            playbackSpeed = animDef.playbackSpeed;
        }
        if (queue) {
            this.animQueue.push({
                anim: animDef,
                startPlaying: startPlaying,
                playbackSpeed: playbackSpeed
            });
        } else {
            this.currentAnim = animDef;
            this.currentPlaybackSpeed = playbackSpeed;
            this.isPlaying = startPlaying;
            this.currentAnimTime = (playbackSpeed >= 0) ? animDef.startTime : 
                                                            animDef.endTime;
        }
    }

    public getPosition(): vec3 {
        mat4.getTranslation(this.vec3Scratch, this.modelMatrix);
        return this.vec3Scratch;
    }

    public getRenderMode() {
        return this.actorObject.mesh.renderMode;
    }

    public setRenderMode(value: number, mask: number = 0xFFFFFFFF) {
        this.actorObject.mesh.renderMode &= ~mask;
        this.actorObject.mesh.renderMode |= value & mask;
    }

    public setBackfaceCullingEnabled(enabled: boolean): void {
        this.rootMesh.setBackfaceCullingEnabled(enabled);
    }

    public setVertexColorsEnabled(enabled: boolean): void {
        this.rootMesh.setVertexColorsEnabled(enabled);        
    }

    public setDebugInfoVisible(enabled: boolean): void {
        this.showDebugInfo = enabled; 
    }

    public isSelf(obj: Object) {
        return obj as GloverActorRenderer === this;
    }

    public collides(rayOrigin: ReadonlyVec3, rayVector: ReadonlyVec3): Shadows.Collision | null {
        let closestIntersection = null;
        let closestFace = null;
        let closestIntersectionDist = Infinity;

        this.rootMesh.forEachMesh((node) => {
            const geo = node.mesh.geometry;
            if (geo === undefined || geo.numFaces === 0) {
                return;
            }
            for (let faceIdx = 0; faceIdx < geo.faces.length; faceIdx++) {
                const face = geo.faces[faceIdx];
                // TODO: don't reallocate every tri
                const v0 = geo.vertices[face.v0];
                const v1 = geo.vertices[face.v1];
                const v2 = geo.vertices[face.v2];
                const triangle = [
                    vec3.fromValues(v0.x, v0.y, v0.z),
                    vec3.fromValues(v1.x, v1.y, v1.z),
                    vec3.fromValues(v2.x, v2.y, v2.z)
                ]
                vec3.transformMat4(triangle[0], triangle[0], this.modelMatrix);
                vec3.transformMat4(triangle[1], triangle[1], this.modelMatrix);
                vec3.transformMat4(triangle[2], triangle[2], this.modelMatrix);
                const intersection = Shadows.rayTriangleIntersection(rayOrigin, rayVector, triangle);
                if (intersection === null) {
                    continue;
                } else {
                    const dist = vec3.dist(intersection, rayOrigin);
                    if (dist < closestIntersectionDist) {
                        closestIntersection = intersection;
                        closestIntersectionDist = dist;
                        closestFace = triangle;
                    }
                }
            }
        });
 
        if (closestIntersection !== null && closestFace !== null) {
            const v1 = vec3.sub(closestFace[1], closestFace[1], closestFace[0]);
            const v2 = vec3.sub(closestFace[2], closestFace[2], closestFace[0]);
            vec3.cross(closestFace[0], v1, v2);
            vec3.normalize(closestFace[0], closestFace[0]);
            return {
                position: closestIntersection
                normal: closestFace[0]
            };
        }
        return null;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.visible !== true) {
            return;
        }

        if (this.currentAnim !== null) {
            if (this.isPlaying) {
                const reversePlay = this.currentPlaybackSpeed < 0;
                this.currentAnimTime += (viewerInput.deltaTime / SRC_FRAME_TO_MS) * this.currentPlaybackSpeed;
                if ((reversePlay && this.currentAnimTime < this.currentAnim.startTime) || 
                    (!reversePlay && this.currentAnimTime > this.currentAnim.endTime)) {
                    if (this.animQueue.length > 0) {
                        const nextAnim = this.animQueue.shift();
                        this.currentAnim = nextAnim!.anim;
                        this.currentPlaybackSpeed = nextAnim!.playbackSpeed;
                        this.isPlaying = nextAnim!.startPlaying;
                    }
                    this.currentAnimTime = reversePlay ? this.currentAnim.endTime : this.currentAnim.startTime;
                }
            }
        }

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(Render.bindingLayouts);
        template.setMegaStateFlags(this.megaStateFlags);

        mat4.getTranslation(depthScratch, viewerInput.camera.worldMatrix);
        mat4.getTranslation(lookatScratch, this.modelMatrix);

        template.sortKey = setSortKeyDepth(this.sortKey, vec3.distance(depthScratch, lookatScratch));

        if (this.showDebugInfo) {
            const txt = this.actorObject.mesh.name.replace(/\0/g, '') + "(0x" + this.actorObject.objId.toString(16) + ")\n" + this.actorObject.mesh.renderMode.toString(16);
            drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, lookatScratch, txt, 0, White, { outline: 6 });
            // TODO: remove
            // drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, lookatScratch, ""+vec3.distance(depthScratch, lookatScratch), 0, White, { outline: 6 });
            // drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, lookatScratch, this.actorObject.mesh.renderMode.toString(2), 0, White, { outline: 6 });
            // drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, lookatScratch, this.actorObject.mesh.name, 0, White, { outline: 6 });
        }


        if (this.allocateLightingBuffer) {
            const n_lights = this.sceneLights.diffuseColor.length;
            const sceneParamsSize = 16 + n_lights * 8 + 4;
            let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, sceneParamsSize);
            const mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
            offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);

            for (let i = 0; i < n_lights; i++) {
                offs += fillVec3v(mappedF32, offs, this.sceneLights.diffuseColor[i]);
            }
            for (let i = 0; i < n_lights; i++) {
                computeViewMatrixSkybox(Render.DrawCallInstance.viewMatrixScratch, viewerInput.camera);
                vec3.transformMat4(this.vec3Scratch, this.sceneLights.diffuseDirection[i], Render.DrawCallInstance.viewMatrixScratch);
                offs += fillVec3v(mappedF32, offs, this.vec3Scratch);
            }
            offs += fillVec3v(mappedF32, offs, this.sceneLights.ambientColor);
        } else {
            const sceneParamsSize = 16;
            let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, sceneParamsSize);
            const mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
            offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);            
        }

        this.rootMesh.prepareToRender(device, renderInstManager, viewerInput, this.currentAnimTime, this.modelMatrix);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.rootMesh.destroy(device);
    }
}


class GloverMeshRenderer {
    public id: number;

    // General rendering attributes
    private rspOutput: Render.GloverRSPOutput | null;
    private vertexColorsEnabled = true;
    private backfaceCullingEnabled = false;
    private drawCallInstances: Render.DrawCallInstance[] = [];

    // UV animation
    private lastRender: number = 0;
    private lastFrameAdvance: number = 0;
    private frameCount: number = 0;
    public conveyorX: number = 0;
    public conveyorZ: number = 0;
    public conveyorScaleX: number = 1;
    public conveyorScaleZ: number = 1;

    // TODO: remove:
    private log: string[] = [];
    private log_dumped = false;

    constructor(
        private device: GfxDevice,
        private cache: GfxRenderCache,
        private segments: ArrayBufferSlice[],
        private textures: Textures.GloverTextureHolder,
        private sceneLights: Render.SceneLighting,
        overlay: boolean,
        public meshData: GloverObjbank.Mesh)
    {
        const buffer = meshData._io.buffer;
        const rspState = new Render.GloverRSPState(segments, textures);
        const xlu = (this.meshData.renderMode & 0x2) != 0;
        const decals = (this.meshData.renderMode & 0x4) != 0;

        this.id = meshData.id;

        Render.initializeRenderState(rspState);

        rspState.gSPSetGeometryMode(F3DEX.RSP_Geometry.G_SHADE | F3DEX.RSP_Geometry.G_SHADING_SMOOTH);
        Render.setRenderMode(rspState, decals, xlu, overlay, meshData.alpha/255);

        if ((this.meshData.renderMode & 0x8) == 0) {
            rspState.gSPSetGeometryMode(F3DEX.RSP_Geometry.G_LIGHTING);
        } else {
            rspState.gSPClearGeometryMode(F3DEX.RSP_Geometry.G_LIGHTING);
        }

        if (xlu) {
            // Make sure we cull back-faces for transparent models, lest
            // we wake up sloppy modeling artifact beasts
            rspState.gSPSetGeometryMode(F3DEX.RSP_Geometry.G_CULL_BACK);
        }
        try {
            if (meshData.displayListPtr != 0) {
                // TODO: incorporate mesh alpha here
                const displayListOffs = meshData.displayListPtr & 0x00FFFFFF;
                rspState.gSPTexture(true, 0, 5, 0.999985 * 0x10000, 0.999985 * 0x10000);

                // Hard-code fixes for broken display lists which expect a
                // texture to be loaded before executing
                let initialTexture: number | null = null;
                if (meshData.id === 0x522ac7b) {
                    initialTexture = 0x6988203b; // monolith in atlantis 3
                } else if (meshData.id === 0x557aedbb) {
                    initialTexture = 0x7845b646; // hydraulic press in ootw 2
                } else if (meshData.id === 0xa6d60dd) {
                    initialTexture = 0xA64446E2; // platform in ootw 2
                }

                if (initialTexture !== null) {
                    rspState.gDPSetOtherModeH(RDP.OtherModeH_Layout.G_MDSFT_TEXTLUT, 2, 0x8000); // G_TT_RGBA16
                    rspState.gDPSetTextureImage(0, 2, 0, initialTexture);
                    rspState.gDPSetTile(0, 2, 0, 256, 7, 0, 0, 6, 0, 0, 6, 0);
                    rspState.gDPLoadTLUT(7, 15);
                    rspState.gDPSetTile(0, 2, 0, 0, 7, 0, 0, 6, 0, 0, 6, 0);
                    rspState.gDPLoadBlock(7, 0, 0, 256, 256);
                }
                F3DEX.runDL_F3DEX(rspState, displayListOffs);
                this.rspOutput = rspState.finish();
            } else if (meshData.geometry.numFaces > 0) {
                rspState.gSPTexture(true, 0, 5, 0.999985 * 0x10000 / 32, 0.999985 * 0x10000 / 32);
                this.rspOutput = this.loadDynamicModel(meshData.geometry, rspState, meshData.alpha/255);
            } else {
                this.rspOutput = null;
            }
        } catch (exc) {
            console.error("Failed to render mesh 0x" + meshData.id.toString(16))
            console.error(exc);
            this.rspOutput = null;
        }

        if (this.rspOutput !== null) {
            for (let drawCall of this.rspOutput.drawCalls) {
                drawCall.renderData = new Render.DrawCallRenderData(device, cache, this.rspOutput.textureCache, this.segments, drawCall);
                this.drawCallInstances.push(new Render.DrawCallInstance(drawCall, this.rspOutput.textureCache, this.sceneLights);)
            }
        }
    }

    private loadDynamicModel(geo: GloverObjbank.Geometry, rspState: Render.GloverRSPState, alpha: number): Render.GloverRSPOutput {
        const drawCalls: Render.DrawCall[] = []
        const uniqueTextures = new Set<number>()
        for (let textureId of geo.textureIds) {
            uniqueTextures.add(textureId);
        }
        for (let textureId of uniqueTextures) {
            // Set up draw call
            const texFile = this.textures.idToTexture.get(textureId);

            if (texFile === undefined) {
                continue;
            }

            let drawCall = rspState._newDrawCall();
            drawCall.dynamicGeometry = true;
            if ((texFile.flags & 4) != 0) {
                drawCall.dynamicTextures.add(texFile.id);
            }

            drawCall.textureIndices.push(Render.loadRspTexture(rspState, this.textures, textureId));

            for (let faceIdx = 0; faceIdx < geo.numFaces; faceIdx++) {
                if (geo.textureIds[faceIdx] != textureId) {
                    continue;
                }
                drawCall.vertices.push(
                    Render.f3dexFromGeometry(geo, faceIdx, 0, alpha),
                    Render.f3dexFromGeometry(geo, faceIdx, 1, alpha),
                    Render.f3dexFromGeometry(geo, faceIdx, 2, alpha)
                );
                // TODO: delete
                // drawCall.originalUVs.push(
                //     drawCall.vertices[drawCall.vertices.length-3].tx,
                //     drawCall.vertices[drawCall.vertices.length-3].ty,
                //     drawCall.vertices[drawCall.vertices.length-2].tx,
                //     drawCall.vertices[drawCall.vertices.length-2].ty,
                //     drawCall.vertices[drawCall.vertices.length-1].tx,
                //     drawCall.vertices[drawCall.vertices.length-1].ty,
                // )
                drawCall.vertexCount += 3;
            }
            drawCalls.push(drawCall)
        }
        return new Render.GloverRSPOutput(drawCalls, rspState.textureCache);
    }

    private animateWaterUVs(frameCount: number) {
        if (this.rspOutput === null || this.meshData.geometry.numFaces === 0) {
            return;
        }
        for (let drawCall of this.rspOutput.drawCalls) {
            if (drawCall.renderData === null) {
                continue;
            }
            for (let vertex of drawCall.vertices) {
                let coordSum = vertex.x + vertex.y + vertex.z;

                vertex.tx += Math.sin((frameCount + coordSum) / 20.0) * 8;

                // In the asm this minus is actually a + ? Audit the asm by hand maybe.
                vertex.ty += Math.sin((frameCount + Math.floor((coordSum - (coordSum < 0 ? 1 : 0)) / 2.0))/ 20.0) * 8;
            }
            // TODO: just patch the UVs in the old buffer, rather
            //       than making a whole new one
            drawCall.renderData.updateBuffers();
        }
    }

    private animateConveyorUVs(): void {
        // TODO: Round edges of conveyors in OoTW3 aren't animating properly
        if (this.rspOutput === null || this.meshData.geometry.numFaces === 0) {
            return;
        }
        for (let drawCall of this.rspOutput.drawCalls) {
            if (drawCall.renderData === null) {
                continue;
            }
            for (let idx = 0; idx < drawCall.vertices.length; idx += 3) {
                const v1 = drawCall.vertices[idx];
                const v2 = drawCall.vertices[idx+1];
                const v3 = drawCall.vertices[idx+2];
                let dS = Math.max(Math.abs(v1.tx - v3.tx), Math.abs(v1.tx - v2.tx));
                let dT = Math.max(Math.abs(v1.ty - v3.ty), Math.abs(v1.ty - v2.ty));
                let dX = Math.max(Math.abs(v1.x - v3.x), Math.abs(v1.x - v2.x));
                let dZ = Math.max(Math.abs(v1.z - v3.z), Math.abs(v1.z - v2.z));
                dX *= this.conveyorScaleX;
                dZ *= this.conveyorScaleZ;
                let shiftZ = -dX;
                if (dZ !== 0) {
                    shiftZ = Math.floor(this.conveyorZ * dS/dZ);
                }
                let shiftX = -dZ;
                if (dX !== 0) {
                    shiftX = Math.floor(this.conveyorX * dT/dX);
                }
                let x_overflow = false;
                let z_overflow = false;
                for (let v of [v1, v2, v3]) {
                    v.tx += shiftZ;
                    v.ty += shiftX;
                    if (v.tx > 0x7ffff || v.tx < -0x7ffff) {
                        x_overflow = true;
                    }
                    if (v.ty > 0x7ffff || v.ty < -0x7ffff) {
                        z_overflow = true;
                    }
                }
                if (x_overflow) {
                    for (let v of [v1, v2, v3]) {
                        v.tx += (shiftZ < 1) ? dS : -dS;
                    }
                }
                if (z_overflow) {
                    for (let v of [v1, v2, v3]) {
                        v.ty += (shiftX < 1) ? dT : -dT;
                    }
                }
            }
            drawCall.renderData.updateBuffers();
        }
    }

    public setBackfaceCullingEnabled(enabled: boolean): void {
        this.backfaceCullingEnabled = enabled;
    }

    public setVertexColorsEnabled(enabled: boolean): void {
        this.vertexColorsEnabled = enabled;        
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, drawMatrix: mat4): void {
        if (viewerInput.time !== this.lastRender) {
            this.lastFrameAdvance += viewerInput.deltaTime;
            if (this.lastFrameAdvance > 50) {
                if ((this.meshData.renderMode & 0x20) !== 0) {
                    this.animateWaterUVs(this.frameCount);
                }
                if (this.conveyorX !== 0 || this.conveyorZ !== 0) {
                    this.animateConveyorUVs();
                }
                this.lastFrameAdvance = 0;
                this.frameCount += 1;
                this.frameCount &= 0xFFFF;
            }
        }
        this.lastRender = viewerInput.time;

        if (this.rspOutput !== null) {
            for (let drawCallIdx = 0; drawCallIdx < this.rspOutput.drawCalls.length; drawCallIdx += 1) {
                const drawCall = this.rspOutput.drawCalls[drawCallIdx];
                const drawCallInstance = this.drawCallInstances[drawCallIdx];

                if (drawCall.dynamicTextures.size > 0) {
                    if (drawCall.lastTextureUpdate < this.textures.lastAnimationTick) {
                        drawCall.lastTextureUpdate = viewerInput.time;
                        drawCall.renderData!.updateTextures();
                    }
                }
                if (this.backfaceCullingEnabled) {
                    drawCallInstance.setBackfaceCullingEnabled(true);
                }
                if (!this.vertexColorsEnabled) {
                    drawCallInstance.setVertexColorsEnabled(false);
                }
                drawCallInstance.prepareToRender(device, renderInstManager, viewerInput, drawMatrix, false);
            }
        }

    }


    public destroy(device: GfxDevice): void {
        if (this.rspOutput !== null) {
            for (let drawCall of this.rspOutput.drawCalls) {
                drawCall.destroy(device);
            }
        }
    }

}


export class GloverBlurRenderer {

    public visible = true;

    // General rendering attributes
    private vertexColorsEnabled = true;
    private backfaceCullingEnabled = false;

    private drawCall: Render.DrawCall;
    private drawCallInstance: Render.DrawCallInstance;

    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    private drawMatrix = mat4.create();

    private lastFrameAdvance: number = 0;

    private sortKey: number;

    private vertexPool: F3DEX.Vertex[] = [];
    private vertexPoolWritePtr = 0;

    private bottomAlpha = 1.0;
    private topAlpha = 0;
    private bottomAlphaDecay = 0x14/0xFF;
    private topAlphaDecay = 0x14/0xFF;


    constructor(
        private device: GfxDevice,
        private cache: GfxRenderCache,
        private textures: Textures.GloverTextureHolder)
    {
        const segments = textures.textureSegments();

        this.megaStateFlags = {};

        this.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + Render.GloverRendererLayer.XLU);

        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });

        const rspState = new Render.GloverRSPState(segments, textures);

        Render.initializeRenderState(rspState);
        // rspState.gSPSetGeometryMode(F3DEX.RSP_Geometry.G_SHADE | F3DEX.RSP_Geometry.G_SHADING_SMOOTH);
        // Render.setRenderMode(rspState, false, true, false, 1.0);
    
        rspState.gSPSetGeometryMode(F3DEX.RSP_Geometry.G_SHADE | F3DEX.RSP_Geometry.G_SHADING_SMOOTH);
        rspState.gSPSetGeometryMode(F3DEX.RSP_Geometry.G_ZBUFFER); // 0xB7000000 0x00000001
        rspState.gDPSetRenderMode(RDPRenderModes.G_RM_ZB_CLD_SURF, RDPRenderModes.G_RM_ZB_CLD_SURF2); // 0xb900031d 0x00504b50
        // rspState.gDPSetRenderMode(RDPRenderModes.G_RM_PASS, RDPRenderModes.G_RM_AA_ZB_XLU_SURF2);
        rspState.gDPSetCombine(0xfcffffff, 0xfffe793c); // G_CC_SHADE, G_CC_SHADE
        rspState.gDPSetPrimColor(0, 0, 0xFF, 0xFF, 0xFF, 0xFF);
        rspState.gSPTexture(false, 0, 0, 0, 0);
    
        rspState.gSPClearGeometryMode(F3DEX.RSP_Geometry.G_LIGHTING);
        rspState.gSPClearGeometryMode(F3DEX.RSP_Geometry.G_CULL_BACK);

        this.drawCall = rspState._newDrawCall();
        this.drawCall.dynamicGeometry = true;

        // const sX = 100;
        // const sY = 100;
        // const sZ = 100;
        // const sW = 100;
        // const sH = 100;
        // const coords = [
        //     [sX, sY + sH, sZ, .5],
        //     [sX, sY, sZ, .5],
        //     [sX + sW, sY + sH, sZ, .5],

        //     [sX, sY, sZ, .5],
        //     [sX + sW, sY, sZ, .5],
        //     [sX + sW, sY + sH, sZ, .4],
        // ];

        // for (let coord of coords) {
        //     const v = new F3DEX.Vertex();
        //     v.x = coord[0];
        //     v.y = coord[1];
        //     v.z = coord[2];
        //     v.tx = 0;
        //     v.ty = 0;
        //     v.c0 = 0xFF;
        //     v.c1 = 0xFF;
        //     v.c2 = 0x00;
        //     v.a = coord[3];
        //     this.drawCall.vertexCount += 1;
        //     this.drawCall.vertices.push(v)
        // }
        for (let x = 0; x < 30*2; x+= 1) {
            let v = new F3DEX.Vertex();
            v.c0 = 0xC8;
            v.c1 = 0xC8;
            v.c2 = 0xC8;
            v.a = ((x & 1) == 0) ? this.bottomAlpha : this.topAlpha;
            this.vertexPool.push(v);
        }


        this.rebuildDrawCallGeometry(true);

        this.drawCall.renderData = new Render.DrawCallRenderData(device, cache, rspState.textureCache, segments, this.drawCall);
        this.drawCallInstance = new Render.DrawCallInstance(this.drawCall, rspState.textureCache, null);
    }

    public pushNewPoint(bottom: vec3, top: vec3) {
        let v = this.vertexPool[this.vertexPoolWritePtr];
        v.x = bottom[0];
        v.y = bottom[1];
        v.z = bottom[2];
        v.a = this.bottomAlpha;

        v = this.vertexPool[this.vertexPoolWritePtr+1];
        v.x = top[0];
        v.y = top[1];
        v.z = top[2];
        v.a = this.topAlpha;

        this.vertexPoolWritePtr = (this.vertexPoolWritePtr + 2) % this.vertexPool.length;

        // TODO: camera offset?
    }

    private decayVertices() {
        for (let idx = 0; idx < this.vertexPool.length; idx += 1) {
            const decay = ((idx & 1) == 0) ? this.bottomAlphaDecay : this.topAlphaDecay;
            const vertex = this.vertexPool[idx];
            if (vertex.a < .008) {
                vertex.a = 0;
            } else{
                if (decay < vertex.a) {
                    vertex.a -= decay;
                } else {
                    vertex.a = .004;
                }
            }
        }
    }

    private rebuildDrawCallGeometry(all: boolean = false) {
        this.drawCall.vertexCount = 0;
        this.drawCall.vertices = [];

        const len = this.vertexPool.length;
        let cursor = (this.vertexPoolWritePtr + 2) % len;
        while (cursor != this.vertexPoolWritePtr) {

            if (!all) {
                if (this.vertexPool[(cursor+2)%len].a < 0.008 &&
                    this.vertexPool[(cursor+3)%len].a < 0.008) {
                    cursor += 2;
                    cursor = cursor % len;
                    continue;
                }
            }

            this.drawCall.vertices.push(this.vertexPool[cursor]);
            this.drawCall.vertices.push(this.vertexPool[(cursor+1)%len]);
            this.drawCall.vertices.push(this.vertexPool[(cursor+2)%len]);

            this.drawCall.vertices.push(this.vertexPool[(cursor+1)%len]);
            this.drawCall.vertices.push(this.vertexPool[(cursor+2)%len]);
            this.drawCall.vertices.push(this.vertexPool[(cursor+3)%len]);

            this.drawCall.vertexCount += 6;

            cursor += 2;
            cursor = cursor % len;
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible) {
            return;
        }

        this.lastFrameAdvance += viewerInput.deltaTime;
        if (this.lastFrameAdvance > 50) {
            this.decayVertices()
            this.rebuildDrawCallGeometry();
            this.drawCall.renderData!.updateBuffers();
            this.lastFrameAdvance = 0;
        }

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(Render.bindingLayouts);
        template.setMegaStateFlags(this.megaStateFlags);

        mat4.getTranslation(depthScratch, viewerInput.camera.worldMatrix);
        mat4.getTranslation(lookatScratch, this.drawMatrix);

        template.sortKey = setSortKeyDepth(this.sortKey, vec3.distance(depthScratch, lookatScratch));

        const sceneParamsSize = 16;
        let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, sceneParamsSize);
        const mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);            

        this.drawCallInstance.prepareToRender(device, renderInstManager, viewerInput, this.drawMatrix);

        renderInstManager.popTemplateRenderInst();

    }


    public destroy(device: GfxDevice): void {
        this.drawCall.destroy(device);
    }

}
