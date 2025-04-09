
import { ReadonlyVec3, mat4, vec2, vec3 } from "gl-matrix";
import { MathConstants, saturate, setMatrixTranslation, transformVec3Mat4w1, vec3SetAll } from "../../MathHelpers.js";
import { PeekZManager, PeekZResult } from "../../ZeldaWindWaker/d_dlst_peekZ.js";
import { gfxDeviceNeedsFlipY } from "../../gfx/helpers/GfxDeviceHelpers.js";
import { compareDepthValues } from "../../gfx/helpers/ReversedDepthHelpers.js";
import { GfxClipSpaceNearZ, GfxCompareMode, GfxDevice } from "../../gfx/platform/GfxPlatform.js";
import { GfxrGraphBuilder, GfxrRenderTargetID } from "../../gfx/render/GfxRenderGraph.js";
import { GfxRenderInstManager } from "../../gfx/render/GfxRenderInstManager.js";
import { fallback } from "../../util.js";
import { ViewerRenderInput } from "../../viewer.js";
import { connectToScene3DModelFor2D, connectToSceneMapObjMovement, getAreaObj, getBckFrameMax, getBrkFrameMax, getCamYdir, getPlayerPos, hideModel, isBckStopped, setBckFrameAndStop, setBrkFrameAndStop, setMtxAxisXYZ, showModel, startBckWithInterpole, startBrk, startBtk } from "../ActorUtil.js";
import { AreaFormType, AreaObj } from "../AreaObj.js";
import { JMapInfoIter, getJMapInfoArg0 } from "../JMapInfo.js";
import { LiveActor, ZoneAndLayer, dynamicSpawnZoneAndLayer, isDead } from "../LiveActor.js";
import { SceneObj, SceneObjHolder } from "../Main.js";
import { NameObj } from "../NameObj.js";
import { isFirstStep } from "../Spine.js";

function calcRotateY(x: number, y: number): number {
    return (MathConstants.TAU / 4) + Math.atan2(-y, x);
}

export class DrawSyncManager {
    public peekZ = new PeekZManager();

    public beginFrame(device: GfxDevice): void {
        this.peekZ.beginFrame(device);
    }

    public endFrame(renderInstManager: GfxRenderInstManager, builder: GfxrGraphBuilder, depthTargetID: GfxrRenderTargetID): void {
        this.peekZ.pushPasses(renderInstManager, builder, depthTargetID);
        this.peekZ.peekData(renderInstManager.gfxRenderCache.device);
    }

    public destroy(device: GfxDevice): void {
        this.peekZ.destroy(device);
    }
}

const scratchVec2 = vec2.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec3 = vec3.create();
const scratchMatrix = mat4.create();

function calcScreenPosition(dst: vec2, v: ReadonlyVec3, viewerInput: ViewerRenderInput): void {
    dst[0] = (v[0] * 0.5 + 0.5) * viewerInput.backbufferWidth;
    dst[1] = (v[1] * 0.5 + 0.5) * viewerInput.backbufferHeight;
}

export class BrightObjCheckArg {
    public pointsNum: number = 0;
    public pointsVisibleNum: number = 0;
    public posCenterAccum = vec2.create();
    public posCenter = vec2.create();

    public peekZ: PeekZResult[] = [];
}

export class BrightObjBase {
    public isFullyHidden: boolean = true;

    protected bright: number = 0.0;
    protected center = vec2.create();
    protected brightCenter = vec2.create();
    protected nowCenter = vec2.create();

    public checkVisibilityOfSphere(sceneObjHolder: SceneObjHolder, checkArg: BrightObjCheckArg, position: vec3, radius: number): void {
        getCamYdir(scratchVec3a, sceneObjHolder.viewerInput.camera);
        vec3.sub(scratchVec3b, scratchVec3a, position);
        vec3.normalize(scratchVec3b, scratchVec3b);

        vec3.cross(scratchVec3c, scratchVec3a, scratchVec3b);
        vec3.cross(scratchVec3a, scratchVec3b, scratchVec3c);
        setMtxAxisXYZ(scratchMatrix, scratchVec3c, scratchVec3a, scratchVec3b);
        setMatrixTranslation(scratchMatrix, position);

        checkArg.pointsNum = 0;
        checkArg.pointsVisibleNum = 0;
        vec2.set(checkArg.posCenterAccum, 0.0, 0.0);

        vec3.transformMat4(scratchVec3, position, sceneObjHolder.viewerInput.camera.clipFromWorldMatrix);
        calcScreenPosition(checkArg.posCenter, scratchVec3, sceneObjHolder.viewerInput);
        this.checkVisible(sceneObjHolder, checkArg, position);

        for (let i = 0; i < 8; i++) {
            const theta = MathConstants.TAU * (i / 8);
            const x = Math.cos(theta), y = Math.sin(theta);
            const rad = 0.4 * radius;
            vec3.set(scratchVec3a, rad * x, rad * y, 0.0);
            transformVec3Mat4w1(scratchVec3a, scratchMatrix, scratchVec3a);
            this.checkVisible(sceneObjHolder, checkArg, scratchVec3a);
        }

        for (let i = 0; i < 8; i++) {
            const theta = MathConstants.TAU * (i / 8);
            const x = Math.cos(theta), y = Math.sin(theta);
            const rad = 0.7 * radius;
            vec3.set(scratchVec3a, rad * x, rad * y, 0.0);
            transformVec3Mat4w1(scratchVec3a, scratchMatrix, scratchVec3a);
            this.checkVisible(sceneObjHolder, checkArg, scratchVec3a);
        }

        this.setResult(checkArg);
    }

    private checkVisible(sceneObjHolder: SceneObjHolder, checkArg: BrightObjCheckArg, position: ReadonlyVec3): void {
        vec3.transformMat4(scratchVec3, position, sceneObjHolder.viewerInput.camera.clipFromWorldMatrix);

        let peekZResult: PeekZResult;
        if (checkArg.pointsNum === checkArg.peekZ.length) {
            peekZResult = new PeekZResult();
            checkArg.peekZ.push(peekZResult);
        } else {
            peekZResult = checkArg.peekZ[checkArg.pointsNum];
        }

        let x = scratchVec3[0];
        let y = scratchVec3[1];
        if (!gfxDeviceNeedsFlipY(sceneObjHolder.modelCache.device))
            y *= -1;

        sceneObjHolder.drawSyncManager.peekZ.newData(peekZResult, x, y);

        checkArg.pointsNum++;

        if (!peekZResult.triviallyCulled && peekZResult.value !== null) {
            // Test if the depth buffer is less than our projected Z coordinate.
            // Depth buffer readback should result in 0.0 for the near plane, and 1.0 for the far plane.
            // Put projected coordinate in 0-1 normalized space.
            let projectedZ = scratchVec3[2];

            if (sceneObjHolder.modelCache.device.queryVendorInfo().clipSpaceNearZ === GfxClipSpaceNearZ.NegativeOne)
                projectedZ = projectedZ * 0.5 + 0.5;

            const visible = compareDepthValues(projectedZ, peekZResult.value, GfxCompareMode.Less);

            if (visible) {
                checkArg.pointsVisibleNum++;
                calcScreenPosition(scratchVec2, scratchVec3, sceneObjHolder.viewerInput);
                vec2.add(checkArg.posCenterAccum, checkArg.posCenterAccum, scratchVec2);
            }
        }
    }

    public setResult(checkArg: BrightObjCheckArg): void {
        if (checkArg.pointsVisibleNum > 0) {
            this.isFullyHidden = false;

            vec2.copy(this.nowCenter, checkArg.posCenter);

            const centerAvgX = checkArg.posCenterAccum[0] / checkArg.pointsVisibleNum;
            const centerAvgY = checkArg.posCenterAccum[1] / checkArg.pointsVisibleNum;
            vec2.set(this.brightCenter, centerAvgX, centerAvgY);

            this.bright = checkArg.pointsVisibleNum / checkArg.pointsNum;
        } else {
            this.bright = 0.0;
            this.isFullyHidden = true;
        }

        vec2.copy(this.center, checkArg.posCenter);
    }

    public getBright(): number {
        return this.isFullyHidden ? 0.0 : this.bright;
    }

    public getCenter(): vec2 {
        return this.center;
    }

    public getBrightCenter(): vec2 {
        return this.brightCenter;
    }

    public getNowCenter(): vec2 {
        return this.nowCenter;
    }
}

class LensFlareArea extends AreaObj {
    public flags: number;

    protected override parseArgs(infoIter: JMapInfoIter): void {
        this.flags = fallback(getJMapInfoArg0(infoIter), -1);
    }

    protected override postCreate(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.create(SceneObj.LensFlareDirector);
    }
}

class TriggerChecker {
    public last: boolean = false;
    public curr: boolean = false;

    public setInput(v: boolean): void {
        this.last = v;
        this.curr = v;
    }

    public update(v: boolean): void {
        this.last = this.curr;
        this.curr = v;
    }

    public getLevel(): boolean {
        return this.curr;
    }

    public getOffTrigger(): boolean {
        return this.last && !this.curr;
    }

    public getOnTrigger(): boolean {
        return !this.last && this.curr;
    }
}

const enum LensFlareModelNrv { Kill, Show, Hide, FadeIn, FadeOut }

abstract class LensFlareModel extends LiveActor<LensFlareModelNrv> {
    public brightness = 0.0;

    protected fade = 0.0;
    protected fadeStep = 0.0;

    private triggerArea = new TriggerChecker();
    private triggerVisible = new TriggerChecker();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, name: string) {
        super(zoneAndLayer, sceneObjHolder, name);

        this.initModelManagerWithAnm(sceneObjHolder, name);
        connectToScene3DModelFor2D(sceneObjHolder, this);
        this.initNerve(LensFlareModelNrv.Kill);
        this.makeActorDead(sceneObjHolder);
    }

    protected abstract appearAnim(sceneObjHolder: SceneObjHolder): void;
    protected abstract controlAnim(sceneObjHolder: SceneObjHolder): void;

    private notifyInArea(sceneObjHolder: SceneObjHolder): void {
        if (isDead(this))
            this.makeActorAppeared(sceneObjHolder);

        if (this.triggerVisible.getLevel())
            this.setNerve(LensFlareModelNrv.FadeIn);
        else
            this.setNerve(LensFlareModelNrv.Hide);
    }

    public override makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        this.appearAnim(sceneObjHolder);
    }

    public override control(sceneObjHolder: SceneObjHolder): void {
        this.controlAnim(sceneObjHolder);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: LensFlareModelNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === LensFlareModelNrv.Show) {
            if (isFirstStep(this)) {
                showModel(this);
                this.fade = 1.0;
            }
        } else if (currentNerve === LensFlareModelNrv.Hide) {
            if (isFirstStep(this)) {
                hideModel(this);
                this.fade = 0.0;
            }
        } else if (currentNerve === LensFlareModelNrv.FadeIn) {
            if (isFirstStep(this))
                showModel(this);

            this.fade += this.fadeStep * deltaTimeFrames;
            if (this.fade >= 1.0) {
                this.fade = 1.0;
                this.setNerve(LensFlareModelNrv.Show);
            }
        } else if (currentNerve === LensFlareModelNrv.FadeOut) {
            this.fade -= this.fadeStep * deltaTimeFrames;
            if (this.fade <= 0.0) {
                this.fade = 0.0;
                this.setNerve(LensFlareModelNrv.Hide);
            }
        }
    }

    public update(sceneObjHolder: SceneObjHolder, areaFlag: boolean, hasBrightObj: boolean): void {
        this.triggerArea.update(areaFlag);
        if (this.triggerArea.getOnTrigger())
            this.notifyInArea(sceneObjHolder);
        else if (this.triggerArea.getOffTrigger())
            this.setNerve(LensFlareModelNrv.FadeOut);

        const visible = areaFlag && hasBrightObj;
        this.triggerVisible.update(visible);

        if (this.triggerVisible.getOnTrigger()) {
            if (this.getCurrentNerve() === LensFlareModelNrv.Hide)
                this.setNerve(LensFlareModelNrv.Show);
        } else if (this.triggerVisible.getOffTrigger()) {
            if (this.getCurrentNerve() === LensFlareModelNrv.Show || this.getCurrentNerve() === LensFlareModelNrv.FadeOut)
                this.setNerve(LensFlareModelNrv.Hide);
        }
    }
}

class LensFlareRing extends LensFlareModel {
    public distFromCenter = 0.0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder) {
        super(zoneAndLayer, sceneObjHolder, 'LensFlare');
        this.fadeStep = 0.05;
        vec3SetAll(this.scale, 0.135);
    }

    protected appearAnim(sceneObjHolder: SceneObjHolder): void {
        startBckWithInterpole(this, 'LensFlare', 0.0);
    }

    protected controlAnim(sceneObjHolder: SceneObjHolder): void {
        startBrk(this, 'LensFlare');
        const endFrameBrk = getBrkFrameMax(this);
        setBrkFrameAndStop(this, (1.0 - this.brightness * this.fade) * endFrameBrk);

        if (isBckStopped(this)) {
            startBckWithInterpole(this, 'LensFlare', 0);
        }

        const endFrameBck = getBckFrameMax(this);
        setBckFrameAndStop(this, this.distFromCenter * endFrameBck);
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('LensFlare');
    }
}

class LensFlareGlow extends LensFlareModel {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder) {
        super(zoneAndLayer, sceneObjHolder, 'GlareGlow');
        this.fadeStep = 0.05;
    }

    protected appearAnim(sceneObjHolder: SceneObjHolder): void {
        startBtk(this, 'GlareGlow');
    }

    protected controlAnim(sceneObjHolder: SceneObjHolder): void {
        startBrk(this, 'GlareGlow');
        const endFrame = getBrkFrameMax(this);
        setBrkFrameAndStop(this, (1.0 - this.brightness * this.fade) * endFrame);
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('GlareGlow');
    }
}

class LensFlareLine extends LensFlareModel {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder) {
        super(zoneAndLayer, sceneObjHolder, 'GlareLine');
        this.fadeStep = 0.05;
    }

    protected appearAnim(sceneObjHolder: SceneObjHolder): void {
    }

    protected controlAnim(sceneObjHolder: SceneObjHolder): void {
        startBrk(this, 'GlareLine');
        const endFrame = getBrkFrameMax(this);
        setBrkFrameAndStop(this, (1.0 - this.brightness * this.fade) * endFrame);
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('GlareLine');
    }
}

export class LensFlareDirector extends NameObj {
    private brightObj: BrightObjBase[] = [];

    private ring: LensFlareRing;
    private glow: LensFlareGlow;
    private line: LensFlareLine;

    private curBright: number = 0.0;
    private curNowCenter = vec2.create();
    private curCenter = vec2.create();
    private curBrightCenter = vec2.create();

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, "LensFlareDirector");

        connectToSceneMapObjMovement(sceneObjHolder, this);

        this.ring = new LensFlareRing(dynamicSpawnZoneAndLayer, sceneObjHolder);
        this.glow = new LensFlareGlow(dynamicSpawnZoneAndLayer, sceneObjHolder);
        this.line = new LensFlareLine(dynamicSpawnZoneAndLayer, sceneObjHolder);
    }

    public addBrightObj(brightObj: BrightObjBase): void {
        this.brightObj.push(brightObj);
    }

    private checkArea(sceneObjHolder: SceneObjHolder): number {
        getPlayerPos(scratchVec3a, sceneObjHolder);

        const areaObj = getAreaObj<LensFlareArea>(sceneObjHolder, 'LensFlareArea', scratchVec3a);
        if (areaObj !== null) {
            if (areaObj.flags >= 0)
                return areaObj.flags;
            else
                return 0xFFFF;
        }

        return 0;
    }

    private checkBrightObj(inArea: boolean): boolean {
        if (!inArea || this.brightObj.length === 0)
            return false;

        for (let i = 0; i < this.brightObj.length; i++) {
            const brightObj = this.brightObj[i];
            const bright = brightObj.getBright();

            if (bright > 0.0) {
                vec2.copy(this.curBrightCenter, brightObj.getBrightCenter());
                this.curBright = bright;
                vec2.copy(this.curCenter, brightObj.getCenter());
                vec2.copy(this.curNowCenter, brightObj.getNowCenter());
                return true;
            }
        }

        return false;
    }

    public override movement(sceneObjHolder: SceneObjHolder): void {
        const areaFlags = this.checkArea(sceneObjHolder);
        const hasBrightObj = this.checkBrightObj(!!areaFlags);

        this.controlFlare(sceneObjHolder, areaFlags, hasBrightObj);
    }

    private controlFlare(sceneObjHolder: SceneObjHolder, areaFlags: number, hasBrightObj: boolean): void {
        this.ring.update(sceneObjHolder, !!((areaFlags >>> 1) & 1), hasBrightObj);
        this.glow.update(sceneObjHolder, !!((areaFlags >>> 2) & 1), hasBrightObj);
        this.line.update(sceneObjHolder, !!((areaFlags >>> 3) & 1), hasBrightObj);

        if (hasBrightObj && areaFlags !== 0) {
            vec2.sub(scratchVec2, this.curBrightCenter, this.curCenter);
            vec2.add(scratchVec2, this.curNowCenter, scratchVec2);

            vec3.set(scratchVec3a, scratchVec2[0], scratchVec2[1], 0.0);
            vec3.copy(this.ring.translation, scratchVec3a);
            vec3.copy(this.glow.translation, scratchVec3a);
            vec3.copy(this.line.translation, scratchVec3a);

            // scratchVec2 is in backbuffer space.
            const centerX = sceneObjHolder.viewerInput.backbufferWidth / 2
            const centerY = sceneObjHolder.viewerInput.backbufferHeight / 2;
            const maxLength = Math.hypot(centerX, centerY);
            scratchVec2[0] = centerX - scratchVec2[0];
            scratchVec2[1] = -(centerY - scratchVec2[1]);
            const distLength = vec2.length(scratchVec2) / maxLength;

            vec2.normalize(scratchVec2, scratchVec2);
            this.ring.rotation[2] = calcRotateY(scratchVec2[0], scratchVec2[1]);

            const distFromCenter = Math.min(distLength, 1.0);
            this.ring.distFromCenter = distFromCenter;

            const brightness = saturate(this.curBright * (1.0 - distFromCenter));
            this.ring.brightness = brightness;
            this.glow.brightness = brightness;
            this.line.brightness = brightness;
        }
    }

    public static override requestArchives(sceneObjHolder: SceneObjHolder): void {
        LensFlareRing.requestArchives(sceneObjHolder);
        LensFlareGlow.requestArchives(sceneObjHolder);
        LensFlareLine.requestArchives(sceneObjHolder);
    }
}

export function createLensFlareArea(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
    return new LensFlareArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.BaseOriginCube);
}

export function requestArchivesLensFlareArea(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    LensFlareDirector.requestArchives(sceneObjHolder);
}

export function addBrightObj(sceneObjHolder: SceneObjHolder, brightObj: BrightObjBase): void {
    if (sceneObjHolder.lensFlareDirector === null)
        return;
    sceneObjHolder.lensFlareDirector.addBrightObj(brightObj);
}
