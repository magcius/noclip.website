
import * as Viewer from '../viewer';
import { SMGSceneDescBase } from "./smg_scenes";

class SMG2SceneDesc extends SMGSceneDescBase {
    protected pathBase: string = `j3d/smg2`;
    protected getZoneMapFilename(zoneName: string): string {
        return `${this.pathBase}/StageData/${zoneName}/${zoneName}Map.arc`;
    }
}

const id = "smg2";
const name = "Super Mario Galaxy 2";

const sceneDescs: Viewer.SceneDesc[] = [
    new SMG2SceneDesc("Mario's Faceship", "MarioFaceShipGalaxy"),
    new SMG2SceneDesc("Starshine Beach Galaxy", "TropicalResortGalaxy"),
    new SMG2SceneDesc("Fluffy Bluff Galaxy", "MokumokuValleyGalaxy"),
    new SMG2SceneDesc("Tall Trunk Galaxy", "BigTree2Galaxy"),
    new SMG2SceneDesc("Wild Glide Galaxy", "JungleGliderGalaxy"),
    new SMG2SceneDesc("Cloudy Court Galaxy", "CloudGardenGalaxy"),
    new SMG2SceneDesc("Fleet Glide Galaxy", "ChallengeGliderGalaxy"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
