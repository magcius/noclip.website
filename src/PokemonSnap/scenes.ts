import * as Viewer from '../viewer';
import * as BYML from '../byml';

import { GfxDevice, GfxRenderPassDescriptor, GfxRenderPass, GfxHostAccessPass } from '../gfx/platform/GfxPlatform';
import { BasicRenderTarget, transparentBlackFullClearRenderPassDescriptor, depthClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { GfxRenderHelper } from '../gfx/render/GfxRenderGraph';
import { SceneContext } from '../SceneBase';
import { executeOnPass } from '../gfx/render/GfxRenderer';
import { MeshRenderer, SnapPass } from './render';
import { MapArchive, parseMap } from './room';
import { RenderData, textureToCanvas } from '../BanjoKazooie/render';
import { TextureHolder, FakeTextureHolder } from '../TextureHolder';
import { mat4, vec3 } from 'gl-matrix';

const pathBase = `PokemonSnap`;

class SnapRenderer implements Viewer.SceneGfx {
    public meshRenderers: MeshRenderer[] = [];

    public renderTarget = new BasicRenderTarget();
    public renderHelper: GfxRenderHelper;

    constructor(device: GfxDevice, public textureHolder: TextureHolder<any>) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();
        for (let i = 0; i < this.meshRenderers.length; i++)
            this.meshRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
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
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);

        const mainPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, depthClearRenderPassDescriptor);
        executeOnPass(renderInstManager, device, mainPassRenderer, SnapPass.MAIN);

        renderInstManager.resetRenderInsts();

        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);
    }

}

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) { }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        return context.dataFetcher.fetchData(`${pathBase}/${this.id}_arc.crg1`).then((data) => {
            const obj: any = BYML.parse(data!, BYML.FileType.CRG1);

            const viewerTextures: Viewer.Texture[] = [];
            const holder = new FakeTextureHolder(viewerTextures);

            const sceneRenderer = new SnapRenderer(device, holder);
            const rooms = parseMap(obj as MapArchive);
            for (let i = 0; i < rooms.length; i++) {
                const mesh = rooms[i].mesh;
                const renderData = new RenderData(device, sceneRenderer.renderHelper.getCache(), mesh.sharedOutput);
                for (let j = 0; j < mesh.sharedOutput.textureCache.textures.length; j++)
                    viewerTextures.push(textureToCanvas(mesh.sharedOutput.textureCache.textures[j]));
                const roomRenderer = new MeshRenderer(renderData, mesh.rspOutput!, rooms[i].isSkybox);
                mat4.fromTranslation(roomRenderer.modelMatrix, rooms[i].pos);
                sceneRenderer.meshRenderers.push(roomRenderer);
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