
// Fun actor (not from orig. game) to visualize gravity areas.

import * as GX from '../../gx/gx_enum';
import { LiveActor, ZoneAndLayer, makeMtxTRSFromActor, MessageType } from "../LiveActor";
import { TDDraw, TSDraw } from "../DDraw";
import { GXMaterialHelperGfx, MaterialParams, PacketParams, ColorKind } from "../../gx/gx_render";
import { vec3, mat4, ReadonlyVec3, ReadonlyMat4 } from "gl-matrix";
import { colorNewCopy, colorNewFromRGBA, colorFromRGBA, colorCopy, Magenta, Green, Red, White, colorLerp, Blue, Cyan } from "../../Color";
import { dfShow } from "../../DebugFloaters";
import { SceneObjHolder, getDeltaTimeFrames } from "../Main";
import { GXMaterialBuilder } from '../../gx/GXMaterialBuilder';
import { connectToScene, connectToSceneMapObjDecoration, makeMtxUpNoSupportPos, addVelocityMoveToDirection, addHitSensor, invalidateHitSensors, validateHitSensors, getRandomInt, makeMtxFrontUp, makeMtxUpNoSupport, vecKillElement, makeAxisVerticalZX } from '../ActorUtil';
import { DrawType, MovementType } from '../NameObj';
import { ViewerRenderInput } from '../../viewer';
import { invlerp, Vec3Zero, transformVec3Mat4w0, transformVec3Mat4w1, MathConstants, saturate, computeModelMatrixS, computeModelMatrixSRT, lerp, getMatrixTranslation, normToLength, isNearZeroVec3, getMatrixAxisY, scaleMatrix, setMatrixTranslation, setMatrixAxis, Vec3UnitX, Vec3UnitY } from '../../MathHelpers';
import { GfxRenderInstManager, setSortKeyLayer, GfxRendererLayer, setSortKeyDepth, makeDepthKey } from '../../gfx/render/GfxRenderer';
import { GfxDevice } from '../../gfx/platform/GfxPlatform';
import { Camera, computeViewSpaceDepthFromWorldSpacePoint } from '../../Camera';
import { PlanetGravity, PointGravity, ParallelGravity, ParallelGravityRangeType, CubeGravity, SegmentGravity, DiskGravity, DiskTorusGravity, WireGravity, ConeGravity } from '../Gravity';
import { isFirstStep } from '../Spine';
import { GfxRenderCache } from '../../gfx/render/GfxRenderCache';
import { assertExists } from '../../util';
import { getDebugOverlayCanvas2D, drawWorldSpacePoint, drawWorldSpaceVector, drawWorldSpaceLine, drawWorldSpaceBasis, drawWorldSpaceCircle } from '../../DebugJunk';
import { AABB } from '../../Geometry';
import { initShadowVolumeSphere, setShadowDropLength, onCalcShadowDropGravity, setShadowVolumeSphereRadius } from '../Shadow';
import { getBindedFixReactionVector, isBinded, isBindedGround } from '../Collision';
import { HitSensor, HitSensorType, sendMsgEnemyAttack, sendArbitraryMsg } from '../HitSensor';

const materialParams = new MaterialParams();
const packetParams = new PacketParams();

const scratchVec3 = vec3.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec3d = vec3.create();
const scratchMatrix = mat4.create();

class GravityExplainerArrow {
    public gravity: PlanetGravity;

    // Original coordinate that gravity is generated from.
    public coord = vec3.create();
    public gravityVec = vec3.create();

    // Drawing.
    public pos = vec3.create();
    public speed = 5.0;
    public time: number = 0.0;
    public lifetime = 360.0;
    public color = colorNewCopy(White);
    public alpha: number = 1.0;
    public scale: number = 1.0;
    // plane to be cross to
    public cross: vec3 | null = null;
}

export class GravityExplainer extends LiveActor {
    public ddraw = new TDDraw();
    public materialHelper: GXMaterialHelperGfx;
    private arrows: GravityExplainerArrow[] = [];

    @dfShow()
    private stemWidth: number = 100.0;
    @dfShow()
    private stemHeight = 800.0;
    @dfShow()
    private tipWidth = 400.0;
    @dfShow()
    private tipHeight = 400.0;

    private two: GravityExplainer2;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder) {
        super(zoneAndLayer, sceneObjHolder, 'GravityExplainer');

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);

        const mb = new GXMaterialBuilder('GravityExplainerArrow');
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX0);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.RASC);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.RASA);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevKAlphaSel(0, GX.KonstAlphaSel.KASEL_1);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());

        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, DrawType.GravityExplainer);

        this.two = new GravityExplainer2(zoneAndLayer, sceneObjHolder);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        this.mangleGravitiesForVideoHacks(sceneObjHolder);
        // this.spawnArrows(sceneObjHolder);
    }

    private mangleGravitiesForVideoHacks(sceneObjHolder: SceneObjHolder): void {
        const stageName = sceneObjHolder.scenarioData.getMasterZoneFilename();
        const mgr = sceneObjHolder.planetGravityManager!;

        if (stageName === 'IceVolcanoGalaxy') {
            const g0 = assertExists(mgr.gravities.find((gravity) => gravity instanceof ParallelGravity && gravity.l_id === 0 && gravity.pos[0] === 15400)) as ParallelGravity;
            computeModelMatrixSRT(g0.boxMtx!, 9000, 5000, 3000, 0, 0, 0, 18400, 1700, -96100);
            g0.updateIdentityMtx();

            const g10 = assertExists(mgr.gravities.find((gravity) => gravity instanceof ParallelGravity && gravity.l_id === 10 && gravity.pos[0] === 15100)) as ParallelGravity;
            computeModelMatrixSRT(g10.boxMtx!, 1000, 3000, 1000, 0, 0, 0, 15300, 0, -99800);
            g10.updateIdentityMtx();

            const g5 = mgr.gravities[4] as ParallelGravity;
            computeModelMatrixSRT(g5.boxMtx!, 2000, 1000, 10000, 0, 0, 0, 15000, -750, -105000);
            g5.updateIdentityMtx();
            getMatrixAxisY(g5.planeNormal, g5.boxMtx!);
        } else if (stageName === 'HeavenlyBeachGalaxy') {
            // const g0 = assertExists(mgr.gravities.find((gravity) => gravity instanceof ParallelGravity && gravity.l_id === 0)) as ParallelGravity;
            // mgr.gravities.forEach((v) => v.alive = false);
            // g0.alive = true;
        } else if (stageName === 'HoneyBeeKingdomGalaxy') {
            const g0 = assertExists(mgr.gravities.find((gravity) => gravity instanceof ParallelGravity && gravity.l_id === 0)) as ParallelGravity;
            mgr.gravities.forEach((v) => v.alive = false);
            g0.alive = true;
        } else if (stageName === 'LongForCastleGalaxy') {
            mgr.gravities.forEach((v) => v.alive = false);

            const g0 = assertExists(mgr.gravities.find((gravity) => gravity instanceof ParallelGravity && gravity.l_id === 0)) as ParallelGravity;
            g0.alive = true;

            const g3 = assertExists(mgr.gravities.find((gravity) => gravity instanceof ParallelGravity && gravity.l_id === 3)) as ParallelGravity;
            g3.alive = true;
            computeModelMatrixSRT(g3.boxMtx!, 2500, -1000, -2500, 0, 0, 0, 250, -2800, 550);
            g3.updateIdentityMtx();
        } else if (stageName === 'EggStarGalaxy') {
            mgr.gravities.forEach((v) => v.alive = false);

            const g104 = mgr.gravities[103] as ParallelGravity;
            g104.alive = true;

            /*
            const g107 = mgr.gravities[107] as ParallelGravity;
            g107.alive = true;
            computeModelMatrixSRT(g107.boxMtx!, 400, -350, 300, 0, MathConstants.TAU*(1/8), 0, -5758, -14440, -15141);
            */

            const g108 = mgr.gravities[107] as ParallelGravity;
            g108.alive = true;
            g108.rangeType = ParallelGravityRangeType.Cylinder;
            g108.setRangeCylinder(500, 500);
            g108.setPlane(Vec3UnitY, vec3.fromValues(-4634, -16845, -16330));

            mgr.gravities[101].alive = true;
            mgr.gravities[101].range *= 0.2;

            mgr.gravities[104].alive = true;
            mgr.gravities[105].alive = true;
        } else if (stageName === 'CosmosGardenGalaxy') {
            mgr.gravities.forEach((v) => v.alive = false);

            mgr.gravities[11].alive = true;
        }
    }

    private spawnArrows(sceneObjHolder: SceneObjHolder): void {
        const gravities = sceneObjHolder.planetGravityManager!.gravities;

        for (let i = 0; i < gravities.length; i++) {
            const grav = gravities[i];
            if (!grav.alive)
                continue;
            /*if (!(grav instanceof SegmentGravity))
                continue;
            if (grav.distant !== 310)
                continue;
            const count = 5;

            for (let j = 0; j < count; j++) {
                const layers = 4;
                for (let k = 0; k < layers; k++) {
                    const arrow = new GravityExplainerArrow();
                    arrow.scale = 0.5;
                    arrow.gravity = grav;

                    mat4.identity(scratchMatrix);
                    const theta = MathConstants.DEG_TO_RAD * (grav.validSideDegree * (j / (count - 1))) * 0.99 + 0.001;
                    mat4.rotate(scratchMatrix, scratchMatrix, theta, grav.segmentDirection);
                    getMatrixAxisY(scratchVec3a, scratchMatrix);

                    arrow.cross = vec3.clone(grav.segmentDirection);

                    vec3.lerp(arrow.coord, grav.gravityPoints[0], grav.gravityPoints[1], 0.5);
                    vec3.scaleAndAdd(arrow.coord, arrow.coord, scratchVec3a, 100);

                    vec3.copy(arrow.pos, arrow.coord);

                    arrow.time = arrow.lifetime * (k / layers);

                    this.arrows.push(arrow);
                }
            }

            const segment = new GravityExplainer2_SegmentGravity(this.zoneAndLayer, sceneObjHolder, grav);
            break;
            */

            const aabb = new AABB(), v = vec3.create();
            for (let j = 0; j < 1000; j++) {
                if (!grav.generateRandomPoint(v))
                    continue;
                aabb.unionPoint(v);
            }
            const count = Math.sqrt(aabb.diagonalLengthSquared()) / 500.0;
            console.log(count);

            for (let j = 0; j < count; j++) {
                const arrow = new GravityExplainerArrow();
                arrow.scale = 0.5;
                arrow.gravity = grav;

                if (!grav.generateRandomPoint(arrow.coord))
                    continue;
                vec3.copy(arrow.pos, arrow.coord);

                arrow.time = Math.random() * arrow.lifetime;
                arrow.alpha = lerp(0.4, 0.8, Math.random());

                this.arrows.push(arrow);
            }
        }
    }

    public globalFade = 1.0;
    public globalFadeStartTime = -1;

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const deltaTimeFrames = getDeltaTimeFrames(viewerInput);

        if (window.main.viewer.inputManager.isKeyDownEventTriggered('KeyY')) {
            this.globalFadeStartTime = viewerInput.time;
        }

        if (this.globalFadeStartTime >= 0.0) {
            this.globalFade = saturate((viewerInput.time - this.globalFadeStartTime) / 2000.0);
            if (this.globalFade >= 1.0)
                this.globalFadeStartTime = -1;
        }

        for (let i = 0; i < sceneObjHolder.planetGravityManager!.gravities.length; i++) {
            const grav = sceneObjHolder.planetGravityManager!.gravities[i];
            if (grav instanceof DiskTorusGravity)
                grav.drawDebug(sceneObjHolder, viewerInput);
        }

        for (let i = 0; i < this.arrows.length; i++) {
            const arrow = this.arrows[i];

            // calcGravityVector(sceneObjHolder, this, arrow.coord, arrow.gravityVec);
            arrow.gravity.calcGravity(arrow.gravityVec, arrow.coord);
            vec3.normalize(arrow.gravityVec, arrow.gravityVec);

            vec3.scaleAndAdd(arrow.pos, arrow.pos, arrow.gravityVec, arrow.speed * deltaTimeFrames);
            arrow.time += deltaTimeFrames;

            if (arrow.time >= arrow.lifetime) {
                arrow.time = 0.0;
                vec3.copy(arrow.pos, arrow.coord);
            }

            const fadeInTime = 0.3 * arrow.lifetime;
            const fadeOutTime = 0.7 * arrow.lifetime;
            if (arrow.time >= 0.0 && arrow.time <= fadeInTime)
                arrow.color.a = invlerp(0.0, fadeInTime, arrow.time);
            else if (arrow.time >= fadeOutTime && arrow.time <= arrow.lifetime)
                arrow.color.a = invlerp(arrow.lifetime, fadeOutTime, arrow.time);
            else
                arrow.color.a = 1.0;

            arrow.color.a *= this.globalFade;
            arrow.color.a *= arrow.alpha;
        }
    }

    private drawPoint(arrow: GravityExplainerArrow, ddraw: TDDraw, mtx: mat4, p: vec3): void {
        vec3.transformMat4(scratchVec3c, p, mtx);
        ddraw.position3vec3(scratchVec3c);
        ddraw.color4color(GX.Attr.CLR0, arrow.color);
    }

    private drawArrow(arrow: GravityExplainerArrow, ddraw: TDDraw, camera: Camera): void {
        if (!arrow.gravity.alive || !arrow.gravity.switchActive)
            return;

        /*
        const ctx = getDebugOverlayCanvas2D();
        drawWorldSpacePoint(ctx, camera.clipFromWorldMatrix, arrow.coord, Magenta, 10);
        drawWorldSpaceVector(ctx, camera.clipFromWorldMatrix, arrow.coord, arrow.gravityVec, 25, Green, 4);
        drawWorldSpacePoint(ctx, camera.clipFromWorldMatrix, arrow.pos, Red, 10);
        */

        const mtx = scratchMatrix;

        if (arrow.cross !== null) {
            vec3.negate(scratchVec3a, arrow.gravityVec);

            mat4.identity(mtx);
            makeMtxFrontUp(mtx, arrow.cross, scratchVec3a);
            scaleMatrix(mtx, mtx, arrow.scale);
            setMatrixTranslation(mtx, arrow.pos);
            mat4.mul(mtx, camera.viewMatrix, mtx);
        } else {
            // Build our billboard matrix.
            vec3.negate(scratchVec3a, arrow.gravityVec);

            const viewMtx = camera.viewMatrix;
            vec3.set(scratchVec3b, viewMtx[2], viewMtx[6], viewMtx[10]);

            vec3.cross(scratchVec3a, scratchVec3a, scratchVec3b);
            vec3.normalize(scratchVec3a, scratchVec3a);

            transformVec3Mat4w0(scratchVec3a, viewMtx, scratchVec3a);
            transformVec3Mat4w1(scratchVec3b, viewMtx, arrow.pos);

            const scaleX = arrow.scale;
            const scaleY = arrow.scale;

            mtx[0] = scratchVec3a[0] * scaleX;
            mtx[4] = -scratchVec3a[1] * scaleY;
            mtx[8] = 0;
            mtx[12] = scratchVec3b[0];

            mtx[1] = scratchVec3a[1] * scaleX;
            mtx[5] = scratchVec3a[0] * scaleY;
            mtx[9] = 0;
            mtx[13] = scratchVec3b[1];

            mtx[2] = 0;
            mtx[6] = 0;
            mtx[10] = 1;
            mtx[14] = scratchVec3b[2];
        }

        ddraw.begin(GX.Command.DRAW_TRIANGLES, 3);

        // Arrow's tip is at the bottom of the tip triangle...
        vec3.copy(scratchVec3, Vec3Zero);
        scratchVec3[1] -= this.tipHeight;
        this.drawPoint(arrow, ddraw, mtx, scratchVec3);

        scratchVec3[1] = 0;
        scratchVec3[0] = -this.tipWidth;
        this.drawPoint(arrow, ddraw, mtx, scratchVec3);

        scratchVec3[0] = this.tipWidth;
        this.drawPoint(arrow, ddraw, mtx, scratchVec3);

        ddraw.end();
        ddraw.begin(GX.Command.DRAW_QUADS, 4);

        scratchVec3[0] = -this.stemWidth;
        this.drawPoint(arrow, ddraw, mtx, scratchVec3);

        scratchVec3[0] = this.stemWidth;
        this.drawPoint(arrow, ddraw, mtx, scratchVec3);

        scratchVec3[1] += this.stemHeight;

        scratchVec3[0] = this.stemWidth;
        this.drawPoint(arrow, ddraw, mtx, scratchVec3);

        scratchVec3[0] = -this.stemWidth;
        this.drawPoint(arrow, ddraw, mtx, scratchVec3);

        ddraw.end();
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();

        const device = sceneObjHolder.modelCache.device;
        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);
        this.materialHelper.allocateMaterialParamsDataOnInst(template, materialParams);

        mat4.identity(packetParams.u_PosMtx[0]);
        this.materialHelper.allocatePacketParamsDataOnInst(template, packetParams);

        this.ddraw.beginDraw();
        for (let i = 0; i < this.arrows.length; i++)
            this.drawArrow(this.arrows[i], this.ddraw, viewerInput.camera);
        const renderInst = this.ddraw.endDraw(device, renderInstManager);
        renderInstManager.submitRenderInst(renderInst);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

const enum GravityExplainerParticleNrv { Spawn, Fall, Fade }

function reboundVelocityFromCollision(actor: LiveActor, bounce: number, p3: number, reboundDrag: number): boolean {
    if (!isBinded(actor))
        return false;

    const fixReaction = getBindedFixReactionVector(actor);
    if (isNearZeroVec3(fixReaction, 0.001))
        return false;

    vec3.normalize(scratchVec3, fixReaction);
    const dot = vec3.dot(scratchVec3, actor.velocity);
    if (dot >= -p3) {
        if (dot < 0.0)
            vec3.scaleAndAdd(actor.velocity, actor.velocity, scratchVec3, -dot);
        return false;
    } else {
        vec3.scaleAndAdd(actor.velocity, actor.velocity, scratchVec3, -dot);
        vec3.scale(actor.velocity, actor.velocity, reboundDrag);
        vec3.scaleAndAdd(actor.velocity, actor.velocity, scratchVec3, -dot * bounce);
        return true;
    }
}

function addVelocityToGravity(actor: LiveActor, speed: number): void {
    vec3.scaleAndAdd(actor.velocity, actor.velocity, actor.gravityVector, speed);
}

function restrictVelocity(actor: LiveActor, maxSpeed: number): void {
    if (vec3.squaredLength(actor.velocity) >= maxSpeed ** 2)
        normToLength(actor.velocity, maxSpeed);
}

function attenuateVelocity(actor: LiveActor, drag: number): void {
    vec3.scale(actor.velocity, actor.velocity, drag);
}

class GravityExplainerParticle extends LiveActor<GravityExplainerParticleNrv> {
    public originalTranslation = vec3.create();
    public lastHit: HitSensor | null = null;
    public noneHitCounter = 0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, private parentGravity: PlanetGravity, pos: vec3) {
        super(zoneAndLayer, sceneObjHolder, 'GravityExplainerParticle');

        this.initModelManagerWithAnm(sceneObjHolder, 'ElectricRailPoint');
        connectToSceneMapObjDecoration(sceneObjHolder, this);

        this.initNerve(GravityExplainerParticleNrv.Spawn);
        this.initBinder(110.0, 0, 1);
        this.binder!.moveWithCollision = true;

        initShadowVolumeSphere(sceneObjHolder, this, 110.0);
        setShadowDropLength(this, null, 50000.0);
        onCalcShadowDropGravity(this);
        this.calcGravityFlag = true;

        this.initHitSensor();
        addHitSensor(sceneObjHolder, this, 'body', HitSensorType.GravityExplainerParticle, 1, 120.0, Vec3Zero);
        invalidateHitSensors(this);

        vec3.copy(this.originalTranslation, pos);

        this.initWaitPhase = getRandomInt(0, 500);
    }

    public attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        super.attackSensor(sceneObjHolder, thisSensor, otherSensor);

        if (otherSensor.sensorType === HitSensorType.GravityExplainerParticle)
            sendMsgEnemyAttack(sceneObjHolder, otherSensor, thisSensor);
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (messageType === MessageType.EnemyAttack && otherSensor!.sensorType === HitSensorType.GravityExplainerParticle) {
            vec3.sub(scratchVec3, thisSensor!.center, otherSensor!.center);
            const dist = vec3.length(scratchVec3);
            vec3.normalize(scratchVec3, scratchVec3);
            const r = (110.0 * 2.0) - dist;
            addVelocityMoveToDirection(this, scratchVec3, r * 0.4);

            return true;
        }

        return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const parentGravityAlive = this.parentGravity.alive && this.parentGravity.switchActive;
        if (parentGravityAlive)
            this.makeActorAppeared(sceneObjHolder);
        else
            this.makeActorDead(sceneObjHolder);

        const distance = this.shadowControllerList!.shadowControllers[0].getProjectionLength();
        const distanceScale = lerp(1.0, 0.5, saturate(invlerp(0, 8000.0, distance)));
        setShadowVolumeSphereRadius(this, null, 35.0 * this.scale[0] * distanceScale);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNrv: GravityExplainerParticleNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNrv, deltaTimeFrames);

        if (currentNrv === GravityExplainerParticleNrv.Spawn) {
            // this.parentGravity.calcGravity(this.gravityVector, this.translation);

            if (isFirstStep(this)) {
                this.parentGravity.generateRandomPoint(this.originalTranslation);

                invalidateHitSensors(this);
                vec3.copy(this.translation, this.originalTranslation);
                const scale = 0;
                vec3.set(this.scale, scale, scale, scale);
                vec3.zero(this.velocity);
            }

            const maxScale = 3.0;
            const scale = Math.min(this.scale[0] + 0.2, maxScale);
            vec3.set(this.scale, scale, scale, scale);
            if (scale >= maxScale)
                this.setNerve(GravityExplainerParticleNrv.Fall);
        } else if (currentNrv === GravityExplainerParticleNrv.Fall) {
            if (isFirstStep(this)) {
                validateHitSensors(this);
                this.lastHit = null;
            }

            if (!this.parentGravity.calcGravity(scratchVec3, this.translation)) {
                this.setNerve(GravityExplainerParticleNrv.Fade);
                return;
            }

            reboundVelocityFromCollision(this, 2.0, 0.0, 1.0);

            if (isBindedGround(this))
                addVelocityToGravity(this, 0.2);
            else
                addVelocityToGravity(this, 1.0);

            restrictVelocity(this, 80.0);
            attenuateVelocity(this, Math.pow(0.996, deltaTimeFrames));

            if (isBindedGround(this)) {
                const hitSensor = this.binder!.floorHitInfo.hitSensor;
                if (hitSensor !== null && hitSensor !== this.lastHit) {
                    this.lastHit = hitSensor;
                    sendArbitraryMsg(sceneObjHolder, MessageType.NoclipGravityExplainerParticle_Hit, hitSensor, this.getSensor('body')!);
                }

                this.noneHitCounter = 0;
            } else {
                if (this.noneHitCounter++ >= 5)
                    this.lastHit = null;
            }

            // if (isGreaterEqualStep(this, 100) && isNearZeroVec3(this.velocity, 0.5))
            //     this.setNerve(GravityExplainerParticleNrv.Fade);
        } else if (currentNrv === GravityExplainerParticleNrv.Fade) {
            if (isFirstStep(this))
                invalidateHitSensors(this);

            const scale = Math.max(0.0, this.scale[0] - (0.1 * deltaTimeFrames));
            vec3.set(this.scale, scale, scale, scale);

            if (scale <= 0.0)
                this.setNerve(GravityExplainerParticleNrv.Spawn);
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('ElectricRailPoint');
    }
}

function sphereModel(ddraw: TSDraw, numY: number, numX: number = numY): void {
    function spherePoint(dst: vec3, y: number, x: number): void {
        const theta = MathConstants.TAU * (x / numX);
        const phi = MathConstants.TAU * (((1.0 - y / numY)) - 0.5) / 2;
        const cos = Math.cos(phi);
        vec3.set(dst, cos * Math.cos(theta), Math.sin(phi), cos * Math.sin(theta));
    }

    function drawPoint(y: number, x: number): void {
        spherePoint(scratchVec3, y, x);
        ddraw.position3vec3(scratchVec3);
        ddraw.normal3vec3(scratchVec3);
    }

    for (let y1 = 1; y1 < numY + 1; y1++) {
        ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        for (let x = 0; x < numX + 1; x++) {
            const y0 = y1 - 1;
            drawPoint(y0, x);
            drawPoint(y1, x);
        }
        ddraw.end();
    }
}

class SphereModel {
    public sdraw = new TSDraw();

    constructor(device: GfxDevice, renderCache: GfxRenderCache, numY: number = 50, numX: number = numY) {
        this.sdraw.setVtxDesc(GX.Attr.POS, true);
        this.sdraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);

        this.sdraw.setVtxDesc(GX.Attr.NRM, true);
        this.sdraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.NRM, GX.CompCnt.NRM_XYZ);

        this.sdraw.beginDraw();
        sphereModel(this.sdraw, numY, numX);
        this.sdraw.endDraw(device, renderCache);
    }

    public destroy(device: GfxDevice): void {
        this.sdraw.destroy(device);
    }
}

function getPulseAlpha(t: number): number {
    if (t <= 0.1)
        return invlerp(0.0, 0.1, t);
    else if (t <= 0.6)
        return 1.0;
    else
        return saturate(invlerp(0.8, 0.6, t));
}

class GravityExplainer2_PointGravity extends LiveActor {
    private materialHelper: GXMaterialHelperGfx;
    private sphereModel: SphereModel;

    @dfShow()
    private c0 = colorNewFromRGBA(0.0, 0.0, 0.0, 1.0);
    @dfShow()
    private c1 = colorNewFromRGBA(0.8, 0.8, 0.8, 0.3);
    @dfShow()
    private amb0Alpha = -20.0;
    @dfShow()
    private light2Alpha = 120.0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, protected gravity: PointGravity) {
        super(zoneAndLayer, sceneObjHolder, 'GravityExplainer2_PointGravity');

        vec3.copy(this.translation, this.gravity.pos);
        const scale = this.gravity.range;
        vec3.set(this.scale, scale, scale, scale);

        const mb = new GXMaterialBuilder('GravityExplainer');
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, true, GX.ColorSrc.REG, GX.ColorSrc.REG, 4, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.C0, GX.CC.C1, GX.CC.RASA, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.A0, GX.CA.A1, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevKAlphaSel(0, GX.KonstAlphaSel.KASEL_1);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setCullMode(GX.CullMode.BACK);
        mb.setUsePnMtxIdx(false);

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
        this.sphereModel = new SphereModel(sceneObjHolder.modelCache.device, sceneObjHolder.modelCache.cache);

        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, DrawType.GravityExplainer);

        colorFromRGBA(this.c0, 0.7, 0.8, 1.0, 0.4);
        colorFromRGBA(this.c1, 0.38, 0.33, 0.31, 0.0);
        this.amb0Alpha = 0.2;
        this.light2Alpha = 0.9;
    }

    private drawSphere(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, t: number): void {
        const renderInst = renderInstManager.newRenderInst();
        this.sphereModel.sdraw.setOnRenderInst(renderInst);

        const device = sceneObjHolder.modelCache.device;

        if (this.gravity.inverse)
            t = 1.0 - t;

        const scale = 1.0 - t;
        const alpha = getPulseAlpha(t);

        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);

        const light2 = materialParams.u_Lights[2];
        vec3.set(light2.Position, 0, 0, 0);
        vec3.set(light2.Direction, 0, -1, 0);
        vec3.set(light2.CosAtten, 1, 0, 0);
        vec3.set(light2.DistAtten, 1, 0, 0);
        colorFromRGBA(light2.Color, 0, 0, 0, this.light2Alpha);

        colorCopy(materialParams.u_Color[ColorKind.C0], this.c0);
        colorCopy(materialParams.u_Color[ColorKind.C1], this.c1);

        materialParams.u_Color[ColorKind.C0].a *= alpha;
        materialParams.u_Color[ColorKind.C1].a *= alpha;

        colorFromRGBA(materialParams.u_Color[ColorKind.AMB0], 0, 0, 0, this.amb0Alpha);
        this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);

        makeMtxTRSFromActor(scratchMatrix, this);
        mat4.mul(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix, scratchMatrix);
        computeModelMatrixS(scratchMatrix, scale);
        mat4.mul(packetParams.u_PosMtx[0], packetParams.u_PosMtx[0], scratchMatrix);
        this.materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);

        renderInstManager.submitRenderInst(renderInst);
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!this.gravity.alive || !this.gravity.switchActive)
            return;

        const template = renderInstManager.pushTemplateRenderInst();
        template.sortKey = setSortKeyLayer(template.sortKey, GfxRendererLayer.TRANSLUCENT);

        const depth = computeViewSpaceDepthFromWorldSpacePoint(viewerInput.camera, this.translation);
        template.sortKey = setSortKeyDepth(template.sortKey, depth);

        const duration = 5000.0, numRings = 4;
        for (let i = 0; i < numRings; i++) {
            const t = ((viewerInput.time + (i * duration / numRings)) / duration) % 1.0;
            this.drawSphere(sceneObjHolder, renderInstManager, viewerInput, t);
        }

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.sphereModel.destroy(device);
    }
}

class GravityExplainer2_ParallelGravity extends LiveActor {
    private materialHelper: GXMaterialHelperGfx;
    private sdraw = new TSDraw();

    @dfShow()
    private c0 = colorNewFromRGBA(0.0, 0.0, 0.0, 1.0);
    @dfShow()
    private c1 = colorNewFromRGBA(0.8, 0.8, 0.8, 0.3);

    private segmentSpacing = 350.0;
    private segmentHeight = 250.0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, protected gravity: ParallelGravity) {
        super(zoneAndLayer, sceneObjHolder, 'GravityExplainer2_PointGravity');

        this.sdraw.setVtxDesc(GX.Attr.POS, true);
        this.sdraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);

        this.sdraw.setVtxDesc(GX.Attr.CLR0, true);
        this.sdraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);

        const mb = new GXMaterialBuilder('GravityExplainer');
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.C0, GX.CC.C1, GX.CC.RASA, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.A0, GX.CA.A1, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevKAlphaSel(0, GX.KonstAlphaSel.KASEL_1);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setCullMode(GX.CullMode.NONE);
        mb.setUsePnMtxIdx(false);

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());

        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, DrawType.GravityExplainer);

        colorFromRGBA(this.c0, 1.0, 1.0, 1.0, 0.2);
        colorFromRGBA(this.c1, 1.0, 1.0, 1.0, 0.0);

        /*
        colorFromRGBA8(this.c0, 0x5A55FF00);
        colorCopy(this.c0, this.c0, 1.0);
        colorCopy(this.c1, this.c0, 0.0);
        */

        this.sdraw.beginDraw();
        if (this.gravity.rangeType === ParallelGravityRangeType.Box)
            this.drawBoxSegment(this.sdraw);
        else if (this.gravity.rangeType === ParallelGravityRangeType.Cylinder)
            this.drawCircleSegment(this.sdraw);
        else if (this.gravity.rangeType === ParallelGravityRangeType.Sphere)
            this.drawCircleSegment(this.sdraw);
        this.sdraw.endDraw(sceneObjHolder.modelCache.device, sceneObjHolder.modelCache.cache);
    }

    private drawBoxFloor(ddraw: TSDraw): void {
        function drawBoxPoint(iu: number, iv: number): void {
            ddraw.position3f32(iu, 0.0, iv);
            let alpha = 0xFF;
            if (Math.max(Math.abs(iu), Math.abs(iv)) >= 1.0)
                alpha = 0x00;
            ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, alpha);
        }

        const margin = 0.5;
        ddraw.begin(GX.Command.DRAW_QUADS);
        // top
        drawBoxPoint(-(1.0), -(1.0));
        drawBoxPoint(-(1.0 - margin), -(1.0 - margin));
        drawBoxPoint( (1.0 - margin), -(1.0 - margin));
        drawBoxPoint( (1.0), -(1.0));

        // bottom
        drawBoxPoint(-(1.0), (1.0));
        drawBoxPoint( (1.0), (1.0));
        drawBoxPoint( (1.0 - margin), (1.0 - margin));
        drawBoxPoint(-(1.0 - margin), (1.0 - margin));

        // left
        drawBoxPoint(-(1.0), -(1.0));
        drawBoxPoint(-(1.0),  (1.0));
        drawBoxPoint(-(1.0 - margin),  (1.0 - margin));
        drawBoxPoint(-(1.0 - margin), -(1.0 - margin));

        // right
        drawBoxPoint( (1.0), -(1.0));
        drawBoxPoint( (1.0 - margin), -(1.0 - margin));
        drawBoxPoint( (1.0 - margin),  (1.0 - margin));
        drawBoxPoint( (1.0),  (1.0));
        ddraw.end();
    }

    private drawSegmentSidePoint(ddraw: TSDraw, x: number, z: number): void {
        ddraw.position3f32(x, 0.0, z);
        ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, 0x00);
        ddraw.position3f32(x, 1.0, z);
        ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, 0xFF);
    }

    private drawBoxSegment(ddraw: TSDraw): void {
        ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        this.drawSegmentSidePoint(ddraw, -1.0, -1.0);
        this.drawSegmentSidePoint(ddraw,  1.0, -1.0);
        this.drawSegmentSidePoint(ddraw,  1.0,  1.0);
        this.drawSegmentSidePoint(ddraw, -1.0,  1.0);
        this.drawSegmentSidePoint(ddraw, -1.0, -1.0);
        ddraw.end();
    }

    private drawCircleSegment(ddraw: TSDraw): void {
        const numPoints = 50;
        ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        for (let i = 0; i < numPoints; i++) {
            const theta = (i / (numPoints - 1)) * MathConstants.TAU;
            const x = Math.cos(theta), z = Math.sin(theta);
            this.drawSegmentSidePoint(ddraw, x, z);
        }
        ddraw.end();
    }

    private drawSegment(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, t: number, scaleFactor: number): void {
        const renderInst = renderInstManager.newRenderInst();
        this.sdraw.setOnRenderInst(renderInst);

        const device = sceneObjHolder.modelCache.device;

        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);

        const alpha = getPulseAlpha(t) * this.globalFade;

        colorCopy(materialParams.u_Color[ColorKind.C0], this.c0);
        colorCopy(materialParams.u_Color[ColorKind.C1], this.c1);

        materialParams.u_Color[ColorKind.C0].a *= alpha;
        materialParams.u_Color[ColorKind.C1].a *= alpha;

        this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);

        if (this.gravity.rangeType === ParallelGravityRangeType.Box) {
            // Range from -1.0 to 1.0
            const animY = t * 2.0 - 1.0;

            mat4.copy(scratchMatrix, this.gravity.boxMtx!);

            vec3.set(scratchVec3, 0, -animY, 0);
            mat4.translate(scratchMatrix, scratchMatrix, scratchVec3);

            vec3.set(scratchVec3, 1.0, this.segmentHeight * scaleFactor, 1.0);
            mat4.scale(scratchMatrix, scratchMatrix, scratchVec3);

            mat4.mul(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix, scratchMatrix);
        } else if (this.gravity.rangeType === ParallelGravityRangeType.Cylinder) {
            vec3.negate(scratchVec3, this.gravity.planeNormal);
            makeMtxUpNoSupportPos(scratchMatrix, scratchVec3, this.gravity.pos);
            vec3.set(scratchVec3, this.gravity.cylinderRadius, this.gravity.cylinderHeight, this.gravity.cylinderRadius);
            mat4.scale(scratchMatrix, scratchMatrix, scratchVec3);

            // Range from -1.0 to 1.0
            const animY = t * 2.0 - 1.0;

            vec3.set(scratchVec3, 0, -animY, 0);
            mat4.translate(scratchMatrix, scratchMatrix, scratchVec3);

            vec3.set(scratchVec3, 1.0, this.segmentHeight * scaleFactor, 1.0);
            mat4.scale(scratchMatrix, scratchMatrix, scratchVec3);

            mat4.mul(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix, scratchMatrix);
        } else if (this.gravity.rangeType === ParallelGravityRangeType.Sphere) {
            makeMtxUpNoSupportPos(scratchMatrix, this.gravity.planeNormal, this.gravity.pos);
            vec3.set(scratchVec3, this.gravity.range, this.gravity.range, this.gravity.range);
            mat4.scale(scratchMatrix, scratchMatrix, scratchVec3);

            // Range from -1.0 to 1.0
            const animY = t * 2.0 - 1.0;

            vec3.set(scratchVec3, 0, -animY, 0);
            mat4.translate(scratchMatrix, scratchMatrix, scratchVec3);

            const scaleX = Math.sin(t * MathConstants.TAU / 2.0);
            vec3.set(scratchVec3, scaleX, this.segmentHeight * scaleFactor, scaleX);
            mat4.scale(scratchMatrix, scratchMatrix, scratchVec3);

            mat4.mul(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix, scratchMatrix);
        }

        this.materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);

        renderInstManager.submitRenderInst(renderInst);
    }

    public globalFade = 1.0;
    public globalFadeStartTime = -1;

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!this.gravity.alive || !this.gravity.switchActive)
            return;

        if (window.main.viewer.inputManager.isKeyDownEventTriggered('KeyY')) {
            this.globalFadeStartTime = viewerInput.time;
        }

        if (this.globalFadeStartTime >= 0.0) {
            this.globalFade = saturate((viewerInput.time - this.globalFadeStartTime) / 2000.0);
            if (this.globalFade >= 1.0)
                this.globalFadeStartTime = -1;
        }

        const template = renderInstManager.pushTemplateRenderInst();
        template.sortKey = setSortKeyLayer(template.sortKey, GfxRendererLayer.TRANSLUCENT);

        const depth = computeViewSpaceDepthFromWorldSpacePoint(viewerInput.camera, this.translation);
        template.sortKey = setSortKeyDepth(template.sortKey, depth);

        const duration = 5000.0;

        let height = 1.0;

        let numSegments = 0, scaleFactor = 1.0;

        let segmentSpacing = this.segmentSpacing;
        if (this.gravity.rangeType === ParallelGravityRangeType.Box) {
            const boxMtx = this.gravity.boxMtx!;
            height = Math.hypot(boxMtx[4], boxMtx[5], boxMtx[6]);
        } else if (this.gravity.rangeType === ParallelGravityRangeType.Cylinder) {
            height = this.gravity.cylinderHeight;
        } else if (this.gravity.rangeType === ParallelGravityRangeType.Sphere) {
            height = this.gravity.range;
        }

        scaleFactor = 1.0 / height;

        if (height < segmentSpacing) {
            segmentSpacing = height / 5.0;
            this.segmentHeight = 20;
        }

        numSegments = Math.ceil(Math.min(height / segmentSpacing, 10.0));

        for (let i = 0; i < numSegments; i++) {
            const t = ((viewerInput.time + (i * (duration / numSegments))) / duration) % 1.0;
            this.drawSegment(sceneObjHolder, renderInstManager, viewerInput, t, scaleFactor);
        }

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.sdraw.destroy(device);
    }
}

class GravityExplainer2_CubeGravity extends LiveActor {
    private materialHelper: GXMaterialHelperGfx;
    private sdraw = new TSDraw();

    @dfShow()
    private c0 = colorNewFromRGBA(0.0, 0.0, 0.0, 1.0);
    @dfShow()
    private c1 = colorNewFromRGBA(0.8, 0.8, 0.8, 0.3);

    private segmentSpacing = 200.0;
    private segmentHeight = 150.0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, protected gravity: CubeGravity) {
        super(zoneAndLayer, sceneObjHolder, 'GravityExplainer2_PointGravity');

        this.sdraw.setVtxDesc(GX.Attr.POS, true);
        this.sdraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);

        this.sdraw.setVtxDesc(GX.Attr.CLR0, true);
        this.sdraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);

        const mb = new GXMaterialBuilder('GravityExplainer');
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.C0, GX.CC.C1, GX.CC.RASA, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.A0, GX.CA.A1, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevKAlphaSel(0, GX.KonstAlphaSel.KASEL_1);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setCullMode(GX.CullMode.NONE);
        mb.setUsePnMtxIdx(false);

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());

        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, DrawType.GravityExplainer);

        colorFromRGBA(this.c0, 1.0, 1.0, 1.0, 0.2);
        colorFromRGBA(this.c1, 1.0, 1.0, 1.0, 0.0);

        this.sdraw.beginDraw();
        this.drawBoxSegment(this.sdraw);
        this.sdraw.endDraw(sceneObjHolder.modelCache.device, sceneObjHolder.modelCache.cache);
    }

    private drawSegmentSidePoint(ddraw: TSDraw, x: number, z: number): void {
        ddraw.position3f32(x, 0.0, z);
        ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, 0x00);
        const scaleXZ = 1.05;
        ddraw.position3f32(x * scaleXZ, 1.0, z * scaleXZ);
        ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, 0xFF);
    }

    private drawBoxSegment(ddraw: TSDraw): void {
        ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        this.drawSegmentSidePoint(ddraw, -1.0, -1.0);
        this.drawSegmentSidePoint(ddraw,  1.0, -1.0);
        this.drawSegmentSidePoint(ddraw,  1.0,  1.0);
        this.drawSegmentSidePoint(ddraw, -1.0,  1.0);
        this.drawSegmentSidePoint(ddraw, -1.0, -1.0);
        ddraw.end();
    }

    private drawSegment(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, t: number, scaleFactor: number): void {
        const template = renderInstManager.pushTemplateRenderInst();
        this.sdraw.setOnRenderInst(template);

        const device = sceneObjHolder.modelCache.device;

        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);

        const alpha = getPulseAlpha(t);

        colorCopy(materialParams.u_Color[ColorKind.C0], this.c0);
        colorCopy(materialParams.u_Color[ColorKind.C1], this.c1);

        materialParams.u_Color[ColorKind.C0].a *= alpha;
        materialParams.u_Color[ColorKind.C1].a *= alpha;

        this.materialHelper.allocateMaterialParamsDataOnInst(template, materialParams);

        getMatrixTranslation(scratchVec3, scratchMatrix);
        const aabb = new AABB(-1, -1, -1, 1, 1, 1);
        // drawWorldSpaceAABB(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, aabb, this.gravity.mtx);
        // mat4.scale(scratchMatrix, this.gravity.mtx, [this.gravity.range, this.gravity.range, this.gravity.range]);
        // drawWorldSpaceAABB(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, aabb, scratchMatrix);
        // drawWorldSpacePoint(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, scratchVec3);

        if (this.gravity.inverse)
            t = 1.0 - t;

        for (let i = 0; i < 4; i++) {
            mat4.copy(scratchMatrix, this.gravity.mtx!);
            // scratchMatrix[13] += this.gravity!.extents[1] *;

            if (i === 0) {
                mat4.rotateZ(scratchMatrix, scratchMatrix, 1/4 * MathConstants.TAU); // +X
            } else if (i === 1) {
                mat4.rotateZ(scratchMatrix, scratchMatrix, 3/4 * MathConstants.TAU); // -X
            } else if (i === 2) {
                mat4.rotateZ(scratchMatrix, scratchMatrix, 0/4 * MathConstants.TAU); // +Y
            } else if (i === 3) {
                mat4.rotateZ(scratchMatrix, scratchMatrix, 2/4 * MathConstants.TAU); // -Y
            }

            const animY = t * 2.0;
            vec3.set(scratchVec3, 0, -animY + 3.0, 0);
            mat4.translate(scratchMatrix, scratchMatrix, scratchVec3);

            const scaleXZ = lerp(2.0 * Math.SQRT2, 1.0, t);
            vec3.set(scratchVec3, scaleXZ, this.segmentHeight * scaleFactor, scaleXZ);
            mat4.scale(scratchMatrix, scratchMatrix, scratchVec3);

            mat4.mul(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix, scratchMatrix);

            const renderInst = renderInstManager.newRenderInst();
            this.materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplateRenderInst();
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!this.gravity.alive || !this.gravity.switchActive)
            return;

        const template = renderInstManager.pushTemplateRenderInst();
        template.sortKey = setSortKeyLayer(template.sortKey, GfxRendererLayer.TRANSLUCENT);

        const depth = computeViewSpaceDepthFromWorldSpacePoint(viewerInput.camera, this.translation);
        template.sortKey = setSortKeyDepth(template.sortKey, depth);

        const duration = 5000.0;

        let height = 1.0;

        let numSegments = 0, scaleFactor = 1.0;

        let segmentSpacing = this.segmentSpacing;
        const boxMtx = this.gravity.mtx!;
        height = Math.hypot(boxMtx[4], boxMtx[5], boxMtx[6]);

        scaleFactor = 1.0 / height;
        numSegments = Math.ceil(Math.min(height / segmentSpacing, 10.0));

        for (let i = 0; i < numSegments; i++) {
            const t = ((viewerInput.time + (i * (duration / numSegments))) / duration) % 1.0;
            this.drawSegment(sceneObjHolder, renderInstManager, viewerInput, t, scaleFactor);
        }

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.sdraw.destroy(device);
    }
}

class GravityExplainer2_DiskGravity extends LiveActor {
    private materialHelper: GXMaterialHelperGfx;
    private ddraw = new TDDraw();

    @dfShow()
    private c0 = colorNewFromRGBA(0.0, 0.0, 0.0, 1.0);
    @dfShow()
    private c1 = colorNewFromRGBA(0.8, 0.8, 0.8, 0.3);
    @dfShow()
    private amb0Alpha = -20.0;
    @dfShow()
    private light2Alpha = 120.0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, protected gravity: DiskGravity) {
        super(zoneAndLayer, sceneObjHolder, 'GravityExplainer2_DiskGravity');

        vec3.copy(this.translation, this.gravity.worldPosition);

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxDesc(GX.Attr.NRM, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.NRM, GX.CompCnt.NRM_XYZ);
        this.ddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);

        const mb = new GXMaterialBuilder('GravityExplainer');
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);
        mb.setChanCtrl(GX.ColorChannelID.COLOR1A1, true, GX.ColorSrc.REG, GX.ColorSrc.REG, 4, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR1A1);
        mb.setTevColorIn(0, GX.CC.C0, GX.CC.C1, GX.CC.RASA, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.A0, GX.CA.A1, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(1, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.CPREV);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.APREV, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setCullMode(GX.CullMode.BACK);
        mb.setUsePnMtxIdx(false);

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());

        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, DrawType.GravityExplainer);

        colorFromRGBA(this.c0, 0.7, 0.8, 1.0, 0.4);
        colorFromRGBA(this.c1, 0.38, 0.33, 0.31, 0.0);
        this.amb0Alpha = 0.2;
        this.light2Alpha = 0.9;
    }

    private drawCircle(ddraw: TDDraw, pos: ReadonlyVec3, up: ReadonlyVec3, side: ReadonlyVec3, r: number, thetanp: number, alpha: number): void {
        ddraw.begin(GX.Command.DRAW_TRIANGLE_FAN);
        ddraw.position3vec3(pos);
        ddraw.normal3vec3(up);
        for (let i = 0; i < thetanp; i++) {
            const theta = -MathConstants.TAU*(i/(thetanp-1));
            mat4.fromRotation(scratchMatrix, theta, up);
            transformVec3Mat4w0(scratchVec3, scratchMatrix, side);
            vec3.scaleAndAdd(scratchVec3, pos, scratchVec3, r);
            ddraw.position3vec3(scratchVec3);
            ddraw.normal3vec3(up);
            ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, alpha * 0xFF);
        }
        ddraw.end();
    }

    private drawDisk(t: number): void {
        if (this.gravity.inverse)
            t = 1.0 - t;

        const scale = 1.0 - t;
        const alpha = getPulseAlpha(t);

        const dist = scale * this.gravity.range;

        const phinp = 20;
        const thetanp = 100;

        // circle top
        vec3.scaleAndAdd(scratchVec3a, this.gravity.worldPosition, this.gravity.worldDirection, dist);
        this.drawCircle(this.ddraw, scratchVec3a, this.gravity.worldDirection, this.gravity.worldSideDirection, this.gravity.worldRadius, thetanp, alpha);

        // circle bottom
        vec3.scaleAndAdd(scratchVec3a, this.gravity.worldPosition, this.gravity.worldDirection, -dist);
        vec3.negate(scratchVec3b, this.gravity.worldDirection);
        this.drawCircle(this.ddraw, scratchVec3a, scratchVec3b, this.gravity.worldSideDirection, this.gravity.worldRadius, thetanp, alpha);

        // connectors
        const dp = (theta: number, phi: number): void => {
            // compute outer point on centered Z-circle
            mat4.fromRotation(scratchMatrix, theta, this.gravity.worldDirection);
            // compute out vector
            transformVec3Mat4w0(scratchVec3a, scratchMatrix, this.gravity.worldSideDirection);

            vec3.scaleAndAdd(scratchVec3, this.gravity.worldPosition, scratchVec3a, this.gravity.worldRadius);

            // now rotate around Y-circle (tube)
            // compute local Y axis
            vec3.cross(scratchVec3b, this.gravity.worldDirection, scratchVec3a);
            mat4.fromRotation(scratchMatrix, phi, scratchVec3b);
            transformVec3Mat4w0(scratchVec3a, scratchMatrix, this.gravity.worldDirection);
            vec3.scaleAndAdd(scratchVec3, scratchVec3, scratchVec3a, dist);

            this.ddraw.position3vec3(scratchVec3);
            this.ddraw.normal3vec3(scratchVec3a);
            this.ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, alpha * 0xFF);
        };

        for (let i = 0; i < thetanp; i++) {
            const theta0 = MathConstants.TAU*((i+0)/(thetanp));
            const theta1 = MathConstants.TAU*((i+1)/(thetanp));

            this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
            for (let j = 0; j < phinp; j++) {
                const phi = MathConstants.TAU*0.5*(j/(phinp-1));
                dp(theta0, phi);
                dp(theta1, phi);
            }
            this.ddraw.end();
        }
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!this.gravity.alive || !this.gravity.switchActive)
            return;

        const duration = 5000.0, numRings = 4;
        this.ddraw.beginDraw();
        for (let i = 0; i < numRings; i++) {
            const t = ((viewerInput.time + (i * duration / numRings)) / duration) % 1.0;
            this.drawDisk(t);
        }
        const renderInst = this.ddraw.endDraw(sceneObjHolder.modelCache.device, renderInstManager);

        renderInst.sortKey = setSortKeyLayer(renderInst.sortKey, GfxRendererLayer.TRANSLUCENT);
        const depth = computeViewSpaceDepthFromWorldSpacePoint(viewerInput.camera, this.translation);
        renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);

        this.materialHelper.setOnRenderInst(sceneObjHolder.modelCache.device, renderInstManager.gfxRenderCache, renderInst);

        const light2 = materialParams.u_Lights[2];
        vec3.set(light2.Position, 0, 0, 0);
        vec3.set(light2.Direction, 0, -1, 0);
        vec3.set(light2.CosAtten, 1, 0, 0);
        vec3.set(light2.DistAtten, 1, 0, 0);
        colorFromRGBA(light2.Color, 0, 0, 0, this.light2Alpha);

        colorCopy(materialParams.u_Color[ColorKind.C0], this.c0);
        colorCopy(materialParams.u_Color[ColorKind.C1], this.c1);

        colorFromRGBA(materialParams.u_Color[ColorKind.AMB1], 0, 0, 0, this.amb0Alpha);
        this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);

        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        this.materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

/*
function cylinderModel(ddraw: TSDraw, validAngle: number, numR: number): void {
    ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
    for (let r = 0; r < numR + 1; r++) {
        const theta = validAngle * (r / numR);
        const x = Math.cos(theta), z = Math.sin(theta);
        ddraw.position3f32(x, 1, z);
        ddraw.position3f32(x, 0, z);
    }
    ddraw.end();

    // draw round cap 0
    ddraw.begin(GX.Command.DRAW_TRIANGLE_FAN);
    ddraw.position3f32(0, 0, 0);
    for (let r = numR + 1; r >= 0; r--) {
        const theta = validAngle * (r / numR);
        const x = Math.cos(theta), z = Math.sin(theta);
        ddraw.position3f32(x, 0, z);
    }
    ddraw.end();

    // draw round cap 1
    ddraw.begin(GX.Command.DRAW_TRIANGLE_FAN);
    ddraw.position3f32(0, 1, 0);
    for (let r = 0; r < numR + 1; r++) {
        const theta = validAngle * (r / numR);
        const x = Math.cos(theta), z = Math.sin(theta);
        ddraw.position3f32(x, 1, z);
    }
    ddraw.end();

    if (validAngle >= 0.0 && validAngle < MathConstants.TAU) {
        // draw square cap 0
        ddraw.begin(GX.Command.DRAW_QUADS);
        ddraw.position3f32(1, 0, 0);
        ddraw.position3f32(1, 1, 0);
        ddraw.position3f32(0, 1, 0);
        ddraw.position3f32(0, 0, 0);

        // draw square cap 1
        ddraw.position3f32(0, 0, 0);
        ddraw.position3f32(0, 1, 0);
        const x = Math.cos(validAngle), z = Math.sin(validAngle);
        ddraw.position3f32(x, 1, z);
        ddraw.position3f32(x, 0, z);
        ddraw.end();
    }
}

class CylinderModel {
    public sdraw = new TSDraw();

    constructor(device: GfxDevice, renderCache: GfxRenderCache, validAngle: number = MathConstants.TAU, numR = 50) {
        this.sdraw.setVtxDesc(GX.Attr.POS, true);
        this.sdraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);

        this.sdraw.beginDraw();
        cylinderModel(this.sdraw, validAngle, numR);
        this.sdraw.endDraw(device, renderCache);
    }

    public destroy(device: GfxDevice): void {
        this.sdraw.destroy(device);
    }
}
*/

class GravityExplainer2_SegmentGravity extends LiveActor {
    private materialHelper: GXMaterialHelperGfx;
    private ddraw = new TDDraw();

    @dfShow()
    private c0 = colorNewFromRGBA(0.0, 0.0, 0.0, 1.0);
    @dfShow()
    private c1 = colorNewFromRGBA(0.8, 0.8, 0.8, 0.3);

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, protected gravity: SegmentGravity) {
        super(zoneAndLayer, sceneObjHolder, 'GravityExplainer2_SegmentGravity');

        const mb = new GXMaterialBuilder('GravityExplainer');
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.C0, GX.CC.C1, GX.CC.RASA, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.A0, GX.CA.A1, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevKAlphaSel(0, GX.KonstAlphaSel.KASEL_1);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setCullMode(GX.CullMode.BACK);
        mb.setUsePnMtxIdx(false);

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);

        colorFromRGBA(this.c0, 1.0, 1.0, 1.0, 0.2);
        colorFromRGBA(this.c1, 1.0, 1.0, 1.0, 0.0);

        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, DrawType.GravityExplainer);
    }

    private drawWedge(t: number): void {
        if (this.gravity.inverse)
            t = 1.0 - t;

        const scale = 1.0 - t;

        const ddraw = this.ddraw;

        const dist = this.gravity.range;
        const t0 = Math.max((scale - 0.2), 0);
        const t1 = scale;

        const validAngle = this.gravity.validSideDegree * MathConstants.DEG_TO_RAD;

        const dr = (p: ReadonlyVec3, np: number, b: boolean): void => {
            ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
            for (let i = 0; i < np; i++) {
                const theta = lerp(-validAngle / 2, validAngle / 2, (i/(np-1)));
    
                mat4.fromRotation(scratchMatrix, theta, this.gravity.segmentDirection);
                transformVec3Mat4w0(scratchVec3, scratchMatrix, this.gravity.sideVectorOrtho);

                vec3.scaleAndAdd(scratchVec3a, p, scratchVec3, t0 * dist);
                vec3.scaleAndAdd(scratchVec3b, p, scratchVec3, t1 * dist);

                if (b) {
                    ddraw.position3vec3(scratchVec3b);
                    ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, 0xFF);

                    ddraw.position3vec3(scratchVec3a);
                    ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, lerp(0xFF, 0x00, getPulseAlpha(t0)));
                } else {
                    ddraw.position3vec3(scratchVec3a);
                    ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, lerp(0xFF, 0x00, getPulseAlpha(t0)));

                    ddraw.position3vec3(scratchVec3b);
                    ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, 0xFF);
                }
            }
            ddraw.end();
        };

        const ds = (theta: number, b: boolean): void => {
            mat4.fromRotation(scratchMatrix, theta, this.gravity.segmentDirection);
            transformVec3Mat4w0(scratchVec3, scratchMatrix, this.gravity.sideVectorOrtho);

            ddraw.begin(GX.Command.DRAW_QUADS);

            const i0 = b ? 1 : 0;
            const i1 = b ? 0 : 1;

            vec3.scaleAndAdd(scratchVec3a, this.gravity.gravityPoints[i0], scratchVec3, t0 * dist);
            vec3.scaleAndAdd(scratchVec3b, this.gravity.gravityPoints[i0], scratchVec3, t1 * dist);
            ddraw.position3vec3(scratchVec3a);
            ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, lerp(0xFF, 0x00, getPulseAlpha(t0)));

            ddraw.position3vec3(scratchVec3b);
            ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, 0xFF);

            vec3.scaleAndAdd(scratchVec3a, this.gravity.gravityPoints[i1], scratchVec3, t0 * dist);
            vec3.scaleAndAdd(scratchVec3b, this.gravity.gravityPoints[i1], scratchVec3, t1 * dist);
            ddraw.position3vec3(scratchVec3b);
            ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, 0xFF);

            ddraw.position3vec3(scratchVec3a);
            ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, lerp(0xFF, 0x00, getPulseAlpha(t0)));

            ddraw.end();
        };

        const df = (np: number): void => {
            ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
            for (let i = 0; i < np; i++) {
                const theta = lerp(-validAngle / 2, validAngle / 2, (i/(np-1)));

                mat4.fromRotation(scratchMatrix, theta, this.gravity.segmentDirection);
                transformVec3Mat4w0(scratchVec3, scratchMatrix, this.gravity.sideVectorOrtho);

                vec3.scaleAndAdd(scratchVec3a, this.gravity.gravityPoints[0], scratchVec3, t0 * dist);
                vec3.scaleAndAdd(scratchVec3b, this.gravity.gravityPoints[1], scratchVec3, t0 * dist);
                ddraw.position3vec3(scratchVec3a);
                ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, lerp(0xFF, 0x00, getPulseAlpha(t0)));
                ddraw.position3vec3(scratchVec3b);
                ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, lerp(0xFF, 0x00, getPulseAlpha(t0)));
            }
            ddraw.end();
        };

        const np = 15;
        dr(this.gravity.gravityPoints[0], np, false);
        dr(this.gravity.gravityPoints[1], np, true);

        if (validAngle >= 0.0 && validAngle < MathConstants.TAU) {
            ds(validAngle / 2, false);
            ds(-validAngle / 2, true);
        } else {
            df(np);
        }

        // drawWorldSpaceLine(getDebugOverlayCanvas2D(), window.main.viewer.camera.clipFromWorldMatrix, this.gravity.gravityPoints[0], this.gravity.gravityPoints[1]);
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!this.gravity.alive || !this.gravity.switchActive)
            return;

        const duration = 5000.0, numRings = 4;
        this.ddraw.beginDraw();
        for (let i = 0; i < numRings; i++) {
            const t = ((viewerInput.time + (i * duration / numRings)) / duration) % 1.0;
            this.drawWedge(t);
        }
        const renderInst = this.ddraw.endDraw(sceneObjHolder.modelCache.device, renderInstManager);
        this.materialHelper.setOnRenderInst(sceneObjHolder.modelCache.device, renderInstManager.gfxRenderCache, renderInst);

        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        this.materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);

        colorCopy(materialParams.u_Color[ColorKind.C0], this.c0);
        colorCopy(materialParams.u_Color[ColorKind.C1], this.c1);
        this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

class GravityExplainer2_WireGravity extends LiveActor {
    private materialHelper: GXMaterialHelperGfx;
    private ddraw = new TDDraw();

    @dfShow()
    private c0 = colorNewFromRGBA(0.0, 0.0, 0.0, 1.0);
    @dfShow()
    private c1 = colorNewFromRGBA(0.8, 0.8, 0.8, 0.3);
    @dfShow()
    private amb0Alpha = -20.0;
    @dfShow()
    private light2Alpha = 120.0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, protected gravity: WireGravity) {
        super(zoneAndLayer, sceneObjHolder, 'GravityExplainer2_WireGravity');

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxDesc(GX.Attr.NRM, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.NRM, GX.CompCnt.NRM_XYZ);
        this.ddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);

        const mb = new GXMaterialBuilder('GravityExplainer');
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);
        mb.setChanCtrl(GX.ColorChannelID.COLOR1A1, true, GX.ColorSrc.REG, GX.ColorSrc.REG, 4, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR1A1);
        mb.setTevColorIn(0, GX.CC.C0, GX.CC.C1, GX.CC.RASA, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.A0, GX.CA.A1, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(1, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.CPREV);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.APREV, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setCullMode(GX.CullMode.BACK);
        mb.setUsePnMtxIdx(false);

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());

        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, DrawType.GravityExplainer);

        colorFromRGBA(this.c0, 0.7, 0.8, 1.0, 0.4);
        colorFromRGBA(this.c1, 0.38, 0.33, 0.31, 0.0);
        this.amb0Alpha = 0.2;
        this.light2Alpha = 0.9;
    }

    private drawWireBubble(t: number): void {
        if (this.gravity.inverse)
            t = 1.0 - t;

        const scale = 1.0 - t;
        const alpha = getPulseAlpha(t);

        const dist = scale * this.gravity.range;

        const phinp = 20;

        const sidevec: vec3[] = [];

        vec3.cross(scratchVec3b, this.gravity.directions[0], Vec3UnitY);
        vec3.normalize(scratchVec3b, scratchVec3b);
        sidevec.push(vec3.clone(scratchVec3b));

        // Find optimal connectivity for each point pair.
        for (let i = 1; i < this.gravity.points.length; i++) {
            const r0 = 200;

            const p0 = this.gravity.points[i - 1];
            const s0 = sidevec[i - 1];
            // target
            vec3.scaleAndAdd(scratchVec3c, p0, s0, r0);

            const p1 = this.gravity.points[i];
            const d1 = this.gravity.directions[i];

            const s1 = vec3.create();

            let maxdist = Infinity;
            vec3.cross(scratchVec3b, d1, Vec3UnitY);
            vec3.normalize(scratchVec3b, scratchVec3b);

            vec3.copy(s1, scratchVec3b);

            // Find the least distance
            for (let j = 0; j < phinp; j++) {
                const phi = MathConstants.TAU*(j/(phinp-1));
                mat4.fromRotation(scratchMatrix, phi, d1);
                transformVec3Mat4w0(scratchVec3a, scratchMatrix, scratchVec3b);
                vec3.scaleAndAdd(scratchVec3, p1, scratchVec3a, r0);

                const dist = vec3.squaredDistance(scratchVec3, scratchVec3c);
                if (dist < maxdist) {
                    maxdist = dist;
                    vec3.copy(s1, scratchVec3a);
                }
            }

            sidevec.push(s1);
        }

        for (let i = 1; i < this.gravity.points.length; i++) {
            const p0 = this.gravity.points[i - 1];
            const d0 = this.gravity.directions[i - 1];
            const s0 = sidevec[i - 1];

            const p1 = this.gravity.points[i];
            const d1 = this.gravity.directions[i];
            const s1 = sidevec[i];

            this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
            for (let j = 0; j < phinp; j++) {
                const phi = MathConstants.TAU*(j/(phinp-1));

                mat4.fromRotation(scratchMatrix, phi, d0);
                transformVec3Mat4w0(scratchVec3a, scratchMatrix, s0);
                vec3.scaleAndAdd(scratchVec3, p0, scratchVec3a, dist);
                this.ddraw.position3vec3(scratchVec3);
                this.ddraw.normal3vec3(scratchVec3a);
                this.ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, alpha * 0xFF);

                mat4.fromRotation(scratchMatrix, phi, d1);
                transformVec3Mat4w0(scratchVec3a, scratchMatrix, s1);
                vec3.scaleAndAdd(scratchVec3, p1, scratchVec3a, dist);
                this.ddraw.position3vec3(scratchVec3);
                this.ddraw.normal3vec3(scratchVec3a);
                this.ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, alpha * 0xFF);
            }
            this.ddraw.end();

            drawWorldSpaceLine(getDebugOverlayCanvas2D(), window.main.viewer.camera.clipFromWorldMatrix, p0, p1, White);
            // drawWorldSpacePoint(getDebugOverlayCanvas2D(), window.main.viewer.camera.clipFromWorldMatrix, p1);
            // drawWorldSpaceVector(getDebugOverlayCanvas2D(), window.main.viewer.camera.clipFromWorldMatrix, p1, scratchVec3c, 200, Green);
            // drawWorldSpaceVector(getDebugOverlayCanvas2D(), window.main.viewer.camera.clipFromWorldMatrix, p1, d1, 200, Cyan);
            // drawWorldSpaceVector(getDebugOverlayCanvas2D(), window.main.viewer.camera.clipFromWorldMatrix, p1, sidevec[i], 200, Blue);
        }
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!this.gravity.alive || !this.gravity.switchActive)
            return;

        const duration = 5000.0, numRings = 4;
        this.ddraw.beginDraw();
        for (let i = 0; i < numRings; i++) {
            const t = ((viewerInput.time + (i * duration / numRings)) / duration) % 1.0;
            this.drawWireBubble(t);
        }

        const renderInst = this.ddraw.endDraw(sceneObjHolder.modelCache.device, renderInstManager);

        renderInst.sortKey = setSortKeyLayer(renderInst.sortKey, GfxRendererLayer.TRANSLUCENT);
        const depth = computeViewSpaceDepthFromWorldSpacePoint(viewerInput.camera, this.translation);
        renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);

        this.materialHelper.setOnRenderInst(sceneObjHolder.modelCache.device, renderInstManager.gfxRenderCache, renderInst);

        const light2 = materialParams.u_Lights[2];
        vec3.set(light2.Position, 0, 0, 0);
        vec3.set(light2.Direction, 0, -1, 0);
        vec3.set(light2.CosAtten, 1, 0, 0);
        vec3.set(light2.DistAtten, 1, 0, 0);
        colorFromRGBA(light2.Color, 0, 0, 0, this.light2Alpha);

        colorCopy(materialParams.u_Color[ColorKind.C0], this.c0);
        colorCopy(materialParams.u_Color[ColorKind.C1], this.c1);

        colorFromRGBA(materialParams.u_Color[ColorKind.AMB1], 0, 0, 0, this.amb0Alpha);
        this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);

        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        this.materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

class GravityExplainer2_DiskTorusGravity extends LiveActor {
    private materialHelper: GXMaterialHelperGfx;
    private ddraw = new TDDraw();

    @dfShow()
    private c0 = colorNewFromRGBA(0.0, 0.0, 0.0, 1.0);
    @dfShow()
    private c1 = colorNewFromRGBA(0.8, 0.8, 0.8, 0.3);
    @dfShow()
    private amb0Alpha = -20.0;
    @dfShow()
    private light2Alpha = 120.0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, protected gravity: DiskTorusGravity) {
        super(zoneAndLayer, sceneObjHolder, 'GravityExplainer2_DiskTorusGravity');

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxDesc(GX.Attr.NRM, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.NRM, GX.CompCnt.NRM_XYZ);
        this.ddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);

        const mb = new GXMaterialBuilder('GravityExplainer');
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);
        mb.setChanCtrl(GX.ColorChannelID.COLOR1A1, true, GX.ColorSrc.REG, GX.ColorSrc.REG, 4, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR1A1);
        mb.setTevColorIn(0, GX.CC.C0, GX.CC.C1, GX.CC.RASA, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.A0, GX.CA.A1, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(1, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.CPREV);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.APREV, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setCullMode(GX.CullMode.BACK);
        mb.setUsePnMtxIdx(false);

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());

        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, DrawType.GravityExplainer);

        colorFromRGBA(this.c0, 0.7, 0.8, 1.0, 0.4);
        colorFromRGBA(this.c1, 0.38, 0.33, 0.31, 0.0);
        this.amb0Alpha = 0.2;
        this.light2Alpha = 0.9;
    }

    private drawConcentricCircle(ddraw: TDDraw, pos: ReadonlyVec3, up: ReadonlyVec3, side: ReadonlyVec3, ro: number, ri: number, thetanp: number, alpha: number): void {
        ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        for (let i = 0; i < thetanp; i++) {
            const theta = -MathConstants.TAU*(i/(thetanp-1));

            mat4.fromRotation(scratchMatrix, theta, up);
            transformVec3Mat4w0(scratchVec3, scratchMatrix, side);
            vec3.scaleAndAdd(scratchVec3, pos, scratchVec3, ri);
            ddraw.position3vec3(scratchVec3);
            ddraw.normal3vec3(up);
            ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, alpha * 0xFF);

            transformVec3Mat4w0(scratchVec3, scratchMatrix, side);
            vec3.scaleAndAdd(scratchVec3, pos, scratchVec3, ro);
            ddraw.position3vec3(scratchVec3);
            ddraw.normal3vec3(up);
            ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, alpha * 0xFF);
        }
        ddraw.end();
    }

    private drawDiskTorus(t: number): void {
        if (this.gravity.inverse)
            t = 1.0 - t;

        const scale = 1.0 - t;
        const alpha = getPulseAlpha(t);

        const dist = scale * this.gravity.range;

        const phinp = 20;
        const thetanp = 100;

        makeAxisVerticalZX(scratchVec3c, this.gravity.worldDirection);
        const ro = this.gravity.worldRadius, ri = ro - this.gravity.diskRadius;

        // circle top
        vec3.scaleAndAdd(scratchVec3a, this.gravity.worldPosition, this.gravity.worldDirection, dist);
        this.drawConcentricCircle(this.ddraw, scratchVec3a, this.gravity.worldDirection, scratchVec3c, ro, ri, thetanp, alpha);

        // circle bottom
        vec3.scaleAndAdd(scratchVec3a, this.gravity.worldPosition, this.gravity.worldDirection, -dist);
        vec3.negate(scratchVec3b, this.gravity.worldDirection);
        this.drawConcentricCircle(this.ddraw, scratchVec3a, scratchVec3b, scratchVec3c, ro, ri, thetanp, alpha);

        // connectors
        const dp = (theta: number, phi: number, r: number): void => {
            // compute outer point on centered Z-circle
            mat4.fromRotation(scratchMatrix, theta, this.gravity.worldDirection);
            // compute out vector
            transformVec3Mat4w0(scratchVec3a, scratchMatrix, scratchVec3c);

            vec3.scaleAndAdd(scratchVec3, this.gravity.worldPosition, scratchVec3a, r);

            // now rotate around Y-circle (tube)
            // compute local Y axis
            vec3.cross(scratchVec3b, this.gravity.worldDirection, scratchVec3a);
            mat4.fromRotation(scratchMatrix, phi, scratchVec3b);
            transformVec3Mat4w0(scratchVec3a, scratchMatrix, this.gravity.worldDirection);
            vec3.scaleAndAdd(scratchVec3, scratchVec3, scratchVec3a, dist);

            this.ddraw.position3vec3(scratchVec3);
            this.ddraw.normal3vec3(scratchVec3a);
            this.ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, alpha * 0xFF);
        };

        for (let i = 0; i < thetanp; i++) {
            const theta0 = MathConstants.TAU*((i+0)/(thetanp));
            const theta1 = MathConstants.TAU*((i+1)/(thetanp));

            this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
            for (let j = 0; j < phinp; j++) {
                const phi = MathConstants.TAU * (j/(phinp-1));
                const r = (phi >= MathConstants.TAU / 2) ? ri : ro;
                dp(theta0, phi, r);
                dp(theta1, phi, r);
            }
            this.ddraw.end();
        }
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!this.gravity.alive || !this.gravity.switchActive)
            return;

        const duration = 5000.0, numRings = 4;
        this.ddraw.beginDraw();
        for (let i = 0; i < numRings; i++) {
            const t = ((viewerInput.time + (i * duration / numRings)) / duration) % 1.0;
            this.drawDiskTorus(t);
        }

        const renderInst = this.ddraw.endDraw(sceneObjHolder.modelCache.device, renderInstManager);

        renderInst.sortKey = setSortKeyLayer(renderInst.sortKey, GfxRendererLayer.TRANSLUCENT);
        const depth = computeViewSpaceDepthFromWorldSpacePoint(viewerInput.camera, this.translation);
        renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);

        this.materialHelper.setOnRenderInst(sceneObjHolder.modelCache.device, renderInstManager.gfxRenderCache, renderInst);

        const light2 = materialParams.u_Lights[2];
        vec3.set(light2.Position, 0, 0, 0);
        vec3.set(light2.Direction, 0, -1, 0);
        vec3.set(light2.CosAtten, 1, 0, 0);
        vec3.set(light2.DistAtten, 1, 0, 0);
        colorFromRGBA(light2.Color, 0, 0, 0, this.light2Alpha);

        colorCopy(materialParams.u_Color[ColorKind.C0], this.c0);
        colorCopy(materialParams.u_Color[ColorKind.C1], this.c1);

        colorFromRGBA(materialParams.u_Color[ColorKind.AMB1], 0, 0, 0, this.amb0Alpha);
        this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);

        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        this.materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

class GravityExplainer2_ConeGravity extends LiveActor {
    private materialHelper: GXMaterialHelperGfx;
    private ddraw = new TDDraw();

    @dfShow()
    private c0 = colorNewFromRGBA(0.0, 0.0, 0.0, 1.0);
    @dfShow()
    private c1 = colorNewFromRGBA(0.8, 0.8, 0.8, 0.3);
    @dfShow()
    private amb0Alpha = -20.0;
    @dfShow()
    private light2Alpha = 120.0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, protected gravity: ConeGravity) {
        super(zoneAndLayer, sceneObjHolder, 'GravityExplainer2_ConeGravity');

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxDesc(GX.Attr.NRM, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.NRM, GX.CompCnt.NRM_XYZ);
        this.ddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);

        const mb = new GXMaterialBuilder('GravityExplainer');
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);
        mb.setChanCtrl(GX.ColorChannelID.COLOR1A1, true, GX.ColorSrc.REG, GX.ColorSrc.REG, 4, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR1A1);
        mb.setTevColorIn(0, GX.CC.C0, GX.CC.C1, GX.CC.RASA, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.A0, GX.CA.A1, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(1, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.CPREV);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.APREV, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setCullMode(GX.CullMode.BACK);
        mb.setUsePnMtxIdx(false);

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());

        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, DrawType.GravityExplainer);

        colorFromRGBA(this.c0, 0.7, 0.8, 1.0, 0.4);
        colorFromRGBA(this.c1, 0.38, 0.33, 0.31, 0.0);
        this.amb0Alpha = 0.2;
        this.light2Alpha = 0.9;
    }

    private drawCone(t: number): void {
        if (this.gravity.inverse)
            t = 1.0 - t;

        const scale = 1.0 - t;
        const alpha = getPulseAlpha(t);

        const dist = scale * this.gravity.range;

        // Bottom point
        getMatrixTranslation(scratchVec3a, this.gravity.mtx);
        const bottomRadius = this.gravity.magX;

        // Compute center top point.
        getMatrixAxisY(scratchVec3b, this.gravity.mtx);
        vec3.normalize(scratchVec3c, scratchVec3b);
        vec3.scaleAndAdd(scratchVec3b, scratchVec3a, scratchVec3b, 1.0 - this.gravity.topCutRate);
        const topRadius = bottomRadius * this.gravity.topCutRate;

        const thetanp = 20;
        this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        for (let j = 0; j < thetanp; j++) {
            const theta = -MathConstants.TAU * (j/(thetanp-1));

            mat4.fromRotation(scratchMatrix, theta, scratchVec3c);
            transformVec3Mat4w0(scratchVec3, scratchMatrix, Vec3UnitX);

            // top point
            vec3.scaleAndAdd(scratchVec3d, scratchVec3b, scratchVec3, topRadius + dist);
            this.ddraw.position3vec3(scratchVec3d);
            this.ddraw.normal3vec3(scratchVec3);
            this.ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, alpha * 0xFF);

            // bottom point
            transformVec3Mat4w0(scratchVec3, scratchMatrix, Vec3UnitX);
            vec3.scaleAndAdd(scratchVec3d, scratchVec3a, scratchVec3, bottomRadius + dist);
            this.ddraw.position3vec3(scratchVec3d);
            this.ddraw.normal3vec3(scratchVec3);
            this.ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, alpha * 0xFF);
        }
        this.ddraw.end();
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!this.gravity.alive || !this.gravity.switchActive)
            return;

        const duration = 5000.0, numRings = 4;
        this.ddraw.beginDraw();
        for (let i = 0; i < numRings; i++) {
            const t = ((viewerInput.time + (i * duration / numRings)) / duration) % 1.0;
            this.drawCone(t);
        }

        const renderInst = this.ddraw.endDraw(sceneObjHolder.modelCache.device, renderInstManager);

        renderInst.sortKey = setSortKeyLayer(renderInst.sortKey, GfxRendererLayer.TRANSLUCENT);
        const depth = computeViewSpaceDepthFromWorldSpacePoint(viewerInput.camera, this.translation);
        renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);

        this.materialHelper.setOnRenderInst(sceneObjHolder.modelCache.device, renderInstManager.gfxRenderCache, renderInst);

        const light2 = materialParams.u_Lights[2];
        vec3.set(light2.Position, 0, 0, 0);
        vec3.set(light2.Direction, 0, -1, 0);
        vec3.set(light2.CosAtten, 1, 0, 0);
        vec3.set(light2.DistAtten, 1, 0, 0);
        colorFromRGBA(light2.Color, 0, 0, 0, this.light2Alpha);

        colorCopy(materialParams.u_Color[ColorKind.C0], this.c0);
        colorCopy(materialParams.u_Color[ColorKind.C1], this.c1);

        colorFromRGBA(materialParams.u_Color[ColorKind.AMB1], 0, 0, 0, this.amb0Alpha);
        this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);

        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        this.materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

export class GravityExplainer2 extends LiveActor {
    private models: LiveActor[] = [];

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder) {
        super(zoneAndLayer, sceneObjHolder, 'GravityExplainer2');
    }

    private spawnParticle(sceneObjHolder: SceneObjHolder, gravity: CubeGravity, xn: number, yn: number, zn: number): void {
        const m = 3000;
        getMatrixTranslation(scratchVec3, gravity.mtx);
        vec3.add(scratchVec3, scratchVec3, [xn*m, yn*m, zn*m]);
        const particle = new GravityExplainerParticle(this.zoneAndLayer, sceneObjHolder, gravity, scratchVec3);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        const gravities = sceneObjHolder.planetGravityManager!.gravities;
        for (let i = 0; i < gravities.length; i++) {
            const gravity = gravities[i];

            if (gravity instanceof PointGravity)
                this.models.push(new GravityExplainer2_PointGravity(this.zoneAndLayer, sceneObjHolder, gravity));
            else if (gravity instanceof ParallelGravity)
                this.models.push(new GravityExplainer2_ParallelGravity(this.zoneAndLayer, sceneObjHolder, gravity));
            else if (gravity instanceof CubeGravity)
                this.models.push(new GravityExplainer2_CubeGravity(this.zoneAndLayer, sceneObjHolder, gravity));
            else if (gravity instanceof DiskGravity)
                this.models.push(new GravityExplainer2_DiskGravity(this.zoneAndLayer, sceneObjHolder, gravity));
            else if (gravity instanceof SegmentGravity)
                this.models.push(new GravityExplainer2_SegmentGravity(this.zoneAndLayer, sceneObjHolder, gravity));
            else if (gravity instanceof WireGravity)
                this.models.push(new GravityExplainer2_WireGravity(this.zoneAndLayer, sceneObjHolder, gravity));
            else if (gravity instanceof DiskTorusGravity)
                this.models.push(new GravityExplainer2_DiskTorusGravity(this.zoneAndLayer, sceneObjHolder, gravity));
            else if (gravity instanceof ConeGravity)
                this.models.push(new GravityExplainer2_ConeGravity(this.zoneAndLayer, sceneObjHolder, gravity));

                /*
                for (let i = 0; i < 27; i++) {
                    const xn = (i % 3) - 1;
                    const yn = (((i / 3) | 0) % 3) - 1;
                    const zn = (((i / 9) | 0) % 3) - 1;
                    this.spawnParticle(sceneObjHolder, gravity, xn, yn, zn);
                }
                // this.spawnParticle(sceneObjHolder, gravity, 1, 1, 0);
            }
            */

            const numParticles = 0;
            for (let j = 0; j < numParticles; j++) {
                const particle = new GravityExplainerParticle(this.zoneAndLayer, sceneObjHolder, gravity, scratchVec3);
            }
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        GravityExplainerParticle.requestArchives(sceneObjHolder);
    }
}
