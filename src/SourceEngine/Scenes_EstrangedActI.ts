
import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SourceFileSystem, SourceLoadContext } from "./Main.js";
import { createScene } from "./Scenes.js";

const pathBase = `EstrangedActI`;

class EstrangedActISceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await Promise.all([
                filesystem.createVPKMount(`EstrangedActI/estranged_pack`),
            ]);
            return filesystem;
        });

        const loadContext = new SourceLoadContext(filesystem);
        return createScene(context, loadContext, this.id, `${pathBase}/maps/${this.id}.bsp`);
    }
}

const id = 'EstrangedActI';
const name = 'Estranged: Act I';
const sceneDescs = [
    new EstrangedActISceneDesc("menu_loading"),
    new EstrangedActISceneDesc("sp01thebeginning"),
    new EstrangedActISceneDesc("sp02theforest"),
    new EstrangedActISceneDesc("sp04thetunnel"),
    new EstrangedActISceneDesc("sp05thesewers"),
    new EstrangedActISceneDesc("sp07theoutleta"),
    new EstrangedActISceneDesc("sp07theoutletb"),
    new EstrangedActISceneDesc("sp08theincline"),
    new EstrangedActISceneDesc("sp09thebase"),
    new EstrangedActISceneDesc("sp10thewarehouse"),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: true };
