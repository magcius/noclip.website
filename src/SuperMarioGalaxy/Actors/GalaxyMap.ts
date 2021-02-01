
import { mat4 } from "gl-matrix";
import { TransparentBlack } from "../../Color";
import { LayoutDrawInfo } from "../../Common/NW4R/lyt/Layout";
import { GfxFormat } from "../../gfx/platform/GfxPlatform";
import { GfxRenderInstList, GfxRenderInstManager } from "../../gfx/render/GfxRenderer";
import { GfxrAttachmentSlot, GfxrRenderTargetDescription } from "../../gfx/render/GfxRenderGraph";
import { GX_Program } from "../../gx/gx_material";
import { fillSceneParams, fillSceneParamsData, SceneParams, ub_SceneParamsBufferSize } from "../../gx/gx_render";
import { computeProjectionMatrixFromCuboid } from "../../MathHelpers";
import { connectToScene } from "../ActorUtil";
import { LayoutActor } from "../Layout";
import { SceneObjHolder } from "../Main";
import { CalcAnimType, DrawBufferType, DrawType, MovementType, NameObj } from "../NameObj";

export class GalaxyMapBackground extends LayoutActor {
    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'GalaxyMapBackground');
        this.initLayoutManager(sceneObjHolder, 'MapGalaxyBg', 1);
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        this.startAnim('Wait', 0);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestLayoutData('MapGalaxyBg');
    }
}

export class GalaxyMap extends LayoutActor {
    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'GalaxyMap');
        this.initLayoutManager(sceneObjHolder, 'MapGrandGalaxy', 1);

        // initDomeIcon
        // initMarioIcon
        // initTicoIcon
    }

    public drawForCapture(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, drawInfo: Readonly<LayoutDrawInfo>): void {
        // No difference in our case.
        this.drawLayout(sceneObjHolder, renderInstManager, drawInfo);
    }

    private forceToGalaxyMap(sceneObjHolder: SceneObjHolder): void {
        this.makeActorAppeared(sceneObjHolder);
        this.startAnim('DomeIn');
        this.setAnimFrameAndStopAtEnd();
        // this.galaxyMapTitle.startGalaxyMap();
        // this.setNerve(GalaxyMapNrv.Idle);
    }

    public movementForCapture(sceneObjHolder: SceneObjHolder): void {
        this.layoutManager!.movement(sceneObjHolder);

        // if (this.getNerve() === GalaxyMapNrv.ShowDetail)
        //     icon, comet
    }

    public setModeCapture(sceneObjHolder: SceneObjHolder): void {
        // this.makeActorAppeared(sceneObjHolder);
        this.forceToGalaxyMap(sceneObjHolder);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestLayoutData('MapGrandGalaxy');
    }
}

function connectToSceneLayoutOnPause(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    connectToScene(sceneObjHolder, nameObj, MovementType.LayoutOnPause, CalcAnimType.Layout, DrawBufferType.None, DrawType.None);
}

const scratchMatrix = mat4.create();
const scratchDrawInfo = new LayoutDrawInfo();
const sceneParams = new SceneParams();

const enum GalaxyMapControllerNrv { Wait }
export class GalaxyMapController extends LayoutActor<GalaxyMapControllerNrv> {
    private renderInstList = new GfxRenderInstList();
    private galaxyMapBackground: GalaxyMapBackground;
    private galaxyMap: GalaxyMap;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'GalaxyMapController');
        this.galaxyMapBackground = new GalaxyMapBackground(sceneObjHolder);
        this.galaxyMap = new GalaxyMap(sceneObjHolder);
        connectToSceneLayoutOnPause(sceneObjHolder, this);
    }

    public calcAnim(sceneObjHolder: SceneObjHolder): void {
        super.calcAnim(sceneObjHolder);

        this.galaxyMap.calcAnim(sceneObjHolder);
        this.galaxyMapBackground.calcAnim(sceneObjHolder);
    }

    public movement(sceneObjHolder: SceneObjHolder): void {
        super.movement(sceneObjHolder);

        this.galaxyMap.movement(sceneObjHolder);
        this.galaxyMapBackground.movement(sceneObjHolder);
    }

    private drawForCapture(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, desc: Readonly<GfxrRenderTargetDescription>): void {
        // this.killAllLayout();
        this.galaxyMapBackground.makeActorAppeared(sceneObjHolder);
        this.galaxyMap.setModeCapture(sceneObjHolder);
        this.galaxyMap.movementForCapture(sceneObjHolder);

        const template = renderInstManager.pushTemplateRenderInst();

        let offs = template.allocateUniformBuffer(GX_Program.ub_SceneParams, ub_SceneParamsBufferSize);
        const d = template.mapUniformBufferF32(GX_Program.ub_SceneParams);
        computeProjectionMatrixFromCuboid(scratchMatrix, -desc.width / 2, desc.width / 2, -desc.height / 2, desc.height / 2, -10000.0, 10000.0);
        fillSceneParams(sceneParams, scratchMatrix, desc.width, desc.height);
        fillSceneParamsData(d, offs, sceneParams);

        scratchDrawInfo.aspectAdjust = true;
        scratchDrawInfo.aspectAdjustScaleX = 0.75;
        scratchDrawInfo.aspectAdjustScaleY = 1.0;

        this.galaxyMapBackground.drawLayout(sceneObjHolder, renderInstManager, scratchDrawInfo);
        this.galaxyMap.drawForCapture(sceneObjHolder, renderInstManager, scratchDrawInfo);

        renderInstManager.popTemplateRenderInst();
    }

    public pushPasses(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager): number {
        const builder = sceneObjHolder.graphBuilder;

        const layoutTargetDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
        layoutTargetDesc.setDimensions(608, 456, 1);
        layoutTargetDesc.colorClearColor = TransparentBlack;
        const layoutTargetID = builder.createRenderTargetID(layoutTargetDesc, 'Galaxy Map Layout');

        builder.pushPass((pass) => {
            pass.setDebugName('Galaxy Map Layout');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, layoutTargetID);

            renderInstManager.setCurrentRenderInstList(this.renderInstList);
            this.drawForCapture(sceneObjHolder, renderInstManager, layoutTargetDesc);

            pass.exec((passRenderer) => {
                this.renderInstList.drawOnPassRenderer(sceneObjHolder.modelCache.device, renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        return layoutTargetID;
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        GalaxyMapBackground.requestArchives(sceneObjHolder);
        GalaxyMap.requestArchives(sceneObjHolder);
    }
}
