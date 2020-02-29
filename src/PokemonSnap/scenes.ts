import * as UI from '../ui';
import * as Viewer from '../viewer';
import * as BYML from '../byml';

import { GfxDevice, GfxRenderPass, GfxHostAccessPass } from '../gfx/platform/GfxPlatform';
import { BasicRenderTarget, transparentBlackFullClearRenderPassDescriptor, depthClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { GfxRenderHelper } from '../gfx/render/GfxRenderGraph';
import { SceneContext } from '../SceneBase';
import { executeOnPass } from '../gfx/render/GfxRenderer';
import { SnapPass, ModelRenderer, LevelGlobals } from './render';
import { LevelArchive, parseLevel, InteractionType } from './room';
import { RenderData, textureToCanvas } from '../BanjoKazooie/render';
import { TextureHolder, FakeTextureHolder } from '../TextureHolder';
import { hexzero } from '../util';
import { CameraController } from '../Camera';
import { Actor } from './actor';

const pathBase = `PokemonSnap`;

class SnapRenderer implements Viewer.SceneGfx {
    public renderData: RenderData[] = [];
    public modelRenderers: ModelRenderer[] = [];

    public renderTarget = new BasicRenderTarget();
    public renderHelper: GfxRenderHelper;
    public globals: LevelGlobals = {collision: null, lastPesterBall: 0, currentSong: InteractionType.PokefluteA, songStart: 0, allObjects: []};

    constructor(device: GfxDevice, public textureHolder: TextureHolder<any>) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public createCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(32/60);
        return c;
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();

        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableCullingCheckbox = new UI.Checkbox('Enable Culling', true);
        enableCullingCheckbox.onchanged = () => {
            for (let i = 0; i < this.modelRenderers.length; i++)
                this.modelRenderers[i].setBackfaceCullingEnabled(enableCullingCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableCullingCheckbox.elem);
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.modelRenderers.length; i++)
                this.modelRenderers[i].setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.modelRenderers.length; i++)
                this.modelRenderers[i].setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);
        const enableMonochromeVertexColors = new UI.Checkbox('Grayscale Vertex Colors', false);
        enableMonochromeVertexColors.onchanged = () => {
            for (let i = 0; i < this.modelRenderers.length; i++)
                this.modelRenderers[i].setMonochromeVertexColorsEnabled(enableMonochromeVertexColors.checked);
        };
        renderHacksPanel.contents.appendChild(enableMonochromeVertexColors.elem);
        const enableAlphaVisualizer = new UI.Checkbox('Visualize Vertex Alpha', false);
        enableAlphaVisualizer.onchanged = () => {
            for (let i = 0; i < this.modelRenderers.length; i++)
                this.modelRenderers[i].setAlphaVisualizerEnabled(enableAlphaVisualizer.checked);
        };
        renderHacksPanel.contents.appendChild(enableAlphaVisualizer.elem);

        return [renderHacksPanel];
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();
        for (let i = 0; i < this.modelRenderers.length; i++)
            this.modelRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput, this.globals);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
        // update song - maybe put somewhere better
        if (viewerInput.time > this.globals.songStart + 10000) {
            const r = (Math.random()*5) >>> 0;
            if (r > 2)
                this.globals.currentSong = 0;
            else
                this.globals.currentSong = InteractionType.PokefluteA + r;
            this.globals.songStart = viewerInput.time;
        }
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        const renderInstManager = this.renderHelper.renderInstManager;

        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, transparentBlackFullClearRenderPassDescriptor);
        executeOnPass(renderInstManager, device, skyboxPassRenderer, SnapPass.SKYBOX);
        skyboxPassRenderer.endPass();
        device.submitPass(skyboxPassRenderer);

        const mainPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, depthClearRenderPassDescriptor);
        executeOnPass(renderInstManager, device, mainPassRenderer, SnapPass.MAIN);

        renderInstManager.resetRenderInsts();

        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);
        for (let i = 0; i < this.renderData.length; i++)
            this.renderData[i].destroy(device);
    }

}

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) { }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const fileList = [this.id, '0E', 'magikarp'];
        switch (this.id) {
            case '10': // beach
                fileList.push('pikachu'); break;
            case '12': // tunnel
                fileList.push('pikachu', 'zubat'); break;
            case '16': // river
                fileList.push('pikachu', 'bulbasaur'); break;
            case '14': // cave
                fileList.push('pikachu', 'bulbasaur', 'zubat'); break;
        }
        return Promise.all(fileList.map((name) =>
            context.dataFetcher.fetchData(`${pathBase}/${name}_arc.crg1?cache_bust=2`))
        ).then((files) => {
            const archives: LevelArchive[] = files.map((data) => BYML.parse(data, BYML.FileType.CRG1) as LevelArchive);

            const viewerTextures: Viewer.Texture[] = [];
            const holder = new FakeTextureHolder(viewerTextures);

            const sceneRenderer = new SnapRenderer(device, holder);
            const level = parseLevel(archives);
            for (let i = 0; i < level.sharedCache.textures.length; i++)
                viewerTextures.push(textureToCanvas(level.sharedCache.textures[i]));

            sceneRenderer.globals.collision = level.collision;

            if (level.skybox !== null) {
                const skyboxData = new RenderData(device, sceneRenderer.renderHelper.getCache(), level.skybox.node.model!.sharedOutput);
                const skyboxRenderer = new ModelRenderer(skyboxData, [level.skybox.node], [], true);
                if (level.skybox.animation !== null) {
                    skyboxRenderer.animations.push(level.skybox.animation!);
                    skyboxRenderer.setAnimation(0);
                }
                skyboxRenderer.forceLoop();
                sceneRenderer.renderData.push(skyboxData);
                sceneRenderer.modelRenderers.push(skyboxRenderer);
            }

            const zeroOneData = new RenderData(device, sceneRenderer.renderHelper.getCache(), level.zeroOne.sharedOutput);
            const zeroOne = new ModelRenderer(zeroOneData, level.zeroOne.nodes, level.zeroOne.animations);
            zeroOne.forceLoop();
            sceneRenderer.modelRenderers.push(zeroOne);

            const objectDatas: RenderData[] = [];
            for (let i = 0; i < level.objectInfo.length; i++) {
                const data = new RenderData(device, sceneRenderer.renderHelper.getCache(), level.objectInfo[i].sharedOutput);
                objectDatas.push(data);
                sceneRenderer.renderData.push(data);
                for (let j = 0; j < data.sharedOutput.textureCache.textures.length; j++)
                    viewerTextures.push(textureToCanvas(data.sharedOutput.textureCache.textures[j]));
            }

            for (let i = 0; i < level.rooms.length; i++) {
                const renderData = new RenderData(device, sceneRenderer.renderHelper.getCache(), level.rooms[i].node.model!.sharedOutput);
                const roomRenderer = new ModelRenderer(renderData, [level.rooms[i].node], []);
                if (level.rooms[i].animation !== null) {
                    roomRenderer.animations.push(level.rooms[i].animation!);
                    roomRenderer.setAnimation(0);
                }
                roomRenderer.forceLoop();
                sceneRenderer.renderData.push(renderData);
                sceneRenderer.modelRenderers.push(roomRenderer);
                const objects = level.rooms[i].objects;
                for (let j = 0; j < objects.length; j++) {
                    const objIndex = level.objectInfo.findIndex((def) => def.id === objects[j].id);
                    if (objIndex === -1) {
                        console.warn('missing object', hexzero(objects[j].id, 3));
                        continue;
                    }
                    const def = level.objectInfo[objIndex];
                    const objectRenderer = new Actor(objectDatas[objIndex], objects[j], def, sceneRenderer.globals);
                    if (def.id === 133) // eevee actually uses chansey's path
                        objectRenderer.motionData.path = objects.find((obj) => obj.id === 113)!.path;
                    sceneRenderer.modelRenderers.push(objectRenderer);
                    sceneRenderer.globals.allObjects.push(objectRenderer);
                }
            }

            return sceneRenderer;
        });
    }
}

const id = `snap`;
const name = "Pokemon Snap";
const sceneDescs = [
    new SceneDesc(`10`, "Beach"),
    new SceneDesc(`12`, "Tunnel"),
    new SceneDesc(`18`, "Volcano"),
    new SceneDesc(`16`, "River"),
    new SceneDesc(`14`, "Cave"),
    new SceneDesc(`1A`, "Valley"),
    new SceneDesc(`1C`, "Rainbow Cloud"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
