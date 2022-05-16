
import { SceneGroup } from "../SceneBase";
import { FoxFur } from "./FoxFur";
import { TessSceneDesc } from "./Tess";
import { SlimySpringWaterDesc } from "./SlimySpringWater";

const sceneDescs = [
    new FoxFur('FoxFur', 'FoxFur'),
    new SlimySpringWaterDesc('SlimySpringWater', "Slimy Spring Water"),
    new TessSceneDesc(`Tess`),
];

const id = 'InteractiveExamples';
const name = "Interactive Examples";
export const sceneGroup: SceneGroup = {
    id, name, sceneDescs, hidden: true,
};
