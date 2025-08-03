import * as BIN from "./bin.js";
import * as Viewer from '../viewer.js';
import * as UI from '../ui.js';
import { makeBackbufferDescSimple, makeAttachmentClearDescriptor, standardFullClearRenderPassDescriptor, opaqueBlackFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { fillMatrix4x3, fillMatrix4x4, fillVec3v, fillVec4, fillVec4v } from '../gfx/helpers/UniformBufferHelpers.js';
import { GfxBindingLayoutDescriptor, GfxDevice, GfxTexture } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { SceneContext } from '../SceneBase.js';
import { FakeTextureHolder, TextureMapping } from '../TextureHolder.js';
import { assert, assertExists, hexzero, nArray } from '../util.js';
import { ActorModelData, ActorPartInstance, applyEffect, FFXProgram, FFXToNoclip, findTextureIndex, FullScreenColor, LevelModelData, LevelPartInstance, prevFrameBinding, ShatterParticleInstance, TextureData } from "./render.js";
import { CameraController } from "../Camera.js";
import { mat4, ReadonlyVec3, vec3, vec4 } from "gl-matrix";
import AnimationController from "../AnimationController.js";
import { NamedArrayBufferSlice } from "../DataFetcher.js";
import { activateEffect, ActorResources, charLabel, EventScript, LevelObjectHolder, RenderFlags } from "./script.js";
import { GfxrAttachmentSlot, GfxrRenderTargetDescription, GfxrTemporalTexture } from "../gfx/render/GfxRenderGraph.js";
import { GfxRenderInstList } from "../gfx/render/GfxRenderInstManager.js";
import { LevelParticles, ParticleData, ParticleSystem } from "./particle.js";
import { drawWorldSpaceLine, drawWorldSpacePoint, drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk.js";
import { Vec3UnitX, Vec3UnitY, Vec3UnitZ, clamp, getMatrixTranslation, invlerp, lerp, randomRangeFloat, setMatrixTranslation, transformVec3Mat4w0, transformVec3Mat4w1 } from "../MathHelpers.js";
import { Blue, Color, Cyan, Green, Magenta, OpaqueBlack, Red, White, Yellow, colorNewFromRGBA } from "../Color.js";
import { MagicSceneRenderer } from "./magic.js";
import { DebugDrawFlags } from "../gfx/helpers/DebugDraw.js";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { Actor, FloorMode } from "./actor.js";
import { gfxDeviceNeedsFlipY } from "../gfx/helpers/GfxDeviceHelpers.js";

const pathBase = `FinalFantasyX`;
interface Destroyable {
    destroy(device: GfxDevice): void;
}

const mapScratch = nArray(3, () => vec3.create());

type mapMode = "Off" | "On" | "Collision" | "Battle" | "Lighting";
function mapColor(dst: Color, mode: mapMode, tri: BIN.MapTri): boolean {
    dst.r = 1;
    dst.g = 1;
    dst.b = 1;
    if (mode === "Collision") {
        const val = tri.passability;
        if (val === 1) { // totally blocked
            dst.r = 1;
            dst.g = .3;
            dst.b = .3;
            return true;
        } else if (val === 0xE) { // blocked for player
            dst.r = .2;
            dst.g = 1;
            dst.b = 1;
            return true;
        } else if (val >= 0x30) { // controlled by script
            dst.r = 1;
            dst.g = .2;
            dst.b = 1;
            return true;
        }
    } else if (mode === "Battle") {
        const val = tri.encounter;
        if (val === 1) { // totally blocked
            dst.r = 1;
            dst.g = .5;
            dst.b = .5;
            return true;
        } else if (val === 2) { // blocked for player
            dst.r = .5;
            dst.g = 1;
            dst.b = .5;
            return true;
        } else if (val === 3) { // controlled by script
            dst.r = .5;
            dst.g = .5;
            dst.b = 1;
            return true;
        }
    }
    return mode === "Lighting";
}

interface PieceState{
    start: number;
    angles: vec3;
    speeds: vec3;
}

function randomWithMinFrac(range: number, minFrac: number): number {
    return (Math.random() > .5 ? 1 : -1) * range * lerp(minFrac, 1, Math.random());
}

interface ShatterTracker {
    pieces: PieceState[];
    startT: number;
    dir: number;
    savedCamera: mat4;
    didCamera: boolean;
    lightPos: vec4[];
    lightColor: vec4[];
    map: number;
    enc: number;
    startedLoad: boolean;
    visibleShardCount: number;
}

const ShatterMatrix = mat4.create();
mat4.fromXRotation(ShatterMatrix, -Math.PI/2);
ShatterMatrix[6] /= 50;

interface BattleState {
    idleCounters: number[];
    monsters: Actor[];
    startTime: number;
    encounter: BIN.EncounterData;
}

let inc = 0
const levelBindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 2, numSamplers: 1 }];
const scr = vec3.create();
const scr2 = vec3.create();
const centerScratch = vec3.create();
const colorScratch = vec4.create();
const triScratch = nArray(3, () => vec3.create());
const mtxScr = mat4.create();
const innerMtx = mat4.create();

export class FFXRenderer implements Viewer.SceneGfx {
    private renderInstListMain = new GfxRenderInstList();
    private renderInstListShatter = new GfxRenderInstList();
    public textureHolder = new FakeTextureHolder([]);
    private sceneTexture = new GfxrTemporalTexture();
    private prevFrameMapping = new TextureMapping();

    public textureRemaps: GfxTexture[] = [];

    public lightDirection = mat4.create();
    public envMapDirection = mat4.create();
    public clearPass = standardFullClearRenderPassDescriptor;
    public encounter: BIN.EncounterData | null = null;
    public battleState: BattleState | null = null;

    private animationController = new AnimationController(60);
    public script: EventScript | null = null;

    private mapMode: mapMode = "Off";
    private showTriggers = false;
    public debug = false;
    public shatter: ShatterTracker = {
        pieces: nArray(106, () => ({start: -1, angles: vec3.create(), speeds: vec3.create()})),
        startT: -1,
        dir: 1,
        didCamera: false,
        savedCamera: mat4.create(),
        lightColor: [
            vec4.fromValues(2, 2, 2, 2),
            vec4.fromValues(3, 3, 2, 2),
        ],
        lightPos: nArray(2, ()=>vec4.create()),
        map: -1,
        enc: -1,
        startedLoad: false,
        visibleShardCount: 1,
    };
    private subScene: FFXRenderer | null = null;

    constructor(public renderHelper: GfxRenderHelper, public levelObjects: LevelObjectHolder, public textureData: TextureData[], public modelData: Destroyable[], private shared: FFXShared) {
        for (let tex of textureData)
            this.textureHolder.viewerTextures.push(tex.viewerTexture);
        this.textureHolder.viewerTextures.sort((a, b) => a.name.localeCompare(b.name));
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(.03);
    }

    public getDefaultWorldMatrix(dst: mat4): void {
        mat4.identity(dst);
        dst[13] = 20;
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        this.renderHelper.debugDraw.beginFrame(viewerInput.camera.projectionMatrix, viewerInput.camera.viewMatrix, viewerInput.backbufferHeight, viewerInput.backbufferHeight);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        let mainColorDesc: GfxrRenderTargetDescription;
        let mainDepthDesc: GfxrRenderTargetDescription;
        mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, this.clearPass);
        mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, this.clearPass);

        if (this.shatter.startT < 0) {
            this.sceneTexture.setDescription(device, mainColorDesc);
        }

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.prevFrameMapping.gfxTexture = this.sceneTexture.getTextureForSampling();
                this.renderInstListMain.resolveLateSamplerBinding(prevFrameBinding, this.prevFrameMapping);
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        builder.pushPass((pass) => {
            pass.setDebugName('Shatter');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const shatterDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Shatter Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, shatterDepthTargetID);
            pass.exec((passRenderer) => {
                this.prevFrameMapping.gfxTexture = this.sceneTexture.getTextureForSampling();
                this.renderInstListShatter.resolveLateSamplerBinding(prevFrameBinding, this.prevFrameMapping);
                this.renderInstListShatter.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.debugDraw.pushPasses(builder, mainColorTargetID, mainDepthTargetID);
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        if (this.shatter.startT < 0) {
            builder.pushPass((pass) => {
                pass.setDebugName('copy to temporal texture');
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            });
            builder.resolveRenderTargetToExternalTexture(mainColorTargetID, this.sceneTexture.getTextureForResolving());
        }

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
    }

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        if (this.subScene) {
            this.subScene.levelObjects.renderFlags.textures = this.levelObjects.renderFlags.textures;
            this.subScene.levelObjects.renderFlags.wireframe = this.levelObjects.renderFlags.wireframe;
            this.subScene.levelObjects.renderFlags.vertexColors = this.levelObjects.renderFlags.vertexColors;
        }

        if (this.shatter.startT >= 0) {
            if (this.subScene)
                this.subScene.prepareToRenderExplicit(device, viewerInput, this.renderHelper);
            else if (this.shatter.map < 0)
                this.prepareToRenderExplicit(device, viewerInput, this.renderHelper);
            this.renderShatter(viewerInput);
        } else {
            this.prepareToRenderExplicit(device, viewerInput, this.renderHelper);
        }
        if (this.levelObjects.context.inputManager.isKeyDownEventTriggered('KeyF')) {
            if (this.shatter.startT < 0) {
                this.initShatter(viewerInput);
            } else {
                this.shatter.startT = -1;
                mat4.copy(viewerInput.camera.worldMatrix, this.shatter.savedCamera);
                viewerInput.camera.worldMatrixUpdated();
            }
        }

        this.renderHelper.prepareToRender();
    }

    public prepareToRenderExplicit(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput, renderHelper: GfxRenderHelper): void {
        this.animationController.setTimeFromViewerInput(viewerInput);
        // this.levelObjects.particles.debug = this.debug;
        getMatrixTranslation(this.levelObjects.cameraPos, viewerInput.camera.worldMatrix);
        this.levelObjects.cameraPos[1] *= -1;
        this.levelObjects.cameraPos[2] *= -1;
        this.levelObjects.t = viewerInput.time * 30 / 1000;

        const dt = Math.min(viewerInput.deltaTime * 30 / 1000, 1);
        if (this.script) {
            for (let i = 0; i < this.levelObjects.edges.length; i++)
                this.levelObjects.edges[i].update(this.script, viewerInput);
            this.script.update(dt);
        }

        for (let i = 0; i < this.levelObjects.buttons.length; i++)
            this.levelObjects.buttons[i].update(this.levelObjects, viewerInput);

        const template = renderHelper.pushTemplateRenderInst();
        if (this.levelObjects.renderFlags.wireframe)
            template.setMegaStateFlags({wireframe: true});
        template.setBindingLayouts(levelBindingLayouts);
        if (this.levelObjects.renderFlags.wireframe)
            template.setMegaStateFlags({wireframe: true});
        let offs = template.allocateUniformBuffer(FFXProgram.ub_SceneParams, 16 + 2*12 + 2*4);
        const sceneParamsMapped = template.mapUniformBufferF32(FFXProgram.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);
        mat4.mul(mtxScr, this.levelObjects.lightDirs, FFXToNoclip);
        mat4.mul(mtxScr, mtxScr, viewerInput.camera.worldMatrix);
        offs += fillMatrix4x3(sceneParamsMapped, offs, mtxScr);
        offs += fillMatrix4x3(sceneParamsMapped, offs, this.levelObjects.lightColors);
        offs += fillVec3v(sceneParamsMapped, offs, this.levelObjects.fog.color, this.levelObjects.fog.opacity/255, );
        // the game doesn't really use the "near" value, though it's passed to the VU shader
        // 10 is because these distances are specified in level-geometry coordinates
        const fogFalloff = 1/(this.levelObjects.fog.far - this.levelObjects.fog.near)/10;
        let hackFlags = 0;
        if (this.levelObjects.renderFlags.vertexColors)
            hackFlags |= 1;
        if (this.levelObjects.renderFlags.textures)
            hackFlags |= 2;
        offs += fillVec4(sceneParamsMapped, offs, viewerInput.backbufferWidth, viewerInput.backbufferHeight, fogFalloff, hackFlags);

        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListMain);
        for (let i = 0; i < this.levelObjects.activeEffects.length; i++) {
            const effect = this.levelObjects.activeEffects[i];
            if (!effect.active)
                continue;
            const part = this.levelObjects.parts[effect.partIndex];
            if (effect.startFrame < 0)
                effect.startFrame = this.animationController.getTimeInFrames();
            applyEffect(
                part.modelMatrix,
                part.effectParams,
                part.part.position,
                this.animationController.getTimeInFrames() - effect.startFrame,
                this.levelObjects.effectData[effect.effectIndex],
                part.part.eulerOrder,
                effect.runOnce,
            );
        }

        const anims = this.levelObjects.animatedTextures;
        for (let i = 0; i < anims.length; i++) {
            if (!anims[i].active)
                continue;
            const effect = anims[i].effect;
            const currIndex = effect? findTextureIndex(this.animationController.getTimeInFrames(), effect) : anims[i].explicitIndex;
            const baseIndex = anims[i].textureIndices[0];
            const newIndex = anims[i].textureIndices[currIndex];
            this.textureRemaps[baseIndex] = this.textureData[newIndex].gfxTexture;
        }

        for (let i = 0; i < this.levelObjects.parts.length; i++)
            this.levelObjects.parts[i].prepareToRender(renderHelper.renderInstManager, viewerInput, this.envMapDirection, this.textureRemaps);

        for (let i = 0; i < this.levelObjects.actors.length; i++) {
            this.levelObjects.actors[i]?.render(device, this.levelObjects, dt, renderHelper.renderInstManager, viewerInput);
        }

        if (this.battleState) {
            this.battleUpdate(viewerInput, this.battleState, this.levelObjects);
            for (let i = 0; i < this.battleState.monsters.length; i++) {
                this.battleState.monsters[i].render(device, this.levelObjects, dt, renderHelper.renderInstManager, viewerInput);
            }
        }
        this.levelObjects.shadows.endFrame(device, renderHelper.renderInstManager, this.levelObjects.actorsAfterXLU);

        if (this.levelObjects.renderFlags.showParticles) {
            const debugParticles = this.levelObjects.renderFlags.debugParticles;
            this.levelObjects.particles.debug = debugParticles;
            this.levelObjects.particles.update(device, this.levelObjects, viewerInput, renderHelper.renderInstManager);

            for (let i = 0; i < this.levelObjects.magic.length; i++) {
                this.levelObjects.magic[i].debug = debugParticles;
                this.levelObjects.magic[i].update(device, this.levelObjects, viewerInput, renderHelper.renderInstManager);
            }
        }

        if (this.mapMode !== "Off" && this.levelObjects.map) {
            const vv = this.levelObjects.map.vertices;
            const tt = this.levelObjects.map.tris;
            const col = colorNewFromRGBA(1, 1, 1, 1);
            const opts: { flags: DebugDrawFlags; } = { flags: DebugDrawFlags.DepthTint };
            renderHelper.debugDraw.beginBatchLine(3 * tt.length);
            for (let i = 0; i < tt.length; i++) {
                const tri = tt[i];
                for (let j = 0; j < 3; j++) {
                    vec3.set(mapScratch[j], vv[4*tri.vertices[j] + 0], -vv[4*tri.vertices[j] + 1], -vv[4*tri.vertices[j] + 2]);
                    vec3.scale(mapScratch[j], mapScratch[j], 1 / this.levelObjects.map.scale);
                    mapScratch[j][1] += .1; // poor man's polygon offset
                }

                // carefully draw every edge once
                mapColor(col, this.mapMode, tri);
                for (let j = 0; j < 3; j++) {
                    const k = (j + 1) % 3;
                    if (tri.edges[j] < 0 || tri.vertices[j] < tri.vertices[k])
                        renderHelper.debugDraw.drawLine(mapScratch[j], mapScratch[k], col, col, opts);
                }
            }
            renderHelper.debugDraw.endBatch();
            col.a = .5;
            for (let i = 0; i < tt.length; i++) {
                const tri = tt[i];
                if (mapColor(col, this.mapMode, tri)) {
                    for (let j = 0; j < 3; j++) {
                        vec3.set(mapScratch[j], vv[4*tri.vertices[j] + 0], -vv[4*tri.vertices[j] + 1], -vv[4*tri.vertices[j] + 2]);
                        vec3.scale(mapScratch[j], mapScratch[j], 1/this.levelObjects.map.scale);
                        mapScratch[j][1] += .5; // poor man's polygon offset
                    }
                    renderHelper.debugDraw.drawTriSolidP(mapScratch[0], mapScratch[1], mapScratch[2], col);
                }
            }
        }

        if (this.script && (this.showTriggers || this.debug)) {
            const ctx = getDebugOverlayCanvas2D();
            const mtx = viewerInput.camera.clipFromWorldMatrix;
            for (let i = 0; i < this.script.workers.length; i++) {
                const c = this.script.workers[i];
                const a = this.levelObjects.actors[i];
                transformVec3Mat4w1(mapScratch[0], FFXToNoclip, c.position.pos);
                if (a && this.debug) {
                    getMatrixTranslation(scr, a.modelMatrix)
                    transformVec3Mat4w1(scr, FFXToNoclip, scr);
                    drawWorldSpacePoint(ctx, mtx, scr, Green);
                    drawWorldSpaceText(ctx, mtx, scr, `${charLabel(c.puppetID || 0)} (w${hexzero(i, 2)})`, 60 + (c.puppetID % 10)*5);
                    if (this.levelObjects.map && (a as any).special) {
                        const vv = this.levelObjects.map.vertices;
                        const tt = this.levelObjects.map.tris;
                        for (let idx of a.visitedTris) {
                            const tri = tt[idx];
                            for (let j = 0; j < 3; j++) {
                                vec3.set(mapScratch[j], vv[4*tri.vertices[j] + 0], -vv[4*tri.vertices[j] + 1], -vv[4*tri.vertices[j] + 2]);
                                vec3.scale(mapScratch[j], mapScratch[j], 1/this.levelObjects.map.scale);
                                mapScratch[j][1] += .5; // poor man's polygon offset
                            }
                            for (let j = 0; j < 3; j++) {
                                const k = (j + 1) % 3;
                                renderHelper.debugDraw.drawLine(mapScratch[j], mapScratch[k], White);
                            }
                            if (idx === a.groundTri)
                                renderHelper.debugDraw.drawTriSolidP(mapScratch[0], mapScratch[1], mapScratch[2], Green);

                        }
                    }
                } else {
                    switch (c.spec.type) {
                        case BIN.WorkerType.EDGE:
                        case BIN.WorkerType.PLAYER_EDGE:
                            transformVec3Mat4w1(mapScratch[1], FFXToNoclip, c.position.miscVec);
                            renderHelper.debugDraw.drawLine(mapScratch[0], mapScratch[1], Magenta);
                            if (this.debug) {
                                const ctx = getDebugOverlayCanvas2D();
                                vec3.lerp(mapScratch[0], mapScratch[0], mapScratch[1], .5);
                                drawWorldSpaceText(ctx, viewerInput.camera.clipFromWorldMatrix, mapScratch[0], `w${hexzero(i, 2)}`, 15*((i % 2) - .5), Magenta);
                            }
                            break;
                        case BIN.WorkerType.ZONE:
                        case BIN.WorkerType.PLAYER_ZONE:
                            renderHelper.debugDraw.drawRectLineRU(mapScratch[0], Vec3UnitX, Vec3UnitZ,
                                c.position.miscVec[0], c.position.miscVec[2], Cyan);
                            if (this.debug) {
                                const ctx = getDebugOverlayCanvas2D();
                                mapScratch[0][0] += c.position.miscVec[0];
                                mapScratch[0][2] += c.position.miscVec[2];
                                drawWorldSpaceText(ctx, viewerInput.camera.clipFromWorldMatrix, mapScratch[0], `w${hexzero(i, 2)}`, 0, Cyan);
                            }
                            break;
                        default:
                            if (this.debug) {
                                drawWorldSpacePoint(ctx, mtx, mapScratch[0], Green);
                                drawWorldSpaceText(ctx, mtx, mapScratch[0], `(w${hexzero(i, 2)})`, 15*((i % 5) - 2));
                            }
                    }
                }
            }
        }

        const ctx = getDebugOverlayCanvas2D();
        const mtx = viewerInput.camera.clipFromWorldMatrix;
        if (this.debug) {

            for (let i = 0; i < this.levelObjects.particles.emitters.length; i++) {
                const e = this.levelObjects.particles.emitters[i];
                getMatrixTranslation(scr, e.pose);
                transformVec3Mat4w1(scr, FFXToNoclip, scr);
                drawWorldSpacePoint(ctx, mtx, scr, e.waitTimer < -1000 ? Red : Blue);
                drawWorldSpaceText(ctx, mtx, scr, `${i} ${e.spec.id} (${e.spec.behavior}) x${e.behavior.programs.length}`, 30);
                // mat4.mul(mtxScr, FFXToNoclip, e.pose);
                // drawWorldSpaceBasis(ctx, mtx, mtxScr, 2)
            }

            if (this.script?.eventData) {
                for (let i = 0; i < this.script.eventData.mapPoints.length; i++) {
                    const p = this.script.eventData.mapPoints[i];
                    transformVec3Mat4w1(scr, FFXToNoclip, p.pos);
                    drawWorldSpacePoint(ctx, mtx, scr, Green);
                    vec3.set(scr2, Math.cos(p.heading), 0, -Math.sin(p.heading)); // yay handedness
                    vec3.scaleAndAdd(scr2, scr, scr2, 2);
                    drawWorldSpaceLine(ctx, mtx, scr, scr2, Green);
                    drawWorldSpaceText(ctx, mtx, scr, `pt[${i}]=${p.entrypoint}`, 30);
                }
            }

        }
        if (this.battleState?.encounter && this.debug) {
            const drawPos = (pts: vec3[], color: Color) => {
                for (let i = 0; i < pts.length; i++) {
                    transformVec3Mat4w1(scr, FFXToNoclip, pts[i]);
                    scr[1] += .1
                    renderHelper.debugDraw.drawDiscSolidN(scr, Vec3UnitY, 2, color);
                    if (i < pts.length - 1) {
                        transformVec3Mat4w1(scr2, FFXToNoclip, pts[i+1]);
                        renderHelper.debugDraw.drawLine(scr, scr2, color);
                    }
                }

            }
            for (let area of this.battleState.encounter.battlePositions) {
                drawPos(area.party, Green);
                drawPos(area.monsters, Red);
                drawPos(area.other, White);
            }
        }

        if (this.script?.data.name === "bltz0000" && this.debug) {
            const pts = assertExists(this.script.data.arrays[0x128].values);
            // for (let block = 0; block < pts.length; block += 21*5)
            const block =this.script.data.arrays[0xa8].values![0]*21*5
                for (let k = 0; k < 5; k++) {
                    const col = [Red, Yellow, Green, Blue, White, OpaqueBlack, Magenta, Cyan ][k]
                    for (let j = 0; j < 21; j+= 3) {
                        const i = block + k*21 + j;
                        vec3.set(scr, pts[i+1], -pts[i+2], -pts[i]);
                        renderHelper.debugDraw.drawDiscSolidN(scr, Vec3UnitY, 2*j/21+1, col);
                        if (j > 0) {
                            vec3.set(scr2, pts[i-2], -pts[i-1], -pts[i-3]);
                            renderHelper.debugDraw.drawLine(scr, scr2, col);
                        }
                    }
                }

            const more = assertExists(this.script.data.arrays[0x127].values);
            for (let block of [0, 1 << 11]) {
                for (let sub = 0; sub < 8; sub++) {
                    for (let k = 0; k < 6; k++) {
                        const i = block + (sub << 8) + k*3;
                        vec3.set(scr, more[i], -more[i+2], -more[i+1]);
                        renderHelper.debugDraw.drawDiscSolidN(scr, Vec3UnitY, 2, Red);
                    }
                }
            }

        }

        this.levelObjects.bufferManager.postRender(device);
        renderHelper.renderInstManager.popTemplate();
    }

    private initShatter(viewerInput: Viewer.ViewerRenderInput): void {
        if (this.selectEncounter(viewerInput)) {
            this.encounter = null;
            // clear out subscene if this is a new map
            const needsMap = this.shatter.map >= 0;
            this.battleState = null;
            if (needsMap && this.subScene && this.subScene.levelObjects.mapID !== (this.shatter.map & 0xFF)) {
                this.subScene.levelObjects.actorResources = new Map(); // this is shared with the main scene, so don't destroy it
                this.subScene.destroy(this.levelObjects.cache.device);
                this.subScene = null;
            } else if (this.subScene?.battleState) {
                for (let m of this.subScene.battleState?.monsters)
                    m.destroy(this.levelObjects.cache.device);
                this.subScene.battleState = null;
            }
            this.shatter.startedLoad = false;
            this.shatter.startT = viewerInput.time * 30 / 1000;
            this.shatter.dir = Math.random() > .5 ? 1 : -1;
            this.shatter.visibleShardCount = this.shatter.pieces.length;
            for (let piece of this.shatter.pieces) {
                piece.start = -1;
                piece.angles[0] = randomWithMinFrac(16, .5);
                piece.angles[1] = randomWithMinFrac(16, .5);
                piece.angles[2] = randomWithMinFrac(16, .5);
                piece.speeds[0] = -48*this.shatter.dir + randomRangeFloat(16);
                piece.speeds[1] = -512 + randomRangeFloat(128);
                piece.speeds[2] = randomRangeFloat(64);
                // in the game, the pieces actually cover more than the screen, so speed up a little
                // vec3.scale(piece.speeds, piece.speeds, 1.2);
            }
            this.shatter.didCamera = false;
            mat4.copy(this.shatter.savedCamera, viewerInput.camera.worldMatrix);

            vec4.set(this.shatter.lightPos[0], 0, -256, 0, 320);
            vec4.set(this.shatter.lightPos[1], 128, -16, 0, 256);
            this.shatter.lightPos[1][2] += randomRangeFloat(256);
        }
    }

    private renderShatter(viewerInput: Viewer.ViewerRenderInput): void {
        if (this.shatter.visibleShardCount === 0)
            return;

        // top right is (15744, 12800)
        const toClip = 1/12800;
        const aspectRatio = 12800/15744;

        const g = this.shared.shatterPieces;
        let t = (viewerInput.time*30/1000) - this.shatter.startT;

        const DISTORT_LENGTH = 11;
        const distortT = clamp(t, 0, DISTORT_LENGTH);
        const distort = distortT * 64 - (distortT ** 2)*3;
        const needsMap = this.shatter.map >= 0 && !this.subScene;

        if (t > DISTORT_LENGTH && (!this.shatter.startedLoad || needsMap || !this.encounter)) {
            // init loads here to avoid stutter during shatter
            if (!this.shatter.startedLoad) {
                this.shatter.startedLoad = true;
                let mapPromise = Promise.resolve<Viewer.SceneGfx | null>(null);
                if (needsMap) {
                    mapPromise = FFXLevelSceneDesc.BattleScene(this.shatter.map, '').
                        createScene(this.levelObjects.cache.device, this.levelObjects.context);
                }
                const battlePromise = this.loadAndSetupEncounter(this.shatter.enc);
                Promise.all([mapPromise, battlePromise]).then(([map, battle]) => {
                    const scene = map as FFXRenderer;
                    if (scene) {
                        if (this.shatter.map !== scene.levelObjects.mapID) {
                            scene.destroy(this.levelObjects.cache.device);
                            return; // something changed out from under us
                        }
                        scene.levelObjects.renderFlags = this.levelObjects.renderFlags;
                        scene.levelObjects.actorResources = this.levelObjects.actorResources;
                        this.subScene = scene;
                    }
                    if (this.shatter.map >= 0) {
                        const old = this.subScene!.battleState;
                        if (old) {
                            for (let m of old.monsters)
                                m.destroy(this.levelObjects.cache.device);
                        }
                        this.subScene!.battleState = battle;
                        const script = new EventScript(battle.encounter.script, this.subScene!.levelObjects);
                        script.update(0);
                    } else {
                        this.battleState = battle;
                    }
                    this.encounter = battle.encounter;
                });
            }
            this.shatter.startT += t - DISTORT_LENGTH;
            t = DISTORT_LENGTH;
        }
        let envMapStrength = 1;
        if (distortT > 4)
            envMapStrength = 1 - .75*invlerp(4, DISTORT_LENGTH, distortT);

        this.shatter.lightPos[0][3] = 320 - 196*distortT/DISTORT_LENGTH;

        this.renderHelper.renderInstManager.setCurrentList(this.renderInstListShatter);
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(levelBindingLayouts);
        let offs = template.allocateUniformBuffer(FFXProgram.ub_SceneParams, 16 + 4*5);
        const sceneParamsMapped = template.mapUniformBufferF32(FFXProgram.ub_SceneParams);
        mat4.identity(mtxScr);
        offs += fillMatrix4x4(sceneParamsMapped, offs, mtxScr);
        offs += fillVec4v(sceneParamsMapped, offs, this.shatter.lightPos[0]);
        offs += fillVec4v(sceneParamsMapped, offs, this.shatter.lightPos[1]);
        offs += fillVec4v(sceneParamsMapped, offs, this.shatter.lightColor[0]);
        offs += fillVec4v(sceneParamsMapped, offs, this.shatter.lightColor[1]);
        offs += fillVec4(sceneParamsMapped, offs, 1, envMapStrength);

        const sweepT = clamp(t - DISTORT_LENGTH, 0, 120);
        const cutoff = this.shatter.dir * 15000*1.2 * (sweepT / 32 - 1);
        if (sweepT > 30 && !this.shatter.didCamera) {
            const battle = assertExists(this.battleState || this.subScene?.battleState);
            if (battle.startTime < 0) {
                battle.startTime = viewerInput.time;
            }
            vec3.zero(scr);
            vec3.zero(scr2);
            const enc = assertExists(this.encounter);
            const mCount = Math.min(enc.monsters.length, enc.battlePositions[0].monsters.length);
            for (let i = 0; i < mCount; i++) {
                vec3.add(scr, scr, enc.battlePositions[0].monsters[i]);
            }
            vec3.scale(scr, scr, 1 / mCount);
            for (let i = 0; i < enc.battlePositions[0].party.length; i++) {
                vec3.add(scr2, scr2, enc.battlePositions[0].party[i]);
            }
            vec3.scale(scr2, scr2, 1 / enc.battlePositions[0].party.length);

            vec3.sub(scr2, scr2, scr);
            vec3.scaleAndAdd(scr2, scr, scr2, 1.5);
            transformVec3Mat4w0(scr, FFXToNoclip, scr);
            transformVec3Mat4w0(scr2, FFXToNoclip, scr2);
            scr2[1] += 30;
            mat4.targetTo(viewerInput.camera.worldMatrix, scr2, scr, Vec3UnitY);
            viewerInput.camera.worldMatrixUpdated();
            this.shatter.didCamera = true;
        }

        if (sweepT < 70) {
            vec4.set(colorScratch, 0, 0, 0, 1 - invlerp(50, 65, clamp(sweepT, 50, 65)));
            this.shared.fullscreenRenderer.render(this.renderHelper.renderInstManager, colorScratch);
        }
        this.shatter.visibleShardCount = 0;
        for (let i = 0; i < this.shatter.pieces.length; i++) {
            const piece = this.shatter.pieces[i];
            const geo = g[i];
            vec3.copy(centerScratch, geo.geo.geometry!.center);
            if (piece.start < 0 && this.shatter.dir * (centerScratch[0] - cutoff) < 0) {
                piece.start = t;
            }
            const dur = piece.start > 0 ? t - piece.start : 0;
            vec3.scale(scr2, centerScratch, (1 + distort/0x1000));
            scr2[0] += piece.speeds[0] * (dur**2)/2;
            scr2[1] += piece.speeds[1] * dur;
            scr2[2] += piece.speeds[2] * dur;
            if (Math.abs(scr2[0]) > 20000) {
                continue;
            } else {
                this.shatter.visibleShardCount++;
            }
            vec3.scale(scr2, scr2, toClip);
            scr2[0] *= aspectRatio;

            // the vertex coordinates correspond to the "jigsaw" position,
            // so we need to make sure we rotate around the piece's actual center
            vec3.set(scr, toClip * aspectRatio, toClip, toClip);
            mat4.fromScaling(mtxScr, scr);
            vec3.scale(scr, piece.angles, (distort/64 + dur*4) * Math.PI / 0x800);
            mat4.fromZRotation(innerMtx, scr[2]);
            mat4.rotateX(innerMtx, innerMtx, scr[0]);
            mat4.rotateY(innerMtx, innerMtx, scr[1]);
            mat4.mul(mtxScr, mtxScr, innerMtx);
            vec3.set(scr, 1, .5, 1); // make pieces thinner
            mat4.scale(mtxScr, mtxScr, scr);
            transformVec3Mat4w0(scr, mtxScr, centerScratch);
            vec3.sub(scr2, scr2, scr);
            setMatrixTranslation(mtxScr, scr2);
            mat4.mul(mtxScr, ShatterMatrix, mtxScr);
            transformVec3Mat4w0(centerScratch, innerMtx, centerScratch);
            vec3.scale(centerScratch, centerScratch, -1);
            setMatrixTranslation(innerMtx, centerScratch);

            geo.prepareToRender(this.renderHelper.renderInstManager, mtxScr, innerMtx);
        }
        this.renderHelper.renderInstManager.popTemplate();
    }

    private battleUpdate(viewerInput: Viewer.ViewerRenderInput, state: BattleState, objects: LevelObjectHolder): void {
        if (state.startTime < 0)
            return;
        const t = (viewerInput.time - state.startTime)/1000;
        if (t < 1)
            return;
        for (let i = 0; i < state.monsters.length; i++) {
            if (t < 1 + i) {
                continue;
            }
            const m = state.monsters[i];
            if (!m.visible) {
                m.visible = true;
                m.animation.setFromList(objects, 1, 8);
                state.idleCounters[i] = randomRangeFloat(0, 4) | 0;
            }
            if (!m.animation.running) {
                m.animation.defaultLoops = 1;
                m.animation.nextTransition = -1;
                if (state.idleCounters[i] === 0) {
                    m.animation.setFromList(objects, 1, 0x11);
                    state.idleCounters[i] = randomRangeFloat(0, 4) | 0;
                } else {
                    m.animation.setFromList(objects, 1, 0x10); // can technically be overwritten
                    state.idleCounters[i]--;
                }
                m.animation.isLoopLike = true;
            }
        }
    }

    public async loadAndParseActorModel(id: number): Promise<void> {
        const existing = this.levelObjects.ensureActorResource(id);
        if (existing.fetched & 1)
            return;
        const modelFile = await loadActorFile(this.levelObjects.context, this.levelObjects.mapID, id, 0);
        if (!modelFile || modelFile.arrayBuffer.byteLength === 0) {
            existing.fetched |= 1;
            return;
        }
        const actorTextures: BIN.Texture[] = [];
        const model = BIN.parseActorGeometry(actorName(id), modelFile, actorTextures, this.levelObjects.particleTex);
        const modelTexData: TextureData[] = [];
        for (let tex of actorTextures) {
            const texData = new TextureData(this.levelObjects.cache.device, tex);
            modelTexData.push(texData);
            this.textureData.push(texData);
        }
        const parts: ActorPartInstance[] = [];
        for (let m of model.parts) {
            const modelData = new ActorModelData(this.levelObjects.cache.device, this.levelObjects.cache, m);
            parts.push(new ActorPartInstance(this.levelObjects.cache, modelData, m, modelTexData, this.shared.envMap));
            this.modelData.push(modelData);
        }
        existing.model = model;
        existing.parts = parts;
        existing.textures = modelTexData;
        existing.fetched |= 1;
        if (model.particles) {
            existing.particles = new ParticleData(model.particles, this.levelObjects.cache.device, this.levelObjects.cache, modelTexData, this.levelObjects.bufferManager);
        }
    }

    private setUpMonsters(encounter: BIN.EncounterData, objects: LevelObjectHolder, mapID: number, partyCenter: ReadonlyVec3, baseModels: number[]): BattleState {
        const isUnderwater = [0x02, 0x03, 0x23, 0x2E].includes(mapID);

        const monsters: Actor[] = [];
        const idleCounters: number[] = [];
        for (let i = 0; i < encounter.monsters.length; i++) {
            if (i < encounter.battlePositions[0].monsters.length) {
                // todo: weapons
                const m = encounter.monsters[i];
                const a = new Actor(objects, m);
                switch (m) {
                    case 0x1044:
                    case 0x1045:
                    case 0x1046: // piranha
                    case 0x1057:
                    case 0x10E3: // chimera
                        a.effectLevel = 3; break;
                    case 0x1040:
                    case 0x1041:
                    case 0x1130: // malboro
                        a.effectLevel = 7; break;
                    case 0x1058:
                    case 0x1134: // chimera brain
                        a.effectLevel = 15; break;
                }
                // could get these by parsing the monster script files instead
                switch (m) {
                    case 0x1010: case 0x1011: case 0x1012:
                        a.scale *= .7; break;
                    case 0x1014:
                        a.scale *= 1.3; break;
                    case 0x1015: // dark flan
                        a.scale *= 4; break;
                    case 0x1026: // ahriman
                        a.scale *= 2; break;
                    case 0x102C: // garuda
                        a.scale *= .5; break;
                    case 0x103A: // octopus
                        a.scale *= 2; break;
                    case 0x1040:
                    case 0x1130: // malboro
                        a.scale *= 0.67; break;
                    case 0x1055: // behemoth
                        a.scale *= .8; break;
                    case 0x1057:
                    case 0x10E3: // chimera
                        a.scale *= .75; break;
                    // skipping some bosses
                    case 0x1097: // vouivre
                        a.scale *= 1.5; break;
                    case 0x10D6: // funguar
                        a.scale *= .75; break;
                    case 0x10DD: // sandragora
                        a.scale *= 2.3; break;
                }
                monsters.push(a);
                idleCounters.push(0);
                vec3.copy(a.pos, encounter.battlePositions[0].monsters[i]);
                a.heading = Math.atan2(partyCenter[2] - a.pos[2], partyCenter[0] - a.pos[0]);
                a.targetHeading = a.heading;
                a.visible = false;
                if (isFlying(baseModels[i]) || isUnderwater) {
                    a.pos[1] -= 14 + a.scale*objects.actorResources.get(m)!.model!.scales.height/2;
                    a.flags |= 0x80;
                    a.floorMode = FloorMode.AIR;
                }
                // these would be attached by the monster scripts
                // other instances are for bosses
                let ownerID = -1;
                switch (m) {
                    case 0x1107: ownerID = 0x10C5; break; // rifle
                    case 0x1108: ownerID = 0x10C7; break; // flamethrower
                }
                if (ownerID >= 0) {
                    for (let prev of monsters) {
                        if ((prev.id === ownerID || prev.id === ownerID + 1) && prev.children.length === 0) {
                            a.parent = prev;
                            prev.children.push(a);
                            a.attachPoint = 14;
                            a.visible = true;
                            break;
                        }
                    }
                    vec3.zero(a.pos);
                }
                // "gemini" enemy, TODO: figure out where this actually happens?
                if (m === 0x10b8)
                    a.mirrorX = true;
                // sandragora stays in pit
                if (m === 0x10dd) {
                    a.floorMode = FloorMode.AIR;
                    a.flags |= 0x80;
                }
            }
        }
        return { monsters, idleCounters, encounter, startTime: -1 };
    }

    private async loadAndSetupEncounter(encounterID: number): Promise<BattleState> {
        const encData = await loadFile( this.levelObjects.context, FFXFolder.ENCOUNTERS, encounterID);
        const encounter = BIN.parseEncounter(encData);

        const uniqueIDs = [... new Set(encounter.monsters)];
        await Promise.all(uniqueIDs.map(id => this.loadAndParseActorModel(id)));
        // const monsterData = await Promise.all(encounter.monsters.map(id => loadFile(Folder.MONSTER_STATS, id & 0xFFF)));
        const partyCenter = vec3.create();
        const monsterCenter = vec3.create();
        let i = 0;
        for (; i < 3 && i < encounter.battlePositions[0].party.length; i++)
            vec3.add(partyCenter, partyCenter, encounter.battlePositions[0].party[i]);
        vec3.scale(partyCenter, partyCenter, 1 / i);
        for (i = 0; i < encounter.monsters.length && i < encounter.battlePositions[0].monsters.length; i++)
            vec3.add(monsterCenter, monsterCenter, encounter.battlePositions[0].monsters[i]);
        vec3.scale(monsterCenter, monsterCenter, 1 / i);
        // monsters look *past* the party, another 50%
        vec3.sub(monsterCenter, partyCenter, monsterCenter);
        vec3.scaleAndAdd(partyCenter, partyCenter, monsterCenter, .5);

        const baseModels: number[] = [];
        for (let id of encounter.monsters) {
            // const statView = stats.createDataView();
            // const statOffset = statView.getUint32(0xC, true);
            // const modelBase = statView.getUint16(statOffset + 0x74, true);

            // technically the game uses the monster file to determine the base model for animations
            // but we already have the animation list, so use that instead
            const res = this.levelObjects.actorResources.get(id);
            if (res?.model) {
                const modelBase = res.model.defaultAnimations[1].filter(x => x > 0)[0] >>> 0x10;
                baseModels.push(modelBase);
            }
        }
        await Promise.all([... new Set(baseModels)].map(id => this.levelObjects.loadActorResource(id, 1)));
        return this.setUpMonsters(encounter, this.levelObjects, this.shatter.map, partyCenter, baseModels)
    }

    private createRenderHacksPanel(): UI.Panel {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');

        const vertexColors = new UI.Checkbox('Vertex Colors', true);
        vertexColors.onchanged = () => {
            const v = vertexColors.checked;
            this.levelObjects.renderFlags.vertexColors = v;
        };
        renderHacksPanel.contents.appendChild(vertexColors.elem);
        const textures = new UI.Checkbox('Textures', true);
        textures.onchanged = () => {
            const v = textures.checked;
            this.levelObjects.renderFlags.textures = v;
        };
        renderHacksPanel.contents.appendChild(textures.elem);
        if (this.renderHelper.device.queryLimits().wireframeSupported) {
            const wireframe = new UI.Checkbox('Wireframe', false);
            wireframe.onchanged = () => {
                const v = wireframe.checked;
                this.levelObjects.renderFlags.wireframe = v;
            };
            renderHacksPanel.contents.appendChild(wireframe.elem);
        }
        return renderHacksPanel;
    }

    public createPanels(): UI.Panel[] {
        const panels: UI.Panel[] = [];
        panels.push(this.createLayerPanel());
        panels.push(this.createRenderHacksPanel());
        return panels;
    }

    private createLayerPanel(): UI.Panel {
        const layersPanel = new UI.Panel();
        layersPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        layersPanel.setTitle(UI.LAYER_ICON, 'Layers');
        if (this.levelObjects.map) {
            const map = this.levelObjects.map;
            const options: mapMode[] = ['Off'];
            if (map.hasCollision)
                options.push('Collision');
            if (map.hasBattle)
                options.push('Battle');
            // if (map.hasLight)
            //     options.push('Lighting');
            if (options.length === 1)
                options.push('On');
            const mapRadios = new UI.RadioButtons('Show map mesh', options);
            mapRadios.onselectedchange = () => {
                this.mapMode = options[mapRadios.selectedIndex];
                if (this.mapMode === "Collision")
                    mapRadios.elem.title = "red = blocked; cyan = blocked for player; purple = blocked by script";
                else
                    mapRadios.elem.title = "";
            };
            mapRadios.setSelectedIndex(0);
            layersPanel.contents.appendChild(mapRadios.elem);
        }
        if (this.script) {
            const triggerCheckbox = new UI.Checkbox('Show script triggers', false);
            triggerCheckbox.onchanged = () => {
                this.showTriggers = triggerCheckbox.checked;
            };
            layersPanel.contents.appendChild(triggerCheckbox.elem);
            const objectCheckbox = new UI.Checkbox('Show objects', true);
            objectCheckbox.onchanged = () => {
                this.levelObjects.renderFlags.showObjects = objectCheckbox.checked;
            };
            layersPanel.contents.appendChild(objectCheckbox.elem);
        }
        const particleCheckbox = new UI.Checkbox('Show particles', true);
        particleCheckbox.onchanged = () => {
            this.levelObjects.renderFlags.showParticles = particleCheckbox.checked;
        };
        layersPanel.contents.appendChild(particleCheckbox.elem);
        const debugParticleCheckbox = new UI.Checkbox('Show debug particles', false);
        debugParticleCheckbox.onchanged = () => {
            this.levelObjects.renderFlags.debugParticles = debugParticleCheckbox.checked;
        };
        layersPanel.contents.appendChild(debugParticleCheckbox.elem);
        return layersPanel;
    }

    private selectEncounter(viewerInput: Viewer.ViewerRenderInput): boolean {
        let mapID = this.levelObjects.mapID;
        if (this.script?.data.name === "nagi0000") { // calm lands
            // encounter pools are switched by crossing edges, we'll just do a rough approximation
            getMatrixTranslation(scr, viewerInput.camera.worldMatrix);
            transformVec3Mat4w0(scr, FFXToNoclip, scr); // actually the other way
            const tri = this.levelObjects.snapToGround(scr);
            if (tri < 0)
                scr[1] = 0;
            mapID = getCalmLandsMap(scr, this.script);
        }

        const pools = this.shared.battleLists.get(mapID);
        if (!pools)
            return false;
        let poolIndex = 0;
        if (this.levelObjects.map?.hasBattle) {
            getMatrixTranslation(scr, viewerInput.camera.worldMatrix);
            transformVec3Mat4w0(scr, FFXToNoclip, scr); // actually the other way
            const triIndex = this.levelObjects.snapToGround(scr);
            if (triIndex >= 0)
                poolIndex = this.levelObjects.map.tris[triIndex].encounter;
        }
        if (this.script?.data.name === "bika0300") {
            getMatrixTranslation(scr, viewerInput.camera.worldMatrix);
            transformVec3Mat4w0(scr, FFXToNoclip, scr);
            for (let a of this.levelObjects.actors) {
                if (!a || a.id !== 0x10dd)
                    continue;
                if (Math.hypot(scr[0]-a.pos[0], scr[2]-a.pos[2]) < 35) {
                    poolIndex = 2;
                    break;
                }
            }
        }
        if (poolIndex >= pools.pools.length)
            poolIndex = 0;
        // random encounters have a weight, scripted encounters generally don't
        // some random encounters can be enabled and start with weight zero
        const files = pools.pools[poolIndex].files;
        const sum = files.map(f=>f.weight).reduce((a,b) => a+b, 0);

        if (sum === 0) {
            return false;
            // allow picking a random scripted encounter? camera isn't great
            // const idx = randomRange(0, pools.pools[poolIndex].files.length);
            // this.shatter.enc = files[idx | 0].file;
        }
        let random = randomRangeFloat(0, sum);
        for (let f of files) {
            if (random >= f.weight) {
                random -= f.weight;
            } else {
                this.shatter.enc = f.file;
                break;
            }
        }
        const map = pools.pools[poolIndex].map;
        // some battles take place on the current map
        if ((map & 0x400) === 0x400)
            this.shatter.map = map & 0xFF;
        else
            this.shatter.map = -1;
        return true;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();

        this.sceneTexture.destroy(device);
        for (let i = 0; i < this.modelData.length; i++)
            this.modelData[i].destroy(device);
        for (let i = 0; i < this.textureData.length; i++)
            this.textureData[i].destroy(device);
        this.levelObjects.particles.data.destroy(device);
        for (let m of this.levelObjects.magic)
            m.data.destroy(device);
        for (let res of this.levelObjects.actorResources.values())
            res.particles?.destroy(device);
        this.levelObjects.bufferManager.destroy(device);
        this.levelObjects.shadows.destroy(device);
        for (let a of this.levelObjects.actors) {
            a?.destroy(device);
        }
        if (this.subScene) {
            this.subScene.levelObjects.actorResources = new Map();
            this.subScene.destroy(device);
        }
        if (this.battleState) {
            for (let m of this.battleState?.monsters) {
                m.destroy(device);
            }
        }
    }
}

function getCalmLandsMap(pos: ReadonlyVec3, script: EventScript): number {
    if (pos[1] < -30) {
        return 613; // initial ramp mostly
    }
    const center = script.workers[0x82].position.miscVec;
    const posAngle = Math.atan2(pos[2] - center[2], pos[0] - center[0]);
    const bottom = script.workers[0x80].position.pos;
    const left = script.workers[0x81].position.pos;
    const top = script.workers[0x82].position.pos;
    const bottomAngle = Math.atan2(bottom[2]-center[2], bottom[0] - center[0]);
    const leftAngle = Math.atan2(left[2]-center[2], left[0] - center[0]);
    const topAngle = Math.atan2(top[2]-center[2], top[0] - center[0]);
    if (posAngle > leftAngle && posAngle <= bottomAngle)
        return 613;
    if (posAngle > bottomAngle && posAngle <= topAngle)
        return 611;
    return 612;
}

export enum ActorCategory {
    PC,
    MON,
    NPC,
    SUM,
    WEP,
    OBJ,
    SKL,
}

function actorName(id: number): string {
    const prefix = ActorCategory[id >>> 12];
    return `${prefix}:${hexzero(id & 0xFFF,3)}`;
}

// files in folder 0x14
const modelFileIndices: number[][] = [
    // pc
    [1, 2, 3, 4, 5, 6, 7, 8, 41, 43, 44, 45, 46, 51, 101, 102, 103, 104, 105, 106, 107, 108, 121, 122, 901, 902, 903, 904, 905, 906, 907, 908, 921, 922, 999],
    // monster
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255, 256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269, 270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320, 321, 322, 323, 324, 325, 326, 327, 328, 329, 330, 331, 332, 333, 334, 335, 336, 337, 338, 339, 340, 341, 342, 343, 344, 345, 346, 999],
    // npc
    [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 74, 75, 76, 78, 79, 80, 81, 82, 84, 85, 86, 87, 88, 90, 91, 99, 100, 101, 102, 103, 104, 105, 106, 108, 110, 112, 115, 122, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 139, 140, 141, 142, 143, 144, 145, 146, 150, 151, 168, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 231, 232, 233, 234, 236, 238, 239, 240, 241, 242, 243, 244, 246, 247, 248, 249, 250, 255, 257, 265, 272, 278, 281, 283, 284, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 314, 315, 316, 323, 324, 325, 326, 327, 330, 331, 332, 333, 334, 335, 336, 337, 338, 339, 340, 341, 342, 343, 344, 345, 346, 347, 348, 349, 350, 352, 353, 354, 355, 356, 999],
    //summon
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31],
    // weapon
    [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 21, 22, 23, 24, 25, 31, 32, 33, 34, 35, 36, 41, 42, 43, 44, 45, 46, 51, 52, 53, 54, 55, 56, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103],
    // object
    [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 21, 22, 23, 24, 27, 28, 29, 30, 31, 32, 33, 34, 35, 47, 48, 49, 50, 51, 52, 53, 54, 57, 58, 59, 60, 61, 62, 64, 65, 69, 72, 73, 75, 79, 80, 81, 82, 84, 85, 86, 87, 88, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 116, 117, 118, 120, 122, 123, 124, 125, 126, 127, 128, 129, 146, 147, 149, 150, 156, 157, 158, 159, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 175, 176],
    // skeleton (shared npc animations)
    [1, 2, 3, 4, 5, 6, 7, 12, 13, 14, 15, 16, 17, 66, 101, 102, 103, 104, 112, 113, 114, 201, 202, 203, 204, 212, 213, 214, 301, 302, 303, 304, 401, 402, 403, 501, 502, 503, 504, 505, 998, 999],
   ];

function shouldLoadModel(map: number, id: number): boolean {
    if (map === 173 || map === 19) // blitzball or tanker
        return true;
    return (id >>> 12) !== ActorCategory.PC;
}

interface FFXShared {
    globals: number[];
    battleLists: Map<number, BIN.BattleList>;
    destroy(device: GfxDevice): void;
    idx: number;
    shatterPieces: ShatterParticleInstance[];
    fullscreenRenderer: FullScreenColor;
    commonTextures: ArrayBufferSlice;
    envMap: TextureData;
}

export const enum FFXFolder {
    EVENT = 0xC,
    BATTLE_LIST,
    ENCOUNTERS,
    MONSTER_STATS = 0x10,
    MAGIC,
    MAP = 0x13,
    ACTOR_INDICES,
    BATTLE_MAP = 0x1A,
    PC_MODEL = 0x1C,
    MONSTER_MODEL,
    NPC_MODEL,
    SUMMON_MODEL,
    WEAPON_MODEL,
    OBJECT_MODEL,
    SHARED_ANIMATIONS,
    WEAPON_STATS = 0x28,
}

function isFlying(id: number): boolean {
    switch (id) {
        case 0x1006: // little guy
        case 0x101C: // bird
        case 0x101F: // bee
        case 0x1023: // evil eye
        case 0x102C: // zu
        case 0x102D: // zu
        case 0x104D: // elemental
        case 0x104E: // elemental
        case 0x104F: // elemental
        case 0x1050: // elemental
        case 0x1051: // elemental
        case 0x1052: // elemental
        case 0x1077: // evrae
        case 0x1079: // spherimorph
        case 0x107b: // negator
        case 0x108e: // flux
        case 0x10c1: // bomb
        case 0x10d1: // cocoon
        case 0x3001: // valefor
            return true;
    }
    return false;
}

export function loadFile(context: SceneContext, folder: FFXFolder, index: number, allow404 = false): Promise<NamedArrayBufferSlice> {
    return context.dataFetcher.fetchData(`${pathBase}/${hexzero(folder, 2)}/${hexzero(index, 4)}.bin`, { allow404 });
}

export function loadActorFile(context: SceneContext, map: number, id: number, offset: number): Promise<NamedArrayBufferSlice | null> {
    const category = id >>> 12;
    const index = modelFileIndices[category].indexOf(id & 0xFFF);
    if (!shouldLoadModel(map, id) || index < 0) {
        return Promise.resolve(null);
    }
    return loadFile(context, category + 0x1C, 5*index + offset, true);
};

class FFXLevelSceneDesc implements Viewer.SceneDesc {
    public id: string;
    constructor(private index: number, public name: string, private events: number[], private magic: number[] = [], private isBattle = false) {
        this.id = hexzero(index, 3);
        if (isBattle)
            this.id = "b" + this.id
    }

    public static BattleScene(index: number, name: string) {
        return new FFXLevelSceneDesc(index, name, [], [], true);
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const renderHelper = new GfxRenderHelper(device);
        const cache = renderHelper.renderCache;

        const sharedData: FFXShared = await context.dataShare.ensureObject(`${pathBase}/Globals`, async () => {
            const battleListData = await loadFile(context, FFXFolder.BATTLE_LIST, 0);
            const shatterFile = await context.dataFetcher.fetchData(`${pathBase}/screen_shatter.bin`);
            const commonTextures = await context.dataFetcher.fetchData(`${pathBase}/common_textures.bin`);
            const envMap = await context.dataFetcher.fetchData(`${pathBase}/env_map_texture.bin`);
            const textures: BIN.Texture[] = [];
            const shatterParticles = assertExists(BIN.parseStandaloneActorParticles("shatter", shatterFile, commonTextures, textures));
            BIN.parseActorTextures("envmap", envMap, 0, textures);
            const sharedTexData: TextureData[] = [];
            for (let tex of textures) {
                const texData = new TextureData(device, tex);
                sharedTexData.push(texData);
            }
            const shatterRenderHelper = new GfxRenderHelper(device);
            const cache = shatterRenderHelper.renderCache;
            // const shatterData = new ParticleData(shatterParticles, device, cache, shatterTexData);

            const shatterPieces: ShatterParticleInstance[] = [];
            const fullscreenRenderer = new FullScreenColor(cache);
            for (let g of shatterParticles.geometry.slice(shatterParticles.extraGeometryIndex! + 16)) {
                if (g.geometry) {
                    const data = new LevelModelData(device, cache, g.geometry);
                    shatterPieces.push(new ShatterParticleInstance(cache, g, data, sharedTexData[shatterParticles.spriteStartIndex!]));
                }
            }

            let minU = 100, minV = 100, maxU = 0, maxV = 0;
            for (let g of shatterPieces) {
                const vd = g.geo.geometry!.vertexData;
                for (let j = 0; j < vd.length; j += 13) {
                    minU = Math.min(minU, vd[j + 7]);
                    maxU = Math.max(maxU, vd[j + 7]);
                    minV = Math.min(minV, vd[j + 8]);
                    maxV = Math.max(maxV, vd[j + 8]);
                }
            }
            const flipY = gfxDeviceNeedsFlipY(device);
            const newTex = mat4.create();
            newTex[0] = 1 / (maxU - minU);
            newTex[12] = -newTex[0] * minU;
            newTex[5] = (flipY ? -1 : 1) / (maxV - minV);
            newTex[13] = -newTex[5] * (flipY ? maxV : minV);
            for (let g of shatterPieces) {
                assert(g.drawCalls.length === 1);
                mat4.copy(g.textureMatrix, newTex);
            }
            return {
                globals: [],
                idx: 0,
                shatterPieces,
                fullscreenRenderer,
                commonTextures,
                battleLists: BIN.parseBattleLists(battleListData),
                envMap: sharedTexData[sharedTexData.length - 1],
                destroy: (device: GfxDevice) => {
                    for (let tex of sharedTexData)
                        tex.destroy(device);
                    for (let g of shatterPieces)
                        g.data.destroy(device);
                    shatterRenderHelper.destroy();
                },
            };
        });

        const mapFolder = this.isBattle ? FFXFolder.BATTLE_MAP : FFXFolder.MAP;
        const initialLoads: Promise<NamedArrayBufferSlice>[] = [0, 1].map(x => loadFile(context, mapFolder, 2 * this.index + x));

        let textureBuffer: NamedArrayBufferSlice | null = null;
        let geometryData: NamedArrayBufferSlice | null = null;
        let eventData: NamedArrayBufferSlice | null = null;
        let eventAnimations: NamedArrayBufferSlice | null = null;
        // TODO: allow selecting events for the few with multiple options?
        if (this.events.length > 0) {
            initialLoads.push(loadFile(context, FFXFolder.EVENT, this.events[0]*18));
            initialLoads.push(loadFile(context, FFXFolder.EVENT, this.events[0]*18 + 3, true));
            [textureBuffer, geometryData, eventData, eventAnimations] = await Promise.all(initialLoads) ;
        } else {
            [textureBuffer, geometryData] = await Promise.all(initialLoads);
        }

        const textures = BIN.parseLevelTextures(textureBuffer, sharedData.commonTextures);
        const level = BIN.parseMapFile(this.index, geometryData, textures);
        const magicFiles = await Promise.all(this.magic.map(m => loadFile(context, FFXFolder.MAGIC, m)));
        const parsedMagic: LevelParticles[] = [];
        for (let i = 0; i < this.magic.length; i++)
            parsedMagic.push(BIN.parseMagicFile(this.magic[i], magicFiles[i], sharedData.commonTextures, level.textures));

        if (!this.isBattle) {
            if (this.index === 303) {
                // seems like an error in the game, lightning tower particle model has the wrong scale, making it look misaligned
                const scale: vec4 = (level.particles.behaviors[16].programs[5].instructions[4] as any).data[0].vec;
                vec4.set(scale, .091, .091, .091, .091);
            } else if (this.index === 410) {
                // some water surface textures are too small and are hidden inside the tower
                // might have deliberate?
                level.particles.emitters[0].scale[0] = 1;
                level.particles.emitters[0].scale[1] = 1;
                level.particles.emitters[0].scale[2] = 1;
            }
        }

        const textureData: TextureData[] = [];
        for (let tex of level.textures) {
            const data = new TextureData(device, tex);
            textureData.push(data);
        }

        const actorResources: Map<number, ActorResources> = new Map();
        const allModelData: Destroyable[] = [];
        const objects = new LevelObjectHolder(this.index, this.events[0], cache, context,
            level, actorResources, textureData, textures.particleMap);
        const renderer = new FFXRenderer(renderHelper, objects, textureData, allModelData, sharedData);
        let event: BIN.EventData | null = null;
        if (eventData) {
            event = BIN.parseEvent(eventData, this.index);
            const models = Promise.all(event.modelList.map(m => renderer.loadAndParseActorModel(m)));
            const anims = Promise.all(event.modelList.map(m => objects.loadActorResource(m, 0)));
            await Promise.all([models, anims]);
            if (eventAnimations && eventAnimations.byteLength > 0) {
                const parsedAnims = BIN.parseAnimation(eventAnimations, false);
                for (let g of parsedAnims) {
                    const res = actorResources.get(g.id);
                    if (res) {
                        res.animations = res.animations.concat(g.animations);
                    } else {
                        actorResources.set(g.id, {animations: g.animations, parts: [], textures: [], fetched: 0});
                    }
                }
            }
        }

        for (let i = 0; i < this.magic.length; i++) {
            const id = this.magic[i];
            const sys = new ParticleSystem(id, new ParticleData(parsedMagic[i], device, cache, textureData, objects.bufferManager), parsedMagic[i].runner);
            sys.loop = false;
            sys.active = false;
            objects.magic.push(sys);
        }

        // const targetID = this.index + (this.isBattle ? 0x400 : 0);
        // if (this.chosenEncounter < 0) {
        //     const matches = new Set<number>();
        //     // if (sharedData.battleLists.has(targetID)) {
        //     //     const b = sharedData.battleLists.get(targetID);
        //     //     for (let file of b!.pools[0].files) {
        //     //         if (file.weight > 0)
        //     //             matches.add(file.file);
        //     //     }
        //     // } else {
        //     for (let b of sharedData.battleLists.values()) {
        //         for (let pool of b.pools) {
        //             if (pool.map !== targetID)
        //                 continue;
        //             for (let file of pool.files)
        //                 matches.add(file.file);
        //         }
        //     }
        //     // }
        //     if (matches.size > 0) {
        //         const opts = Array.from(matches.values());
        //         opts.sort();
        //         this.chosenEncounter = opts[(sharedData.idx++) % opts.length];
        //         console.log("Chose #", this.chosenEncounter, "out of", matches.size, "for", targetID);
        //     }
        // }

        renderer.clearPass = makeAttachmentClearDescriptor(level.geo.clearColor);
        mat4.copy(renderer.envMapDirection, level.geo.envMapDirection);

        for (let p of level.geo.parts) {
            const data = new LevelModelData(device, cache, assertExists(p.model));
            renderer.modelData.push(data);
            const partRenderer = new LevelPartInstance(cache, p, data, renderer.textureData);
            for (let index of p.effectIndices)
                activateEffect(objects, objects.parts.length, index, false);
            // battle maps have a debug coordinate system graphic
            if (this.isBattle && p.layer === 3)
                partRenderer.visible = false;
            objects.parts.push(partRenderer);
        }

        if (event) {
            renderer.script = await EventScript.fromEvent(event, objects, this.index, sharedData.globals, renderer);
            switch (event.script.name) {
                case "znkd0600": { // turn on all particle effects in intro
                    for (let e of objects.particles.emitters) {
                        e.bindingFlags = 0;
                        e.waitTimer = 0;
                    }
                } break;
                case "znkd0900": {
                    objects.loadActorResource(0x10AA, 1);
                    // objects.actors[0]!.visible = false
                    // objects.actors[1]!.visible = false
                } break;
                case "bltz0000": {
                    for (let e of objects.magic[0].emitters) {
                        vec3.set(e.spec.pos, 0, -505, 0);
                        vec3.set(e.spec.scale, 3/160, 3/160, 3/160);
                    }
                } break;
            }
        }

        for (let tex of level.geo.animatedTextures)
            renderer.textureRemaps[tex.textureIndices[0]] = renderer.textureData[tex.textureIndices[0]].gfxTexture;

        return renderer;
    }
}



class FFXMagicSceneDesc implements Viewer.SceneDesc {
    public id: string = "";
    constructor(private index: number, public name: string) {
        this.id = "m" + index.toString();
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        return new MagicSceneRenderer(this.index, context);
    }
}

const id = 'ffx';
const name = 'Final Fantasy X';

const sceneDescs = [
    "Intro",
    new FFXLevelSceneDesc(16, 'Zanarkand Ruins', [
        0x84, // new game
        0x15d, // attract loop
    ]),
    "Zanarkand (past)",
    new FFXLevelSceneDesc(20, 'Zanarkand - Harbor (night)', [0x170]),
    new FFXLevelSceneDesc(17, 'Zanarkand - Harbor (night, flashbacks)', [0x86]),
    new FFXLevelSceneDesc(15, 'Boathouse - Cabin', [0xa5]),
    new FFXLevelSceneDesc(24, 'Zanarkand - Overpass', [0x178]),
    new FFXLevelSceneDesc(14, 'Zanarkand - Harbor', [0xbf]),
    new FFXLevelSceneDesc(13, 'Zanarkand - Harbor (dream)', [0xf9]),
    new FFXLevelSceneDesc(18, 'Zanarkand - Overpass (boss)', [0x185, 0x16e, 0x185]),
    new FFXLevelSceneDesc(19, 'Zanarkand - Overpass (tanker)', [0x16f], [0x2A1]),
    // new FFXLevelSceneDesc(22, 'Zanarkand Stadium', [0x172]),
    // new FFXLevelSceneDesc(23, 'Zanarkand Stadium', [0x173]),
    "Ruins",
    new FFXLevelSceneDesc(30, "Submerged Ruins", [0x30]),
    new FFXLevelSceneDesc(32, "Ruins - Underwater Hall", [0x31], [0x176]),
    new FFXLevelSceneDesc(33, "Ruins - Corridor", [0x32]),
    new FFXLevelSceneDesc(34, "Ruins - Hall", [0x3f], [0x1DF, 0x1E0]),
    new FFXLevelSceneDesc(35, "Ruins - Hall (past)", [0x33]),
    new FFXLevelSceneDesc(36, "Ruins - Stairs", [0x34]),
    new FFXLevelSceneDesc(37, "Ruins - Small Room", [0x4a]),
    "Baaj",
    new FFXLevelSceneDesc(38, "Ruins - Underwater Passage", [0x127]),
    new FFXLevelSceneDesc(40, "Ruins - Antechamber", [0xc4]),
    new FFXLevelSceneDesc(42, "Ruins - Fayth", [0x12a]),
    'Salvage Ship',
    new FFXLevelSceneDesc(50, "Salvage Ship - Deck", [0x47]),
    new FFXLevelSceneDesc(51, "Salvage Ship - Underwater", [0x120]),
    new FFXLevelSceneDesc(57, "Underwater Ruins (interior)", [0x40]),
    new FFXLevelSceneDesc(58, "Underwater Ruins (exterior)", [0x17c]),
    'Besaid',
    new FFXLevelSceneDesc(65, "Besaid - Port", [0x46, 0xfc]),
    new FFXLevelSceneDesc(66, "Besaid - Port (with boat)", [0x13]),
    new FFXLevelSceneDesc(67, "Besaid - Crossroads", [0x14]),
    new FFXLevelSceneDesc(68, "Besaid - Valley", [0x29]),
    new FFXLevelSceneDesc(69, "Besaid - Ancient Road", [0x15]),
    new FFXLevelSceneDesc(70, "Besaid - Waterfall Way", [0x16]),
    new FFXLevelSceneDesc(71, "Besaid - Promontory", [0x43]),
    new FFXLevelSceneDesc(72, "Besaid - Village Slope", [0x45]),
    new FFXLevelSceneDesc(75, "Besaid Village", [
        0x11, // default
        0x53, // summoning valefor
        0x85, // first time
        0x151]), // sphere
    new FFXLevelSceneDesc(76, "Besaid Village (night)", [0x64, 0x182]),
    new FFXLevelSceneDesc(77, "Besaid - Crusaders Lodge", [0x3c]),
    new FFXLevelSceneDesc(78, "Besaid - Crusaders Lodge (night)", [0x44]),
    // new FFXLevelSceneDesc(79, "Besaid - House", [0x8e]),
    // new FFXLevelSceneDesc(80, "Besaid - House", [0x8f]),
    // new FFXLevelSceneDesc(81, "Besaid - Shop", [0x90]),
    // new FFXLevelSceneDesc(82, "Besaid - House", [0x91]),
    // new FFXLevelSceneDesc(83, "83", []),
    // new FFXLevelSceneDesc(84, "84", []),
    new FFXLevelSceneDesc(85, "Besaid - Great Hall", [0x2a, 0x54]),
    new FFXLevelSceneDesc(86, "Besaid - Trials", [0x7a]),
    // new FFXLevelSceneDesc(87, "Besaid - Monks' Chamber", [0x92]),
    // new FFXLevelSceneDesc(88, "Besaid - Nuns' Chamber", [0x93]),
    new FFXLevelSceneDesc(89, "Besaid - Antechamber", [0x67]),
    new FFXLevelSceneDesc(90, "Besaid - Fayth", [0x75, 0x183]),

    "S.S. Liki",
    new FFXLevelSceneDesc(95, "S.S. Liki - Deck", [0x12d]),
    new FFXLevelSceneDesc(97, "S.S. Liki - Deck (dragged)", [0x3d,
        0x150]), // jecht sphere
    new FFXLevelSceneDesc(98, "S.S. Liki - Bridge", [0x9a]),
    // new FFXLevelSceneDesc(99, "S.S. Liki - Corridor", [0x94]),
    // new FFXLevelSceneDesc(102, "S.S. Liki - Cabin", [0x95]),
    new FFXLevelSceneDesc(103, "S.S. Liki - Engine Room", [0x96]),
    new FFXLevelSceneDesc(105, "S.S. Liki - Deck (sunset)", [0xdc]),
    new FFXLevelSceneDesc(106, "Kilika - Offshore", [0x11a]),
    "Kilika",
    new FFXLevelSceneDesc(115, "Kilika Port", [0x8b]),
    new FFXLevelSceneDesc(116, "Kilika - Dock (sunset)", [0x2b]),
    new FFXLevelSceneDesc(117, "Kilika - Dock (damaged)", [0x10]),
    new FFXLevelSceneDesc(122, "Kilika - Dock", [0x62]),
    // new FFXLevelSceneDesc(124, "Kilika - Tavern", [0x97]),
    new FFXLevelSceneDesc(125, "Kilika - Ruined Square", [0x35]),
    // new FFXLevelSceneDesc(126, "Kilika - Residential Area", [0x2e]),
    // new FFXLevelSceneDesc(127, "Kilika - Inn", [0x98]),
    // new FFXLevelSceneDesc(128, "Kilika - Residential Area", [0x2f]),
    // new FFXLevelSceneDesc(129, "Kilika - House", [0x125]),
    // new FFXLevelSceneDesc(130, "Kilika - House", [0x126]),
    new FFXLevelSceneDesc(131, "Kilika Forest", []), // missing name?
    new FFXLevelSceneDesc(132, "Kilika - Pilgrimage Road", [0x41]),
    "Kilika Temple",
    // new FFXLevelSceneDesc(133, "Kilika Temple", [0xa6]),
    new FFXLevelSceneDesc(134, "Kilika Temple", [0x4e]),
    new FFXLevelSceneDesc(135, "Kilika - Great Hall", [0x60]),
    // new FFXLevelSceneDesc(136, "Kilika - Monks' Chambers", [0x9b]),
    // new FFXLevelSceneDesc(137, "Kilika - Monks' Chambers", [0x9c]),
    new FFXLevelSceneDesc(138, "Kilika - Lift", [0x2c]),
    new FFXLevelSceneDesc(139, "Kilika - Trials", [0x6c]),
    new FFXLevelSceneDesc(140, "Kilika - Antechamber", [0x2d]),
    new FFXLevelSceneDesc(141, "Kilika - Fayth", [0x76]),
    "S.S. Winno",
    new FFXLevelSceneDesc(145, "S.S. Winno - Deck", [0x12e]),
    new FFXLevelSceneDesc(147, "S.S. Winno - Deck (night)", [0x5e]),
    // new FFXLevelSceneDesc(148, "S.S. Winno - Bridge", [0xb9]),
    // new FFXLevelSceneDesc(149, "S.S. Winno - Corridor", [0xed]),
    // new FFXLevelSceneDesc(152, "S.S. Winno - Cabin", [0xa7]),
    new FFXLevelSceneDesc(153, "S.S. Winno - Engine Room", [0xa8]),
    new FFXLevelSceneDesc(154, "S.S. Winno - Bridge", [0xa9]),
    "Luca Docks",
    new FFXLevelSceneDesc(165, "Luca Stadium - Main Gate", [0x7b]),
    new FFXLevelSceneDesc(166, "Luca - Number 1 Dock", [0x55]),
    new FFXLevelSceneDesc(167, "Luca - Number 2 Dock", [0x56, 0x10b, 0x14f]),
    new FFXLevelSceneDesc(168, "Luca - Number 3 Dock", [0x57, 0x10c]),
    new FFXLevelSceneDesc(169, "Luca - Number 4 Dock", [0x58]),
    new FFXLevelSceneDesc(180, "Luca - Number 4 Dock (salvage ship)", [0x12b]),
    new FFXLevelSceneDesc(52, "Salvage Ship (boss)", [0x71], [0x4E, 0x120]),
    new FFXLevelSceneDesc(170, "Luca - Number 5 Dock", [0x59]),
    "Luca Stadium",
    new FFXLevelSceneDesc(171, "Stadium - Stands", [0x37, 0xfa]),
    new FFXLevelSceneDesc(172, "Stadium - VIP Seats", [0x39]),
    new FFXLevelSceneDesc(173, "Stadium - Pool (blitzball)", [
        0x3e,
        0x79 , 0x7c, 0x7d, // cutscenes for Luca Goers match?
        0x163, // tutorial
        0x164, // battles afterwards?
    ], [0x1F9]),
    // new FFXLevelSceneDesc(174, "Theater", [0x9d]),
    new FFXLevelSceneDesc(178, "Stadium - Locker Room", [0x48]), // also Basement A
    new FFXLevelSceneDesc(179, "Stadium - Basement B", [0x49]),
    "Luca",
    new FFXLevelSceneDesc(183, "Luca - Bridge", [0x4d]),
    new FFXLevelSceneDesc(186, "Luca - Square", [0x68]),
    new FFXLevelSceneDesc(189, "Luca - Cafe", [0x9f]),
    new FFXLevelSceneDesc(191, "Luca - City Limits", [0x6b, 0x187]),
    // new FFXLevelSceneDesc(193, "Luca - Cafe", [0x179]),
    // new FFXLevelSceneDesc(175, "Theater - Entrance", [0xaa]),
    // new FFXLevelSceneDesc(176, "Theater - Reception", [0x9e]),
    // new FFXLevelSceneDesc(177, "Theater - Main Hall", [0xb8]),
    "Mi'ihen highroad",
    new FFXLevelSceneDesc(210, "Highroad - South End", [0x5f]),
    new FFXLevelSceneDesc(217, "Highroad - South", [0x78]),
    new FFXLevelSceneDesc(218, "Highroad - Central", [0x7f]),
    new FFXLevelSceneDesc(216, "Highroad - North End", [0x3b]),
    new FFXLevelSceneDesc(211, "Highroad - Agency, Front (sunset)", [0x70, 0x17d]),
    new FFXLevelSceneDesc(212, "Highroad - Agency, Front", [0x3a, 0x14e]),
    // new FFXLevelSceneDesc(213, "Highroad - Agency", [0xab]),
    new FFXLevelSceneDesc(214, "Highroad - Newroad, South", [0x73]),
    new FFXLevelSceneDesc(215, "Highroad - Newroad, North", [0x74]),
    "Mushroom Rock",
    new FFXLevelSceneDesc(220, "Mushroom Rock - Plateau", [0x4f]),
    new FFXLevelSceneDesc(221, "Mushroom Rock - Valley", [0x5c]),
    new FFXLevelSceneDesc(225, "Mushroom Rock - Precipice", [0x80]),
    new FFXLevelSceneDesc(222, "Mushroom Rock - Ridge", [0x77]),
    new FFXLevelSceneDesc(228, "Mushroom Rock - Beach (fiend)", [0x121]),
    new FFXLevelSceneDesc(223, "Mushroom Rock - Ridge (boss)", [0xf7]),
    new FFXLevelSceneDesc(226, "Underwater - Chasing Sin", [0xda, 0x181]),
    new FFXLevelSceneDesc(227, "Mushroom Rock - Aftermath", [0x83]),
    new FFXLevelSceneDesc(229, "Mushroom Rock - Beach", [0xfe]),
    "Djose",
    new FFXLevelSceneDesc(224, "Djose Highroad", [0x5d]),
    new FFXLevelSceneDesc(230, "Djose - Pilgrimage Road", [0x4c]),
    new FFXLevelSceneDesc(231, "Djose Temple", [0x52]),
    new FFXLevelSceneDesc(232, "Djose - Inn", [0xd2]),
    new FFXLevelSceneDesc(233, "Djose - Great Hall", [0x51]),
    new FFXLevelSceneDesc(234, "Djose - Monks' Chamber", [0xa0]),
    new FFXLevelSceneDesc(235, "Djose - Nuns' Chamber", [0xa1]),
    new FFXLevelSceneDesc(236, "Djose - Trials", [0xd6]),
    new FFXLevelSceneDesc(237, "Djose - Antechamber (dark)", [0x5a]),
    new FFXLevelSceneDesc(238, "Djose - Antechamber (light)", [0x5b]),
    new FFXLevelSceneDesc(239, "Djose - Fayth", [0xf5]),
    "Moonflow",
    new FFXLevelSceneDesc(245, "Moonflow - South Bank Road", [0x4b]),
    new FFXLevelSceneDesc(246, "Moonflow - South Bank", [0x69, 0x14d]),
    new FFXLevelSceneDesc(247, "Moonflow - South Wharf", [0xea]),
    // new FFXLevelSceneDesc(249, "Moonflow - South Wharf", [0xbb]), // identical, for now?
    // new FFXLevelSceneDesc(250, "Moonflow - South Wharf", [0xbc]),
    // new FFXLevelSceneDesc(251, "Moonflow - South Wharf", [0xeb]),
    new FFXLevelSceneDesc(254, "Moonflow", [0x63]),
    new FFXLevelSceneDesc(255, "Riding the Shoopuf", [0x123]),
    // new FFXLevelSceneDesc(256, "Moonflow - North Wharf", [0xbd]),
    // new FFXLevelSceneDesc(257, "Moonflow - North Wharf", [0xbe]),
    // new FFXLevelSceneDesc(258, "Moonflow - North Wharf", [0xec]),
    new FFXLevelSceneDesc(260, "Moonflow - North Bank", [0x6d]),
    new FFXLevelSceneDesc(261, "Moonflow - North Bank Road", [0x61]),
    "Guadosalam",
    new FFXLevelSceneDesc(265, "Guadosalam", [0x87]),
    // new FFXLevelSceneDesc(266, "Guadosalam - Inn", [0xf3]),
    // new FFXLevelSceneDesc(267, "Guadosalam - Shop", [0xac]),
    // new FFXLevelSceneDesc(268, "Guadosalam - House", [0xad]),
    // new FFXLevelSceneDesc(269, "Guadosalam - House", [0xae]),
    new FFXLevelSceneDesc(270, "Mansion - Entrance", [0xa3]),
    new FFXLevelSceneDesc(271, "Mansion - Great Hall", [0x8d, 0xd9]),
    new FFXLevelSceneDesc(272, "Zanarkand - Yunalesca", [0xc5]),
    // new FFXLevelSceneDesc(275, "Road to Farplane", [0xaf]),
    new FFXLevelSceneDesc(276, "Farplane Gates", [0x101, 0x16c]),
    new FFXLevelSceneDesc(281, "The Farplane", [0xc1]),
    // new FFXLevelSceneDesc(282, '282', []),
    new FFXLevelSceneDesc(283, "The Farplane (missing FMV background)", [0xd5]),
    "Thunder Plains",
    new FFXLevelSceneDesc(300, "Thunder Plains - South", [0x8c]),
    // new FFXLevelSceneDesc(301, "Thunder Plains - Agency", [0x107]),
    // new FFXLevelSceneDesc(302, "Thunder Plains - Agency Room", [0x108]),
    new FFXLevelSceneDesc(304, "Thunder Plains - Agency Front", [0x100]),
    new FFXLevelSceneDesc(303, "Thunder Plains - North", [0xa2, 0x14c]),
    // new FFXLevelSceneDesc(308, '308', []),
    "Macalania Woods",
    new FFXLevelSceneDesc(310, "Macalania Woods - South", [0x6e]),
    new FFXLevelSceneDesc(311, "Macalania Woods - Central", [0xf1]),
    new FFXLevelSceneDesc(312, "Macalania Woods - North", [0xf2]),
    new FFXLevelSceneDesc(314, "Macalania Woods - Lake Road", [0xdd]),
    new FFXLevelSceneDesc(313, "Macalania Woods - Spring (boss)", [0xf8, 0x152]),
    // new FFXLevelSceneDesc(315, "Macalania Woods - To Bevelle", [0xb0]),
    // new FFXLevelSceneDesc(316, "Macalania Woods - To Bevelle", [0x111]),
    // new FFXLevelSceneDesc(317, "Macalania Woods - To Thunder", [0xb1]),
    // new FFXLevelSceneDesc(318, "Macalania Woods - To Thunder", [0x112]),
    // new FFXLevelSceneDesc(319, "Macalania Woods - Campsite", [0xee]),
    // new FFXLevelSceneDesc(321, "Macalania Woods - Campsite", [0xb7]),
    new FFXLevelSceneDesc(322, "Macalania Woods - Spring", [0xce]),
    new FFXLevelSceneDesc(323, "Macalania Woods - Spring (unused?)", [0x10d]),
    new FFXLevelSceneDesc(324, "Macalania Woods - North", [0x149]),
    "Lake Macalania",
    new FFXLevelSceneDesc(330, "Lake Macalania - Agency Front", [0xa4, 0x14b]),
    // new FFXLevelSceneDesc(331, "Lake Macalania - Agency", [0xd7]),
    new FFXLevelSceneDesc(332, "Lake Macalania", [0x66]),
    new FFXLevelSceneDesc(333, "Lake Macalania - Crevasse", [0xc0]),
    new FFXLevelSceneDesc(335, "Lake Macalania - Crevasse (end)", [0x16d]), // official name is "None"?
    new FFXLevelSceneDesc(334, "Lake Macalania - Lake Bottom", [0x36, 0x104]),
    "Macalania Temple",
    new FFXLevelSceneDesc(340, "Macalania - Road", [0x99]),
    new FFXLevelSceneDesc(341, "Macalania - Hall", [0x6a]),
    // new FFXLevelSceneDesc(342, "Macalania - Monks' Chamber", [0xb2]),
    // new FFXLevelSceneDesc(343, "Macalania - Nuns' Chamber", [0xb3]),
    new FFXLevelSceneDesc(344, "Macalania - Trials", [0xef]),
    new FFXLevelSceneDesc(345, "Macalania - Antechamber", [0x50]),
    new FFXLevelSceneDesc(346, "Macalania - Fayth", [0x11c, 0x184]),
    "Sanubia Desert",
    new FFXLevelSceneDesc(350, "Oasis", [0x81]),
    new FFXLevelSceneDesc(351, "Sanubia Desert - East", [0x88]),
    new FFXLevelSceneDesc(352, "Sanubia Desert - Central", [0x89]),
    new FFXLevelSceneDesc(353, "Sanubia Desert - West", [0x8a]),
    "Al Bhed Home",
    new FFXLevelSceneDesc(354, "Home", [0x82]),
    new FFXLevelSceneDesc(360, "Home - Entrance", [0x114]),
    new FFXLevelSceneDesc(363, "Home - Main Corridor", [0x118]),
    new FFXLevelSceneDesc(364, "Home - Environment Controls", [0xdb]),
    // new FFXLevelSceneDesc(365, "Home - Airship Dock", [0x12f]),
    // new FFXLevelSceneDesc(366, "Home - Living Quarters", [0x11e]),
    // new FFXLevelSceneDesc(367, "Home - Living Quarters", [0x113]),
    // new FFXLevelSceneDesc(368, '368'),
    "Airship",
    // new FFXLevelSceneDesc(382, "Airship - Corridor", [0x15f]),
    // new FFXLevelSceneDesc(385, "Airship - Corridor", [0x109]),
    new FFXLevelSceneDesc(388, "Airship - Bridge", [0xc2, 0xff]),
    // new FFXLevelSceneDesc(392, '392'),
    new FFXLevelSceneDesc(395, "Airship - Deck", [0x115]),
    // new FFXLevelSceneDesc(396, "Airship - Bridge", [0x105]), // white background
    // new FFXLevelSceneDesc(397, '397'),
    // new FFXLevelSceneDesc(398, "another bridge", []),
    new FFXLevelSceneDesc(399, "Airship - Bridge (sunset)", [0x176]),
    new FFXLevelSceneDesc(380, "Airship - Cabin", [0xd3]),
    new FFXLevelSceneDesc(400, "Airship - Cabin", [0x177]),
    new FFXLevelSceneDesc(401, "Airship Map", [0x17e]), // labelled Airship - Bridge, maybe this is for the background?
    // these all seem identical to 401
    // new FFXLevelSceneDesc(460, '460', []),
    // new FFXLevelSceneDesc(461, '461', []),
    // new FFXLevelSceneDesc(462, '462', []),
    // new FFXLevelSceneDesc(463, '463', []),
    // new FFXLevelSceneDesc(464, '464', []),
    // new FFXLevelSceneDesc(465, '465', []),
    "Bevelle",
    new FFXLevelSceneDesc(406, "Bevelle - Main Gate", [0xd0, 0x14a]),
    // new FFXLevelSceneDesc(409, '409'),
    new FFXLevelSceneDesc(410, "Bevelle - Tower of Light", [0xcd]),
    // new FFXLevelSceneDesc(411, "Bevelle - Passage of Cleansing", [0x131]),
    // new FFXLevelSceneDesc(412, "Bevelle - Priests' Passage", [0xb4]),
    // new FFXLevelSceneDesc(413, "Bevelle - Priests' Passage", [0xb5]),
    // new FFXLevelSceneDesc(414, "Bevelle - Priests' Passage", [0xb6]),
    new FFXLevelSceneDesc(415, "Bevelle - The Inquisition", [0xcf]),
    // new FFXLevelSceneDesc(416, "Bevelle - Dungeons", [0x11f]),
    new FFXLevelSceneDesc(419, "Bevelle - Via Purifico", [0xc6, 0xfd]),
    new FFXLevelSceneDesc(405, "Bevelle - Via Purifico (boss)", [0xd1]),
    new FFXLevelSceneDesc(420, "Bevelle - The Two Fates", [0xc3, 0x153]),
    new FFXLevelSceneDesc(421, "Bevelle - Trials", [0x132]),
    new FFXLevelSceneDesc(422, "Bevelle - Antechamber", [0xe2]),
    new FFXLevelSceneDesc(423, "Bevelle - Fayth", [0xe3, 0x186]),
    "Calm Lands",
    new FFXLevelSceneDesc(425, "Calm Lands", [0xdf]),
    new FFXLevelSceneDesc(426, "Calm Lands - Near Bridge", [0x117]),
    new FFXLevelSceneDesc(429, "Calm Lands - Gorge Bottom", [0x10a]),
    new FFXLevelSceneDesc(430, "Cavern of the Stolen Fayth", [0x38]),
    new FFXLevelSceneDesc(431, "Chamber of the Stolen Fayth", [0x11b]),
    // new FFXLevelSceneDesc(432, "Calm Lands - Arena", [0x133]),
    "Remiem Temple",
    new FFXLevelSceneDesc(445, "Remiem Temple", [0x122]),
    new FFXLevelSceneDesc(446, "Remiem - Great Hall", [0x134]),
    new FFXLevelSceneDesc(447, "Remiem - Fayth", [0x174]),
    // new FFXLevelSceneDesc(450, '450', []),
    // new FFXLevelSceneDesc(452, '452', []),
    // new FFXLevelSceneDesc(453, '453', []),
    // new FFXLevelSceneDesc(454, '454', []),
    // new FFXLevelSceneDesc(455, '455', []),
    // new FFXLevelSceneDesc(456, '456', []),
    // new FFXLevelSceneDesc(457, '457', []),
    // new FFXLevelSceneDesc(458, '458', []),
    "Mount Gagazet",
    new FFXLevelSceneDesc(485, "Gagazet - Mountain Gate", [0x103]),
    new FFXLevelSceneDesc(486, "Gagazet - Mountain Trail", [0xf4, 0x17f]),
    new FFXLevelSceneDesc(487, "Gagazet - Prominence", [0x11d]),
    new FFXLevelSceneDesc(488, "Gagazet - Fayth Cluster", [0x135]),
    new FFXLevelSceneDesc(491, "Gagazet - Mountain Cave", [0x110]),
    new FFXLevelSceneDesc(492, "Gagazet - Submerged Passage", [0x136]),
    new FFXLevelSceneDesc(493, "Gagazet - Summit Region", [0x137]),
    new FFXLevelSceneDesc(495, "Gagazet - Summit Region (night)", [0x169]),
    "Zanarkand Ruins",
    new FFXLevelSceneDesc(494, "Road to the Zanarkand Ruins", [0x138]),
    new FFXLevelSceneDesc(496, "Road to the Zanarkand Ruins (night)", [0x16a]),
    new FFXLevelSceneDesc(500, "Zanarkand Ruins (campfire)", [0x16b]),
    new FFXLevelSceneDesc(501, "Zanarkand Ruins", [0x139]),
    new FFXLevelSceneDesc(502, "Zanarkand Ruins - Overpass", [0xe1]),
    "Zanarkand Dome",
    new FFXLevelSceneDesc(503, "Dome", [0x13a]),
    // new FFXLevelSceneDesc(506, "Dome - Front", [0x13b]),
    new FFXLevelSceneDesc(515, "Dome - Interior", [0xde]),
    new FFXLevelSceneDesc(516, "Dome - Corridor", [0x13c]),
    new FFXLevelSceneDesc(522, "Dome - Trials", [0x140]),
    new FFXLevelSceneDesc(517, "Dome - Spectral Keeper", [0x13d], [0x229]),
    new FFXLevelSceneDesc(518, "Dome - Chamber of the Fayth", [0x13e]),
    new FFXLevelSceneDesc(519, "Dome - Great Hall", [0xe0]),
    new FFXLevelSceneDesc(520, "Dome - Great Hall (ruins)", [0x13f]),
    new FFXLevelSceneDesc(521, "Dome - The Beyond", [0x10e]),
    "Fighting Sin",
    new FFXLevelSceneDesc(565, "Airship - Deck", [0xc7]),
    // new FFXLevelSceneDesc(566, "Airship - Deck", [0xc8]), identical
    new FFXLevelSceneDesc(567, "Fighting Sin", [0xc9], /*[0xc5]*/), // official name is still "Airship - Deck"
    new FFXLevelSceneDesc(568, "Airship - Deck (sunset)", [0xca]),
    "Inside Sin",
    // new FFXLevelSceneDesc(580, "Sin - Near Airship", [0x142]),
    new FFXLevelSceneDesc(582, "Sin - Sea of Sorrow", [0xcb]),
    new FFXLevelSceneDesc(583, "Sin - Garden of Pain", [0x128]),
    new FFXLevelSceneDesc(584, "Sin - City of Dying Dreams", [0xcc]),
    new FFXLevelSceneDesc(589, "Sin - Tower of the Dead", [0x147]),
    new FFXLevelSceneDesc(585, "Sin - The Nucleus", [0x144, 0x155]),
    new FFXLevelSceneDesc(586, "Sin - Dream's End", [0x180, 0x145]), // during the boss fight
    new FFXLevelSceneDesc(587, "Sin - Dream's End (final boss)", [0x146]),
    "Omega Ruins",
    new FFXLevelSceneDesc(590, "Omega Ruins (caverns)", [0x102]),
    new FFXLevelSceneDesc(591, "Omega Ruins", [0x10f]),
    "Unused/Test/Menus",
    new FFXLevelSceneDesc(1, 'grid', [0x0]),
    new FFXLevelSceneDesc(2, 'effect test', []),
    new FFXLevelSceneDesc(3, 'blitzball test', []),
    new FFXLevelSceneDesc(4, 'unused blitzball stadium', []),
    // new FFXLevelSceneDesc(5, 'airship exterior', []), // bad palette error?
    // new FFXLevelSceneDesc(6, '6', []), // totally empty?
    new FFXLevelSceneDesc(7, 'blitzball menus', [0xd4, 0x15b]), // white rectangle with water
    new FFXLevelSceneDesc(8, 'airship bridge with Sin', []),
    new FFXLevelSceneDesc(10, '10', [0x129]), // lots of particles
    // new FFXLevelSceneDesc(600, '600', []),
    new FFXLevelSceneDesc(604, 'labelled grid', []),
    new FFXLevelSceneDesc(620, 'besaid (no water)', []),
    // new FFXLevelSceneDesc(621, '621', []),
    new FFXLevelSceneDesc(650, 'via purifico ', []),
    // new FFXLevelSceneDesc(680, '680', []),
    // new FFXLevelSceneDesc(690, '690', [0x17]), // new game menu
    // new FFXLevelSceneDesc(691, '691', [0x124]),
    // new FFXLevelSceneDesc(692, '692', [0x15c]), // titles
    "Battle",
    // FFXLevelSceneDesc.BattleScene(0x01, '1'), // test grid
    FFXLevelSceneDesc.BattleScene(0x02, 'Salvage Ship'),
    FFXLevelSceneDesc.BattleScene(0x03, 'Besaid - Valley'),
    FFXLevelSceneDesc.BattleScene(0x05, 'Besaid - Waterfall Way'),
    FFXLevelSceneDesc.BattleScene(0x04, 'Besaid - Village Slope'),
    FFXLevelSceneDesc.BattleScene(0x06, 'Kilika Forest'),
    FFXLevelSceneDesc.BattleScene(0x07, 'Mi\'ihen Highroad - South'),
    FFXLevelSceneDesc.BattleScene(0x08, 'Highroad - Central'),
    FFXLevelSceneDesc.BattleScene(0x09, 'Highroad - Newroad'),
    FFXLevelSceneDesc.BattleScene(0x0a, 'Highroad - Oldroad'),
    FFXLevelSceneDesc.BattleScene(0x0b, 'Mushroom Rock - Plateau'),
    FFXLevelSceneDesc.BattleScene(0x0c, 'Mushroom Rock - Valley'),
    // FFXLevelSceneDesc.BattleScene(0x0d, 'd'), // palette 0
    FFXLevelSceneDesc.BattleScene(0x0e, 'Mushroom Rock - Beach'),
    FFXLevelSceneDesc.BattleScene(0x0f, 'Djose Highroad'),
    FFXLevelSceneDesc.BattleScene(0x10, 'Moonflow (road)'),
    FFXLevelSceneDesc.BattleScene(0x11, 'Moonflow (forest)'),
    FFXLevelSceneDesc.BattleScene(0x12, 'Thunder Plains'),
    // FFXLevelSceneDesc.BattleScene(0x13, '13'), // palette 0
    FFXLevelSceneDesc.BattleScene(0x14, 'Macalania Forest'),
    FFXLevelSceneDesc.BattleScene(0x15, 'Lake Macalania'),
    FFXLevelSceneDesc.BattleScene(0x17, 'Lake Macalania - Crevasse'),
    FFXLevelSceneDesc.BattleScene(0x16, 'Macalania - Road'),
    FFXLevelSceneDesc.BattleScene(0x18, 'Sanubia Desert - Oasis'),
    // FFXLevelSceneDesc.BattleScene(0x19, '19'), // palette 0
    FFXLevelSceneDesc.BattleScene(0x1a, 'Sanubia Desert'),
    FFXLevelSceneDesc.BattleScene(0x1b, 'Sanubia (cacti)'),
    FFXLevelSceneDesc.BattleScene(0x1c, 'Sanubia Desert - Sandragora'),
    // FFXLevelSceneDesc.BattleScene(0x1d, '1d'), // palette 0
    FFXLevelSceneDesc.BattleScene(0x1e, 'Al Bhed Home'),
    FFXLevelSceneDesc.BattleScene(0x1f, 'Airship'),
    FFXLevelSceneDesc.BattleScene(0x20, 'Bevelle - Tower of Light'),
    FFXLevelSceneDesc.BattleScene(0x21, 'Bevelle - Via Purifico'),
    FFXLevelSceneDesc.BattleScene(0x22, 'Bevelle - Via Purifico (end)'),
    FFXLevelSceneDesc.BattleScene(0x23, 'Bevelle (evrae altana)'),
    FFXLevelSceneDesc.BattleScene(0x24, 'Bevelle - Main Gate'),
    FFXLevelSceneDesc.BattleScene(0x25, 'Calm Lands'),
    FFXLevelSceneDesc.BattleScene(0x27, 'Remiem Temple'),
    // FFXLevelSceneDesc.BattleScene(0x28, '28'), // palette 0
    FFXLevelSceneDesc.BattleScene(0x29, 'Calm Lands - Gorge Bottom'),
    FFXLevelSceneDesc.BattleScene(0x2a, 'Cavern of the Stolen Fayth'),
    FFXLevelSceneDesc.BattleScene(0x2b, 'Cavern of the Stolen Fayth (dead end)'),
    FFXLevelSceneDesc.BattleScene(0x2c, 'Mount Gagazet'),
    FFXLevelSceneDesc.BattleScene(0x2d, 'Gagazet - Mountain Cave'),
    FFXLevelSceneDesc.BattleScene(0x2e, 'Gagazet - Submerged Passage'),
    FFXLevelSceneDesc.BattleScene(0x2f, 'Zanarkand Ruins - Overpass'),
    FFXLevelSceneDesc.BattleScene(0x30, 'Zanarkand Dome'),
    FFXLevelSceneDesc.BattleScene(0x31, 'Sin - Sea of Sorrow'),
    FFXLevelSceneDesc.BattleScene(0x32, 'Sin - City of Dying Dreams'),
    FFXLevelSceneDesc.BattleScene(0x33, 'Sin - The Nucleus'),
    FFXLevelSceneDesc.BattleScene(0x34, 'Omega Ruins (caverns)'),
    FFXLevelSceneDesc.BattleScene(0x35, 'Omega Ruins'),
    FFXLevelSceneDesc.BattleScene(0x39, 'Tutorial'),
    FFXLevelSceneDesc.BattleScene(0x36, 'Kilika - Pilgrimage Road (?)'),
    FFXLevelSceneDesc.BattleScene(0x37, 'Mushroom Rock - Ridge'),
    // FFXLevelSceneDesc.BattleScene(0x38, 'Cavern of the Stolen Fayth'), // duplicate?
    "Magic",
    new FFXMagicSceneDesc(0, "Abilities"),
    new FFXMagicSceneDesc(1, "White Magic"),
    new FFXMagicSceneDesc(2, "Black Magic"),
    // new FFXMagicSceneDesc(3, "Overdrives"),
    new FFXMagicSceneDesc(4, "Ronso"),
    // new FFXMagicSceneDesc(5, "Enemy Abilities"),
    // new FFXMagicSceneDesc(6, "Aeons"),
    // new FFXMagicSceneDesc(7, "Items and Mixes"),
    // new FFXMagicSceneDesc(9, "UI"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, altName: "ffx" };
