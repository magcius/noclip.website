import { mat4, vec3 } from "gl-matrix";
import { CameraController } from "../../Camera.js";
import {
    makeBackbufferDescSimple,
    opaqueBlackFullClearRenderPassDescriptor,
} from "../../gfx/helpers/RenderGraphHelpers.js";
import { GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { GfxrAttachmentSlot } from "../../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../../gfx/render/GfxRenderHelper.js";
import {
    GfxRenderInstList,
    GfxRenderInstManager,
} from "../../gfx/render/GfxRenderInstManager.js";
import { TextureHolder } from "../../TextureHolder.js";
import * as UI from "../../ui.js";
import * as Viewer from "../../viewer.js";
import { DescentAssetCache } from "../Common/AssetCache.js";
import {
    DescentBitmapSource,
    DescentGameDataSource,
} from "../Common/AssetSource.js";
import { DescentPalette } from "../Common/AssetTypes.js";
import { flickerLights } from "../Common/FlickeringLight.js";
import postprocessLevel from "../Common/LevelUtils.js";
import { DescentTextureList } from "../Common/TextureList.js";
import { Descent1Level } from "../D1/D1Level.js";
import { Descent2Level } from "../D2/D2Level.js";
import { DescentHostageRenderer } from "./HostageRenderer.js";
import { DescentMineRenderer } from "./MineRenderer.js";
import { DescentPolymodelRenderer } from "./PolymodelRenderer.js";
import { DescentPowerupRenderer } from "./PowerupRenderer.js";
import { DescentRenderParameters } from "./RenderParameters.js";

export class DescentRenderer implements Viewer.SceneGfx {
    public renderHelper: GfxRenderHelper;
    private renderInstListMain = new GfxRenderInstList();
    public textureHolder: TextureHolder<any>;

    public mineMesh: DescentMineRenderer;
    public powerupRenderer: DescentPowerupRenderer;
    public hostageRenderer: DescentHostageRenderer;
    public polymodelRenderer: DescentPolymodelRenderer;
    public assetCache: DescentAssetCache;
    public textureList: DescentTextureList;
    public renderParameters: DescentRenderParameters;

    constructor(
        device: GfxDevice,
        private level: Descent1Level | Descent2Level,
        private palette: DescentPalette,
        pig: DescentBitmapSource,
        ham: DescentGameDataSource,
    ) {
        this.renderHelper = new GfxRenderHelper(device);
        const renderCache = this.renderHelper.renderCache;
        this.assetCache = new DescentAssetCache(palette, pig, ham);
        this.textureList = new DescentTextureList(device, this.assetCache);
        this.renderParameters = {
            enableShading: true,
            enableFlickeringLights: false, // Disable by default. Only Vertigo uses these, and they are all 'strobe' lights.
            showPolymodels: true,
            showHostages: true,
            showPowerups: true,
        };
        postprocessLevel(this.level, this.assetCache);
        this.mineMesh = new DescentMineRenderer(
            device,
            level,
            this.assetCache,
            this.textureList,
            renderCache,
            this.renderParameters,
        );
        this.powerupRenderer = new DescentPowerupRenderer(
            device,
            level,
            this.assetCache,
            this.textureList,
            renderCache,
            this.renderParameters,
        );
        this.hostageRenderer = new DescentHostageRenderer(
            device,
            level,
            this.assetCache,
            this.textureList,
            renderCache,
            this.renderParameters,
        );
        this.polymodelRenderer = new DescentPolymodelRenderer(
            device,
            level,
            this.assetCache,
            this.textureList,
            renderCache,
            this.renderParameters,
        );
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(0.016);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, "Render Hacks");

        const enableShading = new UI.Checkbox(
            "Enable Shading",
            this.renderParameters.enableShading,
        );
        enableShading.onchanged = () =>
            (this.renderParameters.enableShading = enableShading.checked);
        renderHacksPanel.contents.appendChild(enableShading.elem);

        // D1 has no flickering lights at all
        if (this.level.gameVersion > 1) {
            const enableFlickeringLights = new UI.Checkbox(
                "Enable Flickering Lights",
                this.renderParameters.enableFlickeringLights,
            );
            enableFlickeringLights.onchanged = () =>
                (this.renderParameters.enableFlickeringLights =
                    enableFlickeringLights.checked);
            renderHacksPanel.contents.appendChild(enableFlickeringLights.elem);
        }

        const showPolymodels = new UI.Checkbox(
            "Show Polymodels",
            this.renderParameters.showPolymodels,
        );
        showPolymodels.onchanged = () =>
            (this.renderParameters.showPolymodels = showPolymodels.checked);
        renderHacksPanel.contents.appendChild(showPolymodels.elem);

        const showPowerups = new UI.Checkbox(
            "Show Powerups",
            this.renderParameters.showPowerups,
        );
        showPowerups.onchanged = () =>
            (this.renderParameters.showPowerups = showPowerups.checked);
        renderHacksPanel.contents.appendChild(showPowerups.elem);

        const showHostages = new UI.Checkbox(
            "Show Hostages",
            this.renderParameters.showHostages,
        );
        showHostages.onchanged = () =>
            (this.renderParameters.showHostages = showHostages.checked);
        renderHacksPanel.contents.appendChild(showHostages.elem);

        return [renderHacksPanel];
    }

    private prepareToRender(
        renderInstManager: GfxRenderInstManager,
        viewerInput: Viewer.ViewerRenderInput,
    ): void {
        this.renderHelper.pushTemplateRenderInst();

        viewerInput.camera.setClipPlanes(0.1);
        renderInstManager.setCurrentList(this.renderInstListMain);

        if (this.renderParameters.enableFlickeringLights) {
            const flicker = flickerLights(
                this.level,
                viewerInput.deltaTime * 0.001,
            );
            this.mineMesh.applyFlicker(flicker.on, flicker.off);
        } else {
            // Make sure all lights are on
            const lightsOff = this.level.flickeringLights.filter(
                (light) => !light.isOn,
            );
            for (const light of lightsOff) light.isOn = true;
            this.mineMesh.applyFlicker(lightsOff, []);
        }

        this.mineMesh.prepareToRender(renderInstManager, viewerInput);
        if (this.renderParameters.showPowerups)
            this.powerupRenderer.prepareToRender(
                renderInstManager,
                viewerInput,
            );
        if (this.renderParameters.showHostages)
            this.hostageRenderer.prepareToRender(
                renderInstManager,
                viewerInput,
            );
        if (this.renderParameters.showPolymodels)
            this.polymodelRenderer.prepareToRender(
                renderInstManager,
                viewerInput,
            );

        renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    public getDefaultWorldMatrix(dst: mat4): void {
        // Find player spawn
        const spawn = this.level.objects.find(
            (obj) => obj.type === 4 && obj.subtypeId === 0,
        );
        if (spawn != null) {
            // Spawn found, extract matrix from it
            const right = vec3.fromValues(
                spawn.orientation[0],
                spawn.orientation[1],
                spawn.orientation[2],
            );
            const up = vec3.fromValues(
                spawn.orientation[3],
                spawn.orientation[4],
                spawn.orientation[5],
            );
            const forward = vec3.fromValues(
                spawn.orientation[6],
                spawn.orientation[7],
                spawn.orientation[8],
            );
            vec3.normalize(right, right);
            vec3.normalize(up, up);
            vec3.normalize(forward, forward);
            // Must invert Z coordinate!
            mat4.set(
                dst,
                right[0],
                right[1],
                -right[2],
                0,
                up[0],
                up[1],
                -up[2],
                0,
                -forward[0],
                -forward[1],
                forward[2],
                0,
                spawn.position[0],
                spawn.position[1],
                -spawn.position[2],
                1,
            );
        }
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(
            GfxrAttachmentSlot.Color0,
            viewerInput,
            opaqueBlackFullClearRenderPassDescriptor,
        );
        const mainDepthDesc = makeBackbufferDescSimple(
            GfxrAttachmentSlot.DepthStencil,
            viewerInput,
            opaqueBlackFullClearRenderPassDescriptor,
        );

        const mainColorTargetID = builder.createRenderTargetID(
            mainColorDesc,
            "Main Color",
        );
        const mainDepthTargetID = builder.createRenderTargetID(
            mainDepthDesc,
            "Main Depth",
        );
        builder.pushPass((pass) => {
            pass.setDebugName("Main");
            pass.attachRenderTargetID(
                GfxrAttachmentSlot.Color0,
                mainColorTargetID,
            );
            pass.attachRenderTargetID(
                GfxrAttachmentSlot.DepthStencil,
                mainDepthTargetID,
            );
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(
                    this.renderHelper.renderCache,
                    passRenderer,
                );
            });
        });
        builder.resolveRenderTargetToExternalTexture(
            mainColorTargetID,
            viewerInput.onscreenTexture,
        );

        this.prepareToRender(renderInstManager, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListMain.reset();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.mineMesh.destroy(device);
        this.powerupRenderer.destroy(device);
        this.hostageRenderer.destroy(device);
        this.polymodelRenderer.destroy(device);
        this.textureList.destroy(device);
    }
}
