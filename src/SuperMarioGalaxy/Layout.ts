
import { getDeltaTimeFrames, SceneObjHolder } from "./Main";
import { NameObj } from "./NameObj";
import { Spine } from "./Spine";
import { RLYT, RLAN, parseBRLYT, parseBRLAN, Layout, LayoutDrawInfo, LayoutAnimation, LayoutPane } from "../Common/NW4R/lyt/Layout";
import { JKRArchive } from "../Common/JSYSTEM/JKRArchive";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { initEachResTable } from "./LiveActor";
import { getRes } from "./Animation";
import { assert, assertExists } from "../util";
import { BTIData } from "../Common/JSYSTEM/JUTTexture";
import * as TPL from "../PaperMarioTTYD/tpl";
import { TextureMapping } from "../TextureHolder";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { J3DFrameCtrl } from "../Common/JSYSTEM/J3D/J3DGraphAnimator";
import { LoopMode as J3DLoopMode } from "../Common/JSYSTEM/J3D/J3DLoader";
import { LoopMode as NW4RLoopMode } from "../rres/brres";

export class LayoutHolder {
    public rlytTable = new Map<string, RLYT>();
    public rlanTable = new Map<string, RLAN>();
    public timgTable = new Map<string, BTIData>();
    // public rfntTable = new Map<string, any>();

    constructor(device: GfxDevice, cache: GfxRenderCache, layoutName: string, public arc: JKRArchive) {
        initEachResTable(this.arc, this.rlytTable, ['.brlyt'], (file) => parseBRLYT(file.buffer));
        initEachResTable(this.arc, this.rlanTable, ['.brlan'], (file) => parseBRLAN(file.buffer));
        initEachResTable(this.arc, this.timgTable, ['.tpl'], (file) => {
            const tplArchive = TPL.parse(file.buffer, [file.name]);
            assert(tplArchive.textures.length === 1);
            const tpl = tplArchive.textures[0]
            return new BTIData(device, cache, tpl);
        }, true);
    }

    public fillTextureByName(m: TextureMapping, name: string): void {
        this.timgTable.get(name.toLowerCase())!.fillTextureMapping(m);
    }

    public destroy(device: GfxDevice): void {
        for (const v of this.timgTable.values())
            v.destroy(device);
    }
}

class LayoutAnmPlayer {
    public frameCtrl = new J3DFrameCtrl(0);
    public curAnim: LayoutAnimation | null = null;

    public start(layoutManager: LayoutManager, animName: string): void {
        this.curAnim = assertExists(layoutManager.getAnimTransform(animName));
        this.frameCtrl.init(this.curAnim.duration);
        this.frameCtrl.loopMode = this.curAnim.loopMode === NW4RLoopMode.ONCE ? J3DLoopMode.ONCE : J3DLoopMode.REPEAT;
    }

    public movement(sceneObjHolder: SceneObjHolder): void {
        if (this.curAnim === null)
            return;
        this.frameCtrl.update(getDeltaTimeFrames(sceneObjHolder.viewerInput));
    }

    public reflectFrame(): void {
        if (this.curAnim === null)
            return;
        this.curAnim.currentFrame = this.frameCtrl.currentTimeInFrames;
        this.curAnim.update(0);
    }

    public isStop(): boolean {
        return this.frameCtrl.hasStopped();
    }
}

class LayoutPaneCtrl {
    public pane: LayoutPane;
    private anmPlayer: LayoutAnmPlayer[] = [];

    constructor(layoutManager: LayoutManager, paneName: string, numAnm: number) {
        this.pane = assertExists(layoutManager.layout.findPaneByName(paneName));
        for (let i = 0; i < numAnm; i++)
            this.anmPlayer.push(new LayoutAnmPlayer());
    }

    public calcAnim(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.anmPlayer.length; i++)
            this.anmPlayer[i].reflectFrame();
    }

    public movement(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.anmPlayer.length; i++)
            this.anmPlayer[i].movement(sceneObjHolder);
    }

    public start(layoutManager: LayoutManager, animName: string, index: number): void {
        const anmPlayer = this.anmPlayer[index];
        if (anmPlayer.curAnim !== null) {
            // unbindPaneCtrlAnim
        }

        anmPlayer.start(layoutManager, animName);
        // bindPaneCtrlAnim
    }

    public getFrameCtrl(index: number): J3DFrameCtrl {
        return this.anmPlayer[index].frameCtrl;
    }
}

class LayoutGroupCtrl {
    private anmPlayer: LayoutAnmPlayer[] = [];

    constructor(layoutManager: LayoutManager, groupName: string, numAnm: number) {
        // this.group = assertExists(layoutManager.layout.findGroupByName(groupName));
        for (let i = 0; i < numAnm; i++)
            this.anmPlayer.push(new LayoutAnmPlayer());
    }

    public calcAnim(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.anmPlayer.length; i++)
            this.anmPlayer[i].reflectFrame();
    }

    public movement(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.anmPlayer.length; i++)
            this.anmPlayer[i].movement(sceneObjHolder);
    }
}

class LayoutPaneInfo {
    public paneCtrl: LayoutPaneCtrl | null = null;

    constructor(public pane: LayoutPane) {
    }
}

class LayoutManager {
    private layoutHolder: LayoutHolder;
    private animations = new Map<string, LayoutAnimation>();
    private paneInfo: LayoutPaneInfo[] = [];
    private groupCtrl: LayoutGroupCtrl[] = [];

    public layout: Layout;
    public isHidden = false;

    constructor(sceneObjHolder: SceneObjHolder, layoutName: string, numRootAnm: number) {
        const device = sceneObjHolder.modelCache.device, cache = sceneObjHolder.modelCache.cache;

        this.layoutHolder = sceneObjHolder.modelCache.getLayoutHolder(layoutName);
        const layoutRes = assertExists(getRes(this.layoutHolder.rlytTable, layoutName));
        this.layout = new Layout(device, cache, layoutRes, this.layoutHolder);
        this.layoutHolder.rlanTable.forEach((rlan, key) => {
            this.animations.set(key, new LayoutAnimation(this.layout, rlan));
        });

        // removeUnnecessaryPanes

        this.initPaneInfoRecursive(this.layout.rootPane);

        // initGroupCtrlList
        // initDrawInfo
        // initTextBoxRecursive

        if (numRootAnm > 0)
            this.createAndAddPaneCtrl(this.layout.rootPane.name, numRootAnm);
    }

    public createAndAddPaneCtrl(name: string, numAnm: number): void {
        const index = this.getIndexOfPane(name);
        const paneInfo = this.paneInfo[index];
        if (paneInfo.paneCtrl === null)
            paneInfo.paneCtrl = new LayoutPaneCtrl(this, name, numAnm);
    }

    private initPaneInfoRecursive(pane: LayoutPane): void {
        this.paneInfo.push(new LayoutPaneInfo(pane));
        for (let i = 0; i < pane.children.length; i++)
            this.initPaneInfoRecursive(pane.children[i]);
    }

    private getIndexOfPane(name: string): number {
        for (let i = 0; i < this.paneInfo.length; i++)
            if (this.paneInfo[i].pane.name === name)
                return i;
        throw "whoops";
    }

    private getPaneInfo(name: string | null = null): LayoutPaneInfo {
        if (name === null)
            return this.paneInfo[0];
        else
            return this.paneInfo[this.getIndexOfPane(name)];
    }

    public getPaneCtrl(name: string | null = null): LayoutPaneCtrl {
        return assertExists(this.getPaneInfo(name).paneCtrl);
    }

    public getPane(name: string | null = null): LayoutPane {
        return this.getPaneInfo(name).pane;
    }

    public getRootPane(): LayoutPane {
        return this.getPane(null);
    }

    public getAnimTransform(name: string): LayoutAnimation | null {
        return getRes(this.animations, name);
    }

    public movement(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.paneInfo.length; i++) {
            const paneCtrl = this.paneInfo[i].paneCtrl;
            if (paneCtrl !== null)
                paneCtrl.movement(sceneObjHolder);
        }

        for (let i = 0; i < this.groupCtrl.length; i++)
            this.groupCtrl[i].movement(sceneObjHolder);
    }

    public calcAnim(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.paneInfo.length; i++) {
            const paneCtrl = this.paneInfo[i].paneCtrl;
            if (paneCtrl !== null)
                paneCtrl.calcAnim(sceneObjHolder);
        }

        for (let i = 0; i < this.groupCtrl.length; i++)
            this.groupCtrl[i].calcAnim(sceneObjHolder);
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, drawInfo: Readonly<LayoutDrawInfo>): void {
        if (this.isHidden)
            return;

        this.layout.draw(sceneObjHolder.modelCache.device, renderInstManager, drawInfo);
    }
}

export class LayoutActor<TNerve extends number = number> extends NameObj {
    public visibleAlive = true;
    public spine: Spine<TNerve> | null = null;
    public layoutManager: LayoutManager | null = null;

    public isStopDraw = false;
    public isStopCalcAnim = false;

    constructor(sceneObjHolder: SceneObjHolder, name: string) {
        super(sceneObjHolder, name);
    }

    public initNerve(nerve: TNerve): void {
        this.spine = new Spine<TNerve>();
        this.spine.initNerve(nerve);
    }

    public initLayoutManager(sceneObjHolder: SceneObjHolder, name: string, numAnm: number): void {
        this.layoutManager = new LayoutManager(sceneObjHolder, name, numAnm);
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        this.visibleAlive = true;
        this.calcAnim(sceneObjHolder);
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        // this.paneEffectKeeper.clear();
        this.visibleAlive = false;
    }

    protected control(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): void {
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: TNerve, deltaTimeFrames: number): void {
    }

    public movement(sceneObjHolder: SceneObjHolder): void {
        if (!this.visibleAlive)
            return;

        const deltaTimeFrames = getDeltaTimeFrames(sceneObjHolder.viewerInput);

        if (this.spine !== null) {
            this.spine.changeNerve();
            this.updateSpine(sceneObjHolder, this.spine.getCurrentNerve(), deltaTimeFrames);
            this.spine.updateTick(deltaTimeFrames);
            this.spine.changeNerve();
        }

        this.control(sceneObjHolder, deltaTimeFrames);

        if (this.layoutManager !== null)
            this.layoutManager.movement(sceneObjHolder);
    }

    public calcAnim(sceneObjHolder: SceneObjHolder): void {
        if (this.isStopCalcAnim || !this.visibleAlive || this.layoutManager === null)
            return;

        this.layoutManager.calcAnim(sceneObjHolder);
    }

    public drawLayout(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, drawInfo: Readonly<LayoutDrawInfo>): void {
        if (this.isStopDraw || !this.visibleAlive || this.layoutManager === null)
            return;

        this.layoutManager.draw(sceneObjHolder, renderInstManager, drawInfo);
    }

    public startAnim(animName: string, index: number = 0): void {
        const layoutManager = this.layoutManager!;
        const paneCtrl = layoutManager.getPaneCtrl(null);
        paneCtrl.start(layoutManager, animName, index);
    }

    public setAnimFrameAndStop(frame: number, index: number = 0): void {
        const frameCtrl = this.layoutManager!.getPaneCtrl().getFrameCtrl(index);
        frameCtrl.currentTimeInFrames = frame;
        frameCtrl.speedInFrames = 0;
    }

    public setAnimFrameAndStopAtEnd(index: number = 0): void {
        const frameCtrl = this.layoutManager!.getPaneCtrl().getFrameCtrl(index);
        this.setAnimFrameAndStop(frameCtrl.endFrame, index);
    }
}

export function hideLayout(actor: LayoutActor): void {
    actor.isStopDraw = true;
    actor.isStopCalcAnim = true;
}

export function showLayout(actor: LayoutActor): void {
    actor.isStopDraw = false;
    actor.isStopCalcAnim = false;
}
