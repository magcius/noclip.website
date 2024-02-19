import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { HIScene } from "./HIScene.js";

const dataPath = 'bfbb/xbox2'; // TEMP: remember to change back to bfbb/xbox

class BFBBSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string) {}

    public async createScene(device: GfxDevice, context: SceneContext) {
        const paths = [
            `${dataPath}/boot.HIP`,
            //`${dataPath}/mn/mnu4.HIP`,
            //`${dataPath}/mn/mnu5.HIP`,
            `${dataPath}/${this.id.substring(0, 2)}/${this.id}.HOP`,
            `${dataPath}/${this.id.substring(0, 2)}/${this.id}.HIP`,
        ];

        const scene = new HIScene(device, context);
        await scene.load(context.dataFetcher, paths);

        return scene;
    }
}

const id = 'bfbb';
const name = 'SpongeBob SquarePants: Battle for Bikini Bottom';
const sceneDescs = [
    'Bikini Bottom',
    new BFBBSceneDesc('hb01', 'Bikini Bottom'),
    'Jellyfish Fields',
    new BFBBSceneDesc('jf01', 'Jellyfish Rock'),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };