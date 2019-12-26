
import { WindWakerWater } from "./WindWakerWater";
import { SceneGroup } from "../SceneBase";
import { IS_DEVELOPMENT } from "../BuildVersion";
import { FoxFur } from "./FoxFur";
import { WWTitle } from "./WWTitle";

const sceneDescs = [
    new WindWakerWater('WindWakerWater', "Wind Waker Water"),
    new FoxFur('FoxFur', 'FoxFur'),
    new WWTitle('WWTitle', 'WWTitle'),
];

const id = 'InteractiveExamples';
const name = "Interactive Examples";
export const sceneGroup: SceneGroup = {
    id, name, sceneDescs, hidden: !IS_DEVELOPMENT,
};
