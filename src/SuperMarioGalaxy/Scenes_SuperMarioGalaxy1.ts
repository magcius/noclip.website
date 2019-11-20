
import * as Viewer from '../viewer';
import { SMGSceneDescBase, ModelCache } from "./Main";
import { JMapInfoIter, createCsvParser } from './JMapInfo';
import { RARC } from '../j3d/rarc';

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
    public getZoneMapArchive(modelCache: ModelCache, zoneName: string): RARC {
        return modelCache.getArchive(`StageData/${zoneName}.arc`)!;
    }
    public requestGlobalArchives(modelCache: ModelCache): void {
        modelCache.requestArchiveData(`ObjectData/LightData.arc`);
    }
    public requestZoneArchives(modelCache: ModelCache, zoneName: string): void {
        modelCache.requestArchiveData(`StageData/${zoneName}.arc`);
    }
}

const id = "smg";
const name = "Super Mario Galaxy";

const sceneDescs = [
    "Observatory",
    new SMG1SceneDesc("Comet Observatory", "AstroGalaxy"),
    new SMG1SceneDesc("Peach's Castle Garden", "PeachCastleGardenGalaxy"),
    new SMG1SceneDesc("Gateway Galaxy", "HeavensDoorGalaxy"),
    new SMG1SceneDesc("Boo's Boneyard Galaxy", "TeresaMario2DGalaxy"),
    "Terrace",
    new SMG1SceneDesc("Good Egg Galaxy", "EggStarGalaxy"),
    new SMG1SceneDesc("Honeyhive Galaxy", "HoneyBeeKingdomGalaxy"),
    new SMG1SceneDesc("Loopdeeloop Galaxy", "SurfingLv1Galaxy"),
    new SMG1SceneDesc("Flipswitch Galaxy", "FlipPanelExGalaxy"),
    new SMG1SceneDesc("Sweet Sweet Galaxy", "BeltConveyerExGalaxy"),
    new SMG1SceneDesc("Bowser Jr.'s Robot Reactor", "TriLegLv1Galaxy"),
    "Fountain",
    new SMG1SceneDesc("Space Junk Galaxy", "StarDustGalaxy"),
    new SMG1SceneDesc("Battlerock Galaxy", "BattleShipGalaxy"),
    new SMG1SceneDesc("Rolling Green Galaxy", "TamakoroExLv1Galaxy"),
    new SMG1SceneDesc("Hurry-Scurry Galaxy", "BreakDownPlanetGalaxy"),
    new SMG1SceneDesc("Sling Pod Galaxy", "CocoonExGalaxy"),
    new SMG1SceneDesc("Bowser's Star Reactor", "KoopaBattleVs1Galaxy"),
    "Kitchen",
    new SMG1SceneDesc("Beach Bowl Galaxy", "HeavenlyBeachGalaxy"),
    new SMG1SceneDesc("Ghostly Galaxy", "PhantomGalaxy"),
    new SMG1SceneDesc("Bubble Breeze Galaxy", "CubeBubbleExLv1Galaxy"),
    new SMG1SceneDesc("Buoy Base Galaxy", "OceanFloaterLandGalaxy"),
    new SMG1SceneDesc("Drip Drop Galaxy", "TearDropGalaxy"),
    new SMG1SceneDesc("Bowser Jr.'s Airship Armada", "KoopaJrShipLv1Galaxy"),
    "Bedroom",
    new SMG1SceneDesc("Gusty Garden Galaxy", "CosmosGardenGalaxy"),
    new SMG1SceneDesc("Freezeflame Galaxy", "IceVolcanoGalaxy"),
    new SMG1SceneDesc("Dusty Dune Galaxy", "SandClockGalaxy"),
    new SMG1SceneDesc("Honeyclimb Galaxy", "HoneyBeeExGalaxy"),
    new SMG1SceneDesc("Bigmouth Galaxy", "FishTunnelGalaxy"),
    new SMG1SceneDesc("Bowser's Dark Matter Plant", "KoopaBattleVs2Galaxy"),
    "Engine Room",
    new SMG1SceneDesc("Gold Leaf Galaxy", "ReverseKingdomGalaxy"),
    new SMG1SceneDesc("Sea Slide Galaxy", "OceanRingGalaxy"),
    new SMG1SceneDesc("Toy Time Galaxy", "FactoryGalaxy"),
    new SMG1SceneDesc("Bonefin Galaxy", "SkullSharkGalaxy"),
    new SMG1SceneDesc("Sand Spiral Galaxy", "TransformationExGalaxy"),
    new SMG1SceneDesc("Bowser Jr.'s Lava Reactor", "FloaterOtaKingGalaxy"),
    "Garden",
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
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
