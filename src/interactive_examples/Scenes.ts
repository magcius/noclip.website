
import { SceneGroup } from "../SceneBase";
import { IS_DEVELOPMENT } from "../BuildVersion";
import { FoxFur } from "./FoxFur";

const sceneDescs = [
    new FoxFur('FoxFur', 'FoxFur'),
];

const id = 'InteractiveExamples';
const name = "Interactive Examples";
export const sceneGroup: SceneGroup = {
    id, name, sceneDescs, hidden: !IS_DEVELOPMENT,
};
