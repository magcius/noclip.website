
import { WindWakerWater } from "./WindWakerWater";
import { SceneGroup } from "../SceneBase";
import { IS_DEVELOPMENT } from "../BuildVersion";

const sceneDescs = [
    new WindWakerWater('WindWakerWater', "Wind Waker Water"),
];

const id = 'InteractiveExamples';
const name = "Interactive Examples";
export const sceneGroup: SceneGroup = {
    id, name, sceneDescs, hidden: !IS_DEVELOPMENT,
};
