
import * as Viewer from '../viewer';
import { SMGSceneDescBase, ModelCache, SceneObjHolder, getDeltaTimeFrames, SMGRenderer } from "./Main";
import { JMapInfoIter, createCsvParser } from './JMapInfo';
import { JKRArchive } from '../Common/JSYSTEM/JKRArchive';
import { NameObj, MovementType } from './NameObj';
import { connectToScene, getRandomInt, getRandomFloat, getRailTotalLength, vecKillElement } from './ActorUtil';
import { TicoRail } from './Actors/MiscActor';
import { vec3, mat4 } from 'gl-matrix';

class SMG1SceneDesc extends SMGSceneDescBase {
    public pathBase: string = `SuperMarioGalaxy`;
    public getLightData(modelCache: ModelCache): JMapInfoIter {
        const lightDataRarc = modelCache.getArchive(`ObjectData/LightData.arc`)!;
        return createCsvParser(lightDataRarc.findFileData(`LightData.bcsv`)!);
    }
    public getZoneLightData(modelCache: ModelCache, zoneName: string): JMapInfoIter {
        const lightDataRarc = modelCache.getArchive(`ObjectData/LightData.arc`)!;
        return createCsvParser(lightDataRarc.findFileData(`Light${zoneName}.bcsv`)!);
    }
    public getZoneMapArchive(modelCache: ModelCache, zoneName: string): JKRArchive {
        return modelCache.getArchive(`StageData/${zoneName}.arc`)!;
    }
    public requestGlobalArchives(modelCache: ModelCache): void {
        modelCache.requestArchiveData(`ObjectData/LightData.arc`);
    }
    public requestZoneArchives(modelCache: ModelCache, zoneName: string): void {
        modelCache.requestArchiveData(`StageData/${zoneName}.arc`);
    }
}

function explerp(dst: vec3, target: vec3, k: number): void {
    dst[0] += (target[0] - dst[0]) * k;
    dst[1] += (target[1] - dst[1]) * k;
    dst[2] += (target[2] - dst[2]) * k;
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
class DayInTheLifeOfALumaController extends NameObj {
    private ticos: TicoRail[] = [];
    private ticoIndex: number = -1;
    private currentZoom: number;
    private switchCounter: number;
    private cameraCenter = vec3.create();
    private cameraEye = vec3.create();
    private cameraK = 1/8;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'DayInTheLifeOfALumaController');
        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, -1);
    }

    private pickNewTico(): void {
        while (true) {
            this.ticoIndex = getRandomInt(0, this.ticos.length);
            const tico = this.ticos[this.ticoIndex];

            if (!tico.visibleAlive || !tico.visibleScenario)
                continue;

            // Never picked a stopped Tico.
            if (tico.isStopped(0))
                continue;

            break;
        }

        const tico = this.ticos[this.ticoIndex];
        const isShortRail = getRailTotalLength(tico) < 10000;
        this.currentZoom = isShortRail ? getRandomFloat(500, 2500) : getRandomFloat(1000, 3500);
        this.switchCounter = isShortRail ? 2000 : -1;
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);
        this.ticos = sceneObjHolder.nameObjHolder.nameObjs.filter((obj) => obj.name === 'TicoRail') as TicoRail[];
        this.pickNewTico();

        this.camera(1.0);
    }

    private camera(k: number = this.cameraK): void {
        const tico = this.ticos[this.ticoIndex];

        // Camera hax
        vec3.copy(scratchVec3a, tico.direction);
        vec3.set(scratchVec3b, 0, 1, 0);

        // XZ plane
        vecKillElement(scratchVec3c, scratchVec3a, scratchVec3b);
        // Jam the direction vector by this a ton to smooth out the Y axis.
        vec3.scaleAndAdd(scratchVec3a, scratchVec3a, scratchVec3c, 1);
        vec3.normalize(scratchVec3a, scratchVec3a);

        vec3.scaleAndAdd(scratchVec3a, tico.translation, scratchVec3a, -this.currentZoom);
        scratchVec3a[1] += 500;

        explerp(this.cameraEye, scratchVec3a, k);
        explerp(this.cameraCenter, tico.translation, k);
    }

    private tryPickNewTico(deltaTimeFrames: number): void {
        const tico = this.ticos[this.ticoIndex];

        // If the Tico isn't visible due to scenario reasons, force a new Tico.
        if (!tico.visibleScenario || !tico.visibleAlive)
            this.pickNewTico();

        if (tico.isStopped(0)) {
            // Each frame that we're stopped, there's a 1 in 200 chance that we switch.
            const rnd = getRandomInt(0, 200);
            if (rnd === 0)
                this.pickNewTico();
        }

        // The ticos in the middle will never stop because of how they're set up.
        if (this.switchCounter >= 0) {
            this.switchCounter -= deltaTimeFrames;
            if (this.switchCounter <= 0)
                this.pickNewTico();
        }
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        this.tryPickNewTico(getDeltaTimeFrames(viewerInput));
        this.camera();

        const camera = viewerInput.camera;
        mat4.lookAt(camera.viewMatrix, this.cameraEye, this.cameraCenter, scratchVec3b);
        mat4.invert(camera.worldMatrix, camera.viewMatrix);
        camera.worldMatrixUpdated();
    }
}

class DayInTheLifeOfALuma extends SMG1SceneDesc {
    private controller: DayInTheLifeOfALumaController;

    public placeExtra(sceneObjHolder: SceneObjHolder): void {
        this.controller = new DayInTheLifeOfALumaController(sceneObjHolder);
    }

    public patchRenderer(renderer: SMGRenderer): void {
        renderer.isInteractive = false;
    }
}

const id = "smg";
const name = "Super Mario Galaxy";

const sceneDescs = [
    "Observatory",
    new SMG1SceneDesc("Comet Observatory", "AstroGalaxy"),
    new SMG1SceneDesc("Peach's Castle Gardens", "PeachCastleGardenGalaxy"),
    new SMG1SceneDesc("Gateway Galaxy", "HeavensDoorGalaxy"),
    new SMG1SceneDesc("Boo's Boneyard Galaxy", "TeresaMario2DGalaxy"),
    "Terrace",
    new SMG1SceneDesc("Terrace", "AstroDome", 0),
    new SMG1SceneDesc("Good Egg Galaxy", "EggStarGalaxy"),
    new SMG1SceneDesc("Honeyhive Galaxy", "HoneyBeeKingdomGalaxy"),
    new SMG1SceneDesc("Loopdeeloop Galaxy", "SurfingLv1Galaxy"),
    new SMG1SceneDesc("Flipswitch Galaxy", "FlipPanelExGalaxy"),
    new SMG1SceneDesc("Sweet Sweet Galaxy", "BeltConveyerExGalaxy"),
    new SMG1SceneDesc("Bowser Jr.'s Robot Reactor", "TriLegLv1Galaxy"),
    "Fountain",
    new SMG1SceneDesc("Fountain", "AstroDome", 1),
    new SMG1SceneDesc("Space Junk Galaxy", "StarDustGalaxy"),
    new SMG1SceneDesc("Battlerock Galaxy", "BattleShipGalaxy"),
    new SMG1SceneDesc("Rolling Green Galaxy", "TamakoroExLv1Galaxy"),
    new SMG1SceneDesc("Hurry-Scurry Galaxy", "BreakDownPlanetGalaxy"),
    new SMG1SceneDesc("Sling Pod Galaxy", "CocoonExGalaxy"),
    new SMG1SceneDesc("Bowser's Star Reactor", "KoopaBattleVs1Galaxy"),
    "Kitchen",
    new SMG1SceneDesc("Kitchen", "AstroDome", 2),
    new SMG1SceneDesc("Beach Bowl Galaxy", "HeavenlyBeachGalaxy"),
    new SMG1SceneDesc("Ghostly Galaxy", "PhantomGalaxy"),
    new SMG1SceneDesc("Bubble Breeze Galaxy", "CubeBubbleExLv1Galaxy"),
    new SMG1SceneDesc("Buoy Base Galaxy", "OceanFloaterLandGalaxy"),
    new SMG1SceneDesc("Drip Drop Galaxy", "TearDropGalaxy"),
    new SMG1SceneDesc("Bowser Jr.'s Airship Armada", "KoopaJrShipLv1Galaxy"),
    "Bedroom",
    new SMG1SceneDesc("Bedroom", "AstroDome", 3),
    new SMG1SceneDesc("Gusty Garden Galaxy", "CosmosGardenGalaxy"),
    new SMG1SceneDesc("Freezeflame Galaxy", "IceVolcanoGalaxy"),
    new SMG1SceneDesc("Dusty Dune Galaxy", "SandClockGalaxy"),
    new SMG1SceneDesc("Honeyclimb Galaxy", "HoneyBeeExGalaxy"),
    new SMG1SceneDesc("Bigmouth Galaxy", "FishTunnelGalaxy"),
    new SMG1SceneDesc("Bowser's Dark Matter Plant", "KoopaBattleVs2Galaxy"),
    "Engine Room",
    new SMG1SceneDesc("Engine Room", "AstroDome", 4),
    new SMG1SceneDesc("Gold Leaf Galaxy", "ReverseKingdomGalaxy"),
    new SMG1SceneDesc("Sea Slide Galaxy", "OceanRingGalaxy"),
    new SMG1SceneDesc("Toy Time Galaxy", "FactoryGalaxy"),
    new SMG1SceneDesc("Bonefin Galaxy", "SkullSharkGalaxy"),
    new SMG1SceneDesc("Sand Spiral Galaxy", "TransformationExGalaxy"),
    new SMG1SceneDesc("Bowser Jr.'s Lava Reactor", "FloaterOtaKingGalaxy"),
    "Garden",
    new SMG1SceneDesc("Garden", "AstroDome", 5),
    new SMG1SceneDesc("Deep Dark Galaxy", "OceanPhantomCaveGalaxy"),
    new SMG1SceneDesc("Dreadnought Galaxy", "CannonFleetGalaxy"),
    new SMG1SceneDesc("Melty Molten Galaxy", "HellProminenceGalaxy"),
    new SMG1SceneDesc("Matter Splatter Galaxy", "DarkRoomGalaxy"),
    new SMG1SceneDesc("Snow Cap Galaxy", "SnowCapsuleGalaxy"),
    "Center of the Universe",
    new SMG1SceneDesc("Bowser's Galaxy Reactor", "KoopaBattleVs3Galaxy"),
    "Planet of Trials",
    new SMG1SceneDesc("Rolling Gizmo Galaxy", "TamakoroExLv2Galaxy"),
    new SMG1SceneDesc("Bubble Blast Galaxy", "CubeBubbleExLv2Galaxy"),
    new SMG1SceneDesc("Loopdeeswoop Galaxy", "SurfingLv2Galaxy"),
    new SMG1SceneDesc("Grand Finale Galaxy", "PeachCastleFinalGalaxy"),
    "?",
    new DayInTheLifeOfALuma("Day in the Life of a Luma", "AstroGalaxy", null, "DayInTheLifeOfALuma"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
