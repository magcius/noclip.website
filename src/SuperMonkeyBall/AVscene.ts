import * as UI from '../ui';
import * as Viewer from '../viewer';

import { GfxDevice, GfxHostAccessPass } from "../gfx/platform/GfxPlatform";
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate, GXRenderHelperGfx } from '../gx/gx_render';
import { BasicRenderTarget } from '../gfx/helpers/RenderTargetHelpers';
import { AmusementVisionTextureHolder, GcmfModel, GcmfModelInstance } from './render';
import AnimationController from '../AnimationController';

export class AmusementVisionSceneRenderer extends BasicGXRendererHelper {
    public renderHelper: GXRenderHelperGfx;
    public renderTarget = new BasicRenderTarget();

    public textureHolder = new AmusementVisionTextureHolder();
    public animationController = new AnimationController();

    public modelInstances: GcmfModelInstance[] = [];
    public modelData: GcmfModel[] = [];

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        // Enable Vertex Color
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            const v = enableVertexColorsCheckbox.checked;
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setVertexColorsEnabled(v);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        // Enable Texture
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            const v = enableTextures.checked;
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setTexturesEnabled(v);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        return [renderHacksPanel];
    }

    protected prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        // this.animationController.setTimeInMilliseconds(viewerInput.time);

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.prepareToRender(device, hostAccessPass);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.textureHolder.destroy(device);
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);

        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);

        for (let i = 0; i < this.modelData.length; i++)
            this.modelData[i].destroy(device);
    }
}