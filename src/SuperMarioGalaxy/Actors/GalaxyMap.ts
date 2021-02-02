
import { mat4, vec2 } from "gl-matrix";
import { TransparentBlack } from "../../Color";
import { LayoutDrawInfo } from "../../Common/NW4R/lyt/Layout";
import { GfxFormat } from "../../gfx/platform/GfxPlatform";
import { GfxRenderInstList, GfxRenderInstManager } from "../../gfx/render/GfxRenderer";
import { GfxrAttachmentSlot, GfxrRenderTargetDescription } from "../../gfx/render/GfxRenderGraph";
import { GX_Program } from "../../gx/gx_material";
import { fillSceneParams, fillSceneParamsData, SceneParams, ub_SceneParamsBufferSize } from "../../gx/gx_render";
import { computeProjectionMatrixFromCuboid, getMatrixTranslation } from "../../MathHelpers";
import { assertExists } from "../../util";
import { connectToScene } from "../ActorUtil";
import { hideLayout, LayoutActor, showLayout } from "../Layout";
import { SceneObj, SceneObjHolder } from "../Main";
import { CalcAnimType, DrawBufferType, DrawType, MovementType, NameObj } from "../NameObj";
import { GalaxyNameSortTable } from "./MiscActor";

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
        super.requestArchives(sceneObjHolder);
        sceneObjHolder.modelCache.requestLayoutData('MapGalaxyBg');
    }
}

function setLayoutScalePosAtPaneScaleTrans(dst: LayoutActor, src: LayoutActor, paneName: string): void {
    const srcPane = assertExists(src.layoutManager!.getPane(paneName));
    const dstPane = dst.layoutManager!.getRootPane();
    getMatrixTranslation(dstPane.translation, srcPane.worldFromLocalMatrix);
    vec2.copy(dstPane.scale, srcPane.scale);
}

const enum GalaxyMapIconStatus { Hidden, CanOpen, Opened, Completed }
class GalaxyMapIcon extends LayoutActor {
    constructor(sceneObjHolder: SceneObjHolder, private galaxyName: string, private parent: LayoutActor, private mapPaneName: string) {
        super(sceneObjHolder, 'GalaxyMapIcon');
        this.initLayoutManager(sceneObjHolder, 'MapGalaxyIcon', 2);
        this.layoutManager!.createAndAddPaneCtrl('GalaxyIcon', 1);
    }

    public calcAnim(sceneObjHolder: SceneObjHolder): void {
        setLayoutScalePosAtPaneScaleTrans(this, this.parent, this.mapPaneName);
        super.calcAnim(sceneObjHolder);
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        this.syncStatus(sceneObjHolder);
    }

    private examineIconStatus(sceneObjHolder: SceneObjHolder): GalaxyMapIconStatus {
        return GalaxyMapIconStatus.Completed;
    }

    private isBlink(sceneObjHolder: SceneObjHolder, iconStatus: GalaxyMapIconStatus): boolean {
        // if (this.isNewGalaxyDiscover)

        if (iconStatus === GalaxyMapIconStatus.Completed)
            return false;

        return true;
    }

    private syncStatus(sceneObjHolder: SceneObjHolder): void {
        const iconStatus = this.examineIconStatus(sceneObjHolder);
        if (iconStatus === GalaxyMapIconStatus.Hidden) {
            hideLayout(this);
        } else {
            showLayout(this);
            this.startAnim('Status');
            this.setAnimFrameAndStop(iconStatus);

            if (this.isBlink(sceneObjHolder, iconStatus))
                this.startAnim('NewBlink', 1);
            else
                this.startAnim('NewWait', 1);
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        super.requestArchives(sceneObjHolder);
        sceneObjHolder.modelCache.requestLayoutData('MapGalaxyIcon');
    }
}

class GalaxyMapMarioIcon extends LayoutActor {
    constructor(sceneObjHolder: SceneObjHolder, private parent: LayoutActor, private mapPaneName: string) {
        super(sceneObjHolder, 'GalaxyMapIconMario');
        this.initLayoutManager(sceneObjHolder, 'IconMario', 2);

        this.startAnim('Luigi', 1);
        const isLuigi = false;
        this.setAnimFrameAndStop(isLuigi ? 1 : 0, 1);
    }

    public calcAnim(sceneObjHolder: SceneObjHolder): void {
        setLayoutScalePosAtPaneScaleTrans(this, this.parent, this.mapPaneName);
        this.layoutManager!.getRootPane().alpha = this.parent.layoutManager!.getPane(this.mapPaneName).alpha;
        super.calcAnim(sceneObjHolder);
    }

    public showBlink(sceneObjHolder: SceneObjHolder): void {
        this.makeActorAppeared(sceneObjHolder);
        this.startAnim('Wait', 0);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        super.requestArchives(sceneObjHolder);
        sceneObjHolder.modelCache.requestLayoutData('IconMario');
    }
}

class GalaxyMap extends LayoutActor {
    private galaxyMapIcon: GalaxyMapIcon[] = [];
    private galaxyMapMarioIcon: GalaxyMapMarioIcon;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'GalaxyMap');
        this.initLayoutManager(sceneObjHolder, 'MapGrandGalaxy', 1);

        // initDomeIcon
        this.initMarioIcon(sceneObjHolder);
        // initTicoIcon
        this.initPaneCtrlPointing(sceneObjHolder);
    }

    private initMarioIcon(sceneObjHolder: SceneObjHolder): void {
        const mapPaneName = 'Mario7';
        this.galaxyMapMarioIcon = new GalaxyMapMarioIcon(sceneObjHolder, this, mapPaneName);
    }

    private initPaneCtrlPointing(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.create(SceneObj.GalaxyNameSortTable);

        sceneObjHolder.galaxyNameSortTable!.infoIter.mapRecords((infoIter) => {
            const mapPaneName = infoIter.getValueString('MapPaneName');
            if (mapPaneName === null || mapPaneName === '' || mapPaneName === 'dummy')
                return;

            const galaxyName = assertExists(infoIter.getValueString('name'));
            this.layoutManager!.createAndAddPaneCtrl(mapPaneName, 1);
            this.galaxyMapIcon.push(new GalaxyMapIcon(sceneObjHolder, galaxyName, this, mapPaneName));
        });
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        for (let i = 0; i < this.galaxyMapIcon.length; i++)
            this.galaxyMapIcon[i].makeActorAppeared(sceneObjHolder);
        this.galaxyMapMarioIcon.showBlink(sceneObjHolder);
    }

    public calcAnim(sceneObjHolder: SceneObjHolder): void {
        super.calcAnim(sceneObjHolder);
        for (let i = 0; i < this.galaxyMapIcon.length; i++)
            this.galaxyMapIcon[i].calcAnim(sceneObjHolder);
        this.galaxyMapMarioIcon.calcAnim(sceneObjHolder);
    }

    public drawForCapture(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, drawInfo: Readonly<LayoutDrawInfo>): void {
        this.drawLayout(sceneObjHolder, renderInstManager, drawInfo);
        for (let i = 0; i < this.galaxyMapIcon.length; i++)
            this.galaxyMapIcon[i].drawLayout(sceneObjHolder, renderInstManager, drawInfo);
        this.galaxyMapMarioIcon.drawLayout(sceneObjHolder, renderInstManager, drawInfo);
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
        super.requestArchives(sceneObjHolder);
        GalaxyNameSortTable.requestArchives(sceneObjHolder);
        GalaxyMapIcon.requestArchives(sceneObjHolder);
        GalaxyMapMarioIcon.requestArchives(sceneObjHolder);
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
        super.requestArchives(sceneObjHolder);
        GalaxyMapBackground.requestArchives(sceneObjHolder);
        GalaxyMap.requestArchives(sceneObjHolder);
    }
}
