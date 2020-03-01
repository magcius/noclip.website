import * as Viewer from '../viewer';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate, GXShapeHelperGfx, loadedDataCoalescerComboGfx, PacketParams, GXMaterialHelperGfx, MaterialParams, fillSceneParams } from '../gx/gx_render';
import { GfxDevice, GfxHostAccessPass } from '../gfx/platform/GfxPlatform';
import { GX_VtxDesc, GX_VtxAttrFmt, compileVtxLoaderMultiVat, LoadedVertexLayout, LoadedVertexData, GX_Array } from '../gx/gx_displaylist';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { mat4 } from 'gl-matrix';
import { Camera, computeViewMatrix } from '../Camera';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GXMaterial } from '../gx/gx_material';

import { SFATexture } from './textures';

export class SFARenderer extends BasicGXRendererHelper {
    protected renderSky(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {}

    protected renderWorld(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {}

    protected prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        // Draw sky
        const skyTemplate = this.renderHelper.pushTemplateRenderInst();
        const oldProjection = mat4.create();
        mat4.copy(oldProjection, viewerInput.camera.projectionMatrix);
        mat4.identity(viewerInput.camera.projectionMatrix);
        fillSceneParamsDataOnTemplate(skyTemplate, viewerInput, false);
        this.renderSky(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.renderInstManager.popTemplateRenderInst();

        mat4.copy(viewerInput.camera.projectionMatrix, oldProjection);

        // Draw world
        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput, false);
        this.renderWorld(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender(device, hostAccessPass);
    }
}
