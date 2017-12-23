
import { SceneDesc } from 'render';
import { SceneGroup } from '../viewer';

const name = "J3D Models";
const sceneDescs: SceneDesc[] = [
    { name: "Faceship", filename: "faceship.bmd" },
].map((entry): SceneDesc => {
    const path = `data/j3d/${entry.filename}`;
    const name = entry.name || entry.filename;
    return new SceneDesc(name, path);
});

export const sceneGroup: SceneGroup = { name, sceneDescs };
