
// Fun actor (not from orig. game) to visualize gravity areas.

import * as GX from '../../gx/gx_enum';
import { LiveActor, ZoneAndLayer, makeMtxTRSFromActor } from "../LiveActor";
import { TDDraw, TSDraw } from "../DDraw";
import { GXMaterialHelperGfx, MaterialParams, PacketParams, ColorKind } from "../../gx/gx_render";
import { vec3, mat4 } from "gl-matrix";
import { colorNewCopy, White, colorFromHSL, colorNewFromRGBA, colorFromRGBA, colorCopy } from "../../Color";
import { dfShow } from "../../DebugFloaters";
import { SceneObjHolder, getDeltaTimeFrames } from "../Main";
import { GXMaterialBuilder } from '../../gx/GXMaterialBuilder';
import { connectToScene, getRandomFloat, calcGravityVector, connectToSceneMapObjDecoration } from '../ActorUtil';
import { DrawType, MovementType } from '../NameObj';
import { ViewerRenderInput } from '../../viewer';
import { invlerp, Vec3Zero, transformVec3Mat4w0, transformVec3Mat4w1, MathConstants } from '../../MathHelpers';
import { GfxRenderInstManager, setSortKeyLayer, GfxRendererLayer, setSortKeyDepth } from '../../gfx/render/GfxRenderer';
import { GfxDevice } from '../../gfx/platform/GfxPlatform';
import { Camera, computeViewSpaceDepthFromWorldSpacePoint } from '../../Camera';
import { PlanetGravity, PointGravity, ParallelGravity, ParallelGravityRangeType } from '../Gravity';
import { isFirstStep } from '../Spine';

const materialParams = new MaterialParams();
const packetParams = new PacketParams();

const scratchVec3 = vec3.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchMatrix = mat4.create();

class GravityExplainerArrow {
    // Original coordinate that gravity is generated from.
    public coord = vec3.create();
    public gravityVec = vec3.create();

    // Drawing.
    public pos = vec3.create();
    public speed = 5.0;
    public time: number = 0.0;
    public lifetime = 360.0;
    public color = colorNewCopy(White);
    public scale: number = 1.0;
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

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder) {
        super(zoneAndLayer, sceneObjHolder, 'GravityExplainer');

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);

        const mb = new GXMaterialBuilder('GravityExplainer');
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX0);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.C0, GX.CC.C1, GX.CC.RASA, GX.CC.RASC);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.KONST);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevKAlphaSel(0, GX.KonstAlphaSel.KASEL_1);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());

        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, DrawType.GravityExplainer);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        this.spawnArrows(sceneObjHolder);
    }

    private spawnArrows(sceneObjHolder: SceneObjHolder): void {
        const gravities = sceneObjHolder.planetGravityManager!.gravities;

        for (let i = 0; i < gravities.length; i++) {
            const grav = gravities[i];
            if (grav.constructor.name !== 'DiskGravity')
                continue;

            const count = 50;

            for (let j = 0; j < count; j++) {
                const arrow = new GravityExplainerArrow();
                arrow.scale = 0.1;

                grav.generateRandomPoint(arrow.coord);
                vec3.copy(arrow.pos, arrow.coord);

                // Red/green color.
                const hue = getRandomFloat(0.0, 0.2);
                colorFromHSL(arrow.color, hue, 1.0, 0.5);

                arrow.time = Math.random() * arrow.lifetime;

                this.arrows.push(arrow);
            }
        }
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const deltaTimeFrames = getDeltaTimeFrames(viewerInput);

        for (let i = 0; i < this.arrows.length; i++) {
            const arrow = this.arrows[i];

            calcGravityVector(sceneObjHolder, this, arrow.coord, arrow.gravityVec);
            vec3.normalize(arrow.gravityVec, arrow.gravityVec);

            // vec3.scaleAndAdd(arrow.pos, arrow.pos, arrow.gravityVec, arrow.speed * deltaTimeFrames);
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

            arrow.color.a = 1.0;
        }
    }

    private drawPoint(arrow: GravityExplainerArrow, ddraw: TDDraw, mtx: mat4, p: vec3): void {
        vec3.transformMat4(scratchVec3c, p, mtx);
        ddraw.position3vec3(scratchVec3c);
        ddraw.color4color(GX.Attr.CLR0, arrow.color);
    }

    private drawArrow(arrow: GravityExplainerArrow, ddraw: TDDraw, camera: Camera): void {
        // const ctx = getDebugOverlayCanvas2D();
        // drawWorldSpacePoint(ctx, camera, arrow.pos, Magenta, 10);

        const mtx = scratchMatrix;

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

        ddraw.begin(GX.Command.DRAW_TRIANGLES, 3);

        // Arrow's tip is at the tip...
        vec3.copy(scratchVec3, Vec3Zero);
        this.drawPoint(arrow, ddraw, mtx, scratchVec3);

        scratchVec3[1] += this.tipHeight;
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

const enum GravityExplainerParticleNrv { Spawn, Fall }

class GravityExplainerParticle extends LiveActor<GravityExplainerParticleNrv> {
    public originalTranslation = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, private parentGravity: PlanetGravity, pos: vec3) {
        super(zoneAndLayer, sceneObjHolder, 'GravityExplainerParticle');

        this.initModelManagerWithAnm(sceneObjHolder, 'ElectricRailPoint');
        connectToSceneMapObjDecoration(sceneObjHolder, this);

        this.initNerve(GravityExplainerParticleNrv.Spawn);

        vec3.copy(this.originalTranslation, pos);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNrv: GravityExplainerParticleNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNrv, deltaTimeFrames);

        if (currentNrv === GravityExplainerParticleNrv.Spawn) {
            if (isFirstStep(this)) {
                vec3.copy(this.translation, this.originalTranslation);
                const scale = 0;
                vec3.set(this.scale, scale, scale, scale);
                vec3.zero(this.velocity);
            }

            const maxScale = 5.0;
            const scale = Math.min(this.scale[0] + 0.2, maxScale);
            vec3.set(this.scale, scale, scale, scale);
            if (scale >= maxScale)
                this.setNerve(GravityExplainerParticleNrv.Fall);
        } else if (currentNrv === GravityExplainerParticleNrv.Fall) {
            if (this.parentGravity.calcGravity(this.gravityVector, this.translation)) {
                vec3.add(this.velocity, this.velocity, this.gravityVector);
                const drag = 0.999;
                vec3.scale(this.velocity, this.velocity, Math.pow(drag, deltaTimeFrames));
            } else {
                const scale = Math.max(0.0, this.scale[0] - (0.1 * deltaTimeFrames));
                vec3.set(this.scale, scale, scale, scale);

                if (scale <= 0.0)
                    this.setNerve(GravityExplainerParticleNrv.Spawn);
            }
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('ElectricRailPoint');
    }
}

const enum GravityExplainer2ColorScheme {
    Blue, Red,
}

abstract class GravityExplainer2Base<T extends PlanetGravity> extends LiveActor {
    private materialHelper: GXMaterialHelperGfx;
    private sdraw = new TSDraw();
    private particles: GravityExplainerParticle[] = [];

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, protected gravity: T) {
        super(zoneAndLayer, sceneObjHolder, 'GravityExplainer2Base');

        this.sdraw.setVtxDesc(GX.Attr.POS, true);
        this.sdraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);

        this.initPlacementAndArgs();

        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, DrawType.GravityExplainer);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);
        this.drawAndUploadModel(sceneObjHolder, this.sdraw);
    }


    protected abstract initPlacementAndArgs(): void;
    protected abstract drawAndUploadModel(sceneObjHolder: SceneObjHolder, ddraw: TSDraw): void;

    @dfShow()
    private c0 = colorNewFromRGBA(0.0, 0.0, 0.0, 1.0);
    @dfShow()
    private c1 = colorNewFromRGBA(0.8, 0.8, 0.8, 0.3);
    @dfShow()
    private amb0Alpha = -20.0;
    @dfShow()
    private light2Alpha = 120.0;

    protected setUseNormal(v: boolean): void {
        const mb = new GXMaterialBuilder('GravityExplainer');
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.C0, GX.CC.C1, GX.CC.RASA, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.A0, GX.CA.A1, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevKAlphaSel(0, GX.KonstAlphaSel.KASEL_1);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setCullMode(GX.CullMode.BACK);
        mb.setUsePnMtxIdx(false);

        if (v) {
            mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, true, GX.ColorSrc.REG, GX.ColorSrc.REG, 4, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);

            this.sdraw.setVtxDesc(GX.Attr.NRM, true);
            this.sdraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.NRM, GX.CompCnt.NRM_XYZ);
        } else {
            mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);

            this.sdraw.setVtxDesc(GX.Attr.CLR0, true);
            this.sdraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);
        }

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    protected setColorScheme(scheme: GravityExplainer2ColorScheme): void {
        return;

        if (scheme === GravityExplainer2ColorScheme.Blue) {
            colorFromRGBA(this.c0, 1.0, 0.69, 0.67, 1.0);
            colorFromRGBA(this.c1, 0.38, 0.33, 0.31, 0.1);
        }
    }

    protected spawnParticle(sceneObjHolder: SceneObjHolder, pos: vec3): void {
        this.particles.push(new GravityExplainerParticle(this.zoneAndLayer, sceneObjHolder, this.gravity, pos));
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);
        for (let i = 0; i < this.particles.length; i++)
            this.particles[i].visibleAlive = this.gravity.alive;
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!this.gravity.alive)
            return;

        const template = renderInstManager.pushTemplateRenderInst();
        template.sortKey = setSortKeyLayer(template.sortKey, GfxRendererLayer.TRANSLUCENT);

        const depth = computeViewSpaceDepthFromWorldSpacePoint(viewerInput.camera, this.translation);
        template.sortKey = setSortKeyDepth(template.sortKey, depth);

        // template.allocateUniformBuffer(ub_PacketParams, ub_PacketParamsBufferSize);
        makeMtxTRSFromActor(scratchMatrix, this);
        mat4.mul(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix, scratchMatrix);
        this.materialHelper.allocatePacketParamsDataOnInst(template, packetParams);

        const device = sceneObjHolder.modelCache.device;

        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);

        const light2 = materialParams.u_Lights[2];
        vec3.set(light2.Position, 0, 0, 0);
        vec3.set(light2.Direction, 0, -1, 0);
        vec3.set(light2.CosAtten, 1, 0, 0);
        vec3.set(light2.DistAtten, 1, 0, 0);
        colorFromRGBA(light2.Color, 0, 0, 0, this.light2Alpha);

        colorCopy(materialParams.u_Color[ColorKind.C0], this.c0);
        colorCopy(materialParams.u_Color[ColorKind.C1], this.c1);
        colorFromRGBA(materialParams.u_Color[ColorKind.AMB0], 0, 0, 0, this.amb0Alpha);
        this.materialHelper.allocateMaterialParamsDataOnInst(template, materialParams);

        const renderInst = renderInstManager.newRenderInst();
        this.sdraw.setOnRenderInst(renderInst);
        renderInstManager.submitRenderInst(renderInst);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.sdraw.destroy(device);
    }
}

function drawSphere(ddraw: TSDraw, numY: number = 200, numX: number = numY): void {
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

class GravityExplainer_PointGravity extends GravityExplainer2Base<PointGravity> {
    protected initPlacementAndArgs(): void {
        vec3.copy(this.translation, this.gravity.pos);
        const scale = this.gravity.range;
        vec3.set(this.scale, scale, scale, scale);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);
        return;

        for (let i = 0; i < 50; i++) {
            this.gravity.generateRandomPoint(scratchVec3);
            this.spawnParticle(sceneObjHolder, scratchVec3);
        }
    }

    protected drawAndUploadModel(sceneObjHolder: SceneObjHolder, ddraw: TSDraw): void {
        this.setColorScheme(GravityExplainer2ColorScheme.Blue);
        this.setUseNormal(true);

        ddraw.beginDraw();
        drawSphere(ddraw);
        ddraw.endDraw(sceneObjHolder.modelCache.device, sceneObjHolder.modelCache.cache);
    }
}

class GravityExplainer_ParallelGravity extends GravityExplainer2Base<ParallelGravity> {
    protected initPlacementAndArgs(): void {
    }

    private drawBoxPlane(ddraw: TSDraw, x: number, y: number, z: number): void {
        vec3.set(scratchVec3a, x, y, z);
        if (y === 0)
            vec3.set(scratchVec3b, 0, 1, 0);
        else
            vec3.set(scratchVec3b, 0, 0, 1);
        vec3.cross(scratchVec3c, scratchVec3b, scratchVec3a);
        vec3.cross(scratchVec3b, scratchVec3a, scratchVec3c);

        const boxMtx = this.gravity.boxMtx!;
        function drawBoxPoint(iu: number, iv: number): void {
            vec3.copy(scratchVec3, scratchVec3a);
            vec3.scaleAndAdd(scratchVec3, scratchVec3, scratchVec3c, iu);
            vec3.scaleAndAdd(scratchVec3, scratchVec3, scratchVec3b, iv);
            transformVec3Mat4w1(scratchVec3, boxMtx, scratchVec3);

            ddraw.position3vec3(scratchVec3);

            let alpha = 0xFF;
            if (Math.max(Math.abs(iu), Math.abs(iv)) >= 1.0)
                alpha = 0x80;
            ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, alpha);
        }

        const margin = 1.0;
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

    private drawBox(ddraw: TSDraw): void {
        this.drawBoxPlane(ddraw, -1, 0, 0);
        this.drawBoxPlane(ddraw,  1, 0, 0);
        this.drawBoxPlane(ddraw, 0, -1, 0);
        this.drawBoxPlane(ddraw, 0,  1, 0);
        this.drawBoxPlane(ddraw, 0, 0, -1);
        this.drawBoxPlane(ddraw, 0, 0,  1);
    }

    protected drawAndUploadModel(sceneObjHolder: SceneObjHolder, ddraw: TSDraw): void {
        this.setColorScheme(GravityExplainer2ColorScheme.Blue);
        this.setUseNormal(false);

        ddraw.beginDraw();

        if (this.gravity.rangeType === ParallelGravityRangeType.Box) {
            this.drawBox(ddraw);
        }

        ddraw.endDraw(sceneObjHolder.modelCache.device, sceneObjHolder.modelCache.cache);
    }
}

export class GravityExplainer2 extends LiveActor {
    private models: LiveActor[] = [];

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder) {
        super(zoneAndLayer, sceneObjHolder, 'GravityExplainer2');
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        const gravities = sceneObjHolder.planetGravityManager!.gravities;

        for (let i = 0; i < gravities.length; i++) {
            const grav = gravities[i];
            if (grav instanceof PointGravity)
                this.models.push(new GravityExplainer_PointGravity(this.zoneAndLayer, sceneObjHolder, grav));
            else if (grav instanceof ParallelGravity)
                this.models.push(new GravityExplainer_ParallelGravity(this.zoneAndLayer, sceneObjHolder, grav));
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        GravityExplainerParticle.requestArchives(sceneObjHolder);
    }
}
