
import { SceneDesc } from 'render';
import { SceneGroup } from '../viewer';

const id = "j3d";
const name = "J3D Models";

interface SceneOpt {
    name: string;
    filename: string;
    vrbox?: string;
}

const sceneDescs: SceneDesc[] = (<SceneOpt[]> [
    { name: "Faceship", filename: "faceship.bmd" },
    { name: "Sirena Beach", filename: "sirena.bmd" },
    { name: "Noki Bay", filename: "noki.bmd" },
    { name: "Delfino Plaza", filename: "dolpic.bmd" },
    { name: "Peach Castle Garden", filename: "peachcastlegardenplanet.bdl", vrbox: "GalaxySky.arc" },
    { name: "Windfall Island", filename: "windfall.bdl" },
]).map((entry): SceneDesc => {
    const path = `data/j3d/${entry.filename}`;
    const name = entry.name || entry.filename;
    const vrbox = entry.vrbox ? `data/j3d/${entry.vrbox}` : null;
    return new SceneDesc(name, path, vrbox);
});

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
