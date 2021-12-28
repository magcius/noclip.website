
import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as BYML from '../byml';

import * as F3DEX from '../BanjoKazooie/f3dex';


import * as Shadows from './shadows';
import { GloverTextureHolder } from './textures';


import { GloverActorRenderer, GloverBackdropRenderer, GloverFlipbookRenderer } from './render';

import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { TextureHolder } from '../TextureHolder';
import { mat4, vec3, vec4, quat } from 'gl-matrix';
import { SceneContext } from '../SceneBase';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { executeOnPass, makeSortKey, GfxRendererLayer } from '../gfx/render/GfxRenderInstManager';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { assert, hexzero, assertExists } from '../util';
import { DataFetcher } from '../DataFetcher';
import { MathConstants, scaleMatrix, computeMatrixWithoutScale } from '../MathHelpers';
import { colorNewFromRGBA } from '../Color';

import { Yellow, colorNewCopy, Magenta, White } from "../Color";
import { drawWorldSpaceLine, drawWorldSpacePoint, drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk";

import { CameraController } from '../Camera';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { makeAttachmentClearDescriptor, makeBackbufferDescSimple, standardFullClearRenderPassDescriptor, opaqueBlackFullClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from '../gfx/helpers/RenderGraphHelpers';

import { GloverLevel, GloverObjbank, GloverTexbank } from './parsers';
import { decompress } from './fla2';
import { framesets, collectibleFlipbooks } from './framesets';


import { KaitaiStream } from 'kaitai-struct';

const SRC_FRAMERATE = 20;
const DST_FRAMERATE = 60;
const SRC_FRAME_TO_MS = (1/SRC_FRAMERATE)*1000;
const DST_FRAME_TO_MS = (1/DST_FRAMERATE)*1000;
const CONVERT_FRAMERATE = (SRC_FRAMERATE / DST_FRAMERATE);

const pathBase = `glover`;

class PlatformPathPoint {
    constructor(public pos: vec3, public duration: number) {}

    public toString() {
        return "PathPoint("+this.pos+","+this.duration+")";
    }
}

export class GloverPlatform implements Shadows.ShadowCaster {

    private scratchMatrix = mat4.create();
    private scratchVec3 = vec3.create();

    public shadow: Shadows.Shadow | null = null;
    public shadowSize: number | Shadows.ConstantShadowSize = 0;

    // Spin

    private spinSpeed = vec3.fromValues(0,0,0);

    // General actor state

    private eulers = vec3.fromValues(0,0,0);
    private rotation = quat.create();
    private position = vec3.fromValues(0,0,0);
    private velocity = vec3.fromValues(0,0,0);
    private scale = vec3.fromValues(1,1,1);

    public parent: GloverPlatform | undefined = undefined;

    // Path
    // TODO: use time deltas instead of frames for this
    
    private path : PlatformPathPoint[] = [];
    private pathDirection : number = 1;
    private pathTimeLeft : number = 0;
    private pathCurPt : number = 0;
    private pathPaused : boolean = false;
    public pathAccel : number = 0;
    public pathMaxVel : number = NaN;

    // Implementation

    constructor(
        public actor: GloverActorRenderer)
    { }

    public pushPathPoint(point: PlatformPathPoint) {
        this.path.push(point);
        if (this.path.length == 1) {
            this.setPosition(point.pos[0], point.pos[1], point.pos[2]);
            this.pathTimeLeft = point.duration;
            this.pathPaused = point.duration < 0;
            this.updateActorModelMatrix();
        }
    }

    public setPosition(x: number, y: number, z: number) {
        this.position[0] = x;
        this.position[1] = y;
        this.position[2] = z;
    }

    public getPosition(): vec3 {
        return this.position;
    }

    public setScale(x: number, y: number, z: number) {
        this.scale[0] = x;
        this.scale[1] = y;
        this.scale[2] = z;
    }

    public setNeutralSpin(axis: number, initial_theta: number, speed: number) {
        this.eulers[axis] = initial_theta * 180 / Math.PI;
        this.spinSpeed[axis] = -speed;
    }

    public updateActorModelMatrix() {
        quat.fromEuler(this.rotation, this.eulers[0], this.eulers[1], this.eulers[2]);
        let finalPosition = this.position;
        if (this.parent !== undefined) {
            finalPosition = this.scratchVec3
            vec3.add(finalPosition, this.position, this.parent.position);
        }
        mat4.fromRotationTranslationScale(this.actor.modelMatrix, this.rotation, finalPosition, this.scale);
    }

    public advanceFrame(deltaTime : number, viewerInput : Viewer.ViewerRenderInput | null = null): void {
        // TODO: make sure this actually pauses

        if (deltaTime == 0) {
            return;
        }

        let curSpeed = vec3.length(this.velocity);

        if (this.path.length > 0) {
            const dstPt = this.path[this.pathCurPt].pos;
            const journeyVector = this.scratchVec3;
            vec3.sub(journeyVector, dstPt, this.position);
            const distRemaining = vec3.length(journeyVector);
            vec3.normalize(journeyVector, journeyVector);

            // TODO: remove
            // if (viewerInput !== null) {
            //     drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.position, '' + this.path, 0, White, { outline: 6 });
            // }

            let effectiveAccel = this.pathAccel;
            const speedCutoff = ((this.pathAccel + curSpeed) * curSpeed) / (2*this.pathAccel);
            if (speedCutoff > distRemaining) {
                // This is more accurate than the active version of this code block,
                // but IMO looks worse:
                // if (curSpeed > distRemaining) {
                //     vec3.scaleAndAdd(this.velocity, this.velocity, journeyVector, -effectiveAccel);
                // }
                vec3.scaleAndAdd(this.velocity, this.velocity, journeyVector, -effectiveAccel);
            } else {
                vec3.scaleAndAdd(this.velocity, this.velocity, journeyVector, effectiveAccel);
            }

            if (!isNaN(this.pathMaxVel) && curSpeed > this.pathMaxVel) {
                const damping = this.pathMaxVel / curSpeed;
                this.velocity[0] *= damping;
                this.velocity[1] *= damping;
                this.velocity[2] *= damping;
            }


            if (!this.pathPaused) {
                if (this.pathTimeLeft > 0) {
                    this.pathTimeLeft -= deltaTime;
                } else {
                    if (distRemaining < curSpeed + 0.01) {
                        this.pathCurPt = (this.pathCurPt + this.pathDirection) % this.path.length;
                        this.pathTimeLeft = this.path[this.pathCurPt].duration;
                        this.pathPaused = this.path[this.pathCurPt].duration < 0;
                        vec3.copy(this.position, dstPt);
                        vec3.zero(this.velocity);
                        curSpeed = 0;
                    }                
                }
            }
        }

        // TODO: add deceleration
        vec3.add(this.position, this.position, this.velocity);

        this.eulers[0] += this.spinSpeed[0] * deltaTime;
        this.eulers[1] += this.spinSpeed[1] * deltaTime;
        this.eulers[2] += this.spinSpeed[2] * deltaTime;
        this.eulers[0] = this.eulers[0] % 360;
        this.eulers[1] = this.eulers[1] % 360;
        this.eulers[2] = this.eulers[2] % 360;

        this.updateActorModelMatrix()
    }
}

class GloverRenderer implements Viewer.SceneGfx {
    public opaqueActors: GloverActorRenderer[] = [];
    public translucentActors: GloverActorRenderer[] = [];
    public backdrops: GloverBackdropRenderer[] = [];
    public flipbooks: GloverFlipbookRenderer[] = [];

    public shadows: Shadows.Shadow[] = [];
    public platforms: GloverPlatform[] = [];
    public platformByTag = new Map<number, GloverPlatform>();


    public renderHelper: GfxRenderHelper;

    public renderPassDescriptor = standardFullClearRenderPassDescriptor; 

    private initTime: number;

    constructor(device: GfxDevice, public textureHolder: GloverTextureHolder) {
        this.renderHelper = new GfxRenderHelper(device);
        this.initTime = Date.now();
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(30/60);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();

        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');

        const hideDynamicsCheckbox = new UI.Checkbox('Hide dynamic objects', false);
        hideDynamicsCheckbox.onchanged = () => {
            for (let platform of this.platforms) {
                platform.actor.visible = !hideDynamicsCheckbox.checked;
            }
        };
        renderHacksPanel.contents.appendChild(hideDynamicsCheckbox.elem);

        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let actor of this.opaqueActors) {
                actor.setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
            }
            for (let actor of this.translucentActors) {
                actor.setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
            }

        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);

        const madGaribsCheckbox = new UI.Checkbox('Mad garibs', false);
        madGaribsCheckbox.onchanged = () => {
            // C-Down, C-Right, C-Down, C-Up, C-Left, C-Down, C-Left, C-Up
            const flipbookMetadata = madGaribsCheckbox.checked ? collectibleFlipbooks.get(3) : collectibleFlipbooks.get(0);
            for (let flipbook of this.flipbooks) {
                if (flipbook.isGarib) {
                    flipbook.reloadFrameset(flipbookMetadata!);
                }
            }
        };
        renderHacksPanel.contents.appendChild(madGaribsCheckbox.elem);


        const enableDebugInfoCheckbox = new UI.Checkbox('Show debug information', false);
        enableDebugInfoCheckbox.onchanged = () => {
            for (let actor of this.opaqueActors) {
                actor.setDebugInfoVisible(enableDebugInfoCheckbox.checked);
            }
            for (let actor of this.translucentActors) {
                actor.setDebugInfoVisible(enableDebugInfoCheckbox.checked);
            }
        };
        renderHacksPanel.contents.appendChild(enableDebugInfoCheckbox.elem);

        return [renderHacksPanel];

    }

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();

        this.textureHolder.animatePalettes(viewerInput);

        for (let platform of this.platforms) {
            platform.advanceFrame(viewerInput.deltaTime, viewerInput);
        }

        for (let renderer of this.backdrops) {
            renderer.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        }
        for (let renderer of this.opaqueActors) {
            renderer.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
            
            // TODO: remove
            // let pos = vec3.fromValues(
            //     renderer.modelMatrix[12],
            //     renderer.modelMatrix[13],
            //     renderer.modelMatrix[14],
            // );
            // drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, pos, renderer.actorObject.objId.toString(16), 0, White, { outline: 6 });
        }
        for (let renderer of this.shadows) {
            renderer.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        }
        for (let renderer of this.flipbooks) {
            renderer.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        }
        for (let renderer of this.translucentActors) {
            // TODO: use sort key to order by camera distance
            renderer.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);

            // TODO: remove
            // let pos = vec3.fromValues(
            //     renderer.modelMatrix[12],
            //     renderer.modelMatrix[13],
            //     renderer.modelMatrix[14],
            // );
            // drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, pos, renderer.actorObject.objId.toString(16), 0, White, { outline: 6 });
        }

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) : void {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, this.renderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, this.renderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);

        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();

        for (let renderer of this.opaqueActors) {
            renderer.destroy(device);
        }
        for (let renderer of this.translucentActors) {
            renderer.destroy(device);
        }
        for (let renderer of this.backdrops) {
            renderer.destroy(device);
        }
        for (let renderer of this.flipbooks) {
            renderer.destroy(device);
        }

        this.textureHolder.destroy(device);
    }
}


interface GloverSceneBankDescriptor {
    landscape: string,
    object_banks: string[],
    texture_banks: string[],
    backdrop_primitive_color?: number[]
};

// Level ID to bank information
// TODO: move this into an external ts file
const sceneBanks = new Map<string, GloverSceneBankDescriptor>([
    ["00", {
        landscape: "00.HUB1ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART1.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"],
        backdrop_primitive_color: [0xff, 0xff, 0xff, 0xff]
    }], //"Hub 1"),
    ["01", {
        landscape: "01.HUB2ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART2.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"],
        backdrop_primitive_color: [0xff, 0xff, 0xff, 0xff]
    }], //"Hub 2"),
    ["02", {
        landscape: "02.HUB3ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART3.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"],
        backdrop_primitive_color: [0xff, 0x3c, 0x00, 0xff]
    }], //"Hub 3"),
    ["03", {
        landscape: "03.HUB4ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART4.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"],
        backdrop_primitive_color: [0xff, 0x80, 0x00, 0xff]
    }], //"Hub 4"),
    ["04", {
        landscape: "04.HUB5ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART5.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"],
        backdrop_primitive_color: [0xc8, 0xc8, 0xff, 0xff]
    }], //"Hub 5"),
    ["05", {
        landscape: "05.HUB6ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART6.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"],
        backdrop_primitive_color: [0xe6, 0xff, 0xff, 0xff]
    }], //"Hub 6"),
    ["06", {
        landscape: "06.HUB7ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART7.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"],
        backdrop_primitive_color: [0xff, 0xff, 0xff, 0x64]
    }], //"Hub 7"),
    ["07", {
        landscape: "07.HUB8ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART8.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"],
        backdrop_primitive_color: [0xff, 0xff, 0xff, 0xff]
    }], //"Hub 8"),

    ["08", {
        // TODO:
        //      - not loading all crystal textures properly (likely)
        //        has to do with non-indexed textures in dynamic models,
        //        which i was winging -- double check them
        landscape: "08.CAVEln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "CAVE.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"]
    }], //"Castle Cave"),
    ["09", {
        landscape: "09.ACOURSE.n64.lev",
        object_banks: ["GENERIC.obj.fla", "ASSAULT COURSE.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"]
    }], //"Assault Course"),
    ["2a", {
        landscape: "42.WAYROOM.n64.lev",
        object_banks: ["GENERIC.obj.fla", "WAYROOM.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"]
    }], //"Wayroom"),
    /////////////////////////////////////////////////////////


    ["0a", {
        landscape: "10.AT1lnd.n64.lev",
        object_banks: ["GENERIC.obj.fla", "ATLANTIS_SHARED.obj.fla", "ATLANTIS_L1.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "ATLANTIS_TEX_BANK.tex.fla"]}],
    ["0b", {
        landscape: "11.AT2lnd.n64.lev",
        object_banks: ["GENERIC.obj.fla", "ATLANTIS_SHARED.obj.fla", "ATLANTIS_L2.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "ATLANTIS_TEX_BANK.tex.fla"]}],
    ["0c", { // TODO: figure out why this is crashing
        landscape: "12.AT3Aln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "ATLANTIS_SHARED.obj.fla", "ATLANTIS_L3A.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "ATLANTIS_TEX_BANK.tex.fla"]}],
    ["0d", {
        landscape: "13.ATBOSS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "ATLANTIS_SHARED.obj.fla", "ATLANTIS_BOSS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "ATLANTIS_TEX_BANK.tex.fla"]}],
    ["0e", {
        landscape: "14.ATBONUS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "ATLANTIS_SHARED.obj.fla", "ATLANTIS_BONUS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "ATLANTIS_TEX_BANK.tex.fla"]}],

    ["0f", {
        landscape: "15.CK1lnd.n64.lev",
        object_banks: ["GENERIC.obj.fla", "CARNIVAL_SHARED.obj.fla", "CARNIVAL_L1.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "CARNIVAL_TEX_BANK.tex.fla"]}],
    ["10", {
        landscape: "16.CK2Aln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "CARNIVAL_SHARED.obj.fla", "CARNIVAL_L2A.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "CARNIVAL_TEX_BANK.tex.fla"]}],
    ["11", {
        landscape: "17.CK3Aln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "CARNIVAL_SHARED.obj.fla", "CARNIVAL_L3A.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "CARNIVAL_TEX_BANK.tex.fla"]}],
    ["12", {
        landscape: "18.CKBOSS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "CARNIVAL_SHARED.obj.fla", "CARNIVAL_BOSS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "CARNIVAL_TEX_BANK.tex.fla"]}],
    ["13", { // TODO: figure out cheat code/easter egg bank hackery
        landscape: "19.CKBONUS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "CARNIVAL_SHARED.obj.fla", "CARNIVAL_BONUS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "CARNIVAL_TEX_BANK.tex.fla"]}],
    ["14", {
        landscape: "20.PC1lnd.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PIRATES_SHARED.obj.fla", "PIRATES_L1.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PIRATES_TEX_BANK.tex.fla"]
    }],
    ["15", {
        landscape: "21.PC2Aln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PIRATES_SHARED.obj.fla", "PIRATES_L2A.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PIRATES_TEX_BANK.tex.fla"]
    }],
    ["16", {
        landscape: "22.PC3Bln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PIRATES_SHARED.obj.fla", "PIRATES_L3B.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PIRATES_TEX_BANK.tex.fla"]
    }],
    ["17", {
        landscape: "23.PCBOSS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PIRATES_SHARED.obj.fla", "PIRATES_BOSS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PIRATES_TEX_BANK.tex.fla"]
    }],
    ["18", {
        landscape: "24.PCBONUS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PIRATES_SHARED.obj.fla", "PIRATES_BONUS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PIRATES_TEX_BANK.tex.fla"]
    }],
    ["19", {
        landscape: "25.PH1Aln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PREHISTORIC_SHARED.obj.fla", "PREHISTORIC_L1A.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PREHISTORIC_TEX_BANK.tex.fla"]
    }],
    ["1a", { // TODO: lava should have water animation
        landscape: "26.PH2Aln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PREHISTORIC_SHARED.obj.fla", "PREHISTORIC_L2A.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PREHISTORIC_TEX_BANK.tex.fla"]
    }],
    ["1b", {
        landscape: "27.PH3Bln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PREHISTORIC_SHARED.obj.fla", "PREHISTORIC_L3B.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PREHISTORIC_TEX_BANK.tex.fla"]
    }],
    ["1c", {
        landscape: "28.PHBOSS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PREHISTORIC_SHARED.obj.fla", "PREHISTORIC_BOSS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PREHISTORIC_TEX_BANK.tex.fla"]
    }],
    ["1d", {
        landscape: "29.PHBONUS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PREHISTORIC_SHARED.obj.fla", "PREHISTORIC_BONUS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PREHISTORIC_TEX_BANK.tex.fla"]
    }],

    ["1e", {
        landscape: "30.FF1Aln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "FORTRESS_SHARED.obj.fla", "FORTRESS_L1A.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "FORTRESS_TEX_BANK.tex.fla"]
    }],
    ["1f", {
        landscape: "31.FF2Aln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "FORTRESS_SHARED.obj.fla", "FORTRESS_L2A.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "FORTRESS_TEX_BANK.tex.fla"]
    }],
    ["20", {
        landscape: "32.FF3Bln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "FORTRESS_SHARED.obj.fla", "FORTRESS_L3B.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "FORTRESS_TEX_BANK.tex.fla"]
    }],
    ["21", {
        landscape: "33.FFBOSS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "FORTRESS_SHARED.obj.fla", "FORTRESS_BOSS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "FORTRESS_TEX_BANK.tex.fla"]
    }],
    ["22", {
        landscape: "34.FFBONUS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "FORTRESS_SHARED.obj.fla", "FORTRESS_BONUS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "FORTRESS_TEX_BANK.tex.fla"]
    }],

    ["23", {
        landscape: "35.OW2Aln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "OOTW_SHARED.obj.fla", "OOTW_L2A.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "OOTW_TEX_BANK.tex.fla"]
    }],
    ["24", {
        landscape: "36.OW2Bln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "OOTW_SHARED.obj.fla", "OOTW_L2B.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "OOTW_TEX_BANK.tex.fla"]
    }],
    ["25", {
        landscape: "37.OW3lnd.n64.lev",
        object_banks: ["GENERIC.obj.fla", "OOTW_SHARED.obj.fla", "OOTW_L3.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "OOTW_TEX_BANK.tex.fla"]
    }],
    ["26", {
        landscape: "38.OWBOSS1.n64.lev",
        object_banks: ["GENERIC.obj.fla", "OOTW_SHARED.obj.fla", "OOTW_BOSS1.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "OOTW_TEX_BANK.tex.fla"]
    }],
    ["27", {
        landscape: "39.TWEENl.n64.lev",
        object_banks: ["GENERIC.obj.fla", "OOTW_SHARED.obj.fla", "TWEEN.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "OOTW_TEX_BANK.tex.fla"]
    }],
    ["28", {
        landscape: "40.OWBOSS3.n64.lev",
        object_banks: ["GENERIC.obj.fla", "OOTW_SHARED.obj.fla", "OOTW_BOSS1.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "OOTW_TEX_BANK.tex.fla"]
    }],
    ["29", {
        landscape: "41.OWBONUS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "OOTW_SHARED.obj.fla", "OOTW_BONUS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "OOTW_TEX_BANK.tex.fla"]
    }],

    ["2c", {
        landscape: "44.FLYTHRU.n64.lev",
        object_banks: ["GENERIC.obj.fla", "FLYTHRU.obj.fla", "HUB_PART7.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "FLYTHRU_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"]
    }], // "Flythru (title)"
    ["2d", {
        landscape: "45.FLYTHRU.n64.lev",
        object_banks: ["GENERIC.obj.fla", "FLYTHRU.obj.fla", "HUB_PART7.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "FLYTHRU_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"]
    }], // "Flythru (credits)"
    ["2e", {
        landscape: "46.INTROl.n64.lev",
        object_banks: ["GENERIC.obj.fla", "INTRO.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "CAMEO_TEX_BANK.tex.fla"]
    }], // "Intro cutscene"
    ["2f", {
        landscape: "47.OUTROl.n64.lev",
        object_banks: ["GENERIC.obj.fla", "OUTRO.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "CAMEO_TEX_BANK.tex.fla"]
    }], // "Outro cutscene"

    ["2b", {
        landscape: "43.PRESENT.n64.lev",
        object_banks: ["GENERIC.obj.fla", "PRESENTATION.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "PRESENT_TEX_BANK.tex.fla"]
    }], // "Presentation (studio logos)"

    // TODO: compose artificial menu screen scene
]);

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;

        const bankDescriptor = sceneBanks.get(this.id);
        assert(bankDescriptor !== undefined);

        const raw_landscape = await dataFetcher.fetchData(`${pathBase}/${bankDescriptor.landscape}?cache_bust=2`)!; 
        const raw_object_banks = await Promise.all<ArrayBufferSlice>(bankDescriptor.object_banks.map(
            (filename:string) => return dataFetcher.fetchData(`${pathBase}/${filename}?cache_bust=2`)!))
        const raw_texture_banks = await Promise.all<ArrayBufferSlice>(bankDescriptor.texture_banks.map(
            (filename:string) => return dataFetcher.fetchData(`${pathBase}/${filename}?cache_bust=2`)!))


        const landscape = new GloverLevel(new KaitaiStream(raw_landscape.arrayBuffer));
        const object_banks = raw_object_banks.map(
            (raw) => { return raw == null ? null : new GloverObjbank(new KaitaiStream(decompress(raw).arrayBuffer))})
        const texture_banks = raw_texture_banks.map(
            (raw) => { return raw == null ? null : new GloverTexbank(new KaitaiStream(decompress(raw).arrayBuffer))})

        const textureHolder = new GloverTextureHolder();
        const sceneRenderer = new GloverRenderer(device, textureHolder);
        const cache = sceneRenderer.renderHelper.getCache();

        for (let bank of texture_banks) {
            if (bank) {
                textureHolder.addTextureBank(device, bank);
            }
        }

        let loadedObjects = new Map<number, GloverObjbank.ObjectRoot>()
        for (let bank of object_banks) {
            if (bank) {
                for (let entry of bank.directory) {
                    loadedObjects.set(entry.objId, entry.objRoot);
                }
            }
        }

        Shadows.Shadow.initializeRenderer(device, cache, textureHolder);

        let scratchMatrix = mat4.create();
        let currentActor: GloverActorRenderer | null = null; 
        let currentPlatform: GloverPlatform | null = null; 
        let currentObject: GloverActorRenderer | GloverPlatform | null = null;

        function loadActor(id : number) : GloverActorRenderer {
            const objRoot = loadedObjects.get(id);
            if (objRoot === undefined) {
                throw `Object 0x${id.toString(16)} is not loaded!`;
            }
            let new_actor = new GloverActorRenderer(device, cache, textureHolder, objRoot, mat4.create());
            if ((objRoot.mesh.renderMode & 0x2) == 0) {
                sceneRenderer.opaqueActors.push(new_actor)
            } else {
                sceneRenderer.translucentActors.push(new_actor)
            }
            return new_actor;
        }

        let skyboxClearColor = [0,0,0];

        let shadowCasters: Shadows.ShadowCaster[] = [];

        for (let cmd of landscape.body) {
            if (cmd.params === undefined) {
                continue;
            }
            switch (cmd.params.__type) {
                case 'Water': {
                    currentActor = loadActor(cmd.params.objectId);
                    currentObject = currentActor;
                    mat4.fromTranslation(currentActor.modelMatrix, [cmd.params.x, cmd.params.y, cmd.params.z]);
                    currentActor.setRenderMode(0x20, 0x20);
                    break;
                }
                case 'LandActor':
                case 'BackgroundActor0xbc':
                case 'BackgroundActor0x91': {
                    currentActor = loadActor(cmd.params.objectId);
                    currentObject = currentActor;
                    mat4.fromTranslation(currentActor.modelMatrix, [cmd.params.x, cmd.params.y, cmd.params.z]);
                    break;
                }
                case 'SetActorRotation': {
                    if (currentActor === null) {
                        throw `No active actor for ${cmd.params.__type}!`;
                    }
                    // TODO: confirm rotation order
                    //       using both the water vents in pirates 1 and the flags at the exit of fortress 3
                    mat4.fromZRotation(scratchMatrix, cmd.params.z);
                    mat4.mul(currentActor.modelMatrix, currentActor.modelMatrix, scratchMatrix);
                    mat4.fromYRotation(scratchMatrix, cmd.params.y);
                    mat4.mul(currentActor.modelMatrix, currentActor.modelMatrix, scratchMatrix);
                    mat4.fromXRotation(scratchMatrix, cmd.params.x);
                    mat4.mul(currentActor.modelMatrix, currentActor.modelMatrix, scratchMatrix);
                    break;
                }
                case 'SetActorScale': {
                    if (currentActor === null) {
                        throw `No active actor for ${cmd.params.__type}!`;
                    }
                    mat4.scale(currentActor.modelMatrix, currentActor.modelMatrix, [cmd.params.x, cmd.params.y, cmd.params.z]);
                    break;
                }
                case 'FogConfiguration': {
                    // TODO: this isn't actually the right
                    //       skybox background color (that comes from
                    //       generic world data), but it'll do for now.
                    //       later, rip out the skybox values from ROM
                    //       and use them instead
                    skyboxClearColor = [cmd.params.r/255, cmd.params.g/255, cmd.params.b/255];
                    break;
                }
                case 'Platform': {
                    // TODO: special case exitpost.ndo
                    currentPlatform = new GloverPlatform(loadActor(cmd.params.objectId));
                    currentObject = currentPlatform;
                    sceneRenderer.platforms.push(currentPlatform)
                    break;
                }
                case 'PlatSetInitialPos': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    currentPlatform.setPosition(cmd.params.x, cmd.params.y, cmd.params.z);
                    break;
                }
                case 'PlatSpin0x7f': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    // TODO: account for frame rate difference?
                    currentPlatform.setNeutralSpin(cmd.params.axis, cmd.params.initialTheta, cmd.params.speed);
                    break;
                }
                case 'PlatScale': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    currentPlatform.setScale(cmd.params.x, cmd.params.y, cmd.params.z);
                    break;
                }
                case 'PlatPathPoint': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    const duration = (cmd.params.duration == 0) ? SRC_FRAME_TO_MS : cmd.params.duration * SRC_FRAME_TO_MS;
                    currentPlatform.pushPathPoint(new PlatformPathPoint(
                        vec3.fromValues(cmd.params.x, cmd.params.y, cmd.params.z), duration))
                    break;
                }
                case 'PlatPathAcceleration': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    currentPlatform.pathAccel = cmd.params.acceleration * CONVERT_FRAMERATE;
                    break;
                }
                case 'PlatMaxVelocity': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    currentPlatform.pathMaxVel = cmd.params.velocity * CONVERT_FRAMERATE;
                    break;
                }
                case 'PlatSetParent': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    const parent = sceneRenderer.platformByTag.get(cmd.params.tag);
                    if (parent === null) {
                        throw `No parent tagged ${cmd.params.tag}!`;   
                    }
                    currentPlatform.parent = parent;
                    break;
                }
                case 'PlatSetTag': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    sceneRenderer.platformByTag.set(cmd.params.tag, currentPlatform);
                    break;
                }
                case 'PlatCheckpoint': {
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    currentPlatform.shadowSize = new Shadows.ConstantShadowSize(20); // From engine
                    shadowCasters.push(currentPlatform);
                    break;
                }
                case 'PlatVentAdvanceFrames': {
                    // TODO: support vent objects, too
                    if (currentPlatform === null) {
                        throw `No active platform for ${cmd.params.__type}!`;
                    }
                    for (let i = 0; i < cmd.params.numFrames / CONVERT_FRAMERATE; i++) {
                        currentPlatform.advanceFrame(DST_FRAME_TO_MS);
                    }
                    break;
                }
                case 'Garib': {
                    // TODO: extra lives don't look right,
                    //       investigate what else they need
                    //       to render properly
                    const flipbookMetadata = collectibleFlipbooks.get(cmd.params.type);
                    if (flipbookMetadata === undefined) {
                        throw `Unrecognized collectible type!`;
                    }
                    const startFrame = Math.floor(Math.random() * flipbookMetadata.frameset.length);
                    const flipbook = new GloverFlipbookRenderer(device, cache, textureHolder, flipbookMetadata, startFrame)
                    flipbook.isGarib = cmd.params.type == 0;
                    mat4.fromTranslation(flipbook.drawMatrix, [cmd.params.x, cmd.params.y, cmd.params.z]);
                    sceneRenderer.flipbooks.push(flipbook);
                    shadowCasters.push(flipbook);
                    break;
                }

                case 'Backdrop': {
                    assert(cmd.params.decalPosX === 0 && cmd.params.decalPosY === 0);
                    assert(cmd.params.decalParentIdx === 0);
                    assert(cmd.params.scrollSpeedX > 0);
                    // TODO: implement alternative primitive colors for hub world
                    const backdrops = sceneRenderer.backdrops;
                    let idx = 0;
                    for (; idx < backdrops.length; idx++) {
                        if (backdrops[idx].sortKey < cmd.params.sortKey) {
                            break;
                        } else if (backdrops[idx].textureId === cmd.params.textureId && backdrops[idx].sortKey === cmd.params.sortKey) {
                            break;
                        }
                    }
                    if (bankDescriptor.backdrop_primitive_color === undefined) {
                        bankDescriptor.backdrop_primitive_color = [0xFF, 0xFF, 0xFF, 0xFF];
                    }
                    sceneRenderer.backdrops.splice(idx, 0, new GloverBackdropRenderer(device, cache, textureHolder, cmd.params, bankDescriptor.backdrop_primitive_color));
                    break;
                }
            }
        }

        for (let platform of sceneRenderer.platforms) {
            platform.updateActorModelMatrix();
        }

        const shadowTerrain = sceneRenderer.opaqueActors; // TODO: figure out actual list
        for (let shadowCaster of shadowCasters) {
            sceneRenderer.shadows.push(new Shadows.Shadow(shadowCaster, shadowTerrain));
        }

        sceneRenderer.renderPassDescriptor = makeAttachmentClearDescriptor(
            colorNewFromRGBA(skyboxClearColor[0], skyboxClearColor[1], skyboxClearColor[2]));

        return sceneRenderer;
    }
}

// Names taken from landscape file metadata
const id = `gv`;
const name = "Glover";

const sceneDescs = [
    "Hub world",
    new SceneDesc(`00`, "Hub 1"),
    new SceneDesc(`01`, "Hub 2"),
    new SceneDesc(`02`, "Hub 3"),
    new SceneDesc(`03`, "Hub 4"),
    new SceneDesc(`04`, "Hub 5"),
    new SceneDesc(`05`, "Hub 6"),
    new SceneDesc(`06`, "Hub 7"),
    new SceneDesc(`07`, "Hub 8"),
    new SceneDesc(`08`, "Castle Cave"),
    new SceneDesc(`09`, "Assault Course"),
    new SceneDesc(`2a`, "Wayroom"),

    "Atlantis"
    new SceneDesc(`0a`, "Atlantis Level 1"),
    new SceneDesc(`0b`, "Atlantis Level 2"),
    new SceneDesc(`0c`, "Atlantis Level 3"),
    new SceneDesc(`0d`, "Atlantis Boss"),
    new SceneDesc(`0e`, "Atlantis Bonus"),

    "Carnival"
    new SceneDesc(`0f`, "Carnival Level 1"),
    new SceneDesc(`10`, "Carnival Level 2"),
    new SceneDesc(`11`, "Carnival Level 3"),
    new SceneDesc(`12`, "Carnival Boss"),
    new SceneDesc(`13`, "Carnival Bonus"),

    "Pirate's Cove"
    new SceneDesc(`14`, "Pirate's Cove Level 1"),
    new SceneDesc(`15`, "Pirate's Cove Level 2"),
    new SceneDesc(`16`, "Pirate's Cove Level 3"),
    new SceneDesc(`17`, "Pirate's Cove Boss"),
    new SceneDesc(`18`, "Pirate's Cove Bonus"),

    "Prehistoric"
    new SceneDesc(`19`, "Prehistoric Level 1"),
    new SceneDesc(`1a`, "Prehistoric Level 2"),
    new SceneDesc(`1b`, "Prehistoric Level 3"),
    new SceneDesc(`1c`, "Prehistoric Boss"),
    new SceneDesc(`1d`, "Prehistoric Bonus"),

    "Fortress of Fear"
    new SceneDesc(`1e`, "Fortress of Fear Level 1"),
    new SceneDesc(`1f`, "Fortress of Fear Level 2"),
    new SceneDesc(`20`, "Fortress of Fear Level 3"),
    new SceneDesc(`21`, "Fortress of Fear Boss"),
    new SceneDesc(`22`, "Fortress of Fear Bonus"),

    "Out Of This World"
    new SceneDesc(`23`, "Out Of This World Level 1"),
    new SceneDesc(`24`, "Out Of This World Level 2"),
    new SceneDesc(`25`, "Out Of This World Level 3"),
    new SceneDesc(`26`, "Out Of This World Boss (phase 1)"),
    new SceneDesc(`27`, "Out Of This World Boss (phase 2)"),
    new SceneDesc(`28`, "Out Of This World Boss (phase 3)"),
    new SceneDesc(`29`, "Out Of This World Bonus"),

    "System",
    new SceneDesc(`2c`, "Flythru (title)"),
    new SceneDesc(`2d`, "Flythru (credits)"),
    new SceneDesc(`2e`, "Intro cutscene"),
    new SceneDesc(`2f`, "Outro cutscene"),
    new SceneDesc(`2b`, "Presentation (studio logos)"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
