
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
    new SMG1SceneDesc("Gateway Galaxy", "HeavensDoorGalaxy")
    new SMG1SceneDesc("Boo's Boneyard Galaxy", "TeresaMario2DGalaxy")
    "Terrace"
    new SMG1SceneDesc("Good Egg Galaxy", "EggStarGalaxy"),
    new SMG1SceneDesc("Honeyhive Galaxy", "HoneyBeeKingdomGalaxy"),
    new SMG1SceneDesc("Sweet Sweet Galaxy", "BeltConveyerExGalaxy"),
    "Fountain"
    new SMG1SceneDesc("Space Junk Galaxy", "StarDustGalaxy"),
    new SMG1SceneDesc("Battlerock Galaxy", "BattleShipGalaxy"),
    "Kitchen"
    new SMG1SceneDesc("Beach Bowl Galaxy", "HeavenlyBeachGalaxy"),
    new SMG1SceneDesc("Ghostly Galaxy", "PhantomGalaxy"),
    "Bedroom"
    new SMG1SceneDesc("Dusty Dune Galaxy", "SandClockGalaxy"),
    new SMG1SceneDesc("Freezeflame Galaxy", "IceVolcanoGalaxy")
    new SMG1SceneDesc("Honeyclimb Galaxy", "HoneyBeeExGalaxy")
    new SMG1SceneDesc("Bigmouth Galaxy", "FishTunnelGalaxy")
    "Engine Room"
    new SMG1SceneDesc("Sand Spiral Galaxy", "TransformationExGalaxy")
    "Garden"
    new SMG1SceneDesc("Melty Molten Galaxy", "HellProminenceGalaxy"),
    new SMG1SceneDesc("Matter Splatter Galaxy", "DarkRoomGalaxy")
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
