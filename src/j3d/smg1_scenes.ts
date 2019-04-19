
import * as Viewer from '../viewer';
import { SMGSceneDescBase } from "./smg_scenes";

class SMG1SceneDesc extends SMGSceneDescBase {
    protected pathBase: string = `j3d/smg`;
    protected getZoneMapFilename(zoneName: string): string {
        return `${this.pathBase}/StageData/${zoneName}.arc`;
    }
}

const id = "smg";
const name = "Super Mario Galaxy";

const sceneDescs: Viewer.SceneDesc[] = [
    "Observatory"
    new SMG1SceneDesc("Comet Observatory", "AstroGalaxy"),
    new SMG1SceneDesc("Peach's Castle Garden", "PeachCastleGardenGalaxy"),
    new SMG1SceneDesc("Gateway Galaxy", "HeavensDoorGalaxy"),
    new SMG1SceneDesc("Boo's Boneyard Galaxy", "TeresaMario2DGalaxy"),
    new SMG1SceneDesc("Rolling Gizmo Galaxy", "TamakoroExLv2Galaxy"),
    new SMG1SceneDesc("Bowser's Galaxy Reactor", "KoopaBattleVs3Galaxy"),
    new SMG1SceneDesc("Grand Finale Galaxy", "PeachCastleFinalGalaxy"),
    "Terrace"
    new SMG1SceneDesc("Good Egg Galaxy", "EggStarGalaxy"),
    new SMG1SceneDesc("Honeyhive Galaxy", "HoneyBeeKingdomGalaxy"),
    new SMG1SceneDesc("Flipswitch Galaxy", "FlipPanelExGalaxy"),
    new SMG1SceneDesc("Sweet Sweet Galaxy", "BeltConveyerExGalaxy"),
    "Fountain"
    new SMG1SceneDesc("Space Junk Galaxy", "StarDustGalaxy"),
    new SMG1SceneDesc("Battlerock Galaxy", "BattleShipGalaxy"),
    new SMG1SceneDesc("Rolling Green Galaxy", "TamakoroExLv1Galaxy"),
    new SMG1SceneDesc("Hurry-Scurry Galaxy", "BreakDownPlanetGalaxy"),
    new SMG1SceneDesc("Sling Pod Galaxy", "CocoonExGalaxy"),
    new SMG1SceneDesc("Bowser's Star Reactor", "KoopaBattleVs1Galaxy"),
    "Kitchen"
    new SMG1SceneDesc("Beach Bowl Galaxy", "HeavenlyBeachGalaxy"),
    new SMG1SceneDesc("Ghostly Galaxy", "PhantomGalaxy"),
    new SMG1SceneDesc("Buoy Base Galaxy", "OceanFloaterLandGalaxy"),
    new SMG1SceneDesc("Drip Drop Galaxy", "TearDropGalaxy"),
    "Bedroom"
    new SMG1SceneDesc("Freezeflame Galaxy", "IceVolcanoGalaxy"),
    new SMG1SceneDesc("Dusty Dune Galaxy", "SandClockGalaxy"),
    new SMG1SceneDesc("Honeyclimb Galaxy", "HoneyBeeExGalaxy"),
    new SMG1SceneDesc("Bigmouth Galaxy", "FishTunnelGalaxy"),
    new SMG1SceneDesc("Bowser's Dark Matter Plant", "KoopaBattleVs2Galaxy"),
    "Engine Room"
    new SMG1SceneDesc("Gold Leaf Galaxy", "ReverseKingdomGalaxy"),
    new SMG1SceneDesc("Sea Slide Galaxy", "OceanRingGalaxy"),
    new SMG1SceneDesc("Toy Time Galaxy", "FactoryGalaxy"),
    new SMG1SceneDesc("Bonefin Galaxy", "SkullSharkGalaxy"),
    new SMG1SceneDesc("Sand Spiral Galaxy", "TransformationExGalaxy"),
    "Garden"
    new SMG1SceneDesc("Deep Dark Galaxy", "OceanPhantomCaveGalaxy"),
    new SMG1SceneDesc("Dreadnought Galaxy", "CannonFleetGalaxy"),
    new SMG1SceneDesc("Melty Molten Galaxy", "HellProminenceGalaxy"),
    new SMG1SceneDesc("Matter Splatter Galaxy", "DarkRoomGalaxy"),
    new SMG1SceneDesc("Snow Cap Galaxy", "SnowCapsuleGalaxy"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
