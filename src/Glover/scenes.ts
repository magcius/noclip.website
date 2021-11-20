
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
    public actorRenderers: GloverActorRenderer[] = [];

    public renderHelper: GfxRenderHelper;

    constructor(device: GfxDevice, public textureHolder: GloverTextureHolder) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(30/60);
    }

    public createPanels(): UI.Panel[] {

        const renderHacksPanel = new UI.Panel();

        // TODO: implement:

        // renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        // renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        // const enableCullingCheckbox = new UI.Checkbox('Enable Culling', true);
        // enableCullingCheckbox.onchanged = () => {
        //     for (let renderer of this.actorRenderers) {
        //         renderer.setBackfaceCullingEnabled(enableCullingCheckbox.checked);
        //     }
        // };
        // renderHacksPanel.contents.appendChild(enableCullingCheckbox.elem);

        // const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        // enableVertexColorsCheckbox.onchanged = () => {
        //     for (let renderer of this.actorRenderers) {
        //         renderer.setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        //     }
        // };
        // renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);

        // const enableTextures = new UI.Checkbox('Enable Textures', true);
        // enableTextures.onchanged = () => {
        //     for (let renderer of this.actorRenderers) {
        //         renderer.setTexturesEnabled(enableTextures.checked);
        //     }
        // };
        // renderHacksPanel.contents.appendChild(enableTextures.elem);

        // const enableMonochromeVertexColors = new UI.Checkbox('Grayscale Vertex Colors', false);
        // enableMonochromeVertexColors.onchanged = () => {
        //     for (let renderer of this.actorRenderers) {
        //         renderer.setMonochromeVertexColorsEnabled(enableMonochromeVertexColors.checked);
        //     }
        // };
        // renderHacksPanel.contents.appendChild(enableMonochromeVertexColors.elem);

        // const enableAlphaVisualizer = new UI.Checkbox('Visualize Vertex Alpha', false);
        // enableAlphaVisualizer.onchanged = () => {
        //     for (let renderer of this.actorRenderers) {
        //         renderer.setAlphaVisualizerEnabled(enableAlphaVisualizer.checked);
        //     }
        // };
        // renderHacksPanel.contents.appendChild(enableAlphaVisualizer.elem);

        return [renderHacksPanel];
    }

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();

        for (let actorRenderer of this.actorRenderers) {
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

        for (let actorRenderer of this.actorRenderers) {
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
// TODO, do the rest of them
const sceneBanks = new Map<string, GloverSceneBankDescriptor>([
    ["0a", {
        landscape: "10.AT1lnd.n64.lev",
        object_banks: ["GENERIC.obj.fla", "ATLANTIS_SHARED.obj.fla", "ATLANTIS_L1.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "ATLANTIS_TEX_BANK.tex.fla"]}],
    ["0b", {
        landscape: "11.AT2lnd.n64.lev",
        object_banks: ["GENERIC.obj.fla", "ATLANTIS_SHARED.obj.fla", "ATLANTIS_L2.obj.fla"],
        texture_banks: ["GENERIC_TEX_BANK.tex.fla", "ATLANTIS_TEX_BANK.tex.fla"]}],
    ["0c", {
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

        const testActor = new GloverActorRenderer(device, cache, textureHolder, object_banks[2]!.directory[5].objRoot);
        sceneRenderer.actorRenderers.push(testActor)

        return sceneRenderer;
    }
}

// Names taken from landscape file metadata
const id = `gv`;
const name = "Glover";

const sceneDescs = [
    "System",
    new SceneDesc(`2c`, "Flythru (title)"),
    new SceneDesc(`2d`, "Flythru (credits)"),
    new SceneDesc(`2e`, "Intro cutscene"),
    new SceneDesc(`2f`, "Outro cutscene"),
    new SceneDesc(`2b`, "Presentation (studio logos)"),

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
    new SceneDesc(`22`, "Fortress of Fear BONUS"),

    "Out Of This World"
    new SceneDesc(`23`, "Out Of This World Level 1"),
    new SceneDesc(`24`, "Out Of This World Level 2"),
    new SceneDesc(`25`, "Out Of This World Level 3"),
    new SceneDesc(`26`, "Out Of This World Boss (phase 1)"),
    new SceneDesc(`27`, "Out Of This World Boss (phase 2)"),
    new SceneDesc(`28`, "Out Of This World Boss (phase 3)"),
    new SceneDesc(`29`, "Out Of This World Bonus"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
