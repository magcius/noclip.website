
import { SceneGroup } from "../SceneBase.js";
import { FoxFur } from "./FoxFur.js";
import { TessSceneDesc } from "./Tess.js";
import { SlimySpringWaterDesc } from "./SlimySpringWater.js";

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
