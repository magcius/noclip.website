import * as UI from '../ui.js';
import * as Viewer from '../viewer.js';
import * as BYML from '../byml.js';

import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { makeBackbufferDescSimple, opaqueBlackFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper.js';
import { SceneContext } from '../SceneBase.js';
import { GfxRenderInstList } from '../gfx/render/GfxRenderInstManager.js';
import { ModelRenderer, buildTransform } from './render.js';
import { LevelArchive, parseLevel, isActor, eggInputSetup } from './room.js';
import { RenderData, textureToCanvas } from '../BanjoKazooie/render.js';
import { TextureHolder, FakeTextureHolder } from '../TextureHolder.js';
import { hexzero } from '../util.js';
import { CameraController } from '../Camera.js';
import { createActor, LevelGlobals, sceneActorInit } from './actor.js';
import { ParticleManager } from './particles.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';

const pathBase = `PokemonSnap`;

class SnapRenderer implements Viewer.SceneGfx {
    public renderData: RenderData[] = [];
    public modelRenderers: ModelRenderer[] = [];

    public renderHelper: GfxRenderHelper;
    public globals: LevelGlobals;

    constructor(context: SceneContext, public textureHolder: TextureHolder<any>, id: string) {
        this.renderHelper = new GfxRenderHelper(context.device);
        this.globals = new LevelGlobals(context, id);
        context.destroyablePool.push(this.globals);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(32 / 60);
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
            this.globals.particles.setTexturesEnabled(enableTextures.checked);
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
            this.globals.particles.setAlphaVisualizerEnabled(enableAlphaVisualizer.checked);
        };
        renderHacksPanel.contents.appendChild(enableAlphaVisualizer.elem);

        const controlsPanel = new UI.Panel();
        controlsPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        controlsPanel.setTitle(UI.TIME_OF_DAY_ICON, 'Interactions');
        const throwBalls = new UI.Checkbox('Throw Balls', true);
        throwBalls.onchanged = () => {
            this.globals.throwBalls = throwBalls.checked;
        };
        controlsPanel.contents.appendChild(throwBalls.elem);
        const playFlute = new UI.Checkbox('Play Flute', false);
        playFlute.onchanged = () => {
            this.globals.playFlute = playFlute.checked;
        };
        controlsPanel.contents.appendChild(playFlute.elem);

        return [renderHacksPanel, controlsPanel];
    }

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.globals.update(viewerInput);
        this.renderHelper.pushTemplateRenderInst();
        for (let i = 0; i < this.modelRenderers.length; i++)
            this.modelRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput, this.globals);
        this.globals.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);

        this.renderHelper.renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const globals = this.globals;
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                globals.renderInstListSky.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                globals.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        globals.renderInstListSky.reset();
        globals.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        for (let i = 0; i < this.renderData.length; i++)
            this.renderData[i].destroy(device);
        this.globals.particles.destroy(device);
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
            context.dataFetcher.fetchData(`${pathBase}/${name}_arc.crg1?cache_bust=5`))
        ).then((files) => {
            const archives: LevelArchive[] = files.map((data) => BYML.parse(data, BYML.FileType.CRG1) as LevelArchive);

            const viewerTextures: Viewer.Texture[] = [];
            const holder = new FakeTextureHolder(viewerTextures);

            const sceneRenderer = new SnapRenderer(context, holder, this.id);
            const level = parseLevel(archives);
            for (let i = 0; i < level.sharedCache.textures.length; i++)
                viewerTextures.push(textureToCanvas(level.sharedCache.textures[i]));

            sceneRenderer.globals.init(sceneRenderer.renderHelper.renderCache, level);

            const cache = sceneRenderer.renderHelper.renderCache;
            sceneActorInit();

            if (level.skybox !== null) {
                const skyboxData = new RenderData(device, cache, level.skybox.node.model!.sharedOutput);
                const skyboxRenderer = new ModelRenderer(skyboxData, [level.skybox.node], [], true);
                if (level.skybox.animation !== null) {
                    skyboxRenderer.animations.push(level.skybox.animation!);
                    skyboxRenderer.setAnimation(0);
                }
                skyboxRenderer.forceLoop();
                sceneRenderer.renderData.push(skyboxData);
                sceneRenderer.modelRenderers.push(skyboxRenderer);
                for (let j = 0; j < skyboxData.sharedOutput.textureCache.textures.length; j++) {
                    viewerTextures.push(textureToCanvas(skyboxData.sharedOutput.textureCache.textures[j]));
                }
            }

            const projData: RenderData[] = [];
            for (let i = 0; i < level.projectiles.length; i++)
                projData.push(new RenderData(device, cache, level.projectiles[i].sharedOutput));
            sceneRenderer.renderData.push(...projData);

            const objectDatas: RenderData[] = [];
            for (let i = 0; i < level.objectInfo.length; i++) {
                const data = new RenderData(device, cache, level.objectInfo[i].sharedOutput);
                if (level.objectInfo[i].id === 601 || level.objectInfo[i].id === 602) // replace egg vertex buffers
                    eggInputSetup(cache, data, level.eggData!);
                objectDatas.push(data);
                sceneRenderer.renderData.push(data);
                for (let j = 0; j < data.sharedOutput.textureCache.textures.length; j++) {
                    data.sharedOutput.textureCache.textures[j].name = `${level.objectInfo[i].id}_${j}`;
                    viewerTextures.push(textureToCanvas(data.sharedOutput.textureCache.textures[j]));
                }
            }

            let haunterData: RenderData | null = null;
            if (level.haunterData) {
                haunterData = new RenderData(device, cache, level.haunterData[1].model!.sharedOutput);
                sceneRenderer.renderData.push(haunterData);
                for (let j = 0; j < haunterData.sharedOutput.textureCache.textures.length; j++) {
                    haunterData.sharedOutput.textureCache.textures[j].name = `93_${j + 1}`;
                    viewerTextures.push(textureToCanvas(haunterData.sharedOutput.textureCache.textures[j]));
                }
            }

            for (let particle of level.levelParticles.particleTextures)
                for (let texture of particle)
                    viewerTextures.push(textureToCanvas(texture));

            sceneRenderer.modelRenderers.push(
                ...sceneRenderer.globals.buildTempObjects(level.objectInfo, objectDatas, level)
            );
            sceneRenderer.globals.particles = new ParticleManager(device, cache, level.levelParticles, level.pesterParticles);

            for (let i = 0; i < level.rooms.length; i++) {
                const renderData = new RenderData(device, cache, level.rooms[i].node.model!.sharedOutput);
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
                    if (isActor(def)) {
                        const objectRenderer = createActor(objectDatas[objIndex], objects[j], def, sceneRenderer.globals);
                        if (def.id === 133) // eevee actually uses chansey's path
                            objectRenderer.motionData.path = objects.find((obj) => obj.id === 113)!.path;
                        if (def.id === 93) {
                            const fullHaunter = new ModelRenderer(haunterData!, level.haunterData!, []);
                            (objectRenderer as any).fullModel = fullHaunter;
                            fullHaunter.visible = false;
                            sceneRenderer.modelRenderers.push(fullHaunter);
                        }
                        sceneRenderer.globals.allActors.push(objectRenderer);
                        sceneRenderer.modelRenderers.push(objectRenderer);
                    } else {
                        const objectRenderer = new ModelRenderer(objectDatas[objIndex], [def.node], []);
                        buildTransform(objectRenderer.modelMatrix, objects[j].pos, objects[j].euler, objects[j].scale);
                        sceneRenderer.modelRenderers.push(objectRenderer);
                    }
                }
            }

            return sceneRenderer;
        });
    }
}

const id = `snap`;
const name = "Pokémon Snap";
const sceneDescs = [
    new SceneDesc(`10`, "Beach"),
    new SceneDesc(`12`, "Tunnel"),
    new SceneDesc(`18`, "Volcano"),
    new SceneDesc(`16`, "River"),
    new SceneDesc(`14`, "Cave"),
    new SceneDesc(`1A`, "Valley"),
    new SceneDesc(`1C`, "Rainbow Cloud"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, altName: "Pokemon Snap" };
