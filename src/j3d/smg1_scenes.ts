
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
    "Engine Room"
    "Garden"
    new SMG1SceneDesc("Melty Molten Galaxy", "HellProminenceGalaxy"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
