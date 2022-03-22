
import { ModelCache, SceneObjHolder } from "./Main";
import { CalcAnimType, DrawBufferType, DrawType, MovementType, NameObj } from "./NameObj";
import { Spine } from "./Spine";
import { RLYT, RLAN, parseBRLYT, parseBRLAN, Layout, LayoutDrawInfo, LayoutAnimation, LayoutPane, LayoutTextbox } from "../Common/NW4R/lyt/Layout";
import { JKRArchive } from "../Common/JSYSTEM/JKRArchive";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { initEachResTable } from "./LiveActor";
import { getRes } from "./Animation";
import { assert, assertExists } from "../util";
import { BTIData } from "../Common/JSYSTEM/JUTTexture";
import * as TPL from "../PaperMarioTTYD/tpl";
import { TextureMapping } from "../TextureHolder";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { J3DFrameCtrl } from "../Common/JSYSTEM/J3D/J3DGraphAnimator";
import { LoopMode as J3DLoopMode } from "../Common/JSYSTEM/J3D/J3DLoader";
import { LoopMode as NW4RLoopMode } from "../rres/brres";
import { CharWriter, parseBRFNT, ResFont, TagProcessor } from "../Common/NW4R/lyt/Font";
import { vec3, vec4 } from "gl-matrix";
import { connectToScene } from "./ActorUtil";
import { getLayoutMessageDirect } from "./MessageData";
import { ViewerRenderInput } from "../viewer";
import { GX_Program } from "../gx/gx_material";
import { ub_SceneParamsBufferSize } from "../gx/gx_render";
import { Color, colorCopy, colorNewCopy, colorNewFromRGBA8, OpaqueBlack, TransparentBlack, White } from "../Color";

export class LayoutHolder {
    public rlytTable = new Map<string, RLYT>();
    public rlanTable = new Map<string, RLAN>();
    public timgTable = new Map<string, BTIData>();

    constructor(device: GfxDevice, cache: GfxRenderCache, private gameSystemFontHolder: GameSystemFontHolder, private layoutName: string, public arc: JKRArchive) {
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

    public getFontByName(name: string) {
        return this.gameSystemFontHolder.getFontByName(name);
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
        let deltaTimeFrames = sceneObjHolder.deltaTimeFrames;
        // Layout animations expect 30fps, we're timed for 60fps.
        deltaTimeFrames /= 2;
        this.frameCtrl.update(deltaTimeFrames);
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

    public isAnimStopped(index: number): boolean {
        return this.anmPlayer[index].isStop();
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

const LanguagePrefixes = [
    'JpJa', // JpJapanese
    'UsEn', // UsEnglish
    'UsSp', // UsSpanish
    'UsFr', // UsFrench
    'EuEn', // EuEnglish
    'EuSp', // EuSpanish
    'EuFr', // EuFrench
    'EuGe', // EuGerman
    'EuIt', // EuItalian
    'EuDu', // EuDutch
    'CnSi', // CnSimplifiedChinese
    'KrKo', // KrKorean
];

const ColorTable = [
    colorNewFromRGBA8(0xFFFFFFFF),
    colorNewFromRGBA8(0xDC8282FF),
    colorNewFromRGBA8(0x50AA50FF),
    colorNewFromRGBA8(0x508CD2FF),
    colorNewFromRGBA8(0xEBC800FF),
    colorNewFromRGBA8(0xB46EC8FF),
    colorNewFromRGBA8(0xFFBEBEFF),
    colorNewFromRGBA8(0x6EF346FF),
    colorNewFromRGBA8(0x78FFFFFF),
    colorNewFromRGBA8(0xFFFF50FF),
    colorNewFromRGBA8(0xFBBCFAFF),
    colorNewFromRGBA8(0xBEBEC8FF),
];

class CustomTagProcessor implements TagProcessor {
    private isSha = false;
    private isInf = false;
    private isTxt = false;
    private colorType: number = 0;
    private matColor0 = colorNewCopy(White);
    private matColor1 = colorNewCopy(White);
    private layout: Layout;

    private linefeed(writer: CharWriter, rect: vec4 | null): void {
        writer.cursor[0] = writer.origin[0];
        writer.cursor[1] -= writer.getScaledLineHeight();

        if (rect !== null)
            writer.calcRectFromCursor(rect);
    }

    private setColor(writer: CharWriter, colorType: number): void {
        this.colorType = colorType;
        if (colorType !== 0) {
            writer.setColorMapping(ColorTable[colorType]);
            writer.color0.a = this.matColor0.a;
        } else {
            writer.setColorMapping(this.matColor0, this.matColor1);
        }
    }

    private exSystemColor(writer: CharWriter, rect: vec4 | null, colorType: number): void {
        if (rect !== null) {
            // No need to do anything in calcRect mode...
            return;
        }

        if (this.isSha)
            return;

        if (this.isInf && colorType > 0 && colorType < 6)
            colorType += 5;

        this.setColor(writer, colorType);
    }

    private exPicture(writer: CharWriter, dst: vec4 | null, picture: number): void {
        const oldFont = writer.font;
        writer.setFont(this.layout.resourceCollection.getFontByName('PictureFont.brfnt')!);

        if (this.colorType === 0 && !this.isSha)
            writer.setColorMapping(TransparentBlack, White);

        const pictureChar = 0x30 + picture;
        if (dst !== null)
            writer.advanceCharacter(dst, pictureChar, true);
        else
            writer.writeCharacter(pictureChar, true);
        writer.setFont(oldFont);

        if (this.colorType === 0 && !this.isSha)
            this.setColor(writer, this.colorType);
    }

    private exCmd(writer: CharWriter, dst: vec4 | null, str: string, i: number): number {
        const size = str.charCodeAt(i + 1) >>> 9;
        const cmd = str.charCodeAt(i + 1) & 0xFF;
        if (cmd === 0xFF) {
            // System.
            const subcmd = str.charCodeAt(i + 2) >>> 8;
            if (subcmd === 0) {
                // Color.
                const colorType = str.charCodeAt(i + 3) >>> 8;
                this.exSystemColor(writer, dst, colorType);
            }
        } else if (cmd === 0x03) {
            // Picture.
            const picture = str.charCodeAt(i + 2);
            this.exPicture(writer, dst, picture);
        }
        return i + size;
    }

    public reset(writer: CharWriter, rect: vec4 | null): void {
        this.colorType = 0;

        if (rect === null) {
            colorCopy(this.matColor0, writer.color0);
            colorCopy(this.matColor1, writer.color1);
        }
    }

    public processTag(writer: CharWriter, rect: vec4 | null, str: string, i: number): number {
        const code = str.charCodeAt(i);
        if (code === 0x0A) {
            this.linefeed(writer, rect);
            return i + 1;
        } else if (code === 0x1A) {
            return this.exCmd(writer, rect, str, i);
        } else {
            throw "whoops";
        }
    }

    public configure(box: LayoutTextbox, layout: Layout): void {
        this.isSha = box.name.includes('Sha');
        this.isInf = box.name.includes('Inf');
        this.isTxt = box.name.includes('Txt');
        this.layout = layout;
    }
}

class LayoutManager {
    private layoutHolder: LayoutHolder;
    private animations = new Map<string, LayoutAnimation>();
    private paneInfo: LayoutPaneInfo[] = [];
    private groupCtrl: LayoutGroupCtrl[] = [];
    public tagProcessor = new CustomTagProcessor();

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

        this.removeUnnecessaryPanes(this.layout.rootPane);
        this.initPaneInfoRecursive(this.layout.rootPane);

        // initGroupCtrlList
        // initDrawInfo
        this.initTextBoxRecursive(sceneObjHolder, this.layout.rootPane, null, layoutName);

        if (numRootAnm > 0)
            this.createAndAddPaneCtrl(this.layout.rootPane.name, numRootAnm);
    }

    private initTextBoxRecursive(sceneObjHolder: SceneObjHolder, pane: LayoutPane, userData: string | null, layoutName: string): void {
        if (pane.userData !== "")
            userData = pane.userData;

        if (pane instanceof LayoutTextbox) {
            if (userData !== null) {
                const messageID = `Layout_${layoutName}${userData}`;
                pane.str = getLayoutMessageDirect(sceneObjHolder, messageID)!;
            }

            pane.tagProcessor = this.tagProcessor;
        }

        for (let i = 0; i < pane.children.length; i++)
            this.initTextBoxRecursive(sceneObjHolder, pane.children[i], userData, layoutName);
    }

    private isUnnecessaryPane(pane: LayoutPane): boolean {
        const name = pane.name;
        const CurrentLanguage = 1; // UsEnglish
        for (let i = 0; i < LanguagePrefixes.length; i++) {
            if (i === CurrentLanguage)
                continue;
            if (name.endsWith(LanguagePrefixes[i]))
                return true;
        }

        return false;
    }

    private removeUnnecessaryPanes(pane: LayoutPane): void {
        for (let i = 0; i < pane.children.length; i++) {
            if (this.isUnnecessaryPane(pane.children[i]))
                pane.children.splice(i--, 1);
            else
                this.removeUnnecessaryPanes(pane.children[i]);
        }
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

    public destroy(device: GfxDevice): void {
        this.layout.destroy(device);
    }
}

const scratchDrawInfo = new LayoutDrawInfo();

export class LayoutActor<TNerve extends number = number> extends NameObj {
    public visibleAlive = true;
    public spine: Spine<TNerve> | null = null;
    public layoutManager: LayoutManager | null = null;

    public isStopDraw = false;
    public isStopCalcAnim = false;
    public isScreenHidden = false;

    constructor(sceneObjHolder: SceneObjHolder, name: string) {
        super(sceneObjHolder, name);
    }

    public initNerve(nerve: TNerve): void {
        this.spine = new Spine<TNerve>();
        this.spine.initNerve(nerve);
    }

    public setNerve(nerve: TNerve): void {
        this.spine!.setNerve(nerve);
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

    public override movement(sceneObjHolder: SceneObjHolder): void {
        if (!this.visibleAlive)
            return;

        const deltaTimeFrames = sceneObjHolder.deltaTimeFrames;

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

    public override calcAnim(sceneObjHolder: SceneObjHolder): void {
        if (this.isStopCalcAnim || !this.visibleAlive || this.layoutManager === null)
            return;

        this.layoutManager.calcAnim(sceneObjHolder);
    }

    public drawLayout(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, drawInfo: Readonly<LayoutDrawInfo>): void {
        if (this.isStopDraw || !this.visibleAlive || this.layoutManager === null)
            return;

        this.layoutManager.draw(sceneObjHolder, renderInstManager, drawInfo);
    }

    public override draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (this.isScreenHidden)
            return;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setUniformBufferOffset(GX_Program.ub_SceneParams, sceneObjHolder.renderParams.sceneParamsOffs2D, ub_SceneParamsBufferSize);
        this.drawLayout(sceneObjHolder, renderInstManager, scratchDrawInfo);
        renderInstManager.popTemplateRenderInst();
    }

    public startAnim(animName: string, index: number = 0): void {
        const layoutManager = this.layoutManager!;
        const paneCtrl = layoutManager.getPaneCtrl(null);
        paneCtrl.start(layoutManager, animName, index);
    }

    public startPaneAnim(paneName: string, animName: string, index: number = 0): void {
        const layoutManager = this.layoutManager!;
        const paneCtrl = layoutManager.getPaneCtrl(paneName);
        paneCtrl.start(layoutManager, animName, index);
    }

    public isAnimStopped(index: number = 0): boolean {
        return this.layoutManager!.getPaneCtrl().isAnimStopped(index);
    }

    public setPaneAnimFrameAndStop(frame: number, paneName: string, index: number = 0): void {
        const frameCtrl = this.layoutManager!.getPaneCtrl(paneName).getFrameCtrl(index);
        frameCtrl.currentTimeInFrames = frame;
        frameCtrl.speedInFrames = 0;
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

    public override destroy(device: GfxDevice): void {
        if (this.layoutManager !== null)
            this.layoutManager.destroy(device);
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder): void {
        GameSystemFontHolder.requestArchives(sceneObjHolder);
    }
}

export class GameSystemFontHolder {
    private rfntTable = new Map<string, ResFont>();

    constructor(modelCache: ModelCache) {
        const arc = modelCache.getLayoutData('Font');
        initEachResTable(arc, this.rfntTable, ['.brfnt'], (file) => {
            const rfnt = parseBRFNT(file.buffer);
            return new ResFont(modelCache.device, rfnt);
        }, true);
    }

    public destroy(device: GfxDevice): void {
        for (const v of this.rfntTable.values())
            v.destroy(device);
    }

    public getFontByName(name: string): ResFont {
        return assertExists(getRes(this.rfntTable, name.toLowerCase()));
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestLayoutData('Font');
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

function setPaneVisibleRecursiveInternal(pane: LayoutPane, v: boolean): void {
    pane.visible = v;

    for (let i = 0; i < pane.children.length; i++)
        setPaneVisibleRecursiveInternal(pane.children[i], v);
}

export function showPaneRecursive(actor: LayoutActor, paneName: string): void {
    setPaneVisibleRecursiveInternal(actor.layoutManager!.getPane(paneName), true);
}

export function hidePaneRecursive(actor: LayoutActor, paneName: string): void {
    setPaneVisibleRecursiveInternal(actor.layoutManager!.getPane(paneName), false);
}

function setTextBoxRecursiveInternal(pane: LayoutPane, v: string): void {
    if (pane instanceof LayoutTextbox)
        pane.str = v;

    for (let i = 0; i < pane.children.length; i++)
        setTextBoxRecursiveInternal(pane.children[i], v);
}

export function setTextBoxRecursive(actor: LayoutActor, paneName: string, v: string): void {
    setTextBoxRecursiveInternal(actor.layoutManager!.getPane(paneName), v);
}

const scratchVec4a = vec4.create(), scratchVec4b = vec4.create();
function getTextDrawRectRecursive(dst: vec4, layout: Layout, pane: LayoutPane): void {
    vec4.set(dst, Infinity, Infinity, -Infinity, -Infinity);
    if (pane instanceof LayoutTextbox) {
        pane.getTextDrawRect(scratchVec4a, layout);
        dst[0] = Math.min(dst[0], scratchVec4a[0]);
        dst[1] = Math.min(dst[1], scratchVec4a[1]);
        dst[2] = Math.max(dst[2], scratchVec4a[2]);
        dst[3] = Math.max(dst[3], scratchVec4a[3]);
    }

    for (let i = 0; i < pane.children.length; i++)
        getTextDrawRectRecursive(dst, layout, pane.children[i]);
}

export function setAnimFrameAndStopAdjustTextWidth(actor: LayoutActor, paneName: string, anmIndex: number): void {
    const layoutManager = actor.layoutManager!;
    getTextDrawRectRecursive(scratchVec4b, layoutManager.layout, layoutManager.getPane(paneName));
    const width = scratchVec4b[2] - scratchVec4b[0];
    actor.setAnimFrameAndStop(width, anmIndex);
}

export function createAndAddPaneCtrl(actor: LayoutActor, paneName: string, numAnm: number): void {
    const layoutManager = actor.layoutManager!;
    layoutManager.createAndAddPaneCtrl(paneName, numAnm);
}

export function connectToSceneLayout(sceneObjHolder: SceneObjHolder, actor: LayoutActor): void {
    connectToScene(sceneObjHolder, actor, MovementType.Layout, CalcAnimType.Layout, DrawBufferType.None, DrawType.Layout);
}

export function hideScreen(actor: LayoutActor): void {
    actor.isScreenHidden = true;
}

export function showScreen(actor: LayoutActor): void {
    actor.isScreenHidden = false;
}

export function getPaneAnimFrameMax(actor: LayoutActor, paneName: string, index: number): number {
    return actor.layoutManager!.getPaneCtrl(paneName).getFrameCtrl(index).endFrame;
}
