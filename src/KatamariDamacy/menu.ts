
import { CameraController, OrbitCameraController } from '../Camera';
import { BasicRenderTarget, ColorTexture, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass, GfxBindingLayoutDescriptor } from "../gfx/platform/GfxPlatform";
import { GfxRenderHelper } from '../gfx/render/GfxRenderGraph';
import { SceneContext } from '../SceneBase';
import { TextureMapping, FakeTextureHolder } from '../TextureHolder';
import { SceneGfx, ViewerRenderInput } from "../viewer";
import * as BIN from "./bin";
import { ObjectRenderer } from './objects';
import { BINModelSectorData, KatamariDamacyProgram, BINModelInstance } from './render';
import { fillSceneParamsData } from './scenes';
import { mat4 } from 'gl-matrix';

const katamariWorldSpaceToNoclipSpace = mat4.create();
mat4.rotateX(katamariWorldSpaceToNoclipSpace, katamariWorldSpaceToNoclipSpace, Math.PI);
const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 2, numSamplers: 1 }];

export class MenuSceneRenderer implements SceneGfx {
    private sceneTexture = new ColorTexture();
    public renderTarget = new BasicRenderTarget();
    public renderHelper: GfxRenderHelper;
    public modelSectorData: BINModelSectorData[] = [];
    public objectRenderers: ObjectRenderer[] = [];
    public models: BINModelInstance[] = [];

    public textureHolder = new FakeTextureHolder([]);
    public framebufferTextureMapping = new TextureMapping();

    constructor(private context: SceneContext, private planetData: BIN.HomePlanetData) {
        const device = context.device;
        this.renderHelper = new GfxRenderHelper(device);

        const cache = this.renderHelper.getCache();
        for (let i = 0; i < planetData.objects.length; i++) {
            const data = new BINModelSectorData(device, cache, planetData.objects[i].sector);
            this.modelSectorData.push(data);
            if (planetData.objects[i].id === -1) {

            } else {
                const renderer = new BINModelInstance(device, cache, data.modelData[0]);
                mat4.copy(renderer.modelMatrix, planetData.objects[i].matrix);
                this.models.push(renderer);
            }
        }

        for (let i = 0; i < planetData.complicated.length; i++) {
            const obj = planetData.complicated[i];
            const data = new BINModelSectorData(device, cache, obj.model.sector);
            this.modelSectorData.push(data);
            const renderer = new ObjectRenderer(device, cache, obj.model, data, obj.spawn);
            renderer.initAnimation(obj.animation);
            this.objectRenderers.push(renderer);
        }
    }

    public createCameraController(): CameraController {
        const orbit = new OrbitCameraController();
        orbit.shouldOrbit = true;
        orbit.orbitSpeed = -0.4;
        return orbit;
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        const offs = template.allocateUniformBuffer(KatamariDamacyProgram.ub_SceneParams, 16 + 20);
        const sceneParamsMapped = template.mapUniformBufferF32(KatamariDamacyProgram.ub_SceneParams);
        fillSceneParamsData(sceneParamsMapped, viewerInput.camera, 0, offs);



        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(this.renderHelper.renderInstManager, viewerInput, katamariWorldSpaceToNoclipSpace, 0);
        for (let i = 0; i < this.models.length; i++)
            this.models[i].prepareToRender(this.renderHelper.renderInstManager, viewerInput, katamariWorldSpaceToNoclipSpace, 0);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass {
        const renderInstManager = this.renderHelper.renderInstManager;

        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.sceneTexture.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const passRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, standardFullClearRenderPassDescriptor, this.sceneTexture.gfxTexture);

        this.framebufferTextureMapping.gfxTexture = this.sceneTexture!.gfxTexture;
        renderInstManager.drawOnPassRenderer(device, passRenderer);
        renderInstManager.resetRenderInsts();

        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.sceneTexture.destroy(device);
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);

        for (let i = 0; i < this.modelSectorData.length; i++)
            this.modelSectorData[i].destroy(device);
    }
}