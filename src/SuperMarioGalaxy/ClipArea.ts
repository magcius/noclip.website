
import { mat4, ReadonlyMat4, ReadonlyVec3, vec3 } from "gl-matrix";
import * as GX from "../gx/gx_enum";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { ColorKind, GXMaterialHelperGfx, MaterialParams, DrawParams } from "../gx/gx_render";

import { J3DModelData } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription, GfxrRenderTargetID } from "../gfx/render/GfxRenderGraph";
import { GfxRenderInst, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { fallback, mod, nArray } from "../util";
import { ViewerRenderInput } from "../viewer";
import { calcRailPointPos, connectToScene, drawSimpleModel, getCamZdir, getEaseInOutValue, getEaseOutValue, getRailPointArg0, getRailPointNum, initDefaultPos, isOnSwitchAppear, isOnSwitchB, isRailReachedGoal, isValidSwitchAppear, isValidSwitchB, listenStageSwitchOnOffAppear, listenStageSwitchOnOffAppearCtrl, moveCoordAndTransToRailStartPoint, moveTransToCurrentRailPos, useStageSwitchReadAppear, useStageSwitchWriteB } from "./ActorUtil";
import { getJMapInfoArg0, getJMapInfoBool, JMapInfoIter } from "./JMapInfo";
import { dynamicSpawnZoneAndLayer, LiveActor, LiveActorGroup, makeMtxTRFromActor, ZoneAndLayer } from "./LiveActor";
import { getObjectName, SceneObj, SceneObjHolder } from "./Main";
import { CalcAnimType, DrawBufferType, DrawType, MovementType, NameObj } from "./NameObj";
import { colorFromRGBA8, colorNewFromRGBA8 } from "../Color";
import { Camera } from "../Camera";
import { isFirstStep, isGreaterStep, isLessStep } from "./Spine";
import { invlerp, saturate, setMatrixTranslation, Vec3Zero } from "../MathHelpers";
import { DeviceProgram } from "../Program";
import { GfxShaderLibrary, glslGenerateFloat } from "../gfx/helpers/GfxShaderLibrary";
import { generateBlurFunction } from "./ImageEffect";
import { GfxProgram } from "../gfx/platform/GfxPlatformImpl";
import { GfxFormat } from "../gfx/platform/GfxPlatformFormat";
import { GfxBindingLayoutDescriptor, GfxBlendFactor, GfxBlendMode, GfxCompareMode, GfxDevice, GfxMegaStateDescriptor, GfxMipFilterMode, GfxTexFilterMode, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { fullscreenMegaState, makeMegaState, setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { TextureMapping } from "../TextureHolder";
import { fillColor, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { reverseDepthForDepthOffset } from "../gfx/helpers/ReversedDepthHelpers";
import { isConnectedWithRail } from "./RailRider";
import { MapPartsRailMover, MapPartsRotator } from "./MapParts";
import { addHitSensorMapObj } from "./HitSensor";
import { emitEffectHitPos } from "./EffectSystem";
import { createStageSwitchCtrl, isExistStageSwitchAppear, StageSwitchCtrl } from "./Switch";
import { drawWorldSpaceLine, drawWorldSpacePoint, drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk";
import { TDDraw } from "./DDraw";

const materialParams = new MaterialParams();
const drawParams = new DrawParams();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();

abstract class ClipAreaShape {
    public modelData: J3DModelData | null = null;

    constructor(sceneObjHolder: SceneObjHolder, filename: string) {
        const resourceHolder = sceneObjHolder.modelCache.getResourceHolder(filename);
        this.modelData = resourceHolder.getModel(filename);
    }

    public calcVolumeMatrix(dst: mat4, mtx: ReadonlyMat4, scale: ReadonlyVec3): void {
        mat4.scale(dst, mtx, scale);
    }

    public drawVolumeShape(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, mtx: ReadonlyMat4, scale: ReadonlyVec3, camera: Camera): void {
        const template = renderInstManager.pushTemplateRenderInst();
        this.calcVolumeMatrix(drawParams.u_PosMtx[0], mtx, scale);
        mat4.mul(drawParams.u_PosMtx[0], camera.viewMatrix, drawParams.u_PosMtx[0]);
        sceneObjHolder.clipAreaHolder!.materialFront.allocateDrawParamsDataOnInst(template, drawParams);
        drawSimpleModel(renderInstManager, this.modelData!);
        renderInstManager.popTemplateRenderInst();
    }
}

class ClipAreaShapeBox extends ClipAreaShape {
    public size: number = 500.0;

    constructor(sceneObjHolder: SceneObjHolder, public isBottom: boolean) {
        super(sceneObjHolder, 'ClipVolumeBox');
    }

    public override calcVolumeMatrix(dst: mat4, mtx: ReadonlyMat4, scale: ReadonlyVec3): void {
        if (this.isBottom) {
            vec3.set(scratchVec3a, 0.0, this.size * scale[1], 0.0);
            mat4.translate(dst, mtx, scratchVec3a);
        } else {
            mat4.copy(dst, mtx);
        }

        mat4.scale(dst, dst, scale);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('ClipVolumeBox');
    }
}

class ClipAreaShapeSphere extends ClipAreaShape {
    public size: number = 500.0;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'ClipVolumeSphere');
    }

    public override calcVolumeMatrix(dst: mat4, mtx: ReadonlyMat4, scale: ReadonlyVec3): void {
        vec3.scale(scratchVec3a, scale, this.size * 0.01);
        mat4.scale(dst, mtx, scratchVec3a);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('ClipVolumeSphere');
    }
}

abstract class ClipArea<TNerve extends number = number> extends LiveActor<TNerve> {
    public baseMtx: mat4 = mat4.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, objectName: string, infoIter: JMapInfoIter | null, private shape: ClipAreaShape) {
        super(zoneAndLayer, sceneObjHolder, objectName);

        initDefaultPos(sceneObjHolder, this, infoIter);
        makeMtxTRFromActor(this.baseMtx, this);

        sceneObjHolder.create(SceneObj.ClipAreaHolder);
        sceneObjHolder.clipAreaHolder!.registerActor(this);
    }

    public override getBaseMtx(): mat4 {
        return this.baseMtx;
    }

    public override draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        const clipAreaHolder = sceneObjHolder.clipAreaHolder!;
        const cache = renderInstManager.gfxRenderCache;

        const template = renderInstManager.pushTemplateRenderInst();

        colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0x00000004);
        clipAreaHolder.materialFront.allocateMaterialParamsDataOnInst(template, materialParams);

        clipAreaHolder.materialFront.setOnRenderInst(cache.device, cache, template);
        this.shape.drawVolumeShape(sceneObjHolder, renderInstManager, this.baseMtx, this.scale, viewerInput.camera);

        clipAreaHolder.materialBack.setOnRenderInst(cache.device, cache, template);
        this.shape.drawVolumeShape(sceneObjHolder, renderInstManager, this.baseMtx, this.scale, viewerInput.camera);

        renderInstManager.popTemplateRenderInst();
    }
}

class ClipAreaMovable extends ClipArea {
    private railMover: MapPartsRailMover | null = null;
    private rotator: MapPartsRotator | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, shape: ClipAreaShape) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter), infoIter, shape);
        connectToScene(sceneObjHolder, this, MovementType.ClippedMapParts, CalcAnimType.None, DrawBufferType.None, DrawType.ClipArea);
        this.initMoveFunction(sceneObjHolder, infoIter);
        this.initHitSensor();
        addHitSensorMapObj(sceneObjHolder, this, 'body', 0, 0.0, Vec3Zero);
        useStageSwitchWriteB(sceneObjHolder, this, infoIter);
        // addBaseMatrixFollowTarget
        this.makeActorAppeared(sceneObjHolder);
    }

    private initMoveFunction(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        if (isConnectedWithRail(infoIter)) {
            this.initRailRider(sceneObjHolder, infoIter);
            this.railMover = new MapPartsRailMover(sceneObjHolder, this, infoIter);
        }

        this.rotator = new MapPartsRotator(sceneObjHolder, this, infoIter);
    }

    private startMoveFunction(sceneObjHolder: SceneObjHolder): void {
        if (this.rotator !== null)
            this.rotator.start();
        if (this.railMover !== null)
            this.railMover.start();
    }

    private endMoveFunction(sceneObjHolder: SceneObjHolder): void {
        if (this.rotator !== null)
            this.rotator.end();
        if (this.railMover !== null)
            this.railMover.end();
    }

    private movementMoveFunction(sceneObjHolder: SceneObjHolder): void {
        if (this.rotator !== null)
            this.rotator.movement(sceneObjHolder);
        if (this.railMover !== null)
            this.railMover.movement(sceneObjHolder);
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        super.control(sceneObjHolder);

        if (!isValidSwitchB(this) || isOnSwitchB(sceneObjHolder, this))
            this.movementMoveFunction(sceneObjHolder);

        this.updateMatrix();
    }

    private updateMatrix(): void {
        if (this.railMover !== null)
            vec3.copy(this.translation, this.railMover.translation);
        if (this.rotator !== null)
            mat4.copy(this.baseMtx, this.rotator.mtx);
        setMatrixTranslation(this.baseMtx, this.translation);
    }

    public override makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        this.startMoveFunction(sceneObjHolder);
    }

    public override makeActorDead(sceneObjHolder: SceneObjHolder): void {
        super.makeActorDead(sceneObjHolder);
        this.endMoveFunction(sceneObjHolder);
    }
}

export function createClipAreaCenterBox(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): ClipArea {
    const shape = new ClipAreaShapeBox(sceneObjHolder, false);
    return new ClipAreaMovable(zoneAndLayer, sceneObjHolder, infoIter, shape);
}

export function createClipAreaBottomBox(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): ClipArea {
    const shape = new ClipAreaShapeBox(sceneObjHolder, true);
    return new ClipAreaMovable(zoneAndLayer, sceneObjHolder, infoIter, shape);
}

export function requestArchivesClipAreaBox(sceneObjHolder: SceneObjHolder): void {
    ClipAreaShapeBox.requestArchives(sceneObjHolder);
}

export function createClipAreaSphere(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): ClipArea {
    const shape = new ClipAreaShapeSphere(sceneObjHolder);
    return new ClipAreaMovable(zoneAndLayer, sceneObjHolder, infoIter, shape);
}

export function requestArchivesClipAreaSphere(sceneObjHolder: SceneObjHolder): void {
    ClipAreaShapeSphere.requestArchives(sceneObjHolder);
}

function calcNerveEaseInOutValue(actor: LiveActor, minStep: number, maxStep: number, minValue: number, maxValue: number): number {
    const t = saturate(invlerp(minStep, maxStep, actor.getNerveStep()));
    return getEaseInOutValue(t, minValue, maxValue);
}

function calcNerveEaseOutValue(actor: LiveActor, maxStep: number, minValue: number, maxValue: number): number {
    const t = saturate(invlerp(0.0, maxStep, actor.getNerveStep()));
    return getEaseOutValue(t, minValue, maxValue);
}

const enum ClipAreaDropNrv { Wait }
class ClipAreaDrop extends ClipArea<ClipAreaDropNrv> {
    private baseSize: number;
    private sphere: ClipAreaShapeSphere;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder) {
        const shape = new ClipAreaShapeSphere(sceneObjHolder);
        super(zoneAndLayer, sceneObjHolder, 'ClipAreaDrop', null, shape);
        connectToScene(sceneObjHolder, this, MovementType.ClippedMapParts, CalcAnimType.None, DrawBufferType.None, DrawType.ClipArea);

        this.sphere = shape;

        this.baseSize = 500.0;
        this.initNerve(ClipAreaDropNrv.Wait);
        this.makeActorDead(sceneObjHolder);
    }

    public setBaseSize(v: number): void {
        this.baseSize = v;
    }

    public override makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        this.sphere.size = 0.0;
        this.setNerve(ClipAreaDropNrv.Wait);
    }

    protected override control(sceneObjHolder: SceneObjHolder): void {
        super.control(sceneObjHolder);
        mat4.fromTranslation(this.baseMtx, this.translation);
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: ClipAreaDropNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === ClipAreaDropNrv.Wait) {
            if (isLessStep(this, 15))
                this.sphere.size = calcNerveEaseOutValue(this, 15, 0.0, this.baseSize);
            else
                this.sphere.size = calcNerveEaseInOutValue(this, 60, 240, this.baseSize, 0.0);

            // drawWorldSpacePoint(getDebugOverlayCanvas2D(), sceneObjHolder.viewerInput.camera.clipFromWorldMatrix, this.translation, Cyan, this.sphere.size);

            if (isGreaterStep(this, 240))
                this.makeActorDead(sceneObjHolder);
        }
    }
}

export class ClipAreaDropHolder extends LiveActorGroup<ClipAreaDrop> {
    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'ClipAreaDropHolder', 0x20);

        for (let i = 0; i < 0x20; i++) {
            const area = new ClipAreaDrop(dynamicSpawnZoneAndLayer, sceneObjHolder);
            this.registerActor(area);
        }
    }
}

function appearClipAreaDrop(sceneObjHolder: SceneObjHolder, pos: ReadonlyVec3, baseSize: number): void {
    const drop = sceneObjHolder.clipAreaDropHolder!.getDeadActor();
    if (drop === null)
        return;

    vec3.copy(drop.translation, pos);
    drop.setBaseSize(baseSize);
    drop.makeActorAppeared(sceneObjHolder);
}

function moveCoordAndCheckPassPointNo(actor: LiveActor, speed: number): number {
    const railRider = actor.railRider!;
    const p0 = railRider.getNextPointNo();
    railRider.setSpeed(speed);
    railRider.move();
    const p1 = railRider.getNextPointNo();

    if (p0 !== p1)
        return p0;

    return -1;
}

const enum ClipAreaDropLaserNrv { Wait, Move }
export class ClipAreaDropLaser extends LiveActor<ClipAreaDropLaserNrv> {
    private moveSpeed: number;
    private drawCount: number = 0;
    private headPointIndex: number = 0;
    private gapPoint: number = 0;

    private ddraw = new TDDraw();
    private materialLaser: GXMaterialHelperGfx;
    private points: vec3[] = nArray(64, () => vec3.create());

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'ClipAreaDropLaser');
        initDefaultPos(sceneObjHolder, this, infoIter);
        connectToScene(sceneObjHolder, this, MovementType.MapObj, CalcAnimType.None, DrawBufferType.None, DrawType.ClipAreaDropLaser);
        this.initRailRider(sceneObjHolder, infoIter);
        moveCoordAndTransToRailStartPoint(this);

        this.moveSpeed = fallback(getJMapInfoArg0(infoIter), 20.0);
        this.initEffectKeeper(sceneObjHolder, 'ClipAreaDropLaser');
        this.initNerve(ClipAreaDropLaserNrv.Move);
        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter))
            this.setNerve(ClipAreaDropLaserNrv.Wait);
        this.makeActorAppeared(sceneObjHolder);

        sceneObjHolder.create(SceneObj.ClipAreaDropHolder);

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        const mb = new GXMaterialBuilder('ClipAreaDropLaser Laser');
        mb.setCullMode(GX.CullMode.NONE);
        mb.setTevColorIn(0, GX.CC.C0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.A0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setUsePnMtxIdx(false);

        this.materialLaser = new GXMaterialHelperGfx(mb.finish());
    }

    protected override updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: ClipAreaDropLaserNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === ClipAreaDropLaserNrv.Wait) {
            if (this.drawCount > 0)
                this.drawCount--;

            if (isValidSwitchAppear(this) && isOnSwitchAppear(sceneObjHolder, this))
                this.setNerve(ClipAreaDropLaserNrv.Move);
        } else if (currentNerve === ClipAreaDropLaserNrv.Move) {
            if (isFirstStep(this)) {
                moveCoordAndTransToRailStartPoint(this);
                this.drawCount = 0;
            }

            let passPoint = moveCoordAndCheckPassPointNo(this, this.moveSpeed * deltaTimeFrames);
            moveTransToCurrentRailPos(this);
            this.incrementDrawCount(deltaTimeFrames);

            // noclip bug fix: Fix an issue with gaps in the laser drawing
            if (this.gapPoint === this.headPointIndex)
                this.gapPoint = -1;

            if (isRailReachedGoal(this)) {
                this.gapPoint = this.headPointIndex;
                passPoint = getRailPointNum(this) - 1;
                moveCoordAndTransToRailStartPoint(this);
            }

            vec3.copy(this.points[this.headPointIndex], this.translation);

            if (passPoint !== -1) {
                calcRailPointPos(scratchVec3a, this, passPoint);

                const dropSize = fallback(getRailPointArg0(this, passPoint), -1.0);
                if (dropSize > 0.0) {
                    emitEffectHitPos(sceneObjHolder, this, scratchVec3a, 'Splash');
                    appearClipAreaDrop(sceneObjHolder, scratchVec3a, dropSize);
                }
            }

            if (isValidSwitchAppear(this) && !isOnSwitchAppear(sceneObjHolder, this))
                this.setNerve(ClipAreaDropLaserNrv.Wait);

            // drawWorldSpacePoint(getDebugOverlayCanvas2D(), sceneObjHolder.viewerInput.camera.clipFromWorldMatrix, this.translation);
        }
    }

    private incrementDrawCount(deltaTimeFrames: number): void {
        if (deltaTimeFrames === 0)
            return;

        this.headPointIndex = (this.headPointIndex + 1) % this.points.length;
        this.drawCount = Math.min(this.drawCount + 1, 64);
    }

    public override draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (this.drawCount < 3)
            return;

        const ddraw = this.ddraw;
        ddraw.beginDraw();

        getCamZdir(scratchVec3b, viewerInput.camera);

        ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP, this.drawCount * 2);
        for (let i = 1; i < this.drawCount; i++) {
            const i0 = mod(this.headPointIndex - (i - 1), this.points.length);
            const i1 = mod(this.headPointIndex - (i - 0), this.points.length);

            const p0 = this.points[i0];
            const p1 = this.points[i1];

            vec3.sub(scratchVec3a, p1, p0);
            vec3.normalize(scratchVec3a, scratchVec3a);
            vec3.cross(scratchVec3c, scratchVec3b, scratchVec3a);

            const width = 20;

            if (i0 === this.gapPoint) {
                ddraw.end();
                ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
            }

            vec3.scaleAndAdd(scratchVec3a, p1, scratchVec3c, width / 2);
            ddraw.position3vec3(scratchVec3a);
            vec3.scaleAndAdd(scratchVec3a, p1, scratchVec3c, -width / 2);
            ddraw.position3vec3(scratchVec3a);
        }
        ddraw.end();

        const renderInst = ddraw.endDraw(renderInstManager);
        this.materialLaser.setOnRenderInst(renderInstManager.gfxRenderCache.device, renderInstManager.gfxRenderCache, renderInst);

        colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0x0040F080);
        this.materialLaser.allocateMaterialParamsDataOnInst(renderInst, materialParams);

        mat4.copy(drawParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        this.materialLaser.allocateDrawParamsDataOnInst(renderInst, drawParams);

        renderInstManager.submitRenderInst(renderInst);
    }

    public override destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }

    public static override requestArchives(): void {
    }
}

// NOTE(jstpierre): The original game uses framebuffer alpha to store the clip mask, but we just use a separate R8 target.
export class ClipAreaHolder extends LiveActorGroup<ClipArea> {
    public isActive: boolean = true;

    public materialFront: GXMaterialHelperGfx;
    public materialBack: GXMaterialHelperGfx;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'ClipAreaHolder', 0x40);

        const mb = new GXMaterialBuilder();
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.A0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.A0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.OR, GX.CompareType.ALWAYS, 0);
        mb.setZMode(true, GX.CompareType.GEQUAL, false);
        mb.setUsePnMtxIdx(false);

        mb.setCullMode(GX.CullMode.FRONT);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.ONE, GX.BlendFactor.ONE);
        this.materialFront = new GXMaterialHelperGfx(mb.finish('ClipArea Front'));

        mb.setCullMode(GX.CullMode.BACK);
        mb.setBlendMode(GX.BlendMode.SUBTRACT, GX.BlendFactor.ZERO, GX.BlendFactor.ZERO);
        this.materialBack = new GXMaterialHelperGfx(mb.finish('ClipArea Back'));
    }
}

class FullscreenBlitProgram extends DeviceProgram {
    public override vert = GfxShaderLibrary.fullscreenVS;
    public override frag = GfxShaderLibrary.fullscreenBlitOneTexPS;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 1 }];

const fallOutFieldDrawCommon = `
layout(std140) uniform ub_Params {
    vec4 u_EdgeColor;
    vec4 u_Misc[1];
};

#define u_Invert (u_Misc[0].x > 0.0)

float SampleMask(PD_SAMPLER_2D(t_TextureMask), in vec2 t_TexCoord) {
    bool t_RawMask = texture(PU_SAMPLER_2D(t_TextureMask), t_TexCoord).r > 0.0;
    bool t_Mask = u_Invert ? t_RawMask : !t_RawMask;
    float t_Value = t_Mask ? 1.0 : 0.0;
    return t_Value;
}
`;

class FallOutFieldDrawThresholdProgram extends DeviceProgram {
    public static Common = `
uniform sampler2D u_Texture;
${fallOutFieldDrawCommon}
`;

    public override vert = `
${FallOutFieldDrawThresholdProgram.Common}
${GfxShaderLibrary.fullscreenVS}
`;

    public override frag = `
${FallOutFieldDrawThresholdProgram.Common}
${GfxShaderLibrary.saturate}

in vec2 v_TexCoord;

void main() {
    float t_Mask = SampleMask(PP_SAMPLER_2D(u_Texture), v_TexCoord);
    gl_FragColor = vec4(t_Mask);
}
`;
}

class FallOutFieldDrawBlurProgram extends DeviceProgram {
    public static Common = `
uniform sampler2D u_Texture;
${fallOutFieldDrawCommon}
`;

    public override vert = `
${FallOutFieldDrawBlurProgram.Common}
${GfxShaderLibrary.fullscreenVS}
`;

    public override frag = `
${FallOutFieldDrawBlurProgram.Common}
${GfxShaderLibrary.saturate}
${generateBlurFunction('Blur', 5, '0.004', glslGenerateFloat(1.0))}

in vec2 v_TexCoord;

vec2 BlurAspect(PD_SAMPLER_2D(t_Texture)) {
    vec2 t_Size = vec2(textureSize(PU_SAMPLER_2D(t_Texture), 0));
    vec2 t_Aspect = vec2((t_Size.y / t_Size.x) / (3.0/4.0), 1.0);
    return t_Aspect;
}

void main() {
    vec2 t_Aspect = BlurAspect(PP_SAMPLER_2D(u_Texture));
    float t_BlurredMask = saturate(Blur(PP_SAMPLER_2D(u_Texture), v_TexCoord, t_Aspect).r);
    gl_FragColor = vec4(t_BlurredMask);
}
`;
}

class FallOutFieldDrawCompositeBlurProgram extends DeviceProgram {
    public static Common = `
uniform sampler2D u_TextureMask;
${fallOutFieldDrawCommon}
`;

    public override vert = `
${FallOutFieldDrawCompositeBlurProgram.Common}
${GfxShaderLibrary.fullscreenVS}
`;

    public override frag = `
${FallOutFieldDrawCompositeBlurProgram.Common}

in vec2 v_TexCoord;

void main() {
    float t_BlurredMask = texture(SAMPLER_2D(u_TextureMask), v_TexCoord).r;
    vec4 t_Color = u_EdgeColor;
    t_Color.a *= t_BlurredMask;
    gl_FragColor = t_Color;
}
`;
}

class FallOutFieldDrawMaskProgram extends DeviceProgram {
    public static Common = `
uniform sampler2D u_Texture;
${fallOutFieldDrawCommon}
`;

    public override vert = `
${FallOutFieldDrawMaskProgram.Common}
${GfxShaderLibrary.makeFullscreenVS(reverseDepthForDepthOffset(1.0), 1.0)}
`;

    public override frag = `
${FallOutFieldDrawMaskProgram.Common}

in vec2 v_TexCoord;

void main() {
    float t_Mask = SampleMask(PP_SAMPLER_2D(u_Texture), v_TexCoord);

    if (t_Mask <= 0.0)
        discard;

    gl_FragColor = vec4(0.0);
}
`;
}

export class FallOutFieldDraw extends NameObj {
    private invert: boolean = false;
    private stageSwitchCtrl: StageSwitchCtrl | null = null;

    private thresholdProgram: GfxProgram;
    private blurProgram: GfxProgram;
    private compositeBlurProgram: GfxProgram;
    private maskProgram: GfxProgram;
    private blitProgram: GfxProgram;

    private edgeColor = colorNewFromRGBA8(0x002EC880);

    private combineMegaState: GfxMegaStateDescriptor = makeMegaState(setAttachmentStateSimple({}, {
        blendMode: GfxBlendMode.Add,
        blendSrcFactor: GfxBlendFactor.SrcAlpha,
        blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
    }), fullscreenMegaState);

    private maskMegaState: GfxMegaStateDescriptor = makeMegaState({
        depthWrite: true,
        depthCompare: GfxCompareMode.Always,
    }, fullscreenMegaState);

    private textureMapping: TextureMapping[] = nArray(1, () => new TextureMapping());

    private target2ColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_R_NORM);
    private target4ColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_R_NORM);

    constructor(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(sceneObjHolder, 'FallOutFieldDraw');

        sceneObjHolder.create(SceneObj.ClipAreaHolder);
        this.invert = getJMapInfoBool(fallback(getJMapInfoArg0(infoIter), -1));
        if (isExistStageSwitchAppear(infoIter)) {
            this.stageSwitchCtrl = createStageSwitchCtrl(sceneObjHolder, infoIter);
            listenStageSwitchOnOffAppearCtrl(sceneObjHolder, this.stageSwitchCtrl, this.activate.bind(this), this.deactivate.bind(this));
        } else {
            this.activate(sceneObjHolder);
        }

        const cache = sceneObjHolder.modelCache.cache;
        const linearSampler = cache.createSampler({
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.NoMip,
            minLOD: 0,
            maxLOD: 100,
        });
        this.textureMapping[0].gfxSampler = linearSampler;

        this.thresholdProgram = cache.createProgram(new FallOutFieldDrawThresholdProgram());
        this.blurProgram = cache.createProgram(new FallOutFieldDrawBlurProgram());
        this.compositeBlurProgram = cache.createProgram(new FallOutFieldDrawCompositeBlurProgram());
        this.maskProgram = cache.createProgram(new FallOutFieldDrawMaskProgram());
        this.blitProgram = cache.createProgram(new FullscreenBlitProgram());
    }

    public activate(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.clipAreaHolder!.isActive = true;
    }

    public deactivate(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.clipAreaHolder!.isActive = false;
    }

    private allocateParameterBuffer(renderInst: GfxRenderInst) {
        let offs = renderInst.allocateUniformBuffer(0, 8);
        const d = renderInst.mapUniformBufferF32(0);

        offs += fillColor(d, offs, this.edgeColor);
        offs += fillVec4(d, offs, this.invert ? 1.0 : 0.0);
    }

    public pushPasses(sceneObjHolder: SceneObjHolder, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, mainColorTargetID: GfxrRenderTargetID, mainDepthTargetID: GfxrRenderTargetID, clipAreaMaskTargetID: GfxrRenderTargetID): void {
        const clipAreaMaskTargetDesc = builder.getRenderTargetDescription(clipAreaMaskTargetID);

        this.target2ColorDesc.setDimensions(clipAreaMaskTargetDesc.width >>> 1, clipAreaMaskTargetDesc.height >>> 1, 1);
        this.target4ColorDesc.setDimensions(this.target2ColorDesc.width >>> 1, this.target2ColorDesc.height >>> 1, 1);

        const downsample2TargetID = builder.createRenderTargetID(this.target2ColorDesc, 'Clip Area Downsample 1/2');
        const downsample4TargetID = builder.createRenderTargetID(this.target4ColorDesc, 'Clip Area Downsample 1/4');

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setAllowSkippingIfPipelineNotReady(false);
        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.setBindingLayouts(bindingLayouts);
        this.allocateParameterBuffer(renderInst);
        renderInst.drawPrimitives(3);

        const clipAreaMaskTextureID = builder.resolveRenderTarget(clipAreaMaskTargetID);

        builder.pushPass((pass) => {
            pass.setDebugName('Clip Area Downsample 1/2');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample2TargetID);
            pass.pushDebugThumbnail(GfxrAttachmentSlot.Color0);

            pass.attachResolveTexture(clipAreaMaskTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.thresholdProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(clipAreaMaskTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Clip Area Downsample 1/4');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample4TargetID);

            const resolveTextureID = builder.resolveRenderTarget(downsample2TargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blitProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Clip Area Downsample 1/4 Blur');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, downsample4TargetID);

            const resolveTextureID = builder.resolveRenderTarget(downsample4TargetID);
            pass.attachResolveTexture(resolveTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.blurProgram);
                renderInst.setMegaStateFlags(fullscreenMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(resolveTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });

            pass.pushDebugThumbnail(GfxrAttachmentSlot.Color0);
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Clip Area Composite Blur');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);

            const downsample4TextureID = builder.resolveRenderTarget(downsample4TargetID);
            pass.attachResolveTexture(downsample4TextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.compositeBlurProgram);
                renderInst.setMegaStateFlags(this.combineMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(downsample4TextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });

            pass.pushDebugThumbnail(GfxrAttachmentSlot.Color0);
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Clip Area Mask');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

            pass.attachResolveTexture(clipAreaMaskTextureID);

            pass.exec((passRenderer, scope) => {
                renderInst.setGfxProgram(this.maskProgram);
                renderInst.setMegaStateFlags(this.maskMegaState);
                this.textureMapping[0].gfxTexture = scope.getResolveTextureForID(clipAreaMaskTextureID);
                renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
    }
}

export function createFallOutFieldDraw(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    // Kind of bizarre -- we have an InfoIter to pass through here.
    sceneObjHolder.fallOutFieldDraw = new FallOutFieldDraw(sceneObjHolder, infoIter);
}
