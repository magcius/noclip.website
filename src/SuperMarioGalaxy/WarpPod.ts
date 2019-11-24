
import { vec3, mat4 } from "gl-matrix";
import { colorNewFromRGBA8, colorCopy, Color } from "../Color";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import * as GX from "../gx/gx_enum";
import { LiveActor, ZoneAndLayer } from "./LiveActor";
import { SceneObjHolder, getObjectName } from "./Main";
import { JMapInfoIter, getJMapInfoArg1, getJMapInfoArg3, getJMapInfoArg4, getJMapInfoArg6, getJMapInfoGroupId, getJMapInfoBool } from "./JMapInfo";
import { LoopMode } from "../Common/JSYSTEM/J3D/J3DLoader";
import { RARC } from "../j3d/rarc";
import { assertExists, fallback } from "../util";
import { DrawBufferType, DrawType } from "./NameObj";
import { calcUpVec, emitEffect, setEffectEnvColor, getCamZdir, vecKillElement } from "./MiscActor";
import { MathConstants, lerp, normToLength } from "../MathHelpers";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { ViewerRenderInput } from "../viewer";
import { Camera } from "../Camera";
import { GXMaterialHelperGfx, ub_MaterialParams, u_PacketParamsBufferSize, ub_PacketParams, MaterialParams, PacketParams, fillPacketParamsData, ColorKind } from "../gx/gx_render";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { setLoopMode, initDefaultPos, loadBTIData, connectToScene, startBrk, startBck } from "./ActorUtil";
import { BTIData } from "../Common/JSYSTEM/JUTTexture";
import { TDDraw } from "./DDraw";

const warpPodColorTable = [
    colorNewFromRGBA8(0x0064C8FF),
    colorNewFromRGBA8(0x2CFF2AFF),
    colorNewFromRGBA8(0xFF3C3CFF),
    colorNewFromRGBA8(0xC4A600FF),
    colorNewFromRGBA8(0x00FF00FF),
    colorNewFromRGBA8(0xFF00FFFF),
    colorNewFromRGBA8(0xFFFF00FF),
    colorNewFromRGBA8(0xFFFFFFFF),
];

function compareVec3(a: vec3, b: vec3): number {
    if (a[0] !== b[0]) return a[0] - b[0];
    if (a[1] !== b[1]) return a[1] - b[1];
    if (a[2] !== b[2]) return a[2] - b[2];
    return 0;
}

const scratchMatrix = mat4.create();
const scratchVec3a = vec3.create(), scratchVec3b = vec3.create(), scratchVec3c = vec3.create();

const materialParams = new MaterialParams();
const packetParams = new PacketParams();

class WarpPodPathDrawer {
    private testColor: BTIData;
    private testMask: BTIData;
    private materialHelper: GXMaterialHelperGfx;
    private ddraw: TDDraw;

    constructor(sceneObjHolder: SceneObjHolder, arc: RARC, private points: vec3[], private color: Color) {
        this.testColor = loadBTIData(sceneObjHolder, arc, `TestColor.bti`);
        this.testMask = loadBTIData(sceneObjHolder, arc, `TestMask.bti`);

        this.ddraw = new TDDraw();
        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);

        // Material.
        const mb = new GXMaterialBuilder('WarpPodPathDrawer');
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX0);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CombineColorInput.C0, GX.CombineColorInput.ONE, GX.CombineColorInput.TEXA, GX.CombineColorInput.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CombineAlphaInput.ZERO, GX.CombineAlphaInput.TEXA, GX.CombineAlphaInput.KONST, GX.CombineAlphaInput.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_2, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    private setupPoint(dst: vec3, i: number, cross: boolean, camera: Camera): void {
        vec3.sub(scratchVec3a, this.points[i + 1], this.points[i]);
        getCamZdir(scratchVec3b, camera);
        vecKillElement(scratchVec3c, scratchVec3a, scratchVec3b);
        vec3.normalize(scratchVec3c, scratchVec3c);

        vec3.cross(scratchVec3a, scratchVec3c, scratchVec3b);

        if (cross) {
            vec3.normalize(scratchVec3a, scratchVec3a);
            vec3.cross(scratchVec3b, scratchVec3a, scratchVec3c);
            vec3.copy(dst, scratchVec3b);
        } else {
            vec3.copy(dst, scratchVec3a);
        }

        normToLength(dst, 30);
    }

    private drawPathPart(camera: Camera, cross: boolean): void {
        this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        for (let i = 0; i < this.points.length - 1; i++) {
            this.setupPoint(scratchVec3a, i, cross, camera);
            const texCoordY = Math.abs((2.0 * (i / this.points.length)) - 1.0);

            vec3.add(scratchVec3c, this.points[i], scratchVec3a);
            this.ddraw.position3vec3(scratchVec3c);
            this.ddraw.texCoord2f32(GX.Attr.TEX0, 0.0, texCoordY);

            vec3.sub(scratchVec3c, this.points[i], scratchVec3a);
            this.ddraw.position3vec3(scratchVec3c);
            this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, texCoordY);
        }
        this.ddraw.end();
    }

    private drawPath(camera: Camera): void {
        this.drawPathPart(camera, false);
        this.drawPathPart(camera, true);
    }

    public draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        this.testColor.fillTextureMapping(materialParams.m_TextureMapping[0]);
        colorCopy(materialParams.u_Color[ColorKind.C0], this.color);

        const template = renderInstManager.pushTemplateRenderInst();

        const offs = template.allocateUniformBuffer(ub_MaterialParams, this.materialHelper.materialParamsBufferSize);
        this.materialHelper.fillMaterialParamsDataOnInst(template, offs, materialParams);

        template.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

        template.allocateUniformBuffer(ub_PacketParams, u_PacketParamsBufferSize);
        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        fillPacketParamsData(template.mapUniformBufferF32(ub_PacketParams), template.getUniformBufferOffset(ub_PacketParams), packetParams);

        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);

        this.ddraw.beginDraw();
        this.drawPath(viewerInput.camera);
        this.ddraw.endDraw(device, renderInstManager);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
        this.testColor.destroy(device);
        this.testMask.destroy(device);
    }
}

export class WarpPod extends LiveActor {
    private visible: boolean;
    private groupId: number;
    private pairedWarpPod: WarpPod | null = null;
    private isPairPrimary: boolean = false;
    private warpPathPoints: vec3[] | null = null;
    private pathDrawer: WarpPodPathDrawer | null = null;
    private color: Color;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "WarpPod");

        this.visible = fallback(getJMapInfoArg1(infoIter), 1) !== 0;
        const hasSaveFlag = getJMapInfoBool(fallback(getJMapInfoArg3(infoIter), -1));
        const astroDomeNum = getJMapInfoBool(fallback(getJMapInfoArg4(infoIter), -1));
        const colorIndex = fallback(getJMapInfoArg6(infoIter), 0);
        
        let color = warpPodColorTable[colorIndex];
        if (color === undefined) {
            // Seems to happen in SMG2 sometimes; they might have expanded the color table.
            color = warpPodColorTable[0];
        }
        this.color = color;

        this.initEffectKeeper(sceneObjHolder, null);

        if (this.visible) {
            startBck(this, 'Active');
            startBrk(this, 'Active');
            // This is a bit hokey, but we don't have an XanimePlayer, so this is our solution...
            setLoopMode(this, LoopMode.ONCE);
        }

        // The game normally will check a few different save file bits
        // or the highest unlocked AstroDome, but we just declare all
        // WarpPods are active.
        const inactive = false;

        if (inactive) {
            startBck(this, 'Wait');
            startBrk(this, 'Wait');
        } else {
            this.glowEffect(sceneObjHolder);
        }

        this.groupId = assertExists(getJMapInfoGroupId(infoIter));
        // Look for the pair. If it's spawned, then init.
        const pairedWarpPod = this.lookForPair(sceneObjHolder);
        if (pairedWarpPod !== null) {
            this.initPair(sceneObjHolder, pairedWarpPod);
            pairedWarpPod.initPair(sceneObjHolder, this);
        }

        // This isn't quite the same as original, which has a WarpPodMgr which draws all of the paths...
        if (this.visible) {
            connectToScene(sceneObjHolder, this, 0x22, 5, DrawBufferType.MAP_OBJ, DrawType.WARP_POD_PATH);
        } else {
            connectToScene(sceneObjHolder, this, 0x22, -1, -1, -1);
        }
    }

    private initPair(sceneObjHolder: SceneObjHolder, pairedWarpPod: WarpPod): void {
        this.pairedWarpPod = pairedWarpPod;

        // The primary pod is whichever of the two has the lowest translation.
        this.isPairPrimary = compareVec3(this.translation, this.pairedWarpPod.translation) < 0;

        if (this.isPairPrimary)
            this.initDraw(sceneObjHolder);
    }

    private initDraw(sceneObjHolder: SceneObjHolder): void {
        if (this.pairedWarpPod === null || !this.isPairPrimary)
            return;

        const numPoints = 60;
        this.warpPathPoints = [];

        const delta = vec3.create();
        vec3.sub(delta, this.pairedWarpPod.translation, this.translation);
        const mag = vec3.length(delta);

        const upVec = vec3.create();
        calcUpVec(upVec, this);
        const negUpVec = vec3.create();
        vec3.negate(negUpVec, upVec);

        const crossA = vec3.create(), crossB = vec3.create();
        vec3.cross(crossA, delta, negUpVec);
        vec3.normalize(crossA, crossA);
        vec3.cross(crossB, crossA, delta);
        vec3.normalize(crossB, crossB);

        const halfway = vec3.create();
        vec3.scale(halfway, delta, 0.5);
        vec3.add(halfway, this.translation, halfway);

        const mag2 = 0.5 * mag;
        const b = mag2 / Math.sin(MathConstants.TAU / 8);
        let a = (b * b) - (mag2 * mag2);
        if (a >= 0) {
            const norm = 1 / Math.sqrt(a);
            const anorm = a * norm;
            const cubic = (anorm * norm) - 3.0;
            a = -cubic * anorm * 0.5;
        }

        const ca = vec3.create(), cb = vec3.create();
        vec3.scaleAndAdd(ca, halfway, crossB, a);
        vec3.scale(cb, crossB, -b);

        for (let i = 0; i < numPoints; i++) {
            const v = vec3.create();
            const ha = 1.0 - ((i - numPoints / 2) / numPoints);
            const c = (Math.sin(Math.PI * ha) + 1.0) * 0.5;
            const rad = lerp(-MathConstants.TAU / 8, MathConstants.TAU / 8, c);
            mat4.fromRotation(scratchMatrix, rad, crossA);

            vec3.transformMat4(v, cb, scratchMatrix);
            vec3.add(v, v, ca);
            vec3.scaleAndAdd(v, v, upVec, 200);

            this.warpPathPoints.push(v);
        }

        this.pathDrawer = new WarpPodPathDrawer(sceneObjHolder, this.resourceHolder.arc, this.warpPathPoints, this.color);
    }

    private lookForPair(sceneObjHolder: SceneObjHolder): WarpPod | null {
        // In the original code, there's a WarpPodMgr which manages a LiveActorGroup
        // so we don't need to search the whole thing.
        for (let i = 0; i < sceneObjHolder.sceneNameObjListExecutor.nameObjExecuteInfos.length; i++) {
            const nameObj = sceneObjHolder.sceneNameObjListExecutor.nameObjExecuteInfos[i].nameObj;
            if (nameObj !== this && nameObj instanceof WarpPod) {
                const warpPod = nameObj as WarpPod;
                if (warpPod.groupId === this.groupId)
                    return warpPod;
            }
        }

        return null;
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!this.visibleScenario || !this.visibleAlive)
            return;

        if (this.pathDrawer !== null)
            this.pathDrawer.draw(sceneObjHolder.modelCache.device, renderInstManager, viewerInput);
    }

    private glowEffect(sceneObjHolder: SceneObjHolder): void {
        if (this.visible) {
            emitEffect(sceneObjHolder, this, 'EndGlow');
            setEffectEnvColor(this, 'EndGlow', this.color);
        }
    }
    
    public destroy(device: GfxDevice): void {
        super.destroy(device);

        if (this.pathDrawer !== null)
            this.pathDrawer.destroy(device);
    }
}
