
import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as BYML from '../byml';

import * as F3DEX from '../BanjoKazooie/f3dex';


import { GloverTextureHolder } from './textures';


import { GloverActorRenderer } from './render';

import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { TextureHolder } from '../TextureHolder';
import { mat4, vec3, vec4 } from 'gl-matrix';
import { SceneContext } from '../SceneBase';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { executeOnPass, makeSortKey, GfxRendererLayer } from '../gfx/render/GfxRenderInstManager';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { assert, hexzero, assertExists } from '../util';
import { DataFetcher } from '../DataFetcher';
import { MathConstants, scaleMatrix } from '../MathHelpers';

import { CameraController } from '../Camera';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from '../gfx/helpers/RenderGraphHelpers';

import { GloverLevel, GloverObjbank, GloverTexbank } from './parsers';
import { decompress } from './fla2';

import { KaitaiStream } from 'kaitai-struct';


const pathBase = `glover`;

class GloverRenderer implements Viewer.SceneGfx {
    public opaqueActors: GloverActorRenderer[] = [];
    public translucentActors: GloverActorRenderer[] = [];

    public renderHelper: GfxRenderHelper;

    private initTime: number;

    constructor(device: GfxDevice, public textureHolder: GloverTextureHolder) {
        this.renderHelper = new GfxRenderHelper(device);
        this.initTime = Date.now();
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(30/60);
    }

    public createPanels(): UI.Panel[] {
        return [];
    }

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();

        this.textureHolder.animatePalettes(viewerInput);

        for (let actorRenderer of this.opaqueActors) {
            actorRenderer.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        }
        for (let actorRenderer of this.translucentActors) {
            // TODO: use sort key to order by camera distance
            actorRenderer.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        }


        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) : void {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);

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

        for (let actorRenderer of this.opaqueActors) {
            actorRenderer.destroy(device);
        }
        for (let actorRenderer of this.translucentActors) {
            actorRenderer.destroy(device);
        }

        this.textureHolder.destroy(device);
    }
}


interface GloverSceneBankDescriptor {
    landscape: string,
    object_banks: string[],
    texture_banks: string[]
};

// Level ID to bank information
// TODO, do the system levels
const sceneBanks = new Map<string, GloverSceneBankDescriptor>([
    ["00", {
        landscape: "00.HUB1ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART1.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"]
    }], //"Hub 1"),
    ["01", {
        landscape: "01.HUB2ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART2.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"]
    }], //"Hub 2"),
    ["02", {
        landscape: "02.HUB3ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART3.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"]
    }], //"Hub 3"),
    ["03", {
        landscape: "03.HUB4ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART4.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"]
    }], //"Hub 4"),
    ["04", {
        landscape: "04.HUB5ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART5.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"]
    }], //"Hub 5"),
    ["05", {
        landscape: "05.HUB6ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART6.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"]
    }], //"Hub 6"),
    ["06", {
        landscape: "06.HUB7ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART7.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"]
    }], //"Hub 7"),
    ["07", {
        landscape: "07.HUB8ln.n64.lev",
        object_banks: ["GENERIC.obj.fla", "HUB_SHARED.obj.fla", "HUB_PART8.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "HUB_TEX_BANK.tex.fla"]
    }], //"Hub 8"),

    ["08", { // TODO: figure out why this is crashing
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
        landscape: "21.PC2Aln.n64.lev",
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
    ["1a", {
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
    ["28", { // TODO: make sure this is the right object bank setup:
        landscape: "40.OWBOSS3.n64.lev",
        object_banks: ["GENERIC.obj.fla", "OOTW_SHARED.obj.fla", "OOTW_BOSS1.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "OOTW_TEX_BANK.tex.fla"]
    }],
    ["29", {
        landscape: "41.OWBONUS.n64.lev",
        object_banks: ["GENERIC.obj.fla", "OOTW_SHARED.obj.fla", "OOTW_BONUS.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "OOTW_TEX_BANK.tex.fla"]
    }],



    // TODO: confirm banks for these:
    ["2c", {
        landscape: "44.FLYTHRU.n64.lev",
        object_banks: ["GENERIC.obj.fla", "FLYTHRU.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "FLYTHRU_TEX_BANK.tex.fla"]
    }], // "Flythru (title)"
    ["2d", {
        landscape: "45.FLYTHRU.n64.lev",
        object_banks: ["GENERIC.obj.fla", "FLYTHRU.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "FLYTHRU_TEX_BANK.tex.fla"]
    }], // "Flythru (credits)"
    ["2e", {
        landscape: "46.INTROl.n64.lev",
        object_banks: ["GENERIC.obj.fla", "INTRO.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla"]
    }], // "Intro cutscene"
    ["2f", {
        landscape: "47.OUTROl.n64.lev",
        object_banks: ["GENERIC.obj.fla", "OUTRO.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla"]
    }], // "Outro cutscene"
    ["2b", {
        landscape: "PRESENTATION.obj.fla",
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


        let scratchMatrix = mat4.create();
        let currentActor: GloverActorRenderer | null = null; 

        function loadActor(id : number) : GloverActorRenderer | null {
            const objRoot = loadedObjects.get(id);
            if (objRoot === undefined) {
                console.error(`Object 0x${id.toString(16)} is not loaded!`);
                return null;
            }
            let new_actor = new GloverActorRenderer(device, cache, textureHolder, objRoot, mat4.create());
            if ((objRoot.mesh.renderMode & 0x2) == 0) {
                sceneRenderer.opaqueActors.push(new_actor)
            } else {
                sceneRenderer.translucentActors.push(new_actor)
            }
            return new_actor;
        }

        for (let cmd of landscape.body) {
            if (cmd.params === undefined) {
                continue;
            }
            switch (cmd.params.__type) {
                case 'Water': {
                    currentActor = loadActor(cmd.params.objectId);
                    if (currentActor == null) {
                        continue;
                    }
                    mat4.fromTranslation(currentActor.modelMatrix, [cmd.params.x, cmd.params.y, cmd.params.z]);
                    currentActor.setRenderMode(0x20, 0x20);
                    break;
                }
                case 'LandActor':
                case 'BackgroundActor0xbc':
                case 'BackgroundActor0x91': {
                    currentActor = loadActor(cmd.params.objectId);
                    if (currentActor == null) {
                        continue;
                    }
                    mat4.fromTranslation(currentActor.modelMatrix, [cmd.params.x, cmd.params.y, cmd.params.z]);
                    break;
                }
                case 'SetActorRotation': {
                    if (currentActor === null) {
                        console.error(`No active actor for ${cmd.params.__type}!`);
                        continue;
                    }
                    // TODO: confirm rotation order:
                    mat4.fromXRotation(scratchMatrix, cmd.params.x);
                    mat4.mul(currentActor.modelMatrix, currentActor.modelMatrix, scratchMatrix);
                    mat4.fromYRotation(scratchMatrix, cmd.params.y);
                    mat4.mul(currentActor.modelMatrix, currentActor.modelMatrix, scratchMatrix);
                    mat4.fromZRotation(scratchMatrix, cmd.params.z);
                    mat4.mul(currentActor.modelMatrix, currentActor.modelMatrix, scratchMatrix);
                    break;
                }
                case 'SetActorScale': {
                    if (currentActor === null) {
                        console.error(`No active actor for ${cmd.params.__type}!`);
                        continue;
                    }
                    mat4.scale(currentActor.modelMatrix, currentActor.modelMatrix, [cmd.params.x, cmd.params.y, cmd.params.z]);
                    break;
                }

            }
        }

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
