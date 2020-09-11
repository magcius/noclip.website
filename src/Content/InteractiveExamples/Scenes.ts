
import { SceneGroup } from "../../SceneBase";
import { FoxFur } from "./FoxFur";
import { SlimySpringWaterDesc } from "./SlimySpringWater";

const sceneDescs = [
    new FoxFur('FoxFur', 'FoxFur'),
    new SlimySpringWaterDesc('SlimySpringWater', "Slimy Spring Water"),
];

const id = 'InteractiveExamples';
const name = "Interactive Examples";
export const sceneGroup: SceneGroup = {
    id, name, sceneDescs, hidden: true,
};
