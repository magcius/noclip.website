
import { SceneDesc } from 'render';
import { SceneGroup } from '../viewer';

const id = "j3d";
const name = "J3D Models";
const sceneDescs: SceneDesc[] = [
    { name: "Faceship", filename: "faceship.bmd" },
    { name: "Sirena Beach", filename: "sirena.bmd" },
    { name: "Noki Bay", filename: "noki.bmd" },
].map((entry): SceneDesc => {
    const path = `data/j3d/${entry.filename}`;
    const name = entry.name || entry.filename;
    return new SceneDesc(name, path);
});

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
