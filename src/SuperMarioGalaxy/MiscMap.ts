
import { NameObj, MovementType, DrawType } from "./NameObj";
import { OceanBowl } from "./OceanBowl";
import { SceneObjHolder, SpecialTextureType } from "./Main";
import { connectToSceneScreenEffectMovement, getCamPos, connectToSceneAreaObj, getPlayerPos, connectToScene, loadBTIData } from "./ActorUtil";
import { ViewerRenderInput } from "../viewer";
import { AreaObjMgr, AreaObj, AreaFormType } from "./AreaObj";
import { vec3 } from "gl-matrix";
import { OceanRing, isEqualStageName } from "./MiscActor";
import { JMapInfoIter, getJMapInfoBool, getJMapInfoArg0, getJMapInfoArg1, getJMapInfoArg2 } from "./JMapInfo";
import { ZoneAndLayer, LiveActor, dynamicSpawnZoneAndLayer } from "./LiveActor";
import { createNormalBloom } from "./ImageEffect";
import { fallback } from "../util";
import { OceanSphere } from "./OceanSphere";
import { colorNewFromRGBA8 } from "../Color";
import { BTIData } from "../Common/JSYSTEM/JUTTexture";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { TextureMapping } from "../TextureHolder";
import { GXMaterialHelperGfx } from "../gx/gx_render";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { TDDraw } from "./DDraw";
import * as GX from '../gx/gx_enum';

//#region Water
export class WaterArea extends AreaObj {
    public getManagerName(): string {
        return "Water";
    }
}

export class WaterAreaMgr extends AreaObjMgr<WaterArea> {
    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, "Water");
    }
}

const scratchVec3 = vec3.create();
export class WaterAreaHolder extends NameObj {
    public cameraInWater: boolean = false;
    public oceanBowl: OceanBowl[] = [];
    public oceanRing: OceanRing[] = [];
    public oceanSphere: OceanSphere[] = [];
    private useBloom: boolean = false;
    private cameraFilter: WaterCameraFilter;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'WaterAreaHolder');

        if (isEqualStageName(sceneObjHolder, 'HeavenlyBeachGalaxy') || isEqualStageName(sceneObjHolder, 'OceanRingGalaxy')) {
            createNormalBloom(sceneObjHolder);
            this.useBloom = true;
        }

        connectToSceneScreenEffectMovement(sceneObjHolder, this);

        this.cameraFilter = new WaterCameraFilter(dynamicSpawnZoneAndLayer, sceneObjHolder);
    }

    public entryOceanBowl(oceanBowl: OceanBowl): void {
        this.oceanBowl.push(oceanBowl);
    }

    public entryOceanRing(oceanRing: OceanRing): void {
        this.oceanRing.push(oceanRing);
    }

    public entryOceanSphere(oceanSphere: OceanSphere): void {
        this.oceanSphere.push(oceanSphere);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        getCamPos(scratchVec3, viewerInput.camera);

        const inWater = getWaterAreaObj(sceneObjHolder, scratchVec3);
        if (inWater) {
            if (!this.cameraInWater) {
                this.cameraInWater = true;

                if (this.useBloom) {
                    const imageEffectDirector = sceneObjHolder.imageEffectSystemHolder!.imageEffectDirector;
                    imageEffectDirector.turnOnNormal(sceneObjHolder);
                    imageEffectDirector.setNormalBloomIntensity(0xFF);
                    imageEffectDirector.setNormalBloomThreshold(0x80);
                    imageEffectDirector.setNormalBloomBlurIntensity1(0x28);
                    imageEffectDirector.setNormalBloomBlurIntensity2(0x14);
                }
            }

            // TODO(jstpierre): WaterInfo
        } else {
            if (this.cameraInWater) {
                if (this.useBloom) {
                    const imageEffectDirector = sceneObjHolder.imageEffectSystemHolder!.imageEffectDirector;
                    imageEffectDirector.setAuto(sceneObjHolder);
                }

                this.cameraInWater = false;
            }
        }
    }
}

export function getWaterAreaObj(sceneObjHolder: SceneObjHolder, position: vec3): boolean {
    if (sceneObjHolder.areaObjContainer !== null) {
        const areaObj = sceneObjHolder.areaObjContainer.getAreaObj("Water", position);
        if (areaObj !== null)
            return true;
    }

    if (sceneObjHolder.waterAreaHolder !== null) {
        const waterAreas = sceneObjHolder.waterAreaHolder;
        for (let i = 0; i < waterAreas.oceanBowl.length; i++)
            if (waterAreas.oceanBowl[i].isInWater(position))
                return true;

        for (let i = 0; i < waterAreas.oceanRing.length; i++)
            if (waterAreas.oceanRing[i].isInWater(sceneObjHolder, position))
                return true;

        for (let i = 0; i < waterAreas.oceanSphere.length; i++)
            if (waterAreas.oceanSphere[i].isInWater(position))
                return true;
    }

    return false;
}

export function isInWater(sceneObjHolder: SceneObjHolder, position: vec3): boolean {
    return getWaterAreaObj(sceneObjHolder, position);
}

export function isCameraInWater(sceneObjHolder: SceneObjHolder): boolean {
    if (sceneObjHolder.waterAreaHolder === null)
        return false;
    return sceneObjHolder.waterAreaHolder.cameraInWater;
}

export function createWaterAreaCube(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
    return new WaterArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.CubeGround);
}

export function createWaterAreaCylinder(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
    return new WaterArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.Cylinder);
}

export function createWaterAreaSphere(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
    return new WaterArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.Sphere);
}

const enum WaterCameraFilterNrv { Air, AirToWater, Water, WaterToAir }

export class WaterCameraFilter extends LiveActor<WaterCameraFilterNrv> {
    private angle: number = 0;
    private transition: number = 0;
    private color = colorNewFromRGBA8(0x32FFFFFF);
    private textureMapping = new TextureMapping();
    private filterTexture: BTIData;
    private materialHelper: GXMaterialHelperGfx;
    private ddraw = new TDDraw();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder) {
        super(zoneAndLayer, sceneObjHolder, 'WaterCameraFilter');

        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, DrawType.WATER_CAMERA_FILTER);
        // invalidateClipping
        this.initNerve(WaterCameraFilterNrv.Air);

        const arc = sceneObjHolder.modelCache.getObjectData('WaterCameraFilter');
        this.filterTexture = loadBTIData(sceneObjHolder, arc, 'WaterCameraFilter.bti');

        sceneObjHolder.specialTextureBinder.registerTextureMapping(this.textureMapping, SpecialTextureType.ImageEffectTexture1);

        this.makeActorAppeared(sceneObjHolder);

        // loadMaterial
        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX1, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX1, GX.CompCnt.TEX_ST);

        const mb = new GXMaterialBuilder('WaterCameraFilter');
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.PNMTX0);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD1, GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setIndTexOrder(GX.IndTexStageID.STAGE0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0);
        mb.setTevIndWarp(0, GX.IndTexStageID.STAGE0, true, false, GX.IndTexMtxID._0);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.OR, GX.CompareType.GREATER, 0);
        mb.setZMode(false, GX.CompareType.ALWAYS, false);
        mb.setCullMode(GX.CullMode.NONE);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (this.getCurrentNerve() === WaterCameraFilterNrv.Air)
            return;
    }

    public destroy(device: GfxDevice): void {
        this.filterTexture.destroy(device);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('WaterCameraFilter');
    }
}
//#endregion

//#region SwitchArea
export class SwitchArea extends AreaObj {
    public forwardSwitchB: boolean;
    public turnOffSwitch: boolean;
    public needsPlayerOnGround: boolean;

    protected parseArgs(infoIter: JMapInfoIter): void {
        this.forwardSwitchB = getJMapInfoBool(fallback(getJMapInfoArg0(infoIter), -1));
        this.turnOffSwitch = getJMapInfoBool(fallback(getJMapInfoArg1(infoIter), -1));
        this.needsPlayerOnGround = getJMapInfoBool(fallback(getJMapInfoArg2(infoIter), -1));
    }

    protected postCreate(sceneObjHolder: SceneObjHolder): void {
        connectToSceneAreaObj(sceneObjHolder, this);
    }

    private isUpdate(sceneObjHolder: SceneObjHolder): boolean {
        // if (this.needsPlayerOnGround && !calcPlayerOnGround(sceneObjHolder))
        //    return false;

        if (this.forwardSwitchB)
            return true;

        if (this.turnOffSwitch)
            return this.switchCtrl.isOnSwitchA(sceneObjHolder);
        else
            return !this.switchCtrl.isOnSwitchA(sceneObjHolder);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        if (!this.isUpdate(sceneObjHolder))
            return;

        if (!this.switchCtrl.isValidSwitchB() || this.switchCtrl.isOnSwitchB(sceneObjHolder)) {
            getPlayerPos(scratchVec3, sceneObjHolder);

            if (this.isInVolume(scratchVec3)) {
                if (this.turnOffSwitch) {
                    this.switchCtrl.offSwitchA(sceneObjHolder);
                } else {
                    this.switchCtrl.onSwitchA(sceneObjHolder);
                }
            }
        } else {
            if (this.forwardSwitchB)
                this.switchCtrl.offSwitchA(sceneObjHolder);
        }
    }

    public getManagerName(): string {
        return 'SwitchArea';
    }
}

export function createSwitchCube(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): SwitchArea {
    return new SwitchArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.CubeGround);
}

export function createSwitchSphere(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): SwitchArea {
    return new SwitchArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.Sphere);
}

export function createSwitchCylinder(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): SwitchArea {
    return new SwitchArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.Cylinder);
}
//#endregion
