import * as UI from '../ui';
import * as Viewer from '../viewer';
import * as BYML from '../byml';

import { GfxDevice, GfxRenderPass, GfxHostAccessPass } from '../gfx/platform/GfxPlatform';
import { BasicRenderTarget, transparentBlackFullClearRenderPassDescriptor, depthClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { GfxRenderHelper } from '../gfx/render/GfxRenderGraph';
import { SceneContext } from '../SceneBase';
import { executeOnPass } from '../gfx/render/GfxRenderer';
import { ModelRenderer, SnapPass } from './render';
import { LevelArchive, parseLevel, findGroundHeight, SpawnType } from './room';
import { RenderData, textureToCanvas } from '../BanjoKazooie/render';
import { TextureHolder, FakeTextureHolder } from '../TextureHolder';
import { vec3 } from 'gl-matrix';
import { hexzero } from '../util';

const pathBase = `PokemonSnap`;

class SnapRenderer implements Viewer.SceneGfx {
    public renderData: RenderData[] = [];
    public modelRenderers: ModelRenderer[] = [];

    public renderTarget = new BasicRenderTarget();
    public renderHelper: GfxRenderHelper;

    constructor(device: GfxDevice, public textureHolder: TextureHolder<any>) {
        this.renderHelper = new GfxRenderHelper(device);
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
            this.modelRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
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

            if (level.skybox !== null) {
                const skyboxData = new RenderData(device, sceneRenderer.renderHelper.getCache(), level.skybox.model!.sharedOutput);
                const skyboxRenderer = new ModelRenderer(skyboxData, level.skybox, undefined, true);
                sceneRenderer.renderData.push(skyboxData);
                sceneRenderer.modelRenderers.push(skyboxRenderer);
            }

            const objectDatas: RenderData[] = [];
            for (let i = 0; i < level.objectInfo.length; i++) {
                const data = new RenderData(device, sceneRenderer.renderHelper.getCache(), level.objectInfo[i].sharedOutput);
                objectDatas.push(data);
                sceneRenderer.renderData.push(data);
                for (let j = 0; j < data.sharedOutput.textureCache.textures.length; j++)
                    viewerTextures.push(textureToCanvas(data.sharedOutput.textureCache.textures[j]));
            }

            for (let i = 0; i < level.rooms.length; i++) {
                const renderData = new RenderData(device, sceneRenderer.renderHelper.getCache(), level.rooms[i].graph.model!.sharedOutput);
                const roomRenderer = new ModelRenderer(renderData, level.rooms[i].graph);
                sceneRenderer.renderData.push(renderData);
                sceneRenderer.modelRenderers.push(roomRenderer);
                const objects = level.rooms[i].objects;
                for (let j = 0; j < objects.length; j++) {
                    const objIndex = level.objectInfo.findIndex((def) => def.id === objects[j].id);
                    if (objIndex === -1) {
                        console.warn('missing object', hexzero(objects[j].id, 3));
                        continue;
                    }
                    const objectRenderer = new ModelRenderer(objectDatas[objIndex], level.objectInfo[objIndex].graph);
                    // set transform components
                    vec3.copy(objectRenderer.translation, objects[j].pos);
                    if (level.objectInfo[objIndex].spawn === SpawnType.GROUND)
                        objectRenderer.translation[1] = findGroundHeight(level.collision!, objects[j].pos[0], objects[j].pos[2]);

                    vec3.copy(objectRenderer.euler, objects[j].euler);

                    vec3.mul(objectRenderer.scale, objectRenderer.scale, objects[j].scale);
                    vec3.mul(objectRenderer.scale, objectRenderer.scale, level.objectInfo[objIndex].scale);

                    sceneRenderer.modelRenderers.push(objectRenderer);
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