
import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as Geo from './geo';
import * as BYML from '../byml';

import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { FakeTextureHolder, TextureHolder } from '../TextureHolder';
import { textureToCanvas, N64Renderer, N64Data, BKPass } from './render';
import { mat4 } from 'gl-matrix';
import { transparentBlackFullClearRenderPassDescriptor, depthClearRenderPassDescriptor, BasicRenderTarget } from '../gfx/helpers/RenderTargetHelpers';
import { GfxRenderDynamicUniformBuffer } from '../gfx/render/GfxRenderDynamicUniformBuffer';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer2';
import { SceneContext } from '../SceneBase';

const pathBase = `bk`;

class BKRenderer implements Viewer.SceneGfx {
    public n64Renderers: N64Renderer[] = [];
    public n64Datas: N64Data[] = [];

    public renderTarget = new BasicRenderTarget();
    public renderInstManager = new GfxRenderInstManager();
    public uniformBuffer: GfxRenderDynamicUniformBuffer;

    constructor(device: GfxDevice, public textureHolder: TextureHolder<any>) {
        this.uniformBuffer = new GfxRenderDynamicUniformBuffer(device);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();

        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableCullingCheckbox = new UI.Checkbox('Enable Culling', true);
        enableCullingCheckbox.onchanged = () => {
            for (let i = 0; i < this.n64Renderers.length; i++)
                this.n64Renderers[i].setBackfaceCullingEnabled(enableCullingCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableCullingCheckbox.elem);
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.n64Renderers.length; i++)
                this.n64Renderers[i].setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.n64Renderers.length; i++)
                this.n64Renderers[i].setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);
        const enableMonochromeVertexColors = new UI.Checkbox('Grayscale Vertex Colors', false);
        enableMonochromeVertexColors.onchanged = () => {
            for (let i = 0; i < this.n64Renderers.length; i++)
                this.n64Renderers[i].setMonochromeVertexColorsEnabled(enableMonochromeVertexColors.checked);
        };
        renderHacksPanel.contents.appendChild(enableMonochromeVertexColors.elem);
        const enableAlphaVisualizer = new UI.Checkbox('Visualize Vertex Alpha', false);
        enableAlphaVisualizer.onchanged = () => {
            for (let i = 0; i < this.n64Renderers.length; i++)
                this.n64Renderers[i].setAlphaVisualizerEnabled(enableAlphaVisualizer.checked);
        };
        renderHacksPanel.contents.appendChild(enableAlphaVisualizer.elem);

        return [renderHacksPanel];
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderInstManager.pushTemplateRenderInst();
        template.setUniformBuffer(this.uniformBuffer);

        for (let i = 0; i < this.n64Renderers.length; i++)
            this.n64Renderers[i].prepareToRender(device, this.renderInstManager, viewerInput);

        this.renderInstManager.popTemplateRenderInst();
        this.uniformBuffer.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);

        // First, render the skybox.
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, transparentBlackFullClearRenderPassDescriptor);
        skyboxPassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.renderInstManager.setVisibleByFilterKeyExact(BKPass.SKYBOX);
        this.renderInstManager.drawOnPassRenderer(device, skyboxPassRenderer);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = this.renderTarget.createRenderPass(device, depthClearRenderPassDescriptor);
        mainPassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.renderInstManager.setVisibleByFilterKeyExact(BKPass.MAIN);
        this.renderInstManager.drawOnPassRenderer(device, mainPassRenderer);

        this.renderInstManager.resetRenderInsts();

        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderInstManager.destroy(device);
        this.renderTarget.destroy(device);
        this.uniformBuffer.destroy(device);
        for (let i = 0; i < this.n64Renderers.length; i++)
            this.n64Renderers[i].destroy(device);
        for (let i = 0; i < this.n64Datas.length; i++)
            this.n64Datas[i].destroy(device);
        this.textureHolder.destroy(device);
    }
}

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    private addGeo(device: GfxDevice, viewerTextures: Viewer.Texture[], sceneRenderer: BKRenderer, geo: Geo.Geometry): N64Renderer {
        for (let i = 0; i < geo.rspOutput.textures.length; i++)
            viewerTextures.push(textureToCanvas(geo.rspOutput.textures[i]));

        const n64Data = new N64Data(device, geo.rspOutput);
        sceneRenderer.n64Datas.push(n64Data);
        const n64Renderer = new N64Renderer(n64Data);
        sceneRenderer.n64Renderers.push(n64Renderer);
        return n64Renderer;
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        return dataFetcher.fetchData(`${pathBase}/${this.id}_arc.crg1`).then((data) => {
            const obj: any = BYML.parse(data, BYML.FileType.CRG1);

            const viewerTextures: Viewer.Texture[] = [];
            const fakeTextureHolder = new FakeTextureHolder(viewerTextures);
            const sceneRenderer = new BKRenderer(device, fakeTextureHolder);

            if (obj.OpaGeoFileId >= 0) {
                const geo = Geo.parse(obj.Files[obj.OpaGeoFileId].Data, true);
                this.addGeo(device, viewerTextures, sceneRenderer, geo);
            }

            if (obj.XluGeoFileId >= 0) {
                const geo = Geo.parse(obj.Files[obj.XluGeoFileId].Data, false);
                this.addGeo(device, viewerTextures, sceneRenderer, geo);
            }

            if (obj.OpaSkyboxFileId >= 0) {
                const geo = Geo.parse(obj.Files[obj.OpaSkyboxFileId].Data, true);
                const renderer = this.addGeo(device, viewerTextures, sceneRenderer, geo);
                renderer.isSkybox = true;
                mat4.scale(renderer.modelMatrix, renderer.modelMatrix, [obj.OpaSkyboxScale, obj.OpaSkyboxScale, obj.OpaSkyboxScale]);
            }

            if (obj.XluSkyboxFileId >= 0) {
                const geo = Geo.parse(obj.Files[obj.XluSkyboxFileId].Data, false);
                const renderer = this.addGeo(device, viewerTextures, sceneRenderer, geo);
                renderer.isSkybox = true;
                mat4.scale(renderer.modelMatrix, renderer.modelMatrix, [obj.OpaSkyboxScale, obj.OpaSkyboxScale, obj.OpaSkyboxScale]);
            }

            return sceneRenderer;
        });
    }
}

// Names taken from Banjo's Backpack.
const id = `bk`;
const name = "Banjo-Kazooie";
const sceneDescs = [
    "Spiral Mountain",
    new SceneDesc(`01`, "Spiral Mountain"),
    new SceneDesc(`8C`, "Banjo's House"),

    "Grunty's Lair",
    new SceneDesc(`69`, "Floor 1 / Entrance to Mumbo's Mountain"),
    new SceneDesc(`6A`, "Floor 2"),
    new SceneDesc(`6C`, "Dingpot Teleport Room"),
    new SceneDesc(`6B`, "Floor 3"),
    new SceneDesc(`6D`, "Entrance to Treasure Trove Cove"),
    new SceneDesc(`70`, "Entrance to Clanker's Cavern"),
    new SceneDesc(`71`, "Floor 4"),
    new SceneDesc(`72`, "Entrance to Bubblegloomp Swamp"),
    new SceneDesc(`6E`, "Floor 5 / Entrance to Gobi's Valley"),
    new SceneDesc(`6F`, "Floor 6 / Entrance to Freezeezy Peak"),
    new SceneDesc(`75`, "Entrance to Mad Monster Mansion"),
    new SceneDesc(`74`, "Gobi's Valley Puzzle Room"),
    new SceneDesc(`79`, "Floor 7 / Entrance to Click Clock Wood"),
    new SceneDesc(`76`, "Water Switch Area"),
    new SceneDesc(`78`, "Mad Monster Mansion & Rusty Bucket Bay Puzzle Room"),
    new SceneDesc(`77`, "Entrance to Rusty Bucket Bay"),
    new SceneDesc(`93`, "Floor 8"),
    new SceneDesc(`7A`, "Coffin Room"),
    new SceneDesc(`80`, "Entrance to Grunty's Furnace Fun"),
    new SceneDesc(`8E`, "Grunty's Furnace Fun"),
    new SceneDesc(`90`, "Boss"),

    "Mumbo's Mountain",
    new SceneDesc(`02`, "Mumbo's Mountain"),
    new SceneDesc(`0C`, "Ticker's Tower"),
    new SceneDesc(`0E`, "Mumbo's Skull"),

    "Treasure Trove Cove",
    new SceneDesc(`07`, "Treasure Trove Cove"),
    new SceneDesc(`05`, "Blubber's Ship"),
    new SceneDesc(`06`, "Nipper's Shell"),
    new SceneDesc(`0A`, "Sandcastle"),
    new SceneDesc(`8F`, "Sharkfood Island"),

    "Clanker's Cavern",
    new SceneDesc(`0B`, "Clanker's Cavern"),
    new SceneDesc(`22`, "Inside Clanker"),
    new SceneDesc(`21`, "Inside Clanker - Witch Switch"),
    new SceneDesc(`23`, "Inside Clanker - Gold Feathers"),

    "Bubblegloop Swamp",
    new SceneDesc(`0D`, "Bubblegloop Swamp"),
    new SceneDesc(`10`, "Mr. Vile"),
    new SceneDesc(`11`, "TipTup Chior"),
    new SceneDesc(`47`, "Mumbo's Skull"),

    "Freezeezy Peak",
    new SceneDesc(`27`, "Freezeezy Peak"),
    new SceneDesc(`41`, "Boggy's Igloo"),
    new SceneDesc(`48`, "Mumbo's Skull"),
    new SceneDesc(`53`, "Christmas Tree"),
    new SceneDesc(`7F`, "Wozza's Cave"),

    "Gobi's Valley",
    new SceneDesc(`12`, "Gobi's Valley"),
    new SceneDesc(`13`, "Puzzle Room"),
    new SceneDesc(`14`, "King Sandybutt's Tomb"),
    new SceneDesc(`15`, "Water Room"),
    new SceneDesc(`16`, "Rupee"),
    new SceneDesc(`1A`, "Jinxy"),
    new SceneDesc(`92`, "Secret Blue Egg"),

    "Mad Monster Mansion",
    new SceneDesc(`1B`, "Mad Monster Mansion"),
    new SceneDesc(`8D`, "Septic Tank"),
    new SceneDesc(`1C`, "Church"),
    new SceneDesc(`1D`, "Cellar"),
    new SceneDesc(`24`, "Tumblar's Shed"),
    new SceneDesc(`25`, "Well"),
    new SceneDesc(`26`, "Dining Room"),
    new SceneDesc(`28`, "Egg Room"),
    new SceneDesc(`29`, "Note Room"),
    new SceneDesc(`2A`, "Feather Room"),
    new SceneDesc(`2B`, "Secret Church Room"),
    new SceneDesc(`2C`, "Bathroom"),
    new SceneDesc(`2D`, "Bedroom"),
    new SceneDesc(`2E`, "Gold Feather Room"),
    new SceneDesc(`2F`, "Drainpipe"),
    new SceneDesc(`30`, "Mumbo's Hut"),

    "Rusty Bucket Bay",
    new SceneDesc(`31`, "Rusty Bucket Bay"),
    new SceneDesc(`8B`, "Anchor Room"),
    new SceneDesc(`34`, "Machine Room"),
    new SceneDesc(`35`, "Big Fish Warehouse"),
    new SceneDesc(`36`, "Boat Room"),
    new SceneDesc(`37`, "First Blue Container"),
    new SceneDesc(`38`, "Third Blue Container"),
    new SceneDesc(`39`, "Sea-Grublin's Cabin"),
    new SceneDesc(`3A`, "Kaboom's Room"),
    new SceneDesc(`3B`, "Mini Kaboom's Room"),
    new SceneDesc(`3C`, "Kitchen"),
    new SceneDesc(`3D`, "Navigation Room"),
    new SceneDesc(`3E`, "Second Blue Container"),
    new SceneDesc(`3F`, "Captain's Room"),

    "Click Clock Wood",
    new SceneDesc(`40`, "Click Clock Wood"),
    new SceneDesc(`43`, "Spring"),
    new SceneDesc(`44`, "Summer"),
    new SceneDesc(`45`, "Fall"),
    new SceneDesc(`46`, "Winter"),
    new SceneDesc(`4A`, "Mumbo - Spring"),
    new SceneDesc(`4B`, "Mumbo - Summer"),
    new SceneDesc(`4C`, "Mumbo - Fall"),
    new SceneDesc(`4D`, "Mumbo - Winter"),
    new SceneDesc(`5A`, "Beehive - Summer"),
    new SceneDesc(`5B`, "Beehive - Spring"),
    new SceneDesc(`5C`, "Beehive - Fall"),
    new SceneDesc(`5E`, "Nabnuts House - Spring"),
    new SceneDesc(`5F`, "Nabnuts House - Summer"),
    new SceneDesc(`60`, "Nabnuts House - Fall"),
    new SceneDesc(`61`, "Nabnuts House - Winter"),
    new SceneDesc(`62`, "Nabnut's Attic - Winter"),
    new SceneDesc(`63`, "Nabnut's Attic - Fall"),
    new SceneDesc(`64`, "Nabnut's Attic 2 - Winter"),
    new SceneDesc(`65`, "Whipcrack Room - Spring"),
    new SceneDesc(`66`, "Whipcrack Room - Summer"),
    new SceneDesc(`67`, "Whipcrack Room - Fall"),
    new SceneDesc(`68`, "Whipcrack Room - Winter"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
